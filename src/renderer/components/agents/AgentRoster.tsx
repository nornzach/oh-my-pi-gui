/**
 * The drawer's Agents tab (plan/24 §3.4, §5.2): the monitor. This turn or
 * All, as a list or the graph, with pause, stop and expand controls. Rows
 * open pages; there is no detail view inside the drawer.
 */

import { Bot, List, MoreHorizontal, Network } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { cx, sanitizeToolText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { abortActiveTurn } from "../../lib/messages";
import { useNowTick } from "../../lib/now-tick";
import { useTabRpc } from "../../lib/tab-rpc";
import { markFailuresSeen, useAgentPagesStore, useSeenFailuresStore } from "../../stores/agent-pages";
import { type SessionStore, useSessionStore } from "../../stores/session";
import { sessionRuntimeStore, useRuntimeTabId } from "../../stores/session-runtime-context";
import { useSubagentsStore } from "../../stores/subagents";
import { toast } from "../../stores/toast";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import { SubagentDag } from "../panels/SubagentDag";
import { formatElapsed, subagentElapsedMs, subagentFacts, subagentPrimaryLabel } from "../panels/subagent-graph";
import { useAgentHoverCard } from "./AgentHoverCard";
import { AgentSignal, useActivityLabel } from "./AgentPage";
import { type AgentTreeRow, agentNowLine, visibleTreeRows } from "./agent-activity";
import { type AgentScope, useAgentProjection } from "./use-agent-tree";

/** Same cadence as the dock card: parked and idle transitions emit no frame. */
const POLL_MS = 3000;
const INDENT = 14;
const MAX_INDENT_LEVELS = 6;

type RosterView = "list" | "graph";

/** The switch to All and the Graph view are remembered per tab while it is open. */
const useRosterPrefs = create<{ scope: Record<string, AgentScope>; view: Record<string, RosterView> }>()(() => ({
	scope: {},
	view: {},
}));

/** The glance dot on the Agents tab (plan/24 §5.6): error wins over working. */
export function useAgentsTabSignal(): { tone: "error" | "working" | null; working: number; failed: number } {
	const subagents = useSubagentsStore(state => state.subagents);
	const seen = useSeenFailuresStore(state => state.seen);
	return useMemo(() => {
		let working = 0;
		let failed = 0;
		let unseenFailure = false;
		for (const agent of subagents.values()) {
			if (agent.status === "failed") {
				failed++;
				if (!seen.has(agent.id)) unseenFailure = true;
			} else if ((agent.status === "started" || agent.status === "running") && agent.live !== false) {
				working++;
			}
		}
		return { tone: unseenFailure ? "error" : working > 0 ? "working" : null, working, failed };
	}, [seen, subagents]);
}

export function AgentRoster() {
	const t = useT();
	const tabId = useRuntimeTabId();
	const projection = useAgentProjection();
	const isStreaming = useSessionStore(state => state.isStreaming);
	const refresh = useSubagentsStore(state => state.refresh);
	const error = useSubagentsStore(state => state.error);
	const key = tabId ?? "";
	const scope = useRosterPrefs(state => state.scope[key] ?? "turn");
	const view = useRosterPrefs(state => state.view[key] ?? "list");
	const setScope = (next: AgentScope) =>
		useRosterPrefs.setState(state => ({ scope: { ...state.scope, [key]: next } }));
	const setView = (next: RosterView) => useRosterPrefs.setState(state => ({ view: { ...state.view, [key]: next } }));
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [scrolled, setScrolled] = useState(false);

	useEffect(() => {
		void refresh();
		if (!isStreaming) return;
		const timer = window.setInterval(() => void refresh(), POLL_MS);
		return () => window.clearInterval(timer);
	}, [isStreaming, refresh]);

	// Opening the monitor is seeing its failures.
	const failedIds = useMemo(
		() => projection.all.filter(row => row.activity === "failed").map(row => row.agent.id),
		[projection.all],
	);
	useEffect(() => markFailuresSeen(failedIds), [failedIds]);

	// One polite announcement per new failure; progress is never announced.
	const [announcement, setAnnouncement] = useState("");
	const announced = useRef<Set<string> | null>(null);
	useEffect(() => {
		if (announced.current === null) {
			announced.current = new Set(failedIds);
			return;
		}
		const fresh = failedIds.filter(id => !announced.current?.has(id));
		for (const id of fresh) announced.current.add(id);
		const agent = fresh.length > 0 ? projection.byId.get(fresh[0]!) : undefined;
		if (agent) setAnnouncement(t("agents.roster.failedAnnounce", { title: subagentPrimaryLabel(agent) }));
	}, [failedIds, projection.byId, t]);

	const rows = scope === "turn" ? projection.turn : projection.all;
	const turnIds = useMemo(() => new Set(projection.turn.map(row => row.agent.id)), [projection.turn]);
	const shownRows = useMemo(() => visibleTreeRows(rows, collapsed), [rows, collapsed]);
	const toggleCollapsed = useCallback((id: string) => {
		setCollapsed(current => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	if (projection.allCount === 0) {
		return error ? (
			<RosterEmpty
				action={{ label: t("common.retry"), onClick: () => void refresh() }}
				body={t("agents.roster.loadFailedBody")}
				title={t("agents.roster.loadFailed")}
			/>
		) : (
			<RosterEmpty body={t("agents.roster.emptyBody")} icon title={t("agents.roster.empty")} />
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<RosterToolbar
				allCount={projection.allCount}
				onCollapseAll={() => setCollapsed(new Set(rows.filter(row => row.childCount > 0).map(row => row.agent.id)))}
				onExpandAll={() => setCollapsed(new Set())}
				scope={scope}
				scrolled={scrolled}
				setScope={setScope}
				setView={setView}
				turnCount={projection.turnCount}
				view={view}
			/>
			<PausedBanner />
			{error && (
				<div
					className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-[var(--omp-border-muted)] px-3 py-1.5 text-omp-sm text-[var(--omp-muted)]"
					role="alert"
				>
					<span className="min-w-0 flex-1 truncate" title={error}>
						{t("agents.roster.refreshFailed")}
					</span>
					<button
						className="omp-pressable shrink-0 font-medium text-[var(--omp-link)] hover:underline"
						onClick={() => void refresh()}
						type="button"
					>
						{t("common.retry")}
					</button>
				</div>
			)}
			<div aria-live="polite" className="sr-only">
				{announcement}
			</div>
			{view === "graph" ? (
				<div className="min-h-0 flex-1">
					<SubagentDag
						include={scope === "turn" ? turnIds : undefined}
						onOpen={(agentId, beside) => useAgentPagesStore.getState().open(key, agentId, { beside })}
					/>
				</div>
			) : rows.length === 0 ? (
				<RosterEmpty
					action={{ label: t("agents.roster.showAll"), onClick: () => setScope("all") }}
					body={t("agents.roster.turnEmptyBody")}
					title={t("agents.roster.turnEmpty")}
				/>
			) : (
				<div
					className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5"
					onScroll={event => setScrolled(event.currentTarget.scrollTop > 0)}
				>
					<RosterTree collapsed={collapsed} onToggle={toggleCollapsed} rows={shownRows} tabId={key} />
				</div>
			)}
		</div>
	);
}

function RosterEmpty({
	title,
	body,
	icon = false,
	action,
}: {
	title: string;
	body: string;
	icon?: boolean;
	action?: { label: string; onClick: () => void };
}) {
	return (
		<div className="flex h-full min-h-40 flex-col items-center justify-center gap-1.5 px-6 text-center">
			{icon && <Bot aria-hidden className="mb-1 text-[var(--omp-dim)]" size={22} />}
			<div className="text-omp-md font-medium text-[var(--omp-text)]">{title}</div>
			<div className="max-w-72 text-omp-sm text-[var(--omp-muted)]">{body}</div>
			{action && (
				<button
					className="omp-pressable mt-2 rounded-full border border-[var(--omp-border)] px-3 py-1 text-omp-sm font-medium text-[var(--omp-text)] hover:bg-[var(--omp-selected-bg)]"
					onClick={action.onClick}
					type="button"
				>
					{action.label}
				</button>
			)}
		</div>
	);
}

function RosterToolbar({
	scope,
	setScope,
	view,
	setView,
	turnCount,
	allCount,
	scrolled,
	onExpandAll,
	onCollapseAll,
}: {
	scope: AgentScope;
	setScope: (scope: AgentScope) => void;
	view: RosterView;
	setView: (view: RosterView) => void;
	turnCount: number;
	allCount: number;
	scrolled: boolean;
	onExpandAll: () => void;
	onCollapseAll: () => void;
}) {
	const t = useT();
	const rpc = useTabRpc();
	const tabId = useRuntimeTabId();
	const paused = useSessionStore(state => state.agentsPaused);
	const ready = useSessionStore(state => state.status === "ready");
	const isStreaming = useSessionStore(state => state.isStreaming);
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
	const togglePaused = useTogglePaused();
	const items: ContextMenuItem[] = [
		{
			id: "pause",
			label: paused ? t("agents.roster.resumeAgents") : t("agents.roster.pause"),
			disabled: !ready,
			onSelect: () => void togglePaused(),
		},
		{
			id: "stop",
			label: t("agents.roster.stopTurn"),
			danger: true,
			disabled: !ready || !isStreaming,
			onSelect: () =>
				void abortActiveTurn(rpc, tabId).then(response => {
					if (!response.success)
						toast({ variant: "error", title: t("agentHub.hub.abortFailed"), message: response.error });
				}),
		},
		{ id: "expand", label: t("agents.roster.expandAll"), onSelect: onExpandAll },
		{ id: "collapse", label: t("agents.roster.collapseAll"), onSelect: onCollapseAll },
	];
	const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
		const box = event.currentTarget.getBoundingClientRect();
		setMenu({ x: box.right - 200, y: box.bottom + 4 });
	};
	const segment = (active: boolean) =>
		cx(
			"flex h-6 items-center gap-1 rounded-md px-2 text-omp-sm tabular-nums transition-colors",
			active
				? "bg-[var(--omp-bg-tertiary)] font-medium text-[var(--omp-text)]" // surface-ok: aria-pressed segment fill
				: "text-[var(--omp-dim)] hover:text-[var(--omp-text)]",
		);
	return (
		<div
			className={cx(
				"flex h-11 shrink-0 items-center gap-2 px-3",
				scrolled && "border-b border-[var(--omp-border-muted)]",
			)}
		>
			<div
				aria-label={t("agents.roster.filter")}
				className="flex items-center gap-0.5 rounded-lg border border-[var(--omp-border-muted)] p-0.5"
				role="group"
			>
				<button
					aria-pressed={scope === "turn"}
					className={segment(scope === "turn")}
					onClick={() => setScope("turn")}
					type="button"
				>
					{t("agents.roster.thisTurn")}
					<span className="text-[var(--omp-dim)]">{turnCount}</span>
				</button>
				<button
					aria-pressed={scope === "all"}
					className={segment(scope === "all")}
					onClick={() => setScope("all")}
					type="button"
				>
					{t("agents.roster.all")}
					<span className="text-[var(--omp-dim)]">{allCount}</span>
				</button>
			</div>
			<div className="ml-auto flex items-center gap-1">
				<div
					aria-label={t("subagentPanel.viewAria")}
					className="flex items-center gap-0.5 rounded-lg border border-[var(--omp-border-muted)] p-0.5"
					role="group"
				>
					<button
						aria-label={t("subagentPanel.listView")}
						aria-pressed={view === "list"}
						className={segment(view === "list")}
						onClick={() => setView("list")}
						title={t("subagentPanel.listView")}
						type="button"
					>
						<List size={12} />
					</button>
					<button
						aria-label={t("subagentPanel.graphView")}
						aria-pressed={view === "graph"}
						className={segment(view === "graph")}
						onClick={() => setView("graph")}
						title={t("subagentPanel.graphView")}
						type="button"
					>
						<Network size={12} />
					</button>
				</div>
				<button
					aria-haspopup="menu"
					aria-label={t("agents.page.more")}
					className="omp-pressable flex h-7 w-7 items-center justify-center rounded-md text-[var(--omp-dim)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
					onClick={openMenu}
					title={t("agents.page.more")}
					type="button"
				>
					<MoreHorizontal size={14} />
				</button>
			</div>
			{menu && <ContextMenu items={items} onClose={() => setMenu(null)} x={menu.x} y={menu.y} />}
		</div>
	);
}

function useTogglePaused(): () => Promise<void> {
	const t = useT();
	const rpc = useTabRpc();
	const tabId = useRuntimeTabId();
	const paused = useSessionStore(state => state.agentsPaused);
	return useCallback(async () => {
		try {
			const response = await rpc.setAgentsPaused(!paused);
			if (!response.success) throw new Error(response.error);
			const data = response.data as { paused?: boolean; pausedAt?: number } | undefined;
			const next = data?.paused ?? !paused;
			(sessionRuntimeStore<SessionStore>(tabId, "session") ?? useSessionStore).setState({
				agentsPaused: next,
				agentsPausedAt: next ? (data?.pausedAt ?? Date.now()) : null,
			});
		} catch (cause) {
			toast({ variant: "error", title: t("agentHub.hub.pauseFailed"), message: String(cause) });
		}
	}, [paused, rpc, t, tabId]);
}

/** The way out of a state the user may have forgotten entering. */
function PausedBanner() {
	const t = useT();
	const paused = useSessionStore(state => state.agentsPaused);
	const togglePaused = useTogglePaused();
	if (!paused) return null;
	return (
		<div
			className="mx-3 mt-1 flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--omp-warning)_35%,transparent)] px-3 py-1.5 text-omp-sm text-[var(--omp-warning)]"
			role="status"
		>
			<span className="min-w-0 flex-1">{t("agents.roster.paused")}</span>
			<button
				className="omp-pressable shrink-0 font-medium hover:underline"
				onClick={() => void togglePaused()}
				type="button"
			>
				{t("agents.roster.resume")}
			</button>
		</div>
	);
}

function RosterTree({
	tabId,
	rows,
	collapsed,
	onToggle,
}: {
	tabId: string;
	rows: readonly AgentTreeRow[];
	collapsed: ReadonlySet<string>;
	onToggle: (id: string) => void;
}) {
	const shown = useAgentPagesStore(state => state.shown[tabId] ?? null);
	const [focus, setFocus] = useState(0);
	const refs = useRef<Array<HTMLDivElement | null>>([]);
	const anyWorking = rows.some(row => row.activity === "working");
	const now = useNowTick(anyWorking);
	const focusRow = (index: number) => {
		const next = Math.max(0, Math.min(rows.length - 1, index));
		setFocus(next);
		refs.current[next]?.focus();
	};
	const open = (row: AgentTreeRow, beside: boolean) =>
		useAgentPagesStore.getState().open(tabId, row.agent.id, { beside });
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
		const row = rows[index];
		if (!row) return;
		const expandable = row.childCount > 0;
		if (event.key === "ArrowDown") focusRow(index + 1);
		else if (event.key === "ArrowUp") focusRow(index - 1);
		else if (event.key === "ArrowRight" && expandable && collapsed.has(row.agent.id)) onToggle(row.agent.id);
		else if (event.key === "ArrowLeft") {
			if (expandable && !collapsed.has(row.agent.id)) onToggle(row.agent.id);
			else {
				const parent = rows.findLastIndex((candidate, at) => at < index && candidate.depth < row.depth);
				if (parent >= 0) focusRow(parent);
			}
		} else if (event.key === "Enter") open(row, event.altKey);
		else return;
		event.preventDefault();
	};
	return (
		<div role="tree">
			{rows.map((row, index) => (
				<RosterRow
					collapsed={collapsed.has(row.agent.id)}
					focusable={index === Math.min(focus, rows.length - 1)}
					hasNextSibling={nextSibling(rows, index)}
					key={row.agent.id}
					now={now}
					onFocus={() => setFocus(index)}
					onKeyDown={event => onKeyDown(event, index)}
					onOpen={beside => open(row, beside)}
					onToggle={() => onToggle(row.agent.id)}
					rowRef={element => {
						refs.current[index] = element;
					}}
					row={row}
					selected={shown === row.agent.id}
					tabId={tabId}
				/>
			))}
		</div>
	);
}

function nextSibling(rows: readonly AgentTreeRow[], index: number): boolean {
	const depth = rows[index]?.depth ?? 0;
	for (let next = index + 1; next < rows.length; next++) {
		const candidate = rows[next]!.depth;
		if (candidate === depth) return true;
		if (candidate < depth) return false;
	}
	return false;
}

const RosterRow = memo(function RosterRow({
	tabId,
	row,
	selected,
	collapsed,
	focusable,
	hasNextSibling,
	now,
	onToggle,
	onOpen,
	onFocus,
	onKeyDown,
	rowRef,
}: {
	tabId: string;
	row: AgentTreeRow;
	selected: boolean;
	collapsed: boolean;
	focusable: boolean;
	hasNextSibling: boolean;
	now: number;
	onToggle: () => void;
	onOpen: (beside: boolean) => void;
	onFocus: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	rowRef: (element: HTMLDivElement | null) => void;
}) {
	const t = useT();
	const activityLabel = useActivityLabel();
	const hover = useAgentHoverCard(tabId, row.agent.id, "left");
	const { agent, activity } = row;
	const title = subagentPrimaryLabel(agent);
	const facts = subagentFacts(agent, t("sessionInfo.tokens"));
	const factsText = [facts.kind, facts.model, facts.usage].filter(Boolean).join(" · ");
	const elapsed = subagentElapsedMs(agent, now);
	const time =
		activity === "working" || activity === "done"
			? elapsed !== null
				? formatElapsed(elapsed)
				: ""
			: activityLabel(agent);
	const line = row.context ? null : agentNowLine(agent);
	const level = Math.min(row.depth, MAX_INDENT_LEVELS);
	const expandable = row.childCount > 0;
	const nowText =
		line?.kind === "tool"
			? `${line.tool} ${sanitizeToolText(line.args)}`
			: line?.kind === "retry"
				? t("agents.now.retrying", {
						attempt: line.attempt,
						max: line.maxAttempts,
						error: sanitizeToolText(line.error),
					})
				: line
					? sanitizeToolText(line.text)
					: "";
	const titleTone =
		row.context || activity === "done" || activity === "stopped"
			? "text-[var(--omp-muted)]"
			: activity === "working"
				? "text-[var(--omp-text)]"
				: "text-[var(--omp-text-secondary)]";
	return (
		<div
			{...hover}
			aria-expanded={expandable ? !collapsed : undefined}
			aria-label={[title, activityLabel(agent), activity === "working" ? time : null, factsText, nowText || null]
				.filter(Boolean)
				.join(", ")}
			aria-level={row.depth + 1}
			aria-selected={selected}
			className={cx(
				"omp-roster-row omp-color-fade relative flex cursor-pointer rounded-lg py-1.5 pr-2 outline-none focus-visible:ring-1 focus-visible:ring-[var(--omp-border-strong)]",
				selected ? "bg-[var(--omp-selected-bg)]" : "hover:bg-[var(--omp-sidebar-item-hover)]",
			)}
			onClick={event => onOpen(event.altKey)}
			onFocus={event => {
				onFocus();
				hover.onFocus(event);
			}}
			onKeyDown={event => {
				hover.onKeyDown(event);
				if (!event.defaultPrevented && !event.isPropagationStopped()) onKeyDown(event);
			}}
			ref={rowRef}
			role="treeitem"
			style={{ paddingLeft: level * INDENT }}
			tabIndex={focusable ? 0 : -1}
		>
			{level > 0 && (
				<span
					aria-hidden
					className="pointer-events-none absolute top-0 h-[15px] w-2 rounded-bl-md border-b border-l border-[var(--omp-border-muted)]"
					style={{ left: (level - 1) * INDENT + 14 + 7 }}
				/>
			)}
			{level > 0 && hasNextSibling && (
				<span
					aria-hidden
					className="pointer-events-none absolute top-[15px] bottom-0 border-l border-[var(--omp-border-muted)]"
					style={{ left: (level - 1) * INDENT + 14 + 7 }}
				/>
			)}
			<span className="flex w-3.5 shrink-0 items-center justify-center self-start pt-[9px]">
				{expandable && (
					<button
						aria-label={collapsed ? t("agents.sidebar.expand") : t("agents.sidebar.collapse")}
						className="flex h-3.5 w-3.5 items-center justify-center text-[var(--omp-dim)] hover:text-[var(--omp-text)]"
						onClick={event => {
							event.stopPropagation();
							onToggle();
						}}
						tabIndex={-1}
						type="button"
					>
						<span
							aria-hidden
							className="omp-disclosure-chevron inline-block text-[10px] leading-none"
							style={{ transform: collapsed ? undefined : "rotate(90deg)" }}
						>
							›
						</span>
					</button>
				)}
			</span>
			<span className="flex w-4 shrink-0 justify-center self-start pt-[12px]">
				<AgentSignal activity={row.context ? "stopped" : activity} />
			</span>
			<span className="ml-1.5 min-w-0 flex-1">
				<span className="flex min-w-0 items-center gap-2">
					<span className={cx("min-w-0 truncate text-omp-md", titleTone)} title={title}>
						{title}
					</span>
					{expandable && collapsed && row.descendants > 0 && (
						<span className="omp-sidebar-agent-pill shrink-0">
							{row.workingBelow && (
								<span aria-hidden className="h-[5px] w-[5px] rounded-full bg-[var(--omp-accent)]" />
							)}
							{row.descendants}
						</span>
					)}
					<span
						className={cx(
							"ml-auto shrink-0 text-omp-xs tabular-nums",
							activity === "failed" ? "text-[var(--omp-error)]" : "text-[var(--omp-dim)]",
						)}
					>
						{row.context ? "" : time}
					</span>
				</span>
				<span className="mt-0.5 block truncate text-omp-xs text-[var(--omp-dim)]" title={factsText}>
					{factsText}
				</span>
				{line && (
					<span
						className={cx(
							"mt-0.5 block truncate text-omp-xs",
							line.kind === "retry" ? "text-[var(--omp-warning)]" : "text-[var(--omp-dim)]",
						)}
					>
						{line.kind === "tool" ? (
							<>
								<span className="font-mono text-[var(--omp-text-secondary)]">{line.tool}</span>{" "}
								<span className="font-mono">{sanitizeToolText(line.args)}</span>
							</>
						) : (
							nowText
						)}
					</span>
				)}
			</span>
		</div>
	);
});
