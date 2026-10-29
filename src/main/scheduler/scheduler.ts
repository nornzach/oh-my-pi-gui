/**
 * The scheduled-task scheduler (plan/23 §2, §6–§8). Owns the clock, the
 * dispatch queue and the run ledger; runs themselves go through the injected
 * runner (runner.ts), and git and session cleanup through injected helpers,
 * so the whole lifecycle is testable with fake timers and no Electron.
 *
 * Clock rules: a slot is run if the clock reaches it within MISSED_GRACE_MS;
 * a later wake-up records one `missed` run and moves on, never a replay.
 * Overlapping fires are skipped, and a task with too many unreviewed changed
 * runs is skipped until someone reviews them.
 */

import { nextFireAfter } from "../../shared/schedule";
import type {
	DraftProblem,
	InsightsDay,
	RunState,
	RunTrigger,
	RunWorktree,
	ScheduledTask,
	SchedulerInsights,
	SchedulerLimits,
	SchedulerSnapshot,
	TaskConfig,
	TaskDraft,
	TaskRun,
	TaskSaveResult,
	TaskState,
} from "../../shared/scheduler-types";
import {
	DEFAULT_LIMITS,
	draftProblems,
	FAILURE_STREAK,
	isFailureState,
	isFinalState,
	runNeedsReview,
	shouldNotify,
	streakOf,
	TRANSIENT_RETRY_DELAY_MS,
	UNREVIEWED_WORKTREE_MAX_AGE_MS,
} from "./policy";
import type { RunInput, RunResult } from "./runner";
import { configOf, LIVE_RUN_STATES, type SchedulerStore, type StoredTask } from "./store";

const HEARTBEAT_MS = 30_000;
/** The clock re-checks at least this often, so sleep and clock changes self-correct. */
const MAX_TIMER_MS = 60_000;
/** A slot reached later than this (sleep, app closed) is recorded as missed instead of run. */
export const MISSED_GRACE_MS = 2 * 60_000;
const SWEEP_MS = 24 * 3_600_000;
const SNAPSHOT_RUNS = 200;
const STALL_MS = HEARTBEAT_MS * 3;

export type SchedulerNotice =
	| { kind: "run"; task: ScheduledTask; run: TaskRun }
	| { kind: "disabled"; task: ScheduledTask; run: TaskRun }
	| { kind: "auth"; task: ScheduledTask; run: TaskRun };

export interface SchedulerCleanup {
	/** Remove a worktree directory, and its branch when asked; true when it is gone. */
	removeWorktree(worktree: RunWorktree, options: { deleteBranch: boolean }): Promise<boolean>;
	deleteSession(sessionPath: string): Promise<void>;
}

export interface SchedulerDeps {
	store: SchedulerStore;
	runner(input: RunInput): Promise<RunResult>;
	now(): number;
	nextId(): string;
	cleanup: SchedulerCleanup;
	notify(notice: SchedulerNotice): void;
	/** The ledger or a task changed; the host pushes a fresh snapshot. */
	onChange(): void;
	onProgress(runId: string, progress: TaskRun["progress"]): void;
}

interface LiveRun {
	run: TaskRun;
	controller: AbortController;
	done: Promise<void>;
}

export class Scheduler {
	readonly #deps: SchedulerDeps;
	#limits: SchedulerLimits;
	#paused: boolean;
	/** Next fire per active task, computed from its schedule. */
	#nextFire = new Map<string, number | null>();
	#queue: TaskRun[] = [];
	#live = new Map<string, LiveRun>();
	#retryTimers = new Map<string, NodeJS.Timeout>();
	#clockTimer: NodeJS.Timeout | null = null;
	#heartbeatTimer: NodeJS.Timeout | null = null;
	#sweepTimer: NodeJS.Timeout | null = null;
	#heartbeatAt: number | null = null;
	#started = false;
	#stopping = false;

