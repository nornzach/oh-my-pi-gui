/**
 * Session tabs: in-window multi-session parallelism. Each tab owns a sidecar
 * in the main-process pool; every tab keeps running in the background while
 * exactly one is attached to this window's stores.
 *
 * Renderer-side pieces:
 * - The tab list (title/cwd/status/unreadDone) fed by GET_TABS boot
 *   reconciliation plus the light TAB_STATUS channel (fires for EVERY tab,
 *   unlike the full event channels which only forward the active tab's).
 * - Each tab owns a persistent renderer runtime. One or two visible panes read
 *   those runtimes directly; focus only chooses the target for window-global
 *   actions and never moves session state between tabs.
 *
 * Wire shapes (IpcTabInfo / IpcTabStatusPayload / IpcSpawnTabPayload) and the
 * main-process pool live in the main slice — this store only consumes
 * window.omp.tabs.* and window.omp.events.onTabStatus.
 */
import { useEffect } from "react";
import { create, type StoreApi } from "zustand";
import type {
	IpcSpawnTabResult,
	IpcTabStatusPayload,
	IpcTabWorktree,
	SessionInfo,
	SessionKind,
	TabStatus,
} from "../../shared/ipc-types";
import type { ExtensionUIRequest, RpcResponse, RpcSessionState } from "../../shared/rpc-types";
import { hydrateTabSession, notifyBackgroundSettle } from "../hooks/use-rpc-events";
import { basename } from "../lib/format";
import { translate } from "../lib/i18n";
import { sessionDisplayTitle } from "../lib/session-title";
import { beginTabRoute, reconcileTabRoute, resetTabRoute, settleTabRoute } from "../lib/tab-routing";
import {
	type ComposerFile,
	type ComposerImage,
	type ComposerStore,
	mergeComposerFiles,
	useComposerStore,
} from "./composer";
import type { ExtensionUiStore } from "./extension-ui";
import { useForkHandoffStore } from "./fork-handoff";
import {
	type PendingPlanProposal,
	type PlanApprovalStore,
	type PlanApprovalSubmitState,
	usePlanApprovalStore,
} from "./plan-approval";
import { type SessionStore, useSessionStore } from "./session";
import {
	deleteSessionRuntime,
	focusedRuntimeTabId,
	sessionRuntimeStore,
	setFocusedSessionRuntime,
	useRuntimeTabId,
} from "./session-runtime-context";
import { SUBAGENT_SUBSCRIPTION_LEVEL } from "./subagents";
import { ensureTabRuntime, replaceTabRuntime } from "./tab-runtime";
import { toast } from "./toast";
import { useUiStore } from "./ui";

export interface SessionTab {
	id: string;
	cwd: string;
	status: TabStatus;
	/** Automatic transcript compaction is in flight in this tab's sidecar. */
	compacting?: boolean;
	backgroundCompacting?: boolean;
	/** Immutable session kind, fixed when this tab's sidecar was spawned. */
	kind: SessionKind;
	/** Untargeted startup tab that may be replaced while still truly empty. */
	placeholder?: boolean;
	/**
	 * Git-worktree binding (plan/20), immutable from spawn. Drives the chip's
	 * GitBranch marker, the untitled label (worktree name over the hash-suffixed
	 * basename), and the close-time cleanup prompt.
	 */
	worktree?: IpcTabWorktree;
	/** Session title when known (session_info_update via TAB_STATUS). */
	title?: string;
	/** Main-owned transcript identity, available even before session_info_update. */
	sessionPath?: string;
	sessionId?: string;
	/** A run completed while this tab was in the background. */
	unreadDone: boolean;
	/** Auto-retry in flight, or the last run ended in an error (main-tracked). */
	attention?: "retrying" | "failed";
	/** Session to open once this tab's sidecar first reports ready (the
	 * open-session-in-new-tab flow — the sidecar starts on a fresh session and
	 * must be switched over before its transcript hydrates). */
	pendingSessionPath?: string;
	/**
	 * Opened from the sidebar, and no turn has run in it since: the next
	 * sidebar open switches this tab in place instead of starting another one
	 * (gui#29). Renderer-only.
	 */
	browsing?: boolean;
}

export type SplitAxis = "columns" | "rows";
export type SplitPlacement = "left" | "right" | "top" | "bottom";

/**
 * A split pair (gui#30): two tabs shown side by side whenever either one is
 * selected. A window may hold several; each tab is in one at most.
 */
export interface SplitLayout {
	axis: SplitAxis;
	/** The left (columns) or top (rows) pane. */
	firstTabId: string;
	secondTabId: string;
	ratio: number;
}

/** Where a dragged chip lands relative to the chip it is dropped on. */
export type TabDropSide = "before" | "after";

// Focus routing is window-global. Serialize changes so rapid tab clicks cannot
// resolve out of order and leave main targeting the wrong sidecar.
let switchVersion = 0;
let routingChain: Promise<void> = Promise.resolve();
let ratioFlushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Tabs the user closed in this window. Late IPC frames for these ids must be
 * dropped outright — withSessionRuntime would otherwise fall back to the
 * FOCUSED runtime and pollute a live session, and ensureTabRuntime would
 * resurrect a ghost runtime with no store cleanup path. Ids are never reused
 * (ULIDs), so tombstones live for the window's lifetime.
 */
const closedTabIds = new Set<string>();

export function isTabClosed(tabId: string): boolean {
	return closedTabIds.has(tabId);
}

/** Tabs whose full event stream main was last asked to forward. */
let routedVisibleTabIds: readonly string[] = [];

/** The split pairs main last accepted, keyed like groupsKey(). */
let routedGroupsKey = "[]";

function groupsKey(groups: readonly SplitLayout[]): string {
	return JSON.stringify(groups.map(group => [group.axis, group.firstTabId, group.secondTabId, group.ratio]));
}

