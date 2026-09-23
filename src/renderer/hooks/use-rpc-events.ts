import {
	applyModelInfo,
	applySessionState,
	applyUsageSnapshot,
	hydrateLegacySession,
	hydrateSession,
	hydrateTabSession,
	refreshModelState,
	refreshSessionState,
	syncGoal,
	syncLoopMode,
	syncVibeMode,
} from "./session-hydration";

export * from "./session-hydration";

import { useEffect } from "react";
import type { IpcSidecarStatusPayload } from "../../shared/ipc-types";
import {
	type AgentSessionEvent,
	BLOCKING_UI_METHODS,
	type CommandOutputFrame,
	type ConfigUpdateFrame,
	type ExtensionErrorFrame,
	isThinkingLevel,
	type ModelCatalogUpdateFrame,
	type PromptResultFrame,
	type RpcSessionState,
	type SessionInfoUpdateFrame,
	type SubagentFrame,
	type TodoPhase,
} from "../../shared/rpc-types";
import { formatClock } from "../lib/format";
import { translate } from "../lib/i18n";
import { normalizeLoopUpdate } from "../lib/loop-mode";
import { acceptsActiveTabEvents } from "../lib/tab-routing";
import { useExtensionUiStore } from "../stores/extension-ui";
import { useMessagesStore } from "../stores/messages";
import { useModelStore } from "../stores/model";
import { usePlanApprovalStore } from "../stores/plan-approval";
import { useQueueStore } from "../stores/queue";
import { type SessionStore, useSessionStore } from "../stores/session";
import {
	activeTabCommand,
	sessionRuntime,
	sessionRuntimeStore,
	type TabCommand,
	withSessionRuntime,
} from "../stores/session-runtime-context";
import { useSettingsStore } from "../stores/settings";
import { useSubagentsStore } from "../stores/subagents";
import { isTabClosed, useTabsStore } from "../stores/tabs";
import { useToastStore } from "../stores/toast";
import { useTodoStore } from "../stores/todo";
import { useToolsStore } from "../stores/tools";
import { useUiStore } from "../stores/ui";

/**
 * Routine informational notice sources suppressed from the toast stack — they
 * fire on every model switch (tool mount/unmount reconciliation) and need no
 * user action. Only their info-level notices are dropped; warnings/errors and
 * notices from any other source still surface as toasts.
 */
const QUIET_NOTICE_SOURCES = new Set(["vision", "xdev"]);

/** Schema defaults for the agent's notify settings (settings-schema.ts). */
const NOTIFY_DEFAULTS = { completion: "on", error: "off", ask: "on" } as const;

function isTodoStatus(value: unknown): value is TodoPhase["tasks"][number]["status"] {
	return (
		value === "pending" ||
		value === "in_progress" ||
		value === "completed" ||
		value === "abandoned" ||
		value === "blocked"
	);
}

function isTodoTask(value: unknown): value is TodoPhase["tasks"][number] {
	return (
		typeof value === "object" &&
		value !== null &&
		"content" in value &&
		typeof value.content === "string" &&
		"status" in value &&
		isTodoStatus(value.status) &&
		(!("blocker" in value) || value.blocker === undefined || typeof value.blocker === "string")
	);
}

function isTodoPhase(value: unknown): value is TodoPhase {
	return (
		typeof value === "object" &&
		value !== null &&
		"name" in value &&
		typeof value.name === "string" &&
		"tasks" in value &&
		Array.isArray(value.tasks) &&
		value.tasks.every(isTodoTask)
	);
}

function todoPhasesFromToolResult(result: unknown): TodoPhase[] | undefined {
	if (typeof result !== "object" || result === null || !("details" in result)) return undefined;
	const details = result.details;
	if (typeof details !== "object" || details === null || !("phases" in details)) return undefined;
	return Array.isArray(details.phases) && details.phases.every(isTodoPhase) ? details.phases : undefined;
}
type NotifyKind = keyof typeof NOTIFY_DEFAULTS;