	constructor(deps: SchedulerDeps) {
		this.#deps = deps;
		const stored = deps.store.getMeta("limits");
		this.#limits = { ...DEFAULT_LIMITS, ...(stored ? (JSON.parse(stored) as Partial<SchedulerLimits>) : {}) };
		this.#paused = deps.store.getMeta("paused") === "1";
	}

	// ------------------------------------------------------------ lifecycle

	/** Reconcile what the last process left behind, record missed slots, start the clock. */
	start(): void {
		if (this.#started) return;
		this.#started = true;
		const now = this.#deps.now();
		const store = this.#deps.store;
		for (const run of store.listRunsInStates(LIVE_RUN_STATES)) {
			store.saveRun({
				...run,
				state: "unknown",
				endedAt: now,
				error: { message: "omp closed or crashed while this run was in progress", kind: "other" },
			});
		}
		const lastAlive = Number(store.getMeta("heartbeat") ?? "") || null;
		for (const task of store.listTasks()) {
			if (task.state !== "active") continue;
			// The last beat can predate a slot the last process already handled; the ledger knows.
			const since = Math.max(lastAlive ?? task.updatedAt, task.updatedAt, store.lastScheduledFor(task.id) ?? 0);
			this.#nextFire.set(task.id, this.#catchUp(task, since, now));
		}
		this.#beat();
		this.#heartbeatTimer = setInterval(() => this.#beat(), HEARTBEAT_MS);
		this.#sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS);
		void this.sweep();
		this.#arm();
		this.#deps.onChange();
	}

	/** Machine woke or the clock jumped: re-evaluate now. */
	wake(): void {
		if (!this.#started) return;
		this.#tick();
	}

	/** Cancel live runs (app quit) and stop every timer. Resolves when runs have ended. */
	async stop(): Promise<void> {
		this.#stopping = true;
		for (const timer of [this.#clockTimer, this.#heartbeatTimer, this.#sweepTimer]) {
			if (timer) clearTimeout(timer);
		}
		for (const timer of this.#retryTimers.values()) clearTimeout(timer);
		this.#retryTimers.clear();
		for (const queued of this.#queue)
			this.#save({ ...queued, state: "cancelled", cancelReason: "app_quit", endedAt: this.#deps.now() });
		this.#queue = [];
		const live = [...this.#live.values()];
		for (const entry of live) {
			entry.run.cancelReason = "app_quit";
			// Written before the abort settles: a quitting app exits without
			// waiting, and the next launch must read "cancelled", not "unknown".
			this.#save({ ...entry.run, state: "cancelled", endedAt: this.#deps.now(), progress: undefined });
			entry.controller.abort();
		}
		await Promise.all(live.map(entry => entry.done));
	}

	get liveRunCount(): number {
		return this.#live.size;
	}

	// ------------------------------------------------------------- snapshot

	snapshot(): SchedulerSnapshot {
		const store = this.#deps.store;
		const now = this.#deps.now();
		const tasks = store.listTasks().map(task => this.#present(task));
		const runs = store.listRuns({ limit: SNAPSHOT_RUNS }).map(run => {
			const live = this.#live.get(run.id);
			return live ? { ...run, progress: live.run.progress } : run;
		});
		const nextFires = tasks.map(task => task.nextFireAt).filter((value): value is number => value !== null);
		const stalled = this.#heartbeatAt !== null && now - this.#heartbeatAt > STALL_MS;
		return {
			tasks,
			runs,
			paused: this.#paused,
			health: {
				state: this.#paused ? "paused" : stalled ? "stalled" : "healthy",
				heartbeatAt: this.#heartbeatAt,
				nextFireAt: this.#paused || nextFires.length === 0 ? null : Math.min(...nextFires),
			},
			limits: this.#limits,
			reviewCount: store.countPendingReview(),
		};
	}

	get limits(): SchedulerLimits {
		return this.#limits;
	}

	getTask(taskId: string): ScheduledTask | null {
		const task = this.#deps.store.getTask(taskId);
		return task ? this.#present(task) : null;
	}

	getRun(runId: string): TaskRun | null {
		return this.#deps.store.getRun(runId);
	}

	listTaskRuns(taskId: string, limit = 100): TaskRun[] {
		return this.#deps.store.listRuns({ taskId, limit });
	}

	listRevisions(taskId: string) {
		return this.#deps.store.listRevisions(taskId);
	}

	runSessionPaths(): Set<string> {
		return this.#deps.store.runSessionPaths();
	}

	// ----------------------------------------------------------------- tasks

	validate(draft: TaskDraft, editingId?: string): DraftProblem[] {
		const editing = editingId ? this.#deps.store.getTask(editingId) : null;
		const willBeEnabled = editing ? editing.state === "active" : !draft.startPaused;
		return draftProblems(draft, {
			now: this.#deps.now(),
			limits: this.#limits,
			enabledOthers: this.#enabledCount(editingId),
			willBeEnabled,
		});
	}

	createTask(draft: TaskDraft): TaskSaveResult {
		const problems = this.validate(draft);
		if (problems.length > 0) return { ok: false, problems };
		const now = this.#deps.now();
		const task: StoredTask = {
			...configOf(draft),
			id: this.#deps.nextId(),
			revision: 1,
			state: draft.startPaused ? "paused" : "active",
			origin: draft.origin,
			createdAt: now,
			updatedAt: now,
		};
		this.#deps.store.saveTask(task);
		this.#reschedule(task);
		this.#changed();
		return { ok: true, task: this.#present(task) };
	}

	updateTask(id: string, config: TaskConfig): TaskSaveResult {
		const existing = this.#deps.store.getTask(id);
		if (!existing || existing.state === "archived") return { ok: false, problems: ["schedule_invalid"] };
		const draft: TaskDraft = { ...config, origin: existing.origin, startPaused: existing.state !== "active" };
		const problems = this.validate(draft, id);
		if (problems.length > 0) return { ok: false, problems };
		const task: StoredTask = {
			...existing,
			...configOf(config),
			revision: existing.revision + 1,
			updatedAt: this.#deps.now(),
		};
		this.#deps.store.saveTask(task);
		this.#reschedule(task);
		this.#changed();
		return { ok: true, task: this.#present(task) };
	}

	/**
	 * Pause or resume. Resuming a disabled task clears why it was disabled;
	 * pausing an archived task restores it, paused, so it never fires on restore.
	 */
	setTaskEnabled(id: string, enabled: boolean): TaskSaveResult {
		const existing = this.#deps.store.getTask(id);
		if (!existing || (existing.state === "archived" && enabled)) return { ok: false, problems: ["schedule_invalid"] };
		if (enabled && existing.state !== "active" && this.#enabledCount(id) >= this.#limits.maxEnabledTasks) {
			return { ok: false, problems: ["too_many_enabled"] };
		}
		const state: TaskState = enabled ? "active" : "paused";
		const task: StoredTask = { ...existing, state, disabledReason: undefined, updatedAt: this.#deps.now() };
		this.#deps.store.saveTask(task);
		this.#reschedule(task);
		this.#changed();
		return { ok: true, task: this.#present(task) };
	}

	archiveTask(id: string, cancelLive: boolean): void {
		const existing = this.#deps.store.getTask(id);
		if (!existing) return;
		this.#deps.store.saveTask({
			...existing,
			state: "archived",
			disabledReason: undefined,
			updatedAt: this.#deps.now(),
		});
		this.#nextFire.delete(id);
		this.#queue = this.#queue.filter(run => {
			if (run.taskId !== id) return true;
			this.#save({ ...run, state: "cancelled", cancelReason: "task_archived", endedAt: this.#deps.now() });
			return false;
		});
		if (cancelLive) {
			for (const entry of this.#live.values()) {
				if (entry.run.taskId !== id) continue;
				entry.run.cancelReason = "task_archived";
				entry.controller.abort();
			}
		}
		this.#changed();
	}

	/** Permanently remove an archived task with its runs, their session files and branches. */
	async deleteTask(id: string): Promise<boolean> {
		const task = this.#deps.store.getTask(id);
		if (task?.state !== "archived") return false;
		if ([...this.#live.values()].some(entry => entry.run.taskId === id)) return false;
		for (const run of this.#deps.store.listRuns({ taskId: id, limit: 100_000 })) {
			await this.#discardRunArtifacts(run, { deleteBranch: run.review.state !== "accepted" });
		}
		this.#deps.store.deleteTask(id);
		this.#changed();
		return true;
	}

	runNow(id: string): TaskRun | null {
		const task = this.#deps.store.getTask(id);
		if (!task || task.state === "archived") return null;
		return this.#fire(task, "manual", null);
	}

	cancelRun(runId: string): boolean {
		const queuedIndex = this.#queue.findIndex(run => run.id === runId);
		if (queuedIndex !== -1) {
			const [run] = this.#queue.splice(queuedIndex, 1);
			this.#save({ ...run, state: "cancelled", cancelReason: "user", endedAt: this.#deps.now() });
			this.#changed();
			return true;
		}
		const live = this.#live.get(runId);
		if (!live) return false;
		live.run.cancelReason = "user";
		live.controller.abort();
		return true;
	}

	setPaused(paused: boolean): void {
		this.#paused = paused;
		this.#deps.store.setMeta("paused", paused ? "1" : "0");
		if (!paused) {
			// Slots that passed while paused are not owed: start from now.
			const now = this.#deps.now();
			for (const task of this.#deps.store.listTasks()) {
				if (task.state === "active") this.#nextFire.set(task.id, nextFireAfter(task.schedule, now));
			}
			this.#arm();
		}
		this.#changed();
	}

	setLimits(patch: Partial<Pick<SchedulerLimits, "maxConcurrentRuns" | "retainDays">>): void {
		const clamp = (value: number | undefined, min: number, max: number, fallback: number) =>
			value === undefined || !Number.isFinite(value) ? fallback : Math.min(max, Math.max(min, Math.round(value)));
		this.#limits = {
			...this.#limits,
			maxConcurrentRuns: clamp(patch.maxConcurrentRuns, 1, 3, this.#limits.maxConcurrentRuns),
			retainDays: clamp(patch.retainDays, 7, 365, this.#limits.retainDays),
		};
		this.#deps.store.setMeta("limits", JSON.stringify(this.#limits));
		this.#drain();
		this.#changed();
	}

	// ---------------------------------------------------------------- review

	async review(runId: string, decision: "accepted" | "rejected", note?: string): Promise<TaskRun | null> {
		const run = this.#deps.store.getRun(runId);
		if (!run || !isFinalState(run.state)) return null;
		let updated: TaskRun = {
			...run,
			review: { state: decision, note: note?.trim() ? note.trim().slice(0, 2000) : undefined, at: this.#deps.now() },
		};
		if (decision === "rejected" && updated.worktree && !updated.worktree.removed) {
			const removed = await this.#deps.cleanup.removeWorktree(updated.worktree, { deleteBranch: true });
			if (removed) updated = { ...updated, worktree: { ...updated.worktree, removed: true } };
		}
		this.#save(updated);
		this.#changed();
		return updated;
	}

	// ------------------------------------------------------------- insights

	insights(periodDays: number, taskId?: string): SchedulerInsights {
		const now = this.#deps.now();
		const since = now - periodDays * 86_400_000;
		const runs = this.#deps.store.listRuns({ since, taskId, limit: 100_000 });
		const titles = new Map(this.#deps.store.listTasks().map(task => [task.id, task.title]));
		return computeInsights(runs, titles, periodDays, now);
	}

	// ----------------------------------------------------------- housekeeping

	/**
	 * Daily: remove worktrees left unreviewed for 14 days (branches stay, so
	 * committed changes survive), and drop runs past retention with their
	 * session files. Pending reviews and each task's latest run are kept.
	 */
	async sweep(): Promise<void> {
		const store = this.#deps.store;
		const now = this.#deps.now();
		for (const run of store.listPendingReview()) {
			const worktree = run.worktree;
			if (!worktree || worktree.removed || !worktree.committed) continue;
			if (now - (run.endedAt ?? run.createdAt) < UNREVIEWED_WORKTREE_MAX_AGE_MS) continue;
			if (await this.#deps.cleanup.removeWorktree(worktree, { deleteBranch: false })) {
				store.saveRun({ ...run, worktree: { ...worktree, removed: true } });
			}
		}
		const latestByTask = new Map<string, string>();
		for (const task of store.listTasks()) {
			const latest = store.listRuns({ taskId: task.id, limit: 1 })[0];
			if (latest) latestByTask.set(task.id, latest.id);
		}
		for (const run of store.listRunsBefore(now - this.#limits.retainDays * 86_400_000)) {
			if (run.review.state === "pending" || latestByTask.get(run.taskId) === run.id || this.#live.has(run.id))
				continue;
			await this.#discardRunArtifacts(run, { deleteBranch: run.review.state !== "accepted" });
			store.deleteRun(run.id);
		}
		this.#changed();
	}

	// ---------------------------------------------------------------- clock

	#arm(): void {
		if (this.#clockTimer) clearTimeout(this.#clockTimer);
		this.#clockTimer = null;
		if (this.#stopping) return;
		const now = this.#deps.now();
		let earliest: number | null = null;
		for (const next of this.#nextFire.values()) {
			if (next !== null && (earliest === null || next < earliest)) earliest = next;
		}
		// Paused, a due slot stays due: waiting the full period keeps the clock from spinning on it.
		const delay =
			earliest === null || this.#paused ? MAX_TIMER_MS : Math.max(0, Math.min(MAX_TIMER_MS, earliest - now));
		this.#clockTimer = setTimeout(() => this.#tick(), delay);
	}

	#tick(): void {
		if (this.#stopping) return;
		const now = this.#deps.now();
		let changed = false;
		if (!this.#paused) {
			for (const [taskId, next] of this.#nextFire) {
				if (next === null || next > now) continue;
				const task = this.#deps.store.getTask(taskId);
				if (task?.state !== "active") {
					this.#nextFire.delete(taskId);
					continue;
				}
				if (now - next > MISSED_GRACE_MS) {
					this.#nextFire.set(taskId, this.#catchUp(task, next - 1, now));
				} else {
					this.#fire(task, "schedule", next);
					this.#nextFire.set(taskId, nextFireAfter(task.schedule, now));
				}
				changed = true;
			}
		}
		this.#arm();
		if (changed) this.#changed();
	}

	#beat(): void {
		this.#heartbeatAt = this.#deps.now();
		this.#deps.store.setMeta("heartbeat", String(this.#heartbeatAt));
	}

	#reschedule(task: StoredTask): void {
		if (task.state === "active") this.#nextFire.set(task.id, nextFireAfter(task.schedule, this.#deps.now()));
		else this.#nextFire.delete(task.id);
		this.#arm();
	}

	/**
	 * Slots after `since` the clock reached too late: record the last one as
	 * missed and return the slot to run next, which is already due when it
	 * falls inside the grace window.
	 */
	#catchUp(task: StoredTask, since: number, now: number): number | null {
		const missedAt = this.#lastFireBetween(task, since, now - MISSED_GRACE_MS);
		if (missedAt !== null) this.#recordSkip(task, "missed", missedAt, "schedule");
		return this.#firstFireFrom(task, missedAt ?? since, now);
	}

	#firstFireFrom(task: StoredTask, since: number, now: number): number | null {
		const next = nextFireAfter(task.schedule, since);
		// A slot inside the grace window is still run; anything older was recorded as missed.
		if (next !== null && next <= now && now - next <= MISSED_GRACE_MS) return next;
		return nextFireAfter(task.schedule, now);
	}

	#lastFireBetween(task: StoredTask, from: number, to: number): number | null {
		let last: number | null = null;
		let cursor = from;
		for (let guard = 0; guard < 100_000; guard++) {
			const next = nextFireAfter(task.schedule, cursor);
			if (next === null || next > to) break;
			last = next;
			cursor = next;
		}
		return last;
	}

	// -------------------------------------------------------------- dispatch

	#fire(task: StoredTask, trigger: RunTrigger, scheduledFor: number | null, retryOf?: string): TaskRun {
		if (
			[...this.#live.values()].some(entry => entry.run.taskId === task.id) ||
			this.#queue.some(run => run.taskId === task.id)
		) {
			return this.#recordSkip(task, "skipped_overlap", scheduledFor, trigger);
		}
		const backlog = this.#deps.store
			.listPendingReview()
			.filter(run => run.taskId === task.id && run.changedFiles.length > 0).length;
		if (trigger !== "manual" && backlog >= this.#limits.reviewBacklog) {
			return this.#recordSkip(task, "skipped_backlog", scheduledFor, trigger);
		}
		const run = this.#newRun(task, trigger, scheduledFor, "queued");
		if (retryOf) run.retryOf = retryOf;
		this.#save(run);
		this.#queue.push(run);
		this.#drain();
		this.#changed();
		return run;
	}

	#recordSkip(task: StoredTask, state: RunState, scheduledFor: number | null, trigger: RunTrigger): TaskRun {
		const run = this.#newRun(task, trigger, scheduledFor, state);
		run.endedAt = this.#deps.now();
		this.#save(run);
		if (state === "missed") this.#notify(task, run);
		return run;
	}

	#newRun(task: StoredTask, trigger: RunTrigger, scheduledFor: number | null, state: RunState): TaskRun {
		return {
			id: this.#deps.nextId(),
			taskId: task.id,
			taskRevision: task.revision,
			trigger,
			scheduledFor,
			createdAt: this.#deps.now(),
			state,
			blocked: [],
			changedFiles: [],
			verification: { state: "none" },
			review: { state: "none" },
		};
	}

	#drain(): void {
		while (!this.#stopping && this.#live.size < this.#limits.maxConcurrentRuns && this.#queue.length > 0) {
			const run = this.#queue.shift();
			if (run) this.#launch(run);
		}
	}

	#launch(queued: TaskRun): void {
		const store = this.#deps.store;
		const config = store.getRevision(queued.taskId, queued.taskRevision);
		const task = store.getTask(queued.taskId);
		if (!config || !task) {
			this.#save({
				...queued,
				state: "blocked_config",
				endedAt: this.#deps.now(),
				error: { message: "The task no longer exists", kind: "config" },
			});
			return;
		}
		const run: TaskRun = {
			...queued,
			state: "running",
			startedAt: this.#deps.now(),
			progress: { turns: 0, lastTool: null },
		};
		this.#save(run);
		const controller = new AbortController();
		const entry: LiveRun = { run, controller, done: Promise.resolve() };
		this.#live.set(run.id, entry);
		entry.done = this.#deps
			.runner({
				runId: run.id,
				config,
				previous: this.#previousContext(task.id, run.id),
				signal: controller.signal,
				onProgress: progress => {
					entry.run.progress = progress;
					this.#deps.onProgress(run.id, progress);
				},
				onSession: sessionPath => {
					entry.run.sessionPath = sessionPath;
					this.#save(entry.run);
					this.#changed();
				},
			})
			.catch(
				(error): RunResult => ({
					state: "failed",
					startedAt: run.startedAt ?? this.#deps.now(),
					endedAt: this.#deps.now(),
					blocked: [],
					changedFiles: [],
					verification: { state: "none" },
					error: { message: error instanceof Error ? error.message : String(error), kind: "other" },
				}),
			)
			.then(result => this.#settle(entry, result));
		this.#changed();
	}

	#settle(entry: LiveRun, result: RunResult): void {
		this.#live.delete(entry.run.id);
		const cancelled = entry.controller.signal.aborted;
		const state: RunState = cancelled && result.state !== "succeeded" ? "cancelled" : result.state;
		let run: TaskRun = {
			...entry.run,
			state,
			cancelReason: state === "cancelled" ? (entry.run.cancelReason ?? "user") : undefined,
			startedAt: result.startedAt,
			endedAt: result.endedAt,
			sessionPath: result.sessionPath ?? entry.run.sessionPath,
			model: result.model,
			usage: result.usage,
			worktree: result.worktree,
			report: result.report,
			blocked: result.blocked,
			changedFiles: result.changedFiles,
			verification: result.verification,
			error: state === "succeeded" ? undefined : result.error,
			progress: undefined,
		};
		if (state !== "blocked_config" && runNeedsReview(run)) run = { ...run, review: { state: "pending" } };
		this.#save(run);

		const task = this.#deps.store.getTask(run.taskId);
		if (task && !this.#stopping) this.#afterRun(task, run);
		this.#drain();
		this.#changed();
	}

	#afterRun(task: StoredTask, run: TaskRun): void {
		const history = this.#deps.store.listRuns({ taskId: task.id, limit: 20 });
		if (run.error?.kind === "transient" && run.trigger !== "retry" && task.state === "active") {
			const timer = setTimeout(() => {
				this.#retryTimers.delete(run.id);
				const current = this.#deps.store.getTask(task.id);
				if (current && current.state === "active" && !this.#paused) this.#fire(current, "retry", null, run.id);
			}, TRANSIENT_RETRY_DELAY_MS);
			this.#retryTimers.set(run.id, timer);
		}
		if (run.error?.kind === "auth") this.#deps.notify({ kind: "auth", task: this.#present(task), run });
		const failureStreak = streakOf(history, isFailureState);
		const configStreak = streakOf(history, state => state === "blocked_config");
		if (task.state === "active" && (failureStreak >= FAILURE_STREAK || configStreak >= FAILURE_STREAK)) {
			const disabled: StoredTask = {
				...task,
				state: "disabled",
				disabledReason: failureStreak >= FAILURE_STREAK ? "failure_streak" : "blocked_config",
				updatedAt: this.#deps.now(),
			};
			this.#deps.store.saveTask(disabled);
			this.#nextFire.delete(task.id);
			this.#deps.notify({ kind: "disabled", task: this.#present(disabled), run });
			return;
		}
		if (run.error?.kind !== "auth") this.#notify(task, run);
	}

	#notify(task: StoredTask, run: TaskRun): void {
		if (shouldNotify(task.notify, run)) this.#deps.notify({ kind: "run", task: this.#present(task), run });
	}

	/** What the next run is told about the last one: its summary, suggestion, and any rejection. */
	#previousContext(taskId: string, excludeRunId: string): RunInput["previous"] {
		const last = this.#deps.store
			.listRuns({ taskId, limit: 20 })
			.find(run => run.id !== excludeRunId && run.report !== undefined);
		if (!last?.report) return null;
		return {
			summary: last.report.summary,
			next: last.report.next,
			rejectionNote: last.review.state === "rejected" ? (last.review.note ?? "No reason given.") : undefined,
		};
	}

	async #discardRunArtifacts(run: TaskRun, options: { deleteBranch: boolean }): Promise<void> {
		if (run.sessionPath) await this.#deps.cleanup.deleteSession(run.sessionPath).catch(() => {});
		if (run.worktree && !run.worktree.removed) {
			await this.#deps.cleanup.removeWorktree(run.worktree, options).catch(() => false);
		}
	}

	#enabledCount(excludeId?: string): number {
		return this.#deps.store.listTasks().filter(task => task.state === "active" && task.id !== excludeId).length;
	}

	#present(task: StoredTask): ScheduledTask {
		const next = task.state === "active" && !this.#paused ? (this.#nextFire.get(task.id) ?? null) : null;
		return { ...task, nextFireAt: next };
	}

