import { Bot, Diff, FolderTree, Globe, LayoutDashboard, MessageCircleQuestion, SquareTerminal, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveTabRouteReady } from "../../hooks/use-active-tab-route";
import { useViewportWidth } from "../../hooks/use-viewport-width";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { scrollStripOnWheel, useActiveChipInView } from "../../lib/strip-scroll";
import { useActiveTabKind, useTabsStore } from "../../stores/tabs";
import { CHAT_PANEL_TABS, type PanelTab, useUiStore } from "../../stores/ui";
import { AgentRoster, useAgentsTabSignal } from "../agents/AgentRoster";
import { PanelErrorBoundary } from "../common";
import { Glide } from "../common/Glide";
import { BrowserPanel } from "../panels/BrowserPanel";
import { BtwPanel } from "../panels/BtwPanel";
import { DiffPanel } from "../panels/DiffPanel";
import { FilesPanel } from "../panels/FilesPanel";
import { OverviewPanel } from "../panels/OverviewPanel";
import { TerminalPanel } from "../panels/TerminalPanel";

const MIN_WIDTH = 360;
const PANEL_WIDTH_PREF = "gui.panelWidth";
const COMPACT_WIDTH = 1000;

function defaultPanelWidth(viewportWidth: number): number {
	return Math.max(MIN_WIDTH, Math.round(viewportWidth * 0.28));
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
	/** Chat tabs expose only Overview, btw and Files — diffs, shells and agent browsing need tools. */
	const isChat = useActiveTabKind() === "chat";
	const visibleTabs = isChat ? TABS.filter(tab => CHAT_PANEL_TABS.has(tab.id)) : TABS;
	const visiblePanelTab = isChat && !CHAT_PANEL_TABS.has(panelTab) ? "files" : panelTab;
	const agentsSignal = useAgentsTabSignal();

	const viewportWidth = useViewportWidth();
	const [width, setWidth] = useState<number | "full" | null>(null);
	const dragging = useRef(false);
	const minWidth = Math.min(MIN_WIDTH, viewportWidth);
	const panelWidth =
		width === "full" ? viewportWidth : Math.min(width ?? defaultPanelWidth(viewportWidth), viewportWidth);
	const atLeftEdge = panelWidth === viewportWidth;
	// Switch to an overlay once a docked pane would crowd the conversation.
	const overlay = viewportWidth <= COMPACT_WIDTH || split || panelWidth > viewportWidth * 0.55;

	useEffect(() => {
		let cancelled = false;
		const prefs = window.omp?.prefs;
		if (typeof prefs?.get !== "function") return;
		void prefs
			.get(PANEL_WIDTH_PREF)
			.then(value => {
				if (cancelled) return;
				if (value === "full") setWidth(current => current ?? "full");
				else if (typeof value === "number" && Number.isFinite(value)) {
					setWidth(current => current ?? Math.max(MIN_WIDTH, Math.round(value)));
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (width === null || typeof window.omp?.prefs?.set !== "function") return;
		const timer = window.setTimeout(() => {
			void window.omp.prefs.set(PANEL_WIDTH_PREF, width).catch(() => {});
		}, 150);
		return () => window.clearTimeout(timer);
	}, [width]);

	const startDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
		dragging.current = true;
		e.currentTarget.setPointerCapture(e.pointerId);
	}, []);

	const onDrag = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			if (!dragging.current) return;
			setWidth(e.clientX <= 0 ? "full" : Math.max(minWidth, viewportWidth - e.clientX));
		},
		[minWidth, viewportWidth],
	);

	const endDrag = useCallback(() => {
		dragging.current = false;
	}, []);

	return (
		<aside
			aria-busy={!routeReady}
			data-inspector-left-edge={viewportWidth - panelWidth < 78 ? "" : undefined}
			className={cx(
				"omp-inspector flex h-full flex-col border-l border-[var(--omp-border-muted)]",
				overlay ? "absolute inset-y-0 right-0 z-30 shadow-[var(--omp-shadow-lg)]" : "relative shrink-0",
				!routeReady && "pointer-events-none",
			)}
			style={{ width: panelWidth }}
		>
			{/* One header row: the view switcher and the close control. The panel's
	    name is announced, not printed — the tabs already say what it holds. */}
			<div className="omp-inspector-header drag-region flex h-12 shrink-0 items-center gap-2 border-b border-[var(--omp-border-muted)] pl-3">
				<h2 className="sr-only">
					{t("panel.title")} — {t("panel.subtitle")}
				</h2>
				<div className="omp-segmented omp-tab-scroller no-drag" onWheel={scrollStripOnWheel}>
					<Glide activeKey={visiblePanelTab} selector='[aria-pressed="true"]' variant="thumb" />
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
				aria-label={t("panel.resize")}
				aria-orientation="vertical"
				aria-valuemin={minWidth}
				aria-valuemax={viewportWidth}
				aria-valuenow={Math.round(panelWidth)}
				tabIndex={0}
				onPointerDown={startDrag}
				onPointerMove={onDrag}
				onPointerUp={endDrag}
				onLostPointerCapture={endDrag}
				onKeyDown={event => {
					if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
					event.preventDefault();
					setWidth(
						event.key === "Home"
							? minWidth
							: event.key === "End"
								? "full"
								: Math.min(
										viewportWidth,
										Math.max(minWidth, panelWidth + (event.key === "ArrowLeft" ? 24 : -24)),
									),
					);
				}}
				className={cx(
					"no-drag absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize touch-none transition-colors hover:bg-(--omp-accent)/40 focus-visible:bg-(--omp-accent)/40 active:bg-(--omp-accent)",
					!atLeftEdge && "-translate-x-1/2",
				)}
			/>
		</aside>
	);
}