function routeTabView(focusedTabId: string, visibleTabIds: string[], groups: readonly SplitLayout[]): Promise<boolean> {
	// A parked tab missed the message_end/turn_end that clear its
	// waiting-for-model marker, so a marker it comes back with counts from
	// before it was parked. Drop it as the tab is shown again; hydrate re-arms
	// it from a fresh get_state, or the next turn_start does.
	for (const tabId of visibleTabIds) {
		if (!routedVisibleTabIds.includes(tabId)) {
			sessionRuntimeStore<SessionStore>(tabId, "session")?.setState({ awaitingModelSince: null });
		}
	}
	routedVisibleTabIds = [...visibleTabIds];
	const key = groupsKey(groups);
	const request = routingChain.then(async () => {
		// Main keeps the pairs it already has, so a plain focus change names the tab alone.
		if (visibleTabIds.length === 1 && key === routedGroupsKey) return window.omp.tabs.setActive(focusedTabId);
		const routed = await window.omp.tabs.setView(focusedTabId, visibleTabIds, [...groups]);
		if (routed) routedGroupsKey = key;
		return routed;
	});
	routingChain = request.then(
		() => undefined,
		() => undefined,
	);
	return request;
}

/** Each pair's last focused tab, so coming back to a pair lands where the user left it. */
const pairFocus = new Map<string, string>();

function pairKey(group: SplitLayout): string {
	return `${group.firstTabId}|${group.secondTabId}`;
}

/** Tell main the strip order so its tab list and the saved layout follow. */
function syncTabOrder(tabs: readonly SessionTab[]): void {
	const tabIds = tabs.map(tab => tab.id);
	void Promise.resolve()
		.then(() => window.omp.tabs.setOrder(tabIds))
		.catch(() => {
			// Best effort: a stale order only affects the next launch's tab order.
		});
}

function clampRatio(ratio: number): number {
	return Math.min(0.8, Math.max(0.2, ratio));
}

export function visibleTabIds(state: Pick<TabsStore, "activeTabId" | "split">): string[] {
	if (state.split) return [state.split.firstTabId, state.split.secondTabId];
	return state.activeTabId ? [state.activeTabId] : [];
}

/** The split pair holding `tabId`, if any. */
export function groupOf(groups: readonly SplitLayout[], tabId: string | null | undefined): SplitLayout | null {
	if (!tabId) return null;
	return groups.find(group => groupHas(group, tabId)) ?? null;
}

function groupHas(group: SplitLayout, tabId: string): boolean {
	return group.firstTabId === tabId || group.secondTabId === tabId;
}

function partnerOf(group: SplitLayout, tabId: string): string {
	return group.firstTabId === tabId ? group.secondTabId : group.firstTabId;
}

/** `groups` without the pairs any of `tabIds` belongs to. */
function withoutPairsOf(groups: readonly SplitLayout[], tabIds: readonly string[]): SplitLayout[] {
	return groups.filter(group => !tabIds.some(tabId => groupHas(group, tabId)));
}

/** One chip of the strip: a single tab, or a split pair shown as one merged chip. */
export interface TabUnit {
	/** The pair's tabs in pane order, or the single tab. */
	tabs: SessionTab[];
	group: SplitLayout | null;
}

/** The strip's chips in order; a pair sits where its earlier tab is. */
export function tabUnits(tabs: readonly SessionTab[], groups: readonly SplitLayout[]): TabUnit[] {
	const byId = new Map(tabs.map(tab => [tab.id, tab]));
	const placed = new Set<string>();
	const units: TabUnit[] = [];
	for (const tab of tabs) {
		if (placed.has(tab.id)) continue;
		const group = groupOf(groups, tab.id);
		const members = group
			? [byId.get(group.firstTabId), byId.get(group.secondTabId)].filter(
					(member): member is SessionTab => member !== undefined,
				)
			: [tab];
		for (const member of members) placed.add(member.id);
		units.push({ tabs: members, group: members.length === 2 ? group : null });
	}
	return units;
}

/** The strip order with every pair adjacent, its first pane first. */
function orderedWithPairs(tabs: readonly SessionTab[], groups: readonly SplitLayout[]): SessionTab[] {
	return tabUnits(tabs, groups).flatMap(unit => unit.tabs);
}

function sameOrder(a: readonly SessionTab[], b: readonly SessionTab[]): boolean {
	return a.length === b.length && a.every((tab, index) => tab.id === b[index]?.id);
}

function splitForPlacement(activeTabId: string, targetTabId: string, placement: SplitPlacement): SplitLayout {
	const targetFirst = placement === "left" || placement === "top";
	return {
		axis: placement === "left" || placement === "right" ? "columns" : "rows",
		firstTabId: targetFirst ? targetTabId : activeTabId,
		secondTabId: targetFirst ? activeTabId : targetTabId,
		ratio: 0.5,
	};
}

/**
 * Chip label for the tab strip (F-HYDRATE): session title when known, else
 * the cwd basename (both empty → the localized "New session"). Identical
 * UNTITLED labels disambiguate with a short index suffix ("gui #2") — the
 * common same-cwd parallel-tabs case. Titled tabs are never suffixed: an
 * explicit title is itself the disambiguator, and the suffix disappears as
 * soon as a title arrives.
 */
export function tabChipLabel(tab: SessionTab, tabs: readonly SessionTab[]): string {
	// `||` everywhere: empty-string titles (never-generated auto-title slot)
	// fall through like null. Worktree tabs label by their worktree NAME — the
	// cwd basename is the hash-suffixed dir (gui-<name>-<hash7>), unreadable.
	// Untitled chats are global: their internal process cwd must never masquerade
	// as a selected workspace in the tab strip.
	const untitledBase = (entry: SessionTab) =>
		entry.kind === "chat"
			? translate("sidebar.newSession")
			: entry.worktree?.name || basename(entry.cwd) || translate("sidebar.newSession");
	const base = tab.title || untitledBase(tab);
	if (tab.title) return base;
	let occurrence = 0;
	for (const entry of tabs) {
		if (entry.title) continue;
		if (untitledBase(entry) !== base) continue;
		occurrence += 1;
		if (entry.id === tab.id) break;
	}
	return occurrence > 1 ? `${base} #${occurrence}` : base;
}

