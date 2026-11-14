import { createSessionRpcClient } from "../../shared/rpc-client";
import type {
	AgentMessage,
	ModelInfo,
	RpcAdvisorStatus,
	RpcGoalState,
	RpcLoopModeState,
	RpcResponse,
	RpcSessionState,
	RpcVibeModeState,
} from "../../shared/rpc-types";
import { type MessagesStore, mergeFetchedTranscript, useMessagesStore } from "../stores/messages";
import { useModelStore } from "../stores/model";
import { type QueueStore, useQueueStore } from "../stores/queue";
import { type SessionStore, useSessionStore } from "../stores/session";
import {
	activeTabCommand,
	focusedSessionRuntime,
	type SessionRuntime,
	sessionRuntime,
	sessionRuntimeStore,
	type TabCommand,
	withSessionRuntime,
} from "../stores/session-runtime-context";
import { type SettingsStore, useSettingsStore } from "../stores/settings";
import { useSubagentGraphStore } from "../stores/subagent-graph";
import { SUBAGENT_SUBSCRIPTION_LEVEL, type SubagentsStore, useSubagentsStore } from "../stores/subagents";
import { ensureTabRuntime } from "../stores/tab-runtime";
import { isTabClosed, useTabsStore } from "../stores/tabs";
import { type TodoStore, todoHistoryFromMessages, useTodoStore } from "../stores/todo";
import { type ToolsStore, useToolsStore } from "../stores/tools";

/** Apply the usage half of a snapshot; caller must already be runtime-scoped. */
function writeUsage(state: RpcSessionState): void {
	// A snapshot without usage proves nothing — the ring renders from this field,
	// so overwriting a good reading with null would make it vanish.
	if (!state.contextUsage) return;
	useSessionStore.setState(session => ({
		contextUsage: state.contextUsage ?? null,
		statsPulse: session.statsPulse + 1,
	}));
}

/**
 * Land the context-usage reading from a `get_state` snapshot.
 *
 * No session event carries usage, so unlike the rest of a snapshot it is not
 * invalidated by events that arrived while the round trip was in flight.
 */
export function applyUsageSnapshot(state: RpcSessionState, tabId: string): void {
	withSessionRuntime(tabId, () => writeUsage(state));
}

/** Apply a get_state snapshot to every state-derived store. */
export function applySessionState(state: RpcSessionState, fallbackName?: string): void {
	const runtime = focusedSessionRuntime();
	if (runtime) runtime.recovering = false;
	if (useSessionStore.getState().sessionId !== state.sessionId) useSubagentGraphStore.getState().reset();
	useModelStore.getState().setFromState(state);
	useSessionStore.getState().setFromState(state);
	writeUsage(state);
	if (!state.sessionName && fallbackName) {
		useSessionStore.setState({ sessionName: fallbackName });
	}
	useSettingsStore.getState().setFromState(state);
	useTodoStore.getState().setPhases(state.todoPhases);
}

/**
 * Light re-sync of session state (no transcript/subagent fetch). Used for
 * agent_start: server-side plan-mode exits (plan_approval accept) emit no
 * event, so turn start is the sync point that keeps planModeEnabled honest.
 * Model switches go through refreshModelState instead.
 */