/**
 * True while an auto-retry is outstanding. `AgentSession` defers/coalesces the
 * wire-level `agent_end` while a prompt is in flight, so a whole retry saga
 * usually settles with ONE `agent_end` — but any that do arrive mid-saga are
 * intermediate attempts, not the final outcome (mirrors the TUI's gate in
 * event-controller.ts).
 */
const retryPendingTabs = new Set<string>();

/**
 * Late frames for a tab the user already closed must be dropped: its runtime
 * is gone, and withSessionRuntime would otherwise fall back to the FOCUSED
 * runtime — polluting a live session's transcript, or (a closed tab's
 * in-flight "starting" frame) resetting the focused tab's stores wholesale.
 * An empty tabId (legacy bridge before boot reconciliation) always passes.
 */
function closedTabFrame(tabId: string): boolean {
	return tabId !== "" && isTabClosed(tabId);
}

/**
 * Clear the auto-retry gate. Gates are per-tab: with no explicit target, clear
 * the FOCUSED tab's gate (the tab abortActiveTurn just acted on) — never every
 * tab's, or an Escape in one pane would re-enable error toasts/notifications
 * for a retry saga still running in the other pane.
 */
export function resetRetryPending(tabId?: string): void {
	retryPendingTabs.delete(tabId ?? useTabsStore.getState().activeTabId ?? "");
}

/**
 * Desktop-notification gate, mirroring the TUI's notify policy: the GUI master
 * pref (Settings → GUI, default on), then the agent's `<kind>.notify` setting
 * (read live via get_settings so edits from either the TUI or the GUI's
 * Interaction tab apply immediately), and finally window focus — never notify
 * while the user is watching.
 */
async function maybeNotify(
	kind: NotifyKind,
	title: string,
	body: string,
	command: TabCommand = (rpcCommand, timeoutMs) => window.omp.rpc.command(rpcCommand, timeoutMs),
): Promise<void> {
	try {
		if (document.hasFocus()) return;
		if (!useUiStore.getState().notifications) return;
		const key = `${kind}.notify`;
		const res = await command({ type: "get_settings", paths: [key] });
		const values = res.success ? (res.data as { values?: Record<string, unknown> } | undefined)?.values : undefined;
		const setting = values?.[key];
		const effective = typeof setting === "string" ? setting : NOTIFY_DEFAULTS[kind];
		if (effective === "off") return;
		window.omp.system.notify(title, body);
	} catch {
		// Best-effort: a failed notification must never break event dispatch.
	}
}

/**
 * Notify on a settled turn, reading the outcome from the event's own messages
 * (the mutable stores can already have raced ahead — the TUI reads
 * `agent_end.messages` for the same reason). Completion and error are mutually
 * exclusive for one settled turn.
 */
function notifyOnAgentEnd(tabId: string, event: Extract<AgentSessionEvent, { type: "agent_end" }>): void {
	// `isTerminal === false` marks a deferred mid-run settle, not the final one.
	if (event.isTerminal === false) return;
	if (retryPendingTabs.has(tabId)) return;
	const last = event.messages?.findLast(message => message.role === "assistant");
	if (last?.stopReason === "aborted") return;
	// A settle arriving after the tab closed has no runtime to query settings
	// with — skip rather than resurrect a ghost runtime and notify a dead tab.
	const runtime = sessionRuntime(tabId);
	if (!runtime) return;
	const sessionName =
		sessionRuntimeStore<SessionStore>(tabId, "session")?.getState().sessionName ||
		useSessionStore.getState().sessionName ||
		"Oh My Pi";
	if (last?.stopReason === "error") {
		const message =
			typeof last.errorMessage === "string" && last.errorMessage
				? translate("events.notificationErrorDetail", {
						error: last.errorMessage.replace(/\s+/g, " ").slice(0, 120),
					})
				: translate("events.notificationError");
		void maybeNotify("error", sessionName, message, runtime.command);
		return;
	}
	void maybeNotify("completion", sessionName, translate("events.notificationComplete"), runtime.command);
}

