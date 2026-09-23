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
import type { ExtensionUIRequest, RpcSessionState } from "../../shared/rpc-types";
import { hydrateTabSession } from "../hooks/use-rpc-events";
import { basename } from "../lib/format";
import { translate } from "../lib/i18n";
import { sessionDisplayTitle } from "../lib/session-title";
import { beginTabRoute, reconcileTabRoute, resetTabRoute, settleTabRoute } from "../lib/tab-routing";
import { type ComposerImage, type ComposerStore, useComposerStore } from "./composer";
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
import { ensureTabRuntime, replaceTabRuntime } from "./tab-runtime";
import { toast } from "./toast";
import { useUiStore } from "./ui";

export interface SessionTab {
	id: string;
	cwd: string;
	status: TabStatus;
	/** Automatic transcript compaction is in flight in this tab's sidecar. */
	compacting?: boolean;
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
	/** Session to open once this tab's sidecar first reports ready (the
	 * open-session-in-new-tab flow — the sidecar starts on a fresh session and
	 * must be switched over before its transcript hydrates). */
	pendingSessionPath?: string;
}

export type SplitAxis = "columns" | "rows";
export type SplitPlacement = "left" | "right" | "top" | "bottom";

export interface SplitLayout {
	axis: SplitAxis;
	firstTabId: string;
	secondTabId: string;
	ratio: number;
}

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

function routeTabView(focusedTabId: string, visibleTabIds: string[], split?: SplitLayout | null): Promise<boolean> {
	const request = routingChain.then(() =>
		visibleTabIds.length === 1 && !split
			? window.omp.tabs.setActive(focusedTabId)
			: window.omp.tabs.setView(focusedTabId, visibleTabIds, split ?? undefined),
	);
	routingChain = request.then(
		() => undefined,
		() => undefined,
	);
	return request;
}

function clampRatio(ratio: number): number {
	return Math.min(0.8, Math.max(0.2, ratio));
}

export function visibleTabIds(state: Pick<TabsStore, "activeTabId" | "split">): string[] {
	if (state.split) return [state.split.firstTabId, state.split.secondTabId];
	return state.activeTabId ? [state.activeTabId] : [];
}

function replaceFocusedSplitTab(split: SplitLayout | null, focusedTabId: string | null, nextTabId: string) {
	if (!split || !focusedTabId) return null;
	if (split.firstTabId === nextTabId || split.secondTabId === nextTabId) return split;
	return split.firstTabId === focusedTabId
		? { ...split, firstTabId: nextTabId }
		: { ...split, secondTabId: nextTabId };
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
	}) => Promise<string | null>;
	/** Focus this tab. In split mode, a non-visible tab replaces the focused pane. */
	switchTab: (id: string) => Promise<void>;
	splitTab: (id: string, placement: SplitPlacement) => Promise<void>;
	unsplit: (keepTabId?: string) => Promise<void>;
	setSplitRatio: (ratio: number) => void;
	/** Close a tab (keeps ≥1). Closing the active tab activates its neighbor first. */
	closeTab: (id: string) => Promise<void>;
	/** Merge a TAB_STATUS push: upsert the entry, stamp unreadDone when a
	 * background run settles (running → ready while not active). */
	applyTabStatus: (payload: IpcTabStatusPayload) => void;
	reset: () => void;
}

