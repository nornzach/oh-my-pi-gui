import { Bot, Diff, FolderTree, Globe, LayoutDashboard, MessageCircleQuestion, SquareTerminal, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveTabRouteReady } from "../../hooks/use-active-tab-route";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { scrollStripOnWheel, useActiveChipInView } from "../../lib/strip-scroll";
import { useActiveTabKind, useTabsStore } from "../../stores/tabs";
import { CHAT_PANEL_TABS, type PanelTab, useUiStore } from "../../stores/ui";
import { AgentRoster, useAgentsTabSignal } from "../agents/AgentRoster";
import { PanelErrorBoundary } from "../common";
import { BrowserPanel } from "../panels/BrowserPanel";
import { BtwPanel } from "../panels/BtwPanel";
import { DiffPanel } from "../panels/DiffPanel";
import { FilesPanel } from "../panels/FilesPanel";
import { OverviewPanel } from "../panels/OverviewPanel";
import { TerminalPanel } from "../panels/TerminalPanel";

const MIN_WIDTH = 360;
const MAX_WIDTH = 840;
/** Web pages need room: the Browser view may take most of the window. */
const BROWSER_MAX_WIDTH = 1600;
/** Share of the window the drawer may cover while dragging (Browser / everything else). */
const BROWSER_HOST_SHARE = 0.75;
const HOST_SHARE = 0.55;
const PANEL_WIDTH_PREF = "gui.panelWidth";
/** Below this the inspector overlays instead of docking (see PanelContainer). */
const COMPACT_QUERY = "(max-width: 1000px)";

function defaultPanelWidth(): number {
	const viewportWidth = Number.isFinite(window.innerWidth) && window.innerWidth > 0 ? window.innerWidth : 1440;
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(viewportWidth * 0.28)));
}

const TABS: { id: PanelTab; labelKey: string; icon: typeof Diff }[] = [
	{ id: "overview", labelKey: "panel.tabs.overview", icon: LayoutDashboard },
	{ id: "agents", labelKey: "panel.tabs.agents", icon: Bot },
	{ id: "btw", labelKey: "panel.tabs.btw", icon: MessageCircleQuestion },
	{ id: "diff", labelKey: "panel.tabs.diff", icon: Diff },
	{ id: "files", labelKey: "panel.tabs.files", icon: FolderTree },
	{ id: "terminal", labelKey: "panel.tabs.terminal", icon: SquareTerminal },
	{ id: "browser", labelKey: "panel.tabs.browser", icon: Globe },
];

interface InspectorTabProps {
	label: string;
	/** What a screen reader announces: the label, plus any news the tab carries. */
	description: string;
	icon: typeof Diff;
	active: boolean;
	signal: "error" | "working" | null;
	onSelect: () => void;
}

/** One view in the header's switcher; beside window buttons the row can run out of room, so the selected tab scrolls into view. */
function InspectorTab({ label, description, icon: Icon, active, signal, onSelect }: InspectorTabProps) {
	const ref = useActiveChipInView<HTMLButtonElement>(active);
	return (
		<button
			ref={ref}
			aria-label={description}
			title={label}
			aria-pressed={active}
			type="button"
			onClick={onSelect}
			className="relative flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-2.5 text-omp-md font-medium"
		>
			<Icon size={14} />
			<span className="omp-inspector-tab-label">{label}</span>
			{signal && (
				<span
					aria-hidden
					className={cx(
						"absolute top-1 right-1 h-1.5 w-1.5 rounded-full",
						signal === "error" ? "bg-[var(--omp-error)]" : "bg-[var(--omp-accent)]",
					)}
				/>
			)}
		</button>
	);
}

/**
 * Review drawer: an overview of the session, what the agent changed and the
 * files it touched. Hidden by default; the bare toggle opens it on Overview,
 * while the transcript's "Review" link, a file link or /btw open their own tab. Live execution
 * state (todos, plan, subagents, queue) renders in the center dock above the
 * composer, and application logs live in their own dialog.
 */
