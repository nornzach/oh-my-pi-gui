import { createTabRpc } from "../lib/tab-rpc";
import type { SessionStore } from "../stores/session";
import {
	focusedSessionRuntime,
	sessionRuntime,
	sessionRuntimeStore,
	withSessionRuntime,
} from "../stores/session-runtime-context";
import { useSubagentGraphStore } from "../stores/subagent-graph";
/**
 * Shared session-switch entry. One window owns one sidecar, and the server
 * aborts the in-flight turn on `switch_session` (TUI parity) — so while the
 * attached session is busy (streaming / compacting), callers route through
 * {@link requestSessionSwitch}, which opens the SessionSwitchDialog offering
 * "open in a new tab" (a pooled parallel sidecar in this window, the
 * recommended non-destructive path) or a new window instead of silently
 * killing the run. Sidebar, ⌘P picker, deep links, and
 * the dialog itself all funnel through here so the switch flow — RPC, hook
 * veto, hydrate, toasts — exists exactly once.
 */

import type { IpcSessionOwner, SessionInfo } from "../../shared/ipc-types";
import { parseModelRestoreFailure, type SessionModelOverride } from "../../shared/model-restore";
import type { RpcResponse } from "../../shared/rpc-types";
import { translate } from "../lib/i18n";
import { useComposerStore } from "../stores/composer";
import { useExtensionUiStore } from "../stores/extension-ui";
import { useForkHandoffStore } from "../stores/fork-handoff";
import { useMessagesStore } from "../stores/messages";
import { useModelStore } from "../stores/model";
import { usePlanApprovalStore } from "../stores/plan-approval";
import { useQueueStore } from "../stores/queue";
import { useSessionStore } from "../stores/session";
import { useSubagentsStore } from "../stores/subagents";
import { useTabsStore } from "../stores/tabs";
import { toast } from "../stores/toast";
import { useTodoStore } from "../stores/todo";
import { useToolsStore } from "../stores/tools";
import { useUiStore } from "../stores/ui";
import { hydrateSession, hydrateTabSession } from "./use-rpc-events";

/** Clear every renderer slice owned by one session before a replacement hydrates. */
export function resetSessionSurface(closeOverlays = true): void {
	useMessagesStore.getState().reset();
	useComposerStore.getState().reset();
	useToolsStore.getState().reset();
	useSubagentGraphStore.getState().reset();
	useSubagentsStore.getState().reset();
	useTodoStore.getState().reset();
	useModelStore.getState().reset();
	useQueueStore.getState().setFromFrame({ steering: [], followUp: [] });
	useExtensionUiStore.getState().clearAll();
	usePlanApprovalStore.getState().clearProposal();
	if (closeOverlays) {
		useForkHandoffStore.getState().closeHandoffDialog();
		useUiStore.getState().closeSessionOverlays();
	}
	useSessionStore.setState({
		sessionId: "",
		sessionName: null,
		sessionFile: null,
		isStreaming: false,
		isCompacting: false,
		awaitingModelSince: null,
		retryInfo: null,
		compactionInfo: null,
		contextUsage: null,
		messageCount: 0,
		queuedMessageCount: 0,
		planModeEnabled: false,
		prewalkArmed: false,
		agentsPaused: false,
		agentsPausedAt: null,
		goal: null,
		goalState: null,
		loopMode: null,
		vibeModeEnabled: false,
	});
}

/** Start a new in-place session and remove the previous surface at the commit boundary. */
export async function newSessionNow(): Promise<RpcResponse> {
	const runtime = focusedSessionRuntime();
	const response = await (runtime ? createTabRpc(runtime.command) : window.omp.rpc).newSession();
	if (!response.success) throw new Error(response.error);
	if ((response.data as { cancelled?: boolean } | undefined)?.cancelled) return response;
	if (runtime) {
		if (sessionRuntime(runtime.tabId) !== runtime) return response;
		withSessionRuntime(runtime.tabId, () =>
			resetSessionSurface(useTabsStore.getState().activeTabId === runtime.tabId),
		);
		await hydrateTabSession(runtime.tabId);
	} else {
		resetSessionSurface();
		await hydrateSession();
	}
	return response;
}

/** Delete the attached idle session, then project its fresh replacement. */
export async function dropSessionNow(): Promise<RpcResponse> {
	const runtime = focusedSessionRuntime();
	const response = await (runtime ? createTabRpc(runtime.command) : window.omp.rpc).dropSession();
	if (!response.success) throw new Error(response.error);
	if ((response.data as { cancelled?: boolean } | undefined)?.cancelled) return response;
	if (runtime) {
		if (sessionRuntime(runtime.tabId) !== runtime) return response;
		withSessionRuntime(runtime.tabId, () =>
			resetSessionSurface(useTabsStore.getState().activeTabId === runtime.tabId),
		);
		await hydrateTabSession(runtime.tabId);
	} else {
		resetSessionSurface();
		await hydrateSession();
	}
	return response;
}

/**
 * F-OWN: route the user to the tab/window already attached to a session file
 * instead of attaching a second sidecar to it. Owner lives in THIS window →
 * switchTab (which hydrates); a foreign window → openInNewWindow, which main
 * turns into a focus of the owner window for an owned path. Resolves with
 * openInNewWindow's result for the foreign case, true for the local switch.
 */
export async function routeToSessionOwner(owner: IpcSessionOwner, sessionPath: string): Promise<boolean> {
	const tabsStore = useTabsStore.getState();
	if (tabsStore.tabs.some(tab => tab.id === owner.tabId)) {
		await tabsStore.switchTab(owner.tabId);
		return true;
	}
	return window.omp.sessions.openInNewWindow({ sessionPath });
}