/** One title contract for every surface representing a session tab. */
export function tabDisplayTitle(
	tab: SessionTab,
	tabs: readonly SessionTab[],
	indexedSession: Pick<SessionInfo, "title" | "firstMessage"> | undefined,
	untitled: string,
): string {
	return indexedSession ? sessionDisplayTitle(indexedSession, untitled) : tabChipLabel(tab, tabs);
}

/**
 * Kind of the window's active tab ("agent" default). THE single read point
 * for every chat-mode UI gate — components must never re-derive kind from
 * session state, argv, or the session file.
 */
export function useActiveTabKind(): SessionKind {
	const tabId = useRuntimeTabId();
	return useTabsStore(state => tabKindOf(state, tabId));
}

/** Non-hook read for imperative callers (the command registry's window build). */
export function activeTabKind(): SessionKind {
	return tabKindOf(useTabsStore.getState(), focusedRuntimeTabId());
}

function tabKindOf(state: Pick<TabsStore, "tabs" | "activeTabId">, tabId: string | null): SessionKind {
	return state.tabs.find(tab => tab.id === (tabId ?? state.activeTabId))?.kind ?? "agent";
}

export interface TabsStore {
	tabs: SessionTab[];
	activeTabId: string | null;
	/** Deprecated compatibility field for older test/setup call sites. Runtime state is no longer bundled. */
	bundles: Map<unknown, unknown>;
	/** The window's split pairs. Selecting either tab of one shows both. */
	groups: SplitLayout[];
	/** The pair on screen: the one holding the active tab, else null. */
	split: SplitLayout | null;
	/** Boot reconciliation with the main-process pool: the window's initial
	 * sidecar arrives as tab 0 and must never be duplicated — entries merge by
	 * id, preserving local flags (unreadDone, pendingSessionPath). */
	reconcileTabs: () => Promise<boolean>;
	/** Spawn a new background tab (same cwd unless given) and switch to it.
	 * Returns the tabId, or null at the pool cap. `kind` is immutable once
	 * the tab's sidecar is spawned ("agent" default; "chat" = tool-free).
	 * `worktree` binds the tab to a git worktree created by a prior
	 * worktree_create RPC (cwd must be the worktree path). */
	openTab: (args?: {
		cwd?: string;
		sessionPath?: string;
		kind?: SessionKind;
		/** Full agent in the GUI-owned default Work workspace. */
		work?: boolean;
		worktree?: IpcTabWorktree;
		/** Opened from the sidebar: marks the tab `browsing`. */
		browsing?: boolean;
	}) => Promise<string | null>;
	/** Set a tab's `browsing` mark: the sidebar switched it in place, or a turn started in it. */
	setBrowsing: (id: string, browsing: boolean) => void;
	/** Focus this tab, with its partner beside it when it is one of a pair. */
	switchTab: (id: string) => Promise<void>;
	/** Pair `id` with `anchorTabId` (the active tab by default) and show the pair, focused on `id`.
	 * Either tab's previous pair comes apart. */
	splitTab: (id: string, placement: SplitPlacement, anchorTabId?: string) => Promise<void>;
	/** Put `id` in the on-screen pair in place of `paneTabId`, which becomes a single tab. */
	replacePane: (paneTabId: string, id: string) => Promise<void>;
	/** Separate the pair holding `keepTabId` (the active tab by default). A pair on
	 * screen leaves `keepTabId` there alone; one in the background just comes apart. */
	unsplit: (keepTabId?: string) => Promise<void>;
	setSplitRatio: (ratio: number) => void;
	/** Drag reorder: move `id` (with its partner) next to `targetId` (and its partner). */
	moveTab: (id: string, targetId: string, side: TabDropSide) => void;
	/** Close a tab (keeps ≥1). Closing the active tab activates its neighbor first. */
	closeTab: (id: string) => Promise<void>;
	/** Merge a TAB_STATUS push: upsert the entry, stamp unreadDone when a
	 * background run settles (running → ready while not active). */
	applyTabStatus: (payload: IpcTabStatusPayload) => void;
	reset: () => void;
}