export async function refreshSessionState(tabId = useTabsStore.getState().activeTabId): Promise<void> {
	if (!tabId) return;
	// Closed tabs keep their tombstone: never resurrect a runtime for them.
	// Live tabs may legitimately lack one yet (boot race) — create on demand.
	const runtime = isTabClosed(tabId) ? sessionRuntime(tabId) : ensureTabRuntime(tabId);
	if (!runtime) return;
	const sessionId = sessionRuntimeStore<SessionStore>(tabId, "session")?.getState().sessionId;
	const eventVersion = sessionRuntimeStore<SessionStore>(tabId, "session")?.getState().eventVersion;
	try {
		const res = await runtime.command({ type: "get_state" });
		if (
			sessionRuntime(tabId) !== runtime ||
			sessionRuntimeStore<SessionStore>(tabId, "session")?.getState().sessionId !== sessionId ||
			!res.success ||
			res.data == null
		)
			return;
		const state = res.data as RpcSessionState;
		// Events that landed during the round trip already updated the stores, so
		// this snapshot is behind on everything they carry. Usage has no event
		// carrier, so it stays the freshest reading we have either way.
		const churned = sessionRuntimeStore<SessionStore>(tabId, "session")?.getState().eventVersion !== eventVersion;
		withSessionRuntime(tabId, () => {
			if (churned) writeUsage(state);
			else applySessionState(state);
		});
	} catch {
		// Transient — the next heartbeat or hydration retries.
	}
}

/** Re-sync the model-derived stores after a model switch, ignoring event churn. */
export async function refreshModelState(tabId = useTabsStore.getState().activeTabId): Promise<void> {
	if (!tabId) return;
	const runtime = isTabClosed(tabId) ? sessionRuntime(tabId) : ensureTabRuntime(tabId);
	if (!runtime) return;
	const sessionId = sessionRuntimeStore<SessionStore>(tabId, "session")?.getState().sessionId;
	try {
		const res = await runtime.command({ type: "get_state" });
		if (
			sessionRuntime(tabId) !== runtime ||
			sessionRuntimeStore<SessionStore>(tabId, "session")?.getState().sessionId !== sessionId ||
			!res.success ||
			res.data == null
		)
			return;
		const state = res.data as RpcSessionState;
		withSessionRuntime(tabId, () => {
			useModelStore.getState().setFromState(state);
			// Another model means another context window, so the usage ring has to
			// follow the switch even though the token count did not change.
			writeUsage(state);
		});
	} catch {
		// Transient — the next hydration retries.
	}
}

/** Re-read a payload-free sidecar snapshot into one tab's session store, dropping replies for a replaced runtime. */
async function refreshSidecarSnapshot(
	tabId: string | null,
	command: "get_config_warnings" | "get_advisor_status",
	apply: (data: unknown) => Partial<SessionStore>,
): Promise<void> {
	if (!tabId) return;
	const runtime = isTabClosed(tabId) ? sessionRuntime(tabId) : ensureTabRuntime(tabId);
	if (!runtime) return;
	try {
		const res = await runtime.command({ type: command });
		if (sessionRuntime(tabId) !== runtime || !res.success) return;
		withSessionRuntime(tabId, () => useSessionStore.setState(apply(res.data)));
	} catch {
		// Transient — the next event or hydration retries.
	}
}

/** Re-read the sidecar's collected configuration warnings (config_warnings_changed carries none). */
export function refreshConfigWarnings(tabId = useTabsStore.getState().activeTabId): Promise<void> {
	return refreshSidecarSnapshot(tabId, "get_config_warnings", data => {
		const warnings = (data as { warnings?: unknown } | undefined)?.warnings;
		return { configWarnings: Array.isArray(warnings) ? warnings.filter(w => typeof w === "string") : [] };
	});
}

/** Ask Main which proxies it is keeping from the agent; a respawn is what changes the answer, and hydrate follows one. */
async function refreshProxyWarnings(tabId: string): Promise<void> {
	const runtime = sessionRuntime(tabId);
	try {
		const proxyWarnings = await window.omp.sidecar.getProxyWarnings();
		if (sessionRuntime(tabId) !== runtime) return;
		withSessionRuntime(tabId, () => useSessionStore.setState({ proxyWarnings }));
	} catch {
		// Transient — the next hydration retries.
	}
}

/** Re-read advisor roster status and spend (advisor_* events carry none). */
export function refreshAdvisorStatus(tabId = useTabsStore.getState().activeTabId): Promise<void> {
	return refreshSidecarSnapshot(tabId, "get_advisor_status", data => ({
		advisorStatus: (data as RpcAdvisorStatus | undefined) ?? null,
	}));
}

