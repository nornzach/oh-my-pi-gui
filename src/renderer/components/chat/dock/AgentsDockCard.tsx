/**
 * Agents dock card: the live subagent roster rendered in the center dock
 * above the composer (previously the workspace drawer's agents tab). Live
 * tree of subagent nodes with status badges, elapsed time, progress line,
 * and lazily loaded transcripts (byte pagination). A List/Graph toggle in
 * the card header switches the compact spawn tree for the graphical DAG.
 *
 * Owns stream-time polling of get_subagents (moved from the ActivityStrip
 * agents chip): lifecycle/progress frames keep the store fresh while agents
 * run, but parked/idle transitions ride the AgentRegistry and emit NO wire
 * frame — without polling, a watchdog-parked agent would show "running"
 * until the next session hydration.
 */

import { Bot, ChevronRight, List, Network } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { SubagentSnapshot } from "../../../../shared/rpc-types";
import { useTabGuard } from "../../../hooks/use-tab-guard";
import { cx, formatCost, formatTokens } from "../../../lib/format";
import { useT } from "../../../lib/i18n";
import { useNowTick } from "../../../lib/now-tick";
import { useMessagesStore } from "../../../stores/messages";
import { useSessionStore } from "../../../stores/session";
import { useSubagentsStore } from "../../../stores/subagents";
import { Badge } from "../../common";
import { SubagentDag } from "../../panels/SubagentDag";
import { SubagentTranscript } from "../../panels/SubagentTranscript";
import {
	buildSubagentList,
	extractTaskToolCallIds,
	formatElapsed,
	isLiveSubagentStatus,
	statusMeta,
	subagentElapsedMs,
	subagentPrimaryLabel,
	useSubagentGraphStore,
} from "../../panels/subagent-graph";
import { DockCard } from "./DockCard";
import { buildAgentDockSummary } from "./dock-summary";
import { useWorkspaceDockFocus } from "./WorkspaceDockFocus";

type PanelView = "list" | "graph";

/** Poll cadence while a turn streams (covers frame-less parked/idle transitions). */
const STREAM_POLL_MS = 3000;

const SubagentRow = memo(function SubagentRow({
	agent,
	depth,
	expanded,
	onToggle,
	now,
}: {
	agent: SubagentSnapshot;
	depth: number;
	expanded: boolean;
	onToggle: () => void;
	now: number;
}) {
	const t = useT();
	const meta = statusMeta(agent.status);
	const live = isLiveSubagentStatus(agent.status);
	const elapsed = subagentElapsedMs(agent, now);
	const title = subagentPrimaryLabel(agent);
	const progressLine = live ? agent.progress?.description?.trim() : undefined;
	const description = agent.description?.trim();
	const detail = [progressLine, description].find(line => line && line !== title);
	const model = agent.progress?.resolvedModel;
	const usage =
		agent.progress && (agent.progress.requests > 0 || agent.progress.tokens > 0 || agent.progress.cost > 0)
			? `${formatTokens(agent.progress.tokens)} ${t("sessionInfo.tokens")} · ${formatCost(agent.progress.cost)}`
			: undefined;

	return (
		<div aria-level={depth + 1} className="relative" role="treeitem" style={{ marginLeft: Math.min(depth, 6) * 14 }}>
			{depth > 0 && (
				<span className="pointer-events-none absolute top-0 -left-2.5 h-5 w-2.5 rounded-bl-md border-b border-l border-(--omp-border-muted)" />
			)}
			<div
				className={cx(
					"relative overflow-hidden rounded-lg border border-(--omp-border-muted) bg-transparent transition-colors duration-150 hover:bg-(--omp-bg-tertiary)",
					agent.status === "cancelled" && "opacity-70",
				)}
			>
				<span
					aria-hidden
					className={cx(
						"absolute inset-y-2 left-0 w-0.5 rounded-full",
						live ? "bg-(--omp-link)" : agent.status === "failed" ? "bg-(--omp-error)" : "bg-(--omp-border)",
					)}
				/>
				<button
					aria-expanded={expanded}
					className="flex w-full items-start gap-1.5 py-2 pr-2.5 pl-2 text-left"
					onClick={onToggle}
					type="button"
				>
					<ChevronRight
						className="omp-disclosure-chevron mt-0.5 shrink-0 text-(--omp-dim)"
						size={12}
						style={{ transform: expanded ? "rotate(90deg)" : undefined }}
					/>
					<span className="min-w-0 flex-1">
						<span className="flex min-w-0 items-center gap-1.5">
							<span className="min-w-0 flex-1 truncate text-omp-sm font-medium text-(--omp-text)" title={title}>
								{title}
							</span>
							<Badge dot={meta.live} pulse={meta.live} variant={meta.variant}>
								{t(meta.labelKey)}
							</Badge>
						</span>
						<span className="mt-1 flex min-w-0 items-center gap-1 text-omp-xxs text-(--omp-dim)">
							<Bot className="shrink-0 text-(--omp-status-subagents)" size={10} />
							<span className="shrink-0">{agent.agent}</span>
							<span className="shrink-0 tabular-nums">#{agent.index + 1}</span>
							{model && <span className="min-w-0 truncate">· {model}</span>}
							{usage && <span className="shrink-0 tabular-nums">· {usage}</span>}
							{elapsed !== null && (
								<span className="ml-auto shrink-0 tabular-nums">{formatElapsed(elapsed)}</span>
							)}
						</span>
					</span>
				</button>
				{detail && (
					<div className="truncate px-6 pb-2 text-omp-xs text-(--omp-muted)" title={detail}>
						{detail}
					</div>
				)}
				{expanded && (
					<div className="border-t border-(--omp-border-muted)">
						<SubagentTranscript agent={agent} />
					</div>
				)}
			</div>
		</div>
	);
});