export function PanelContainer() {
	const t = useT();
	const panelTab = useUiStore(s => s.panelTab);
	const setPanelTab = useUiStore(s => s.setPanelTab);
	const togglePanel = useUiStore(s => s.togglePanel);
	const activeTabId = useTabsStore(s => s.activeTabId);
	const split = useTabsStore(s => s.split);
	const routeReady = useActiveTabRouteReady();
	// ≤1000px: the inspector would squeeze the conversation below usability as
	// a flex sibling — render it as a right-anchored overlay instead (same
	// breakpoint App uses to auto-hide on shrink).
	const [compact, setCompactState] = useState(() =>
		typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_QUERY).matches : false,
	);
	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const media = window.matchMedia(COMPACT_QUERY);
		const onChange = () => setCompactState(media.matches);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);
	/** Chat tabs only expose files — diffs, shells, and agent browsing need tools. */
	const isChat = useActiveTabKind() === "chat";
	const visibleTabs = isChat ? TABS.filter(tab => CHAT_PANEL_TABS.has(tab.id)) : TABS;
	const visiblePanelTab = isChat && !CHAT_PANEL_TABS.has(panelTab) ? "files" : panelTab;
	const browsing = visiblePanelTab === "browser";
	const maxWidth = browsing ? BROWSER_MAX_WIDTH : MAX_WIDTH;
	const hostShare = browsing ? BROWSER_HOST_SHARE : HOST_SHARE;
	const agentsSignal = useAgentsTabSignal();

	const [width, setWidth] = useState(defaultPanelWidth);
	const [widthHydrated, setWidthHydrated] = useState(false);
	const dragging = useRef(false);

	useEffect(() => {
		let cancelled = false;
		const prefs = window.omp?.prefs;
		if (typeof prefs?.get !== "function") {
			setWidthHydrated(true);
			return;
		}
		void prefs
			.get(PANEL_WIDTH_PREF)
			.then(value => {
				if (cancelled) return;
				const saved = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
				if (saved !== null) {
					const viewportLimit = Math.max(MIN_WIDTH, Math.min(BROWSER_MAX_WIDTH, window.innerWidth - 56));
					setWidth(Math.min(viewportLimit, Math.max(MIN_WIDTH, saved)));
				}
				setWidthHydrated(true);
			})
			.catch(() => {
				if (!cancelled) setWidthHydrated(true);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!widthHydrated || typeof window.omp?.prefs?.set !== "function") return;
		const timer = window.setTimeout(() => {
			void window.omp.prefs.set(PANEL_WIDTH_PREF, Math.round(width)).catch(() => {});
		}, 150);
		return () => window.clearTimeout(timer);
	}, [width, widthHydrated]);

	useEffect(() => {
		const clampToViewport = () => {
			const viewportLimit = Math.max(MIN_WIDTH, Math.min(BROWSER_MAX_WIDTH, window.innerWidth - 56));
			setWidth(current => Math.min(current, viewportLimit));
		};
		window.addEventListener("resize", clampToViewport);
		return () => window.removeEventListener("resize", clampToViewport);
	}, []);

	const startDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
		dragging.current = true;
		e.currentTarget.setPointerCapture(e.pointerId);
	}, []);

	const onDrag = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			if (!dragging.current) return;
			// Panel is right-anchored: dragging left grows it.
			const hostLimit = Math.min(maxWidth, Math.round(window.innerWidth * hostShare));
			const next = Math.min(hostLimit, Math.max(MIN_WIDTH, window.innerWidth - e.clientX));
			setWidth(next);
		},
		[maxWidth, hostShare],
	);

	const endDrag = useCallback(() => {
		dragging.current = false;
	}, []);

	return (
		<aside
			aria-busy={!routeReady}
			className={cx(
				"omp-inspector relative flex h-full flex-col border-l border-[var(--omp-border-muted)]",
				compact || split ? "absolute inset-y-0 right-0 z-30 shadow-[var(--omp-shadow-lg)]" : "shrink-0",
				!routeReady && "pointer-events-none",
			)}
			// One saved width; views other than Browser cap it at their own maximum.
			style={{ width: Math.min(width, maxWidth) }}
		>
			{/* One header row: the view switcher and the close control. The panel's
			    name is announced, not printed — the tabs already say what it holds. */}
			<div className="omp-inspector-header drag-region flex h-12 shrink-0 items-center gap-2 border-b border-[var(--omp-border-muted)] pl-3">
				<h2 className="sr-only">
					{t("panel.title")} — {t("panel.subtitle")}
				</h2>
				<div className="omp-segmented omp-tab-scroller no-drag" onWheel={scrollStripOnWheel}>
					{visibleTabs.map(({ id, labelKey, icon }) => {
						const active = visiblePanelTab === id;
						return (
							<InspectorTab
								key={id}
								label={t(labelKey)}
								description={
									id === "agents" && agentsSignal.tone
										? t("agents.tab.label", {
												label: t(labelKey),
												state:
													agentsSignal.tone === "error"
														? t("agents.sidebar.moreFailed", { count: agentsSignal.failed })
														: t("agents.sidebar.moreWorking", { count: agentsSignal.working }),
											})
										: t(labelKey)
								}
								icon={icon}
								active={active}
								signal={id === "agents" && !active ? agentsSignal.tone : null}
								onSelect={() => setPanelTab(id)}
							/>
						);
					})}
				</div>
				<button
					type="button"
					onClick={togglePanel}
					title={t("panel.close")}
					className="omp-pressable no-drag ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
				>
					<X size={16} />
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden">
				<PanelErrorBoundary key={`${activeTabId ?? "no-tab"}:${visiblePanelTab}`}>
					{visiblePanelTab === "overview" && <OverviewPanel />}
					{visiblePanelTab === "agents" && <AgentRoster />}
					{visiblePanelTab === "btw" && <BtwPanel />}
					{visiblePanelTab === "diff" && <DiffPanel />}
					{visiblePanelTab === "files" && <FilesPanel />}
					{visiblePanelTab === "terminal" && <TerminalPanel />}
					{visiblePanelTab === "browser" && <BrowserPanel />}
				</PanelErrorBoundary>
			</div>
			<div
				role="separator"
				aria-orientation="vertical"
				aria-valuemin={MIN_WIDTH}
				aria-valuemax={maxWidth}
				aria-valuenow={Math.round(Math.min(width, maxWidth))}
				tabIndex={0}
				onPointerDown={startDrag}
				onPointerMove={onDrag}
				onPointerUp={endDrag}
				onKeyDown={event => {
					if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
					event.preventDefault();
					const viewportLimit = Math.max(MIN_WIDTH, Math.min(maxWidth, window.innerWidth - 56));
					const max = Math.min(maxWidth, viewportLimit);
					setWidth(current =>
						event.key === "Home"
							? MIN_WIDTH
							: event.key === "End"
								? max
								: Math.min(max, Math.max(MIN_WIDTH, current + (event.key === "ArrowLeft" ? 24 : -24))),
					);
				}}
				className="absolute inset-y-0 left-0 z-10 w-1 -translate-x-1/2 cursor-col-resize transition-colors hover:bg-[var(--omp-accent)]/40 active:bg-[var(--omp-accent)] max-[1000px]:hidden"
			/>
		</aside>
	);
}