export const useTabsStore = create<TabsStore>()((set, get) => {
	/**
	 * Show `id` — with its partner when `groups` pairs it — and make `groups`
	 * the window's pairs. Every focus and pairing change goes through here.
	 */
	const showView = async (id: string, groups: SplitLayout[]): Promise<void> => {
		const state = get();
		if (!state.tabs.some(tab => tab.id === id)) return;
		const split = groupOf(groups, id);
		const visible = split ? [split.firstTabId, split.secondTabId] : [id];
		const previouslyVisible = visibleTabIds(state);
		const focusChanged = id !== state.activeTabId;
		const version = ++switchVersion;
		for (const tabId of visible) ensureTabRuntime(tabId);
		let stopLive: Promise<RpcResponse> | null = null;
		if (focusChanged) {
			beginTabRoute(state.activeTabId, id);
			// The outgoing tab leaves the foreground role, so its overlays and live
			// voice must not linger (voice control RPCs route to the focused pane).
			const ui = useUiStore.getState();
			stopLive = ui.liveOpen ? window.omp.rpc.liveStop() : null;
			ui.closeSessionOverlays();
			useForkHandoffStore.getState().closeHandoffDialog();
		}
		const outgoingStreaming = focusChanged && useSessionStore.getState().isStreaming;
		const tabs = orderedWithPairs(
			state.tabs.map(tab => {
				if (visible.includes(tab.id)) return tab.unreadDone ? { ...tab, unreadDone: false } : tab;
				return tab.id === state.activeTabId && outgoingStreaming ? { ...tab, status: "running" } : tab;
			}),
			groups,
		);
		set({ activeTabId: id, groups, split, tabs });
		if (split) pairFocus.set(pairKey(split), id);
		if (!sameOrder(state.tabs, tabs)) syncTabOrder(tabs);
		setFocusedSessionRuntime(id);
		try {
			if (stopLive) {
				const stopped = await stopLive;
				if (!stopped.success) {
					toast({ variant: "error", title: translate("tabs.switchFailed"), message: stopped.error });
				}
			}
			const routed = await routeTabView(id, visible, groups);
			if (!routed) throw new Error(`Tab ${id} is no longer available`);
		} catch (error) {
			if (version !== switchVersion) return;
			// Routing never re-pointed: main still forwards the PREVIOUS tab's
			// events, so hydrating here would pull that sidecar's session into
			// this tab's restored stores. Surface the failure and re-converge
			// from GET_TABS — reconcile also retries SET_ACTIVE_TAB for the
			// renderer's pick, re-pointing routing when the failure was
			// transient — instead of silently diverging.
			toast({ variant: "error", title: translate("tabs.switchFailed"), message: String(error) });
			const converged = await get().reconcileTabs();
			if (version !== switchVersion) return;
			if (converged && get().activeTabId === id) await hydrateTabSession(id);
			return;
		}
		if (version !== switchVersion) return;
		if (focusChanged) settleTabRoute(id);
		// A freshly spawned sidecar can become ready on the light TAB_STATUS
		// channel before routing wires its full status channel. In that case no
		// ready event will replay after routing, so hydrate from the tab's latest
		// status here — the newly focused tab, and a partner that just came on
		// screen beside it. A still-starting sidecar will deliver its normal full
		// ready event after the route is attached.
		const hydrate = visible.filter(tabId => (focusChanged && tabId === id) || !previouslyVisible.includes(tabId));
		await Promise.all(
			hydrate.map(async tabId => {
				const routedTab = get().tabs.find(tab => tab.id === tabId);
				if (routedTab?.status !== "ready" && routedTab?.status !== "running") return;
				sessionRuntimeStore<SessionStore>(tabId, "session")?.getState().setStatus("ready", routedTab.cwd);
				await hydrateTabSession(tabId);
			}),
		);
	};

	return {
		tabs: [],
		activeTabId: null,
		bundles: new Map(),
		groups: [],
		split: null,

		reconcileTabs: async () => {
			const list = await window.omp.tabs.list().catch(() => null);
			if (!list) {
				// Pre-tabs main (dev mismatch) or bridge down — the tab strip simply
				// stays empty and TAB_STATUS pushes rebuild it.
				return false;
			}
			set(state => {
				const leftovers = new Map(state.tabs.map(tab => [tab.id, tab]));
				const merged: SessionTab[] = list.map(info => {
					const existing = leftovers.get(info.tabId);
					leftovers.delete(info.tabId);
					const sessionChanged =
						(existing?.sessionId !== undefined &&
							info.sessionId !== undefined &&
							existing.sessionId !== info.sessionId) ||
						(existing?.sessionPath !== undefined &&
							info.sessionPath !== undefined &&
							existing.sessionPath !== info.sessionPath);
					if (sessionChanged) {
						replaceTabRuntime(info.tabId);
					}
					ensureTabRuntime(info.tabId);
					return {
						id: info.tabId,
						cwd: info.cwd || existing?.cwd || "",
						status: info.status,
						compacting: info.compacting ?? existing?.compacting ?? false,
						backgroundCompacting: info.backgroundCompacting ?? existing?.backgroundCompacting ?? false,
						kind: info.kind ?? existing?.kind ?? "agent",
						placeholder: info.placeholder ?? existing?.placeholder,
						worktree: info.worktree ?? existing?.worktree,
						title:
							info.title === undefined
								? sessionChanged
									? undefined
									: existing?.title
								: (info.title ?? undefined),
						sessionPath: info.sessionPath === undefined ? existing?.sessionPath : (info.sessionPath ?? undefined),
						sessionId: info.sessionId ?? existing?.sessionId,
						unreadDone: sessionChanged ? false : (existing?.unreadDone ?? false),
						attention: sessionChanged
							? undefined
							: info.attention === undefined
								? existing?.attention
								: (info.attention ?? undefined),
						pendingSessionPath: existing?.pendingSessionPath,
						browsing: info.status === "running" ? undefined : existing?.browsing,
					};
				});
				// Entries the reply doesn't know (a spawn reply raced this reconcile)
				// survive appended at the end.
				const tabs = [...merged, ...leftovers.values()];
				const mainActiveTabId = list.find(info => info.active)?.tabId;
				const activeTabId =
					state.activeTabId && tabs.some(tab => tab.id === state.activeTabId)
						? state.activeTabId
						: mainActiveTabId && tabs.some(tab => tab.id === mainActiveTabId)
							? mainActiveTabId
							: (tabs[0]?.id ?? null);
				// Main holds the window's pairs; each pair is reported by both its tabs.
				const groups: SplitLayout[] = [];
				for (const info of list) {
					const group = info.group;
					if (group?.index !== 0) continue;
					const partner = list.find(other => other.tabId === group.partnerTabId)?.group;
					if (partner?.index !== 1 || partner.partnerTabId !== info.tabId || partner.axis !== group.axis) continue;
					groups.push({
						axis: group.axis,
						firstTabId: info.tabId,
						secondTabId: group.partnerTabId,
						ratio: clampRatio(group.ratio),
					});
				}
				routedGroupsKey = groupsKey(groups);
				return { tabs, activeTabId, groups, split: groupOf(groups, activeTabId) };
			});
			const activeTabId = get().activeTabId;
			setFocusedSessionRuntime(activeTabId);
			if (activeTabId) {
				try {
					const routed = await routeTabView(activeTabId, visibleTabIds(get()), get().groups);
					reconcileTabRoute(activeTabId, routed);
					return routed;
				} catch {
					reconcileTabRoute(activeTabId, false);
					return false;
				}
			}
			return true;
		},

		openTab: async args => {
			const runtimeCwd = sessionRuntimeStore<SessionStore>(get().activeTabId, "session")?.getState().cwd;
			const cwd =
				args?.cwd ??
				(runtimeCwd || get().tabs.find(tab => tab.id === get().activeTabId)?.cwd || useSessionStore.getState().cwd);
			const kind = args?.kind ?? "agent";
			let result: IpcSpawnTabResult | null;
			try {
				result = await window.omp.tabs.spawn({
					cwd: args?.work ? undefined : cwd || undefined,
					sessionPath: args?.sessionPath,
					kind,
					...(args?.work ? { defaultWorkspace: true } : {}),
					worktree: args?.worktree,
				});
			} catch (error) {
				toast({ variant: "error", title: translate("tabs.newFailed"), message: String(error) });
				return null;
			}
			if (!result) {
				toast({ variant: "error", message: translate("tabs.newFailed") });
				return null;
			}
			// Cross-kind refusal: the target session file carries a different kind —
			// no conversion path exists (I2), so surface it and stay put.
			if (result.tabId === null && result.refusal === "kind-mismatch") {
				toast({ variant: "error", title: translate("tabs.newFailed"), message: translate("tabs.kindMismatch") });
				return null;
			}
			// F-OWN belt guard: the session file is already attached to a tab, so
			// main refused the double-attach. Owner lives in THIS window → switch
			// to it; a foreign window's tab → focus that window (main focuses the
			// owner window for an owned sessionPath instead of spawning).
			if (result.tabId === null) {
				const ownerTabId = result.ownerTabId ?? null;
				if (ownerTabId && get().tabs.some(tab => tab.id === ownerTabId)) {
					await get().switchTab(ownerTabId);
					return ownerTabId;
				}
				if (args?.sessionPath) {
					try {
						await window.omp.sessions.openInNewWindow({ sessionPath: args.sessionPath });
					} catch {
						// Best-effort focus — the owner window may be mid-teardown.
					}
				}
				return ownerTabId;
			}
			const { tabId } = result;
			ensureTabRuntime(tabId);
			const resolvedCwd = result.cwd ?? cwd;
			// Upsert eagerly — the fresh sidecar's first TAB_STATUS can beat the reply.
			set(state => {
				const existing = state.tabs.find(tab => tab.id === tabId);
				if (existing) {
					const bind = Boolean(args?.sessionPath) && existing.pendingSessionPath !== args?.sessionPath;
					const browse = args?.browsing === true && !existing.browsing;
					if (!bind && !browse) return state;
					return {
						tabs: state.tabs.map(tab =>
							tab.id === tabId
								? {
										...tab,
										...(bind
											? { sessionPath: args?.sessionPath, pendingSessionPath: args?.sessionPath }
											: {}),
										...(browse ? { browsing: true } : {}),
									}
								: tab,
						),
					};
				}
				const tab: SessionTab = {
					id: tabId,
					cwd: resolvedCwd,
					status: "starting",
					kind,
					placeholder: false,
					worktree: args?.worktree,
					unreadDone: false,
					sessionPath: args?.sessionPath,
					pendingSessionPath: args?.sessionPath,
					...(args?.browsing ? { browsing: true } : {}),
				};
				return { tabs: [...state.tabs, tab] };
			});
			await get().switchTab(tabId);
			return tabId;
		},

		setBrowsing: (id, browsing) => {
			if (Boolean(get().tabs.find(tab => tab.id === id)?.browsing) === browsing) return;
			set(state => ({
				tabs: state.tabs.map(tab => (tab.id === id ? { ...tab, browsing: browsing || undefined } : tab)),
			}));
		},

		switchTab: async id => {
			const state = get();
			if (id === state.activeTabId) return;
			await showView(id, state.groups);
		},

		splitTab: async (id, placement, anchorTabId) => {
			const state = get();
			const anchor = anchorTabId ?? state.activeTabId;
			if (!anchor || id === anchor) return;
			if (!state.tabs.some(tab => tab.id === id) || !state.tabs.some(tab => tab.id === anchor)) return;
			// Already the anchor's partner: re-pairing would silently reset the ratio
			// to 0.5 and, for top/bottom placements, flip the axis. Treat as a no-op.
			const current = groupOf(state.groups, id);
			if (current && groupHas(current, anchor)) return;
			await showView(id, [...withoutPairsOf(state.groups, [id, anchor]), splitForPlacement(anchor, id, placement)]);
		},

		replacePane: async (paneTabId, id) => {
			const state = get();
			const group = groupOf(state.groups, paneTabId);
			if (!group || groupHas(group, id) || !state.tabs.some(tab => tab.id === id)) return;
			const replaced = group.firstTabId === paneTabId ? { ...group, firstTabId: id } : { ...group, secondTabId: id };
			await showView(id, [...withoutPairsOf(state.groups, [paneTabId, id]), replaced]);
		},

		unsplit: async keepTabId => {
			const state = get();
			const tabId = keepTabId && state.tabs.some(tab => tab.id === keepTabId) ? keepTabId : state.activeTabId;
			if (!tabId) return;
			const onScreen = state.split !== null && groupHas(state.split, tabId);
			await showView(onScreen ? tabId : (state.activeTabId ?? tabId), withoutPairsOf(state.groups, [tabId]));
		},

		setSplitRatio: ratio => {
			const state = get();
			if (!state.split || !state.activeTabId) return;
			const split = { ...state.split, ratio: clampRatio(ratio) };
			set({ split, groups: state.groups.map(group => (group === state.split ? split : group)) });
			// Debounce: keyboard stepping fires per keystroke and each routed view
			// change lands in main's layout persistence. Main only needs the settled
			// geometry, so flush the latest ratio after a short quiet window.
			if (ratioFlushTimer) clearTimeout(ratioFlushTimer);
			ratioFlushTimer = setTimeout(() => {
				ratioFlushTimer = null;
				const current = get();
				if (!current.split || !current.activeTabId) return;
				void routeTabView(
					current.activeTabId,
					[current.split.firstTabId, current.split.secondTabId],
					current.groups,
				).catch(() => {
					// Stale ratio flush (window closing, tab gone) — the next
					// reconcile re-converges the real view state.
				});
			}, 250);
		},

		moveTab: (id, targetId, side) => {
			const state = get();
			const unitOf = (tabId: string) => {
				const group = groupOf(state.groups, tabId);
				return group ? [group.firstTabId, group.secondTabId] : [tabId];
			};
			const moving = unitOf(id);
			if (moving.includes(targetId)) return;
			const movingTabs = state.tabs.filter(tab => moving.includes(tab.id));
			const rest = state.tabs.filter(tab => !moving.includes(tab.id));
			const targetIndexes = unitOf(targetId)
				.map(tabId => rest.findIndex(tab => tab.id === tabId))
				.filter(index => index >= 0);
			if (movingTabs.length === 0 || targetIndexes.length === 0) return;
			const at = side === "before" ? Math.min(...targetIndexes) : Math.max(...targetIndexes) + 1;
			const tabs = orderedWithPairs([...rest.slice(0, at), ...movingTabs, ...rest.slice(at)], state.groups);
			if (sameOrder(state.tabs, tabs)) return;
			set({ tabs });
			syncTabOrder(tabs);
		},

		closeTab: async id => {
			const state = get();
			if (state.tabs.length <= 1) return;
			const index = state.tabs.findIndex(tab => tab.id === id);
			if (index === -1) return;
			if (state.split && groupHas(state.split, id)) {
				// The pair on screen comes apart and the partner keeps the screen.
				await get().unsplit(partnerOf(state.split, id));
			} else if (id === state.activeTabId) {
				// Activate a neighbor BEFORE releasing — main's routing needs a live
				// target and the window keeps painting a real session. Prefer the
				// right neighbor (it shifts into the closed slot), else the left.
				const neighbor = state.tabs[index + 1] ?? state.tabs[index - 1];
				if (neighbor) await get().switchTab(neighbor.id);
			}
			// A pair in the background loses this tab too; main drops it on release.
			set(current => {
				const groups = withoutPairsOf(current.groups, [id]);
				return {
					tabs: current.tabs.filter(tab => tab.id !== id),
					groups,
					split: groupOf(groups, current.activeTabId),
				};
			});
			closedTabIds.add(id);
			deleteSessionRuntime(id);
			try {
				await window.omp.tabs.close(id);
			} catch {
				// Pre-tabs main (dev mismatch) tolerance; the entry is already gone.
			}
		},

		applyTabStatus: payload => {
			if (isTabClosed(payload.tabId)) return;
			const state = get();
			const active = state.activeTabId === payload.tabId;
			const previous = state.tabs.find(tab => tab.id === payload.tabId);
			if (payload.status === "starting" || payload.status === "restarting") {
				ensureTabRuntime(payload.tabId).recovering = true;
			}
			const sessionChanged =
				(previous?.sessionId !== undefined &&
					payload.sessionId !== undefined &&
					previous.sessionId !== payload.sessionId) ||
				(previous?.sessionPath !== undefined &&
					payload.sessionPath !== undefined &&
					previous.sessionPath !== payload.sessionPath);
			// Rebuild the runtime OUTSIDE the set() updater (deleteSessionRuntime
			// synchronously fires focus listeners), and immediately re-point focus at
			// the fresh runtime — otherwise static store access falls through to the
			// module-level default stores until the next switch/reconcile.
			if (sessionChanged) {
				replaceTabRuntime(payload.tabId);
				if (active) setFocusedSessionRuntime(payload.tabId);
			}
			// A background tab's run settled → done badge until the user visits, and
			// a notice: its full event stream (and so the usual end-of-run toast and
			// desktop notification) only reaches the renderer while it is on screen.
			const completedInBackground =
				!visibleTabIds(state).includes(payload.tabId) &&
				previous?.status === "running" &&
				payload.status === "ready" &&
				!sessionChanged;
			set(current => {
				const index = current.tabs.findIndex(tab => tab.id === payload.tabId);
				const next: SessionTab = {
					id: payload.tabId,
					cwd: payload.cwd || previous?.cwd || "",
					status: payload.status,
					compacting: payload.compacting ?? previous?.compacting ?? false,
					backgroundCompacting: payload.backgroundCompacting ?? previous?.backgroundCompacting ?? false,
					kind: payload.kind ?? previous?.kind ?? "agent",
					placeholder: payload.placeholder ?? previous?.placeholder,
					worktree: payload.worktree ?? previous?.worktree,
					title:
						payload.title === undefined
							? sessionChanged
								? undefined
								: previous?.title
							: (payload.title ?? undefined),
					sessionPath:
						payload.sessionPath === undefined ? previous?.sessionPath : (payload.sessionPath ?? undefined),
					sessionId: payload.sessionId ?? previous?.sessionId,
					unreadDone: sessionChanged ? false : completedInBackground ? true : (previous?.unreadDone ?? false),
					attention: sessionChanged
						? undefined
						: payload.attention === undefined
							? previous?.attention
							: (payload.attention ?? undefined),
					pendingSessionPath: previous?.pendingSessionPath,
					// A turn makes it a tab the user is working in.
					browsing: payload.status === "running" ? undefined : previous?.browsing,
				};
				if (index === -1) return { tabs: [...current.tabs, next] };
				const tabs = [...current.tabs];
				tabs[index] = next;
				return { tabs };
			});
			if (completedInBackground) {
				const tabs = get().tabs;
				const settled = tabs.find(tab => tab.id === payload.tabId);
				if (settled) {
					notifyBackgroundSettle(
						settled.id,
						tabChipLabel(settled, tabs),
						settled.attention === "failed" ? "failed" : "complete",
						payload.attentionDetail,
					);
				}
			}
			const session = sessionRuntimeStore<SessionStore>(payload.tabId, "session");
			if (sessionChanged && (payload.status === "ready" || payload.status === "running")) {
				void hydrateTabSession(payload.tabId);
			}
			if (session) {
				session.getState().setStatus(payload.status === "running" ? "ready" : payload.status, payload.cwd);
				session.setState({
					isStreaming: payload.status === "running",
					isCompacting: payload.compacting ?? session.getState().isCompacting,
					// A retry that began while this tab was parked never reached its
					// event stream; main's snapshot lets the tab show it when visited.
					...(payload.retry !== undefined ? { retryInfo: payload.retry } : {}),
				});
			} else if (active) {
				useSessionStore.getState().setStatus(payload.status === "running" ? "ready" : payload.status, payload.cwd);
				useSessionStore.setState({ isStreaming: payload.status === "running" });
			}
		},

		reset: () => {
			switchVersion += 1;
			if (ratioFlushTimer) {
				clearTimeout(ratioFlushTimer);
				ratioFlushTimer = null;
			}
			for (const tab of get().tabs) deleteSessionRuntime(tab.id);
			closedTabIds.clear();
			routedGroupsKey = "[]";
			setFocusedSessionRuntime(null);
			resetTabRoute();
			set({ tabs: [], activeTabId: null, bundles: new Map(), groups: [], split: null });
		},
	};
});

