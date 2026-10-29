import { CalendarClock } from "lucide-react";
import { formatClock } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useSchedulerStore } from "../../stores/scheduler";
import { resultBodyText, resultDetails } from "./result";
import type { ToolRendererProps } from "./ToolCard";

/**
 * `manage_scheduled_tasks`: which task the agent changed and how (updated,
 * paused, resumed, deleted), when it runs next, or how many tasks it listed.
 * A refused call shows why. The task opens in Scheduled Tasks from here.
 */

const DONE_KEYS: Record<string, string> = {
	update: "tools.manageTasks.updated",
	pause: "tools.manageTasks.paused",
	resume: "tools.manageTasks.resumed",
	delete: "tools.manageTasks.deleted",
};

export function ManageTasksRenderer({ result, isError, isPartial }: ToolRendererProps) {
	const t = useT();
	const details = isPartial || isError ? undefined : resultDetails(result);
	const action = typeof details?.action === "string" ? details.action : "";
	const title = typeof details?.title === "string" ? details.title : "";
	const taskId = typeof details?.taskId === "string" ? details.taskId : undefined;
	const nextRun = typeof details?.nextFireAt === "number" ? details.nextFireAt : null;
	const status = isPartial
		? t("tools.manageTasks.working")
		: isError
			? t("tools.manageTasks.notChanged")
			: action === "list"
				? t("tools.manageTasks.listed", { count: typeof details?.count === "number" ? details.count : 0 })
				: t(DONE_KEYS[action] ?? "tools.manageTasks.updated");

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex min-w-0 items-center gap-1.5 text-omp-sm">
				<CalendarClock
					size={12}
					className={
						isError
							? "shrink-0 text-(--omp-error)"
							: title && action !== "delete"
								? "shrink-0 text-(--omp-success)"
								: "shrink-0 text-(--omp-muted)"
					}
				/>
				<span className="min-w-0 truncate font-semibold text-(--omp-text)">
					{title || t("tools.manageTasks.title")}
				</span>
			</div>
			<p className={isPartial ? "omp-shimmer-text text-omp-sm" : "text-omp-sm text-(--omp-dim)"}>
				{status}
				{nextRun !== null &&
					action !== "pause" &&
					action !== "delete" &&
					` ${t("tools.manageTasks.nextRun", { time: formatClock(nextRun) })}`}
			</p>
			{isError && (
				<p className="text-omp-sm break-words whitespace-pre-wrap text-(--omp-muted)">
					{resultBodyText(result).trim()}
				</p>
			)}
			{!isPartial && !isError && action !== "delete" && (
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