export const useTabsStore = create<TabsStore>()((set, get) => ({
	tabs: [],
	activeTabId: null,
	bundles: new Map(),
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
					kind: info.kind ?? existing?.kind ?? "agent",
					placeholder: info.placeholder ?? existing?.placeholder,
					worktree: info.worktree ?? existing?.worktree,
					title:
						info.title === undefined ? (sessionChanged ? undefined : existing?.title) : (info.title ?? undefined),
					sessionPath: info.sessionPath === undefined ? existing?.sessionPath : (info.sessionPath ?? undefined),
					sessionId: info.sessionId ?? existing?.sessionId,
					unreadDone: sessionChanged ? false : (existing?.unreadDone ?? false),
					pendingSessionPath: existing?.pendingSessionPath,
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
			const mainVisible = list.filter(info => info.visible).map(info => info.tabId);
			const mainSplitFirst = list.find(info => info.split?.index === 0);
			const mainSplitSecond = list.find(info => info.split?.index === 1);
			const restoredSplit =
				mainSplitFirst?.split && mainSplitSecond?.split && mainSplitFirst.split.axis === mainSplitSecond.split.axis
					? {
							axis: mainSplitFirst.split.axis,
							firstTabId: mainSplitFirst.tabId,
							secondTabId: mainSplitSecond.tabId,
							ratio: clampRatio(mainSplitFirst.split.ratio),
						}
					: null;
			const split =
				restoredSplit ??
				(state.split &&
				mainVisible.length === 2 &&
				mainVisible.includes(state.split.firstTabId) &&
				mainVisible.includes(state.split.secondTabId)
					? state.split
					: null);
			return { tabs, activeTabId, split };
		});
		const activeTabId = get().activeTabId;
		setFocusedSessionRuntime(activeTabId);
		if (activeTabId) {
			try {
				const routed = await routeTabView(activeTabId, visibleTabIds(get()), get().split);
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
			toast({ variant: "warning", message: translate("tabs.parallelCap") });
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
				if (!args?.sessionPath || existing.pendingSessionPath === args.sessionPath) return state;
				return {
					tabs: state.tabs.map(tab =>
						tab.id === tabId
							? { ...tab, sessionPath: args.sessionPath, pendingSessionPath: args.sessionPath }
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
			};
			return { tabs: [...state.tabs, tab] };
		});
		await get().switchTab(tabId);
		return tabId;
	},

	switchTab: async id => {
		const state = get();
		if (id === state.activeTabId) return;
		const target = state.tabs.find(tab => tab.id === id);
		if (!target) return;
		const version = ++switchVersion;
		ensureTabRuntime(id);
		beginTabRoute(state.activeTabId, id);
		const ui = useUiStore.getState();
		const stopLive = ui.liveOpen ? window.omp.rpc.liveStop() : null;
		ui.closeSessionOverlays();
		useForkHandoffStore.getState().closeHandoffDialog();
		const split = replaceFocusedSplitTab(state.split, state.activeTabId, id);
		const outgoingStreaming = useSessionStore.getState().isStreaming;
		set({
			activeTabId: id,
			split,
			tabs: state.tabs.map(tab => {
				if (tab.id === id) return { ...tab, unreadDone: false };
				return tab.id === state.activeTabId && outgoingStreaming ? { ...tab, status: "running" } : tab;
			}),
		});
		setFocusedSessionRuntime(id);
		try {
			if (stopLive) {
				const stopped = await stopLive;
				if (!stopped.success) {
					toast({ variant: "error", title: translate("tabs.switchFailed"), message: stopped.error });
				}
			}
			const routed = await routeTabView(id, split ? [split.firstTabId, split.secondTabId] : [id], split);
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
		settleTabRoute(id);
		// A freshly spawned sidecar can become ready on the light TAB_STATUS
		// channel before SET_ACTIVE_TAB wires its full status channel. In that
		// case no ready event will replay after routing, so hydrate from the
		// tab's latest status here. A still-starting sidecar will deliver its
		// normal full ready event after the route is attached.
		const routedTab = get().tabs.find(tab => tab.id === id);
		if (routedTab?.status === "ready" || routedTab?.status === "running") {
			sessionRuntimeStore<SessionStore>(id, "session")?.getState().setStatus("ready", routedTab.cwd);
			await hydrateTabSession(id);
		}
	},

	splitTab: async (id, placement) => {
		const state = get();
		const activeTabId = state.activeTabId;
		if (!activeTabId || id === activeTabId || !state.tabs.some(tab => tab.id === id)) return;
		// Already occupying a pane: re-dropping would silently reset the ratio
		// to 0.5 and, for top/bottom placements, flip the axis. Treat as a no-op.
		if (state.split && (state.split.firstTabId === id || state.split.secondTabId === id)) return;
		ensureTabRuntime(id);
		const split = splitForPlacement(activeTabId, id, placement);
		const version = ++switchVersion;
		beginTabRoute(activeTabId, id);
		// Same surface handoff as switchTab: the previously focused pane leaves
		// the foreground role, so its overlays and live voice must not linger
		// (voice control RPCs route to the newly focused pane's sidecar).
		const ui = useUiStore.getState();
		const stopLive = ui.liveOpen ? window.omp.rpc.liveStop() : null;
		ui.closeSessionOverlays();
		useForkHandoffStore.getState().closeHandoffDialog();
		set({
			activeTabId: id,
			split,
			tabs: state.tabs.map(tab => (tab.id === id ? { ...tab, unreadDone: false } : tab)),
		});
		setFocusedSessionRuntime(id);
		try {
			if (stopLive) {
				const stopped = await stopLive;
				if (!stopped.success) {
					toast({ variant: "error", title: translate("tabs.switchFailed"), message: stopped.error });
				}
			}
			const routed = await routeTabView(id, [split.firstTabId, split.secondTabId], split);
			if (!routed) throw new Error(`Tab ${id} is no longer available`);
		} catch (error) {
			if (version !== switchVersion) return;
			toast({ variant: "error", title: translate("tabs.switchFailed"), message: String(error) });
			await get().reconcileTabs();
			return;
		}
		if (version !== switchVersion) return;
		settleTabRoute(id);
		const tab = get().tabs.find(entry => entry.id === id);
		if (tab?.status === "ready" || tab?.status === "running") await hydrateTabSession(id);
	},

	unsplit: async keepTabId => {
		const state = get();
		const tabId = keepTabId && state.tabs.some(tab => tab.id === keepTabId) ? keepTabId : state.activeTabId;
		if (!tabId) return;
		const version = ++switchVersion;
		if (state.activeTabId !== tabId) beginTabRoute(state.activeTabId, tabId);
		set({ split: null, activeTabId: tabId });
		setFocusedSessionRuntime(tabId);
		try {
			const routed = await routeTabView(tabId, [tabId]);
			if (!routed) throw new Error(`Tab ${tabId} is no longer available`);
			if (version !== switchVersion) return;
			if (state.activeTabId !== tabId) settleTabRoute(tabId);
		} catch (error) {
			if (version !== switchVersion) return;
			toast({ variant: "error", title: translate("tabs.switchFailed"), message: String(error) });
			await get().reconcileTabs();
		}
	},

	setSplitRatio: ratio => {
		const state = get();
		if (!state.split || !state.activeTabId) return;
		const split = { ...state.split, ratio: clampRatio(ratio) };
		set({ split });
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
				current.split,
			).catch(() => {
				// Stale ratio flush (window closing, tab gone) — the next
				// reconcile re-converges the real view state.
			});
		}, 250);
	},

	closeTab: async id => {
		const state = get();
		if (state.tabs.length <= 1) return;
		const index = state.tabs.findIndex(tab => tab.id === id);
		if (index === -1) return;
		const splitSurvivor = state.split
			? state.split.firstTabId === id
				? state.split.secondTabId
				: state.split.secondTabId === id
					? state.split.firstTabId
					: null
			: null;
		if (splitSurvivor) {
			await get().unsplit(splitSurvivor);
		} else if (id === state.activeTabId) {
			// Activate a neighbor BEFORE releasing — main's routing needs a live
			// target and the window keeps painting a real session. Prefer the
			// right neighbor (it shifts into the closed slot), else the left.
			const neighbor = state.tabs[index + 1] ?? state.tabs[index - 1];
			if (neighbor) await get().switchTab(neighbor.id);
		}
		set(current => ({ tabs: current.tabs.filter(tab => tab.id !== id) }));
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
		set(current => {
			const index = current.tabs.findIndex(tab => tab.id === payload.tabId);
			// A background tab's run settled → done badge until the user visits.
			const completedInBackground =
				!visibleTabIds(current).includes(payload.tabId) &&
				previous?.status === "running" &&
				payload.status === "ready";
			const next: SessionTab = {
				id: payload.tabId,
				cwd: payload.cwd || previous?.cwd || "",
				status: payload.status,
				compacting: payload.compacting ?? previous?.compacting ?? false,
				kind: payload.kind ?? previous?.kind ?? "agent",
				placeholder: payload.placeholder ?? previous?.placeholder,
				worktree: payload.worktree ?? previous?.worktree,
				title:
					payload.title === undefined
						? sessionChanged
							? undefined
							: previous?.title
						: (payload.title ?? undefined),
				sessionPath: payload.sessionPath === undefined ? previous?.sessionPath : (payload.sessionPath ?? undefined),
				sessionId: payload.sessionId ?? previous?.sessionId,
				unreadDone: sessionChanged ? false : completedInBackground ? true : (previous?.unreadDone ?? false),
				pendingSessionPath: previous?.pendingSessionPath,
			};
			if (index === -1) return { tabs: [...current.tabs, next] };
			const tabs = [...current.tabs];
			tabs[index] = next;
			return { tabs };
		});
		const session = sessionRuntimeStore<SessionStore>(payload.tabId, "session");
		if (sessionChanged && (payload.status === "ready" || payload.status === "running")) {
			void hydrateTabSession(payload.tabId);
		}
		if (session) {
			session.getState().setStatus(payload.status === "running" ? "ready" : payload.status, payload.cwd);
			session.setState({
				isStreaming: payload.status === "running",
				isCompacting: payload.compacting ?? session.getState().isCompacting,
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
		setFocusedSessionRuntime(null);
		resetTabRoute();
		set({ tabs: [], activeTabId: null, bundles: new Map(), split: null });
	},
}));

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
): void {
	if (!tabId) return;
	const prependDraft = (current: string): string => (current ? `${draft}\n${current}` : draft);
	const session = sessionRuntimeStore<SessionStore>(tabId, "session");
	const composer = sessionRuntimeStore<ComposerStore>(tabId, "composer");
	if (!session || !composer) {
		if (useTabsStore.getState().activeTabId !== tabId || useSessionStore.getState().sessionId !== sessionId) return;
		useComposerStore.setState(current => ({
			draft: prependDraft(current.draft),
			images: [...images, ...current.images],
		}));
		return;
	}
	if (originComposer ? composer !== originComposer : session.getState().sessionId !== sessionId) return;
	composer.setState(current => ({
		draft: prependDraft(current.draft),
		images: [...images, ...current.images],
	}));
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
			if (visibleTabIds(state).includes(payload.tabId)) {
				const runtime = ensureTabRuntime(payload.tabId);
				void runtime.command({ type: "set_subagent_subscription", level: "events" });
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
