/** Live execution cards at the end of the transcript's scroll area. */
import { useLayoutEffect, useRef } from "react";
import { useSubagentStreamPoll } from "../../../hooks/use-subagent-stream-poll";
import { useQueuedMessages } from "../../../stores/queue";
import { useSessionStore } from "../../../stores/session";
import { useActiveTabKind } from "../../../stores/tabs";
import { useTodoStore } from "../../../stores/todo";
import { PanelErrorBoundary } from "../../common";
import { AgentsDockCard, useAgentsDockVisible } from "./AgentsDockCard";
import { GoalDockBar } from "./GoalDockBar";
import { PlanDockCard } from "./PlanDockCard";
import { QueueDockChip } from "./QueueDockChip";
import { TodoDockCard } from "./TodoDockCard";
import { useWorkspaceDockFocus, WorkspaceDockFocusProvider } from "./WorkspaceDockFocus";

function WorkspaceDockContent() {
	const { focusedCard } = useWorkspaceDockFocus();
	const planVisible = useSessionStore(state => state.planModeEnabled);
	const goalVisible = useSessionStore(state => state.goal !== null);
	const todoVisible = useTodoStore(state => state.phases.length > 0 || state.reminderVisible);
	const agentsVisible = useAgentsDockVisible();
	const queued = useQueuedMessages();
	const cardsVisible =
		planVisible || todoVisible || agentsVisible || queued.steering.length > 0 || queued.followUp.length > 0;
	const rootRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		if (focusedCard) rootRef.current?.querySelector("[data-dock-focused]")?.scrollIntoView?.({ block: "start" });
	}, [focusedCard]);

	if (!cardsVisible && !goalVisible) return null;
	return (
		<div ref={rootRef} className="flex flex-col gap-1.5 pt-2 pb-1.5" data-focused-card={focusedCard ?? undefined}>
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
					<PanelErrorBoundary>
						<QueueDockChip />
					</PanelErrorBoundary>
				</div>
			)}
			<PanelErrorBoundary>
				<GoalDockBar />
			</PanelErrorBoundary>
		</div>
	);
}

/** `pollMs`: get_subagents cadence while a turn streams (tests shorten it). */
export function WorkspaceDock({ pollMs }: { pollMs?: number }) {
	useSubagentStreamPoll(pollMs);
	const isChat = useActiveTabKind() === "chat";
	if (isChat) return null;
	return (
		<WorkspaceDockFocusProvider>
			<WorkspaceDockContent />
		</WorkspaceDockFocusProvider>
	);
}
