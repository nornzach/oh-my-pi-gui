import { Columns2, Rows2, X } from "lucide-react";
import {
	type CSSProperties,
	type DragEvent,
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSessionList } from "../../hooks/use-session-list";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useAgentPagesStore } from "../../stores/agent-pages";
import { useSessionStore } from "../../stores/session";
import { SessionRuntimeProvider } from "../../stores/session-runtime-context";
import { ensureTabRuntime } from "../../stores/tab-runtime";
import { type SplitAxis, type SplitPlacement, tabDisplayTitle, useTabsStore } from "../../stores/tabs";
import { AgentBeside } from "../agents/AgentBeside";
import { AgentPage } from "../agents/AgentPage";
import { ChatStream } from "../chat/ChatStream";
import { WorkspaceDock } from "../chat/dock/WorkspaceDock";
import { InputArea } from "./InputArea";
import { useComposerFiles } from "./use-composer-files";

const DIVIDER_SIZE = 5;
const RATIO_STEP = 0.05;
const MIN_COLUMN_SPLIT_WIDTH = 680;

function placementFromPointer(event: DragEvent<HTMLDivElement>): SplitPlacement {
	const bounds = event.currentTarget.getBoundingClientRect();
	const x = (event.clientX - bounds.left) / bounds.width;
	const y = (event.clientY - bounds.top) / bounds.height;
	return Math.min(x, 1 - x) < Math.min(y, 1 - y) ? (x < 0.5 ? "left" : "right") : y < 0.5 ? "top" : "bottom";
}

function SplitDropOverlay({ placement }: { placement: SplitPlacement }) {
	const t = useT();
	const zones: Array<{ placement: SplitPlacement; className: string }> = [
		{ placement: "top", className: "col-start-2 row-start-1" },
		{ placement: "left", className: "col-start-1 row-start-2" },
		{ placement: "right", className: "col-start-3 row-start-2" },
		{ placement: "bottom", className: "col-start-2 row-start-3" },
	];
	return (
		<div className="pointer-events-none absolute inset-0 z-50 grid grid-cols-3 grid-rows-3 gap-3 bg-[var(--omp-overlay-bg)] p-6 omp-drop-overlay backdrop-blur-[2px]">
			{zones.map(zone => (
				<div
					key={zone.placement}
					className={cx(
						zone.className,
						"flex items-center justify-center rounded-xl border text-omp-sm font-medium transition-colors",
						zone.placement === placement
							? "border-[var(--omp-accent)] bg-[var(--omp-accent-dim)] text-[var(--omp-accent)]"
							: "border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] text-[var(--omp-dim)]",
					)}
				>
					{t(`tabs.menu.split${zone.placement[0]?.toUpperCase()}${zone.placement.slice(1)}`)}
				</div>
			))}
		</div>
	);
}

/** Over a pair, a dragged tab takes the pane under the pointer; that pane's tab goes back to the strip. */
function PaneDropOverlay({ axis, ratio, firstPane }: { axis: SplitAxis; ratio: number; firstPane: boolean }) {
	const t = useT();
	const cell = (targeted: boolean) => (
		<div
			className={cx(
				"m-4 flex items-center justify-center rounded-xl border text-omp-sm font-medium transition-colors",
				targeted
					? "border-[var(--omp-accent)] bg-[var(--omp-accent-dim)] text-[var(--omp-accent)]"
					: "border-transparent text-transparent",
			)}
		>
			{t("split.replacePane")}
		</div>
	);
	return (
		<div
			className="pointer-events-none absolute inset-0 z-50 grid bg-[var(--omp-overlay-bg)] omp-drop-overlay backdrop-blur-[2px]"
			style={splitGrid(axis, ratio)}
		>
			{cell(firstPane)}
			<div />
			{cell(!firstPane)}
		</div>
	);
}