/**
 * Run the switch immediately. The server aborts any in-flight turn
 * (`switchSession` → `abort({goalReason:"internal"})`) — this is NOT a
 * parallel session, it replaces the current one. Returns true when the
 * switch went through (false on RPC failure or extension-hook veto).
 *
 * `model` binds the session to that model instead of its saved one. Without
 * it, a session whose saved model is unavailable fails closed upstream; that
 * failure opens the ModelRestoreDialog instead of a dead-end error toast.
 *
 * F-OWN belt guard: when the file is already attached to a tab, route to the
 * owner instead of double-attaching. Main independently refuses raced
 * attaches with `session_owned_elsewhere` (handled below), so a failed
 * pre-check is safe to ignore.
 */
export async function switchSessionNow(session: SessionInfo, model?: SessionModelOverride): Promise<boolean> {
	const runtime = focusedSessionRuntime();
	const originStore = runtime ? sessionRuntimeStore<SessionStore>(runtime.tabId, "session")! : useSessionStore;
	const originSessionId = originStore.getState().sessionId;
	const originTabId = runtime?.tabId ?? useTabsStore.getState().activeTabId;
	const stillCurrent = () =>
		!runtime || (sessionRuntime(runtime.tabId) === runtime && originStore.getState().sessionId === originSessionId);
	try {
		const owner = await window.omp.tabs.getSessionOwner(session.path);
		if (owner) return await routeToSessionOwner(owner, session.path);
	} catch {
		// Pre-check best-effort — the main-process refusal is the backstop.
	}
	if (!stillCurrent()) return false;
	// Cross-kind pre-check: agent and chat sessions never convert (I2). A
	// mismatch opens the file in a NEW tab of its own kind instead of
	// switching the current tab onto it — more intuitive than an error, and
	// main's spawn-tab guard is the backstop.
	const fileKind = session.kind === "chat" ? "chat" : "agent";
	const tabsState = useTabsStore.getState();
	const activeTab = tabsState.tabs.find(tab => tab.id === originTabId);
	if (activeTab && activeTab.kind !== fileKind) {
		const tabId = await tabsState.openTab({ sessionPath: session.path, kind: fileKind });
		if (tabId !== null) {
			// Explain the surprise: the user clicked expecting an in-place switch,
			// but kinds never convert — the file opened in its own tab instead.
			toast({ variant: "info", message: translate("sidebar.openedInNewTab") });
		}
		return tabId !== null;
	}
	const fromId = originSessionId;
	const pending = { fromId, toId: session.id };
	originStore.getState().setSwitchPending(pending);
	const clearPending = () => {
		if (originStore.getState().switchPending === pending) originStore.getState().setSwitchPending(null);
	};
	try {
		const rpc = runtime ? createTabRpc(runtime.command) : window.omp.rpc;
		const response = await (model ? rpc.switchSession(session.path, model) : rpc.switchSession(session.path));
		if (!response.success) {
			clearPending();
			const missingModel = model ? null : parseModelRestoreFailure(response.error);
			if (missingModel) {
				useUiStore.getState().requestModelRestore({ session, missingModel });
				return false;
			}
			// Cross-kind switch guard: refuse agent ↔ chat switches.
			if (response.code === "session_kind_mismatch") {
				toast({
					variant: "error",
					title: translate("sidebar.openFailed"),
					message: translate("sidebar.kindMismatch"),
				});
				return false;
			}
			// Raced attach refused by main: route via the owner in the payload.
			if (response.code === "session_owned_elsewhere") {
				const data = response.data as { ownerTabId?: unknown; ownerWinId?: unknown } | undefined;
				if (typeof data?.ownerTabId === "string" && typeof data.ownerWinId === "number") {
					return await routeToSessionOwner({ tabId: data.ownerTabId, winId: data.ownerWinId }, session.path);
				}
			}
			toast({ variant: "error", title: translate("sidebar.openFailed"), message: response.error });
			return false;
		}
		// Hook veto: success:true with cancelled:true — stay on the current session.
		const data = response.data as { cancelled?: boolean } | undefined;
		if (data?.cancelled) {
			clearPending();
			toast({ variant: "info", message: translate("sidebar.openCancelled") });
			return false;
		}
		// Main may already have committed and hydrated the replacement runtime.
		// A later switch also owns its own pending marker and fallback title.
		if (runtime && (sessionRuntime(runtime.tabId) !== runtime || originStore.getState().switchPending !== pending)) {
			clearPending();
			return true;
		}
		// Keep the outgoing transcript painted until hydrate commits the next
		// session. Events for the target sidecar are dropped while pending.
		if (runtime) await hydrateTabSession(runtime.tabId, session.title || session.firstMessage);
		else await hydrateSession(session.title || session.firstMessage);
		clearPending();
		return true;
	} catch (error) {
		clearPending();
		toast({ variant: "error", title: translate("sidebar.openFailed"), message: String(error) });
		return false;
	}
}

/**
 * Switch to `session` unless the attached session is busy. Streaming /
 * compacting means the switch would abort the run server-side, so ask first
 * via the SessionSwitchDialog (new tab / new window vs abort-and-switch).
 * Idle sessions switch straight through.
 */
export function requestSessionSwitch(session: SessionInfo): void {
	const { isStreaming, isCompacting, sessionId } = useSessionStore.getState();
	if (session.id === sessionId) return;
	if (isStreaming || isCompacting) {
		useUiStore.getState().requestSessionSwitch(session);
		return;
	}
	void switchSessionNow(session);
}
