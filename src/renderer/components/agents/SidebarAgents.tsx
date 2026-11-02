/**
 * Agents under their session in the sidebar (plan/24 §3.1, §5.3): this
 * turn's agents of a session open in a tab, at most five rows, then a line
 * that says how many more there are and how many of them work or failed.
 * When this turn spawned none, the session's earlier agents stay one click
 * away: the row keeps its arrow and count, closed until you open it.
 *
 * The scope renders the session row through a render prop, so the row can
 * carry the disclosure chevron and the collapsed count pill.
 */

import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useAgentPagesStore } from "../../stores/agent-pages";
import { SessionRuntimeProvider, sessionRuntime } from "../../stores/session-runtime-context";
import { useUiStore } from "../../stores/ui";
import { subagentPrimaryLabel } from "../panels/subagent-graph";
import { useAgentHoverCard } from "./AgentHoverCard";
import { AgentSignal, useActivityLabel } from "./AgentPage";
import { type AgentTreeRow, cutAgentTree } from "./agent-activity";
import { useAgentProjection } from "./use-agent-tree";

/** Rows shown under a session before the "N more" line. */
export const SIDEBAR_AGENT_LIMIT = 5;
/** Levels of indent; deeper agents keep the second level's. */
const MAX_LEVEL = 2;
const INDENT = 14;

export interface SidebarAgentsInfo {
	/** The agents listed, without context rows: this turn's, or every earlier one when this turn has none. */
	count: number;
	working: boolean;
	expanded: boolean;
	toggle: () => void;
	/** One of this session's pages is shown: the agent row holds the selection. */
	pageShown: boolean;
}

/**
 * Where the agent rows sit under their session row: the session's indent, the
 * tree lines that run past it (its ancestors', and its own on to a later
 * sibling), and whether its child sessions follow the agent rows.
 */
export interface SidebarAgentsLayout {
	offset: number;
	lines: readonly number[];
	trunk: boolean;
}

const FLAT_LAYOUT: SidebarAgentsLayout = { offset: 0, lines: [], trunk: false };

interface SidebarAgentsState {
	/** Your choice sticks per session while it is open; nothing expands on its own later. */
	expanded: Record<string, boolean>;
	/** Per session, the transcripts its agent rows stand for (see transcriptKey). */
	transcripts: Record<string, ReadonlySet<string>>;
}

const useSidebarAgentsStore = create<SidebarAgentsState>()(() => ({ expanded: {}, transcripts: {} }));

function setExpanded(key: string, value: boolean): void {
	useSidebarAgentsStore.setState(state => ({ expanded: { ...state.expanded, [key]: value } }));
}

function setTranscripts(key: string, files: ReadonlySet<string> | undefined): void {
	useSidebarAgentsStore.setState(state => {
		const { [key]: _previous, ...rest } = state.transcripts;
		return { transcripts: files ? { ...rest, [key]: files } : rest };
	});
}

/**
 * The transcripts each open session's agent rows stand for, so the sidebar
 * does not list them a second time. A session missing here has not drawn its
 * agent rows yet.
 */
export function useSidebarAgentTranscripts(): Record<string, ReadonlySet<string>> {
	return useSidebarAgentsStore(state => state.transcripts);
}

/** A transcript's folder and file name: its session's artifact folder makes it unique, whatever the path's prefix. */
export function transcriptKey(file: string): string {
	return file.replaceAll("\\", "/").split("/").slice(-2).join("/");
}

export function SessionAgentsScope({
	tabId,
	sessionKey,
	layout = FLAT_LAYOUT,
	children,
}: {
	tabId: string;
	sessionKey: string;
	layout?: SidebarAgentsLayout;
	children: (info: SidebarAgentsInfo | null) => ReactNode;
}) {
	const runtime = sessionRuntime(tabId);
	if (!runtime) return <>{children(null)}</>;
	return (
		<SessionRuntimeProvider runtime={runtime}>
			<SessionAgents layout={layout} sessionKey={sessionKey} tabId={tabId}>
				{children}
			</SessionAgents>
		</SessionRuntimeProvider>
	);
}

function SessionAgents({
	tabId,
	sessionKey,
	layout,
	children,
}: {
	tabId: string;
	sessionKey: string;
	layout: SidebarAgentsLayout;
	children: (info: SidebarAgentsInfo | null) => ReactNode;
}) {
	const projection = useAgentProjection();
	const stored = useSidebarAgentsStore(state => state.expanded[sessionKey]);
	const shownPage = useAgentPagesStore(state => state.shown[tabId] ?? null);
	const thisTurn = projection.turnCount > 0;
	const rows = thisTurn ? projection.turn : projection.all;
	const count = thisTurn ? projection.turnCount : projection.allCount;
	// The first time a session has this turn's agents in view, it opens.
	useEffect(() => {
		if (thisTurn && stored === undefined) setExpanded(sessionKey, true);
	}, [thisTurn, sessionKey, stored]);
	const expanded = stored ?? thisTurn;
	// The sidebar lists this session's subagent transcripts only where no agent row stands for one.
	const files = rows.flatMap(row => (row.agent.sessionFile ? [transcriptKey(row.agent.sessionFile)] : [])).join("\n");
	useEffect(() => {
		setTranscripts(sessionKey, new Set(files ? files.split("\n") : []));
		return () => setTranscripts(sessionKey, undefined);
	}, [files, sessionKey]);
	const working = rows.some(row => !row.context && row.activity === "working");
	const info = useMemo<SidebarAgentsInfo | null>(
		() =>
			count === 0
				? null
				: {
						count,
						working,
						expanded,
						toggle: () => setExpanded(sessionKey, !expanded),
						pageShown: shownPage !== null,
					},
		[count, expanded, sessionKey, shownPage, working],
	);
	return (
		<>
			{children(info)}
			{info?.expanded && <SidebarAgentRows layout={layout} rows={rows} shownPage={shownPage} tabId={tabId} />}
		</>
	);
}

