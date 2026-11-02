import {
	Archive,
	ArchiveRestore,
	BarChart3,
	Bot,
	Brain,
	BriefcaseBusiness,
	CalendarClock,
	CheckCheck,
	ChevronDown,
	ChevronRight,
	Code2,
	Coins,
	Columns2,
	Command,
	ExternalLink,
	Folder,
	GitBranchPlus,
	GitPullRequest,
	Keyboard,
	ListChecks,
	LoaderCircle,
	type LucideIcon,
	MessageCircle,
	MessageSquarePlus,
	MessageSquareWarning,
	MoreHorizontal,
	Palette,
	Pencil,
	Pin,
	PinOff,
	Plug,
	RefreshCw,
	Rows2,
	Search,
	Settings,
	Sparkles,
	Square,
	SquareCheck,
	SquarePen,
	SquareTerminal,
	TextSearch,
	Trash2,
	X,
} from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { SessionInfo } from "../../../shared/ipc-types";
import { useAwaitingConfirmation } from "../../hooks/use-awaiting-confirmation";
import { useSessionList } from "../../hooks/use-session-list";
import { dropSessionNow, openSessionFromSidebar } from "../../hooks/use-session-switch";
import { basename, cx, formatTimeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { compileKeymap, KEYMAP_ACTIONS, onEscape } from "../../lib/keymap";
import { sessionDisplayTitle } from "../../lib/session-title";
import {
	buildSessionTree,
	isSubagentSession,
	isSubagentTranscript,
	orderSessionForest,
	type SessionNode,
	sessionParents,
} from "../../lib/session-tree";
import { useTabRpc } from "../../lib/tab-rpc";
import { tabSignalPresentation } from "../../lib/tab-signal";
import { useAgentPagesStore } from "../../stores/agent-pages";
import { useSchedulerStore } from "../../stores/scheduler";
import { useSessionStore } from "../../stores/session";
import { sessionRuntime } from "../../stores/session-runtime-context";
import { useSidebarPrefs } from "../../stores/sidebar-prefs";
import { usePendingSkillReviews } from "../../stores/skill-review";
import { type SplitAxis, useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import {
	SessionAgentsScope,
	type SidebarAgentsInfo,
	transcriptKey,
	useSidebarAgentTranscripts,
} from "../agents/SidebarAgents";
import { Button } from "../common";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { anchorFromEvent, ContextMenu, type ContextMenuAnchor } from "../common/ContextMenu";
import { LangSwitcher } from "../common/LangSwitcher";
import { WorkspaceDialog } from "../dialogs/WorkspaceDialog";
import { useUnreadNoticeCount } from "./NotificationBell";
import { SidebarQuotas } from "./SidebarQuotas";

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

/** A delete the row, context menu or selection bar queued, awaiting the confirmation dialog. */
type PendingDelete =
	| { kind: "session"; session: SessionInfo }
	| { kind: "group"; group: WorkspaceGroup }
	| { kind: "selection"; sessions: SessionInfo[] };

type SidebarMode = "code" | "work";

/** Two sessions open as a split pair of tabs, by session file in pane order. */
interface SessionPair {
	key: string;
	first: string;
	second: string;
	axis: SplitAxis;
	/** The pair is the one on screen. */
	onScreen: boolean;
}

/** One drawn session row. Children follow their parent; a pair's rows share a frame key. */
interface SessionRowSpec {
	session: SessionInfo;
	depth: number;
	/** Child sessions listed under this row while its family is open. */
	childCount: number;
	expanded: boolean;
	parentPath?: string;
	/** Another child of the same parent follows: this level's tree line runs on below the row. */
	moreSiblings: boolean;
	/** Depths of the ancestors whose tree line runs past this row. */
	guides: readonly number[];
	/** A folded family that holds the session on screen. */
	holdsActive: boolean;
	inPair: boolean;
	pair?: SessionPair;
	/** Rows drawn inside a pair's frame: both roots, each followed by its open family. */
	frame?: string;
}

/** Tree lines line up with the parent's signal dot, as the agent rows under a session do. */
function treeLineX(depth: number): number {
	return 1 + Math.min(depth, 6) * 14;
}

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
	const tabRpc = useTabRpc();
	const t = useT();
	const keymapOverrides = useUiStore(state => state.keymapOverrides);
	// The chords bound to each action, as the user configured them.
	const actionChords = useMemo(() => {
		const chords = new Map<string, string[]>();
		for (const [chord, action] of compileKeymap(KEYMAP_ACTIONS, keymapOverrides)) {
			chords.set(action, [...(chords.get(action) ?? []), chord]);
		}
		return chords;
	}, [keymapOverrides]);
	const paletteShortcut = (actionChords.get("palette") ?? []).join(" / ");
	const [mode, setMode] = useState<SidebarMode>("code");
	const [defaultWorkspace, setDefaultWorkspace] = useState<string | null>(null);
	const switchPendingTo = useSessionStore(s => s.switchPending?.toId ?? null);
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
	// Bulk deletes run one file at a time; the dialog counts them off.
	const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);
	// Selection mode for bulk archive/delete: null while off. The anchor is the
	// last row clicked, the start of a ⇧-click range.
	const [selection, setSelection] = useState<ReadonlySet<string> | null>(null);
	const selectionAnchor = useRef<string | null>(null);
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	// A session's family (its subagent sessions, forks and continuations) stays
	// folded until you open it, so the list reads as main sessions. The family
	// holding the session on screen opens by itself, keeping that row in view.
	const [openFamilies, setOpenFamilies] = useState<Record<string, boolean>>({});
	const setFamilyOpen = (sessionPath: string, open: boolean) => {
		setOpenFamilies(prev => ({ ...prev, [sessionPath]: open }));
	};
	// Deleting a session hard-deletes its transcript file, so the row and menu
	// clicks only queue it: the dialog names the target and states the
	// consequence before anything is removed.
	const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
	const [renamingSessionPath, setRenamingSessionPath] = useState<string | null>(null);
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const [renameDraft, setRenameDraft] = useState("");
	// Mode selector, workspace group context menu, session row context menu.
	const [moreMenu, setMoreMenu] = useState<ContextMenuAnchor | null>(null);
	const [groupMenu, setGroupMenu] = useState<{ anchor: ContextMenuAnchor; group: WorkspaceGroup } | null>(null);
	const [sessionMenu, setSessionMenu] = useState<{ anchor: ContextMenuAnchor; session: SessionInfo } | null>(null);
	// Workspace display alias rename (group header inline input).
	const [renamingGroupCwd, setRenamingGroupCwd] = useState<string | null>(null);
	const [groupRenameDraft, setGroupRenameDraft] = useState("");
	const groupRenameRef = useRef<HTMLInputElement>(null);
	const openTab = useTabsStore(s => s.openTab);
	const tabs = useTabsStore(s => s.tabs);
	const activeTabId = useTabsStore(s => s.activeTabId);
	const activeTab = tabs.find(tab => tab.id === activeTabId);
	const tabGroups = useTabsStore(s => s.groups);
	const shownPair = useTabsStore(s => s.split);
	// Split pairs by session file (gui#30): a pair's rows sit together like its
	// merged tab chip, and follow it as pairs form, move or come apart.
	const sessionPairs = useMemo(() => {
		const pairs = new Map<string, SessionPair>();
		for (const group of tabGroups) {
			const first = tabs.find(tab => tab.id === group.firstTabId)?.sessionPath;
			const second = tabs.find(tab => tab.id === group.secondTabId)?.sessionPath;
			if (!first || !second) continue;
			const pair = { key: `${first}|${second}`, first, second, axis: group.axis, onScreen: group === shownPair };
			pairs.set(first, pair);
			pairs.set(second, pair);
		}
		return pairs;
	}, [tabGroups, tabs, shownPair]);
	const [hoveredPair, setHoveredPair] = useState<string | null>(null);
	const activeTabKind = activeTab?.kind;
	const pinnedGroups = useSidebarPrefs(s => s.pinnedGroups);
	const pinnedSessions = useSidebarPrefs(s => s.pinnedSessions);
	const archivedPaths = useSidebarPrefs(s => s.archivedSessions);
	const archived = useMemo(() => new Set(archivedPaths), [archivedPaths]);
	const groupAliases = useSidebarPrefs(s => s.groupAliases);
	const workspaceLastUsed = useSidebarPrefs(s => s.workspaceLastUsed);
	const sessionLastUsed = useSidebarPrefs(s => s.sessionLastUsed);
	const touchSession = useSidebarPrefs(s => s.touchSession);
	const renameRef = useRef<HTMLInputElement>(null);
	const { sessions, isLoading, error: listError, refresh, deleteSession, renameSession } = useSessionList("global");
	const sessionId = useSessionStore(s => s.sessionId);
	const agentTranscripts = useSidebarAgentTranscripts();
	const cwd = useSessionStore(s => s.cwd);
	const isStreaming = useSessionStore(s => s.isStreaming);
	const isCompacting = useSessionStore(s => s.isCompacting);
	// Sidebar signal-light state for the ATTACHED session: a blocking
	// confirmation (plan approval / ask / permission) overrides the running
	// signal — it needs the user, not just time.
	const awaitingConfirmation = useAwaitingConfirmation();
	const openThemePicker = useUiStore(s => s.openThemePicker);
	const openSessionPicker = useUiStore(s => s.openSessionPicker);
	const pendingSkillReviews = usePendingSkillReviews();
	const pendingTaskReviews = useSchedulerStore(state => state.snapshot?.reviewCount ?? 0);
	const unreadNotices = useUnreadNoticeCount();

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

	const recencyForSession = useCallback(
		(session: SessionInfo) => sessionLastUsed[session.path] ?? modifiedAt(session),
		[sessionLastUsed],
	);
	// A child session goes where its family goes: its root's lane and project,
	// and into Archived with an archived ancestor. Archiving a session takes its
	// family along instead of leaving the children behind as top-level rows.
	const parentOf = useMemo(() => sessionParents(sessions), [sessions]);
	const familyRoot = useCallback(
		(session: SessionInfo) => {
			let root = session;
			for (let parent = parentOf.get(root.path); parent; parent = parentOf.get(root.path)) {
				root = parent;
			}
			return root;
		},
		[parentOf],
	);
	/** The archived sessions among `session` and its ancestors: what keeps it in Archived. */
	const archivedLine = useCallback(
		(session: SessionInfo) => {
			const line: string[] = [];
			for (let cursor: SessionInfo | undefined = session; cursor; cursor = parentOf.get(cursor.path)) {
				if (archived.has(cursor.path)) line.push(cursor.path);
			}
			return line;
		},
		[archived, parentOf],
	);
	const isArchived = useCallback((session: SessionInfo) => archivedLine(session).length > 0, [archivedLine]);
	// Opening a session undoes an earlier fold of the family that holds it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new session on screen is the trigger.
	useEffect(() => {
		setOpenFamilies(prev => Object.fromEntries(Object.entries(prev).filter(([, open]) => open)));
	}, [sessionId]);
	const agentSessions = useMemo(
		() => sessions.filter(session => familyRoot(session).kind !== "chat" && !isArchived(session)),
		[sessions, familyRoot, isArchived],
	);
	const codeSessions = useMemo(
		() => agentSessions.filter(session => !defaultWorkspace || familyRoot(session).cwd !== defaultWorkspace),
		[agentSessions, defaultWorkspace, familyRoot],
	);
	const workSessions = useMemo(
		() =>
			agentSessions
				.filter(session => defaultWorkspace !== null && familyRoot(session).cwd === defaultWorkspace)
				.toSorted((a, b) => {
					const aPinned = pinnedSessions.includes(a.path) ? 0 : 1;
					const bPinned = pinnedSessions.includes(b.path) ? 0 : 1;
					if (aPinned !== bPinned) return aPinned - bPinned;
					return recencyForSession(b) - recencyForSession(a);
				}),
		[agentSessions, defaultWorkspace, familyRoot, pinnedSessions, recencyForSession],
	);
	const chatSessions = useMemo(
		() =>
			sessions
				.filter(session => familyRoot(session).kind === "chat" && !isArchived(session))
				.toSorted((a, b) => {
					const aPinned = pinnedSessions.includes(a.path) ? 0 : 1;
					const bPinned = pinnedSessions.includes(b.path) ? 0 : 1;
					if (aPinned !== bPinned) return aPinned - bPinned;
					return recencyForSession(b) - recencyForSession(a);
				}),
		[sessions, familyRoot, isArchived, pinnedSessions, recencyForSession],
	);
	// Archived sessions of the lane on screen, newest first.
	const archivedSessions = useMemo(
		() =>
			sessions
				.filter(session => {
					if (!isArchived(session)) return false;
					const root = familyRoot(session);
					const inWork = root.kind !== "chat" && defaultWorkspace !== null && root.cwd === defaultWorkspace;
					return mode === "work" ? inWork : !inWork;
				})
				.toSorted((a, b) => recencyForSession(b) - recencyForSession(a)),
		[sessions, defaultWorkspace, familyRoot, isArchived, mode, recencyForSession],
	);

	// Code sessions stay grouped by project. Pins remain a priority partition,
	// with MRU inside it.
	const groups = useMemo<WorkspaceGroup[]>(() => {
		const byCwd = new Map<string, SessionInfo[]>();
		for (const session of codeSessions) {
			const groupCwd = familyRoot(session).cwd;
			const list = byCwd.get(groupCwd) ?? [];
			list.push(session);
			byCwd.set(groupCwd, list);
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
	}, [codeSessions, familyRoot, groupAliases, pinnedGroups, pinnedSessions, recencyForSession, workspaceLastUsed]);
	function isCollapsedGroup(groupCwd: string): boolean {
		if (groupCwd in collapsed) return collapsed[groupCwd] === true;
		// Default: current workspace expanded, others collapsed (Codex-style).
		return groupCwd !== cwd;
	}
	const totalCount = mode === "work" ? workSessions.length : codeSessions.length + chatSessions.length;
	// Counts name the sessions you started; subagent transcripts sit inside them.
	const listedCount = (list: readonly SessionInfo[]) => list.filter(session => !isSubagentSession(session)).length;
	const visibleGroups = mode === "code" ? groups : [];
	const chatsCollapsed = collapsed.__chats__ ?? false;
	const archivedCollapsed = collapsed.__archived__ ?? true;
	// A tab knows its session file from the start; the id comes later, from the sidecar.
	const tabForSession = (session: SessionInfo) =>
		tabs.find(tab => tab.sessionPath === session.path || (tab.sessionId && tab.sessionId === session.id)) ??
		(session.id === sessionId ? activeTab : undefined);
	// Child sessions nest under the parent named by parentSessionPath. Roots are
	// ordered by the family's newest activity, so a subagent that just ran does
	// not leave its parent behind in the list. A session open in a tab lists its
	// agents live under its row (SidebarAgents), so the transcripts of the
	// agents shown there are not listed a second time. Its other transcripts
	// (agents of earlier turns), forks and continuations still are, and so is a
	// transcript open in a tab of its own.
	const rowsOf = (list: readonly SessionInfo[]): SessionRowSpec[] => {
		const forest = orderSessionForest(buildSessionTree(list), {
			pinned: session => pinnedSessions.includes(session.path),
			recency: recencyForSession,
		});
		const byPath = new Map(forest.map(node => [node.session.path, node]));
		const placed = new Set<string>();
		const specs: SessionRowSpec[] = [];
		const listedChildren = (node: SessionNode): SessionNode[] => {
			const tab = tabForSession(node.session);
			if (!tab || !sessionRuntime(tab.id)) return node.children;
			// Until the agent rows have said which transcripts they show: all of them.
			const shown = agentTranscripts[node.session.path];
			return node.children.filter(
				child =>
					!isSubagentTranscript(child.session, node.session) ||
					tabForSession(child.session) !== undefined ||
					(shown !== undefined && !shown.has(transcriptKey(child.session.path))),
			);
		};
		const holdsActive = (node: SessionNode): boolean =>
			listedChildren(node).some(child => child.session.id === sessionId || holdsActive(child));
		const familyOpen = (node: SessionNode) => openFamilies[node.session.path] ?? holdsActive(node);
		const appendChildren = (
			node: SessionNode,
			children: readonly SessionNode[],
			depth: number,
			guides: readonly number[],
		) => {
			children.forEach((child, index) => {
				appendNode(child, depth, node.session.path, index < children.length - 1, guides);
			});
		};
		// The pair frame the rows being appended are drawn in.
		let frame: string | undefined;
		const appendNode = (
			node: SessionNode,
			depth: number,
			parentPath: string | undefined,
			moreSiblings: boolean,
			guides: readonly number[],
		) => {
			const children = listedChildren(node);
			const expanded = children.length > 0 && familyOpen(node);
			specs.push({
				session: node.session,
				depth,
				childCount: children.length,
				expanded,
				parentPath,
				moreSiblings,
				guides,
				holdsActive: !expanded && holdsActive(node),
				inPair: false,
				frame,
			});
			if (!expanded) return;
			// Below a child that has a later sibling, that sibling line runs on.
			appendChildren(node, children, depth + 1, depth > 0 && moreSiblings ? [...guides, depth] : guides);
		};
		for (const node of forest) {
			if (placed.has(node.session.path)) continue;
			const pair = sessionPairs.get(node.session.path);
			if (pair && byPath.has(pair.first) && byPath.has(pair.second)) {
				const first = byPath.get(pair.first);
				const second = byPath.get(pair.second);
				if (!first || !second) continue;
				placed.add(pair.first);
				placed.add(pair.second);
				// Each member is followed by its own family, inside the frame.
				frame = pair.key;
				for (const member of [first, second]) {
					const start = specs.length;
					appendNode(member, 0, undefined, false, []);
					const lead = specs[start];
					if (lead) specs[start] = { ...lead, inPair: true, pair };
				}
				frame = undefined;
				continue;
			}
			placed.add(node.session.path);
			appendNode(node, 0, undefined, false, []);
		}
		return specs;
	};
	// Rows in the order they are drawn: what "select all" and a ⇧-click range cover.
	// Within a section a pair's rows are drawn together, and a ⇧-click range follows that.
	const visibleSessions = [
		...(mode === "work" ? rowsOf(workSessions) : []),
		...visibleGroups.flatMap(group => (isCollapsedGroup(group.cwd) ? [] : rowsOf(group.sessions))),
		...(mode === "code" && !chatsCollapsed ? rowsOf(chatSessions) : []),
		...(archivedCollapsed ? [] : rowsOf(archivedSessions)),
	].map(spec => spec.session);
	const selectedSessions = selection ? sessions.filter(session => selection.has(session.path)) : [];
	const bulkLabel =
		selectedSessions.length > 0
			? t("sidebar.bulk.count", { count: selectedSessions.length })
			: t("sidebar.bulk.empty");
	const allSelectedArchived = selectedSessions.length > 0 && selectedSessions.every(isArchived);

	const toggleGroup = (groupCwd: string) => {
		setCollapsed(prev => ({ ...prev, [groupCwd]: !isCollapsedGroup(groupCwd) }));
	};
	const sessionTabSignal = (session: SessionInfo) => {
		const tab = tabForSession(session);
		return tab ? tabSignalPresentation(tab, session.id === sessionId && (isStreaming || isCompacting)) : null;
	};
	const isSessionBusy = (session: SessionInfo) => {
		if (session.id === sessionId && awaitingConfirmation) return true;
		const signal = sessionTabSignal(session);
		if (signal) return signal.active;
		if (session.id === sessionId && (isStreaming || isCompacting)) return true;
		return session.status === "pending";
	};

	const openSession = (session: SessionInfo) => {
		// A session open in a tab may be showing one of its agent pages: its row
		// is the way back to the conversation.
		const tab = tabForSession(session);
		if (tab && useAgentPagesStore.getState().shown[tab.id]) {
			useAgentPagesStore.getState().show(tab.id, null);
			return;
		}
		if (session.id === sessionId) return;
		void openSessionFromSidebar(session);
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
			toast({ variant: "error", message: t("sidebar.newWindowFailed") });
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
		if (isSessionBusy(session)) {
			toast({ variant: "warning", message: t("sidebar.menu.taskRunning") });
			setPendingDelete(null);
			return;
		}
		setDeleting(true);
		try {
			if (session.id === sessionId) {
				await dropSessionNow();
			} else {
				await deleteSession(session.path);
			}
			useSidebarPrefs.getState().forgetSessions([session.path]);
			setPendingDelete(null);
		} catch (error) {
			toast({ variant: "error", title: t("sidebar.deleteFailed"), message: String(error) });
		} finally {
			setDeleting(false);
		}
	};

	const confirmDeleteGroup = async (group: WorkspaceGroup) => {
		if (group.sessions.some(isSessionBusy)) {
			toast({ variant: "warning", message: t("sidebar.deleteGroupStreaming") });
			setPendingDelete(null);
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
			useSidebarPrefs.getState().forgetSessions(group.sessions.map(session => session.path));
			setPendingDelete(null);
		} catch (error) {
			toast({ variant: "error", title: t("sidebar.deleteFailed"), message: String(error) });
		} finally {
			setDeleting(false);
		}
	};

	// Running sessions are left alone; the rest go one file at a time so the
	// dialog can count them off, and whatever was deleted before a failure stays
	// deleted and leaves the selection.
	const confirmDeleteSelection = async (targets: readonly SessionInfo[]) => {
		const idle = targets.filter(session => !isSessionBusy(session));
		const skipped = targets.length - idle.length;
		const deleted: string[] = [];
		setDeleting(true);
		setDeleteProgress({ done: 0, total: idle.length });
		try {
			for (const session of idle) {
				// eslint-disable-next-line no-await-in-loop -- sequential, keep FS load bounded
				if (session.id === sessionId) await dropSessionNow();
				else await deleteSession(session.path);
				deleted.push(session.path);
				setDeleteProgress({ done: deleted.length, total: idle.length });
			}
			setPendingDelete(null);
			setSelection(null);
			if (skipped > 0) toast({ variant: "warning", message: t("sidebar.bulk.skippedRunning", { count: skipped }) });
		} catch (error) {
			toast({ variant: "error", title: t("sidebar.deleteFailed"), message: String(error) });
			setPendingDelete(null);
			setSelection(current => {
				if (!current) return current;
				const next = new Set(current);
				for (const path of deleted) next.delete(path);
				return next;
			});
		} finally {
			useSidebarPrefs.getState().forgetSessions(deleted);
			setDeleting(false);
			setDeleteProgress(null);
		}
	};

	const startSelection = (paths: readonly string[]) => {
		setSelection(new Set(paths));
		selectionAnchor.current = paths.at(-1) ?? null;
	};
	const endSelection = () => {
		setSelection(null);
		selectionAnchor.current = null;
	};
	// ⌘/Ctrl-click toggles one row, ⇧-click adds the drawn range from the last
	// row clicked; either starts selection mode.
	const clickToSelect = (session: SessionInfo, event: { shiftKey: boolean }) => {
		const next = new Set(selection ?? []);
		const order = visibleSessions.map(item => item.path);
		const from = selectionAnchor.current ? order.indexOf(selectionAnchor.current) : -1;
		const to = order.indexOf(session.path);
		if (event.shiftKey && from >= 0 && to >= 0) {
			for (const path of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(path);
		} else if (next.has(session.path)) {
			next.delete(session.path);
		} else {
			next.add(session.path);
		}
		selectionAnchor.current = session.path;
		setSelection(next);
	};
	const archiveSelection = (archive: boolean) => {
		void useSidebarPrefs
			.getState()
			.setSessionsArchived(
				archive ? selectedSessions.map(session => session.path) : selectedSessions.flatMap(archivedLine),
				archive,
			);
		endSelection();
	};
	// Keys in selection mode, ahead of the window's own handlers (capture), so
	// the Escape that ends a selection never also aborts the running turn:
	// Escape leaves it, and with focus in the sidebar ⌘A selects every row shown
	// and ⌫/Delete asks to delete the selection. A text field, dialog or menu
	// keeps its keys.
	const selecting = selection !== null;
	const selectionKeys = useRef({ selectAll: () => {}, deleteSelected: () => {} });
	selectionKeys.current = {
		selectAll: () => startSelection(visibleSessions.map(session => session.path)),
		deleteSelected: () => {
			if (selectedSessions.length > 0) setPendingDelete({ kind: "selection", sessions: selectedSessions });
		},
	};
	useEffect(() => {
		if (!selecting) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || isImeKeyEvent(event)) return;
			if (document.querySelector('[role="dialog"], [role="menu"]')) return;
			const target = event.target instanceof HTMLElement ? event.target : null;
			if (target?.closest("input, textarea, [contenteditable='true']")) return;
			const inSidebar = target?.closest(".omp-session-sidebar") != null;
			const command = event.metaKey || event.ctrlKey;
			if (event.key === "Escape") {
				setSelection(null);
				selectionAnchor.current = null;
			} else if (inSidebar && command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
				selectionKeys.current.selectAll();
			} else if (inSidebar && !command && (event.key === "Backspace" || event.key === "Delete")) {
				selectionKeys.current.deleteSelected();
			} else {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [selecting]);

	const rowActionButton =
		"omp-sidebar-action flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--omp-dim)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]";

	const renderSessionRow = (spec: SessionRowSpec) => {
		// Sessions open in a tab list this turn's agents under them (plan/24 §3.1).
		const tab = tabForSession(spec.session);
		if (!tab) return sessionRowElement(spec, null);
		const level = Math.min(spec.depth, 6);
		const layout = {
			offset: level * 14,
			lines: [...spec.guides.map(treeLineX), ...(spec.depth > 0 && spec.moreSiblings ? [treeLineX(level)] : [])],
			trunk: spec.expanded && spec.childCount > 0,
		};
		return (
			<SessionAgentsScope key={spec.session.path} layout={layout} sessionKey={spec.session.path} tabId={tab.id}>
				{agents => sessionRowElement(spec, agents)}
			</SessionAgentsScope>
		);
	};

	/** One section's rows. Child sessions sit under their parent; a pair's rows share a frame. */
	const renderSessionRows = (list: readonly SessionInfo[]) => {
		const specs = rowsOf(list);
		const rows: ReactNode[] = [];
		for (let index = 0; index < specs.length; index++) {
			const spec = specs[index];
			if (!spec) continue;
			if (spec.frame && spec.pair) {
				const framed: SessionRowSpec[] = [];
				while (specs[index]?.frame === spec.frame) framed.push(specs[index++] as SessionRowSpec);
				index--;
				rows.push(
					<div
						key={spec.pair.key}
						data-sidebar-pair
						data-on-screen={spec.pair.onScreen || undefined}
						className="omp-sidebar-pair space-y-px"
					>
						{framed.map(renderSessionRow)}
					</div>,
				);
				continue;
			}
			rows.push(renderSessionRow(spec));
		}
		return rows;
	};

	const sessionRowElement = (spec: SessionRowSpec, agents: SidebarAgentsInfo | null) => {
		const session = spec.session;
		const inPairFrame = spec.inPair;
		const active = session.id === sessionId;
		const tabSignal = sessionTabSignal(session);
		const waiting = active && awaitingConfirmation;
		const externalRunning = tabSignal === null && isSessionBusy(session);
		const signalActive = waiting || tabSignal?.active === true || externalRunning;
		const signalLabel = waiting
			? t("sidebar.signal.waiting")
			: tabSignal
				? t(tabSignal.labelKey)
				: externalRunning
					? t("sidebar.signal.running")
					: t(STATUS_LABEL_KEY[session.status]);
		const signalColor = waiting
			? "var(--omp-warning)"
			: (tabSignal?.color ?? (externalRunning ? "var(--omp-accent)" : STATUS_COLOR[session.status]));
		const title = sessionDisplayTitle(session, t("sidebar.untitled"));
		const hasActions = !signalActive;
		const renaming = renamingSessionPath === session.path;
		const pinned = pinnedSessions.includes(session.path);
		const recency = recencyForSession(session);
		const selected = selection?.has(session.path) === true;
		const SelectIcon = selected ? SquareCheck : Square;
		// A pair split across sections can't share a frame: its rows carry a mark,
		// and hovering one lights the other.
		const pair = sessionPairs.get(session.path);
		const partnerSession = pair
			? sessions.find(entry => entry.path === (pair.first === session.path ? pair.second : pair.first))
			: undefined;
		const PairIcon = pair?.axis === "rows" ? Rows2 : Columns2;
		// One disclosure per row: this turn's agents of an open tab, the child
		// sessions listed under it, or both. It shows open while either is, and
		// opens or closes both together.
		const agentsOpen = agents?.expanded === true;
		const familyShown = spec.childCount > 0 && spec.expanded;
		const setDisclosure = (open: boolean) => {
			if (agents && agents.expanded !== open) agents.toggle();
			if (spec.childCount > 0) setFamilyOpen(session.path, open);
		};
		const disclosure =
			agents || spec.childCount > 0
				? {
						expanded: agentsOpen || familyShown,
						allOpen: (!agents || agentsOpen) && (spec.childCount === 0 || familyShown),
						count: (agents?.count ?? 0) + spec.childCount,
						working: agents?.working === true,
						set: setDisclosure,
						toggle: () => setDisclosure(!(agentsOpen || familyShown)),
					}
				: null;
		const disclosureLabel = disclosure?.expanded
			? t(agents ? "agents.sidebar.collapse" : "sidebar.subsessions.collapse")
			: t(agents ? "agents.sidebar.expand" : "sidebar.subsessions.expand");
		const pillLabel = !agents
			? t("sidebar.subsessions.count", { count: spec.childCount, plural: spec.childCount === 1 ? "" : "s" })
			: spec.childCount === 0
				? t("agents.sidebar.pill", { count: agents.count })
				: t("sidebar.subsessions.countWithAgents", { count: disclosure?.count ?? 0 });
		const level = Math.min(spec.depth, 6);
		const lineX = treeLineX;
		return (
			<div
				key={session.path}
				role="button"
				data-pair-key={pair?.key}
				data-pair-hover={(pair && !inPairFrame && hoveredPair === pair.key) || undefined}
				onMouseEnter={pair && !inPairFrame ? () => setHoveredPair(pair.key) : undefined}
				onMouseLeave={pair && !inPairFrame ? () => setHoveredPair(null) : undefined}
				tabIndex={0}
				aria-pressed={selecting ? selected : undefined}
				aria-expanded={disclosure && !selecting ? disclosure.expanded : undefined}
				onClick={event => {
					if (selecting || event.metaKey || event.ctrlKey || (event.shiftKey && selectionAnchor.current)) {
						clickToSelect(session, event);
						return;
					}
					selectionAnchor.current = session.path;
					void openSession(session);
				}}
				onContextMenu={event => setSessionMenu({ anchor: anchorFromEvent(event), session })}
				onKeyDown={event => {
					// Only the row itself: Enter inside a nested control (rename
					// input, action buttons) must not also switch the session.
					if (event.target !== event.currentTarget) return;
					if (disclosure && !selecting && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
						event.preventDefault();
						if (event.key === "ArrowRight" && !disclosure.allOpen) disclosure.set(true);
						if (event.key === "ArrowLeft" && disclosure.expanded) disclosure.set(false);
						return;
					}
					if (selecting && (event.key === "Enter" || event.key === " ")) {
						event.preventDefault();
						clickToSelect(session, event);
					} else if (event.key === "Enter") void openSession(session);
				}}
				data-active={active}
				data-selected={selected || undefined}
				data-switch-pending={switchPendingTo === session.id || undefined}
				data-has-actions={hasActions && !selecting}
				data-actions-open={renaming}
				data-session-kind={session.kind ?? "agent"}
				data-session-depth={spec.depth > 0 ? spec.depth : undefined}
				data-session-parent={spec.parentPath}
				style={level > 0 ? { paddingLeft: 8 + level * 14 } : undefined}
				className={cx(
					"omp-sidebar-session-row omp-color-fade group relative flex h-[30px] cursor-pointer items-center rounded-lg px-2 select-none",
					selected || (active && !selecting && !agents?.pageShown)
						? "bg-[var(--omp-selected-bg)]"
						: "hover:bg-[var(--omp-sidebar-item-hover)]",
				)}
			>
				{level > 0 && (
					<>
						<span aria-hidden className="omp-sidebar-agent-elbow" style={{ left: lineX(level) }} />
						{spec.moreSiblings && (
							<span aria-hidden className="omp-sidebar-agent-guide" style={{ left: lineX(level) }} />
						)}
						{spec.guides.map(depth => (
							<span
								aria-hidden
								className="omp-sidebar-agent-guide omp-sidebar-agent-guide--full"
								key={depth}
								style={{ left: lineX(depth) }}
							/>
						))}
					</>
				)}
				{/* The status slot lines titles up under the group icon; idle rows leave it empty. */}
				<span data-sidebar-session-icon className="mr-2 flex w-4 shrink-0 justify-center">
					{disclosure && !selecting && (
						// The sidebar has no free column for a chevron: the signal slot
						// shows it while the row is hovered or focused (plan/24 §3.1),
						// so titles stay aligned whether or not a row has a family.
						<button
							type="button"
							tabIndex={-1}
							aria-label={disclosureLabel}
							onClick={event => {
								event.stopPropagation();
								disclosure.toggle();
							}}
							className="hidden h-4 w-4 items-center justify-center rounded text-[var(--omp-dim)] group-hover:flex group-focus-visible:flex hover:text-[var(--omp-text)]"
						>
							{disclosure.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
						</button>
					)}
					{selecting ? (
						<SelectIcon
							size={14}
							strokeWidth={1.75}
							className={selected ? "text-[var(--omp-accent)]" : "text-[var(--omp-dim)]"}
						/>
					) : (
						<span
							role="img"
							aria-label={signalLabel}
							title={signalLabel}
							className={cx(
								"omp-signal-light",
								signalActive && "omp-signal-light--active",
								disclosure && "group-hover:hidden group-focus-visible:hidden",
							)}
							data-idle={
								// Past sessions that simply finished carry no signal; unread
								// completions (an open tab) and anything live or failed do.
								(!signalActive &&
									(signalColor === "var(--omp-dim)" ||
										(tabSignal === null && session.status === "complete"))) ||
								undefined
							}
							style={{ color: signalColor }}
						/>
					)}
				</span>
				{pinned && (
					<Pin size={11} className="mr-1.5 shrink-0 text-[var(--omp-dim)]" aria-label={t("sidebar.pinned")} />
				)}
				{pair && !inPairFrame && (
					<PairIcon
						size={11}
						className={cx(
							"mr-1.5 shrink-0",
							pair.onScreen ? "text-[var(--omp-accent)]" : "text-[var(--omp-dim)]",
						)}
						aria-label={t("sidebar.pairedWith", {
							title: partnerSession ? sessionDisplayTitle(partnerSession, t("sidebar.untitled")) : "",
						})}
					/>
				)}
				{renaming ? (
					<input
						ref={renameRef}
						value={renameDraft}
						onChange={event => setRenameDraft(event.target.value)}
						onBlur={event => commitRename(session, event.currentTarget.value)}
						onKeyDown={event => {
							if (isImeKeyEvent(event)) return;
							if (event.key === "Enter") commitRename(session, event.currentTarget.value);
							onEscape(event, () => setRenamingSessionPath(null));
						}}
						onClick={event => event.stopPropagation()}
						className="min-w-0 flex-1 rounded-md border border-[var(--omp-input-focus-border)] bg-[var(--omp-input-bg)] px-1.5 py-0.5 text-omp-md text-[var(--omp-text)] outline-none"
					/>
				) : (
					<SidebarRowTitle
						className={cx(
							"text-omp-md leading-5",
							active ? "text-[var(--omp-text)]" : "text-[var(--omp-text-secondary)]",
						)}
						title={title}
					/>
				)}
				{disclosure && !disclosure.expanded && !renaming && (
					<button
						type="button"
						tabIndex={-1}
						aria-label={pillLabel}
						title={pillLabel}
						onClick={event => {
							event.stopPropagation();
							disclosure.toggle();
						}}
						data-holds-active={spec.holdsActive || undefined}
						className="omp-sidebar-agent-pill ml-1.5 shrink-0 hover:text-[var(--omp-text)]"
					>
						{disclosure.working && (
							<span aria-hidden className="h-[5px] w-[5px] rounded-full bg-[var(--omp-accent)]" />
						)}
						{disclosure.count}
					</button>
				)}
				{!renaming && recency > 0 && (
					<span className="omp-sidebar-time ml-2 shrink-0 text-omp-xs tabular-nums text-[var(--omp-dim)]">
						{formatTimeAgo(new Date(recency).toISOString(), { compact: true })}
					</span>
				)}
				<span
					hidden={selecting}
					className="omp-sidebar-session-actions flex shrink-0 items-center justify-end gap-0.5"
					onClick={event => event.stopPropagation()}
				>
					{!signalActive && !renaming && (
						<button
							type="button"
							title={t("sidebar.rename")}
							aria-label={t("sidebar.rename")}
							onClick={() => startRename(session)}
							className={rowActionButton}
						>
							<Pencil size={12} />
						</button>
					)}
					{!signalActive && (
						<button
							className={cx(
								rowActionButton,
								"hover:!bg-[var(--omp-tool-error-bg)] hover:!text-[var(--omp-error)]",
							)}
							onClick={() => setPendingDelete({ kind: "session", session })}
							title={t("sidebar.delete")}
							type="button"
							aria-label={t("sidebar.delete")}
						>
							<Trash2 size={12} />
						</button>
					)}
				</span>
			</div>
		);
	};

	/** One collapsible group header: icon (chevron on hover), name, count, hover actions. */
	const renderGroupHeader = ({
		id,
		name,
		count,
		icon: Icon,
		collapsedState,
		onToggle,
		pinned,
		actions,
		renameInput,
		onContextMenu,
		current,
	}: {
		id: string;
		name: string;
		count: number;
		icon: LucideIcon;
		collapsedState: boolean;
		onToggle: () => void;
		pinned?: boolean;
		actions?: ReactNode;
		renameInput?: ReactNode;
		onContextMenu?: (event: ReactMouseEvent) => void;
		current?: boolean;
	}) => (
		<div
			data-workspace-group={id.startsWith("__") ? undefined : id}
			data-actions-open={renameInput ? true : undefined}
			onContextMenu={onContextMenu}
			className={cx(
				"omp-sidebar-workspace-row omp-color-fade group/header flex h-[30px] w-full items-center rounded-lg px-2 text-omp-md",
				current ? "text-[var(--omp-text)]" : "text-[var(--omp-muted)] hover:text-[var(--omp-text)]",
				"hover:bg-[var(--omp-sidebar-item-hover)]",
			)}
		>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={!collapsedState}
				aria-label={renameInput ? name : undefined}
				className="flex min-w-0 flex-1 items-center text-left"
			>
				<span className="omp-sidebar-group-icon relative mr-2 flex size-4 shrink-0 items-center justify-center">
					<Icon
						aria-hidden="true"
						data-sidebar-workspace-icon={id.startsWith("__") ? undefined : true}
						size={15}
						strokeWidth={1.75}
					/>
					<ChevronRight
						aria-hidden="true"
						size={13}
						className={cx("omp-disclosure-chevron absolute", !collapsedState && "rotate-90")}
					/>
				</span>
				{pinned && (
					<Pin size={11} className="mr-1.5 shrink-0 text-[var(--omp-dim)]" aria-label={t("sidebar.pinned")} />
				)}
				{renameInput ?? <SidebarRowTitle className="text-left font-medium" title={name} />}
			</button>
			{!renameInput && (
				<span className="omp-sidebar-group-count ml-2 shrink-0 text-omp-xs tabular-nums text-[var(--omp-dim)]">
					{count}
				</span>
			)}
			{actions && (
				<span
					className="omp-sidebar-workspace-actions flex shrink-0 items-center justify-end gap-0.5"
					onClick={event => event.stopPropagation()}
				>
					{actions}
				</span>
			)}
		</div>
	);

	interface NavigationItem {
		id: string;
		icon: LucideIcon;
		label: string;
		title?: string;
		shortcut?: string;
		/** Count of things waiting for the person (e.g. learned skills to review). */
		badge?: number;
		/** Something finished that the user has not looked at yet: a red dot. */
		unread?: boolean;
		onClick: () => void;
	}
	// Session work stays one click away; app-wide tools live in the More menu
	// and remain reachable from the Command Center.
	const primaryNavigation: NavigationItem[] = [
		{
			id: "commands",
			icon: Command,
			label: t("titlebar.commands"),
			shortcut: actionChords.get("palette")?.[0],
			title: t("titlebar.commandsHint", { shortcut: paletteShortcut }),
			onClick: () => useUiStore.getState().openCommandPalette(),
		},
		{
			id: "search",
			icon: TextSearch,
			label: t("titlebar.search"),
			title: t("titlebar.searchHint"),
			shortcut: actionChords.get("search.conversations")?.[0],
			onClick: () => useUiStore.getState().openConversationSearch(),
		},
		{
			id: "agents",
			icon: Bot,
			label: t("titlebar.agentHub"),
			shortcut: actionChords.get("agents.hub")?.[0],
			onClick: () => useUiStore.getState().openAgentHub(),
		},
		{
			id: "memory",
			icon: Brain,
			label: t("titlebar.memory"),
			title:
				pendingSkillReviews > 0
					? t("titlebar.memoryReview", {
							count: pendingSkillReviews,
							plural: pendingSkillReviews === 1 ? "" : "s",
						})
					: undefined,
			shortcut: actionChords.get("memory.open")?.[0],
			badge: pendingSkillReviews,
			onClick: () => useUiStore.getState().openMemory(pendingSkillReviews > 0 ? "skills" : undefined),
		},
		{
			id: "pull-requests",
			icon: GitPullRequest,
			label: t("titlebar.prCenter"),
			shortcut: actionChords.get("pr.center")?.[0],
			onClick: () => useUiStore.getState().openPrCenter(),
		},
		{
			id: "scheduled-tasks",
			icon: CalendarClock,
			label: t("tasks.title"),
			title: pendingTaskReviews > 0 ? t("tasks.sidebar.review", { count: pendingTaskReviews }) : undefined,
			badge: pendingTaskReviews,
			unread: unreadNotices > 0,
			onClick: () => useSchedulerStore.getState().openTasks(pendingTaskReviews > 0 ? { view: "review" } : undefined),
		},
	];
	const secondaryNavigation: NavigationItem[] = [
		{
			id: "capabilities",
			icon: Sparkles,
			label: t("sidebar.navigation.capabilities"),
			title: t("settings.capabilities.description"),
			onClick: () => useUiStore.getState().openSettings("capabilities"),
		},
		{
			id: "providers",
			icon: Plug,
			label: t("titlebar.providers"),
			onClick: () => useUiStore.getState().openProviders(),
		},
		{ id: "usage", icon: Coins, label: t("titlebar.usage"), onClick: () => useUiStore.getState().openUsage() },
		{
			id: "stats",
			icon: BarChart3,
			label: t("titlebar.stats"),
			onClick: () => useUiStore.getState().openStatsDashboard(),
		},
		{
			id: "hotkeys",
			icon: Keyboard,
			label: t("titlebar.hotkeys"),
			shortcut: actionChords.get("hotkeys")?.[0],
			onClick: () => useUiStore.getState().openHotkeys(),
		},
		{
			id: "feedback",
			icon: MessageSquareWarning,
			label: t("titlebar.feedback"),
			title: t("titlebar.feedbackHint"),
			onClick: () => useUiStore.getState().openFeedback(),
		},
	];
	const navigationRow =
		"omp-pressable group/nav flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-omp-md text-[var(--omp-text-secondary)] hover:bg-[var(--omp-sidebar-item-hover)] hover:text-[var(--omp-text)]";
	const renderNavigationItem = (item: NavigationItem) => {
		const Icon = item.icon;
		return (
			<button
				key={item.id}
				type="button"
				onClick={item.onClick}
				data-command-center-entry={item.id === "commands" ? true : undefined}
				title={item.title}
				className={navigationRow}
			>
				<Icon aria-hidden="true" className="shrink-0 text-[var(--omp-muted)]" size={16} strokeWidth={1.75} />
				<span className="min-w-0 flex-1 truncate">{item.label}</span>
				{item.unread && (
					<span
						role="img"
						aria-label={t("notices.unread", { count: unreadNotices })}
						data-nav-unread=""
						className="size-2 shrink-0 rounded-full bg-(--omp-error)"
					/>
				)}
				{item.badge ? (
					<span className="shrink-0 rounded-full bg-(--omp-accent-dim) px-1.5 text-omp-xxs font-medium tabular-nums text-(--omp-accent)">
						{item.badge}
					</span>
				) : null}
				{!item.badge && item.shortcut && (
					<span className="shrink-0 text-omp-xs tracking-wide text-[var(--omp-dim)] opacity-0 transition-opacity group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100">
						{item.shortcut}
					</span>
				)}
			</button>
		);
	};

	const utilityButton =
		"omp-pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]";
	const newShortcut = actionChords.get("tab.new")?.[0];

	return (
		<>
			<aside
				className="omp-session-sidebar relative flex h-full shrink-0 flex-col border-r border-[var(--omp-border-muted)] bg-[var(--omp-sidebar-bg)]"
				style={{ width: sidebarWidth }}
			>
				{/* Header: the lane switch and session search. */}
				<div className="drag-region flex h-12 shrink-0 items-center gap-1 px-2.5">
					<div role="group" aria-label={t("sidebar.mode.aria")} className="omp-segmented no-drag">
						{(["code", "work"] as const).map(value => {
							const Icon = value === "code" ? Code2 : BriefcaseBusiness;
							return (
								<button
									key={value}
									type="button"
									aria-pressed={mode === value}
									title={t(value === "code" ? "sidebar.mode.codeDescription" : "sidebar.mode.workDescription")}
									onClick={() => {
										setMode(value);
										endSelection();
									}}
									className="flex h-6 items-center gap-1.5 px-2.5 text-omp-sm font-medium"
								>
									<Icon aria-hidden="true" size={13} />
									{t(`sidebar.mode.${value}`)}
								</button>
							);
						})}
					</div>
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

				{/* Primary action + navigation. */}
				<div className="shrink-0 px-2 pt-1 pb-3" data-sidebar-navigation>
					<div className="mb-1 flex items-center gap-1">
						<button
							type="button"
							data-sidebar-new-agent
							onClick={startNew}
							className="omp-pressable group/nav flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left text-omp-md font-medium text-[var(--omp-text)] hover:bg-[var(--omp-sidebar-item-hover)]"
						>
							<SquarePen aria-hidden="true" size={16} strokeWidth={1.75} className="shrink-0" />
							<span className="min-w-0 flex-1 truncate">
								{mode === "code" ? t("sidebar.newCode") : t("sidebar.newWork")}
							</span>
							{newShortcut && (
								<span className="shrink-0 text-omp-xs font-normal tracking-wide text-[var(--omp-dim)] opacity-0 transition-opacity group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100">
									{newShortcut}
								</span>
							)}
						</button>
						{mode === "code" && (
							<button
								type="button"
								data-sidebar-new-chat
								onClick={() => void openTab({ kind: "chat" })}
								title={t("sidebar.quickChat")}
								aria-label={t("sidebar.quickChat")}
								className="omp-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--omp-muted)] hover:bg-[var(--omp-sidebar-item-hover)] hover:text-[var(--omp-text)]"
							>
								<MessageSquarePlus size={16} strokeWidth={1.75} />
							</button>
						)}
					</div>
					<div className="space-y-px">{primaryNavigation.map(renderNavigationItem)}</div>
					<button
						type="button"
						aria-haspopup="menu"
						aria-expanded={moreMenu !== null}
						aria-label={t("sidebar.navigation.expand")}
						title={t("sidebar.navigation.expand")}
						onClick={event => {
							const rect = event.currentTarget.getBoundingClientRect();
							setMoreMenu({
								x: Number.isFinite(rect.left) ? rect.left : 8,
								y: (Number.isFinite(rect.bottom) ? rect.bottom : 200) + 4,
							});
						}}
						className={cx(
							navigationRow,
							"mt-px",
							moreMenu && "bg-[var(--omp-sidebar-item-hover)] text-[var(--omp-text)]",
						)}
					>
						<MoreHorizontal
							aria-hidden="true"
							className="shrink-0 text-[var(--omp-muted)]"
							size={16}
							strokeWidth={1.75}
						/>
						<span className="min-w-0 flex-1 truncate">{t("sidebar.navigation.more")}</span>
					</button>
				</div>

				<div className="flex h-7 shrink-0 items-center ps-4 pe-2.5">
					<span className="min-w-0 flex-1 truncate text-omp-xs font-medium text-[var(--omp-dim)]">
						{t("sidebar.recent")}
					</span>
					<button
						type="button"
						data-sidebar-select
						aria-pressed={selecting}
						onClick={() => (selecting ? endSelection() : startSelection([]))}
						title={t("sidebar.bulk.selectHint")}
						className={cx(
							"omp-pressable flex h-6 items-center gap-1 rounded-md px-1.5 text-omp-xs",
							selecting
								? "bg-[var(--omp-selected-bg)] text-[var(--omp-text)]"
								: "text-[var(--omp-dim)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]",
						)}
					>
						<ListChecks aria-hidden="true" size={13} />
						{t("sidebar.bulk.select")}
					</button>
				</div>

				<div className="omp-sidebar-list min-h-0 flex-1 overflow-y-auto px-2 pb-3 [overflow-anchor:none]">
					{listError && sessions.length > 0 && (
						<p role="alert" className="mx-2 mb-1 break-words text-omp-xs text-[var(--omp-error)]">
							{t("sidebar.stale")}: {listError}
						</p>
					)}
					{isLoading && sessions.length === 0 && (
						<div className="space-y-1 px-2 py-1" aria-label={t("sidebar.loading")}>
							{[72, 56, 64].map(width => (
								<div key={width} className="omp-skeleton h-[22px] rounded-md" style={{ width: `${width}%` }} />
							))}
						</div>
					)}
					{listError && sessions.length === 0 && (
						<div className="mx-1 mt-2 flex flex-col items-center gap-2 px-4 py-6 text-center">
							<div className="text-omp-md font-medium text-[var(--omp-error)]">{t("sidebar.loadFailed")}</div>
							<div className="break-words text-omp-xs text-[var(--omp-muted)]">{listError}</div>
							<Button icon={<RefreshCw size={12} />} onClick={() => refresh(true)} size="sm" variant="secondary">
								{t("common.retry")}
							</Button>
						</div>
					)}
					{!isLoading && !listError && totalCount === 0 && (
						<div className="omp-sidebar-empty px-2 py-2 text-omp-sm leading-relaxed text-[var(--omp-dim)]">
							{mode === "code" ? t("sidebar.emptyCode") : t("sidebar.emptyWork")}
						</div>
					)}
					{mode === "work" && workSessions.length > 0 && (
						<div className="space-y-px" data-work-section>
							{renderSessionRows(workSessions)}
						</div>
					)}
					{visibleGroups.map(group => {
						const groupCollapsed = isCollapsedGroup(group.cwd);
						const renaming = renamingGroupCwd === group.cwd;
						return (
							<div key={group.cwd} className="mb-1">
								{renderGroupHeader({
									id: group.cwd,
									name: group.name,
									count: listedCount(group.sessions),
									icon: Folder,
									collapsedState: groupCollapsed,
									onToggle: () => toggleGroup(group.cwd),
									pinned: pinnedGroups.includes(group.cwd),
									current: group.cwd === cwd,
									onContextMenu: event => setGroupMenu({ anchor: anchorFromEvent(event), group }),
									renameInput: renaming ? (
										<input
											ref={groupRenameRef}
											value={groupRenameDraft}
											onChange={event => setGroupRenameDraft(event.target.value)}
											onClick={event => event.stopPropagation()}
											onBlur={() => {
												useSidebarPrefs.getState().setGroupAlias(group.cwd, groupRenameDraft);
												setRenamingGroupCwd(null);
											}}
											onKeyDown={event => {
												if (isImeKeyEvent(event)) return;
												if (event.key === "Enter") {
													useSidebarPrefs.getState().setGroupAlias(group.cwd, groupRenameDraft);
													setRenamingGroupCwd(null);
												}
												onEscape(event, () => setRenamingGroupCwd(null));
											}}
											className="min-w-0 flex-1 rounded-md border border-[var(--omp-input-focus-border)] bg-[var(--omp-input-bg)] px-1.5 py-0.5 text-omp-md text-[var(--omp-text)] outline-none"
										/>
									) : undefined,
									actions: (
										<>
											<button
												type="button"
												title={t("sidebar.menu.newAgentHere")}
												aria-label={t("sidebar.menu.newAgentHere")}
												className={rowActionButton}
												onClick={event => {
													event.stopPropagation();
													void openTab({ cwd: group.cwd });
												}}
											>
												<SquarePen size={12} />
											</button>
											<button
												type="button"
												title={t("sidebar.groupMenu")}
												aria-label={t("sidebar.groupMenu")}
												className={rowActionButton}
												onClick={event => {
													event.stopPropagation();
													const rect = event.currentTarget.getBoundingClientRect();
													setGroupMenu({ anchor: { x: rect.left, y: rect.bottom + 4 }, group });
												}}
											>
												<MoreHorizontal size={13} />
											</button>
										</>
									),
								})}
								{/* Collapsed groups render nothing: a long-lived install with
								    hundreds of sessions must not build the full DOM per
								    debounced refresh just to hide it. */}
								{!groupCollapsed && (
									<div className="omp-sidebar-group" data-session-group={group.cwd} data-state="expanded">
										<div className="omp-sidebar-group-content space-y-px">
											{renderSessionRows(group.sessions)}
										</div>
									</div>
								)}
							</div>
						);
					})}
					{mode === "code" && chatSessions.length > 0 && (
						<div className="mb-1" data-chat-section>
							{renderGroupHeader({
								id: "__chats__",
								name: t("sidebar.chats"),
								count: chatSessions.length,
								icon: MessageCircle,
								collapsedState: chatsCollapsed,
								onToggle: () => setCollapsed(prev => ({ ...prev, __chats__: !chatsCollapsed })),
							})}
							{!chatsCollapsed && (
								<div className="omp-sidebar-group" data-session-group="__chats__" data-state="expanded">
									<div className="omp-sidebar-group-content space-y-px">{renderSessionRows(chatSessions)}</div>
								</div>
							)}
						</div>
					)}
					{archivedSessions.length > 0 && (
						<div className="mt-2 mb-1" data-archived-section>
							{renderGroupHeader({
								id: "__archived__",
								name: t("sidebar.archived"),
								count: listedCount(archivedSessions),
								icon: Archive,
								collapsedState: archivedCollapsed,
								onToggle: () => setCollapsed(prev => ({ ...prev, __archived__: !archivedCollapsed })),
							})}
							{!archivedCollapsed && (
								<div className="omp-sidebar-group" data-session-group="__archived__" data-state="expanded">
									<div className="omp-sidebar-group-content space-y-px">
										{renderSessionRows(archivedSessions)}
									</div>
								</div>
							)}
						</div>
					)}
				</div>

				{/* Bulk actions for the selected rows. */}
				{selecting && (
					<div
						role="toolbar"
						aria-label={t("sidebar.bulk.label")}
						data-sidebar-bulk
						className="flex h-10 shrink-0 items-center gap-0.5 border-t border-[var(--omp-border-muted)] px-2"
					>
						{/* A narrow rail keeps the number and leaves the words to the tooltip. */}
						{sidebarWidth < 220 ? (
							<span aria-live="polite" aria-label={bulkLabel} title={bulkLabel} className="min-w-0 flex-1 px-1">
								<span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-(--omp-accent-dim) px-1.5 text-omp-xs font-medium tabular-nums text-(--omp-accent)">
									{selectedSessions.length}
								</span>
							</span>
						) : (
							<span
								aria-live="polite"
								className="min-w-0 flex-1 truncate px-1 text-omp-sm text-[var(--omp-text-secondary)]"
							>
								{bulkLabel}
							</span>
						)}
						<button
							type="button"
							onClick={() => startSelection(visibleSessions.map(session => session.path))}
							disabled={visibleSessions.length === 0}
							title={t("sidebar.bulk.selectAll")}
							aria-label={t("sidebar.bulk.selectAll")}
							className={cx(utilityButton, "disabled:pointer-events-none disabled:opacity-40")}
						>
							<CheckCheck size={15} strokeWidth={1.75} />
						</button>
						<button
							type="button"
							data-sidebar-bulk-archive
							onClick={() => archiveSelection(!allSelectedArchived)}
							disabled={selectedSessions.length === 0}
							title={allSelectedArchived ? t("sidebar.bulk.unarchive") : t("sidebar.bulk.archive")}
							aria-label={allSelectedArchived ? t("sidebar.bulk.unarchive") : t("sidebar.bulk.archive")}
							className={cx(utilityButton, "disabled:pointer-events-none disabled:opacity-40")}
						>
							{allSelectedArchived ? (
								<ArchiveRestore size={15} strokeWidth={1.75} />
							) : (
								<Archive size={15} strokeWidth={1.75} />
							)}
						</button>
						<button
							type="button"
							data-sidebar-bulk-delete
							onClick={() => setPendingDelete({ kind: "selection", sessions: selectedSessions })}
							disabled={selectedSessions.length === 0}
							title={t("sidebar.bulk.delete")}
							aria-label={t("sidebar.bulk.delete")}
							className={cx(
								utilityButton,
								"hover:!bg-[var(--omp-tool-error-bg)] hover:!text-[var(--omp-error)] disabled:pointer-events-none disabled:opacity-40",
							)}
						>
							<Trash2 size={15} strokeWidth={1.75} />
						</button>
						<button
							type="button"
							onClick={endSelection}
							title={t("sidebar.bulk.cancel")}
							aria-label={t("sidebar.bulk.cancel")}
							className={utilityButton}
						>
							<X size={15} strokeWidth={1.75} />
						</button>
					</div>
				)}

				<SidebarQuotas />

				{/* Footer: app-level controls that are not tied to a session. */}
				{/* A container so a narrow sidebar folds Settings to its icon instead of cutting the word. */}
				<div className="@container flex h-11 shrink-0 items-center gap-0.5 border-t border-[var(--omp-border-muted)] px-2 text-omp-md">
					<button
						type="button"
						data-sidebar-settings
						onClick={() => useUiStore.getState().openSettings()}
						title={t("titlebar.settings")}
						aria-label={t("titlebar.settings")}
						className="omp-pressable flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-omp-md text-[var(--omp-text-secondary)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
					>
						<Settings aria-hidden="true" size={15} strokeWidth={1.75} className="shrink-0" />
						<span className="truncate @max-[14em]:hidden">{t("titlebar.settings")}</span>
					</button>
					<div className="flex-1" />
					<button
						type="button"
						onClick={openThemePicker}
						title={t("themePicker.aria")}
						aria-label={t("themePicker.aria")}
						className={utilityButton}
					>
						<Palette size={15} strokeWidth={1.75} />
					</button>
					<LangSwitcher className="h-7 max-h-7 rounded-md px-1.5 text-omp-sm [&_svg]:size-[14px]" />
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

			{/* App-wide tools: one menu instead of a second list competing with tasks. */}
			{moreMenu && (
				<ContextMenu
					x={moreMenu.x}
					y={moreMenu.y}
					onClose={() => setMoreMenu(null)}
					items={secondaryNavigation.map(item => ({
						id: `nav-${item.id}`,
						label: item.label,
						icon: item.icon,
						hint: item.shortcut,
						onSelect: () => {
							setMoreMenu(null);
							item.onClick();
						},
					}))}
				/>
			)}

			{/* Workspace group menu: new sessions, rename (alias), pin, delete. */}
			{groupMenu &&
				(() => {
					const groupHasBusySession = groupMenu.group.sessions.some(isSessionBusy);
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
									id: "group-select",
									label: t("sidebar.menu.selectSessions"),
									icon: ListChecks,
									onSelect: () => {
										setGroupMenu(null);
										setCollapsed(prev => ({ ...prev, [groupMenu.group.cwd]: false }));
										startSelection(groupMenu.group.sessions.map(session => session.path));
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
									disabled: groupHasBusySession,
									disabledReason: t("sidebar.deleteGroupStreaming"),
									onSelect: () => {
										setPendingDelete({ kind: "group", group: groupMenu.group });
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
					const targetBusy = isSessionBusy(sessionMenu.session);
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
									disabled: targetBusy,
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
										void tabRpc.setSessionPinned(sessionMenu.session.id, pinned).then(response => {
											if (!response.success) {
												toast({ variant: "warning", message: t("sidebar.pinSyncFailed") });
											}
										});
									},
								},
								{
									id: "session-archive",
									label: isArchived(sessionMenu.session)
										? t("sidebar.menu.unarchive")
										: t("sidebar.menu.archive"),
									icon: isArchived(sessionMenu.session) ? ArchiveRestore : Archive,
									onSelect: () => {
										setSessionMenu(null);
										// Unarchiving a session in an archived family brings the family back.
										const line = archivedLine(sessionMenu.session);
										void useSidebarPrefs
											.getState()
											.setSessionsArchived(
												line.length > 0 ? line : [sessionMenu.session.path],
												line.length === 0,
											);
									},
								},
								{
									id: "session-select",
									label: t("sidebar.menu.select"),
									icon: ListChecks,
									onSelect: () => {
										setSessionMenu(null);
										startSelection([...(selection ?? []), sessionMenu.session.path]);
									},
								},
								{
									id: "session-delete",
									label: t("common.delete"),
									icon: Trash2,
									danger: true,
									disabled: targetBusy,
									disabledReason: t("sidebar.menu.taskRunning"),
									onSelect: () => {
										setPendingDelete({ kind: "session", session: sessionMenu.session });
										setSessionMenu(null);
									},
								},
							]}
						/>
					);
				})()}

			<ConfirmDialog
				open={pendingDelete !== null}
				title={
					pendingDelete?.kind === "group"
						? t("sidebar.deleteGroupConfirm")
						: pendingDelete?.kind === "selection"
							? t("sidebar.bulk.deleteConfirm", { count: pendingDelete.sessions.length })
							: t("sidebar.deleteConfirm")
				}
				message={
					deleteProgress ? (
						<span className="flex items-center gap-2">
							<LoaderCircle aria-hidden="true" size={14} className="shrink-0 animate-spin" />
							{t("sidebar.bulk.deleting", { done: deleteProgress.done, total: deleteProgress.total })}
						</span>
					) : pendingDelete?.kind === "group" ? (
						t("sidebar.deleteGroupMessage", {
							name: pendingDelete.group.name,
							count: listedCount(pendingDelete.group.sessions),
						})
					) : pendingDelete?.kind === "selection" ? (
						t("sidebar.bulk.deleteMessage", { count: pendingDelete.sessions.length })
					) : pendingDelete?.kind === "session" ? (
						t("sidebar.deleteMessage", {
							name: sessionDisplayTitle(pendingDelete.session, t("sidebar.untitled")),
						})
					) : (
						""
					)
				}
				warning={
					pendingDelete?.kind === "group" || pendingDelete?.kind === "selection"
						? t("sidebar.deleteGroupWarning")
						: undefined
				}
				busy={deleting}
				onConfirm={() => {
					if (pendingDelete?.kind === "group") void confirmDeleteGroup(pendingDelete.group);
					else if (pendingDelete?.kind === "selection") void confirmDeleteSelection(pendingDelete.sessions);
					else if (pendingDelete) void confirmDeleteSession(pendingDelete.session);
				}}
				onCancel={() => setPendingDelete(null)}
			/>
		</>
	);
}