/** The tab to focus when a chip is chosen: a pair's last focused tab, else its first. */
export function unitFocusTabId(unit: TabUnit): string | undefined {
	if (!unit.group) return unit.tabs[0]?.id;
	const last = pairFocus.get(pairKey(unit.group));
	return unit.tabs.some(tab => tab.id === last) ? last : unit.tabs[0]?.id;
}

function activeUnitIndex(units: readonly TabUnit[], activeTabId: string | null): number {
	return units.findIndex(unit => unit.tabs.some(tab => tab.id === activeTabId));
}

/** ⌃⇥ / ⇧⌃⇥: the next or previous chip of the strip, wrapping around. */
export function cycleTab(delta: 1 | -1): void {
	const { tabs, groups, activeTabId, switchTab } = useTabsStore.getState();
	const units = tabUnits(tabs, groups);
	if (units.length < 2) return;
	const index = Math.max(0, activeUnitIndex(units, activeTabId));
	const target = units[(index + delta + units.length) % units.length];
	const tabId = target && unitFocusTabId(target);
	if (tabId) void switchTab(tabId);
}

/** ⌘1…⌘8 pick that chip of the strip; ⌘9 the last one. */
export function selectTabAt(position: number): void {
	const { tabs, groups, activeTabId, switchTab } = useTabsStore.getState();
	const units = tabUnits(tabs, groups);
	const unit = position >= 9 ? units.at(-1) : units[position - 1];
	if (!unit || unit.tabs.some(tab => tab.id === activeTabId)) return;
	const tabId = unitFocusTabId(unit);
	if (tabId) void switchTab(tabId);
}