function asModelInfo(value: unknown): ModelInfo | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const candidate = value as ModelInfo;
	return typeof candidate.provider === "string" && typeof candidate.id === "string" ? candidate : undefined;
}

/**
 * Apply an out-of-band authoritative model: the `set_model` response and
 * `config_update` frames both carry the sidecar's live model. This is the only
 * channel for a switch that emits no `model_changed` at all — re-selecting the
 * current provider+id is a no-op server-side, so without it a stale label can
 * never be corrected.
 */
export function applyModelInfo(model: unknown, tabId: string | null): void {
	const info = asModelInfo(model);
	if (!info || !tabId) return;
	withSessionRuntime(tabId, () => useModelStore.setState({ model: info }));
}

type HydrationGuard = () => boolean;

/** Fetch the live goal state (get_goal) into the session store; clears when no goal is active. */
export async function syncGoal(tabId: string, command: TabCommand, isCurrent: HydrationGuard): Promise<void> {
	const before = withSessionRuntime(tabId, () => useSessionStore.getState());
	try {
		const res = await command({ type: "get_goal" });
		if (!isCurrent() || !res.success) return;
		const current = withSessionRuntime(tabId, () => useSessionStore.getState());
		if (
			current.eventVersion !== before.eventVersion ||
			current.goal !== before.goal ||
			current.goalState !== before.goalState
		)
			return;
		// get_goal wire payload is RpcGoalState; `data` crosses the bridge as unknown.
		const data = res.data as RpcGoalState | undefined;
		withSessionRuntime(tabId, () => {
			if (data?.enabled !== true) {
				useSessionStore.setState({ goal: null, goalState: null });
				return;
			}
			useSessionStore.setState({
				goal: typeof data.objective === "string" ? { objective: data.objective } : null,
				goalState: { status: data.status },
			});
		});
	} catch {
		// Transient — the next goal_updated event or hydration retries.
	}
}

/** Fetch the live loop-mode state (get_loop_mode) into the session store; null on failure. */
export async function syncLoopMode(tabId: string, command: TabCommand, isCurrent: HydrationGuard): Promise<void> {
	const before = withSessionRuntime(tabId, () => useSessionStore.getState().loopMode);
	try {
		const res = await command({ type: "get_loop_mode" });
		if (!isCurrent() || !res.success) return;
		if (withSessionRuntime(tabId, () => useSessionStore.getState().loopMode) !== before) return;
		// get_loop_mode wire payload is RpcLoopModeState; `data` crosses the bridge as unknown.
		withSessionRuntime(tabId, () => {
			useSessionStore.setState({ loopMode: (res.data as RpcLoopModeState | undefined) ?? null });
		});
	} catch {
		// Transient — the next loop_mode_update event or hydration retries.
	}
}

/** Fetch the live vibe-mode state (get_vibe_mode) into the session store; no event exists. */
export async function syncVibeMode(tabId: string, command: TabCommand, isCurrent: HydrationGuard): Promise<void> {
	try {
		const res = await command({ type: "get_vibe_mode" });
		if (!isCurrent() || !res.success) return;
		const data = res.data as RpcVibeModeState | undefined;
		withSessionRuntime(tabId, () => {
			useSessionStore.setState({ vibeModeEnabled: data?.enabled === true });
		});
	} catch {
		// Transient — the next hydration retries.
	}
}

const hydrationVersions = new WeakMap<SessionRuntime, number>();
let legacyHydrationVersion = 0;