function ViewToggle({ view, onChange }: { view: PanelView; onChange: (view: PanelView) => void }) {
	const t = useT();
	return (
		<div
			aria-label={t("subagentPanel.viewAria")}
			className="flex items-center gap-0.5 rounded-md border border-(--omp-border-muted) p-0.5"
			role="group"
		>
			{(["list", "graph"] as const).map(option => (
				<button
					aria-pressed={view === option}
					className={cx(
						"flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-omp-xs transition-colors",
						view === option
							? "bg-(--omp-bg-tertiary) text-(--omp-text)" // surface-ok: aria-pressed selected-view fill
							: "text-(--omp-dim) hover:text-(--omp-text)",
					)}
					key={option}
					onClick={() => onChange(option)}
					title={option === "list" ? t("subagentPanel.listView") : t("subagentPanel.graphView")}
					type="button"
				>
					{option === "list" ? <List size={11} /> : <Network size={11} />}
					{option === "list" ? t("subagentPanel.list") : t("subagentPanel.graph")}
				</button>
			))}
		</div>
	);
}

export function AgentsDockCard({ pollMs = STREAM_POLL_MS }: { pollMs?: number }) {
	const t = useT();
	const { capture, isActive } = useTabGuard();
	const { managed, focusedCard, focusCard, clearFocus } = useWorkspaceDockFocus();
	const focused = focusedCard === "agents";
	const showFull = !managed || focused;
	const subagents = useSubagentsStore(state => state.subagents);
	const toolCallOwners = useSubagentGraphStore(state => state.toolCallOwners);
	const messages = useMessagesStore(state => state.messages);
	const isStreaming = useSessionStore(s => s.isStreaming);
	const refresh = useSubagentsStore(state => state.refresh);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [view, setView] = useState<PanelView>("list");

	const agents = useMemo(() => [...subagents.values()].sort((a, b) => a.index - b.index), [subagents]);
	const hasRunning = agents.some(agent => isLiveSubagentStatus(agent.status));
	const runningCount = agents.filter(agent => isLiveSubagentStatus(agent.status)).length;
	const now = useNowTick(hasRunning);

	useEffect(() => {
		if (!isStreaming) return;
		const timer = setInterval(() => {
			// A poll resolving after a tab/session switch must not paint this
			// tab's agents over the new foreground session — the guard is
			// re-checked inside the store AFTER the await, before the write.
			const origin = capture();
			if (!isActive(origin)) return;
			void refresh({ expect: () => isActive(origin) });
		}, pollMs);
		return () => clearInterval(timer);
	}, [capture, isActive, isStreaming, pollMs, refresh]);

	const rootToolCallIds = useMemo(() => new Set(extractTaskToolCallIds(messages)), [messages]);
	const rows = useMemo(
		() => buildSubagentList(agents, rootToolCallIds, toolCallOwners),
		[agents, rootToolCallIds, toolCallOwners],
	);
	const summary = useMemo(() => buildAgentDockSummary(rows), [rows]);
	const displayedRows = showFull ? rows : summary.rows;

	const toggle = useCallback((id: string) => {
		setExpanded(prev => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const openAgent = useCallback(
		(id: string) => {
			if (managed && !focused) focusCard("agents");
			toggle(id);
		},
		[focusCard, focused, managed, toggle],
	);
	const changeView = useCallback(
		(next: PanelView) => {
			if (managed && next === "graph" && !focused) focusCard("agents");
			setView(next);
		},
		[focusCard, focused, managed],
	);

	useEffect(() => {
		if (focused && agents.length === 0) clearFocus();
	}, [agents.length, clearFocus, focused]);

	if (agents.length === 0) return null;

	return (
		<DockCard
			actions={<ViewToggle onChange={changeView} view={view} />}
			badge={
				<span className="shrink-0 text-omp-xs tabular-nums text-[var(--omp-dim)]">
					{runningCount > 0 ? `${runningCount}/${agents.length}` : agents.length}
				</span>
			}
			icon={Bot}
			id="agents"
			title={t("dock.agents")}
		>
			{view === "graph" ? (
				<div className="h-72">
					<SubagentDag />
				</div>
			) : (
				<div className="space-y-1.5 px-2 py-1.5" role="tree">
					{displayedRows.map(({ agent, depth }) => (
						<SubagentRow
							agent={agent}
							depth={depth}
							expanded={showFull && expanded.has(agent.id)}
							key={agent.id}
							now={now}
							onToggle={() => openAgent(agent.id)}
						/>
					))}
					{managed && !focused && summary.hiddenCount > 0 && (
						<button
							className="omp-pressable flex w-full items-center justify-center rounded-md border border-dashed border-[var(--omp-border-muted)] px-2 py-1.5 text-omp-xs font-medium text-[var(--omp-link)] hover:border-[var(--omp-border-strong)]"
							onClick={() => focusCard("agents")}
							type="button"
						>
							{t("dock.viewAllAgents", { hidden: summary.hiddenCount, total: summary.totalCount })}
						</button>
					)}
				</div>
			)}
		</DockCard>
	);
}