/** ⌥⇧⌘← / →: move the active chip (a pair moves whole) one place along the strip. */
export function moveActiveTab(delta: 1 | -1): void {
	const { tabs, groups, activeTabId, moveTab } = useTabsStore.getState();
	if (!activeTabId) return;
	const units = tabUnits(tabs, groups);
	const index = activeUnitIndex(units, activeTabId);
	const neighbor = index < 0 ? undefined : units[index + delta]?.tabs[0];
	if (neighbor) moveTab(activeTabId, neighbor.id, delta < 0 ? "before" : "after");
}

/** Route an extension UI frame into the tab that raised it. Blocking dialogs,
 * status text, and widgets disappear while that tab is parked and return with
 * it; a late IPC delivery can never leak into the newly selected tab. */
export function pushTabExtensionUiRequest(tabId: string, request: ExtensionUIRequest): void {
	// A request arriving after the tab closed must not resurrect a ghost runtime.
	if (isTabClosed(tabId)) return;
	ensureTabRuntime(tabId);
	sessionRuntimeStore<ExtensionUiStore>(tabId, "extensionUi")?.getState().pushRequest(request);
}

/** Restore a failed submit to the tab that issued it, even when that tab is now
 * parked in the background. A response from one sidecar must never inject its
 * draft or attachments into whichever tab happens to be visible later. */