export async function hydrateLegacySession(fallbackName?: string, initialState?: RpcResponse): Promise<void> {
	const version = ++legacyHydrationVersion;
	const isCurrent = () => version === legacyHydrationVersion;
	// This path has no tab runtime to scope to, so its stores are resolved by
	// focus at apply time. Remember who we fetched for and refuse to write that
	// snapshot into a pane the user switched to while the RPC was in flight.
	const originRuntime = focusedSessionRuntime();
	const beforeMessages = useMessagesStore.getState().messages;
	const beforeLiveMessages = useMessagesStore.getState().liveMessages;
	const beforeEventVersion = useSessionStore.getState().eventVersion;
	const core = Promise.allSettled([
		initialState ? Promise.resolve(initialState) : activeTabCommand({ type: "get_state" }),
		createSessionRpcClient(activeTabCommand).getTranscript(),
	]);
	const subagents = useSubagentsStore.getState().refresh({ expect: isCurrent });
	const secondary = Promise.allSettled([
		syncGoal("", activeTabCommand, isCurrent),
		syncLoopMode("", activeTabCommand, isCurrent),
		syncVibeMode("", activeTabCommand, isCurrent),
		useQueueStore.getState().refresh(),
		useSettingsStore.getState().syncDisplaySettings(),
		useSettingsStore.getState().syncApproval(),
	]);
	const [stateResult, messagesResult] = await core;
	if (!isCurrent()) return;
	const eventsUnchanged = useSessionStore.getState().eventVersion === beforeEventVersion;
	const focusUnchanged = !originRuntime || focusedSessionRuntime() === originRuntime;
	// `get_state` is the only witness to a live turn. A failed read counts as not
	// live: a card left spinning never resolves, while a wrongly aborted card is
	// repaired by the next execution event.
	const stateIsStreaming =
		stateResult.status === "fulfilled" &&
		stateResult.value.success &&
		(stateResult.value.data as RpcSessionState | null)?.isStreaming === true;
	const stateIsIdle =
		stateResult.status === "fulfilled" &&
		stateResult.value.success &&
		stateResult.value.data != null &&
		!stateIsStreaming;
	if (
		eventsUnchanged &&
		focusUnchanged &&
		stateResult.status === "fulfilled" &&
		stateResult.value.success &&
		stateResult.value.data != null
	) {
		const wire = stateResult.value.data as RpcSessionState;
		applySessionState(wire, fallbackName);
		if (wire.isStreaming && useSessionStore.getState().awaitingModelSince === null) {
			useSessionStore.setState({ awaitingModelSince: Date.now() });
		}
		if (!wire.isStreaming) useMessagesStore.getState().clearStreaming();
		void activeTabCommand({ type: "set_subagent_subscription", level: SUBAGENT_SUBSCRIPTION_LEVEL });
	}
	if (focusUnchanged && messagesResult.status === "fulfilled" && messagesResult.value.success) {
		const fetched = (messagesResult.value.data as { messages?: AgentMessage[] } | undefined)?.messages ?? [];
		const current = useMessagesStore.getState().messages;
		useMessagesStore.getState().reconcileFetched(mergeFetchedTranscript(fetched, beforeMessages, current));
		if (eventsUnchanged && stateIsIdle && useMessagesStore.getState().liveMessages === beforeLiveMessages) {
			useMessagesStore.getState().clearDeliveredLiveMessages();
		}
		if (eventsUnchanged)
			useToolsStore
				.getState()
				.hydrateMessages(useMessagesStore.getState().messages, { turnIsLive: stateIsStreaming });
		// Only a live tab archives plan changes: a reopened one replays them.
		useTodoStore.getState().seedHistory(todoHistoryFromMessages(useMessagesStore.getState().messages));
	}
	await subagents;
	await secondary;
}

/** Reload every renderer store that belongs to the active sidecar session. */
export async function hydrateSession(fallbackName?: string): Promise<void> {
	const tabId = useTabsStore.getState().activeTabId;
	if (!tabId || !sessionRuntime(tabId)) return hydrateLegacySession(fallbackName);
	return hydrateTabSession(tabId, fallbackName);
}