/**
 * Toast a failed turn in-app regardless of the desktop-notification policy
 * (error notifications default off). The chat bubble carries the message, but
 * a failure with no visible output — e.g. the provider rejects the first
 * request right after a model switch — otherwise looks like a silent no-op.
 * Same guards as notifyOnAgentEnd: deferred mid-run settles and live
 * auto-retries stay quiet (the retry row and its final-failure toast cover
 * those), and aborted turns are user-initiated.
 */
function toastOnAgentError(tabId: string, event: Extract<AgentSessionEvent, { type: "agent_end" }>): void {
	if (event.isTerminal === false) return;
	if (retryPendingTabs.has(tabId)) return;
	const last = event.messages?.findLast(message => message.role === "assistant");
	if (last?.stopReason !== "error") return;
	const detail =
		typeof last.errorMessage === "string" && last.errorMessage
			? last.errorMessage.replace(/\s+/g, " ").slice(0, 200)
			: translate("common.unknownError");
	useToastStore.getState().push({ variant: "error", title: translate("events.turnFailed"), message: detail });
}

/** Goal statuses past which no live goal remains — the composer chip must clear. */
const TERMINAL_GOAL_STATUSES: Record<string, true> = { dropped: true, complete: true };

/** Narrow an untyped goal payload to the fields the session store tracks. */
function goalFields(value: unknown): { objective?: string; status?: string } | null {
	if (!value || typeof value !== "object") return null;
	const objective = "objective" in value && typeof value.objective === "string" ? value.objective : undefined;
	const status = "status" in value && typeof value.status === "string" ? value.status : undefined;
	return { objective, status };
}

/**
 * Normalize a goal_updated frame into a session-store patch. A drop/complete
 * emits the TERMINAL goal object (status "dropped"/"complete") alongside
 * state.enabled=false — storing it verbatim leaves the composer chip stuck
 * ON (`!!goal`), so terminal/disabled frames clear the store instead.
 */
function goalPatchFromEvent(
	goal: unknown,
	state: unknown,
): { goal: { objective?: string } | null; goalState: { status?: string } | null } {
	const goalInfo = goalFields(goal);
	const stateGoal = state && typeof state === "object" && "goal" in state ? goalFields(state.goal) : null;
	const enabled =
		state && typeof state === "object" && "enabled" in state && typeof state.enabled === "boolean"
			? state.enabled
			: undefined;
	const status = stateGoal?.status ?? goalInfo?.status;
	const terminal = status !== undefined && TERMINAL_GOAL_STATUSES[status] === true;
	if (terminal || enabled === false || !goalInfo) return { goal: null, goalState: null };
	return { goal: { objective: goalInfo.objective }, goalState: { status } };
}

/**
 * Subscribes to batched RPC events from the sidecar and dispatches
 * them to the appropriate stores. Call once in App.tsx.
 * Also handles sidecar-ready initialization (get_state, subagent subscription).
 *
 * `heartbeatMs` is the liveness-probe cadence; tests shorten it to observe the
 * idle refresh it also drives.
 */