export function restoreTabComposer(
	tabId: string | null,
	sessionId: string,
	draft: string,
	images: ComposerImage[],
	originComposer?: StoreApi<ComposerStore>,
	files: ComposerFile[] = [],
): void {
	if (!tabId) return;
	const restore = (current: ComposerStore) => ({
		draft: draft && current.draft ? `${draft}\n${current.draft}` : draft || current.draft,
		images: [...images, ...current.images],
		files: mergeComposerFiles(files, current.files),
	});
	const session = sessionRuntimeStore<SessionStore>(tabId, "session");
	const composer = sessionRuntimeStore<ComposerStore>(tabId, "composer");
	if (!session || !composer) {
		if (useTabsStore.getState().activeTabId !== tabId || useSessionStore.getState().sessionId !== sessionId) return;
		useComposerStore.setState(restore);
		return;
	}
	if (originComposer ? composer !== originComposer : session.getState().sessionId !== sessionId) return;
	composer.setState(restore);
}

/** Finish a plan-approval request in the tab that issued it. The response may
 * arrive after the user switched elsewhere, so both the proposal UI and the
 * plan-mode flag are updated in that tab's parked bundle instead of whichever
 * session happens to be visible. */
export function settleTabPlanApproval(
	tabId: string | null,
	sessionId: string,
	target: PendingPlanProposal,
	result: {
		clear?: boolean;
		notice?: string | null;
		submitting?: PlanApprovalSubmitState | null;
		exitPlanMode?: boolean;
	},
): void {
	const resolvedTabId = tabId ?? useTabsStore.getState().activeTabId;
	const session = sessionRuntimeStore<SessionStore>(resolvedTabId, "session");
	const planStore = sessionRuntimeStore<PlanApprovalStore>(resolvedTabId, "planApproval");
	if (!session || !planStore) {
		if (
			useTabsStore.getState().activeTabId !== resolvedTabId ||
			useSessionStore.getState().sessionId !== sessionId ||
			usePlanApprovalStore.getState().pending !== target
		)
			return;
		usePlanApprovalStore.setState(state => ({
			pending: result.clear ? null : target,
			feedback: result.clear ? "" : state.feedback,
			notice: result.clear ? null : result.notice === undefined ? state.notice : result.notice,
			submitting: result.clear ? null : result.submitting === undefined ? state.submitting : result.submitting,
		}));
		if (result.exitPlanMode) useSessionStore.setState({ planModeEnabled: false });
		return;
	}
	if (session.getState().sessionId !== sessionId) return;
	const plan = planStore.getState();
	if (plan.pending !== target) return;
	planStore.setState({
		pending: result.clear ? null : target,
		feedback: result.clear ? "" : plan.feedback,
		notice: result.clear ? null : result.notice === undefined ? plan.notice : result.notice,
		submitting: result.clear ? null : result.submitting === undefined ? plan.submitting : result.submitting,
	});
	if (result.exitPlanMode) session.setState({ planModeEnabled: false });
}

