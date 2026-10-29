/**
 * The scheduler's rules as pure functions: what a run may do (spawn flags),
 * what counts as a failure, when a run needs a person, when a task switches
 * itself off, and whether a draft can be saved. Electron-free so every rule
 * is unit-tested without a clock or a sidecar.
 */

import { scheduleProblem } from "../../shared/schedule";
import type {
	DraftProblem,
	RunErrorKind,
	RunReport,
	RunState,
	SchedulerLimits,
	TaskDepth,
	TaskDraft,
	TaskNotify,
	TaskRun,
	TaskToolPolicy,
} from "../../shared/scheduler-types";
import { depthIsValid } from "../../shared/task-depth";

export const DEFAULT_LIMITS: SchedulerLimits = {
	minIntervalMs: 5 * 60_000,
	maxEnabledTasks: 20,
	maxConcurrentRuns: 1,
	reviewBacklog: 5,
	retainDays: 90,
};

export const DEFAULT_TIMEOUT_MS = 30 * 60_000;
export const MAX_TIMEOUT_MS = 6 * 3_600_000;
export const FAILURE_STREAK = 3;
export const TRANSIENT_RETRY_DELAY_MS = 10 * 60_000;
export const UNREVIEWED_WORKTREE_MAX_AGE_MS = 14 * 86_400_000;

/**
 * Search and read tools only: nothing in this set writes or executes. omp
 * refuses to start when `--tools` names a tool its settings turn off, so the
 * list holds only tools that are on by default; `ast_grep` joins on its own
 * when the user enabled it, because `grep` is listed. `find` stays out: it is
 * on only where a judge model is configured.
 */
export const READ_ONLY_TOOLS = ["read", "glob", "grep", "lsp", "web_search", "todo"];

/** omp's exit code for a rejected command line (a bad flag or tool list). */
const USAGE_EXIT = /^Exit code 2\b/;

/**
 * A run whose agent never started: a rejected command line fails the same way
 * on every retry, so it is a setup problem; anything else may pass next time.
 */
export function startupFailure(message: string): { state: "failed" | "blocked_config"; kind: RunErrorKind } {
	return USAGE_EXIT.test(message)
		? { state: "blocked_config", kind: "config" }
		: { state: "failed", kind: "transient" };
}

/**
 * Flags a launch profile may not set on a run sidecar, on top of the tab
 * denylist: each one could widen what an unattended run is allowed to do.
 */
export const RUN_DENIED_FLAGS: Record<string, true> = {
	"--approval-mode": true,
	"--yolo": true,
	"--auto-approve": true,
	"--plan-yolo": true,
	"--tools": true,
	"--no-tools": true,
	"--model": true,
	"--continue": true,
};

/** The denied flags above that take a separate value token. */
export const RUN_DENIED_FLAGS_WITH_VALUE: Record<string, true> = {
	"--approval-mode": true,
	"--tools": true,
	"--model": true,
};

/** Code-controlled argv for a run: the tool policy and the user's model pin. */
export function runPolicyFlags(policy: TaskToolPolicy, model: string | null): string[] {
	const flags: string[] = [];
	switch (policy) {
		case "read_only":
			flags.push("--approval-mode", "always-ask", "--tools", READ_ONLY_TOOLS.join(","));
			break;
		case "workspace":
			flags.push("--approval-mode", "write");
			break;
		case "full":
			flags.push("--approval-mode", "yolo");
			break;
	}
	if (model) flags.push("--model", model);
	return flags;
}

/** Policies that edit files always run in a fresh worktree. */
export function policyUsesWorktree(policy: TaskToolPolicy): boolean {
	return policy !== "read_only";
}

export interface ErrorFacts {
	message: string;
	httpStatus?: number;
	retryable?: boolean;
}

const AUTH_PATTERN =
	/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid api key|api key (is )?(missing|invalid)|not logged in|log ?in again|oauth|token (has )?expired|expired token|credentials/i;
const TRANSIENT_PATTERN =
	/\b(429|500|502|503|504|529)\b|rate.?limit|overloaded|timed? ?out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network/i;

/** Auth failures never retry (signing in is the fix); transient ones retry once. */
export function classifyRunError(error: ErrorFacts): RunErrorKind {
	const status = error.httpStatus;
	if (status === 401 || status === 403) return "auth";
	if (status !== undefined && (status === 408 || status === 425 || status === 429 || status >= 500))
		return "transient";
	if (AUTH_PATTERN.test(error.message)) return "auth";
	if (error.retryable === true || TRANSIENT_PATTERN.test(error.message)) return "transient";
	return "other";
}

const FINAL_STATES: ReadonlySet<RunState> = new Set([
	"succeeded",
	"failed",
	"cancelled",
	"timed_out",
	"skipped_overlap",
	"skipped_backlog",
	"missed",
	"blocked_config",
	"unknown",
]);

export function isFinalState(state: RunState): boolean {
	return FINAL_STATES.has(state);
}

export function isFailureState(state: RunState): boolean {
	return state === "failed" || state === "timed_out";
}

/** The most rounds one run takes, whatever its depth. */
export const MAX_RUN_ROUNDS = 8;
/** Time a round needs left on the run's limit to be worth starting. */
export const MIN_ROUND_MS = 2 * 60_000;

