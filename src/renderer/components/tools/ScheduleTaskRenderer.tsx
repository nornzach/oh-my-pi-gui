import { CalendarClock } from "lucide-react";
import type { TaskDepth, TaskSchedule } from "../../../shared/scheduler-types";
import { formatClock } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useSchedulerStore } from "../../stores/scheduler";
import { depthLabel, scheduleLabel } from "../tasks/task-format";
import { resultBodyText, resultDetails } from "./result";
import type { ToolRendererProps } from "./ToolCard";

/**
 * `schedule_task` (plan/23 §5): the task as one line, then whether it was
 * created and when it first runs, or why not. The task itself lives in
 * Scheduled Tasks, linked from here. Sessions from before tasks were created
 * at once can still hold a declined draft.
 */

function draftSchedule(args: Record<string, unknown>): TaskSchedule | null {
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (args.scheduleKind === "cron" && typeof args.cron === "string" && args.cron.trim()) {
		return { kind: "cron", expr: args.cron.trim(), tz: zone };
	}
	if (args.scheduleKind === "interval" && typeof args.everyMinutes === "number" && args.everyMinutes > 0) {
		return { kind: "interval", everyMs: args.everyMinutes * 60_000, anchor: 0 };
	}
	if (args.scheduleKind === "once" && typeof args.at === "string") {
		const at = Date.parse(args.at);
		if (Number.isFinite(at)) return { kind: "once", at };
	}
	return null;
}

export function ScheduleTaskRenderer({ args, result, isError, isPartial }: ToolRendererProps) {
	const t = useT();
	const title = typeof args.title === "string" ? args.title : "";
	const schedule = draftSchedule(args);
	const details = isPartial ? undefined : resultDetails(result);
	const created = !isError && details?.outcome === "created";
	const reason = typeof details?.reason === "string" ? details.reason.trim() : "";
	const taskId = created && typeof details?.taskId === "string" ? details.taskId : undefined;
	const firstRun = created && typeof details?.nextFireAt === "number" ? details.nextFireAt : null;
	const model = created && typeof details?.model === "string" ? details.model : "";
	const depth = created && typeof details?.depth === "object" ? (details.depth as TaskDepth | null) : null;
	const status = isPartial
		? t("tools.scheduleTask.scheduling")
		: isError
			? t("tools.scheduleTask.notScheduled")
			: created
				? t("tools.scheduleTask.created")
				: t("tools.scheduleTask.declined");

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex min-w-0 items-center gap-1.5 text-omp-sm">
				<CalendarClock
					size={12}
					className={
						isError
							? "shrink-0 text-(--omp-error)"
							: created
								? "shrink-0 text-(--omp-success)"
								: "shrink-0 text-(--omp-muted)"
					}
				/>
				<span className="min-w-0 truncate font-semibold text-(--omp-text)">
					{title || t("tools.scheduleTask.title")}
				</span>
				{schedule && <span className="shrink-0 text-(--omp-muted)">· {scheduleLabel(t, schedule)}</span>}
			</div>
			<p className={isPartial ? "omp-shimmer-text text-omp-sm" : "text-omp-sm text-(--omp-dim)"}>
				{status}
				{firstRun !== null && ` ${t("tools.scheduleTask.firstRun", { time: formatClock(firstRun) })}`}
				{model && ` · ${model}`}
				{depth?.kind && ` · ${depthLabel(t, depth)}`}
			</p>
			{isError && (
				<p className="text-omp-sm break-words whitespace-pre-wrap text-(--omp-muted)">
					{resultBodyText(result).trim()}
				</p>
			)}
			{reason && (
				<p className="text-omp-sm break-words text-(--omp-muted)">{t("tools.scheduleTask.reason", { reason })}</p>
			)}
			{created && (
				<button
					className="self-start text-omp-sm text-(--omp-link) hover:underline"
					onClick={() => useSchedulerStore.getState().openTasks({ view: "tasks", taskId })}
					type="button"
				>
					{t("tools.scheduleTask.open")}
				</button>
			)}
		</div>
	);
}
