/**
 * Display helpers shared by the Tasks window: schedule wording, run-state
 * badges, relative times. Pure functions over the shared scheduler records.
 */

import { languageDetails } from "../../../shared/languages";
import { describeSchedule, nextFires } from "../../../shared/schedule";
import type { RunState, TaskDepth, TaskDraft, TaskRun, TaskSchedule, TaskState } from "../../../shared/scheduler-types";
import { DEFAULT_TASK_DEPTH } from "../../../shared/task-depth";
import { formatClock } from "../../lib/format";
import { getCurrentLanguage } from "../../lib/i18n";
import type { BadgeVariant } from "../common";

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export const DEFAULT_TASK_TIMEOUT_MS = 30 * 60_000;

export function weekdayName(weekday: number): string {
	// 2026-10-04 is a Sunday; cron weekday 0 and 7 both mean Sunday.
	const date = new Date(2026, 9, 4 + (weekday % 7));
	return date.toLocaleDateString(languageDetails(getCurrentLanguage()).locale, { weekday: "long" });
}

/** How far each run goes: "Check", "Goal", or "Research, 3 rounds". */
export function depthLabel(t: Translate, depth: TaskDepth): string {
	return depth.kind === "research"
		? t("tasks.depth.researchRounds", { rounds: depth.rounds })
		: t(`tasks.depth.${depth.kind}`);
}

/** A time limit in the whole minutes the form takes: "45m", or "2h" on the hour. */
export function timeLimitLabel(t: Translate, ms: number): string {
	const minutes = Math.round(ms / 60_000);
	return minutes % 60 === 0
		? t("time.hoursShort", { count: minutes / 60 })
		: t("time.minutesShort", { count: minutes });
}

export function scheduleLabel(t: Translate, schedule: TaskSchedule): string {
	const { key, params } = describeSchedule(schedule);
	if (key === "once") return t("tasks.schedule.once", { at: formatClock(Number(params.at)) });
	if (key === "cron.weekly")
		return t("tasks.schedule.cron.weekly", { ...params, weekday: weekdayName(Number(params.weekday)) });
	return t(`tasks.schedule.${key}`, params);
}

/** "in 5 min" / "in 3 h" / "in 2 d", for the next fire. */
export function untilLabel(t: Translate, at: number, now = Date.now()): string {
	const ms = at - now;
	if (ms < 60_000) return t("tasks.when.soon");
	if (ms < 3_600_000) return t("tasks.when.minutes", { count: Math.round(ms / 60_000) });
	if (ms < 86_400_000) return t("tasks.when.hours", { count: Math.round(ms / 3_600_000) });
	return t("tasks.when.days", { count: Math.round(ms / 86_400_000) });
}

export function upcoming(schedule: TaskSchedule, count = 3, now = Date.now()): number[] {
	return nextFires(schedule, now, count);
}

export const RUN_STATE_VARIANT: Record<RunState, BadgeVariant> = {
	queued: "muted",
	running: "info",
	succeeded: "success",
	failed: "error",
	cancelled: "muted",
	timed_out: "error",
	skipped_overlap: "muted",
	skipped_backlog: "warning",
	missed: "warning",
	blocked_config: "error",
	unknown: "warning",
};

/** The one-word outcome a person cares about, combining state, review and verification. */
export function runOutcome(run: TaskRun): { key: string; variant: BadgeVariant } {
	if (run.state === "succeeded") {
		if (run.verification.state === "failed" || run.verification.state === "error") {
			return { key: "tasks.run.outcome.verifyFailed", variant: "error" };
		}
		if (run.review.state === "pending") return { key: "tasks.run.outcome.needsReview", variant: "warning" };
		if (run.review.state === "accepted") return { key: "tasks.run.outcome.accepted", variant: "success" };
		if (run.review.state === "rejected") return { key: "tasks.run.outcome.rejected", variant: "muted" };
		if (run.report?.status === "nothing_to_report") return { key: "tasks.run.outcome.quiet", variant: "muted" };
	}
	if (run.review.state === "pending") return { key: "tasks.run.outcome.needsReview", variant: "warning" };
	return { key: `tasks.run.state.${run.state}`, variant: RUN_STATE_VARIANT[run.state] };
}

/** Color of one square in a task's recent-runs strip. */
export function runDotClass(run: TaskRun): string {
	const { variant } = runOutcome(run);
	switch (variant) {
		case "success":
			return "bg-(--omp-success)";
		case "error":
			return "bg-(--omp-error)";
		case "warning":
			return "bg-(--omp-warning)";
		case "info":
			return "bg-(--omp-link)";
		default:
			return "bg-(--omp-border-strong)";
	}
}

export const TASK_STATE_VARIANT: Record<TaskState, BadgeVariant> = {
	active: "success",
	paused: "muted",
	disabled: "error",
	archived: "muted",
};

export function runDuration(run: TaskRun): number | null {
	if (run.startedAt === undefined) return null;
	return (run.endedAt ?? Date.now()) - run.startedAt;
}

export function blankDraft(cwd: string): TaskDraft {
	return {
		title: "",
		prompt: "",
		cwd,
		schedule: { kind: "cron", expr: "0 9 * * 1-5", tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
		model: null,
		tools: "read_only",
		depth: DEFAULT_TASK_DEPTH,
		timeoutMs: DEFAULT_TASK_TIMEOUT_MS,
		verify: null,
		notify: "on_change",
		origin: { sessionPath: null, createdBy: "user" },
		startPaused: false,
	};
}
