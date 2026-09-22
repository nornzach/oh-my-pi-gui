import { createContext, type ReactNode, useContext } from "react";
import { type UseBoundStore, useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { RpcCommand, RpcResponse } from "../../shared/rpc-types";

export type RuntimeStoreKey =
	| "composer"
	| "extensionUi"
	| "messages"
	| "model"
	| "planApproval"
	| "queue"
	| "session"
	| "settings"
	| "subagentGraph"
	| "subagents"
	| "todo"
	| "tools";

export type TabCommand = (command: RpcCommand, timeoutMs?: number) => Promise<RpcResponse>;

/** Active-tab fallback for tests, startup races, and an older preload bridge. */
export function activeTabCommand(command: RpcCommand, timeoutMs?: number): Promise<RpcResponse> {
	const rpc = window.omp.rpc;
	if (typeof rpc.command === "function") return rpc.command(command, timeoutMs);
	switch (command.type) {
		case "get_state":
			return rpc.getState();
		case "get_transcript":
			return rpc.getTranscript();
		case "get_subagents":
			return rpc.getSubagents();
		case "get_queue":
			return rpc.getQueue();
		case "get_goal":
			return rpc.getGoal();
		case "get_loop_mode":
			return rpc.getLoopMode();
		case "get_vibe_mode":
			return rpc.getVibeMode();
		case "get_settings":
			return rpc.getSettings(command.paths);
		case "set_setting":
			return rpc.setSetting(command.path, command.value);
		case "get_available_models":
			return rpc.getAvailableModels(command.forceRefresh);
		case "get_providers":
			return rpc.getProviders(command.forceRefresh);
		case "set_fast_mode":
			return rpc.setFastMode(command.enabled);
		case "set_subagent_subscription":
			return rpc.setSubagentSubscription(command.level);
		case "switch_session":
			return rpc.switchSession(command.sessionPath);
		default:
			return Promise.resolve({
				type: "response",
				command: command.type,
				success: false,
				error: `Unsupported active-tab command: ${command.type}`,
			});
	}
}

export interface SessionRuntime {
	tabId: string;
	command: TabCommand;
	stores: Map<RuntimeStoreKey, StoreApi<unknown>>;
	/** A process restart may allocate a new ID for an unpersisted session. */
	recovering?: boolean;
}

const SessionRuntimeContext = createContext<SessionRuntime | null>(null);
const runtimes = new Map<string, SessionRuntime>();
const focusedListeners = new Set<() => void>();
let focusedTabId: string | null = null;
let executionTabId: string | null = null;

export function registerSessionRuntime(runtime: SessionRuntime): SessionRuntime {
	runtimes.set(runtime.tabId, runtime);
	return runtime;
}

export function sessionRuntime(tabId: string | null): SessionRuntime | null {
	return tabId ? (runtimes.get(tabId) ?? null) : null;
}

export function sessionRuntimeStore<T>(tabId: string | null, key: RuntimeStoreKey): StoreApi<T> | null {
	return (sessionRuntime(tabId)?.stores.get(key) as StoreApi<T> | undefined) ?? null;
}

export function deleteSessionRuntime(tabId: string): void {
	runtimes.delete(tabId);
	if (focusedTabId === tabId) setFocusedSessionRuntime(null);
}

export function setFocusedSessionRuntime(tabId: string | null): void {
	if (focusedTabId === tabId) return;
	focusedTabId = tabId;
	for (const listener of focusedListeners) listener();
}

export function focusedSessionRuntime(): SessionRuntime | null {
	return sessionRuntime(executionTabId) ?? sessionRuntime(focusedTabId);
}

/** Scope synchronous event reduction to its originating tab without changing UI focus. */
export function withSessionRuntime<T>(tabId: string, run: () => T): T {
	const previous = executionTabId;
	executionTabId = tabId;
	try {
		return run();
	} finally {
		executionTabId = previous;
	}
}

export function onFocusedSessionRuntimeChange(listener: () => void): () => void {
	focusedListeners.add(listener);
	return () => focusedListeners.delete(listener);
}

export function SessionRuntimeProvider({ runtime, children }: { runtime: SessionRuntime; children: ReactNode }) {
	return <SessionRuntimeContext.Provider value={runtime}>{children}</SessionRuntimeContext.Provider>;
}

export function useSessionRuntime(): SessionRuntime | null {
	return useContext(SessionRuntimeContext);
}

export function useRuntimeTabId(): string | null {
	return useSessionRuntime()?.tabId ?? focusedTabId;
}

export function useTabCommand(): TabCommand {
	const runtime = useSessionRuntime();
	return runtime?.command ?? activeTabCommand;
}

function runtimeStore<T>(runtime: SessionRuntime | null, key: RuntimeStoreKey, fallback: StoreApi<T>): StoreApi<T> {
	return (runtime?.stores.get(key) as StoreApi<T> | undefined) ?? fallback;
}

/**
 * Bind an existing zustand store API to the nearest session runtime. Static
 * `getState`/`setState`/`subscribe` calls follow the focused runtime so legacy
 * window-level actions keep targeting the pane the user most recently focused.
 */
export function createScopedStoreHook<T>(key: RuntimeStoreKey, fallback: StoreApi<T>): UseBoundStore<StoreApi<T>> {
	const useScopedStore = (<U,>(selector?: (state: T) => U): T | U => {
		const store = runtimeStore(useContext(SessionRuntimeContext), key, fallback);
		const select = selector ?? ((state: T) => state as unknown as U);
		return useStore(store, select);
	}) as UseBoundStore<StoreApi<T>>;

	useScopedStore.getState = () => runtimeStore(focusedSessionRuntime(), key, fallback).getState();
	useScopedStore.getInitialState = () => runtimeStore(focusedSessionRuntime(), key, fallback).getInitialState();
	useScopedStore.setState = (partial, replace) => {
		const store = runtimeStore(focusedSessionRuntime(), key, fallback);
		if (replace === true) store.setState(partial as T, true);
		else store.setState(partial);
	};
	useScopedStore.subscribe = listener => {
		let store = runtimeStore(focusedSessionRuntime(), key, fallback);
		let unsubscribe = store.subscribe(listener);
		const stopFollowingFocus = onFocusedSessionRuntimeChange(() => {
			unsubscribe();
			store = runtimeStore(focusedSessionRuntime(), key, fallback);
			// Follow the newly focused store SILENTLY: synthesizing a cross-store
			// (state, previous) pair here would look like a real transition to
			// diffing subscribers (voice auto-speak would re-read the newly focused
			// tab's last message as "new"), and a throwing listener would leave the
			// resubscribe below permanently unexecuted.
			unsubscribe = store.subscribe(listener);
		});
		return () => {
			stopFollowingFocus();
			unsubscribe();
		};
	};
	return useScopedStore;
}

export function addRuntimeStore<T>(runtime: SessionRuntime, key: RuntimeStoreKey, store: StoreApi<T>): void {
	runtime.stores.set(key, store as StoreApi<unknown>);
}
