/**
 * Scheduled Tasks (plan/23 §6): one full-size window with four views —
 * Tasks, Runs, Review and Insights — plus the scheduler's health and a
 * global pause. Opened from the menu, the sidebar, the command palette,
 * notifications, and the review badge.
 */

import { CalendarClock, Plus } from "lucide-react";
import { useT } from "../../lib/i18n";
import { type TasksView as TasksViewId, useSchedulerStore } from "../../stores/scheduler";
import { useSessionStore } from "../../stores/session";
import { Button, Modal, Tabs } from "../common";
import { InsightsView } from "./InsightsView";
import { ReviewView, RunsView } from "./RunsView";
import { TasksView } from "./TasksView";
import { blankDraft, untilLabel } from "./task-format";

function HealthPill() {
	const t = useT();
	const snapshot = useSchedulerStore(state => state.snapshot);
	const setPaused = useSchedulerStore(state => state.setPaused);
	if (!snapshot) return null;
	const { state, nextFireAt } = snapshot.health;
	const paused = snapshot.paused;
	return (
		<div className="flex items-center gap-3">
			<span
				className="flex items-center gap-1.5 text-omp-sm text-(--omp-muted)"
				title={t(`tasks.health.${state}.title`)}
			>
				<span
					className={
						state === "healthy"
							? "omp-signal-light omp-signal-light--active text-(--omp-success)"
							: state === "paused"
								? "size-1.5 rounded-full bg-(--omp-border-strong)"
								: "size-1.5 rounded-full bg-(--omp-warning)"
					}
				/>
				{state === "healthy" && nextFireAt !== null
					? t("tasks.health.next", { when: untilLabel(t, nextFireAt) })
					: t(`tasks.health.${state}`)}
			</span>
			<button
				aria-checked={!paused}
				className="flex items-center gap-2 rounded-lg px-2 py-1 text-omp-sm text-(--omp-muted) transition-colors duration-150 hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
				onClick={() => void setPaused(!paused)}
				role="switch"
				type="button"
			>
				{t("tasks.health.scheduling")}
				<span
					className={`relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150 ${paused ? "bg-(--omp-switch-off)" : "bg-(--omp-switch-on)"}`}
				>
					<span
						className={`omp-switch-thumb absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow ${paused ? "translate-x-0" : "translate-x-3"}`}
					/>
				</span>
			</button>
		</div>
	);
}

export function TasksWindow() {
	const t = useT();
	const open = useSchedulerStore(state => state.open);
	const close = useSchedulerStore(state => state.close);
	const view = useSchedulerStore(state => state.view);
	const setView = useSchedulerStore(state => state.setView);
	const reviewCount = useSchedulerStore(state => state.snapshot?.reviewCount ?? 0);
	const liveRuns = useSchedulerStore(
		state => state.snapshot?.runs.filter(run => run.state === "running" || run.state === "queued").length ?? 0,
	);
	const cwd = useSessionStore(state => state.cwd);
	const newTask = () => useSchedulerStore.getState().openEditor({ mode: "create", initial: blankDraft(cwd) });

	const tabs = [
		{ id: "tasks", label: t("tasks.view.tasks") },
		{ id: "runs", label: t("tasks.view.runs"), badge: liveRuns > 0 ? liveRuns : undefined },
		{ id: "review", label: t("tasks.view.review"), badge: reviewCount > 0 ? reviewCount : undefined },
		{ id: "insights", label: t("tasks.view.insights") },
	];

	return (
		<Modal
			bodyClassName="p-0"
			onClose={close}
			open={open}
			size="full"
			title={
				<span className="flex items-center gap-2">
					<CalendarClock size={16} className="text-(--omp-muted)" />
					{t("tasks.title")}
				</span>
			}
			ariaLabel={t("tasks.title")}
		>
			<div className="flex h-full min-h-0 flex-col">
				<div className="flex shrink-0 items-center gap-4 border-b border-(--omp-border-muted) px-4 pt-1.5">
					<Tabs
						activeId={view}
						ariaLabel={t("tasks.title")}
						className="border-b-0"
						onChange={id => setView(id as TasksViewId)}
						tabs={tabs}
					/>
					<div className="ml-auto flex items-center gap-3 pb-1.5">
						<HealthPill />
						<Button icon={<Plus size={12} />} onClick={newTask} size="sm" variant="primary">
							{t("tasks.new")}
						</Button>
					</div>
				</div>
				<div className="omp-fade-in min-h-0 flex-1" key={view}>
					{view === "tasks" && <TasksView onNew={newTask} />}
					{view === "runs" && <RunsView />}
					{view === "review" && <ReviewView />}
					{view === "insights" && <InsightsView />}
				</div>
			</div>
		</Modal>
	);
}