export function useRpcEvents(heartbeatMs = 15_000): void {
	useEffect(() => {
		const focusedTabId = () => useTabsStore.getState().activeTabId ?? "";
		let disposed = false;
		let statusVersion = 0;
		const unsubscribe =
			typeof window.omp.events.onTabBatch === "function"
				? window.omp.events.onTabBatch(reduceEvents)
				: window.omp.events.onBatch(events => {
						if (acceptsActiveTabEvents()) reduceEvents(events, focusedTabId());
					});
		function reduceEvents(events: AgentSessionEvent[], tabId: string): void {
			// Incoming session events belong to the target sidecar. Drop them
			// during an in-place session switch, but never suppress the other pane.
			if (sessionRuntimeStore<SessionStore>(tabId, "session")?.getState().switchPending) return;
			if (closedTabFrame(tabId)) return;
			withSessionRuntime(tabId, () => {
				useMessagesStore.getState().applyEvents(events);
				useToolsStore.getState().applyEvents(events);

				for (const event of events) {
					useSessionStore.setState(state => ({ eventVersion: state.eventVersion + 1 }));
					switch (event.type) {
						case "collab_state":
							useSessionStore.setState({ collab: event.state });
							if (event.restored) void hydrateTabSession(tabId);
							else void refreshSessionState(tabId);
							break;
						case "agent_start": {
							useSessionStore.setState({ isStreaming: true, awaitingModelSince: Date.now() });
							// Server-side mode changes (plan_approval accept exits plan
							// mode, then dispatches the execution turn) carry no event —
							// re-sync state-derived stores at turn start so the composer
							// chip / titlebar reflect the server.
							void refreshSessionState(tabId);
							break;
						}
						case "turn_start": {
							// Model request dispatched; the chat renders a pending-model
							// indicator from this timestamp until message_start (or a
							// running tool card) takes over. Without it a stalled provider
							// (slow first event, transport retry) looks like dead air.
							useSessionStore.setState({ awaitingModelSince: Date.now() });
							break;
						}
						case "message_end": {
							// The finalized assistant message replaces the pending
							// indicator — tools run next and their cards carry the
							// activity signal. message_start is NOT the clear point: it
							// fires with an empty shell before the first token streams,
							// and clearing there would reopen the dead-air window.
							if (event.message.role === "assistant") {
								useSessionStore.setState({ awaitingModelSince: null });
							}
							break;
						}
						case "turn_end": {
							// Tool execution follows; running tool cards carry the
							// activity signal until the next turn_start.
							useSessionStore.setState({ awaitingModelSince: null });
							break;
						}
						case "tool_execution_end": {
							if (event.toolName !== "todo" || event.isError) break;
							const phases = todoPhasesFromToolResult(event.result);
							if (phases) useTodoStore.getState().setPhases(phases);
							break;
						}
						case "agent_end": {
							useSessionStore.setState({ isStreaming: false, awaitingModelSince: null });
							notifyOnAgentEnd(tabId, event);
							toastOnAgentError(tabId, event);
							// Re-fetch state so agent-side todo updates mid-turn reach the panel.
							void refreshSessionState(tabId);
							break;
						}
						case "auto_compaction_start": {
							// TUI parity: swap the status row to the maintenance loader
							// ("Context overflow detected, Auto context-full maintenance…")
							// for the whole compaction window, not just a flag.
							useSessionStore.setState({
								isCompacting: true,
								compactionInfo: { reason: event.reason, action: event.action },
							});
							break;
						}
						case "auto_compaction_end": {
							useSessionStore.setState({ isCompacting: false, compactionInfo: null });
							if (!event.aborted) {
								void (tabId && sessionRuntime(tabId) ? hydrateTabSession(tabId) : hydrateSession());
							}
							if (event.aborted) {
								useToastStore
									.getState()
									.push({ variant: "warning", message: translate("events.compactionAborted") });
							}
							break;
						}
						case "auto_retry_start": {
							retryPendingTabs.add(tabId);
							// TUI parity: inline retry loader for the delay+attempt window.
							// Not a model wait, so the pending-model marker stays clear until
							// auto_retry_end re-arms it.
							useSessionStore.setState({
								retryInfo: {
									attempt: event.attempt,
									maxAttempts: event.maxAttempts,
									delayMs: event.delayMs,
									errorMessage: event.errorMessage,
									startedAt: Date.now(),
								},
								awaitingModelSince: null,
							});
							useToastStore.getState().push({
								variant: "warning",
								message: translate(
									event.delayMs >= 60_000 ? "events.retryScheduledAt" : "events.retryScheduled",
									{
										attempt: event.attempt,
										max: event.maxAttempts,
										seconds: Math.round(event.delayMs / 1000),
										time: formatClock(Date.now() + event.delayMs),
										error: event.errorMessage,
									},
								),
							});
							break;
						}
						case "auto_retry_end": {
							retryPendingTabs.delete(tabId);
							// Mirror the TUI's #ensureWorkingLoaderWhileStreaming: a succeeded
							// retry re-dispatches the turn, so the wait for first content is
							// visible again even if no fresh turn_start arrives.
							useSessionStore.setState({
								retryInfo: null,
								...(event.success && useSessionStore.getState().isStreaming
									? { awaitingModelSince: Date.now() }
									: {}),
							});
							if (event.success) {
								useToastStore
									.getState()
									.push({ variant: "success", message: translate("events.retrySucceeded") });
							} else {
								useToastStore.getState().push({
									variant: "error",
									message: translate("events.retryFailed", {
										error: event.finalError ?? translate("common.unknownError"),
									}),
								});
							}
							break;
						}
						case "retry_fallback_applied": {
							useToastStore.getState().push({
								variant: "info",
								message: translate("events.fallbackApplied", { from: event.from, to: event.to }),
							});
							break;
						}
						case "retry_fallback_succeeded": {
							useToastStore.getState().push({
								variant: "success",
								message: translate("events.fallbackSucceeded", { model: event.model }),
							});
							break;
						}
						case "todo_reminder": {
							useTodoStore.getState().showReminder(event.todos);
							break;
						}
						case "todo_auto_clear": {
							// Automatic cleanup is not a second user-visible todo change:
							// keep the completed snapshot and only clear the live state.
							useTodoStore.getState().autoClearCompleted();
							break;
						}
						case "thinking_level_changed": {
							const configured =
								typeof event.configured === "string" &&
								(event.configured === "auto" || isThinkingLevel(event.configured))
									? event.configured
									: event.thinkingLevel;
							// Explicit changes omit `configured` because it equals the effective
							// level. Treat that omission as data, not as "keep the old selector";
							// otherwise cycle/hotkey changes leave a stale checked menu item.
							useModelStore.setState({
								thinkingLevel: event.thinkingLevel,
								thinkingConfigured: configured,
							});
							break;
						}
						case "model_changed": {
							void refreshModelState(tabId);
							break;
						}
						case "notice": {
							// Suppress routine informational churn from chatty sources — vision/xdev
							// mount/unmount notices fire on every model switch and need no action,
							// flooding the toast stack. Warnings/errors and other sources still toast.
							if (event.level === "info" && event.source && QUIET_NOTICE_SOURCES.has(event.source)) break;
							useToastStore.getState().push({
								variant: event.level === "error" ? "error" : event.level === "warning" ? "warning" : "info",
								message: event.message,
								title: event.source,
							});
							break;
						}
						case "ttsr_triggered": {
							useToastStore.getState().push({
								variant: "info",
								message: translate("events.ttsrInjected"),
								durationMs: 3000,
							});
							break;
						}
						case "goal_updated": {
							// Goal state is passive display — store in session store for the
							// sidebar card / composer chip. Normalized: drop/complete frames
							// carry the terminal goal object, which must CLEAR the store.
							useSessionStore.setState(goalPatchFromEvent(event.goal, event.state));
							break;
						}
						case "loop_mode_update": {
							// Loop state is passive display too — the composer chip and
							// footer badge read it from the session store. Reuse the Modes
							// window's normalizer: frames may arrive flat or nested.
							const next = normalizeLoopUpdate(event);
							if (next) useSessionStore.setState({ loopMode: next });
							break;
						}
						case "queue_update": {
							// Authoritative queue snapshot — fires on every queue mutation
							// (enqueue, drain/consume, remove, move, clear), so the strip,
							// panel, and pending bubbles never poll mid-run.
							useQueueStore.getState().setFromFrame({ steering: event.steering, followUp: event.followUp });
							break;
						}
						case "irc_message": {
							// IRC messages are rendered in the subagent/notification feed
							useToastStore.getState().push({
								variant: "info",
								message:
									typeof event.message === "object" && event.message !== null && "content" in event.message
										? String((event.message as { content: unknown }).content)
										: "IRC message received",
								durationMs: 4000,
							});
							break;
						}
						default:
							break;
					}
				}
			});
		}

		// Heartbeat: a wedged command queue (e.g. a stalled discovery await on
		// the serial server queue) leaves status "ready" but blocks every
		// command, including a lightweight get_state. A periodic probe detects
		// that post-boot brick and surfaces the SidecarBanner (with Restart),
		// which the one-shot boot health check cannot catch.
		let heartbeat: ReturnType<typeof setInterval> | null = null;
		let probing = false;
		const startHeartbeat = () => {
			if (heartbeat) return;
			heartbeat = setInterval(() => {
				if (probing) return;
				if (!acceptsActiveTabEvents()) return;
				if (useSessionStore.getState().status !== "ready") return;
				probing = true;
				const probeTabId = useTabsStore.getState().activeTabId;
				void window.omp.rpc
					.getState()
					.then(res => {
						probing = false;
						if (!acceptsActiveTabEvents() || useTabsStore.getState().activeTabId !== probeTabId) return;
						if (!res.success) {
							useUiStore.getState().setSidecarError(translate("events.sidecarNoResponse"));
							return;
						}
						useUiStore.getState().clearSidecarError();
						// The probe already paid for the tokenised context reading, so let it
						// keep the usage ring honest: a session that idles between turns never
						// lands a get_state snapshot any other way.
						if (res.data != null && probeTabId) applyUsageSnapshot(res.data as RpcSessionState, probeTabId);
					})
					.catch(() => {
						probing = false;
						if (!acceptsActiveTabEvents() || useTabsStore.getState().activeTabId !== probeTabId) return;
						useUiStore.getState().setSidecarError(translate("events.sidecarNoResponse"));
					});
			}, heartbeatMs);
		};
		const stopHeartbeat = () => {
			if (heartbeat) {
				clearInterval(heartbeat);
				heartbeat = null;
			}
		};

		const handleStatus = (payload: IpcSidecarStatusPayload, statusTabId: string) => {
			if (disposed || closedTabFrame(statusTabId)) return;
			statusVersion++;
			const isFocused = () => useTabsStore.getState().activeTabId === statusTabId;
			if (payload.status === "starting") {
				if (isFocused()) stopHeartbeat();
				retryPendingTabs.delete(statusTabId);
				withSessionRuntime(statusTabId, () => {
					useMessagesStore.getState().reset();
					useModelStore.getState().reset();
					useSessionStore.getState().reset();
					useSettingsStore.getState().reset();
					useSubagentsStore.getState().reset();
					useTodoStore.getState().reset();
					useToolsStore.getState().reset();
					useExtensionUiStore.getState().clearAll();
					usePlanApprovalStore.getState().clearProposal();
				});
				if (isFocused()) useUiStore.getState().clearSidecarError();
			}
			withSessionRuntime(statusTabId, () => useSessionStore.getState().setStatus(payload.status, payload.cwd));

			if (payload.status === "ready") {
				if (isFocused()) startHeartbeat();
				// One-shot boot health check: verify the command loop is live.
				void (async () => {
					try {
						const runtime = sessionRuntime(statusTabId);
						const command = runtime?.command ?? activeTabCommand;
						// A window opened "in new window" for a specific session
						// switches to it BEFORE hydrating, so the first transcript
						// it pulls is the target session, not the fresh empty one.
						const pending = isFocused() ? await window.omp.sessions.consumePendingOpen() : null;
						if (pending) {
							const sw = await command({ type: "switch_session", sessionPath: pending });
							if (!sw.success) {
								useToastStore.getState().push({
									variant: "error",
									message: translate("events.sessionOpenFailed", { error: sw.error }),
								});
							}
						}
						const res = await command({ type: "get_state" });
						if (runtime && sessionRuntime(statusTabId) !== runtime) return;
						if (!res.success) {
							if (isFocused()) useUiStore.getState().setSidecarError(translate("events.sidecarNoResponse"));
						} else {
							if (isFocused()) useUiStore.getState().clearSidecarError();
							if (runtime) {
								void hydrateTabSession(statusTabId);
							} else {
								const wire = res.data as RpcSessionState;
								applySessionState(wire);
								if (wire.isStreaming && useSessionStore.getState().awaitingModelSince === null) {
									useSessionStore.setState({ awaitingModelSince: Date.now() });
								}
								if (!wire.isStreaming) useMessagesStore.getState().clearStreaming();
								await Promise.allSettled([
									syncGoal("", activeTabCommand, () => true),
									syncLoopMode("", activeTabCommand, () => true),
									syncVibeMode("", activeTabCommand, () => true),
									useQueueStore.getState().refresh(),
									useSettingsStore.getState().syncDisplaySettings(),
									useSettingsStore.getState().syncApproval(),
								]);
							}
							void command({ type: "set_subagent_subscription", level: "events" });
						}
					} catch {
						if (isFocused()) useUiStore.getState().setSidecarError(translate("events.sidecarHealthFailed"));
					}
				})();
			} else if (payload.status === "error" || payload.status === "exited" || payload.status === "restarting") {
				if (isFocused()) {
					// The command queue died with the process, so a probe would fail and
					// overwrite the crash reason with a generic "not responding".
					stopHeartbeat();
					useUiStore
						.getState()
						.setSidecarError(
							payload.message ?? translate("events.sidecarProcessFailed"),
							payload.restart ?? null,
						);
				}
			}
		};

		const unsubStatus =
			typeof window.omp.events.onTabSidecarStatus === "function"
				? window.omp.events.onTabSidecarStatus(handleStatus)
				: window.omp.events.onSidecarStatus(payload => handleStatus(payload, focusedTabId()));
		const snapshotTabId = focusedTabId();
		const snapshotRuntime = sessionRuntime(snapshotTabId);
		const snapshotVersion = statusVersion;
		void window.omp.sidecar
			.getStatus()
			.then(status => {
				// A boot snapshot cannot roll back a newer push, or reset a task
				// selected/replaced while the active-tab request was in flight.
				if (
					disposed ||
					statusVersion !== snapshotVersion ||
					focusedTabId() !== snapshotTabId ||
					sessionRuntime(snapshotTabId) !== snapshotRuntime
				)
					return;
				handleStatus(status, snapshotTabId);
			})
			.catch(() => {
				// Status pushes and GET_TABS remain authoritative when this read fails.
			});

		const handleSubagent = (frame: SubagentFrame, tabId: string) => {
			if (closedTabFrame(tabId)) return;
			withSessionRuntime(tabId, () => useSubagentsStore.getState().applyFrame(frame));
		};
		const unsubSubagent =
			typeof window.omp.events.onTabSubagentFrame === "function"
				? window.omp.events.onTabSubagentFrame(handleSubagent)
				: window.omp.events.onSubagentFrame(frame => handleSubagent(frame, focusedTabId()));

		const handleModelCatalog = (frame: ModelCatalogUpdateFrame, tabId: string) => {
			if (closedTabFrame(tabId)) return;
			withSessionRuntime(tabId, () => useModelStore.getState().applyCatalogUpdate(frame));
		};
		const unsubModelCatalog =
			typeof window.omp.events.onTabModelCatalogUpdate === "function"
				? window.omp.events.onTabModelCatalogUpdate(handleModelCatalog)
				: window.omp.events.onModelCatalogUpdate(frame => handleModelCatalog(frame, focusedTabId()));

		// Agent config edits (set_setting from any client, slash-command config
		// changes) push config_update — re-read the thinking-display settings so
		// ThinkingBlock re-renders with the live hide/prose-only policy. The frame
		// also carries the sidecar's live model, which is applied directly: unlike
		// a get_state round trip it cannot lose a race with the event batch.
		const handleConfig = (frame: ConfigUpdateFrame, tabId: string) => {
			if (closedTabFrame(tabId)) return;
			withSessionRuntime(tabId, () => {
				applyModelInfo(frame.model, tabId);
				void useSettingsStore.getState().syncDisplaySettings();
				void useSettingsStore.getState().syncApproval();
			});
		};
		const unsubConfig =
			typeof window.omp.events.onTabConfigUpdate === "function"
				? window.omp.events.onTabConfigUpdate(handleConfig)
				: window.omp.events.onConfigUpdate(frame => handleConfig(frame, focusedTabId()));
		// Extension slash commands can settle locally after the prompt response
		// has already resolved; prompt_result carries the deferred rehydrate signal.
		const handlePromptResult = (frame: PromptResultFrame, tabId: string) => {
			if (closedTabFrame(tabId)) return;
			if (!frame.agentInvoked) void (sessionRuntime(tabId) ? hydrateTabSession(tabId) : hydrateLegacySession());
		};
		const unsubPromptResult =
			typeof window.omp.events.onTabPromptResult === "function"
				? window.omp.events.onTabPromptResult(handlePromptResult)
				: window.omp.events.onPromptResult(frame => handlePromptResult(frame, focusedTabId()));
		// Text-mode slash commands write outside the transcript. Surface their
		// output as local custom messages instead of silently dropping the frame.
		const handleCommandOutput = (frame: CommandOutputFrame, tabId: string) => {
			if (!frame.text || closedTabFrame(tabId)) return;
			withSessionRuntime(tabId, () => {
				useMessagesStore.getState().appendMessage({
					role: "custom",
					customType: "command",
					content: [{ type: "text", text: frame.text }],
					timestamp: Date.now(),
				});
			});
		};
		const unsubCommandOutput =
			typeof window.omp.events.onTabCommandOutput === "function"
				? window.omp.events.onTabCommandOutput(handleCommandOutput)
				: window.omp.events.onCommandOutput(frame => {
						if (acceptsActiveTabEvents()) handleCommandOutput(frame, focusedTabId());
					});

		const handleSessionInfo = (frame: SessionInfoUpdateFrame, tabId: string) => {
			if (closedTabFrame(tabId)) return;
			withSessionRuntime(tabId, () => {
				useSessionStore.setState(state => ({
					sessionName: frame.title === undefined ? state.sessionName : frame.title,
					sessionId: frame.sessionId ?? state.sessionId,
				}));
			});
		};
		const unsubSessionInfo =
			typeof window.omp.events.onTabSessionInfoUpdate === "function"
				? window.omp.events.onTabSessionInfoUpdate(handleSessionInfo)
				: window.omp.events.onSessionInfoUpdate(frame => handleSessionInfo(frame, focusedTabId()));

		const handleExtensionError = (frame: ExtensionErrorFrame) => {
			useToastStore.getState().push({
				variant: "error",
				title: translate("events.extensionError"),
				message: `${frame.extensionPath} (${frame.event}): ${frame.error}`,
			});
		};
		const unsubExtensionError =
			typeof window.omp.events.onTabExtensionError === "function"
				? window.omp.events.onTabExtensionError(handleExtensionError)
				: window.omp.events.onExtensionError(handleExtensionError);

		// Ask/extension-UI requests that block for input (ask tool, approvals,
		// confirms, …) — notify when the window is unfocused.
		const unsubExtensionUi = window.omp.events.onExtensionUi((request, sourceTabId) => {
			if (!BLOCKING_UI_METHODS[request.method]) return;
			const tabId = sourceTabId ?? focusedTabId();
			const tab = useTabsStore.getState().tabs.find(item => item.id === tabId);
			const sessionName = tab?.title || "Oh My Pi";
			const body =
				"title" in request && typeof request.title === "string" && request.title
					? request.title
					: "Waiting for input";
			void maybeNotify("ask", sessionName, body, sessionRuntime(tabId)?.command ?? activeTabCommand);
		});

		return () => {
			disposed = true;
			stopHeartbeat();
			unsubscribe();
			unsubStatus();
			unsubSubagent();
			unsubModelCatalog();
			unsubConfig();
			unsubPromptResult();
			unsubExtensionUi();
			unsubCommandOutput();
			unsubSessionInfo();
			unsubExtensionError();
		};
	}, [heartbeatMs]);
}
