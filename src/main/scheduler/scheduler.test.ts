/**
 * Scheduler lifecycle against a real scheduler.db and fake timers: when runs
 * fire, what the ledger records when they can't, and when a task switches
 * itself off. The runner is scripted, so each test decides how runs end.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextFireAfter } from "../../shared/schedule";
import type { RunWorktree, TaskDraft, TaskRun } from "../../shared/scheduler-types";
import type { RunInput, RunResult } from "./runner";
import { computeInsights, MISSED_GRACE_MS, Scheduler, type SchedulerNotice } from "./scheduler";
import { SchedulerStore, type StoredTask } from "./store";

const T0 = Date.parse("2026-10-26T08:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

interface Pending {
	input: RunInput;
	resolve(result: Partial<RunResult>): void;
}

let dir: string;
let store: SchedulerStore;
let pending: Pending[];
let notices: SchedulerNotice[];
let removed: { worktree: RunWorktree; deleteBranch: boolean }[];
let deletedSessions: string[];
let ids: number;

function makeScheduler(): Scheduler {
	return new Scheduler({
		store,
		now: () => Date.now(),
		nextId: () => `id-${String(++ids).padStart(4, "0")}`,
		runner: input => {
			const { promise, resolve } = Promise.withResolvers<RunResult>();
			pending.push({
				input,
				resolve: result =>
					resolve({
						state: "succeeded",
						startedAt: Date.now(),
						endedAt: Date.now(),
						blocked: [],
						changedFiles: [],
						verification: { state: "none" },
						...result,
					}),
			});
			return promise;
		},
		cleanup: {
			removeWorktree: async (worktree, options) => {
				removed.push({ worktree, deleteBranch: options.deleteBranch });
				return true;
			},
			deleteSession: async sessionPath => {
				deletedSessions.push(sessionPath);
			},
		},
		notify: notice => notices.push(notice),
		onChange: () => {},
		onProgress: () => {},
	});
}

const draft = (overrides: Partial<TaskDraft> = {}): TaskDraft => ({
	title: "Morning check",
	prompt: "Check the dashboard.",
	cwd: "/work",
	schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
	model: null,
	tools: "read_only",
	depth: { kind: "goal" },
	timeoutMs: 30 * MINUTE,
	verify: null,
	notify: "on_change",
	origin: { sessionPath: null, createdBy: "user" },
	startPaused: false,
	...overrides,
});

const runsOf = (taskId: string) => store.listRuns({ taskId });
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-sched-"));
	store = new SchedulerStore(path.join(dir, "scheduler.db"));
	pending = [];
	notices = [];
	removed = [];
	deletedSessions = [];
	ids = 0;
});

afterEach(() => {
	vi.useRealTimers();
	store.close();
	fs.rmSync(dir, { recursive: true, force: true });
});

function created(scheduler: Scheduler, overrides: Partial<TaskDraft> = {}) {
	const result = scheduler.createTask(draft(overrides));
	if (!result.ok) throw new Error(result.problems.join(","));
	return result.task;
}

describe("the clock", () => {
	it("fires at the slot, records it, and moves to the next slot", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler);
		expect(task.nextFireAt).toBe(Date.parse("2026-10-26T09:00:00Z"));

		await vi.advanceTimersByTimeAsync(HOUR);
		expect(pending).toHaveLength(1);
		expect(runsOf(task.id)[0]).toMatchObject({
			state: "running",
			trigger: "schedule",
			scheduledFor: task.nextFireAt,
		});
		pending[0].resolve({ report: { status: "done", summary: "ok", findings: [], changes: [] } });
		await settle();
		expect(runsOf(task.id)[0].state).toBe("succeeded");
		expect(scheduler.snapshot().tasks[0].nextFireAt).toBe(Date.parse("2026-10-27T09:00:00Z"));
	});

	it("records one missed run for slots that passed while the app was closed, and never replays them", async () => {
		const first = makeScheduler();
		first.start();
		const task = created(first, { schedule: { kind: "cron", expr: "0 * * * *", tz: "UTC" } });
		await first.stop();

		// The app comes back five hours later.
		vi.setSystemTime(T0 + 5 * HOUR + 30 * MINUTE);
		const second = makeScheduler();
		second.start();
		await settle();
		const runs = runsOf(task.id);
		expect(runs.map(run => run.state)).toEqual(["missed"]);
		expect(runs[0].scheduledFor).toBe(T0 + 5 * HOUR);
		expect(pending).toHaveLength(0);
		expect(second.snapshot().tasks[0].nextFireAt).toBe(T0 + 6 * HOUR);
	});

	it("records a slot the machine slept through as missed instead of running it late", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler, { schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" } });
		// Timers did not run while asleep; the clock jumps past the slot.
		vi.setSystemTime(Date.parse("2026-10-26T09:00:00Z") + MISSED_GRACE_MS + MINUTE);
		scheduler.wake();
		await settle();
		expect(runsOf(task.id).map(run => run.state)).toEqual(["missed"]);
		expect(pending).toHaveLength(0);
	});

	it("runs a slot the machine woke within the grace window of, after recording the older one as missed", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler, { schedule: { kind: "cron", expr: "0 * * * *", tz: "UTC" } });
		// Asleep from 08:30 through 09:00; the lid opens a minute after 10:00.
		vi.setSystemTime(T0 + 2 * HOUR + MINUTE);
		scheduler.wake();
		await settle();
		expect(runsOf(task.id).map(run => [run.state, run.scheduledFor])).toEqual([
			["running", T0 + 2 * HOUR],
			["missed", T0 + HOUR],
		]);
	});

	it.each([
		["a minute", MINUTE],
		["forty minutes", 40 * MINUTE],
	])("does not run or record a slot again when omp relaunches %s after it fired", async (_label, away) => {
		vi.setSystemTime(T0 + 15_000);
		const first = makeScheduler();
		first.start();
		const task = created(first, { schedule: { kind: "cron", expr: "0 * * * *", tz: "UTC" } });
		// Heartbeats land at :15 and :45; the 09:00 run ends and omp quits at 09:00:05, before the next beat.
		await vi.advanceTimersByTimeAsync(HOUR - 10_000);
		pending[0].resolve({});
		await settle();
		await first.stop();

		vi.setSystemTime(Date.now() + away);
		const next = makeScheduler();
		next.start();
		await settle();
		const stopping = next.stop();
		for (const run of pending.slice(1)) run.resolve({});
		await stopping;
		expect(runsOf(task.id).map(run => [run.state, run.scheduledFor])).toEqual([["succeeded", T0 + HOUR]]);
	});

	it("does not fire while paused, and resuming does not replay the paused slots", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler, { schedule: { kind: "cron", expr: "0 * * * *", tz: "UTC" } });
		scheduler.setPaused(true);
		await vi.advanceTimersByTimeAsync(3 * HOUR);
		expect(runsOf(task.id)).toHaveLength(0);
		scheduler.setPaused(false);
		await settle();
		expect(pending).toHaveLength(0);
		expect(scheduler.snapshot().tasks[0].nextFireAt).toBe(T0 + 4 * HOUR);
	});

	it("marks runs a crashed process left running as unknown", async () => {
		const first = makeScheduler();
		first.start();
		const task = created(first);
		first.runNow(task.id);
		await settle();
		// No stop(): the process died with the run live.
		const second = makeScheduler();
		second.start();
		expect(runsOf(task.id)[0]).toMatchObject({ state: "unknown" });
	});

	it("records a run live at quit as cancelled before it settles, so the next launch does not call it unknown", async () => {
		const first = makeScheduler();
		first.start();
		const task = created(first);
		first.runNow(task.id);
		await settle();
		// Quit teardown does not wait: the runner never settles in this process.
		void first.stop();
		const second = makeScheduler();
		second.start();
		expect(runsOf(task.id)[0]).toMatchObject({ state: "cancelled", cancelReason: "app_quit" });
	});
});

describe("task state", () => {
	it("restores an archived task paused, and refuses to resume it straight from the archive", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler);
		scheduler.archiveTask(task.id, false);
		expect(scheduler.setTaskEnabled(task.id, true)).toEqual({ ok: false, problems: ["schedule_invalid"] });
		const restored = scheduler.setTaskEnabled(task.id, false);
		expect(restored.ok && restored.task).toMatchObject({ state: "paused", nextFireAt: null });
		await vi.advanceTimersByTimeAsync(2 * HOUR);
		expect(pending).toHaveLength(0);
	});

	it("runs a task saved before runs had a depth as a goal", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler);
		const { depth: _dropped, ...older } = store.getTask(task.id) as StoredTask;
		store.saveTask({ ...(older as StoredTask), revision: task.revision + 1 });

		expect(scheduler.getTask(task.id)?.depth).toEqual({ kind: "goal" });
		scheduler.runNow(task.id);
		await settle();
		expect(pending[0].input.config.depth).toEqual({ kind: "goal" });
	});
});

describe("dispatch", () => {
	it("skips a fire while the task's previous run is still going", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler);
		scheduler.runNow(task.id);
		const second = scheduler.runNow(task.id);
		expect(second?.state).toBe("skipped_overlap");
		expect(pending).toHaveLength(1);
	});

	it("queues runs past the concurrency limit and starts them as slots free up", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const a = created(scheduler, { title: "A" });
		const b = created(scheduler, { title: "B" });
		scheduler.runNow(a.id);
		scheduler.runNow(b.id);
		expect(pending).toHaveLength(1);
		expect(runsOf(b.id)[0].state).toBe("queued");
		pending[0].resolve({});
		await settle();
		expect(pending).toHaveLength(2);
		expect(pending[1].input.config.title).toBe("B");
	});

	it("skips scheduled fires while five changed runs wait for review, but still runs on request", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler, {
			tools: "workspace",
			schedule: { kind: "interval", everyMs: 10 * MINUTE, anchor: T0 + 10 * MINUTE },
		});
		for (let index = 0; index < 5; index++) {
			await vi.advanceTimersByTimeAsync(10 * MINUTE);
			pending[index].resolve({ changedFiles: ["src/a.ts"] });
			await settle();
		}
		expect(runsOf(task.id).filter(run => run.review.state === "pending")).toHaveLength(5);
		await vi.advanceTimersByTimeAsync(10 * MINUTE);
		expect(runsOf(task.id)[0].state).toBe("skipped_backlog");
		expect(scheduler.runNow(task.id)?.state).toBe("queued");
	});
});

describe("failures", () => {
	it("switches a task off after three failed runs in a row; a skip in between does not reset the streak", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler);
		const fail = async () => {
			pending[pending.length - 1].resolve({ state: "failed", error: { message: "boom", kind: "other" } });
			await settle();
		};
		scheduler.runNow(task.id);
		await fail();
		scheduler.runNow(task.id);
		expect(scheduler.runNow(task.id)?.state).toBe("skipped_overlap");
		await fail();
		expect(scheduler.snapshot().tasks[0].state).toBe("active");
		scheduler.runNow(task.id);
		await fail();
		expect(scheduler.snapshot().tasks[0]).toMatchObject({
			state: "disabled",
			disabledReason: "failure_streak",
			nextFireAt: null,
		});
		expect(notices.filter(notice => notice.kind === "disabled")).toHaveLength(1);
	});

	it("retries a transient failure once after ten minutes, and never retries the retry", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler);
		const first = scheduler.runNow(task.id);
		pending[0].resolve({ state: "failed", error: { message: "429", kind: "transient" } });
		await settle();
		await vi.advanceTimersByTimeAsync(10 * MINUTE);
		expect(pending).toHaveLength(2);
		const retry = runsOf(task.id)[0];
		expect(retry).toMatchObject({ trigger: "retry", retryOf: first?.id });
		pending[1].resolve({ state: "failed", error: { message: "429", kind: "transient" } });
		await settle();
		await vi.advanceTimersByTimeAsync(30 * MINUTE);
		expect(pending).toHaveLength(2);
	});

	it("does not retry a sign-in failure and says to sign in", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler);
		scheduler.runNow(task.id);
		pending[0].resolve({ state: "failed", error: { message: "401", kind: "auth" } });
		await settle();
		// Past the retry delay, short of the 09:00 slot.
		await vi.advanceTimersByTimeAsync(30 * MINUTE);
		expect(pending).toHaveLength(1);
		expect(notices.map(notice => notice.kind)).toEqual(["auth"]);
	});
});

describe("review", () => {
	const worktree: RunWorktree = {
		path: "/wt/1",
		branch: "omp/gui/task-1",
		baseCwd: "/work",
		removed: false,
		committed: true,
	};

	it("removes a rejected run's worktree and branch, and tells the next run why", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler, { tools: "workspace" });
		scheduler.runNow(task.id);
		pending[0].resolve({
			changedFiles: ["a.ts"],
			worktree,
			report: {
				status: "done",
				summary: "Rewrote the parser.",
				findings: [],
				changes: [],
				next: "Run the slow tests.",
			},
		});
		await settle();
		const run = runsOf(task.id)[0];
		expect(run.review.state).toBe("pending");

		const reviewed = await scheduler.review(run.id, "rejected", "Too broad; keep the old API.");
		expect(reviewed?.worktree?.removed).toBe(true);
		expect(removed).toEqual([{ worktree, deleteBranch: true }]);

		scheduler.runNow(task.id);
		expect(pending[1].input.previous).toEqual({
			summary: "Rewrote the parser.",
			next: "Run the slow tests.",
			rejectionNote: "Too broad; keep the old API.",
		});
	});

	it("leaves a quiet clean run out of review and out of notifications", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler);
		scheduler.runNow(task.id);
		pending[0].resolve({
			report: { status: "nothing_to_report", summary: "Nothing new.", findings: [], changes: [] },
		});
		await settle();
		expect(runsOf(task.id)[0].review.state).toBe("none");
		expect(notices).toEqual([]);
	});
});

describe("validation", () => {
	it("refuses schedules under the floor and enabled tasks past the cap", () => {
		const scheduler = makeScheduler();
		scheduler.start();
		expect(scheduler.createTask(draft({ schedule: { kind: "cron", expr: "* * * * *", tz: "UTC" } }))).toEqual({
			ok: false,
			problems: ["too_frequent"],
		});
		for (let index = 0; index < 20; index++) created(scheduler, { title: `T${index}` });
		expect(scheduler.createTask(draft({ title: "One more" }))).toEqual({ ok: false, problems: ["too_many_enabled"] });
		expect(scheduler.createTask(draft({ title: "Paused one", startPaused: true })).ok).toBe(true);
	});
});

describe("housekeeping", () => {
	it("drops runs past retention with their sessions, but keeps pending reviews and each task's latest run", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler);
		const base = {
			taskId: task.id,
			taskRevision: 1,
			trigger: "schedule" as const,
			scheduledFor: null,
			blocked: [],
			changedFiles: [],
			verification: { state: "none" as const },
		};
		const old = T0 - 100 * 86_400_000;
		const runs: TaskRun[] = [
			{
				...base,
				id: "old-done",
				createdAt: old,
				state: "succeeded",
				sessionPath: "/s/old.jsonl",
				review: { state: "none" },
			},
			{
				...base,
				id: "old-pending",
				createdAt: old + 1,
				state: "succeeded",
				sessionPath: "/s/p.jsonl",
				review: { state: "pending" },
			},
			{
				...base,
				id: "old-latest",
				createdAt: old + 2,
				state: "succeeded",
				sessionPath: "/s/l.jsonl",
				review: { state: "none" },
			},
		];
		for (const run of runs) store.saveRun(run);
		await scheduler.sweep();
		expect(store.getRun("old-done")).toBeNull();
		expect(deletedSessions).toEqual(["/s/old.jsonl"]);
		expect(store.getRun("old-pending")).not.toBeNull();
		expect(store.getRun("old-latest")).not.toBeNull();
	});

	it("removes a worktree left unreviewed for two weeks but keeps its branch", async () => {
		const scheduler = makeScheduler();
		scheduler.start();
		const task = created(scheduler, { tools: "workspace" });
		const worktree: RunWorktree = {
			path: "/wt/old",
			branch: "omp/gui/task-old",
			baseCwd: "/work",
			removed: false,
			committed: true,
		};
		store.saveRun({
			id: "stale",
			taskId: task.id,
			taskRevision: 1,
			trigger: "schedule",
			scheduledFor: null,
			createdAt: T0 - 15 * 86_400_000,
			endedAt: T0 - 15 * 86_400_000,
			state: "succeeded",
			blocked: [],
			changedFiles: ["a.ts"],
			verification: { state: "none" },
			review: { state: "pending" },
			worktree,
		});
		await scheduler.sweep();
		expect(removed).toEqual([{ worktree, deleteBranch: false }]);
		expect(store.getRun("stale")?.worktree?.removed).toBe(true);
		expect(store.getRun("stale")?.review.state).toBe("pending");
	});
});

describe("insights", () => {
	it("rates only runs that ran, buckets quiet runs apart, and ranks cost by task", () => {
		const day = Date.parse("2026-10-25T12:00:00Z");
		const run = (id: string, taskId: string, state: TaskRun["state"], extra: Partial<TaskRun> = {}): TaskRun => ({
			id,
			taskId,
			taskRevision: 1,
			trigger: "schedule",
			scheduledFor: null,
			createdAt: day,
			startedAt: day,
			endedAt: day + 60_000,
			state,
			blocked: [],
			changedFiles: [],
			verification: { state: "none" },
			review: { state: "none" },
			...extra,
		});
		const insights = computeInsights(
			[
				run("1", "a", "succeeded", { usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.5, turns: 1 } }),
				run("2", "a", "succeeded", {
					report: { status: "nothing_to_report", summary: "", findings: [], changes: [] },
				}),
				run("3", "b", "failed", { usage: { inputTokens: 1, outputTokens: 1, costUsd: 1.25, turns: 1 } }),
				run("4", "b", "skipped_overlap"),
				run("5", "b", "missed"),
				run("6", "a", "succeeded", { verification: { state: "failed" }, review: { state: "rejected" } }),
			],
			new Map([
				["a", "Alpha"],
				["b", "Beta"],
			]),
			7,
			day,
		);
		expect(insights).toMatchObject({
			runs: 4,
			succeeded: 3,
			failed: 1,
			successRate: 0.75,
			verificationPassRate: 0,
			reviewAcceptRate: 0,
		});
		expect(insights.costByTask.map(entry => [entry.title, entry.costUsd])).toEqual([
			["Beta", 1.25],
			["Alpha", 0.5],
		]);
		expect(insights.perDay.at(-1)).toMatchObject({ succeeded: 2, quiet: 1, failed: 1, skipped: 2 });
		expect(insights.recentFailures.map(entry => entry.id)).toEqual(["3"]);
	});
});

describe("a month of operation", () => {
	// Seeded, so a failure replays exactly.
	function random(seed: number): () => number {
		let state = seed;
		return () => {
			state = (state + 0x6d2b79f5) | 0;
			let t = Math.imul(state ^ (state >>> 15), 1 | state);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
		};
	}

	it("accounts for every slot exactly once through sleeps, relaunches and a DST change", async () => {
		const rand = random(20_261_026);
		const end = T0 + 30 * 24 * HOUR;
		let scheduler = makeScheduler();
		scheduler.start();
		const tasks = [
			created(scheduler, { schedule: { kind: "cron", expr: "0 * * * *", tz: "UTC" } }),
			created(scheduler, { schedule: { kind: "cron", expr: "30 9 * * *", tz: "America/New_York" } }),
			created(scheduler, { schedule: { kind: "interval", everyMs: 45 * MINUTE, anchor: T0 + 10 * MINUTE } }),
			// 01:15 happens twice on 2026-11-01 in New York; it runs once.
			created(scheduler, { schedule: { kind: "cron", expr: "15 1 * * *", tz: "America/New_York" } }),
		];
		let resolved = 0;
		const finishRuns = async () => {
			// A finished run can start a queued one, so drain until nothing new starts.
			while (resolved < pending.length) {
				pending[resolved++].resolve({});
				await settle();
			}
		};
		// Stretches with no timers running, as (went away, came back].
		const gaps: [number, number][] = [];
		let restarts = 0;
		while (Date.now() < end) {
			const roll = rand();
			if (roll < 0.02) {
				const from = Date.now();
				vi.setSystemTime(from + 10 * MINUTE + Math.floor(rand() * 8 * HOUR));
				gaps.push([from, Date.now()]);
				scheduler.wake();
			} else if (roll < 0.04) {
				if (rand() < 0.5) {
					// Quit right after a run, the moment people tend to.
					const due = Math.min(...tasks.map(task => nextFireAfter(task.schedule, Date.now()) ?? end));
					await vi.advanceTimersByTimeAsync(due - Date.now() + Math.floor(rand() * 25_000));
					await finishRuns();
				}
				await scheduler.stop();
				const from = Date.now();
				const away = rand() < 0.5 ? 30_000 + Math.floor(rand() * 3 * MINUTE) : Math.floor(rand() * 12 * HOUR);
				vi.setSystemTime(from + away);
				gaps.push([from, Date.now()]);
				scheduler = makeScheduler();
				scheduler.start();
				restarts++;
			} else {
				await vi.advanceTimersByTimeAsync(5 * MINUTE + Math.floor(rand() * 5 * MINUTE));
			}
			await settle();
			await finishRuns();
		}
		await scheduler.stop();
		expect(restarts).toBeGreaterThan(40);

		const tooLate = (slot: number) => gaps.findIndex(([from, to]) => slot > from && slot <= to - MISSED_GRACE_MS);
		let fired = 0;
		let missed = 0;
		for (const task of tasks) {
			const slots: number[] = [];
			for (let at = nextFireAfter(task.schedule, T0); at !== null && at <= Date.now(); ) {
				slots.push(at);
				at = nextFireAfter(task.schedule, at);
			}
			const runs = store.listRuns({ taskId: task.id, limit: 100_000 });
			const bySlot = new Map(runs.map(run => [run.scheduledFor, run]));
			expect(bySlot.size).toBe(runs.length);
			expect(runs.every(run => run.scheduledFor !== null && slots.includes(run.scheduledFor))).toBe(true);
			const missedIn = new Map<number, number>();
			for (const slot of slots) {
				const gap = tooLate(slot);
				const run = bySlot.get(slot);
				if (gap === -1) {
					// Reached in time: run once, on time.
					expect(run?.state).toBe("succeeded");
					expect(run && run.createdAt - slot).toBeLessThanOrEqual(MISSED_GRACE_MS);
					expect(run && run.createdAt - slot).toBeGreaterThanOrEqual(0);
					fired++;
				} else if (run) {
					expect(run.state).toBe("missed");
					missedIn.set(gap, (missedIn.get(gap) ?? 0) + 1);
				}
			}
			const gapsWithSlots = new Set(slots.map(tooLate).filter(gap => gap !== -1));
			expect([...gapsWithSlots].map(gap => missedIn.get(gap))).toEqual([...gapsWithSlots].map(() => 1));
			missed += gapsWithSlots.size;
		}
		const repeated = tasks[3];
		expect(
			store
				.listRuns({ taskId: repeated.id, limit: 100_000 })
				.some(run => run.scheduledFor === Date.parse("2026-11-01T06:15:00Z")),
		).toBe(false);
		expect(fired).toBeGreaterThan(600);
		expect(missed).toBeGreaterThan(150);
	}, 120_000);
});