function SessionPane({ tabId, split, label }: { tabId: string; split: boolean; label: string }) {
	const t = useT();
	const runtime = ensureTabRuntime(tabId);
	const tab = useTabsStore(state => state.tabs.find(entry => entry.id === tabId));
	const active = useTabsStore(state => state.activeTabId === tabId);
	const switchTab = useTabsStore(state => state.switchTab);
	const unsplit = useTabsStore(state => state.unsplit);
	// The pane's ✕ takes this session out of the split: the other pane stays.
	const otherPane = useTabsStore(state =>
		state.split ? (state.split.firstTabId === tabId ? state.split.secondTabId : state.split.firstTabId) : null,
	);
	if (!tab) return null;
	const running = tab.status === "running" || tab.compacting === true || tab.backgroundCompacting === true;
	const signalActive = running || tab.status === "starting" || tab.status === "restarting";
	const signalColor = running
		? "var(--omp-accent)"
		: tab.unreadDone
			? "var(--omp-success)"
			: tab.status === "ready" || tab.status === "asleep"
				? "var(--omp-dim)"
				: tab.status === "error" || tab.status === "exited"
					? "var(--omp-error)"
					: "var(--omp-warning)";

	return (
		<SessionRuntimeProvider runtime={runtime}>
			<section
				aria-label={t("split.paneLabel", { title: label })}
				data-active={active ? "true" : "false"}
				onPointerDownCapture={event => {
					// Pressing the pane's ✕ removes it; focusing it first would only flash.
					if (!active && !(event.target as Element).closest("[data-pane-remove]")) void switchTab(tabId);
				}}
				className={cx(
					"omp-session-pane relative flex min-h-0 min-w-0 flex-col overflow-hidden",
					active && split && "omp-session-pane--active",
				)}
			>
				{split && (
					<header className="relative flex h-8 shrink-0 items-center gap-2 border-b border-[var(--omp-border-muted)] pr-3 pl-5 text-omp-sm">
						<span
							aria-hidden
							className={cx("omp-signal-light omp-tab-signal", signalActive && "omp-signal-light--active")}
							style={{ color: signalColor, left: "0.5rem" }}
						/>
						<span className="min-w-0 flex-1 truncate font-medium text-[var(--omp-text)]">{label}</span>
						<span className="omp-session-pane-cwd max-w-[45%] truncate text-[var(--omp-dim)]">{tab.cwd}</span>
						<button
							type="button"
							data-pane-remove
							onClick={() => void unsplit(otherPane ?? tabId)}
							aria-label={t("split.removePane")}
							title={t("split.removePane")}
							className="omp-pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--omp-dim)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
						>
							<X size={13} />
						</button>
					</header>
				)}
				<SessionPaneBody label={label} tabId={tabId} />
			</section>
		</SessionRuntimeProvider>
	);
}

/**
 * The conversation, or one of the tab's subagent pages in its place, or a
 * page beside it (plan/24 §7). The conversation unmounts while a page is
 * shown; its saved transcript view and draft bring it back as it was.
 */
function SessionPaneBody({ tabId, label }: { tabId: string; label: string }) {
	const shownPage = useAgentPagesStore(state => state.shown[tabId] ?? null);
	const besidePage = useAgentPagesStore(state => state.beside[tabId] ?? null);
	const sessionId = useSessionStore(state => state.sessionId);
	// Pages belong to a session: a new session in this tab closes them.
	useEffect(() => {
		const recorded = useAgentPagesStore.getState().sessions[tabId];
		if (recorded && sessionId && recorded !== sessionId) useAgentPagesStore.getState().drop(tabId);
	}, [sessionId, tabId]);

	if (shownPage) return <AgentPage agentId={shownPage} key={shownPage} tabId={tabId} />;
	const conversation = <SessionConversation />;
	if (!besidePage) return conversation;
	return (
		<AgentBeside
			conversation={
				<>
					<header className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--omp-border-muted)] px-3 text-omp-sm">
						<span className="min-w-0 flex-1 truncate font-medium text-[var(--omp-text)]">{label}</span>
					</header>
					{conversation}
				</>
			}
			page={<AgentPage agentId={besidePage} beside key={besidePage} tabId={tabId} />}
		/>
	);
}

