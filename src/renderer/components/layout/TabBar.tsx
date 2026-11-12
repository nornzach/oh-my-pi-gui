/**
 * Session tab strip, mounted between TitleBar and SidecarBanner. One chip per
 * pooled sidecar tab: session title (or cwd basename; identical untitled
 * labels disambiguate with an index suffix), a slow status signal, a muted
 * workspace subtitle, a close × (hidden at the single-tab floor,
 * inline-confirmed while a run is live), and a trailing "+" that opens a
 * fresh session tab in the current cwd.
 *
 * gui#30: chips drag to reorder; a split pair is one merged chip whose halves
 * select its tabs; chips shrink to their set minimum width before the strip
 * scrolls (or wraps onto up to three rows), and an "all tabs" list reaches
 * whatever is out of view.
 */

import {
	Check,
	ChevronDown,
	Columns2,
	GitBranch,
	GitBranchPlus,
	MessageCircle,
	MessageCirclePlus,
	MoreHorizontal,
	Plus,
	Rows2,
	SplitSquareHorizontal,
	Unlink,
	X,
} from "lucide-react";
import {
	Fragment,
	type DragEvent as ReactDragEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSessionList } from "../../hooks/use-session-list";
import { basename, cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { actionChords, KEYMAP_ACTION_BY_ID, onEscape } from "../../lib/keymap";
import { sessionHasContent } from "../../lib/session-title";
import { scrollStripOnWheel } from "../../lib/strip-scroll";
import { type LiveTabRuntime, performTabClose, tabNeedsCloseConfirm } from "../../lib/tab-close";
import { tabSignalPresentation } from "../../lib/tab-signal";
import { useAgentPagesStore } from "../../stores/agent-pages";
import type { ComposerStore } from "../../stores/composer";
import { useComposerStore } from "../../stores/composer";
import type { MessagesStore } from "../../stores/messages";
import { useMessagesStore } from "../../stores/messages";
import type { QueueStore } from "../../stores/queue";
import { useQueueStore } from "../../stores/queue";
import type { SessionStore } from "../../stores/session";
import { useSessionStore } from "../../stores/session";
import { sessionRuntimeStore } from "../../stores/session-runtime-context";
import { useSidebarPrefs } from "../../stores/sidebar-prefs";
import {
	groupOf,
	type SessionTab,
	type TabDropSide,
	type TabUnit,
	tabDisplayTitle,
	tabUnits,
	unitFocusTabId,
	useTabsStore,
	visibleTabIds,
} from "../../stores/tabs";
import { type TabWidth, useEffectiveKeymapOverrides, useUiStore } from "../../stores/ui";
import { AgentPageChips } from "../agents/AgentPageChips";
import { anchorFromEvent, ContextMenu, type ContextMenuAnchor, type ContextMenuItem } from "../common/ContextMenu";
import { type TabSearchEntry, TabSearchMenu } from "./TabSearchMenu";

/** Auto-cancel window for the armed close confirm (injectable for tests). */
const CONFIRM_CLOSE_MS = 3000;

/** Chip width bounds per Settings → GUI → Tab bar: chips shrink to the minimum before the strip scrolls. */
const CHIP_WIDTH: Record<TabWidth, string> = {
	compact: "min-w-20 max-w-36",
	default: "min-w-28 max-w-52",
	wide: "min-w-36 max-w-80",
};

/** Which side of a chip a drag over it would land on. */
function dropSide(event: ReactDragEvent<HTMLElement>): TabDropSide {
	const bounds = event.currentTarget.getBoundingClientRect();
	return event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
}

interface ChipDropProps {
	"data-drop"?: TabDropSide;
	onDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void;
	onDragLeave?: (event: ReactDragEvent<HTMLDivElement>) => void;
	onDrop?: (event: ReactDragEvent<HTMLDivElement>) => void;
}

function TabChip({
	tab,
	active,
	visible,
	label,
	workspaceLabel,
	width,
	paired,
	dropProps,
	confirmingClose,
	closeNeedsConfirm,
	onArmClose,
	onConfirmClose,
	onCancelClose,
	onContextMenu,
	onKeyboardNavigate,
}: {
	tab: SessionTab;
	active: boolean;
	visible: boolean;
	label: string;
	workspaceLabel: string;
	width: TabWidth;
	/** A half of a merged split-pair chip: the pair draws the frame and takes drops. */
	paired: boolean;
	/** Reorder drop target wiring for a single chip (a pair's frame takes it instead). */
	dropProps?: ChipDropProps;
	confirmingClose: boolean;
	closeNeedsConfirm: boolean;
	onArmClose: () => void;
	onConfirmClose: () => void;
	onCancelClose: () => void;
	onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
	onKeyboardNavigate: (key: string) => void;
}) {
	const t = useT();
	const switchTab = useTabsStore(s => s.switchTab);
	const closable = useTabsStore(s => s.tabs.length > 1);
	// The active tab's live stream state sharpens the signal between status pushes.
	const activeRuntime = useSessionStore(s => (active ? s.isStreaming || s.isCompacting : false));
	const signal = tabSignalPresentation(tab, activeRuntime);
	const signalLabel = t(signal.labelKey);
	// A shown subagent page takes the selection; its session keeps the visible ring.
	const pageShown = useAgentPagesStore(s => (s.shown[tab.id] ?? null) !== null);
	const selected = active && !pageShown;
	const select = () => {
		if (pageShown) useAgentPagesStore.getState().show(tab.id, null);
		void switchTab(tab.id);
	};

	return (
		<div
			id={`omp-tab-${tab.id}`}
			role="tab"
			draggable
			aria-selected={selected}
			tabIndex={active ? 0 : -1}
			data-tab-unit={paired ? undefined : ""}
			{...dropProps}
			onClick={select}
			onContextMenu={onContextMenu}
			onDragStart={(event: ReactDragEvent<HTMLDivElement>) => {
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("application/x-omp-tab", tab.id);
				window.dispatchEvent(new CustomEvent("omp:tab-drag", { detail: { tabId: tab.id } }));
			}}
			onDragEnd={() => window.dispatchEvent(new CustomEvent("omp:tab-drag", { detail: { tabId: null } }))}
			onKeyDown={event => {
				// Only the tab itself: Enter on a nested close/confirm button must
				// activate that button, not switch tabs.
				if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
					event.preventDefault();
					select();
					return;
				}
				if (
					["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) &&
					event.target === event.currentTarget
				) {
					event.preventDefault();
					onKeyboardNavigate(event.key);
				}
			}}
			title={`${label} — ${workspaceLabel}${tab.worktree ? ` — ${tab.worktree.branch}` : ""}`}
			className={cx(
				"no-drag group relative flex shrink cursor-pointer items-center gap-2 overflow-hidden text-omp-md select-none",
				CHIP_WIDTH[width],
				paired ? "h-7 rounded-md px-2" : "omp-tab-unit h-8 rounded-lg px-3",
				selected
					? "bg-[var(--omp-selected-bg)] font-medium text-[var(--omp-text)]"
					: visible || active
						? paired
							? "text-[var(--omp-text)] hover:bg-[var(--omp-sidebar-item-hover)]"
							: "bg-[var(--omp-selected-bg)]/55 text-[var(--omp-text)] ring-1 ring-inset ring-[var(--omp-border)]"
						: "text-[var(--omp-muted)] hover:bg-[var(--omp-sidebar-item-hover)] hover:text-[var(--omp-text)]",
			)}
		>
			<span
				role="img"
				aria-label={signalLabel}
				title={signalLabel}
				className={cx("omp-signal-light omp-tab-signal", signal.active && "omp-signal-light--active")}
				data-idle={(!signal.active && signal.color === "var(--omp-dim)") || undefined}
				style={{ color: signal.color }}
			/>
			{tab.worktree && (
				<GitBranch size={11} className="shrink-0 text-[var(--omp-accent)]" aria-label={t("tabs.kind.worktree")} />
			)}
			{tab.kind === "chat" && (
				<MessageCircle size={11} className="shrink-0 text-[var(--omp-muted)]" aria-label={t("tabs.kind.chat")} />
			)}
			{confirmingClose ? (
				<span className="min-w-0 truncate text-[var(--omp-error)]" title={t("tabs.confirmClose")}>
					{t("tabs.confirmClose")}
				</span>
			) : (
				<span className="min-w-0 flex-1 leading-tight">
					{/* Long titles truncate; the chip's tooltip carries the full title. */}
					<span className="block truncate" data-tab-title>
						{label}
					</span>
					{/* One line per tab; the workspace stays in the tooltip and for assistive tech. */}
					<span className="sr-only" data-tab-workspace>
						{workspaceLabel}
					</span>
				</span>
			)}
			{closable &&
				(confirmingClose ? (
					<span className="-mr-1 flex shrink-0 items-center gap-0.5">
						<button
							type="button"
							aria-label={t("common.confirm")}
							title={t("tabs.confirmClose")}
							onClick={event => {
								event.stopPropagation();
								onConfirmClose();
							}}
							className="omp-pressable flex h-4 w-4 items-center justify-center rounded bg-[var(--omp-tool-error-bg)] text-[var(--omp-error)] hover:brightness-110"
						>
							<Check size={11} strokeWidth={3} />
						</button>
						<button
							type="button"
							aria-label={t("common.cancel")}
							title={t("common.cancel")}
							onClick={event => {
								event.stopPropagation();
								onCancelClose();
							}}
							className="omp-pressable flex h-4 w-4 items-center justify-center rounded text-[var(--omp-dim)] hover:bg-[var(--omp-bg-primary)] hover:text-[var(--omp-text)]"
						>
							<X size={11} />
						</button>
					</span>
				) : (
					<button
						type="button"
						aria-label={t("tabs.close")}
						title={t("tabs.close")}
						onClick={event => {
							event.stopPropagation();
							// Live tabs arm the inline confirm (the close kills their
							// run); idle tabs skip the arm but STILL route through the
							// confirm handler — it detours worktree-bound tabs to the
							// cleanup prompt before closing (plan/20).
							if (closeNeedsConfirm) onArmClose();
							else onConfirmClose();
						}}
						className={cx(
							"omp-pressable -mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--omp-dim)] hover:bg-[var(--omp-bg-primary)] hover:text-[var(--omp-text)]",
							active ? "flex" : "hidden group-hover:flex",
						)}
					>
						<X size={11} />
					</button>
				))}
		</div>
	);
}

/** A split pair's merged chip: one frame around its two tabs, in pane order. */
function PairChip({
	unit,
	onScreen,
	dropProps,
	children,
}: {
	unit: TabUnit;
	onScreen: boolean;
	dropProps: ChipDropProps;
	children: ReactNode;
}) {
	const t = useT();
	const PairIcon = unit.group?.axis === "rows" ? Rows2 : Columns2;
	return (
		<div
			data-tab-unit=""
			data-tab-pair=""
			{...dropProps}
			className={cx(
				"omp-tab-unit no-drag relative flex h-8 shrink items-center gap-0.5 rounded-lg pr-0.5 pl-2",
				onScreen
					? "bg-[var(--omp-selected-bg)]/40 ring-1 ring-inset ring-[var(--omp-border)]"
					: "ring-1 ring-inset ring-[var(--omp-border-muted)]",
			)}
		>
			<PairIcon
				aria-label={t("tabs.pair")}
				size={11}
				className={cx("shrink-0", onScreen ? "text-[var(--omp-accent)]" : "text-[var(--omp-dim)]")}
			/>
			{children}
		</div>
	);
}

export function TabBar({ confirmCloseMs = CONFIRM_CLOSE_MS }: { confirmCloseMs?: number }) {
	const t = useT();
	const { sessions } = useSessionList("global");
	const tabs = useTabsStore(s => s.tabs);
	const activeTabId = useTabsStore(s => s.activeTabId);
	const groups = useTabsStore(s => s.groups);
	const split = useTabsStore(s => s.split);
	const groupAliases = useSidebarPrefs(s => s.groupAliases);
	const closeTab = useTabsStore(s => s.closeTab);
	const openTab = useTabsStore(s => s.openTab);
	const splitTab = useTabsStore(s => s.splitTab);
	const unsplit = useTabsStore(s => s.unsplit);
	const moveTab = useTabsStore(s => s.moveTab);
	const tabWidth = useUiStore(s => s.tabWidth);
	const tabRows = useUiStore(s => s.tabRows);
	const liveDraft = useComposerStore(s => s.draft);
	const liveImageCount = useComposerStore(s => s.images.length);
	const liveMessageCount = useSessionStore(s => s.messageCount);
	const liveStreaming = useSessionStore(s => s.isStreaming);
	const liveCompacting = useSessionStore(s => s.isCompacting);
	const liveRenderedMessages = useMessagesStore(s => s.messages.length);
	const liveQueuedMessages = useQueueStore(s => s.steering.length + s.followUp.length);
	const pruningPlaceholderRef = useRef<string | null>(null);
	const stripRef = useRef<HTMLDivElement>(null);
	const sessionsById = useMemo(() => new Map(sessions.map(session => [session.id, session])), [sessions]);
	const sessionsByPath = useMemo(() => new Map(sessions.map(session => [session.path, session])), [sessions]);
	// Inline close confirm for live tabs (AgentHub abort parity): the first action
	// arms, the ✓ executes, ✕ or the timeout cancels. The arm lives in the ui
	// store because × , ⌘W and File → Close Tab all share it.
	const armedCloseTab = useUiStore(s => s.armedCloseTab);
	const armCloseTab = useUiStore(s => s.armCloseTab);
	const cancelCloseTab = useUiStore(s => s.cancelCloseTab);
	const [tabMenu, setTabMenu] = useState<{ anchor: ContextMenuAnchor; tabId: string } | null>(null);
	/** The all-tabs list ("switch"), or the partner picker for one tab's "Split with…". */
	const [searchMenu, setSearchMenu] = useState<{ anchor: ContextMenuAnchor; pairWith: string | null } | null>(null);
	const [dragTabId, setDragTabId] = useState<string | null>(null);
	const [dropMark, setDropMark] = useState<{ tabId: string; side: TabDropSide } | null>(null);
	const [overflow, setOverflow] = useState({ hidden: 0, start: false, end: false });
	const tabOrder = useMemo(() => tabs.map(tab => tab.id), [tabs]);
	const units = useMemo(() => tabUnits(tabs, groups), [tabs, groups]);
	const multiRow = tabRows === "multi";

	const labelOf = (tab: SessionTab) => {
		const indexedSession =
			(tab.sessionPath ? sessionsByPath.get(tab.sessionPath) : undefined) ??
			(tab.sessionId ? sessionsById.get(tab.sessionId) : undefined);
		return tabDisplayTitle(tab, tabs, indexedSession, t("sidebar.untitled"));
	};
	const workspaceOf = (tab: SessionTab) =>
		tab.kind === "chat" ? t("sidebar.chats") : (groupAliases[tab.cwd] ?? basename(tab.cwd) ?? tab.cwd);

	// The strip tracks a drag that started on one of its chips (the split
	// workspace listens to the same signal for its pane drop zones).
	useEffect(() => {
		const onTabDrag = (event: Event) => {
			const tabId = (event as CustomEvent<{ tabId: string | null }>).detail.tabId;
			setDragTabId(tabId);
			if (!tabId) setDropMark(null);
		};
		window.addEventListener("omp:tab-drag", onTabDrag);
		return () => window.removeEventListener("omp:tab-drag", onTabDrag);
	}, []);

	// How many chips are out of view (the all-tabs button's count), and which
	// ends of the strip fade because more chips lie beyond them.
	const measure = useCallback(() => {
		const strip = stripRef.current;
		if (!strip) return;
		const bounds = strip.getBoundingClientRect();
		let hidden = 0;
		for (const chip of strip.querySelectorAll<HTMLElement>("[data-tab-unit]")) {
			const box = chip.getBoundingClientRect();
			if (box.left < bounds.left - 1 || box.right > bounds.right + 1) hidden++;
			else if (box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1) hidden++;
		}
		const start = multiRow ? strip.scrollTop > 1 : strip.scrollLeft > 1;
		const end = multiRow
			? strip.scrollTop + strip.clientHeight < strip.scrollHeight - 1
			: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
		setOverflow(current =>
			current.hidden === hidden && current.start === start && current.end === end ? current : { hidden, start, end },
		);
	}, [multiRow]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: chip count, width and labels change the strip's extent.
	useLayoutEffect(measure, [measure, units, tabWidth, sessions]);
	useEffect(() => {
		const strip = stripRef.current;
		if (!strip || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(strip);
		return () => observer.disconnect();
	}, [measure]);

	// Keep the selected chip in view when it changes or the strip grows past the
	// window (a new tab lands at the end). A shown agent page selects its own
	// chip; its session's chip comes in first, so the page never shows without
	// the session it belongs to.
	const shownPage = useAgentPagesStore(s => (activeTabId ? (s.shown[activeTabId] ?? null) : null));
	const pageCount = useAgentPagesStore(s => (activeTabId ? (s.pages[activeTabId]?.length ?? 0) : 0));
	// biome-ignore lint/correctness/useExhaustiveDependencies: tab and page counts change the strip's scroll extent.
	useEffect(() => {
		if (!activeTabId) return;
		const nearest = { block: "nearest", inline: "nearest" } as const;
		document.getElementById(`omp-tab-${activeTabId}`)?.scrollIntoView?.(nearest);
		if (shownPage) document.getElementById(`omp-tab-${activeTabId}-agent-${shownPage}`)?.scrollIntoView?.(nearest);
	}, [activeTabId, shownPage, tabs.length, pageCount]);

	useEffect(() => {
		if (!armedCloseTab) return;
		const timer = window.setTimeout(cancelCloseTab, confirmCloseMs);
		// Escape backs out of the close, and must claim the key: unclaimed, App
		// aborts the active turn — the very run the confirm is protecting.
		const onKeyDown = (event: KeyboardEvent) => {
			if (!event.defaultPrevented && onEscape(event, cancelCloseTab)) event.stopPropagation();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [armedCloseTab, cancelCloseTab, confirmCloseMs]);

	// The untargeted startup chat is an idle landing surface, not a permanent
	// tab. Replace it once an explicit tab exists, but only while it is truly
	// empty; a typed draft, queued input, message, or live run makes it real.
	// The first-chat fallback cleans up layouts saved before the placeholder bit
	// existed, after SessionIndex confirms that transcript has no content.
	useEffect(() => {
		if (tabs.length <= 1 || pruningPlaceholderRef.current) return;
		const candidate = tabs.find((tab, index) => {
			const indexedSession =
				(tab.sessionPath ? sessionsByPath.get(tab.sessionPath) : undefined) ??
				(tab.sessionId ? sessionsById.get(tab.sessionId) : undefined);
			const legacyEmptyStartupChat =
				index === 0 &&
				tab.placeholder === undefined &&
				tab.kind === "chat" &&
				indexedSession !== undefined &&
				!sessionHasContent(indexedSession);
			if (tab.placeholder !== true && !legacyEmptyStartupChat) return false;
			if (indexedSession && sessionHasContent(indexedSession)) return false;
			if (tab.worktree || tab.pendingSessionPath || tab.status === "running" || tab.compacting) return false;
			if (!tabs.some(other => other.id !== tab.id && other.placeholder !== true)) return false;

			if (tab.id === activeTabId) {
				return (
					!liveStreaming &&
					!liveCompacting &&
					liveMessageCount === 0 &&
					liveRenderedMessages === 0 &&
					liveQueuedMessages === 0 &&
					liveDraft.trim().length === 0 &&
					liveImageCount === 0
				);
			}

			const session = sessionRuntimeStore<SessionStore>(tab.id, "session")?.getState();
			const messages = sessionRuntimeStore<MessagesStore>(tab.id, "messages")?.getState();
			const queue = sessionRuntimeStore<QueueStore>(tab.id, "queue")?.getState();
			const composer = sessionRuntimeStore<ComposerStore>(tab.id, "composer")?.getState();
			if (!session || !messages || !queue || !composer) return true;
			return (
				!session.isStreaming &&
				!session.isCompacting &&
				session.messageCount === 0 &&
				messages.messages.length === 0 &&
				queue.steering.length === 0 &&
				queue.followUp.length === 0 &&
				composer.draft.trim().length === 0 &&
				composer.images.length === 0
			);
		});
		if (!candidate) return;
		pruningPlaceholderRef.current = candidate.id;
		void closeTab(candidate.id).finally(() => {
			pruningPlaceholderRef.current = null;
		});
	}, [
		activeTabId,
		closeTab,
		liveCompacting,
		liveDraft,
		liveImageCount,
		liveMessageCount,
		liveQueuedMessages,
		liveRenderedMessages,
		liveStreaming,
		sessionsById,
		sessionsByPath,
		tabs,
	]);

	const confirmClose = (id: string) => {
		const tab = tabs.find(entry => entry.id === id);
		if (tab) performTabClose(tab);
	};

	const closeTabs = async (ids: readonly string[]) => {
		for (const id of ids) {
			// Sequential close preserves the store's active-neighbor routing and
			// single-tab floor while the list shrinks.
			await closeTab(id);
		}
	};

	const closeAllTabs = async (target: SessionTab) => {
		await closeTabs(tabs.filter(tab => tab.id !== target.id).map(tab => tab.id));
		const replacement = await openTab({ cwd: target.cwd, kind: target.kind });
		if (replacement) await closeTab(target.id);
	};

	// A batch close can't run an inline confirm per tab, so it refuses anything a
	// single close would have confirmed: live work and worktree checkouts.
	const liveRuntime: LiveTabRuntime = {
		activeTabId,
		streaming: liveStreaming,
		compacting: liveCompacting,
	};
	const protectedFromBatchClose = (tab: SessionTab) => tab.worktree != null || tabNeedsCloseConfirm(tab, liveRuntime);
	const actionTabId = activeTabId ?? tabs[0]?.id;

	/** Reorder drop wiring for one chip (a pair's frame): drop before or after it. */
	const unitDropProps = (unit: TabUnit): ChipDropProps => {
		const targetId = unit.tabs[0]?.id ?? "";
		const accepts = dragTabId !== null && !unit.tabs.some(tab => tab.id === dragTabId);
		return {
			"data-drop": dropMark?.tabId === targetId ? dropMark.side : undefined,
			onDragOver: event => {
				if (!accepts) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = "move";
				const side = dropSide(event);
				setDropMark(mark => (mark?.tabId === targetId && mark.side === side ? mark : { tabId: targetId, side }));
			},
			onDragLeave: event => {
				if (event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) return;
				setDropMark(mark => (mark?.tabId === targetId ? null : mark));
			},
			onDrop: event => {
				if (!accepts || !dragTabId) return;
				event.preventDefault();
				event.stopPropagation();
				moveTab(dragTabId, targetId, dropSide(event));
				setDropMark(null);
			},
		};
	};
	// Past the last chip the strip itself takes the drop: the tab goes to the end.
	const lastUnitTabId = units.at(-1)?.tabs[0]?.id;
	const stripDropProps = {
		onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
			if (!dragTabId || !lastUnitTabId || event.target !== event.currentTarget) return;
			if (groupOf(groups, dragTabId) === groupOf(groups, lastUnitTabId) && groupOf(groups, dragTabId)) return;
			if (dragTabId === lastUnitTabId) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
			setDropMark(mark =>
				mark?.tabId === lastUnitTabId && mark.side === "after" ? mark : { tabId: lastUnitTabId, side: "after" },
			);
		},
		onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
			if (!dragTabId || !lastUnitTabId || event.target !== event.currentTarget) return;
			event.preventDefault();
			moveTab(dragTabId, lastUnitTabId, "after");
			setDropMark(null);
		},
	};

	const visible = visibleTabIds({ activeTabId, split });
	const renderChip = (tab: SessionTab, paired: boolean, dropProps?: ChipDropProps) => (
		<TabChip
			key={tab.id}
			tab={tab}
			active={tab.id === activeTabId}
			visible={visible.includes(tab.id)}
			label={labelOf(tab)}
			workspaceLabel={workspaceOf(tab)}
			width={tabWidth}
			paired={paired}
			dropProps={dropProps}
			confirmingClose={armedCloseTab?.tabId === tab.id}
			closeNeedsConfirm={tabNeedsCloseConfirm(tab, liveRuntime)}
			onArmClose={() => armCloseTab(tab.id)}
			onConfirmClose={() => confirmClose(tab.id)}
			onCancelClose={cancelCloseTab}
			onContextMenu={event => setTabMenu({ anchor: anchorFromEvent(event), tabId: tab.id })}
			onKeyboardNavigate={key => {
				const index = tabOrder.indexOf(tab.id);
				const targetIndex =
					key === "Home"
						? 0
						: key === "End"
							? tabOrder.length - 1
							: (index + (key === "ArrowLeft" ? -1 : 1) + tabOrder.length) % tabOrder.length;
				const target = tabOrder[targetIndex];
				if (target) {
					void useTabsStore.getState().switchTab(target);
					requestAnimationFrame(() => document.getElementById(`omp-tab-${target}`)?.focus());
				}
			}}
		/>
	);

	const searchEntries = (excludeTabId: string | null): TabSearchEntry[] =>
		excludeTabId
			? tabs
					.filter(tab => tab.id !== excludeTabId)
					.map(tab => ({
						tabId: tab.id,
						labels: [labelOf(tab)],
						detail: workspaceOf(tab),
						current: tab.id === activeTabId,
					}))
			: units.flatMap(unit => {
					const tabId = unitFocusTabId(unit);
					if (!tabId) return [];
					return [
						{
							tabId,
							labels: unit.tabs.map(labelOf),
							detail: [...new Set(unit.tabs.map(workspaceOf))].join(" · "),
							axis: unit.group?.axis,
							current: unit.tabs.some(tab => tab.id === activeTabId),
						},
					];
				});

	const iconButtonClass =
		"no-drag omp-pressable flex h-6 shrink-0 items-center justify-center gap-0.5 rounded-lg text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]";
	const anchorBelow = (element: HTMLElement): ContextMenuAnchor => {
		const rect = element.getBoundingClientRect();
		return {
			x: Number.isFinite(rect.left) ? rect.left : 8,
			y: (Number.isFinite(rect.bottom) ? rect.bottom : 40) + 4,
		};
	};

	return (
		<>
			<div
				className={cx(
					"drag-region flex shrink-0 gap-1 border-b border-[var(--omp-border-muted)] bg-[var(--omp-titlebar-bg)] px-2.5",
					multiRow ? "min-h-11 items-start py-1.5" : "h-11 items-center",
				)}
			>
				{/* Only the chips scroll: the tab actions and "+" stay pinned at the end,
				    reachable however many tabs are open. */}
				<div
					ref={stripRef}
					role="tablist"
					aria-label={t("tabs.strip")}
					data-rows={tabRows}
					data-fade-start={overflow.start || undefined}
					data-fade-end={overflow.end || undefined}
					className={cx(
						"omp-tab-scroller flex min-w-0 items-center gap-1",
						multiRow ? "max-h-[6.5rem] flex-wrap overflow-y-auto" : "overflow-x-auto",
					)}
					onWheel={multiRow ? undefined : scrollStripOnWheel}
					onScroll={measure}
					{...stripDropProps}
				>
					{units.map(unit => {
						const first = unit.tabs[0];
						if (!first) return null;
						const pageChips = unit.tabs.map(tab => (
							<AgentPageChips
								key={`${tab.id}-pages`}
								parentLabel={labelOf(tab)}
								tabActive={tab.id === activeTabId}
								tabId={tab.id}
							/>
						));
						if (!unit.group) {
							return (
								<Fragment key={first.id}>
									{renderChip(first, false, unitDropProps(unit))}
									{pageChips}
								</Fragment>
							);
						}
						return (
							<Fragment key={`${unit.group.firstTabId}|${unit.group.secondTabId}`}>
								<PairChip
									unit={unit}
									onScreen={unit.tabs.some(tab => visible.includes(tab.id))}
									dropProps={unitDropProps(unit)}
								>
									{unit.tabs.map((tab, index) => (
										<Fragment key={tab.id}>
											{index > 0 && (
												<span aria-hidden className="h-4 w-px shrink-0 bg-[var(--omp-border)]" />
											)}
											{renderChip(tab, true)}
										</Fragment>
									))}
								</PairChip>
								{pageChips}
							</Fragment>
						);
					})}
				</div>
				{tabs.length > 1 && (
					<button
						type="button"
						aria-label={
							overflow.hidden > 0 ? t("tabs.allTabsHidden", { count: overflow.hidden }) : t("tabs.allTabs")
						}
						title={overflow.hidden > 0 ? t("tabs.allTabsHidden", { count: overflow.hidden }) : t("tabs.allTabs")}
						onClick={event => setSearchMenu({ anchor: anchorBelow(event.currentTarget), pairWith: null })}
						className={cx(iconButtonClass, overflow.hidden > 0 ? "px-1.5" : "w-6", multiRow && "mt-1")}
					>
						<ChevronDown aria-hidden="true" size={14} />
						{overflow.hidden > 0 && (
							<span className="text-omp-xs tabular-nums text-[var(--omp-text)]">{overflow.hidden}</span>
						)}
					</button>
				)}
				{actionTabId && (
					<button
						type="button"
						aria-label={t("tabs.actions")}
						title={t("tabs.actions")}
						onClick={event => setTabMenu({ anchor: anchorBelow(event.currentTarget), tabId: actionTabId })}
						className={cx(iconButtonClass, "w-6", multiRow && "mt-1")}
					>
						<MoreHorizontal aria-hidden="true" size={14} />
					</button>
				)}
				<NewTabMenu buttonClass={cx(iconButtonClass, "w-6", multiRow && "mt-1")} />
			</div>
			{searchMenu && (
				<TabSearchMenu
					x={searchMenu.anchor.x}
					y={searchMenu.anchor.y}
					title={(() => {
						const anchorTab = searchMenu.pairWith ? tabs.find(tab => tab.id === searchMenu.pairWith) : undefined;
						return anchorTab ? t("tabs.pickPartner", { title: labelOf(anchorTab) }) : undefined;
					})()}
					entries={searchEntries(searchMenu.pairWith)}
					onClose={() => setSearchMenu(null)}
					onPick={tabId => {
						if (searchMenu.pairWith) void splitTab(tabId, "right", searchMenu.pairWith);
						else void useTabsStore.getState().switchTab(tabId);
					}}
				/>
			)}
			{tabMenu &&
				(() => {
					const target = tabs.find(tab => tab.id === tabMenu.tabId);
					const unitIndex = units.findIndex(unit => unit.tabs.some(tab => tab.id === tabMenu.tabId));
					if (!target || unitIndex < 0) return null;
					const left = units.slice(0, unitIndex).flatMap(unit => unit.tabs);
					const right = units.slice(unitIndex + 1).flatMap(unit => unit.tabs);
					const targetPair = groupOf(groups, target.id);
					const closeItems = (ids: readonly string[]) => {
						setTabMenu(null);
						void closeTabs(ids);
					};
					const blockedReason = t("tabs.menu.closeProtected");
					// Placing a tab beside the focused one: never the focused tab itself,
					// nor the partner already there.
					const splitBlockedReason =
						target.id === activeTabId
							? t("tabs.menu.splitCurrent")
							: split && targetPair === split
								? t("tabs.menu.alreadyPaired")
								: undefined;
					const placements = [
						{ id: "split-left", label: t("tabs.menu.splitLeft"), icon: Columns2, placement: "left" },
						{ id: "split-right", label: t("tabs.menu.splitRight"), icon: Columns2, placement: "right" },
						{ id: "split-top", label: t("tabs.menu.splitTop"), icon: Rows2, placement: "top" },
						{ id: "split-bottom", label: t("tabs.menu.splitBottom"), icon: Rows2, placement: "bottom" },
					] as const;
					const items: ContextMenuItem[] = placements.map(entry => ({
						id: entry.id,
						label: entry.label,
						icon: entry.icon,
						disabled: splitBlockedReason !== undefined,
						disabledReason: splitBlockedReason,
						onSelect: () => {
							setTabMenu(null);
							void splitTab(target.id, entry.placement);
						},
					}));
					items.push({
						id: "split-with",
						label: t("tabs.menu.splitWith"),
						icon: SplitSquareHorizontal,
						disabled: tabs.length < 2,
						onSelect: () => {
							setTabMenu(null);
							setSearchMenu({ anchor: tabMenu.anchor, pairWith: target.id });
						},
					});
					if (targetPair) {
						items.push({
							id: "separate-pair",
							label: t("tabs.menu.separatePair"),
							icon: Unlink,
							onSelect: () => {
								setTabMenu(null);
								// The pair on screen keeps the focused tab there alone.
								void unsplit(targetPair === split && activeTabId ? activeTabId : target.id);
							},
						});
					}
					items.push(
						{
							id: "close-left",
							label: t("tabs.menu.closeLeft"),
							disabled: left.length === 0 || left.some(protectedFromBatchClose),
							disabledReason: left.some(protectedFromBatchClose) ? blockedReason : undefined,
							onSelect: () => closeItems(left.map(tab => tab.id)),
						},
						{
							id: "close-right",
							label: t("tabs.menu.closeRight"),
							disabled: right.length === 0 || right.some(protectedFromBatchClose),
							disabledReason: right.some(protectedFromBatchClose) ? blockedReason : undefined,
							onSelect: () => closeItems(right.map(tab => tab.id)),
						},
						{
							id: "close-all",
							label: t("tabs.menu.closeAll"),
							danger: true,
							disabled: tabs.some(protectedFromBatchClose),
							disabledReason: tabs.some(protectedFromBatchClose) ? blockedReason : undefined,
							onSelect: () => {
								setTabMenu(null);
								void closeAllTabs(target);
							},
						},
					);
					return (
						<ContextMenu
							x={tabMenu.anchor.x}
							y={tabMenu.anchor.y}
							onClose={() => setTabMenu(null)}
							items={items}
						/>
					);
				})()}
		</>
	);
}

/**
 * New-tab affordance: agent, tool-free chat, and worktree.
 */
function NewTabMenu({ buttonClass }: { buttonClass: string }) {
	const t = useT();
	const openTab = useTabsStore(s => s.openTab);
	const openWorktreeDialog = useUiStore(s => s.openWorktreeDialog);
	const keymapOverrides = useEffectiveKeymapOverrides();
	const [agentChord = ""] = actionChords(KEYMAP_ACTION_BY_ID["tab.new"], keymapOverrides);
	const [chatChord = ""] = actionChords(KEYMAP_ACTION_BY_ID["tab.newChat"], keymapOverrides);
	return (
		<>
			<button
				type="button"
				aria-label={t("tabs.new.agent")}
				title={t("tabs.new.agentHint", { chord: agentChord })}
				onClick={() => void openTab()}
				className={buttonClass}
			>
				<Plus size={14} />
			</button>
			<button
				type="button"
				aria-label={t("tabs.new.chat")}
				title={t("tabs.new.chatHint", { chord: chatChord })}
				onClick={() => void openTab({ kind: "chat" })}
				className={buttonClass}
			>
				<MessageCirclePlus size={14} />
			</button>
			<button
				type="button"
				aria-label={t("tabs.new.worktree")}
				title={t("tabs.new.worktreeHint")}
				onClick={() => openWorktreeDialog()}
				className={buttonClass}
			>
				<GitBranchPlus size={14} />
			</button>
		</>
	);
}