	#save(run: TaskRun): void {
		this.#deps.store.saveRun(run);
	}

	#changed(): void {
		this.#deps.onChange();
	}
}

const dayKey = (instant: number) => {
	const date = new Date(instant);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** Aggregates for the Insights page over runs created in the period. */
export function computeInsights(
	runs: readonly TaskRun[],
	titles: ReadonlyMap<string, string>,
	periodDays: number,
	now: number,
): SchedulerInsights {
	const ran = runs.filter(run => run.state === "succeeded" || isFailureState(run.state) || run.state === "unknown");
	const succeeded = ran.filter(run => run.state === "succeeded").length;
	const failed = ran.length - succeeded;
	const verified = ran.filter(run => run.verification.state !== "none");
	const reviewed = runs.filter(run => run.review.state === "accepted" || run.review.state === "rejected");
	const durations = ran
		.map(run => (run.startedAt !== undefined && run.endedAt !== undefined ? run.endedAt - run.startedAt : null))
		.filter((value): value is number => value !== null)
		.sort((a, b) => a - b);
	const median =
		durations.length === 0
			? null
			: durations.length % 2 === 1
				? durations[(durations.length - 1) / 2]
				: (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2;

	const days = new Map<string, InsightsDay>();
	for (let offset = periodDays - 1; offset >= 0; offset--) {
		const key = dayKey(now - offset * 86_400_000);
		days.set(key, { day: key, succeeded: 0, failed: 0, quiet: 0, skipped: 0 });
	}
	for (const run of runs) {
		const bucket = days.get(dayKey(run.createdAt));
		if (!bucket) continue;
		if (run.state === "succeeded") {
			if (run.report?.status === "nothing_to_report" && run.review.state !== "pending") bucket.quiet++;
			else bucket.succeeded++;
		} else if (isFailureState(run.state) || run.state === "unknown" || run.state === "blocked_config")
			bucket.failed++;
		else if (run.state === "skipped_overlap" || run.state === "skipped_backlog" || run.state === "missed")
			bucket.skipped++;
	}

	const costs = new Map<string, { costUsd: number; runs: number }>();
	for (const run of ran) {
		const entry = costs.get(run.taskId) ?? { costUsd: 0, runs: 0 };
		entry.costUsd += run.usage?.costUsd ?? 0;
		entry.runs++;
		costs.set(run.taskId, entry);
	}

	return {
		periodDays,
		runs: ran.length,
		succeeded,
		failed,
		successRate: ran.length === 0 ? null : succeeded / ran.length,
		verificationPassRate:
			verified.length === 0
				? null
				: verified.filter(run => run.verification.state === "passed").length / verified.length,
		reviewAcceptRate:
			reviewed.length === 0
				? null
				: reviewed.filter(run => run.review.state === "accepted").length / reviewed.length,
		costUsd: [...costs.values()].reduce((sum, entry) => sum + entry.costUsd, 0),
		medianDurationMs: median,
		perDay: [...days.values()],
		costByTask: [...costs.entries()]
			.map(([taskId, entry]) => ({ taskId, title: titles.get(taskId) ?? taskId, ...entry }))
			.sort((a, b) => b.costUsd - a.costUsd),
		recentFailures: runs
			.filter(run => isFailureState(run.state) || run.state === "blocked_config" || run.state === "unknown")
			.slice(0, 20),
	};
}
