import {
	CheckCircle2,
	Circle,
	CircleAlert,
	CircleDot,
	CircleMinus,
	Clock3,
	Cpu,
	Folder,
	ListTodo,
	PanelRightOpen,
	Sprout,
} from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useSubagentStreamPoll } from "../../../hooks/use-subagent-stream-poll";
import { basename } from "../../../lib/format";
import { useT } from "../../../lib/i18n";
import { useAgentPagesStore } from "../../../stores/agent-pages";
import { useModelStore } from "../../../stores/model";
import { useSessionStore } from "../../../stores/session";
import { useRuntimeTabId } from "../../../stores/session-runtime-context";
import { useSubagentsStore } from "../../../stores/subagents";
import { useActiveTabKind } from "../../../stores/tabs";
import { sameTodoPhases, useTodoStore } from "../../../stores/todo";
import { useUiStore } from "../../../stores/ui";
import { subagentActivity } from "../../agents/agent-activity";
import { PanelErrorBoundary } from "../../common";
import { subagentPrimaryLabel } from "../../panels/subagent-graph";
import { AgentsDockCard, useAgentsDockVisible } from "./AgentsDockCard";
import { GoalDockBar } from "./GoalDockBar";
import { PlanDockCard } from "./PlanDockCard";
import { TodoDockCard } from "./TodoDockCard";
import { useWorkspaceDockFocus, WorkspaceDockFocusProvider } from "./WorkspaceDockFocus";

function WorkspaceDockContent() {
	const t = useT();
	const { focusedCard } = useWorkspaceDockFocus();
	const planVisible = useSessionStore(state => state.planModeEnabled);
	const goalVisible = useSessionStore(state => state.goal !== null);
	const todoVisible = useTodoStore(state => state.phases.length > 0 || state.reminderVisible);
	const agentsVisible = useAgentsDockVisible();
	const cardsVisible = planVisible || todoVisible || agentsVisible;
	const archive = useTodoStore(state => state.history);
	const phases = useTodoStore(state => state.phases);
	const history = archive.filter(
		(entry, index) =>
			entry.phases.length > 0 && (index < archive.length - 1 || !sameTodoPhases(entry.phases, phases)),
	);
	const rootRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		if (focusedCard) rootRef.current?.querySelector("[data-dock-focused]")?.scrollIntoView?.({ block: "start" });
	}, [focusedCard]);

	return (
		<div
			ref={rootRef}
			className="flex h-full flex-col gap-2 overflow-y-auto p-3"
			data-focused-card={focusedCard ?? undefined}
		>
			{!cardsVisible && !goalVisible && history.length === 0 && (
				<p className="text-omp-sm text-(--omp-muted)">{t("overview.running.none")}</p>
			)}
			{cardsVisible && (
				<div className="flex flex-col gap-1.5" data-testid="workspace-dock">
					<PanelErrorBoundary>
						<PlanDockCard />
					</PanelErrorBoundary>
					<PanelErrorBoundary>
						<TodoDockCard />
					</PanelErrorBoundary>
					<PanelErrorBoundary>
						<AgentsDockCard />
					</PanelErrorBoundary>
				</div>
			)}
			<PanelErrorBoundary>
				<GoalDockBar />
			</PanelErrorBoundary>
			{history.length > 0 && (
				<details className="text-omp-sm text-(--omp-muted)">
					<summary className="cursor-pointer">{t("tasks.detail.history")}</summary>
					{history.toReversed().map(entry => (
						<div key={entry.id} className="mt-2 border-t border-(--omp-border-muted) pt-2">
							{entry.phases.map((phase, index) => (
								<section key={index}>
									<strong>{phase.name}</strong>
									<ul>
										{phase.tasks.map((task, taskIndex) => (
											<li key={taskIndex} className="wrap-anywhere">
												{task.content} ·{" "}
												{t(
													`todoPanel.status.${task.status === "in_progress" ? "inProgress" : task.status}`,
												)}
											</li>
										))}
									</ul>
								</section>
							))}
						</div>
					))}
				</details>
			)}
		</div>
	);
}

export function WorkspaceDock() {
	return (
		<WorkspaceDockFocusProvider>
			<WorkspaceDockContent />
		</WorkspaceDockFocusProvider>
	);
}

const activityIcons = {
	working: CircleDot,
	waiting: Clock3,
	failed: CircleAlert,
	done: CheckCircle2,
	stopped: CircleMinus,
};
const taskIcons = { pending: Circle, in_progress: CircleDot, completed: CheckCircle2, abandoned: CircleMinus };

function RailList<Item>({
	title,
	count,
	items,
	render,
}: {
	title: string;
	count: string;
	items: readonly Item[];
	render: (item: Item, index: number) => ReactNode;
}) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const limit = 5;
	return (
		<section aria-label={title} className="omp-rail-section">
			<h3>
				{title}
				<span>{count}</span>
			</h3>
			<ul>{(expanded ? items : items.slice(0, limit)).map(render)}</ul>
			{items.length > limit && (
				<button
					type="button"
					className="omp-rail-more"
					aria-expanded={expanded}
					onClick={() => setExpanded(!expanded)}
				>
					{expanded ? t("agents.page.showLess") : t("agents.sidebar.more", { count: items.length - limit })}
				</button>
			)}
		</section>
	);
}

