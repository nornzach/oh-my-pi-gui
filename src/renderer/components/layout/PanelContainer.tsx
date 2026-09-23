import { Diff, FolderTree, ScrollText, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveTabRouteReady } from "../../hooks/use-active-tab-route";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useActiveTabKind, useTabsStore } from "../../stores/tabs";
import type { PanelTab } from "../../stores/ui";
import { useUiStore } from "../../stores/ui";
import { PanelErrorBoundary } from "../common";
import { DiffPanel } from "../panels/DiffPanel";
import { FilesPanel } from "../panels/FilesPanel";
import { LogPanel } from "../panels/LogPanel";

const MIN_WIDTH = 360;
const MAX_WIDTH = 840;
const PANEL_WIDTH_PREF = "gui.panelWidth";
/** Below this the inspector overlays instead of docking (see PanelContainer). */
const COMPACT_QUERY = "(max-width: 1000px)";

function defaultPanelWidth(): number {
	const viewportWidth = Number.isFinite(window.innerWidth) && window.innerWidth > 0 ? window.innerWidth : 1440;
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(viewportWidth * 0.28)));
}

const TABS: { id: PanelTab; labelKey: string; icon: typeof Diff }[] = [
	{ id: "diff", labelKey: "panel.tabs.diff", icon: Diff },
	{ id: "files", labelKey: "panel.tabs.files", icon: FolderTree },
	{ id: "logs", labelKey: "panel.tabs.logs", icon: ScrollText },
];

/** Drawer tabs meaningful in a tool-free chat tab (no diffs without tools). */
const CHAT_TAB_IDS: ReadonlySet<PanelTab> = new Set(["files", "logs"]);

/**
 * Contextual workspace drawer. Hidden by default; opened explicitly for
 * diffs, files, or logs without shrinking the core chat. Live execution
 * state (todos, plan, subagents, queue) renders in the center dock above
 * the composer instead — see chat/dock/WorkspaceDock.
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
	/** Chat tabs only expose files + logs — diffs can't exist without tools. */
	const isChat = useActiveTabKind() === "chat";
	const visibleTabs = isChat ? TABS.filter(tab => CHAT_TAB_IDS.has(tab.id)) : TABS;
	const visiblePanelTab = isChat && !CHAT_TAB_IDS.has(panelTab) ? "files" : panelTab;

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
					const viewportLimit = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 56));
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
			const viewportLimit = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 56));
			setWidth(current => Math.min(current, viewportLimit));
		};
		window.addEventListener("resize", clampToViewport);
		return () => window.removeEventListener("resize", clampToViewport);
	}, []);

	const startDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
		dragging.current = true;
		e.currentTarget.setPointerCapture(e.pointerId);
	}, []);

	const onDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
		if (!dragging.current) return;
		// Panel is right-anchored: dragging left grows it.
		const hostLimit = Math.min(MAX_WIDTH, Math.round(window.innerWidth * 0.55));
		const next = Math.min(hostLimit, Math.max(MIN_WIDTH, window.innerWidth - e.clientX));
		setWidth(next);
	}, []);

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
			style={{ width }}
		>
			<div className="flex h-[52px] shrink-0 items-center border-b border-[var(--omp-border-muted)] px-4">
				<div>
					<div className="text-omp-lg font-semibold text-[var(--omp-text)]">{t("panel.title")}</div>
					<div className="text-omp-md text-[var(--omp-dim)]">{t("panel.subtitle")}</div>
				</div>
				<button
					type="button"
					onClick={togglePanel}
					title={t("panel.close")}
					className="omp-pressable ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
				>
					<X size={17} />
				</button>
			</div>
			<div className="flex h-11 shrink-0 items-center overflow-x-auto border-b border-[var(--omp-border-muted)] px-3">
				<div
					className="flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--omp-bg-secondary)] p-0.5" // surface-ok: segmented tab track is panel chrome
				>
					{visibleTabs.map(({ id, labelKey, icon: Icon }) => {
						const active = visiblePanelTab === id;
						return (
							<button
								key={id}
								aria-label={t(labelKey)}
								title={t(labelKey)}
								aria-pressed={active}
								type="button"
								onClick={() => setPanelTab(id)}
								className={cx(
									"omp-pressable relative flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-omp-md font-medium",
									active
										? "bg-[var(--omp-bg-elevated)] text-[var(--omp-text)] shadow-(--omp-shadow-sm)"
										: "text-[var(--omp-muted)] hover:text-[var(--omp-text)]",
								)}
							>
								<Icon size={14} />
								<span className="omp-inspector-tab-label">{t(labelKey)}</span>
							</button>
						);
					})}
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden">
				<PanelErrorBoundary key={`${activeTabId ?? "no-tab"}:${visiblePanelTab}`}>
					{visiblePanelTab === "diff" && <DiffPanel />}
					{visiblePanelTab === "files" && <FilesPanel />}
					{visiblePanelTab === "logs" && <LogPanel />}
				</PanelErrorBoundary>
			</div>
			<div
				role="separator"
				aria-orientation="vertical"
				aria-valuemin={MIN_WIDTH}
				aria-valuemax={MAX_WIDTH}
				aria-valuenow={Math.round(width)}
				tabIndex={0}
				onPointerDown={startDrag}
				onPointerMove={onDrag}
				onPointerUp={endDrag}
				onKeyDown={event => {
					if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
					event.preventDefault();
					const viewportLimit = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 56));
					const max = Math.min(MAX_WIDTH, viewportLimit);
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
