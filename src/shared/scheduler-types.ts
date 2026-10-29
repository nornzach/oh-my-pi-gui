/**
 * Scheduled tasks (plan/23): the records the main-process scheduler keeps in
 * scheduler.db and pushes to every window. Shared by main, preload and
 * renderer; nothing here touches Electron or the agent.
 */

export type TaskSchedule =
	| { kind: "once"; at: number }
	| { kind: "interval"; everyMs: number; anchor: number }
	| { kind: "cron"; expr: string; tz: string };

/**
 * How much a run may do. Every prompt inside a run is answered "no", so the
 * policy is fixed entirely by spawn flags (plan/23 §3).
 */
export type TaskToolPolicy = "read_only" | "workspace" | "full";
export type TaskNotify = "always" | "on_change" | "on_failure";
export type TaskState = "active" | "paused" | "disabled" | "archived";
export type TaskDisabledReason = "failure_streak" | "blocked_config";

/**
 * How far one run goes (see shared/task-depth.ts): `check` one pass, `goal`
 * until the work is done and checked, `research` at least `rounds` rounds,
 * each digging deeper than the last.
 */
export type TaskDepth = { kind: "check" } | { kind: "goal" } | { kind: "research"; rounds: number };

export interface TaskVerify {
	command: string;
	timeoutMs: number;
}

export interface TaskOrigin {
	sessionPath: string | null;
	createdBy: "user" | "agent";
}

/** Everything the user decides about a task; frozen per revision. */
export interface TaskConfig {
	title: string;
	prompt: string;
	cwd: string;
	schedule: TaskSchedule;
	/** Model selector the user pinned; null runs on the workspace default. */
	model: string | null;
	tools: TaskToolPolicy;
	depth: TaskDepth;
	timeoutMs: number;
	verify: TaskVerify | null;
	notify: TaskNotify;
}

export interface TaskDraft extends TaskConfig {
	origin: TaskOrigin;
	startPaused: boolean;
}

export interface ScheduledTask extends TaskConfig {
	id: string;
	revision: number;
	state: TaskState;
	disabledReason?: TaskDisabledReason;
	origin: TaskOrigin;
	createdAt: number;
	updatedAt: number;
	/** Computed by the scheduler; null when nothing will fire (paused, done, archived). */
	nextFireAt: number | null;
}

export type RunTrigger = "schedule" | "manual" | "retry";

export type RunState =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "timed_out"
	| "skipped_overlap"
	| "skipped_backlog"
	| "missed"
	| "blocked_config"
	| "unknown";

export type RunErrorKind = "transient" | "auth" | "config" | "other";

export interface RunReport {
	status: "done" | "nothing_to_report" | "blocked" | "partial";
	summary: string;
	findings: { title: string; detail?: string; severity?: "info" | "warn" | "error" }[];
	changes: { path: string; note?: string }[];
	next?: string;
}

export interface RunVerification {
	state: "none" | "passed" | "failed" | "error";
	exitCode?: number;
	outputTail?: string;
}

export interface RunReview {
	state: "none" | "pending" | "accepted" | "rejected";
	note?: string;
	at?: number;
}

export interface RunUsage {
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	turns: number;
}

export interface RunWorktree {
	path: string;
	branch: string;
	baseCwd: string;
	removed: boolean;
	/** The run's changes were committed on the branch, so removing the directory keeps them. */
	committed: boolean;
}

/** Live progress of a running run, pushed while it streams. */
export interface RunProgress {
	turns: number;
	lastTool: string | null;
	/** The round the run is in, from 1; see TaskDepth. */
	round: number;
}

export interface TaskRun {
	id: string;
	taskId: string;
	taskRevision: number;
	trigger: RunTrigger;
	scheduledFor: number | null;
	createdAt: number;
	state: RunState;
	cancelReason?: "user" | "app_quit" | "task_archived";
	startedAt?: number;
	endedAt?: number;
	sessionPath?: string;
	worktree?: RunWorktree;
	report?: RunReport;
	/** Tool calls the run asked approval for and was refused. */
	blocked: { tool: string; target?: string }[];
	/** Files the run left changed (porcelain path list), read before the run's sidecar exits. */
	changedFiles: string[];
	verification: RunVerification;
	review: RunReview;
	usage?: RunUsage;
	model?: string;
	/** Rounds the run took; absent on runs from before rounds existed. */
	rounds?: number;
	error?: { message: string; kind: RunErrorKind };
	retryOf?: string;
	progress?: RunProgress;
}

export type SchedulerHealthState = "healthy" | "paused" | "stalled";

export interface SchedulerLimits {
	minIntervalMs: number;
	maxEnabledTasks: number;
	maxConcurrentRuns: number;
	/** Unreviewed runs with changes per task before the next fire is skipped. */
	reviewBacklog: number;
	retainDays: number;
}

export interface SchedulerSnapshot {
	tasks: ScheduledTask[];
	/** Most recent runs across all tasks, newest first (bounded). */
	runs: TaskRun[];
	paused: boolean;
	health: { state: SchedulerHealthState; heartbeatAt: number | null; nextFireAt: number | null };
	limits: SchedulerLimits;
	/** Runs waiting for a person. */
	reviewCount: number;
}

export type DraftProblem =
	| "title_missing"
	| "prompt_missing"
	| "cwd_missing"
	| "schedule_invalid"
	| "schedule_in_past"
	| "too_frequent"
	| "too_many_enabled"
	| "timeout_invalid"
	| "depth_invalid"
	| "verify_invalid";

export interface InsightsDay {
	day: string;
	succeeded: number;
	failed: number;
	quiet: number;
	skipped: number;
}

export interface SchedulerInsights {
	periodDays: number;
	runs: number;
	succeeded: number;
	failed: number;
	successRate: number | null;
	verificationPassRate: number | null;
	reviewAcceptRate: number | null;
	costUsd: number;
	medianDurationMs: number | null;
	perDay: InsightsDay[];
	costByTask: { taskId: string; title: string; costUsd: number; runs: number }[];
	recentFailures: TaskRun[];
}

export type TaskSaveResult = { ok: true; task: ScheduledTask } | { ok: false; problems: DraftProblem[] };

export interface TaskRevision {
	revision: number;
	createdAt: number;
	config: TaskConfig;
}

/** Where a notification click or a link should land in the Tasks window. */
export interface SchedulerOpenTarget {
	view?: "tasks" | "runs" | "review" | "insights";
	taskId?: string;
	runId?: string;
}