export function FloatingActivity({ pollMs }: { pollMs?: number }) {
	useSubagentStreamPoll(pollMs);
	const t = useT();
	const panelVisible = useUiStore(state => state.panelVisible);
	const open = useUiStore(state => state.setPanelTab);
	const isChat = useActiveTabKind() === "chat";
	const phases = useTodoStore(state => state.phases);
	const lastSavedTodo = useTodoStore(state => state.history.findLast(entry => entry.phases.length > 0));
	const reminder = useTodoStore(state => state.reminderVisible);
	const agentsVisible = useAgentsDockVisible();
	const subagents = useSubagentsStore(state => state.subagents);
	const tabId = useRuntimeTabId();
	const sessionId = useSessionStore(state => state.sessionId);
	const sessionName = useSessionStore(state => state.sessionName);
	const cwd = useSessionStore(state => state.cwd);
	const model = useModelStore(state => state.model);
	const plan = useSessionStore(state => state.planModeEnabled);
	const goal = useSessionStore(state => state.goal);
	const hasSessionInfo = Boolean(cwd || model || sessionName);
	const hasActivity = Boolean(phases.length || lastSavedTodo || reminder || agentsVisible || plan || goal);
	if (panelVisible || isChat || (!hasSessionInfo && !hasActivity)) return null;
	const activeTasks = phases.flatMap(phase => phase.tasks);
	const tasks = phases.length ? activeTasks : (lastSavedTodo?.phases.flatMap(phase => phase.tasks) ?? []);
	const done = tasks.filter(task => task.status === "completed").length;
	const current =
		activeTasks.find(task => task.status === "in_progress") ?? activeTasks.find(task => task.status === "pending");
	const agents = agentsVisible ? Array.from(subagents.values()) : [];
	const workingAgent = agents.find(agent => subagentActivity(agent) === "working");
	const detail =
		goal?.objective || current?.content || (workingAgent && subagentPrimaryLabel(workingAgent)) || sessionName;
	const title = t("panel.tabs.activity");
	const description = [
		title,
		tasks.length && t("overview.running.todos", { done, total: tasks.length }),
		agents.length && t("tools.coordination.agents", { count: agents.length }),
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<aside className="omp-activity-rail" aria-label={title}>
			<button
				type="button"
				className="omp-rail-summary"
				title={description}
				aria-label={description}
				onClick={() => open("activity")}
			>
				<Sprout size={17} className="text-(--omp-success)" />
				<span className="omp-rail-title">{plan ? t("dock.plan") : title}</span>
				<PanelRightOpen size={14} className="omp-rail-open" />
				{detail && <span className="omp-rail-detail">{detail}</span>}
			</button>
			<div key={`${tabId}:${sessionId}`} className="omp-rail-sections">
				{(cwd || model) && (
					<section className="omp-rail-section">
						<h3>{t("overview.workspace.title")}</h3>
						{cwd && (
							<div className="omp-rail-row" title={cwd}>
								<Folder size={14} />
								<span>{basename(cwd) || cwd}</span>
							</div>
						)}
						{model && (
							<div className="omp-rail-row" title={model.name || model.id}>
								<Cpu size={14} />
								<span>{model.name || model.id}</span>
							</div>
						)}
					</section>
				)}
				{agents.length > 0 && (
					<RailList
						title={t("dock.agents")}
						count={String(agents.length)}
						items={agents}
						render={agent => {
							const activity = subagentActivity(agent);
							const Status = activityIcons[activity];
							const label = subagentPrimaryLabel(agent);
							const text = agent.progress?.description?.trim() || label;
							const status = t(`agents.activity.${activity}`);
							return (
								<li key={agent.id}>
									<button
										className="omp-rail-row"
										data-state={activity}
										type="button"
										title={`${agent.agent} · ${text} · ${status}`}
										aria-label={`${agent.agent} · ${text} · ${status}`}
										onClick={event =>
											tabId
												? useAgentPagesStore.getState().open(tabId, agent.id, { beside: event.altKey })
												: open("activity")
										}
									>
										<i className="omp-rail-agent" aria-hidden="true" data-tint={agent.index % 4} />
										<span>
											{agent.agent}
											{text !== agent.agent && <small> · {text}</small>}
										</span>
										<Status size={13} />
									</button>
								</li>
							);
						}}
					/>
				)}
				{tasks.length > 0 && (
					<RailList
						title={t("dock.todo")}
						count={`${done}/${tasks.length}`}
						items={tasks}
						render={(task, index) => {
							const Status = taskIcons[task.status];
							const status = t(`todoPanel.status.${task.status === "in_progress" ? "inProgress" : task.status}`);
							return (
								<li
									key={index}
									className="omp-rail-row"
									data-state={task.status}
									title={`${task.content} · ${status}`}
								>
									<Status size={14} aria-label={status} />
									<span>{task.content}</span>
								</li>
							);
						}}
					/>
				)}
				{reminder && (
					<button className="omp-rail-row" type="button" onClick={() => open("activity")}>
						<ListTodo size={14} />
						{t("todoPanel.reminder")}
					</button>
				)}
			</div>
		</aside>
	);
}
