/**
 * Workspace dock: the live execution-state region mounted between the
 * transcript and the composer, replacing the workspace drawer's
 * todo/plan/agents/queue tabs with always-current center cards. Large
 * todo/agent collections render a compact summary and temporarily focus one
 * card for full-list inspection. Each card self-gates its visibility (no
 * todos, no working subagent or `display.pinnedAgents` off, plan mode off,
 * empty queue → nothing rendered), so the region collapses to zero height on
 * an idle session. The dock also owns the stream-time get_subagents poll,
 * which must keep running while the Agents card is hidden. The surrounding
 * conversation owns vertical scrolling; a focused card expands naturally
 * instead of adding a nested scrollbar. Chat
 * tabs are tool-free — none of these surfaces can exist there. Every card
 * sits behind its own error boundary: a card crash must never take down the
 * composer.
 */

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSubagentStreamPoll } from "../../../hooks/use-subagent-stream-poll";
import { cx } from "../../../lib/format";
import { useT } from "../../../lib/i18n";
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

function clampFocusHeight(height: number): number {
	return Math.round(Math.min(Math.max(200, window.innerHeight - 220), Math.max(200, height)));
}

function WorkspaceDockContent() {
	const { focusedCard } = useWorkspaceDockFocus();
	const t = useT();
	const planModeEnabled = useSessionStore(state => state.planModeEnabled);
	const goalVisible = useSessionStore(state => state.goal !== null);
	const todoVisible = useTodoStore(state => state.phases.length > 0 || state.reminderVisible);
	const agentsVisible = useAgentsDockVisible();
	const queued = useQueuedMessages();
	const cardsVisible =
		planModeEnabled || todoVisible || agentsVisible || queued.steering.length > 0 || queued.followUp.length > 0;

	// Focused-card height: user-resizable via the drag handle above the stack,
	// persisted across launches. null = fall back to the viewport-derived cap.
	const scrollerRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{ startY: number; startH: number } | null>(null);
	const [focusHeight, setFocusHeight] = useState<number | null>(() => {
		try {
			const stored = Number(localStorage.getItem("omp.dock.focusHeight"));
			return stored >= 200 ? clampFocusHeight(stored) : null;
		} catch {
			return null;
		}
	});
	const clampHeight = useCallback(clampFocusHeight, []);
	const persistHeight = useCallback((height: number) => {
		try {
			localStorage.setItem("omp.dock.focusHeight", String(height));
		} catch {
			/* storage unavailable — session-only */
		}
	}, []);
	useEffect(() => {
		const clamp = () => setFocusHeight(height => (height === null ? null : clampFocusHeight(height)));
		window.addEventListener("resize", clamp);
		return () => window.removeEventListener("resize", clamp);
	}, []);

	const onHandleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		const el = scrollerRef.current;
		if (!el) return;
		dragRef.current = { startY: event.clientY, startH: el.clientHeight };
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const onHandleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag) return;
		setFocusHeight(clampHeight(drag.startH + (drag.startY - event.clientY)));
	};
	const onHandleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!dragRef.current) return;
		dragRef.current = null;
		event.currentTarget.releasePointerCapture(event.pointerId);
		if (focusHeight != null) persistHeight(focusHeight);
	};
	const onHandleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (!focusedCard) return;
		const step = event.key === "ArrowUp" ? 48 : event.key === "ArrowDown" ? -48 : 0;
		if (!step) return;
		event.preventDefault();
		const current = focusHeight ?? scrollerRef.current?.clientHeight ?? 320;
		const next = clampHeight(current + step);
		setFocusHeight(next);
		persistHeight(next);
	};

	if (!cardsVisible && !goalVisible) return null;

	return (
		<div className="flex flex-col gap-1.5 pb-1.5" data-focused-card={focusedCard ?? undefined}>
			{cardsVisible && (
				<>
					{focusedCard && (
						<div
							aria-label={t("dock.resizeHeight")}
							aria-orientation="horizontal"
							className="mx-auto h-1.5 w-16 cursor-row-resize touch-none rounded-full bg-[var(--omp-border)] hover:bg-[var(--omp-border-strong)]"
							data-testid="workspace-dock-resize"
							onKeyDown={onHandleKeyDown}
							onPointerDown={onHandleDown}
							onPointerMove={onHandleMove}
							onPointerUp={onHandleUp}
							role="separator"
							tabIndex={0}
							title={t("dock.resizeHeight")}
						/>
					)}
					<div
						className={cx(
							// The reserved gutter hangs outside the column (negative margin of the
							// bar's width), so the cards end on the composer's right edge.
							"-mr-(--omp-scrollbar-size) flex flex-col gap-1.5 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
							// Summary state stays compact. A FOCUSED card renders the full
							// list; its cap is an INLINE style — arbitrary-value classes
							// cannot express `calc(100dvh - 240px)` (the bare dash makes
							// the declaration invalid, silently removing every bound and
							// killing scrollability).
							focusedCard ? undefined : "max-h-[min(40vh,320px)]",
						)}
						data-testid="workspace-dock"
						ref={scrollerRef}
						style={focusedCard ? { maxHeight: focusHeight ?? "min(50dvh, calc(100dvh - 300px))" } : undefined}
					>
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
				</>
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
