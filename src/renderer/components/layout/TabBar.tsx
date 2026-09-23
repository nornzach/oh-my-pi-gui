/**
 * Session tab strip, mounted between TitleBar and SidecarBanner. One chip per
 * pooled sidecar tab: session title (or cwd basename; identical untitled
 * labels disambiguate with an index suffix), a slow status signal, a muted
 * workspace subtitle, a close × (hidden at the single-tab floor,
 * inline-confirmed while a run is live), and a trailing "+" that opens a
 * fresh session tab in the current cwd. The strip scrolls horizontally on
 * overflow instead of shrinking chips past readability.
 */

import {
	Check,
	Columns2,
	GitBranch,
	GitBranchPlus,
	MessageCircle,
	MessageCirclePlus,
	Plus,
	Rows2,
	X,
} from "lucide-react";
import {
	type DragEvent as ReactDragEvent,
	type MouseEvent as ReactMouseEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSessionList } from "../../hooks/use-session-list";
import { basename, cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { sessionHasContent } from "../../lib/session-title";
import { type LiveTabRuntime, performTabClose, tabNeedsCloseConfirm } from "../../lib/tab-close";
import { tabSignalPresentation } from "../../lib/tab-signal";
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
import { type SessionTab, tabDisplayTitle, useTabsStore, visibleTabIds } from "../../stores/tabs";
import { useUiStore } from "../../stores/ui";
import { anchorFromEvent, ContextMenu, type ContextMenuAnchor } from "../common/ContextMenu";

/** Auto-cancel window for the armed close confirm (injectable for tests). */
const CONFIRM_CLOSE_MS = 3000;

function TabChip({
	tab,
	active,
	visible,
	label,
	workspaceLabel,
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

	return (
		<div
			id={`omp-tab-${tab.id}`}
			role="tab"
			draggable
			aria-selected={active}
			tabIndex={active ? 0 : -1}
			onClick={() => void switchTab(tab.id)}
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
					void switchTab(tab.id);
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
				"no-drag group relative flex h-9 w-44 shrink-0 cursor-pointer items-center gap-2 overflow-hidden px-2.5 text-omp-md select-none",
				active
					? "bg-[var(--omp-selected-bg)] font-medium text-[var(--omp-text)]"
					: visible
						? "bg-[var(--omp-selected-bg)]/55 text-[var(--omp-text)] ring-1 ring-inset ring-[var(--omp-border-accent)]"
						: "text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]",
			)}
		>
			<span
				role="img"
				aria-label={signalLabel}
				title={signalLabel}
				className={cx("omp-signal-light omp-tab-signal", signal.active && "omp-signal-light--active")}
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
					<span
						className="relative block min-w-0 overflow-hidden whitespace-nowrap"
						data-tab-title-wrap
						onMouseEnter={event => {
							const scroller = event.currentTarget.querySelector<HTMLElement>("[data-tab-title-scroll]");
							const overflow = Math.max(0, (scroller?.scrollWidth ?? 0) - event.currentTarget.clientWidth);
							event.currentTarget.dataset.overflowing = overflow > 0 ? "true" : "false";
							event.currentTarget.style.setProperty("--omp-tab-title-overflow", `${overflow}px`);
						}}
					>
						<span className="block truncate" data-tab-title>
							{label}
						</span>
						<span
							aria-hidden
							className="omp-tab-title-scroll invisible absolute inset-0 w-max whitespace-nowrap"
							data-tab-title-scroll
						>
							{label}
						</span>
					</span>
					<span className="block truncate text-omp-xxs font-normal text-[var(--omp-dim)]" data-tab-workspace>
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

export function TabBar({ confirmCloseMs = CONFIRM_CLOSE_MS }: { confirmCloseMs?: number }) {
	const t = useT();
	const { sessions } = useSessionList("global");
	const tabs = useTabsStore(s => s.tabs);
	const activeTabId = useTabsStore(s => s.activeTabId);
	const split = useTabsStore(s => s.split);
	const groupAliases = useSidebarPrefs(s => s.groupAliases);
	const closeTab = useTabsStore(s => s.closeTab);
	const openTab = useTabsStore(s => s.openTab);
	const splitTab = useTabsStore(s => s.splitTab);
	const unsplit = useTabsStore(s => s.unsplit);
	const liveDraft = useComposerStore(s => s.draft);
	const liveImageCount = useComposerStore(s => s.images.length);
	const liveMessageCount = useSessionStore(s => s.messageCount);
	const liveStreaming = useSessionStore(s => s.isStreaming);
	const liveCompacting = useSessionStore(s => s.isCompacting);
	const liveRenderedMessages = useMessagesStore(s => s.messages.length);
	const liveQueuedMessages = useQueueStore(s => s.steering.length + s.followUp.length);
	const pruningPlaceholderRef = useRef<string | null>(null);
	const sessionsById = useMemo(() => new Map(sessions.map(session => [session.id, session])), [sessions]);
	const sessionsByPath = useMemo(() => new Map(sessions.map(session => [session.path, session])), [sessions]);
	// Inline close confirm for live tabs (AgentHub abort parity): the first action
	// arms, the ✓ executes, ✕ or the timeout cancels. The arm lives in the ui
	// store because × , ⌘W and File → Close Tab all share it.
	const armedCloseTab = useUiStore(s => s.armedCloseTab);
	const armCloseTab = useUiStore(s => s.armCloseTab);
	const cancelCloseTab = useUiStore(s => s.cancelCloseTab);
	const [tabMenu, setTabMenu] = useState<{ anchor: ContextMenuAnchor; tabId: string } | null>(null);
	const tabOrder = useMemo(() => tabs.map(tab => tab.id), [tabs]);

	useEffect(() => {
		if (!armedCloseTab) return;
		const timer = window.setTimeout(cancelCloseTab, confirmCloseMs);
		return () => window.clearTimeout(timer);
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

	return (
		<>
			<div
				role="tablist"
				aria-label={t("tabs.strip")}
				className="drag-region flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--omp-border-muted)] bg-[var(--omp-titlebar-bg)] px-2"
			>
				{tabs.map(tab => {
					const visible = visibleTabIds({ activeTabId, split }).includes(tab.id);
					const indexedSession =
						(tab.sessionPath ? sessionsByPath.get(tab.sessionPath) : undefined) ??
						(tab.sessionId ? sessionsById.get(tab.sessionId) : undefined);
					const label = tabDisplayTitle(tab, tabs, indexedSession, t("sidebar.untitled"));
					const workspaceLabel =
						tab.kind === "chat" ? t("sidebar.chats") : (groupAliases[tab.cwd] ?? basename(tab.cwd) ?? tab.cwd);
					return (
						<TabChip
							key={tab.id}
							tab={tab}
							active={tab.id === activeTabId}
							visible={visible}
							label={label}
							workspaceLabel={workspaceLabel}
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
				})}
				<NewTabMenu />
			</div>
			{tabMenu &&
				(() => {
					const index = tabs.findIndex(tab => tab.id === tabMenu.tabId);
					const target = tabs[index];
					if (!target) return null;
					const left = tabs.slice(0, index);
					const right = tabs.slice(index + 1);
					const closeItems = (ids: readonly string[]) => {
						setTabMenu(null);
						void closeTabs(ids);
					};
					const blockedReason = t("tabs.menu.closeProtected");
					const splitDisabled = target.id === activeTabId && !split;
					const splitItems = [
						{
							id: "split-left",
							label: t("tabs.menu.splitLeft"),
							icon: Columns2,
							disabled: splitDisabled,
							disabledReason: splitDisabled ? t("tabs.menu.splitCurrent") : undefined,
							onSelect: () => {
								setTabMenu(null);
								void splitTab(target.id, "left");
							},
						},
						{
							id: "split-right",
							label: t("tabs.menu.splitRight"),
							icon: Columns2,
							disabled: splitDisabled,
							disabledReason: splitDisabled ? t("tabs.menu.splitCurrent") : undefined,
							onSelect: () => {
								setTabMenu(null);
								void splitTab(target.id, "right");
							},
						},
						{
							id: "split-top",
							label: t("tabs.menu.splitTop"),
							icon: Rows2,
							disabled: splitDisabled,
							disabledReason: splitDisabled ? t("tabs.menu.splitCurrent") : undefined,
							onSelect: () => {
								setTabMenu(null);
								void splitTab(target.id, "top");
							},
						},
						{
							id: "split-bottom",
							label: t("tabs.menu.splitBottom"),
							icon: Rows2,
							disabled: splitDisabled,
							disabledReason: splitDisabled ? t("tabs.menu.splitCurrent") : undefined,
							onSelect: () => {
								setTabMenu(null);
								void splitTab(target.id, "bottom");
							},
						},
					];
					if (split) {
						splitItems.push({
							id: "remove-split",
							label: t("tabs.menu.removeSplit"),
							icon: X,
							disabled: false,
							disabledReason: undefined,
							onSelect: () => {
								setTabMenu(null);
								void unsplit(target.id);
							},
						});
					}
					return (
						<ContextMenu
							x={tabMenu.anchor.x}
							y={tabMenu.anchor.y}
							onClose={() => setTabMenu(null)}
							items={[
								...splitItems,
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
							]}
						/>
					);
				})()}
		</>
	);
}

/**
 * New-tab affordance: agent, tool-free chat, and worktree.
 */
function NewTabMenu() {
	const t = useT();
	const openTab = useTabsStore(s => s.openTab);
	const openWorktreeDialog = useUiStore(s => s.openWorktreeDialog);
	const buttonClass =
		"no-drag omp-pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]";
	return (
		<>
			<button
				type="button"
				aria-label={t("tabs.new.agent")}
				title={t("tabs.new.agentHint")}
				onClick={() => void openTab()}
				className={buttonClass}
			>
				<Plus size={14} />
			</button>
			<button
				type="button"
				aria-label={t("tabs.new.chat")}
				title={t("tabs.new.chatHint")}
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