function SidebarAgentRows({
	tabId,
	rows,
	shownPage,
	layout,
}: {
	tabId: string;
	rows: readonly AgentTreeRow[];
	shownPage: string | null;
	layout: SidebarAgentsLayout;
}) {
	const t = useT();
	const cut = useMemo(() => cutAgentTree(rows, SIDEBAR_AGENT_LIMIT), [rows]);
	const openDrawer = () => useUiStore.getState().setPanelTab("agents");
	return (
		<div className="omp-sidebar-agents relative" role="group">
			{layout.lines.map(x => (
				<span
					aria-hidden
					className="omp-sidebar-agent-guide omp-sidebar-agent-guide--full"
					key={x}
					style={{ left: x, top: -1 }}
				/>
			))}
			{cut.rows.map((row, index) => (
				<SidebarAgentRow
					hasNextSibling={hasNextSibling(cut.rows, index) || ((cut.hidden > 0 || layout.trunk) && row.depth === 0)}
					key={row.agent.id}
					offset={layout.offset}
					rootGuide={row.depth > 0 && (cut.hidden > 0 || layout.trunk || laterRoot(cut.rows, index))}
					row={row}
					selected={shownPage === row.agent.id}
					tabId={tabId}
				/>
			))}
			{cut.hidden > 0 && (
				<button
					className="omp-sidebar-agent-row omp-color-fade relative flex h-7 w-full items-center rounded-lg pr-2 text-left text-omp-sm text-[var(--omp-dim)] hover:bg-[var(--omp-sidebar-item-hover)]"
					onClick={openDrawer}
					style={{ paddingLeft: 8 + INDENT + 16 + 8 + layout.offset }}
					type="button"
				>
					<span aria-hidden className="omp-sidebar-agent-elbow" style={{ left: 15 + layout.offset }} />
					{layout.trunk && (
						<span aria-hidden className="omp-sidebar-agent-guide" style={{ left: 15 + layout.offset }} />
					)}
					<span className="min-w-0 truncate">
						{t("agents.sidebar.more", { count: cut.hidden })}
						{cut.hiddenWorking > 0 && <> · {t("agents.sidebar.moreWorking", { count: cut.hiddenWorking })}</>}
						{cut.hiddenFailed > 0 && (
							<span className="text-[var(--omp-error)]">
								{" "}
								· {t("agents.sidebar.moreFailed", { count: cut.hiddenFailed })}
							</span>
						)}
					</span>
				</button>
			)}
		</div>
	);
}

function laterRoot(rows: readonly AgentTreeRow[], index: number): boolean {
	return rows.slice(index + 1).some(row => row.depth === 0);
}

/** A later row at the same depth before any shallower one: the guide continues down. */
function hasNextSibling(rows: readonly AgentTreeRow[], index: number): boolean {
	const depth = rows[index]?.depth ?? 0;
	for (let next = index + 1; next < rows.length; next++) {
		const candidate = rows[next]!.depth;
		if (candidate === depth) return true;
		if (candidate < depth) return false;
	}
	return false;
}

function SidebarAgentRow({
	tabId,
	row,
	selected,
	hasNextSibling,
	rootGuide,
	offset,
}: {
	tabId: string;
	row: AgentTreeRow;
	selected: boolean;
	hasNextSibling: boolean;
	/** The session row's indent. */
	offset: number;
	/** A first-level sibling follows this nested row: the first level's guide runs through it. */
	rootGuide: boolean;
}) {
	const t = useT();
	const activityLabel = useActivityLabel();
	const hover = useAgentHoverCard(tabId, row.agent.id, "right");
	const level = Math.min(row.depth, MAX_LEVEL - 1) + 1;
	// The session's signal dot sits at 16 px; each level's dot 14 px further in.
	const parentDot = 16 + (level - 1) * INDENT + offset;
	const title = subagentPrimaryLabel(row.agent);
	const state = activityLabel(row.agent);
	return (
		<button
			{...hover}
			aria-current={selected ? "page" : undefined}
			aria-label={t("agents.sidebar.rowLabel", { title, state })}
			className={cx(
				"omp-sidebar-agent-row omp-color-fade relative flex h-7 w-full items-center rounded-lg pr-2 text-left",
				selected ? "bg-[var(--omp-selected-bg)]" : "hover:bg-[var(--omp-sidebar-item-hover)]",
			)}
			onClick={event => useAgentPagesStore.getState().open(tabId, row.agent.id, { beside: event.altKey })}
			style={{ paddingLeft: 8 + level * INDENT + offset }}
			title={title}
			type="button"
		>
			<span aria-hidden className="omp-sidebar-agent-elbow" style={{ left: parentDot - 1 }} />
			{hasNextSibling && <span aria-hidden className="omp-sidebar-agent-guide" style={{ left: parentDot - 1 }} />}
			{rootGuide && (
				<span
					aria-hidden
					className="omp-sidebar-agent-guide omp-sidebar-agent-guide--full"
					style={{ left: 15 + offset }}
				/>
			)}
			<span aria-hidden className="mr-2 flex w-4 shrink-0 justify-center">
				<AgentSignal activity={row.activity} />
			</span>
			<span
				className={cx(
					"min-w-0 flex-1 truncate text-omp-sm",
					row.activity === "working" && !row.context
						? "text-[var(--omp-text-secondary)]"
						: "text-[var(--omp-muted)]",
				)}
			>
				{title}
			</span>
			{row.activity === "failed" && (
				<span className="ml-2 shrink-0 text-omp-xs text-[var(--omp-error)]">{state}</span>
			)}
		</button>
	);
}
