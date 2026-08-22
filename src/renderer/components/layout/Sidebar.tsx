import {
	BarChart3,
	Bot,
	BriefcaseBusiness,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Code2,
	Coins,
	ExternalLink,
	GitBranchPlus,
	GitPullRequest,
	Keyboard,
	MessageCircle,
	MessageSquarePlus,
	MoreHorizontal,
	Palette,
	PanelRight,
	Pencil,
	Pin,
	PinOff,
	Plug,
	Plus,
	Search,
	Settings,
	SquarePen,
	SquareTerminal,
	Trash2,
	X,
} from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionInfo } from "../../../shared/ipc-types";
import { useAwaitingConfirmation } from "../../hooks/use-awaiting-confirmation";
import { useSessionList } from "../../hooks/use-session-list";
import { dropSessionNow } from "../../hooks/use-session-switch";
import { basename, cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { sessionDisplayTitle } from "../../lib/session-title";
import { useSessionStore } from "../../stores/session";
import { useSidebarPrefs } from "../../stores/sidebar-prefs";
import { useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { anchorFromEvent, ContextMenu, type ContextMenuAnchor } from "../common/ContextMenu";
import { LangSwitcher } from "../common/LangSwitcher";
import { WorkspaceDialog } from "../dialogs/WorkspaceDialog";

const STATUS_COLOR: Record<SessionInfo["status"], string> = {
	complete: "var(--omp-success)",
	interrupted: "var(--omp-warning)",
	aborted: "var(--omp-warning)",
	error: "var(--omp-error)",
	pending: "var(--omp-dim)",
	unknown: "var(--omp-dim)",
};

const STATUS_LABEL_KEY: Record<SessionInfo["status"], string> = {
	complete: "sidebar.status.complete",
	interrupted: "sidebar.status.interrupted",
	aborted: "sidebar.status.aborted",
	error: "sidebar.status.error",
	pending: "sidebar.status.pending",
	unknown: "sidebar.status.unknown",
};

interface WorkspaceGroup {
	cwd: string;
	name: string;
	sessions: SessionInfo[];
}

type SidebarMode = "code" | "work";

function modifiedAt(session: SessionInfo): number {
	const timestamp = Date.parse(session.modified);
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function SidebarRowTitle({ className, title }: { className?: string; title: string }) {
	return (
		<span className={cx("omp-sidebar-title min-w-0 flex-1 truncate", className)} title={title}>
			{title}
		</span>
	);
}

/**
 * Left rail with two agent-capable lanes plus global tool-free chats. Code
 * groups project sessions by workspace; Work uses one GUI-owned default
 * workspace with no folder picker. The main action creates an agent, while the
 * adjacent quick-chat action creates a chat.
 */
export function Sidebar() {
	const t = useT();
	const [mode, setMode] = useState<SidebarMode>("code");
	const [navigationExpanded, setNavigationExpanded] = useState(true);
	const [defaultWorkspace, setDefaultWorkspace] = useState<string | null>(null);
	const switchPendingTo = useUiStore(s => s.switchPending?.toId ?? null);
	// Resizable left rail (mirrors PanelContainer's right-rail drag, but the
	// handle sits on the right edge and dragging right grows the sidebar).
	const SIDEBAR_MIN = 180;
	const SIDEBAR_MAX = 420;
	const [sidebarWidth, setSidebarWidth] = useState(236);
	const sidebarWidthRef = useRef(236);
	// Layout widths persist like every other chrome pref; restored on mount.
	useEffect(() => {
		void window.omp.prefs
			.get("sidebarWidth")
			.then(value => {
				if (typeof value !== "number" || !Number.isFinite(value)) return;
				const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value));
				sidebarWidthRef.current = clamped;
				setSidebarWidth(clamped);
			})
			.catch(() => {});
	}, []);
	const sidebarDragging = useRef(false);
	const startSidebarDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
		sidebarDragging.current = true;
		e.currentTarget.setPointerCapture(e.pointerId);
	}, []);
	const onSidebarDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
		if (!sidebarDragging.current) return;
		// Sidebar is left-anchored: dragging right grows it.
		const host = e.currentTarget.parentElement;
		if (!host) return;
		const hostRect = host.getBoundingClientRect();
		const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX - hostRect.left));
		sidebarWidthRef.current = clamped;
		setSidebarWidth(clamped);
	}, []);
	const endSidebarDrag = useCallback(() => {
		sidebarDragging.current = false;
		void window.omp.prefs.set("sidebarWidth", sidebarWidthRef.current).catch(() => {});
	}, []);
	const [deleting, setDeleting] = useState(false);
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	// Inline delete confirmation: the first click swaps the trash button for an
	// in-place ✓/✕ pair (confirm sits exactly where delete was); ✓ deletes,
	// ✕ or clicking elsewhere cancels. No modal, no mouse travel to center.
	const [confirmingDeletePath, setConfirmingDeletePath] = useState<string | null>(null);
	const [confirmingGroupDeleteCwd, setConfirmingGroupDeleteCwd] = useState<string | null>(null);
	const [renamingSessionPath, setRenamingSessionPath] = useState<string | null>(null);
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const [renameDraft, setRenameDraft] = useState("");
	// Mode selector, workspace group context menu, session row context menu.
	const [modeMenu, setModeMenu] = useState<ContextMenuAnchor | null>(null);
	const [groupMenu, setGroupMenu] = useState<{ anchor: ContextMenuAnchor; group: WorkspaceGroup } | null>(null);
	const [sessionMenu, setSessionMenu] = useState<{ anchor: ContextMenuAnchor; session: SessionInfo } | null>(null);
	// Workspace display alias rename (group header inline input).
	const [renamingGroupCwd, setRenamingGroupCwd] = useState<string | null>(null);
	const [groupRenameDraft, setGroupRenameDraft] = useState("");
	const groupRenameRef = useRef<HTMLInputElement>(null);
	const openTab = useTabsStore(s => s.openTab);
	const tabs = useTabsStore(s => s.tabs);
	const activeTabId = useTabsStore(s => s.activeTabId);
	const activeTabKind = tabs.find(tab => tab.id === activeTabId)?.kind;
	const pinnedGroups = useSidebarPrefs(s => s.pinnedGroups);
	const pinnedSessions = useSidebarPrefs(s => s.pinnedSessions);
	const groupAliases = useSidebarPrefs(s => s.groupAliases);
	const workspaceLastUsed = useSidebarPrefs(s => s.workspaceLastUsed);
	const sessionLastUsed = useSidebarPrefs(s => s.sessionLastUsed);
	const touchSession = useSidebarPrefs(s => s.touchSession);
	const renameRef = useRef<HTMLInputElement>(null);
	const { sessions, isLoading, deleteSession, renameSession } = useSessionList("global");
	const sessionId = useSessionStore(s => s.sessionId);
	const cwd = useSessionStore(s => s.cwd);
	const isStreaming = useSessionStore(s => s.isStreaming);
	const isCompacting = useSessionStore(s => s.isCompacting);
	// Sidebar signal-light state for the ATTACHED session: a blocking
	// confirmation (plan approval / ask / permission) overrides the running
	// signal — it needs the user, not just time.
	const awaitingConfirmation = useAwaitingConfirmation();
	const openThemePicker = useUiStore(s => s.openThemePicker);
	const openSessionPicker = useUiStore(s => s.openSessionPicker);

	useEffect(() => {
		void window.omp.sidecar
			.defaultWorkspace()
			.then(workspace => {
				setDefaultWorkspace(workspace);
				const tabState = useTabsStore.getState();
				const activeKind = tabState.tabs.find(tab => tab.id === tabState.activeTabId)?.kind;
				if (activeKind !== "chat" && useSessionStore.getState().cwd === workspace) setMode("work");
			})
			.catch(() => {});
	}, []);

	// Opening a session from the global search keeps the lane label honest.
	useEffect(() => {
		if (!defaultWorkspace || !cwd) return;
		setMode(activeTabKind === "chat" ? "code" : cwd === defaultWorkspace ? "work" : "code");
	}, [activeTabKind, cwd, defaultWorkspace]);

	// Click elsewhere or Escape cancels a pending inline delete confirm
	// ("✕ or clicking elsewhere cancels" — the ✕ half lives on the buttons).
	const confirmingAny = confirmingDeletePath !== null || confirmingGroupDeleteCwd !== null;
	useEffect(() => {
		if (!confirmingAny) return;
		const cancel = () => {
			setConfirmingDeletePath(null);
			setConfirmingGroupDeleteCwd(null);
		};
		const onPointerDown = (event: PointerEvent) => {
			// Clicks inside the row's action cluster belong to the ✓/✕ buttons —
			// a pointerdown there must not unmount the button before its click.
			const target = event.target;
			if (
				target instanceof Element &&
				target.closest(".omp-sidebar-session-actions, .omp-sidebar-workspace-actions")
			) {
				return;
			}
			cancel();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") cancel();
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKey);
		};
	}, [confirmingAny]);

	const recencyForSession = useCallback(
		(session: SessionInfo) => sessionLastUsed[session.path] ?? modifiedAt(session),
		[sessionLastUsed],
	);
	const agentSessions = useMemo(() => sessions.filter(session => session.kind !== "chat"), [sessions]);
	const codeSessions = useMemo(
		() => agentSessions.filter(session => !defaultWorkspace || session.cwd !== defaultWorkspace),
		[agentSessions, defaultWorkspace],
	);
	const workSessions = useMemo(
		() =>
			agentSessions
				.filter(session => defaultWorkspace !== null && session.cwd === defaultWorkspace)
				.toSorted((a, b) => {
					const aPinned = pinnedSessions.includes(a.path) ? 0 : 1;
					const bPinned = pinnedSessions.includes(b.path) ? 0 : 1;
					if (aPinned !== bPinned) return aPinned - bPinned;
					return recencyForSession(b) - recencyForSession(a);
				}),
		[agentSessions, defaultWorkspace, pinnedSessions, recencyForSession],
	);
	const chatSessions = useMemo(
		() =>
			sessions
				.filter(session => session.kind === "chat")
				.toSorted((a, b) => {
					const aPinned = pinnedSessions.includes(a.path) ? 0 : 1;
					const bPinned = pinnedSessions.includes(b.path) ? 0 : 1;
					if (aPinned !== bPinned) return aPinned - bPinned;
					return recencyForSession(b) - recencyForSession(a);
				}),
		[sessions, pinnedSessions, recencyForSession],
	);

	// Code sessions stay grouped by project. Pins remain a priority partition,
	// with MRU inside it.
	const groups = useMemo<WorkspaceGroup[]>(() => {
		const byCwd = new Map<string, SessionInfo[]>();
		for (const session of codeSessions) {
			const list = byCwd.get(session.cwd) ?? [];
			list.push(session);
			byCwd.set(session.cwd, list);
		}
		const result: WorkspaceGroup[] = [...byCwd.entries()].map(([groupCwd, groupSessions]) => ({
			cwd: groupCwd,
			name: groupAliases[groupCwd] ?? (basename(groupCwd) || groupCwd),
			sessions: [...groupSessions].sort((a, b) => {
				const aPinned = pinnedSessions.includes(a.path) ? 0 : 1;
				const bPinned = pinnedSessions.includes(b.path) ? 0 : 1;
				if (aPinned !== bPinned) return aPinned - bPinned;
				return recencyForSession(b) - recencyForSession(a);
			}),
		}));
		result.sort((a, b) => {
			const aPinned = pinnedGroups.includes(a.cwd) ? 0 : 1;
			const bPinned = pinnedGroups.includes(b.cwd) ? 0 : 1;
			if (aPinned !== bPinned) return aPinned - bPinned;
			const aRecency = Math.max(workspaceLastUsed[a.cwd] ?? 0, ...a.sessions.map(recencyForSession));
			const bRecency = Math.max(workspaceLastUsed[b.cwd] ?? 0, ...b.sessions.map(recencyForSession));
			return bRecency - aRecency;
		});
		return result;
	}, [codeSessions, groupAliases, pinnedGroups, pinnedSessions, recencyForSession, workspaceLastUsed]);
	const totalCount = mode === "work" ? workSessions.length : codeSessions.length + chatSessions.length;
	const visibleGroups = mode === "code" ? groups : [];
	const chatsCollapsed = collapsed.__chats__ ?? false;

	const isCollapsed = (groupCwd: string) => {
		if (groupCwd in collapsed) return collapsed[groupCwd];
		// Default: current workspace expanded, others collapsed (Codex-style).
		return groupCwd !== cwd;
	};
	const toggleGroup = (groupCwd: string) => {
		setCollapsed(prev => ({ ...prev, [groupCwd]: !isCollapsed(groupCwd) }));
	};
	const isSessionRunning = (session: SessionInfo) => {
		if (session.id === sessionId && (isStreaming || isCompacting)) return true;
		const ownerTab = tabs.find(tab => tab.sessionId === session.id);
		if (ownerTab) return ownerTab.status === "running" || ownerTab.compacting === true;
		return session.status === "pending";
	};

	const openSession = (session: SessionInfo) => {
		if (session.id === sessionId) return;
		void openTab({ cwd: session.cwd, sessionPath: session.path, kind: session.kind ?? "agent" });
	};
	const startNew = () => {
		if (mode === "work") {
			void openTab({ kind: "agent", work: true });
			return;
		}
		setWorkspaceOpen(true);
	};

	// Explicit parallel action: open this session in a NEW window with its own
	// sidecar, leaving the current window's running session untouched.
	const openSessionInNewWindow = async (session: SessionInfo) => {
		const ok = await window.omp.sessions.openInNewWindow({ sessionPath: session.path, cwd: session.cwd });
		if (!ok) {
			toast({ variant: "warning", message: t("sidebar.parallelCap") });
			return;
		}
		touchSession(session.path, session.kind === "chat" ? undefined : session.cwd);
	};

	const startRename = (session: SessionInfo) => {
		setRenameDraft(session.title || session.firstMessage || "");
		setRenamingSessionPath(session.path);
		requestAnimationFrame(() => renameRef.current?.select());
	};
	const commitRename = (session: SessionInfo, value = renameDraft) => {
		setRenamingSessionPath(null);
		const name = value.trim();
		if (!name || name === session.title) return;
		void renameSession(session.path, name)
			.then(() => {
				if (session.id === sessionId) useSessionStore.setState({ sessionName: name });
			})
			.catch(error => toast({ variant: "error", title: t("sidebar.renameFailed"), message: String(error) }));
	};

	const confirmDeleteSession = async (session: SessionInfo) => {
		if (isSessionRunning(session)) {
			toast({ variant: "warning", message: t("sidebar.menu.taskRunning") });
			setConfirmingDeletePath(null);
			return;
		}
		setDeleting(true);
		try {
			if (session.id === sessionId) {
				await dropSessionNow();
			} else {
				await deleteSession(session.path);
			}
			setConfirmingDeletePath(null);
		} catch (error) {
			toast({ variant: "error", title: t("sidebar.deleteFailed"), message: String(error) });
		} finally {
			setDeleting(false);
		}
	};

	const confirmDeleteGroup = async (group: WorkspaceGroup) => {
		if (group.sessions.some(isSessionRunning)) {
			toast({ variant: "warning", message: t("sidebar.deleteGroupStreaming") });
			setConfirmingGroupDeleteCwd(null);
			return;
		}
		setDeleting(true);
		try {
			// Delete every session file in this workspace, then dismiss the group.
			for (const session of group.sessions) {
				// eslint-disable-next-line no-await-in-loop -- sequential, keep FS load bounded
				if (session.id === sessionId) await dropSessionNow();
				else await deleteSession(session.path);
			}
			setConfirmingGroupDeleteCwd(null);
		} catch (error) {
			toast({ variant: "error", title: t("sidebar.deleteFailed"), message: String(error) });
		} finally {
			setDeleting(false);
		}
	};

	const renderSessionRow = (session: SessionInfo) => {
		const active = session.id === sessionId;
		// Signal light: every open task uses its owning tab's live status.
		// Waiting-for-confirmation wins for the attached task.
		const signal: "waiting" | "running" | null = active
			? awaitingConfirmation
				? "waiting"
				: isStreaming
					? "running"
					: null
			: isSessionRunning(session)
				? "running"
				: null;
		const title = sessionDisplayTitle(session, t("sidebar.untitled"));
		const hasActions = signal == null || !active;
		const actionsOpen = confirmingDeletePath === session.path || renamingSessionPath === session.path;
		return (
			<div
				key={session.path}
				role="button"
				tabIndex={0}
				onClick={() => void openSession(session)}
				onContextMenu={event => setSessionMenu({ anchor: anchorFromEvent(event), session })}
				onKeyDown={event => {
					// Only the row itself: Enter inside a nested control (rename
					// input, action buttons) must not also switch the session.
					if (event.key === "Enter" && event.target === event.currentTarget) void openSession(session);
				}}
				data-active={active}
				data-switch-pending={switchPendingTo === session.id || undefined}
				data-has-actions={hasActions}
				data-actions-open={actionsOpen}
				data-session-kind={session.kind ?? "agent"}
				className={cx(
					"omp-sidebar-session-row omp-color-fade group cursor-pointer rounded-md border px-2 py-1",
					active
						? "border-[var(--omp-border-accent)] bg-[var(--omp-selected-bg)]"
						: "border-transparent hover:border-[var(--omp-border-muted)] hover:bg-[var(--omp-sidebar-item-hover)]",
				)}
			>
				<div className="flex min-w-0 items-center">
					<span
						role="img"
						aria-label={
							signal === "waiting"
								? t("sidebar.signal.waiting")
								: signal === "running"
									? t("sidebar.signal.running")
									: t(STATUS_LABEL_KEY[session.status])
						}
						title={
							signal === "waiting"
								? t("sidebar.signal.waiting")
								: signal === "running"
									? t("sidebar.signal.running")
									: t(STATUS_LABEL_KEY[session.status])
						}
						className={cx("omp-signal-light mr-2", signal && "omp-signal-light--active")}
						style={{
							color:
								signal === "waiting"
									? "var(--omp-warning)"
									: signal === "running"
										? "var(--omp-accent)"
										: STATUS_COLOR[session.status],
						}}
					/>
					{pinnedSessions.includes(session.path) && (
						<Pin
							size={10}
							className="mr-1.5 shrink-0 text-[var(--omp-accent)]"
							aria-label={t("sidebar.pinned")}
						/>
					)}
					{renamingSessionPath === session.path ? (
						<input
							ref={renameRef}
							value={renameDraft}
							onChange={event => setRenameDraft(event.target.value)}
							onBlur={event => commitRename(session, event.currentTarget.value)}
							onKeyDown={event => {
								if (event.key === "Enter") commitRename(session, event.currentTarget.value);
								if (event.key === "Escape") setRenamingSessionPath(null);
							}}
							onClick={event => event.stopPropagation()}
							className="min-w-0 flex-1 rounded border border-[var(--omp-input-focus-border)] bg-[var(--omp-input-bg)] px-1.5 py-0.5 text-omp-md font-normal text-[var(--omp-muted)] outline-none"
						/>
					) : (
						<SidebarRowTitle
							className="text-omp-md font-normal leading-5 text-[var(--omp-muted)]"
							title={title}
						/>
					)}
					<span
						className="omp-sidebar-session-actions flex shrink-0 items-center justify-end gap-0.5"
						onClick={event => event.stopPropagation()}
					>
						{confirmingDeletePath === session.path ? (
							<>
								<button
									type="button"
									disabled={deleting}
									title={t("common.delete")}
									aria-label={t("common.delete")}
									onClick={() => void confirmDeleteSession(session)}
									className="flex h-5 w-5 items-center justify-center rounded bg-[var(--omp-tool-error-bg)] text-[var(--omp-error)] hover:brightness-110 disabled:opacity-40"
								>
									<Check size={11} strokeWidth={3} />
								</button>
								<button
									type="button"
									disabled={deleting}
									title={t("common.cancel")}
									aria-label={t("common.cancel")}
									onClick={() => setConfirmingDeletePath(null)}
									className="flex h-5 w-5 items-center justify-center rounded text-[var(--omp-dim)] hover:bg-[var(--omp-bg-tertiary)] hover:text-[var(--omp-text)] disabled:opacity-40"
								>
									<X size={11} strokeWidth={3} />
								</button>
							</>
						) : (
							<>
								{!signal && renamingSessionPath !== session.path ? (
									<button
										type="button"
										title={t("sidebar.rename")}
										aria-label={t("sidebar.rename")}
										onClick={() => startRename(session)}
										className="omp-sidebar-action order-2 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--omp-dim)] hover:bg-[var(--omp-bg-tertiary)] hover:text-[var(--omp-text)]"
									>
										<Pencil size={11} />
									</button>
								) : !active ? (
									<button
										type="button"
										title={t("sidebar.menu.openNewTab")}
										aria-label={t("sidebar.menu.openNewTab")}
										onClick={() => void openSession(session)}
										className="omp-sidebar-action flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--omp-dim)] hover:bg-[var(--omp-bg-tertiary)] hover:text-[var(--omp-text)]"
									>
										<Plus size={11} />
									</button>
								) : (
									<span className="h-5 w-5 shrink-0" />
								)}
								{!signal ? (
									<button
										className="omp-sidebar-action flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--omp-dim)] hover:bg-[var(--omp-tool-error-bg)] hover:text-[var(--omp-error)]"
										onClick={() => setConfirmingDeletePath(session.path)}
										title={t("sidebar.delete")}
										type="button"
										aria-label={t("sidebar.delete")}
									>
										<Trash2 size={11} />
									</button>
								) : (
									<span className="order-1 h-5 w-5 shrink-0" />
								)}
							</>
						)}
					</span>
				</div>
			</div>
		);
	};

	const utilityButton =
		"omp-pressable flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]";

	return (
		<>
			<aside
				className="omp-session-sidebar relative flex h-full shrink-0 flex-col border-r border-[var(--omp-border-muted)] bg-[var(--omp-sidebar-bg)]"
				style={{ width: sidebarWidth }}
			>
				<div className="drag-region flex h-12 shrink-0 items-center gap-1 border-b border-[var(--omp-border-muted)] px-2.5">
					<button
						type="button"
						onClick={event => {
							const rect = event.currentTarget.getBoundingClientRect();
							setModeMenu({
								x: Number.isFinite(rect.left) ? rect.left : 8,
								y: (Number.isFinite(rect.bottom) ? rect.bottom : 40) + 6,
							});
						}}
						aria-label={t("sidebar.mode.aria")}
						aria-expanded={modeMenu !== null}
						aria-haspopup="menu"
						className="no-drag omp-pressable flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 font-display text-omp-lg font-semibold text-[var(--omp-text)] hover:bg-[var(--omp-selected-bg)]"
					>
						{mode === "code" ? <Code2 size={15} /> : <BriefcaseBusiness size={15} />}
						<span>{t(`sidebar.mode.${mode}`)}</span>
						<ChevronDown size={13} className="text-[var(--omp-dim)]" />
					</button>
					<div className="flex-1" />
					<button
						type="button"
						onClick={openSessionPicker}
						title={t("sidebar.search")}
						aria-label={t("sidebar.search")}
						className="no-drag omp-pressable flex h-7 w-7 items-center justify-center rounded-lg text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
					>
						<Search size={15} />
					</button>
				</div>

				<div className="flex items-center gap-1 px-2 pb-2 pt-2">
					<button
						type="button"
						data-sidebar-new-agent
						onClick={startNew}
						className="omp-pressable flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-omp-md font-medium text-[var(--omp-text)] hover:bg-[var(--omp-selected-bg)]"
					>
						{mode === "code" ? <SquarePen size={15} /> : <BriefcaseBusiness size={15} />}
						<span className="min-w-0 flex-1 truncate">
							{mode === "code" ? t("sidebar.newCode") : t("sidebar.newWork")}
						</span>
					</button>
					{mode === "code" && (
						<button
							type="button"
							data-sidebar-new-chat
							onClick={() => void openTab({ kind: "chat" })}
							title={t("sidebar.quickChat")}
							aria-label={t("sidebar.quickChat")}
							className="omp-pressable flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
						>
							<MessageSquarePlus size={16} />
						</button>
					)}
				</div>

				<div className="px-2 pb-2" data-sidebar-navigation>
					<div
						aria-hidden={!navigationExpanded}
						className="omp-sidebar-group"
						data-state={navigationExpanded ? "expanded" : "collapsed"}
						inert={!navigationExpanded}
					>
						<div className="omp-sidebar-group-content space-y-0.5">
							{[
								{
									id: "commands",
									icon: Search,
									label: t("titlebar.commands"),
									onClick: () => useUiStore.getState().openCommandPalette(),
								},
								{
									id: "agents",
									icon: Bot,
									label: t("titlebar.agentHub"),
									onClick: () => useUiStore.getState().openAgentHub(),
								},
								{
									id: "providers",
									icon: Plug,
									label: t("titlebar.providers"),
									onClick: () => useUiStore.getState().openProviders(),
								},
								{
									id: "usage",
									icon: Coins,
									label: t("titlebar.usage"),
									onClick: () => useUiStore.getState().openUsage(),
								},
								{
									id: "stats",
									icon: BarChart3,
									label: t("titlebar.stats"),
									onClick: () => useUiStore.getState().openStatsDashboard(),
								},
								{
									id: "pull-requests",
									icon: GitPullRequest,
									label: t("titlebar.prCenter"),
									onClick: () => useUiStore.getState().openPrCenter(),
								},
								{
									id: "workspace",
									icon: PanelRight,
									label: t("titlebar.workspace"),
									onClick: () => useUiStore.getState().togglePanel(),
								},
								{
									id: "hotkeys",
									icon: Keyboard,
									label: t("titlebar.hotkeys"),
									onClick: () => useUiStore.getState().openHotkeys(),
								},
								{
									id: "settings",
									icon: Settings,
									label: t("titlebar.settings"),
									onClick: () => useUiStore.getState().openSettings(),
								},
							].map(item => {
								const Icon = item.icon;
								return (
									<button
										key={item.id}
										type="button"
										onClick={item.onClick}
										className="omp-pressable flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-omp-md text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
									>
										<Icon aria-hidden="true" className="shrink-0" size={15} />
										<span className="min-w-0 flex-1 truncate">{item.label}</span>
									</button>
								);
							})}
						</div>
					</div>
					<button
						type="button"
						aria-expanded={navigationExpanded}
						aria-label={t(navigationExpanded ? "sidebar.navigation.collapse" : "sidebar.navigation.expand")}
						onClick={() => setNavigationExpanded(expanded => !expanded)}
						className="omp-pressable mt-1 flex h-6 w-full items-center justify-center rounded-lg border border-[var(--omp-border-muted)] text-[var(--omp-dim)] hover:bg-[var(--omp-bg-tertiary)] hover:text-[var(--omp-muted)]"
					>
						{navigationExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
					</button>
				</div>

				<div className="flex items-center justify-between px-4 pb-1.5">
					<span className="text-omp-xs font-semibold uppercase tracking-[0.12em] text-[var(--omp-dim)]">
						{t("sidebar.recent")}
					</span>
					{totalCount > 0 && (
						<span
							className="rounded-full bg-[var(--omp-bg-tertiary)] px-2 py-0.5 text-omp-xs tabular-nums text-[var(--omp-dim)]" // surface-ok: count pill
						>
							{totalCount}
						</span>
					)}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [overflow-anchor:none]">
					{isLoading && sessions.length === 0 && (
						<div className="px-3 py-6 text-center text-omp-lg text-[var(--omp-dim)]">{t("sidebar.loading")}</div>
					)}
					{!isLoading && totalCount === 0 && (
						<div className="mx-1 mt-2 flex flex-col items-center rounded-xl border border-dashed border-[var(--omp-border-muted)] px-4 py-6 text-center">
							{mode === "code" ? (
								<Code2 size={20} className="mb-2 text-[var(--omp-muted)]" />
							) : (
								<BriefcaseBusiness size={20} className="mb-2 text-[var(--omp-muted)]" />
							)}
							<div className="text-omp-lg font-medium text-[var(--omp-muted)]">
								{mode === "code" ? t("sidebar.emptyCode") : t("sidebar.emptyWork")}
							</div>
						</div>
					)}
					{mode === "work" && workSessions.length > 0 && (
						<div className="space-y-px" data-work-section>
							{workSessions.map(renderSessionRow)}
						</div>
					)}
					{mode === "code" && chatSessions.length > 0 && (
						<div className="mb-1" data-chat-section>
							<button
								type="button"
								onClick={() => setCollapsed(prev => ({ ...prev, __chats__: !chatsCollapsed }))}
								aria-expanded={!chatsCollapsed}
								className="flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-omp-xs font-medium uppercase tracking-[0.08em] text-[var(--omp-dim)] hover:text-[var(--omp-muted)]"
							>
								{chatsCollapsed ? (
									<ChevronRight size={12} className="shrink-0" />
								) : (
									<ChevronDown size={12} className="shrink-0" />
								)}
								<MessageCircle size={11} className="shrink-0" />
								<span className="min-w-0 flex-1 truncate">{t("sidebar.chats")}</span>
								<span className="shrink-0 tabular-nums font-normal">{chatSessions.length}</span>
							</button>
							<div
								className="omp-sidebar-group"
								data-session-group="__chats__"
								data-state={chatsCollapsed ? "collapsed" : "expanded"}
								aria-hidden={chatsCollapsed}
								inert={chatsCollapsed}
							>
								<div className="omp-sidebar-group-content">
									<div className="space-y-px">{chatSessions.map(renderSessionRow)}</div>
								</div>
							</div>
						</div>
					)}
					{visibleGroups.map(group => {
						const groupCollapsed = isCollapsed(group.cwd);
						const isCurrent = group.cwd === cwd;
						const groupActionsOpen = confirmingGroupDeleteCwd === group.cwd || renamingGroupCwd === group.cwd;
						return (
							<div key={group.cwd} className="mb-0.5">
								<div
									data-workspace-group={group.cwd}
									data-actions-open={groupActionsOpen}
									onContextMenu={event => setGroupMenu({ anchor: anchorFromEvent(event), group })}
									className={cx(
										"omp-sidebar-workspace-row omp-color-fade group flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 pr-8 text-left text-omp-xs font-medium uppercase tracking-[0.08em]",
										isCurrent
											? "text-[var(--omp-muted)]"
											: "text-[var(--omp-dim)] hover:text-[var(--omp-muted)]",
									)}
								>
									{renamingGroupCwd === group.cwd ? (
										<>
											<button
												type="button"
												onClick={() => toggleGroup(group.cwd)}
												aria-expanded={!groupCollapsed}
												aria-label={group.name}
												className="flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-[var(--omp-bg-tertiary)]"
											>
												{groupCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
											</button>
											{pinnedGroups.includes(group.cwd) && (
												<Pin
													size={10}
													className="shrink-0 text-[var(--omp-accent)]"
													aria-label={t("sidebar.pinned")}
												/>
											)}
											<input
												ref={groupRenameRef}
												value={groupRenameDraft}
												onChange={event => setGroupRenameDraft(event.target.value)}
												onBlur={() => {
													useSidebarPrefs.getState().setGroupAlias(group.cwd, groupRenameDraft);
													setRenamingGroupCwd(null);
												}}
												onKeyDown={event => {
													if (event.key === "Enter") {
														useSidebarPrefs.getState().setGroupAlias(group.cwd, groupRenameDraft);
														setRenamingGroupCwd(null);
													}
													if (event.key === "Escape") setRenamingGroupCwd(null);
												}}
												className="min-w-0 flex-1 rounded border border-[var(--omp-input-focus-border)] bg-[var(--omp-input-bg)] px-1 py-0 text-omp-xs font-medium uppercase tracking-[0.08em] text-[var(--omp-text)] outline-none"
											/>
											<span className="shrink-0 tabular-nums text-omp-xs font-normal text-[var(--omp-dim)]">
												{group.sessions.length}
											</span>
										</>
									) : (
										<button
											type="button"
											onClick={() => toggleGroup(group.cwd)}
											aria-expanded={!groupCollapsed}
											className="flex min-w-0 flex-1 items-center gap-1 text-left"
										>
											{groupCollapsed ? (
												<ChevronRight size={12} className="shrink-0" />
											) : (
												<ChevronDown size={12} className="shrink-0" />
											)}
											{pinnedGroups.includes(group.cwd) && (
												<Pin
													size={10}
													className="shrink-0 text-[var(--omp-accent)]"
													aria-label={t("sidebar.pinned")}
												/>
											)}
											<SidebarRowTitle className="text-left" title={group.name} />
											<span className="shrink-0 tabular-nums text-omp-xs font-normal text-[var(--omp-dim)]">
												{group.sessions.length}
											</span>
										</button>
									)}
									<span
										className="omp-sidebar-workspace-actions flex shrink-0 items-center justify-end gap-0.5"
										onClick={event => event.stopPropagation()}
									>
										{confirmingGroupDeleteCwd === group.cwd ? (
											<>
												<button
													type="button"
													disabled={deleting}
													title={t("common.delete")}
													aria-label={t("common.delete")}
													onClick={() => void confirmDeleteGroup(group)}
													className="flex h-4 w-4 items-center justify-center rounded bg-[var(--omp-tool-error-bg)] text-[var(--omp-error)] hover:brightness-110 disabled:opacity-40"
												>
													<Check size={10} strokeWidth={3} />
												</button>
												<button
													type="button"
													disabled={deleting}
													title={t("common.cancel")}
													aria-label={t("common.cancel")}
													onClick={() => setConfirmingGroupDeleteCwd(null)}
													className="flex h-4 w-4 items-center justify-center rounded text-[var(--omp-dim)] hover:bg-[var(--omp-bg-tertiary)] hover:text-[var(--omp-text)] disabled:opacity-40"
												>
													<X size={10} strokeWidth={3} />
												</button>
											</>
										) : (
											<>
												<button
													type="button"
													title={t("sidebar.menu.newAgentHere")}
													aria-label={t("sidebar.menu.newAgentHere")}
													className="omp-sidebar-action flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--omp-dim)] hover:bg-[var(--omp-bg-tertiary)] hover:text-[var(--omp-text)]"
													onClick={event => {
														event.stopPropagation();
														void openTab({ cwd: group.cwd });
													}}
												>
													<Plus size={12} strokeWidth={2.5} />
												</button>
												<button
													type="button"
													title={t("sidebar.groupMenu")}
													aria-label={t("sidebar.groupMenu")}
													className="omp-sidebar-action flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--omp-dim)] hover:bg-[var(--omp-bg-tertiary)] hover:text-[var(--omp-text)]"
													onClick={event => {
														event.stopPropagation();
														const rect = event.currentTarget.getBoundingClientRect();
														setGroupMenu({ anchor: { x: rect.left, y: rect.bottom + 4 }, group });
													}}
												>
													<MoreHorizontal size={11} />
												</button>
											</>
										)}
									</span>
								</div>
								{/* Collapsed groups render nothing: a long-lived install with
								    hundreds of sessions must not build the full DOM per
								    debounced refresh just to hide it. */}
								{!groupCollapsed && (
									<div className="omp-sidebar-group" data-session-group={group.cwd} data-state="expanded">
										<div className="omp-sidebar-group-content">
											<div className="space-y-px">{group.sessions.map(renderSessionRow)}</div>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>

				{/* Bottom utility row: theme + language only — stats/settings live in the
				    TitleBar, and the files button was a subset of the drawer toggle. */}
				<div className="flex h-7 shrink-0 items-center gap-0.5 border-t border-[var(--omp-border-muted)] px-2">
					<button
						type="button"
						onClick={openThemePicker}
						title={t("themePicker.aria")}
						aria-label={t("themePicker.aria")}
						className={utilityButton}
					>
						<Palette size={13} />
					</button>
					<LangSwitcher className="h-6 max-h-6 rounded-md px-1.5 text-omp-sm [&_svg]:size-[14px]" />
					<div className="flex-1" />
				</div>
				<div
					role="separator"
					aria-orientation="vertical"
					onPointerDown={startSidebarDrag}
					onPointerMove={onSidebarDrag}
					onPointerUp={endSidebarDrag}
					className="absolute inset-y-0 right-0 z-10 w-1 translate-x-1/2 cursor-col-resize transition-colors hover:bg-[var(--omp-accent)]/40 active:bg-[var(--omp-accent)] max-[1000px]:hidden"
				/>
			</aside>
			<WorkspaceDialog open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} intent="new-session" />

			{/* Code is project-bound; Work is a full agent in the GUI-owned workspace. */}
			{modeMenu && (
				<ContextMenu
					x={modeMenu.x}
					y={modeMenu.y}
					onClose={() => setModeMenu(null)}
					items={[
						{
							id: "mode-code",
							label: t("sidebar.mode.code"),
							description: t("sidebar.mode.codeDescription"),
							icon: Code2,
							hint: mode === "code" ? "✓" : undefined,
							onSelect: () => {
								setMode("code");
								setModeMenu(null);
							},
						},
						{
							id: "mode-work",
							label: t("sidebar.mode.work"),
							description: t("sidebar.mode.workDescription"),
							icon: BriefcaseBusiness,
							hint: mode === "work" ? "✓" : undefined,
							onSelect: () => {
								setMode("work");
								setModeMenu(null);
							},
						},
					]}
				/>
			)}

			{/* Workspace group menu: new sessions, rename (alias), pin, delete. */}
			{groupMenu &&
				(() => {
					const groupHasRunningSession = groupMenu.group.sessions.some(isSessionRunning);
					return (
						<ContextMenu
							x={groupMenu.anchor.x}
							y={groupMenu.anchor.y}
							onClose={() => setGroupMenu(null)}
							items={[
								{
									id: "group-new-agent",
									label: t("sidebar.menu.newAgentHere"),
									icon: SquareTerminal,
									onSelect: () => {
										setGroupMenu(null);
										void openTab({ cwd: groupMenu.group.cwd });
									},
								},
								{
									id: "group-new-worktree",
									label: t("sidebar.menu.newWorktreeHere"),
									icon: GitBranchPlus,
									onSelect: () => {
										setGroupMenu(null);
										useUiStore.getState().openWorktreeDialog({ baseCwd: groupMenu.group.cwd });
									},
								},
								{
									id: "group-rename",
									label: t("sidebar.menu.rename"),
									icon: Pencil,
									onSelect: () => {
										setGroupRenameDraft(groupMenu.group.name);
										setRenamingGroupCwd(groupMenu.group.cwd);
										setGroupMenu(null);
										requestAnimationFrame(() => groupRenameRef.current?.select());
									},
								},
								{
									id: "group-pin",
									label: pinnedGroups.includes(groupMenu.group.cwd)
										? t("sidebar.menu.unpin")
										: t("sidebar.menu.pin"),
									icon: pinnedGroups.includes(groupMenu.group.cwd) ? PinOff : Pin,
									onSelect: () => {
										useSidebarPrefs.getState().toggleGroupPin(groupMenu.group.cwd);
										setGroupMenu(null);
									},
								},
								{
									id: "group-delete",
									label: t("common.delete"),
									icon: Trash2,
									danger: true,
									disabled: groupHasRunningSession,
									disabledReason: t("sidebar.deleteGroupStreaming"),
									onSelect: () => {
										setConfirmingGroupDeleteCwd(groupMenu.group.cwd);
										setGroupMenu(null);
									},
								},
							]}
						/>
					);
				})()}

			{/* Session row menu: open variants, per-task rename, pin, and delete. */}
			{sessionMenu &&
				(() => {
					const targetRunning = isSessionRunning(sessionMenu.session);
					return (
						<ContextMenu
							x={sessionMenu.anchor.x}
							y={sessionMenu.anchor.y}
							onClose={() => setSessionMenu(null)}
							items={[
								{
									id: "session-open",
									label: t("sidebar.menu.open"),
									icon: ChevronRight,
									onSelect: () => {
										setSessionMenu(null);
										void openSession(sessionMenu.session);
									},
								},
								{
									id: "session-open-tab",
									label: t("sidebar.menu.openNewTab"),
									icon: Plus,
									onSelect: () => {
										setSessionMenu(null);
										void openTab({
											cwd: sessionMenu.session.cwd,
											kind: sessionMenu.session.kind ?? "agent",
											sessionPath: sessionMenu.session.path,
										});
									},
								},
								{
									id: "session-open-window",
									label: t("sidebar.openInNewWindow"),
									icon: ExternalLink,
									onSelect: () => {
										setSessionMenu(null);
										void openSessionInNewWindow(sessionMenu.session);
									},
								},
								{
									id: "session-rename",
									label: t("sidebar.rename"),
									icon: Pencil,
									disabled: targetRunning,
									disabledReason: t("sidebar.menu.taskRunning"),
									onSelect: () => {
										setSessionMenu(null);
										startRename(sessionMenu.session);
									},
								},
								{
									id: "session-pin",
									label: pinnedSessions.includes(sessionMenu.session.path)
										? t("sidebar.menu.unpin")
										: t("sidebar.menu.pin"),
									icon: pinnedSessions.includes(sessionMenu.session.path) ? PinOff : Pin,
									onSelect: () => {
										const pinned = !pinnedSessions.includes(sessionMenu.session.path);
										useSidebarPrefs.getState().toggleSessionPin(sessionMenu.session.path);
										setSessionMenu(null);
										void window.omp.rpc.setSessionPinned(sessionMenu.session.id, pinned).then(response => {
											if (!response.success) {
												toast({ variant: "warning", message: t("sidebar.pinSyncFailed") });
											}
										});
									},
								},
								{
									id: "session-delete",
									label: t("common.delete"),
									icon: Trash2,
									danger: true,
									disabled: targetRunning,
									disabledReason: t("sidebar.menu.taskRunning"),
									onSelect: () => {
										setConfirmingDeletePath(sessionMenu.session.path);
										setSessionMenu(null);
									},
								},
							]}
						/>
					);
				})()}
		</>
	);
}