/**
 * Boot wiring for session tabs: GET_TABS reconciliation (the window's initial
 * sidecar arrives as tab 0) plus the TAB_STATUS subscription. Also completes
 * the open-in-new-tab flow: when a tab spawned with a sessionPath first
 * reports ready while active, switch its sidecar to that session and hydrate.
 * Call once in App.tsx alongside useRpcEvents().
 */
export function useSessionTabs(): void {
	useEffect(() => {
		void useTabsStore
			.getState()
			.reconcileTabs()
			.then(converged => {
				if (!converged) return;
				// A restored sidecar can already be ready before either renderer
				// subscription attaches. GET_TABS is the durable boot snapshot, so
				// use it as the final hydration fallback after the active route has
				// converged. Session metadata can arrive before the transcript, so
				// an existing session id cannot prove that history was restored.
				setTimeout(() => {
					const state = useTabsStore.getState();
					for (const tabId of visibleTabIds(state)) {
						const tab = state.tabs.find(entry => entry.id === tabId);
						const session = sessionRuntimeStore<SessionStore>(tabId, "session");
						if (!tab || !session || (tab.status !== "ready" && tab.status !== "running")) continue;
						session.getState().setStatus("ready", tab.cwd);
						void hydrateTabSession(tabId);
					}
				}, 0);
			});
		const subscribe = window.omp.events.onTabStatus;
		if (typeof subscribe !== "function") return;
		return subscribe.call(window.omp.events, payload => {
			const previousStatus = useTabsStore.getState().tabs.find(entry => entry.id === payload.tabId)?.status;
			useTabsStore.getState().applyTabStatus(payload);
			if (payload.status !== "ready") return;
			const state = useTabsStore.getState();
			const tab = state.tabs.find(entry => entry.id === payload.tabId);
			const visible = visibleTabIds(state).includes(payload.tabId);
			// Every ready tab streams its subagent frames: the sidebar lists the
			// agents of background tabs too (plan/24 §7). Idempotent server-side.
			// A background tab needs a tab-addressed command; the active-tab
			// fallback would land on the wrong sidecar.
			if (visible || typeof window.omp.rpc.commandForTab === "function") {
				void ensureTabRuntime(payload.tabId).command({
					type: "set_subagent_subscription",
					level: SUBAGENT_SUBSCRIPTION_LEVEL,
				});
			}
			if (visible) {
				if (!tab?.pendingSessionPath && previousStatus !== "ready" && previousStatus !== "running") {
					// Light TAB_STATUS is registered before the full active-tab channel.
					// If ready raced SET_ACTIVE_TAB, the full ready event was already
					// missed. Restore history on the connection transition, including
					// when metadata arrived first; idle metadata and run-end updates
					// do not need another transcript fetch.
					setTimeout(() => {
						if (!visibleTabIds(useTabsStore.getState()).includes(payload.tabId)) return;
						void hydrateTabSession(payload.tabId);
					}, 0);
				}
			}
			if (!tab?.pendingSessionPath || !visibleTabIds(state).includes(tab.id)) return;
			// Clear before the RPC so a duplicate ready push can't re-enter.
			const sessionPath = tab.pendingSessionPath;
			useTabsStore.setState(current => ({
				tabs: current.tabs.map(entry =>
					entry.id === tab.id ? { ...entry, pendingSessionPath: undefined } : entry,
				),
			}));
			void (async () => {
				// A sidecar spawned WITH --session is already on the pending
				// session by the time it reports ready: switching again would
				// abort the in-flight resume. Gate on get_state and only switch
				// when the sidecar's sessionFile differs (a failed read keeps
				// the old behavior — switch unconditionally).
				const runtime = ensureTabRuntime(tab.id);
				const currentState = await runtime.command({ type: "get_state" });
				const currentFile =
					currentState.success && currentState.data != null
						? (currentState.data as RpcSessionState).sessionFile
						: undefined;
				if (currentFile !== sessionPath) {
					const response = await runtime.command({ type: "switch_session", sessionPath });
					if (!response.success) {
						toast({ variant: "error", title: translate("sidebar.openFailed"), message: response.error });
						return;
					}
				}
				await hydrateTabSession(tab.id);
			})();
		});
	}, []);
}
