/**
 * Agents dock card: the live subagent roster rendered in the center dock
 * above the composer (previously the workspace drawer's agents tab). Live
 * tree of subagent nodes with status badges, elapsed time, progress line,
 * and lazily loaded transcripts (byte pagination). A List/Graph toggle in
 * the card header switches the compact spawn tree for the graphical DAG.
 *
 * The card shows only while an agent is working; `display.pinnedAgents`
 * picks hidden, a summary, or the full list. It lists only the batches still
 * at work (`liveAgentRows`): earlier finished, failed and stale agents stay
 * reachable from the drawer's Agents tab, the sidebar, and agent pages. The
 * stream-time get_subagents poll lives in the workspace dock, so a hidden
 * card cannot stall it.
 */

import { Bot, ChevronRight, List, Network } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { SubagentSnapshot } from "../../../../shared/rpc-types";
import { cx } from "../../../lib/format";
import { useT } from "../../../lib/i18n";
import { useNowTick } from "../../../lib/now-tick";
import { useAgentPagesStore } from "../../../stores/agent-pages";
import { useMessagesStore } from "../../../stores/messages";
import { useRuntimeTabId } from "../../../stores/session-runtime-context";
import { useSettingsStore } from "../../../stores/settings";
import { useSubagentsStore } from "../../../stores/subagents";
import { hasWorkingSubagent, subagentActivity } from "../../agents/agent-activity";
import { Badge } from "../../common";
import { SubagentDag } from "../../panels/SubagentDag";
import { SubagentTranscript } from "../../panels/SubagentTranscript";
import {
	buildSubagentList,
	extractTaskToolCallIds,
	formatElapsed,
	inSpawnOrder,
	isLiveSubagentStatus,
	statusMeta,
	subagentElapsedMs,
	subagentFacts,
	subagentPrimaryLabel,
	useSubagentGraphStore,
} from "../../panels/subagent-graph";
import { DockCard } from "./DockCard";
import { buildAgentDockSummary, liveAgentRows } from "./dock-summary";
import { useWorkspaceDockFocus } from "./WorkspaceDockFocus";

type PanelView = "list" | "graph";

/** Whether the dock shows the Agents card: an agent is working and `display.pinnedAgents` is not off. */
export function useAgentsDockVisible(): boolean {
	const pinnedOff = useSettingsStore(state => state.pinnedAgents === "off");
	const working = useSubagentsStore(state => hasWorkingSubagent(state.subagents.values()));
	return working && !pinnedOff;
}

const SubagentRow = memo(function SubagentRow({
	agent,
	depth,
	expanded,
	onToggle,
	onOpen,
	now,
}: {
	agent: SubagentSnapshot;
	depth: number;
	expanded: boolean;
	onToggle: () => void;
	/** Open the agent's page; beside the conversation with ⌥ (plan/24 §3.6). */
	onOpen: (beside: boolean) => void;
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
	const facts = subagentFacts(agent, t("sessionInfo.tokens"));

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
						// The rail repeats the pill's color: only an agent that is working is
						// blue; one waiting or paused stays neutral.
						meta.variant === "info"
							? "bg-(--omp-link)"
							: agent.status === "failed"
								? "bg-(--omp-error)"
								: "bg-(--omp-border)",
					)}
				/>
				<div className="flex w-full items-start">
					<button
						aria-expanded={expanded}
						aria-label={t("agents.dock.toggleTranscript")}
						className="omp-pressable mt-1.5 ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-(--omp-dim) hover:bg-(--omp-selected-bg) hover:text-(--omp-text)"
						onClick={onToggle}
						title={t("agents.dock.toggleTranscript")}
						type="button"
					>
						<ChevronRight
							className="omp-disclosure-chevron shrink-0"
							size={12}
							style={{ transform: expanded ? "rotate(90deg)" : undefined }}
						/>
					</button>
					<button
						className="flex min-w-0 flex-1 items-start gap-1.5 py-2 pr-2.5 pl-1 text-left"
						onClick={event => onOpen(event.altKey)}
						title={t("agents.openHint")}
						type="button"
					>
						<span className="min-w-0 flex-1">
							<span className="flex min-w-0 items-center gap-1.5">
								<span
									className="min-w-0 flex-1 truncate text-omp-sm font-medium text-(--omp-text)"
									title={title}
								>
									{title}
								</span>
								<Badge dot={meta.live} pulse={meta.live} variant={meta.variant}>
									{t(meta.labelKey)}
								</Badge>
							</span>
							<span className="mt-1 flex min-w-0 items-center gap-1 text-omp-xxs text-(--omp-dim)">
								<Bot className="shrink-0 text-(--omp-status-subagents)" size={10} />
								<span className="shrink-0 tabular-nums">{facts.kind}</span>
								{facts.model && <span className="min-w-0 truncate">· {facts.model}</span>}
								{facts.usage && <span className="shrink-0 tabular-nums">· {facts.usage}</span>}
								{elapsed !== null && (
									<span className="ml-auto shrink-0 tabular-nums">{formatElapsed(elapsed)}</span>
								)}
							</span>
						</span>
					</button>
				</div>
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

export function AgentsDockCard() {
	const t = useT();
	const { managed, focusedCard, focusCard, clearFocus } = useWorkspaceDockFocus();
	const focused = focusedCard === "agents";
	const visible = useAgentsDockVisible();
	const pinnedFull = useSettingsStore(state => state.pinnedAgents === "full");
	const showFull = !managed || focused || pinnedFull;
	const subagents = useSubagentsStore(state => state.subagents);
	const toolCallOwners = useSubagentGraphStore(state => state.toolCallOwners);
	const messages = useMessagesStore(state => state.messages);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [view, setView] = useState<PanelView>("list");

	const agents = useMemo(() => inSpawnOrder(subagents.values()), [subagents]);
	const hasRunning = agents.some(agent => isLiveSubagentStatus(agent.status));
	const runningCount = agents.filter(agent => subagentActivity(agent) === "working").length;
	const now = useNowTick(hasRunning);

	const rootToolCallIds = useMemo(() => new Set(extractTaskToolCallIds(messages)), [messages]);
	const rows = useMemo(
		() => liveAgentRows(buildSubagentList(agents, rootToolCallIds, toolCallOwners)),
		[agents, rootToolCallIds, toolCallOwners],
	);
	const liveIds = useMemo(() => new Set(rows.map(row => row.agent.id)), [rows]);
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
	const tabId = useRuntimeTabId();
	const openPage = useCallback(
		(id: string, beside: boolean) => {
			if (tabId) useAgentPagesStore.getState().open(tabId, id, { beside });
		},
		[tabId],
	);
	const changeView = useCallback(
		(next: PanelView) => {
			if (managed && next === "graph" && !focused) focusCard("agents");
			setView(next);
		},
		[focusCard, focused, managed],
	);

	useEffect(() => {
		if (focused && !visible) clearFocus();
	}, [clearFocus, focused, visible]);

	if (!visible) return null;

	return (
		<DockCard
			actions={<ViewToggle onChange={changeView} view={view} />}
			badge={
				<span className="shrink-0 text-omp-xs tabular-nums text-[var(--omp-dim)]">
					{runningCount}/{rows.length}
				</span>
			}
			icon={Bot}
			id="agents"
			title={t("dock.agents")}
		>
			{view === "graph" ? (
				<div className="h-72">
					<SubagentDag include={liveIds} />
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
							onOpen={beside => openPage(agent.id, beside)}
							onToggle={() => openAgent(agent.id)}
						/>
					))}
					{!showFull && summary.hiddenCount > 0 && (
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