function SessionConversation() {
	const { attachFiles, readOnly } = useComposerFiles();
	const [draggingFiles, setDraggingFiles] = useState(false);
	return (
		<div
			className={cx(
				"relative flex min-h-0 min-w-0 flex-1 flex-col",
				draggingFiles &&
					!readOnly &&
					"after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-lg after:border-2 after:border-(--omp-accent)",
			)}
			onDragOver={event => {
				if (!event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = readOnly ? "none" : "copy";
				setDraggingFiles(!readOnly);
			}}
			onDragLeave={event => {
				const next = event.relatedTarget;
				if (next instanceof Node && event.currentTarget.contains(next)) return;
				setDraggingFiles(false);
			}}
			onDrop={event => {
				setDraggingFiles(false);
				if (event.dataTransfer.files.length === 0) return;
				event.preventDefault();
				event.stopPropagation();
				if (readOnly) return;
				attachFiles(Array.from(event.dataTransfer.files));
				const composer = event.currentTarget.querySelector<HTMLTextAreaElement>(".omp-composer-box textarea");
				requestAnimationFrame(() => composer?.focus());
			}}
		>
			<ChatStream footer={<WorkspaceDock />} />
			<InputArea />
		</div>
	);
}

function splitGrid(axis: SplitAxis, ratio: number): CSSProperties {
	const tracks = `minmax(0, ${ratio}fr) ${DIVIDER_SIZE}px minmax(0, ${1 - ratio}fr)`;
	return axis === "columns"
		? { gridTemplateColumns: tracks, gridTemplateRows: "minmax(0, 1fr)" }
		: { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: tracks };
}

export function SplitWorkspace() {
	const t = useT();
	const { sessions } = useSessionList("global");
	const tabs = useTabsStore(state => state.tabs);
	const activeTabId = useTabsStore(state => state.activeTabId);
	const split = useTabsStore(state => state.split);
	const splitTab = useTabsStore(state => state.splitTab);
	const replacePane = useTabsStore(state => state.replacePane);
	const setSplitRatio = useTabsStore(state => state.setSplitRatio);
	const rootRef = useRef<HTMLDivElement>(null);
	const [narrow, setNarrow] = useState(false);
	const axis = split?.axis === "rows" || narrow ? "rows" : "columns";
	const draggingRef = useRef(false);
	const pendingRatioRef = useRef<number | null>(null);
	const frameRef = useRef<number | null>(null);
	const [dragTabId, setDragTabId] = useState<string | null>(null);
	/** The drag is over this workspace (a drag along the tab strip only reorders). */
	const [dragOver, setDragOver] = useState(false);
	const [dropPlacement, setDropPlacement] = useState<SplitPlacement>("right");
	const [dropPane, setDropPane] = useState<string | null>(null);
	const sessionsById = useMemo(() => new Map(sessions.map(session => [session.id, session])), [sessions]);
	const sessionsByPath = useMemo(() => new Map(sessions.map(session => [session.path, session])), [sessions]);
	const pane = (tabId: string, isSplit: boolean) => {
		const tab = tabs.find(entry => entry.id === tabId);
		if (!tab) return null;
		const indexedSession =
			(tab.sessionPath ? sessionsByPath.get(tab.sessionPath) : undefined) ??
			(tab.sessionId ? sessionsById.get(tab.sessionId) : undefined);
		return (
			<SessionPane
				tabId={tabId}
				split={isSplit}
				label={tabDisplayTitle(tab, tabs, indexedSession, t("sidebar.untitled"))}
			/>
		);
	};

	useEffect(
		() => () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		},
		[],
	);
	useLayoutEffect(() => {
		if (!activeTabId) return;
		const root = rootRef.current;
		if (!root || typeof ResizeObserver === "undefined") return;
		const update = () => {
			const width = root.getBoundingClientRect().width;
			if (width > 0) setNarrow(width < MIN_COLUMN_SPLIT_WIDTH);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(root);
		return () => observer.disconnect();
	}, [activeTabId]);
	useEffect(() => {
		const onTabDrag = (event: Event) => {
			const tabId = (event as CustomEvent<{ tabId: string | null }>).detail.tabId;
			setDragTabId(tabId);
			if (!tabId) setDragOver(false);
		};
		window.addEventListener("omp:tab-drag", onTabDrag);
		return () => window.removeEventListener("omp:tab-drag", onTabDrag);
	}, []);

	if (!activeTabId) return null;
	// A tab already on screen is not a valid drop target — re-dropping it would
	// silently reset the ratio/axis (the store refuses it anyway; the overlay
	// must not invite the gesture).
	const canDrop =
		dragTabId !== null &&
		dragTabId !== activeTabId &&
		!(split && (split.firstTabId === dragTabId || split.secondTabId === dragTabId));
	// Over one session the drop pairs the dragged tab with it, on the side the
	// pointer picks; over a pair it replaces the pane under the pointer.
	const paneFromPointer = (event: DragEvent<HTMLDivElement>): string | null => {
		if (!split) return null;
		const bounds = event.currentTarget.getBoundingClientRect();
		const along =
			axis === "columns"
				? (event.clientX - bounds.left) / bounds.width
				: (event.clientY - bounds.top) / bounds.height;
		return along < split.ratio ? split.firstTabId : split.secondTabId;
	};
	const dropProps = {
		onDragOver: (event: DragEvent<HTMLDivElement>) => {
			if (!canDrop) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
			setDragOver(true);
			if (split) setDropPane(paneFromPointer(event));
			else setDropPlacement(placementFromPointer(event));
		},
		onDragLeave: (event: DragEvent<HTMLDivElement>) => {
			if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setDragOver(false);
		},
		onDrop: (event: DragEvent<HTMLDivElement>) => {
			if (!canDrop || !dragTabId) return;
			event.preventDefault();
			const pane = paneFromPointer(event);
			if (pane) void replacePane(pane, dragTabId);
			else void splitTab(dragTabId, placementFromPointer(event));
			setDragTabId(null);
			setDragOver(false);
		},
	};
	const showDrop = canDrop && dragOver;
	if (!split) {
		return (
			<div ref={rootRef} className="omp-split-workspace relative grid min-h-0 flex-1" {...dropProps}>
				{pane(activeTabId, false)}
				{showDrop && <SplitDropOverlay placement={dropPlacement} />}
			</div>
		);
	}

	const applyRatio = (ratio: number) => {
		pendingRatioRef.current = ratio;
		if (frameRef.current !== null) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = null;
			if (!rootRef.current || pendingRatioRef.current === null) return;
			Object.assign(rootRef.current.style, splitGrid(axis, pendingRatioRef.current));
		});
	};
	const ratioFromPointer = (event: PointerEvent<HTMLDivElement>) => {
		const bounds = rootRef.current?.getBoundingClientRect();
		if (!bounds) return split.ratio;
		const raw =
			axis === "columns"
				? (event.clientX - bounds.left) / bounds.width
				: (event.clientY - bounds.top) / bounds.height;
		return Math.min(0.8, Math.max(0.2, raw));
	};
	const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) return;
		draggingRef.current = false;
		event.currentTarget.releasePointerCapture(event.pointerId);
		const ratio = pendingRatioRef.current ?? split.ratio;
		pendingRatioRef.current = null;
		setSplitRatio(ratio);
	};
	const adjustFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
		const decrement = axis === "columns" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
		const increment = axis === "columns" ? event.key === "ArrowRight" : event.key === "ArrowDown";
		if (!decrement && !increment) return;
		event.preventDefault();
		setSplitRatio(split.ratio + (increment ? RATIO_STEP : -RATIO_STEP));
	};

	return (
		<div
			ref={rootRef}
			className="omp-split-workspace relative grid min-h-0 flex-1"
			style={splitGrid(axis, split.ratio)}
			{...dropProps}
		>
			{pane(split.firstTabId, true)}
			<div
				role="separator"
				tabIndex={0}
				aria-label={t("split.resize")}
				aria-orientation={axis === "columns" ? "vertical" : "horizontal"}
				aria-valuemin={20}
				aria-valuemax={80}
				aria-valuenow={Math.round(split.ratio * 100)}
				onKeyDown={adjustFromKeyboard}
				onPointerDown={event => {
					draggingRef.current = true;
					pendingRatioRef.current = split.ratio;
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={event => {
					if (draggingRef.current) applyRatio(ratioFromPointer(event));
				}}
				onPointerUp={finishDrag}
				onPointerCancel={finishDrag}
				className={cx(
					"omp-split-divider group relative z-20 touch-none bg-[var(--omp-border-muted)] focus-visible:bg-[var(--omp-accent)]",
					axis === "columns" ? "cursor-col-resize" : "cursor-row-resize",
				)}
			>
				<span className="pointer-events-none absolute inset-0 m-auto flex h-5 w-5 items-center justify-center rounded-full bg-[var(--omp-bg-elevated)] text-[var(--omp-dim)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
					{axis === "columns" ? <Columns2 size={12} /> : <Rows2 size={12} />}
				</span>
			</div>
			{pane(split.secondTabId, true)}
			{showDrop && dropPane && (
				<PaneDropOverlay axis={axis} ratio={split.ratio} firstPane={dropPane === split.firstTabId} />
			)}
		</div>
	);
}