/**
 * Why a run starts another round: to dig deeper into research, to carry on
 * with unfinished work, or to file the report the agent skipped.
 */
export type NextRound = "deeper" | "continue" | "report";

/**
 * Whether a run goes on after a round, judged from what the agent reported
 * for it: `partial` means it has more it can do now. Research takes its
 * rounds whatever the report says, a goal goes on while the work is
 * partial, and a check only to get a report it skipped. A round that used
 * no tool made no progress and ends the run, as do a blocked or empty
 * report and the round cap.
 */
export function nextRound(
	depth: TaskDepth,
	round: number,
	ended: { report: RunReport | null; progressed: boolean },
): NextRound | null {
	if (round >= MAX_RUN_ROUNDS || !ended.progressed) return null;
	const status = ended.report?.status;
	if (status === "blocked" || status === "nothing_to_report") return null;
	if (depth.kind === "research" && round < depth.rounds) return "deeper";
	if (!ended.report) return "report";
	if (status !== "partial" || depth.kind === "check") return null;
	return depth.kind === "research" ? "deeper" : "continue";
}

/** A run left work a person has to look at. */
export function runNeedsReview(run: Pick<TaskRun, "changedFiles" | "report" | "verification" | "blocked">): boolean {
	if (run.changedFiles.length > 0) return true;
	if ((run.report?.changes.length ?? 0) > 0) return true;
	if (run.verification.state === "failed" || run.verification.state === "error") return true;
	if (run.report?.status === "partial" || run.report?.status === "blocked") return true;
	return run.blocked.length > 0;
}

/**
 * Consecutive runs, newest first, that ended in `match`. Skips, misses,
 * cancellations and retries neither extend nor break the streak: only a
 * scheduled or manual attempt that ran says anything about the task.
 */
export function streakOf(runsNewestFirst: readonly TaskRun[], match: (state: RunState) => boolean): number {
	let streak = 0;
	for (const run of runsNewestFirst) {
		if (run.trigger === "retry") continue;
		if (
			run.state === "skipped_overlap" ||
			run.state === "skipped_backlog" ||
			run.state === "missed" ||
			run.state === "cancelled" ||
			!isFinalState(run.state)
		) {
			continue;
		}
		if (!match(run.state)) break;
		streak++;
	}
	return streak;
}

/** Whether a finished run should raise a notification under the task's notify mode. */
export function shouldNotify(notify: TaskNotify, run: TaskRun): boolean {
	if (run.state === "skipped_overlap" || run.state === "skipped_backlog" || run.state === "cancelled") return false;
	const failed =
		isFailureState(run.state) ||
		run.state === "blocked_config" ||
		run.state === "unknown" ||
		run.verification.state === "failed" ||
		run.verification.state === "error";
	if (notify === "on_failure") return failed;
	if (notify === "always") return run.state !== "missed";
	// on_change: everything except a quiet, clean run.
	if (failed) return true;
	if (run.state === "missed") return false;
	return run.review.state === "pending" || run.report?.status !== "nothing_to_report";
}

export interface DraftContext {
	now: number;
	limits: SchedulerLimits;
	/** Enabled tasks other than the one being edited. */
	enabledOthers: number;
	/** The draft would be enabled once saved. */
	willBeEnabled: boolean;
}

export function draftProblems(draft: TaskDraft, context: DraftContext): DraftProblem[] {
	const problems: DraftProblem[] = [];
	if (draft.title.trim() === "") problems.push("title_missing");
	if (draft.prompt.trim() === "") problems.push("prompt_missing");
	if (draft.cwd.trim() === "") problems.push("cwd_missing");
	const schedule = scheduleProblem(draft.schedule, context.now, context.limits.minIntervalMs);
	if (schedule) problems.push(schedule);
	if (context.willBeEnabled && context.enabledOthers >= context.limits.maxEnabledTasks) {
		problems.push("too_many_enabled");
	}
	if (!(draft.timeoutMs >= 60_000 && draft.timeoutMs <= MAX_TIMEOUT_MS)) problems.push("timeout_invalid");
	if (!depthIsValid(draft.depth)) problems.push("depth_invalid");
	if (draft.verify && (draft.verify.command.trim() === "" || !(draft.verify.timeoutMs >= 1_000))) {
		problems.push("verify_invalid");
	}
	return problems;
}

/** POSIX single-quote a shell word. */
export function shellQuote(word: string): string {
	return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Last `maxLines` lines of command output, for the run page. */
export function outputTail(output: string, maxLines = 40, maxChars = 4000): string {
	const lines = output.replace(/\r\n/g, "\n").trimEnd().split("\n");
	const tail = lines.slice(-maxLines).join("\n");
	return tail.length > maxChars ? tail.slice(-maxChars) : tail;
}

/** Worktree names must be [a-z0-9-], ≤41 chars, starting alphanumeric (agent rule). */
export function worktreeNameFor(title: string, runId: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 20)
		.replace(/-+$/g, "");
	const suffix = runId.slice(-8);
	return slug ? `task-${slug}-${suffix}` : `task-${suffix}`;
}