/**
 * Repair a tab whose run state disagrees with a fresh `get_state` read. A
 * parked tab misses its agent_start/agent_end, and its switch-back hydrate is
 * skipped when live events race it or fails when the sidecar is slow to
 * answer; without a later event (never, for a session that went idle) the tab
 * keeps showing a finished run as live, or a live one as idle. Re-hydrates
 * only when no event reached the tab since `eventVersionAtProbe`, the guard
 * hydrate itself applies; a disagreement under live events waits for the next
 * probe.
 */
export function repairStaleRunState(
	tabId: string,
	state: RpcSessionState,
	eventVersionAtProbe: number | undefined,
): void {
	const session = sessionRuntimeStore<SessionStore>(tabId, "session")?.getState();
	if (!session || session.eventVersion !== eventVersionAtProbe) return;
	const streamingAgrees = session.isStreaming === (state.isStreaming === true);
	// A lost auto_compaction_end leaves the maintenance row up on an idle tab.
	const compactingAgrees = state.isCompacting === true || (!session.isCompacting && session.compactionInfo == null);
	if (streamingAgrees && compactingAgrees) return;
	void hydrateTabSession(tabId);
}

/** Reload every renderer store belonging to one visible tab. */
export async function hydrateTabSession(tabId: string, fallbackName?: string): Promise<void> {
	if (isTabClosed(tabId)) return;
	const runtime = ensureTabRuntime(tabId);
	const version = (hydrationVersions.get(runtime) ?? 0) + 1;
	hydrationVersions.set(runtime, version);
	const isCurrent = (): boolean => hydrationVersions.get(runtime) === version && sessionRuntime(tabId) === runtime;
	// Capture before the fetch: committed agent_end rows arriving while the
	// transcript RPC is in flight must survive the merge below.
	const initialMessagesStore = sessionRuntimeStore<MessagesStore>(tabId, "messages")?.getState();
	const beforeMessages = initialMessagesStore?.messages ?? [];
	const beforeLiveMessages = initialMessagesStore?.liveMessages ?? [];
	const beforeEventVersion = sessionRuntimeStore<SessionStore>(tabId, "session")?.getState().eventVersion;

	const coreResult = Promise.allSettled([
		runtime.command({ type: "get_state" }),
		createSessionRpcClient(runtime.command).getTranscript(),
	]);
	const subagentsResult = sessionRuntimeStore<SubagentsStore>(tabId, "subagents")
		?.getState()
		.refresh({ expect: isCurrent });
	const queue = sessionRuntimeStore<QueueStore>(tabId, "queue")?.getState();
	const settings = sessionRuntimeStore<SettingsStore>(tabId, "settings")?.getState();
	const secondaryResult = Promise.allSettled([
		// Goal state isn't on the get_state wire — fetch alongside so the
		// composer chip reflects an active goal after boot/session switches,
		// not only on goal_updated events.
		syncGoal(tabId, runtime.command, isCurrent),
		// Loop and vibe mode likewise: loop_mode_update frames keep loop fresh
		// afterwards; vibe emits nothing, so the Modes window mirrors toggles.
		syncLoopMode(tabId, runtime.command, isCurrent),
		syncVibeMode(tabId, runtime.command, isCurrent),
		// Neither has a payload-bearing event: config_warnings_changed and the
		// advisor_* frames only announce a change, so hydrate reads both.
		refreshConfigWarnings(tabId),
		refreshProxyWarnings(tabId),
		refreshAdvisorStatus(tabId),
		// Queue snapshot: queue_update frames keep it fresh afterwards;
		// get_queue is only the hydrate fallback (boot/reconnect/session
		// switch all land here). refresh() swallows its own failures.
		queue?.refresh(),
		// Project-scoped agent settings can differ between tab workspaces. The
		// settings store is per-tab (each runtime owns one bound to its own
		// command channel), so re-read this tab's sidecar on every hydrate; both
		// methods already reject stale out-of-order replies.
		settings?.syncDisplaySettings(),
		settings?.syncApproval(),
	]);
	const [stateResult, messagesResult] = await coreResult;
	if (!isCurrent()) return;
	const eventsUnchanged =
		sessionRuntimeStore<SessionStore>(tabId, "session")?.getState().eventVersion === beforeEventVersion;
	// `get_state` is the only witness to a live turn. A failed read counts as not
	// live: a card left spinning never resolves, while a wrongly aborted card is
	// repaired by the next execution event.
	const stateIsStreaming =
		stateResult.status === "fulfilled" &&
		stateResult.value.success &&
		(stateResult.value.data as RpcSessionState | null)?.isStreaming === true;
	const stateIsIdle =
		stateResult.status === "fulfilled" &&
		stateResult.value.success &&
		stateResult.value.data != null &&
		!stateIsStreaming;

	if (
		eventsUnchanged &&
		stateResult.status === "fulfilled" &&
		stateResult.value.success &&
		stateResult.value.data != null
	) {
		const wire = stateResult.value.data as RpcSessionState;
		withSessionRuntime(tabId, () => applySessionState(wire, fallbackName));
		// Mid-run attach (launch/reconnect/session switch while the agent is
		// streaming) missed the agent_start that arms the status row — re-arm
		// it like the TUI's ensureLoadingAnimation on guest attach, unless a
		// live marker already carries a more accurate start time. When content
		// is actively streaming the row stays hidden behind StreamingRows.
		const session = sessionRuntimeStore<SessionStore>(tabId, "session");
		const messages = sessionRuntimeStore<MessagesStore>(tabId, "messages");
		if (wire.isStreaming && session?.getState().awaitingModelSince === null) {
			session.setState({ awaitingModelSince: Date.now() });
		}
		if (!wire.isStreaming) {
			// Zombie settle: the run finished while this tab sat in the
			// background, so its message_end/agent_end never forwarded and the
			// restored bundle still paints partial assistant content. Clear only
			// those stream buffers (and the waiting marker agent_end would have
			// cleared) here; the transcript merge below separately removes
			// delivered live rows while preserving an unsent local prompt.
			messages?.getState().clearStreaming();
			session?.setState({ awaitingModelSince: null });
		}
		// Per-tab subagent subscription (F-HYDRATE), re-asserted on every
		// successful hydrate: the runtime's command channel routes to THIS tab's
		// sidecar. Tabs that report ready while active also subscribe via the
		// status handlers — this covers tabs that booted or settled in the
		// background, whose frames would otherwise stay silent on return.
		// Idempotent server-side.
		void runtime.command({ type: "set_subagent_subscription", level: SUBAGENT_SUBSCRIPTION_LEVEL });
	}

	if (messagesResult.status === "fulfilled" && messagesResult.value.success) {
		const data = messagesResult.value.data as { messages?: AgentMessage[] } | undefined;
		const fetched = data?.messages ?? [];
		const messages = sessionRuntimeStore<MessagesStore>(tabId, "messages");
		const tools = sessionRuntimeStore<ToolsStore>(tabId, "tools");
		const current = messages?.getState().messages ?? [];
		messages?.getState().reconcileFetched(mergeFetchedTranscript(fetched, beforeMessages, current));
		if (eventsUnchanged && stateIsIdle && messages?.getState().liveMessages === beforeLiveMessages) {
			messages.getState().clearDeliveredLiveMessages();
		}
		if (eventsUnchanged)
			tools?.getState().hydrateMessages(messages?.getState().messages ?? [], { turnIsLive: stateIsStreaming });
		// Only a live tab archives plan changes: a reopened one replays them.
		sessionRuntimeStore<TodoStore>(tabId, "todo")
			?.getState()
			.seedHistory(todoHistoryFromMessages(messages?.getState().messages ?? []));
	}

	// Subagents and secondary chips do not hold the transcript hostage. Their
	// requests still begin in parallel, but the core session can paint first.
	await subagentsResult;
	await secondaryResult;
}
