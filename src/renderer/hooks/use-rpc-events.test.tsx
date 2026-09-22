/**
 * Contract tests for the pending-model indicator: the chat must show a live
 * "waiting for model response" row between turn_start and the first streamed
 * message, because a stalled provider request (slow first event, transport
 * retry) is otherwise indistinguishable from a dead UI. Covers the
 * useRpcEvents event wiring (which events arm/clear `awaitingModelSince`) and
 * the PendingModelRow elapsed-time rendering. Rendered with react-dom/client
 * into a linkedom document (same harness as ForkHandoffDialogs.test.tsx).
 */

import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { IpcSidecarStatusPayload } from "../../shared/ipc-types";
import type {
	AgentMessage,
	AgentSessionEvent,
	CommandOutputFrame,
	ExtensionErrorFrame,
	ModelCatalogUpdateFrame,
	PromptResultFrame,
	RpcCommand,
	RpcResponse,
	SessionInfoUpdateFrame,
	TodoPhase,
} from "../../shared/rpc-types";
import { TurnStatusRow } from "../components/chat/ChatStream";
import { formatClock } from "../lib/format";
import { I18nProvider } from "../lib/i18n";
import { type MessagesStore, useMessagesStore } from "../stores/messages";
import { type ModelStore, useModelStore } from "../stores/model";
import { type SessionStore, useSessionStore } from "../stores/session";
import { sessionRuntime, sessionRuntimeStore, setFocusedSessionRuntime } from "../stores/session-runtime-context";
import { useSettingsStore } from "../stores/settings";
import { useSubagentsStore } from "../stores/subagents";
import { ensureTabRuntime } from "../stores/tab-runtime";
import { useTabsStore } from "../stores/tabs";
import { useToastStore } from "../stores/toast";
import { useTodoStore } from "../stores/todo";
import { useToolsStore } from "../stores/tools";
import { hydrateSession, useRpcEvents } from "./use-rpc-events";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");

const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

const elementPrototype = HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof elementPrototype.scrollIntoView !== "function") elementPrototype.scrollIntoView = () => {};

interface TestElement {
	textContent: string | null;
	remove: () => void;
	appendChild: (child: TestElement) => void;
}

function success(data: unknown): RpcResponse {
	return { type: "response", command: "test", success: true, data };
}

type BatchHandler = (events: AgentSessionEvent[]) => void;
type CommandOutputHandler = (frame: CommandOutputFrame) => void;
type PromptResultHandler = (frame: PromptResultFrame) => void;
type ModelCatalogUpdateHandler = (frame: ModelCatalogUpdateFrame) => void;

interface MockOmp {
	tabs: {
		setActive: Mock<(tabId: string) => Promise<boolean>>;
	};
	rpc: {
		getState: Mock<() => Promise<RpcResponse>>;
		getTranscript: Mock<() => Promise<RpcResponse>>;
		getSubagents: Mock<() => Promise<RpcResponse>>;
		getGoal: Mock<() => Promise<RpcResponse>>;
		getLoopMode: Mock<() => Promise<RpcResponse>>;
		getVibeMode: Mock<() => Promise<RpcResponse>>;
		getQueue: Mock<() => Promise<RpcResponse>>;
		getSettings: Mock<(keys: string[]) => Promise<RpcResponse>>;
		setSubagentSubscription: Mock<(level: string) => Promise<RpcResponse>>;
	};
	events: {
		onBatch: Mock<(callback: BatchHandler) => () => void>;
		onSidecarStatus: Mock<() => () => void>;
		onSubagentFrame: Mock<() => () => void>;
		onModelCatalogUpdate: Mock<(callback: ModelCatalogUpdateHandler) => () => void>;
		onConfigUpdate: Mock<() => () => void>;
		onExtensionUi: Mock<() => () => void>;
		onPromptResult: Mock<(callback: PromptResultHandler) => () => void>;
		onCommandOutput: Mock<(callback: CommandOutputHandler) => () => void>;
		onSessionInfoUpdate: Mock<(callback: (frame: SessionInfoUpdateFrame) => void) => () => void>;
		onExtensionError: Mock<(callback: (frame: ExtensionErrorFrame) => void) => () => void>;
	};
	sidecar: { getStatus: Mock<() => Promise<unknown>> };
	sessions: { consumePendingOpen: Mock<() => Promise<unknown>> };
	system: { notify: Mock<(title: string, body: string) => void> };
	prefs: {
		get: Mock<(key: string) => Promise<unknown>>;
		set: Mock<(key: string, value: unknown) => Promise<void>>;
	};
}

function installMockOmp(): {
	omp: MockOmp;
	emitBatch: BatchHandler;
	emitCommandOutput: CommandOutputHandler;
	emitPromptResult: PromptResultHandler;
	emitModelCatalogUpdate: ModelCatalogUpdateHandler;
} {
	let batchHandler: BatchHandler = () => {};
	let commandOutputHandler: CommandOutputHandler = () => {};
	let promptResultHandler: PromptResultHandler = () => {};
	let modelCatalogUpdateHandler: ModelCatalogUpdateHandler = () => {};
	// Mirror the real server: get_state reports isStreaming=true mid-run, and
	// agent_start triggers refreshSessionState — a static mock would overwrite
	// the event-set flag with stale state and test a race production never has.
	let mockStreaming = false;
	const omp: MockOmp = {
		tabs: { setActive: vi.fn(async () => true) },
		rpc: {
			getState: vi.fn(async () =>
				success({
					sessionId: "s1",
					sessionName: null,
					sessionFile: null,
					cwd: "/tmp",
					isStreaming: mockStreaming,
					isCompacting: false,
					contextUsage: null,
					messageCount: 0,
					queuedMessageCount: 0,
					planModeEnabled: false,
					todoPhases: [],
				}),
			),
			getTranscript: vi.fn(async () => success({ messages: [] })),
			getSubagents: vi.fn(async () => success({ subagents: [] })),
			getGoal: vi.fn(async () => success({ enabled: false })),
			getLoopMode: vi.fn(async () => success({ enabled: false, state: "off" })),
			getVibeMode: vi.fn(async () => success({ enabled: false })),
			getQueue: vi.fn(async () => success({ steering: [], followUp: [] })),
			getSettings: vi.fn(async () => success({ values: {} })),
			setSubagentSubscription: vi.fn(async () => success({})),
		},
		events: {
			onBatch: vi.fn((callback: BatchHandler) => {
				batchHandler = callback;
				return () => {};
			}),
			onSidecarStatus: vi.fn(() => () => {}),
			onSubagentFrame: vi.fn(() => () => {}),
			onModelCatalogUpdate: vi.fn((callback: ModelCatalogUpdateHandler) => {
				modelCatalogUpdateHandler = callback;
				return () => {};
			}),
			onConfigUpdate: vi.fn(() => () => {}),
			onExtensionUi: vi.fn(() => () => {}),
			onPromptResult: vi.fn((callback: PromptResultHandler) => {
				promptResultHandler = callback;
				return () => {};
			}),
			onCommandOutput: vi.fn((callback: CommandOutputHandler) => {
				commandOutputHandler = callback;
				return () => {};
			}),
			onSessionInfoUpdate: vi.fn(() => () => {}),
			onExtensionError: vi.fn(() => () => {}),
		},
		sidecar: { getStatus: vi.fn(async () => ({ status: "ready", cwd: "/tmp" })) },
		// Boot pulls the pending "open in new window" session before hydrating;
		// null = none pending (the plain-attach path this suite drives).
		sessions: { consumePendingOpen: vi.fn(async () => null) },
		system: { notify: vi.fn() },
		prefs: {
			get: vi.fn(async () => null),
			set: vi.fn(async () => {}),
		},
	};
	const ompWindow = window as unknown as { omp: MockOmp };
	ompWindow.omp = omp;
	const emitBatch: BatchHandler = events => {
		for (const event of events) {
			if (event.type === "agent_start") mockStreaming = true;
			if (event.type === "agent_end") mockStreaming = false;
		}
		batchHandler(events);
	};
	return {
		omp,
		emitBatch,
		emitCommandOutput: frame => commandOutputHandler(frame),
		emitPromptResult: frame => promptResultHandler(frame),
		emitModelCatalogUpdate: frame => modelCatalogUpdateHandler(frame),
	};
}

type TabBatchHandler = (events: AgentSessionEvent[], tabId: string) => void;
type TabSidecarStatusHandler = (payload: IpcSidecarStatusPayload, tabId: string) => void;

/**
 * Tab-routed variant of the legacy harness above: the modern preload exposes
 * onTabBatch/onTabSidecarStatus envelopes and rpc.commandForTab, so events
 * arrive stamped with their originating tab.
 */
function installTabRoutedMockOmp(): {
	emitTabBatch: TabBatchHandler;
	emitTabStatus: TabSidecarStatusHandler;
	notify: Mock<(title: string, body: string) => void>;
	commandForTab: Mock<(tabId: string, command: RpcCommand) => Promise<RpcResponse>>;
} {
	let tabBatchHandler: TabBatchHandler = () => {};
	let tabStatusHandler: TabSidecarStatusHandler = () => {};
	const commandForTab = vi.fn(async (_tabId: string, command: RpcCommand): Promise<RpcResponse> => {
		switch (command.type) {
			case "get_state":
				return success({
					sessionId: "s1",
					sessionName: null,
					sessionFile: null,
					cwd: "/tmp",
					isStreaming: false,
					isCompacting: false,
					contextUsage: null,
					messageCount: 0,
					queuedMessageCount: 0,
					planModeEnabled: false,
					todoPhases: [],
				});
			case "get_transcript":
				return success({ messages: [] });
			case "get_subagents":
				return success({ subagents: [] });
			case "get_goal":
				return success({ enabled: false });
			case "get_loop_mode":
				return success({ enabled: false, state: "off" });
			case "get_vibe_mode":
				return success({ enabled: false });
			case "get_queue":
				return success({ steering: [], followUp: [] });
			case "get_settings":
				return success({ values: {} });
			default:
				return success({});
		}
	});
	const noopSub = vi.fn(() => () => {});
	const notify = vi.fn();
	const omp = {
		tabs: {
			list: vi.fn(async () => []),
			close: vi.fn(async () => true),
			setActive: vi.fn(async () => true),
			setView: vi.fn(async () => true),
		},
		rpc: {
			commandForTab,
			getState: vi.fn(async () => success({})),
		},
		events: {
			onTabBatch: vi.fn((callback: TabBatchHandler) => {
				tabBatchHandler = callback;
				return () => {};
			}),
			onTabSidecarStatus: vi.fn((callback: TabSidecarStatusHandler) => {
				tabStatusHandler = callback;
				return () => {};
			}),
			onTabSubagentFrame: noopSub,
			onTabModelCatalogUpdate: noopSub,
			onTabConfigUpdate: noopSub,
			onExtensionUi: noopSub,
			onTabPromptResult: noopSub,
			onTabCommandOutput: noopSub,
			onTabSessionInfoUpdate: noopSub,
			onTabExtensionError: noopSub,
		},
		sidecar: { getStatus: vi.fn(async () => ({ status: "ready", cwd: "/tmp" })) },
		sessions: { consumePendingOpen: vi.fn(async () => null) },
		system: { notify },
		prefs: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
	};
	(window as unknown as { omp: typeof omp }).omp = omp;
	return {
		emitTabBatch: (events, tabId) => tabBatchHandler(events, tabId),
		emitTabStatus: (payload, tabId) => tabStatusHandler(payload, tabId),
		notify,
		commandForTab,
	};
}

let container: TestElement;
let root: Root;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

async function mount(element: ReactElement): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(<I18nProvider>{element}</I18nProvider>);
	});
	await flush();
}

/** Renders the hook under test with no visible chrome of its own. */
function RpcEventsProbe({ heartbeatMs }: { heartbeatMs?: number } = {}) {
	useRpcEvents(heartbeatMs);
	return null;
}

it("does not let a delayed startup snapshot clear the task selected after the request", async () => {
	installTabRoutedMockOmp();
	const status = Promise.withResolvers<IpcSidecarStatusPayload>();
	vi.spyOn(window.omp.sidecar, "getStatus").mockReturnValue(status.promise);
	useTabsStore.setState({
		tabs: [
			{ id: "t0", kind: "agent", cwd: "/alpha", status: "ready", unreadDone: false },
			{ id: "t1", kind: "agent", cwd: "/beta", status: "ready", unreadDone: false },
		],
		activeTabId: "t0",
	});
	ensureTabRuntime("t0");
	ensureTabRuntime("t1");
	setFocusedSessionRuntime("t0");
	await mount(<RpcEventsProbe />);
	const other = sessionRuntimeStore<MessagesStore>("t1", "messages")!;
	other.getState().appendMessage({ role: "user", content: "Task B history", timestamp: 1 });
	useTabsStore.setState({ activeTabId: "t1" });
	setFocusedSessionRuntime("t1");
	status.resolve({ status: "starting", cwd: "/alpha" });
	await flush();
	expect(other.getState().messages).toMatchObject([{ content: "Task B history" }]);
});

it("does not roll a ready task back to starting when its older startup snapshot resolves", async () => {
	const { emitTabStatus } = installTabRoutedMockOmp();
	const status = Promise.withResolvers<IpcSidecarStatusPayload>();
	vi.spyOn(window.omp.sidecar, "getStatus").mockReturnValue(status.promise);
	useTabsStore.setState({
		tabs: [{ id: "t0", kind: "agent", cwd: "/alpha", status: "starting", unreadDone: false }],
		activeTabId: "t0",
	});
	ensureTabRuntime("t0");
	setFocusedSessionRuntime("t0");
	await mount(<RpcEventsProbe />);
	emitTabStatus({ status: "ready", cwd: "/alpha" }, "t0");
	await flush();
	const messages = sessionRuntimeStore<MessagesStore>("t0", "messages")!;
	messages.getState().appendMessage({ role: "user", content: "History loaded after ready", timestamp: 1 });
	status.resolve({ status: "starting", cwd: "/alpha" });
	await flush();
	expect(sessionRuntimeStore<SessionStore>("t0", "session")?.getState().status).toBe("ready");
	expect(messages.getState().messages).toMatchObject([{ content: "History loaded after ready" }]);
});

const assistantMessage: AgentMessage = { role: "assistant", content: [], timestamp: Date.now() };

afterEach(async () => {
	if (root) {
		await act(async () => {
			root.unmount();
		});
	}
	container?.remove();
	useTabsStore.getState().reset();
	useSessionStore.getState().reset();
	useMessagesStore.getState().reset();
	useModelStore.getState().reset();
	useToolsStore.getState().reset();
	useTodoStore.getState().reset();
	useSettingsStore.getState().reset();
	useSubagentsStore.getState().reset();
	useToastStore.setState({ toasts: [] });
	vi.restoreAllMocks();
});

describe("useRpcEvents thinking selection sync", () => {
	it("replaces a stale auto selector when an explicit level event omits configured", async () => {
		const { emitBatch } = installMockOmp();
		await mount(<RpcEventsProbe />);
		useModelStore.setState({ thinkingLevel: "low", thinkingConfigured: "auto" });

		await act(async () => {
			emitBatch([{ type: "thinking_level_changed", thinkingLevel: "high" }]);
		});

		expect(useModelStore.getState().thinkingLevel).toBe("high");
		expect(useModelStore.getState().thinkingConfigured).toBe("high");
	});

	it("keeps auto selected while updating its effective resolved level", async () => {
		const { emitBatch } = installMockOmp();
		await mount(<RpcEventsProbe />);
		useModelStore.setState({ thinkingLevel: "medium", thinkingConfigured: "medium" });

		await act(async () => {
			emitBatch([{ type: "thinking_level_changed", thinkingLevel: "xhigh", configured: "auto" }]);
		});

		expect(useModelStore.getState().thinkingLevel).toBe("xhigh");
		expect(useModelStore.getState().thinkingConfigured).toBe("auto");
	});
});

describe("useRpcEvents model switch sync", () => {
	it("lands a model switch whose get_state races a trailing event from the same batch", async () => {
		const { emitTabBatch, commandForTab } = installTabRoutedMockOmp();
		useTabsStore.setState({
			tabs: [{ kind: "agent", id: "t-model", cwd: "/alpha", status: "ready", unreadDone: false }],
			activeTabId: "t-model",
		});
		ensureTabRuntime("t-model");
		setFocusedSessionRuntime("t-model");
		await mount(<RpcEventsProbe />);
		await flush();

		const session = sessionRuntimeStore<SessionStore>("t-model", "session")!;
		const model = sessionRuntimeStore<ModelStore>("t-model", "model")!;
		session.getState().reset();
		model.getState().reset();
		session.setState({ sessionId: "s1", isStreaming: true });
		model.setState({ model: { provider: "old", id: "m-old" } });

		// Hold get_state open until the batch has been fully reduced, matching the
		// real 32ms batch where model_changed is followed by the switch's own
		// thinking_level_changed / tool-reconciliation notice frames.
		const state = Promise.withResolvers<RpcResponse>();
		const original = commandForTab.getMockImplementation()!;
		commandForTab.mockImplementation((tabId, command) =>
			command.type === "get_state" ? state.promise : original(tabId, command),
		);
		await act(async () => {
			emitTabBatch(
				[
					{ type: "model_changed" },
					{ type: "thinking_level_changed", thinkingLevel: "high" },
					{ type: "notice", level: "info", message: "vision mounted", source: "vision" },
				],
				"t-model",
			);
		});
		state.resolve(
			success({
				sessionId: "s1",
				sessionName: null,
				sessionFile: null,
				cwd: "/tmp",
				model: { provider: "new", id: "m-new" },
				thinkingLevel: "high",
				availableThinkingLevels: ["high"],
				isStreaming: false,
				isCompacting: false,
				contextUsage: { tokens: 100, contextWindow: 2000, percent: 5 },
				messageCount: 0,
				queuedMessageCount: 0,
				planModeEnabled: false,
				todoPhases: [],
			}),
		);
		await flush();

		// The switch itself must survive the event churn that used to invalidate
		// the whole snapshot, and the new context window comes with it.
		expect(model.getState().model).toMatchObject({ provider: "new", id: "m-new" });
		expect(model.getState().thinkingLevel).toBe("high");
		expect(session.getState().contextUsage).toMatchObject({ contextWindow: 2000 });
		// A model-scoped refresh owns the model slice only: the mid-run streaming
		// flag belongs to agent_start/agent_end, not to this snapshot.
		expect(session.getState().isStreaming).toBe(true);
	});
});

function settledState(overrides: Record<string, unknown>): RpcResponse {
	return success({
		sessionId: "s1",
		sessionName: null,
		sessionFile: null,
		cwd: "/tmp",
		isStreaming: false,
		isCompacting: false,
		messageCount: 4,
		queuedMessageCount: 0,
		planModeEnabled: false,
		todoPhases: [],
		...overrides,
	});
}

function seedReadyTab(tabId: string) {
	useTabsStore.setState({
		tabs: [{ kind: "agent", id: tabId, cwd: "/alpha", status: "ready", unreadDone: false }],
		activeTabId: tabId,
	});
	ensureTabRuntime(tabId);
	setFocusedSessionRuntime(tabId);
	const session = sessionRuntimeStore<SessionStore>(tabId, "session")!;
	session.getState().reset();
	session.setState({ sessionId: "s1", status: "ready" });
	return session;
}

describe("useRpcEvents context usage sync", () => {
	it("lands the turn's usage reading from a get_state that raced a trailing event", async () => {
		const { emitTabBatch, commandForTab } = installTabRoutedMockOmp();
		const session = seedReadyTab("t-usage");
		session.setState({ contextUsage: { tokens: 40, contextWindow: 2000, percent: 2 } });
		await mount(<RpcEventsProbe />);
		// Drain the boot hydration's command chain first: a get_state still in
		// flight would be caught by the interceptor below and apply the same
		// snapshot through the unguarded hydrate path, hiding the race.
		await act(async () => {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, 60);
			await promise;
		});
		session.setState({ contextUsage: { tokens: 40, contextWindow: 2000, percent: 2 } });

		// Hold get_state open until the batch has been fully reduced: agent_end
		// queues the refresh, then the notice behind it moves eventVersion.
		const state = Promise.withResolvers<RpcResponse>();
		const original = commandForTab.getMockImplementation()!;
		commandForTab.mockImplementation((id, command) =>
			command.type === "get_state" ? state.promise : original(id, command),
		);
		await act(async () => {
			emitTabBatch(
				[{ type: "agent_end" }, { type: "notice", level: "info", message: "task finished", source: "task" }],
				"t-usage",
			);
		});
		state.resolve(settledState({ contextUsage: { tokens: 1200, contextWindow: 2000, percent: 60 } }));
		await flush();

		// The trailing event invalidates the snapshot for everything an event
		// carries — usage has no event carrier, so the turn's reading must land.
		expect(session.getState().contextUsage).toMatchObject({ tokens: 1200, percent: 60 });
	});

	it("refreshes the usage ring from the liveness probe while the session idles", async () => {
		const { emitTabStatus } = installTabRoutedMockOmp();
		const session = seedReadyTab("t-idle");
		await mount(<RpcEventsProbe heartbeatMs={25} />);
		emitTabStatus({ status: "ready", cwd: "/alpha" }, "t-idle");
		await flush();
		session.setState({ contextUsage: null });

		const getState = vi
			.spyOn(window.omp.rpc, "getState")
			.mockResolvedValue(settledState({ contextUsage: { tokens: 900, contextWindow: 1000, percent: 90 } }));
		await act(async () => {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, 80);
			await promise;
		});

		// The probe is already paid for (it tokenises the context to answer at
		// all); a session that only idles between turns had no other way to land
		// a snapshot, so its ring stayed on the number from the last turn.
		expect(getState).toHaveBeenCalled();
		expect(session.getState().contextUsage).toMatchObject({ tokens: 900 });
		expect(session.getState().statsPulse).toBeGreaterThan(0);
	});
});

describe("useRpcEvents awaiting-model marker", () => {
	it("arms on agent/turn start and clears when the assistant message finalizes", async () => {
		const { emitBatch } = installMockOmp();
		await mount(<RpcEventsProbe />);

		expect(useSessionStore.getState().awaitingModelSince).toBeNull();

		await act(async () => {
			emitBatch([{ type: "agent_start", sessionId: "s1" }]);
		});
		expect(useSessionStore.getState().isStreaming).toBe(true);
		const armedAt = useSessionStore.getState().awaitingModelSince;
		expect(typeof armedAt).toBe("number");

		// The empty-shell phase keeps the marker: message_start fires before
		// the first token, and the status row must survive it.
		await act(async () => {
			emitBatch([{ type: "message_start", message: assistantMessage }]);
		});
		expect(useSessionStore.getState().awaitingModelSince).not.toBeNull();

		await act(async () => {
			emitBatch([{ type: "message_end", message: assistantMessage }]);
		});
		expect(useSessionStore.getState().awaitingModelSince).toBeNull();
	});

	it("re-arms per turn and clears on turn_end and agent_end", async () => {
		const { emitBatch } = installMockOmp();
		await mount(<RpcEventsProbe />);

		await act(async () => {
			emitBatch([{ type: "agent_start", sessionId: "s1" }, { type: "turn_start" }]);
		});
		expect(useSessionStore.getState().awaitingModelSince).not.toBeNull();

		// Tool execution window: running tool cards carry the activity signal.
		await act(async () => {
			emitBatch([{ type: "turn_end" }]);
		});
		expect(useSessionStore.getState().awaitingModelSince).toBeNull();
		expect(useSessionStore.getState().isStreaming).toBe(true);

		await act(async () => {
			emitBatch([{ type: "turn_start" }]);
		});
		expect(useSessionStore.getState().awaitingModelSince).not.toBeNull();

		await act(async () => {
			emitBatch([{ type: "agent_end", messages: [], isTerminal: false }]);
		});
		expect(useSessionStore.getState().isStreaming).toBe(false);
		expect(useSessionStore.getState().awaitingModelSince).toBeNull();
	});

	it("drives the retry row state and re-arms the model wait on success", async () => {
		const { emitBatch } = installMockOmp();
		await mount(<RpcEventsProbe />);

		await act(async () => {
			emitBatch([{ type: "agent_start", sessionId: "s1" }]);
		});
		expect(useSessionStore.getState().awaitingModelSince).not.toBeNull();

		// Retry delay window: not a model wait — the inline retry row owns the chat.
		await act(async () => {
			emitBatch([
				{ type: "auto_retry_start", attempt: 2, maxAttempts: 5, delayMs: 9000, errorMessage: "stream stalled" },
			]);
		});
		const retryInfo = useSessionStore.getState().retryInfo;
		expect(retryInfo?.attempt).toBe(2);
		expect(retryInfo?.maxAttempts).toBe(5);
		expect(retryInfo?.delayMs).toBe(9000);
		expect(useSessionStore.getState().awaitingModelSince).toBeNull();

		// Mirror of the TUI's #ensureWorkingLoaderWhileStreaming: a succeeded
		// retry re-arms the wait for the re-dispatched turn's first content.
		await act(async () => {
			emitBatch([{ type: "auto_retry_end", success: true, attempt: 2 }]);
		});
		expect(useSessionStore.getState().retryInfo).toBeNull();
		expect(useSessionStore.getState().awaitingModelSince).not.toBeNull();

		await act(async () => {
			emitBatch([{ type: "agent_end", messages: [], isTerminal: false }]);
		});
		expect(useSessionStore.getState().awaitingModelSince).toBeNull();
	});

	it("keeps a long quota wait visible after its notification expires", async () => {
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		try {
			const { emitBatch } = installMockOmp();
			await mount(
				<>
					<RpcEventsProbe />
					<TurnStatusRow />
				</>,
			);
			const delayMs = 2 * 24 * 60 * 60 * 1000;
			await act(async () => {
				emitBatch([
					{
						type: "auto_retry_start",
						attempt: 1,
						maxAttempts: 3,
						delayMs,
						errorMessage: "Weekly quota exhausted",
					},
				]);
			});
			expect(document.body.textContent).toContain(formatClock(now + delayMs));
			expect(document.body.textContent).not.toContain("172800s");
			const notification = useToastStore.getState().toasts.find(item => item.message.includes("Weekly quota"));
			expect(notification?.expiresAt).toBeLessThan(now + 60_000);
			await act(async () => {
				clock.mockReturnValue(now + 60_000);
				useToastStore.getState().pruneExpired();
				clock.mockReturnValue(now + 61_000);
				useToastStore.getState().pruneExpired();
			});
			expect(useToastStore.getState().toasts.some(item => item.id === notification?.id)).toBe(false);
			expect(useSessionStore.getState().retryInfo?.delayMs).toBe(delayMs);
			expect(document.body.textContent).toContain("Weekly quota exhausted");
		} finally {
			clock.mockRestore();
		}
	});

	it("drives the compaction row state across the maintenance window", async () => {
		const { emitBatch } = installMockOmp();
		await mount(<RpcEventsProbe />);

		await act(async () => {
			emitBatch([{ type: "auto_compaction_start", reason: "overflow", action: "compact" }]);
		});
		expect(useSessionStore.getState().isCompacting).toBe(true);
		expect(useSessionStore.getState().compactionInfo).toEqual({ reason: "overflow", action: "compact" });

		await act(async () => {
			emitBatch([
				{ type: "auto_compaction_end", action: "compact", result: null, aborted: false, willRetry: false },
			]);
		});
		expect(useSessionStore.getState().isCompacting).toBe(false);
		expect(useSessionStore.getState().compactionInfo).toBeNull();
	});

	it("keeps the marker through the user-prompt echo, clearing only on assistant message_end", async () => {
		const { emitBatch } = installMockOmp();
		await mount(<RpcEventsProbe />);

		// Wire order per agent-loop: turn_start → user echo (message_start/end)
		// → model wait → assistant stream → assistant message_end. Neither the
		// echo nor the assistant's empty-shell message_start may clear the row.
		await act(async () => {
			emitBatch([
				{ type: "agent_start", sessionId: "s1" },
				{ type: "turn_start" },
				{ type: "message_start", message: { role: "user", content: [], timestamp: Date.now() } },
				{ type: "message_end", message: { role: "user", content: [], timestamp: Date.now() } },
			]);
		});
		expect(useSessionStore.getState().awaitingModelSince).not.toBeNull();

		await act(async () => {
			emitBatch([{ type: "message_start", message: assistantMessage }]);
		});
		expect(useSessionStore.getState().awaitingModelSince).not.toBeNull();

		await act(async () => {
			emitBatch([{ type: "message_end", message: assistantMessage }]);
		});
		expect(useSessionStore.getState().awaitingModelSince).toBeNull();
	});

	it("arms the marker when attaching to an already-streaming session", async () => {
		const { omp } = installMockOmp();
		// Server reports a run already in flight at attach time — agent_start
		// was missed, so hydration must re-arm the status row (TUI guest-attach
		// parity).
		omp.rpc.getState.mockImplementation(async () =>
			success({
				sessionId: "s1",
				sessionName: null,
				sessionFile: null,
				cwd: "/tmp",
				isStreaming: true,
				isCompacting: false,
				contextUsage: null,
				messageCount: 3,
				queuedMessageCount: 0,
				planModeEnabled: false,
				todoPhases: [],
			}),
		);
		await mount(<RpcEventsProbe />);
		await flush();
		expect(useSessionStore.getState().isStreaming).toBe(true);
		expect(useSessionStore.getState().awaitingModelSince).not.toBeNull();
	});
});

describe("useRpcEvents todo lifecycle", () => {
	it("archives a todo tool result immediately without waiting for agent_end", async () => {
		const { emitBatch } = installMockOmp();
		await mount(<RpcEventsProbe />);
		await flush();
		const pending: TodoPhase[] = [{ name: "Build", tasks: [{ content: "scaffold", status: "pending" }] }];

		await act(async () => {
			emitBatch([
				{
					type: "tool_execution_end",
					toolCallId: "todo-1",
					toolName: "todo",
					result: {
						content: [{ type: "text", text: "Todo list updated" }],
						details: { op: "init", phases: pending, storage: "session" },
					},
					isError: false,
				},
			]);
		});

		const state = useTodoStore.getState();
		expect(state.phases[0]?.tasks[0]?.status).toBe("pending");
		expect(state.history).toHaveLength(1);
		expect(state.history[0]?.phases).toEqual(pending);
	});

	it("keeps one completed snapshot when automatic cleanup clears the live todos", async () => {
		const { emitBatch } = installMockOmp();
		await mount(<RpcEventsProbe />);
		useTodoStore.getState().reset();
		const pending: TodoPhase[] = [{ name: "Build", tasks: [{ content: "scaffold", status: "pending" }] }];
		const completed: TodoPhase[] = [{ name: "Build", tasks: [{ content: "scaffold", status: "completed" }] }];
		useTodoStore.getState().setPhases(pending);
		useTodoStore.getState().showReminder(completed[0]!.tasks);
		useTodoStore.getState().setPhases(completed);

		await act(async () => {
			emitBatch([{ type: "todo_auto_clear" }]);
		});

		const state = useTodoStore.getState();
		expect(state.phases).toEqual([]);
		expect(state.reminderVisible).toBe(false);
		expect(state.reminderTodos).toEqual([]);
		expect(state.history).toHaveLength(1);
		expect(state.history[0]?.phases[0]?.tasks[0]?.status).toBe("completed");
	});
});

describe("useRpcEvents non-transcript frames", () => {
	it("surfaces text-mode slash-command output as a local custom message", async () => {
		const { emitCommandOutput } = installMockOmp();
		await mount(<RpcEventsProbe />);

		await act(async () => {
			emitCommandOutput({ type: "command_output", text: "Enabled models: gpt-5.6" });
		});

		expect(useMessagesStore.getState().messages).toContainEqual(
			expect.objectContaining({
				role: "custom",
				customType: "command",
				content: [{ type: "text", text: "Enabled models: gpt-5.6" }],
			}),
		);
	});

	it("rehydrates when a deferred prompt result reports a local-only extension command", async () => {
		const { omp, emitPromptResult } = installMockOmp();
		await mount(<RpcEventsProbe />);
		const stateCallsBefore = omp.rpc.getState.mock.calls.length;
		const transcriptCallsBefore = omp.rpc.getTranscript.mock.calls.length;

		await act(async () => {
			emitPromptResult({ type: "prompt_result", id: "extension-command", agentInvoked: false });
			await Promise.resolve();
		});
		await flush();

		expect(omp.rpc.getState.mock.calls.length).toBeGreaterThan(stateCallsBefore);
		expect(omp.rpc.getTranscript.mock.calls.length).toBeGreaterThan(transcriptCallsBefore);
	});

	it("applies a model catalog completion frame without reopening the picker", async () => {
		const { emitModelCatalogUpdate } = installMockOmp();
		await mount(<RpcEventsProbe />);
		useModelStore.setState({ catalogRefreshPending: true, catalogGeneration: 1, availableModels: [] });

		await act(async () => {
			emitModelCatalogUpdate({
				type: "model_catalog_update",
				models: [{ provider: "custom", id: "new-model" }],
				providers: [],
				discoveryStates: [
					{ provider: "custom", status: "ok", optional: false, stale: false, models: ["new-model"] },
				],
				refreshPending: false,
				generation: 2,
			});
		});

		expect(useModelStore.getState()).toMatchObject({
			availableModels: [{ provider: "custom", id: "new-model" }],
			catalogRefreshPending: false,
			catalogGeneration: 2,
		});
	});

	it("drops session events while the selected tab and main-process route disagree", async () => {
		const { omp, emitCommandOutput } = installMockOmp();
		await mount(<RpcEventsProbe />);
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/beta", status: "ready", unreadDone: false },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		const route = Promise.withResolvers<boolean>();
		omp.tabs.setActive.mockReturnValueOnce(route.promise);

		const switching = useTabsStore.getState().switchTab("t1");
		await act(async () => {
			emitCommandOutput({ type: "command_output", text: "belongs to t0" });
		});
		expect(useMessagesStore.getState().messages).toEqual([]);

		route.resolve(true);
		await act(async () => switching);
		await act(async () => {
			emitCommandOutput({ type: "command_output", text: "belongs to t1" });
		});

		expect(useMessagesStore.getState().messages).toContainEqual(
			expect.objectContaining({ content: [{ type: "text", text: "belongs to t1" }] }),
		);
	});
});

describe("useRpcEvents mode-state sync", () => {
	it("keeps live goal and loop updates when older hydration replies arrive later", async () => {
		const { omp, emitBatch } = installMockOmp();
		await mount(<RpcEventsProbe />);
		await flush();
		const goal = Promise.withResolvers<RpcResponse>();
		const loop = Promise.withResolvers<RpcResponse>();
		omp.rpc.getGoal.mockReturnValueOnce(goal.promise);
		omp.rpc.getLoopMode.mockReturnValueOnce(loop.promise);
		const hydration = hydrateSession();
		await act(async () =>
			emitBatch([
				{ type: "goal_updated", goal: { objective: "new objective", status: "active" } },
				{ type: "loop_mode_update", state: { enabled: true, state: "waiting", prompt: "new loop" } },
			]),
		);
		goal.resolve(success({ enabled: false }));
		loop.resolve(success({ enabled: false, state: "off" }));
		await act(async () => hydration);
		expect(useSessionStore.getState().goal?.objective).toBe("new objective");
		expect(useSessionStore.getState().loopMode).toMatchObject({ enabled: true, prompt: "new loop" });
	});

	it("hydrates loop, vibe, and project-scoped display settings into the active tab", async () => {
		const { omp } = installMockOmp();
		// Loop/vibe aren't on the get_state wire — hydration must pull the
		// dedicated RPCs so composer chips and footer badges are right at boot.
		omp.rpc.getLoopMode.mockImplementation(async () =>
			success({
				enabled: true,
				state: "running",
				prompt: "keep going",
				limit: { kind: "iterations", initial: 10, remaining: 7 },
			}),
		);
		omp.rpc.getVibeMode.mockImplementation(async () => success({ enabled: true }));
		omp.rpc.getSettings.mockImplementation(async () =>
			success({
				values: {
					"display.showTokenUsage": false,
					"tools.approvalMode": "always-ask",
				},
			}),
		);
		await mount(<RpcEventsProbe />);
		await flush();

		expect(useSessionStore.getState().loopMode).toEqual({
			enabled: true,
			state: "running",
			prompt: "keep going",
			limit: { kind: "iterations", initial: 10, remaining: 7 },
		});
		expect(useSessionStore.getState().vibeModeEnabled).toBe(true);
		expect(useSettingsStore.getState().showTokenUsage).toBe(false);
		expect(useSettingsStore.getState().approvalMode).toBe("always-ask");
	});

	it("applies loop_mode_update frames to the session store, including disable", async () => {
		const { emitBatch } = installMockOmp();
		await mount(<RpcEventsProbe />);
		await flush();
		expect(useSessionStore.getState().loopMode).toEqual({ enabled: false, state: "off" });

		await act(async () => {
			emitBatch([
				{
					type: "loop_mode_update",
					state: { enabled: true, state: "waiting", prompt: "poll the queue" },
				},
			]);
		});
		expect(useSessionStore.getState().loopMode).toEqual({
			enabled: true,
			state: "waiting",
			prompt: "poll the queue",
		});

		// Auto-disable arrives as a frame too — the chip/badge must clear.
		await act(async () => {
			emitBatch([{ type: "loop_mode_update", state: { enabled: false, state: "off" } }]);
		});
		expect(useSessionStore.getState().loopMode).toEqual({ enabled: false, state: "off" });
	});
});

describe("retryPending reset on tab switch", () => {
	it("clears the auto-retry gate so the restored tab's failed turns still toast", async () => {
		const { emitBatch } = installMockOmp();
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/beta", status: "ready", unreadDone: false },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		useToastStore.setState({ toasts: [] });
		await mount(<RpcEventsProbe />);

		// Arm the retry gate on the outgoing tab: while it is set, agent_end
		// error toasts are suppressed as mid-saga noise.
		await act(async () => {
			emitBatch([
				{ type: "agent_start", sessionId: "s1" },
				{ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 5000, errorMessage: "boom" },
			]);
		});

		// The switch parks t0 and restores t1 — restoreBundle resets the gate,
		// which is module-level and would otherwise leak across tabs.
		await act(async () => {
			await useTabsStore.getState().switchTab("t1");
		});

		await act(async () => {
			emitBatch([
				{
					type: "agent_end",
					messages: [{ role: "assistant", content: [], timestamp: 1, stopReason: "error", errorMessage: "kaput" }],
				},
			]);
		});

		// The restored tab's failure surfaces; the leaked gate would have eaten it.
		expect(useToastStore.getState().toasts.some(toast => toast.title === "Turn failed")).toBe(true);

		useTabsStore.getState().reset();
		useToastStore.setState({ toasts: [] });
	});
});

describe("TurnStatusRow", () => {
	it("renders the waiting label with elapsed seconds and the interrupt hint", async () => {
		useSessionStore.setState({ awaitingModelSince: Date.now() - 5000 });
		await mount(<TurnStatusRow />);
		expect(document.body.textContent).toContain("Waiting for model response");
		expect(document.body.textContent).toContain("5s");
		expect(document.body.textContent).toContain("(press Esc to interrupt)");
		expect(document.body.textContent).not.toContain("Slow response");
	});

	it("escalates to the slow-response hint after 30s", async () => {
		useSessionStore.setState({ awaitingModelSince: Date.now() - 35_000 });
		await mount(<TurnStatusRow />);
		expect(document.body.textContent).toContain("35s");
		expect(document.body.textContent).toContain("Slow response");
	});

	it("escalates to the stalled-connection hint after 90s, replacing the generic interrupt hint", async () => {
		useSessionStore.setState({ awaitingModelSince: Date.now() - 95_000 });
		await mount(<TurnStatusRow />);
		expect(document.body.textContent).toContain("95s");
		// The stalled copy explains the ~5min watchdog + retry and names Esc
		// itself, so the generic interrupt hint would be redundant noise.
		expect(document.body.textContent).toContain("auto-times-out");
		expect(document.body.textContent).not.toContain("(press Esc to interrupt)");
	});

	it("renders the retry countdown with the failure detail", async () => {
		useSessionStore.setState({
			retryInfo: {
				attempt: 2,
				maxAttempts: 5,
				delayMs: 9000,
				errorMessage: "stream stalled",
				startedAt: Date.now(),
			},
		});
		await mount(<TurnStatusRow />);
		expect(document.body.textContent).toContain("Retrying (2/5) in 9s…");
		expect(document.body.textContent).toContain("stream stalled");
	});

	it("renders the in-flight retry once the delay elapses", async () => {
		useSessionStore.setState({
			retryInfo: {
				attempt: 2,
				maxAttempts: 5,
				delayMs: 9000,
				errorMessage: "stream stalled",
				startedAt: Date.now() - 10_000,
			},
		});
		await mount(<TurnStatusRow />);
		expect(document.body.textContent).toContain("Retrying (2/5)…");
		expect(document.body.textContent).not.toContain("in 9s");
	});

	it("renders the compaction loader with TUI reason/action text", async () => {
		useSessionStore.setState({ compactionInfo: { reason: "overflow", action: "handoff" } });
		await mount(<TurnStatusRow />);
		expect(document.body.textContent).toContain("Context overflow detected, Auto-handoff…");
	});
});

describe("hydrateSession streaming reconcile (F-HYDRATE)", () => {
	it("retains completed subtask history when switching back to the same session", async () => {
		installMockOmp();
		await hydrateSession();
		useSubagentsStore.getState().applyFrame({
			type: "subagent_lifecycle",
			payload: { id: "finished", index: 1, agent: "scout", agentSource: "bundled", status: "completed" },
		});
		await hydrateSession();
		expect(useSubagentsStore.getState().subagents.get("finished")?.status).toBe("completed");
	});

	it("discards an older hydration when a newer session finishes first", async () => {
		const { omp } = installMockOmp();
		const oldState = Promise.withResolvers<RpcResponse>();
		const oldTranscript = Promise.withResolvers<RpcResponse>();
		const oldGoal = Promise.withResolvers<RpcResponse>();
		const oldMessage: AgentMessage = {
			role: "assistant",
			content: [{ type: "text", text: "old transcript" }],
			timestamp: 1,
		};
		const newMessage: AgentMessage = {
			role: "assistant",
			content: [{ type: "text", text: "new transcript" }],
			timestamp: 2,
		};
		omp.rpc.getState.mockReturnValueOnce(oldState.promise).mockResolvedValue(
			success({
				sessionId: "new-session",
				sessionName: "New",
				sessionFile: "/new.jsonl",
				cwd: "/new",
				isStreaming: false,
				isCompacting: false,
				contextUsage: null,
				messageCount: 1,
				queuedMessageCount: 0,
				planModeEnabled: false,
				todoPhases: [],
			}),
		);
		omp.rpc.getTranscript
			.mockReturnValueOnce(oldTranscript.promise)
			.mockResolvedValue(success({ messages: [newMessage] }));
		omp.rpc.getGoal.mockReturnValueOnce(oldGoal.promise).mockResolvedValue(success({ enabled: false }));

		const olderHydration = hydrateSession();
		await hydrateSession();
		oldState.resolve(
			success({
				sessionId: "old-session",
				sessionName: "Old",
				sessionFile: "/old.jsonl",
				cwd: "/old",
				isStreaming: false,
				isCompacting: false,
				contextUsage: null,
				messageCount: 1,
				queuedMessageCount: 0,
				planModeEnabled: false,
				todoPhases: [],
			}),
		);
		oldTranscript.resolve(success({ messages: [oldMessage] }));
		oldGoal.resolve(success({ enabled: true, objective: "old goal", status: "active" }));
		await olderHydration;

		expect(useSessionStore.getState().sessionId).toBe("new-session");
		expect(useSessionStore.getState().goal).toBeNull();
		expect(useMessagesStore.getState().messages).toEqual([newMessage]);
	});

	it("paints the core transcript before slower subagent and secondary hydration settles", async () => {
		const { omp } = installMockOmp();
		const subagents = Promise.withResolvers<RpcResponse>();
		const goal = Promise.withResolvers<RpcResponse>();
		const hydrated: AgentMessage = {
			role: "assistant",
			content: [{ type: "text", text: "new session transcript" }],
			timestamp: 2,
		};
		omp.rpc.getTranscript.mockResolvedValue(success({ messages: [hydrated] }));
		omp.rpc.getSubagents.mockReturnValue(subagents.promise);
		omp.rpc.getGoal.mockReturnValue(goal.promise);
		const transcriptPainted = Promise.withResolvers<void>();
		const unsubscribe = useMessagesStore.subscribe(state => {
			if (state.messages.length === 1 && state.messages[0] === hydrated) transcriptPainted.resolve();
		});

		let settled = false;
		const hydration = hydrateSession().then(() => {
			settled = true;
		});
		await transcriptPainted.promise;
		unsubscribe();
		expect(useMessagesStore.getState().messages).toEqual([hydrated]);

		expect(settled).toBe(false);
		subagents.resolve(success({ subagents: [] }));
		goal.resolve(success({ enabled: false }));
		await hydration;
	});

	it("clears the stale streaming bubble when the hydrated tab has settled", async () => {
		const { omp } = installMockOmp();
		const optimistic: AgentMessage = {
			role: "user",
			content: "locally visible before RPC accepts it",
			timestamp: 1,
			optimistic: true,
		};
		const staleLive: AgentMessage = {
			role: "assistant",
			content: [{ type: "text", text: "stale live reply" }],
			timestamp: 1,
		};
		const finalized: AgentMessage = {
			role: "assistant",
			content: [{ type: "text", text: "settled reply" }],
			timestamp: 2,
		};
		// Zombie state: the tab's run settled in the background, so its
		// message_end/agent_end never forwarded — the restored bundle still
		// carries the mid-run slice while the transcript holds the final text.
		useMessagesStore.setState({
			messages: [],
			liveMessages: [optimistic, staleLive],
			streamingMessage: assistantMessage,
			streamingText: "partial reply",
			streamingThinking: "partial thinking",
		});
		omp.rpc.getTranscript.mockResolvedValue(success({ messages: [finalized] }));

		await hydrateSession();

		const messages = useMessagesStore.getState();
		expect(messages.streamingMessage).toBeNull();
		expect(messages.streamingText).toBe("");
		expect(messages.streamingThinking).toBe("");
		expect(messages.liveMessages).toEqual([optimistic]);
		// The finalized content arrives via the transcript merge, not the bubble.
		expect(messages.messages).toEqual([finalized]);
		// Hydrate re-asserts the per-tab subagent subscription (switch-in path).
		expect(omp.rpc.setSubagentSubscription).toHaveBeenCalledWith("events");
	});

	it("does not clear live deliveries that arrived after an idle hydration began", async () => {
		const { omp } = installMockOmp();
		const transcript = Promise.withResolvers<RpcResponse>();
		omp.rpc.getTranscript.mockReturnValue(transcript.promise);
		const hydration = hydrateSession();
		const delivered: AgentMessage = { role: "user", content: "new run", timestamp: 3 };
		useMessagesStore.getState().applyEvents([{ type: "message_end", message: delivered }]);

		transcript.resolve(success({ messages: [] }));
		await hydration;

		expect(useMessagesStore.getState().liveMessages).toEqual([delivered]);
	});

	it("keeps the live stream while the hydrated tab is still streaming", async () => {
		const { omp } = installMockOmp();
		omp.rpc.getState.mockImplementation(async () =>
			success({
				sessionId: "s1",
				sessionName: null,
				sessionFile: null,
				cwd: "/tmp",
				isStreaming: true,
				isCompacting: false,
				contextUsage: null,
				messageCount: 3,
				queuedMessageCount: 0,
				planModeEnabled: false,
				todoPhases: [],
			}),
		);
		useMessagesStore.setState({
			streamingMessage: assistantMessage,
			streamingText: "partial reply",
			streamingThinking: "partial thinking",
		});

		await hydrateSession();

		// Mid-run attach: live deltas resume onto the restored buffers, so the
		// streaming slice must survive hydration untouched.
		const messages = useMessagesStore.getState();
		expect(messages.streamingMessage).toBe(assistantMessage);
		expect(messages.streamingText).toBe("partial reply");
		expect(messages.streamingThinking).toBe("partial thinking");
		expect(omp.rpc.setSubagentSubscription).toHaveBeenCalledWith("events");
	});
});

describe("useRpcEvents tab-scoped routing guards", () => {
	function seedTwoTabs(): void {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t-live", cwd: "/alpha", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t-dead", cwd: "/beta", status: "ready", unreadDone: false },
			],
			activeTabId: "t-live",
		});
		ensureTabRuntime("t-live");
		ensureTabRuntime("t-dead");
		setFocusedSessionRuntime("t-live");
	}

	it("refreshes automatic compaction without letting its delayed snapshot erase resumed work", async () => {
		const { emitTabBatch, commandForTab } = installTabRoutedMockOmp();
		seedTwoTabs();
		await mount(<RpcEventsProbe />);
		const transcript = Promise.withResolvers<RpcResponse>();
		const original = commandForTab.getMockImplementation()!;
		commandForTab.mockImplementation((tabId, command) =>
			command.type === "get_transcript" ? transcript.promise : original(tabId, command),
		);
		const shell: AgentMessage = { role: "assistant", content: [], timestamp: 100 };
		await act(async () => {
			emitTabBatch(
				[
					{ type: "auto_compaction_start", reason: "threshold", action: "compact" },
					{ type: "auto_compaction_end", action: "compact", result: {}, aborted: false, willRetry: false },
					{ type: "agent_start" },
					{ type: "message_start", message: shell },
					{
						type: "message_update",
						message: shell,
						assistantMessageEvent: {
							type: "text_delta",
							contentIndex: 0,
							delta: "Resumed reply",
							partial: shell,
						},
					},
					{
						type: "tool_execution_start",
						toolCallId: "resumed-tool",
						toolName: "read",
						args: { path: "src/current.ts" },
					},
				],
				"t-live",
			);
		});
		const compacted: AgentMessage = {
			role: "compactionSummary",
			summary: "Compacted history",
			content: "",
			entryId: "compacted",
			timestamp: 50,
		};
		transcript.resolve(success({ messages: [compacted] }));
		await flush();
		expect(useMessagesStore.getState().messages).toEqual([compacted]);
		expect(useMessagesStore.getState().streamingText).toBe("Resumed reply");
		expect(useSessionStore.getState()).toMatchObject({ isStreaming: true, isCompacting: false });
		expect(useToolsStore.getState().activeTools.get("resumed-tool")?.status).toBe("running");
	});

	it("drops in-flight event batches for a closed tab instead of polluting the focused pane", async () => {
		const { emitTabBatch, notify } = installTabRoutedMockOmp();
		seedTwoTabs();
		await mount(<RpcEventsProbe />);
		await act(async () => {
			await useTabsStore.getState().closeTab("t-dead");
		});

		await act(async () => {
			emitTabBatch(
				[
					{ type: "agent_start" } as AgentSessionEvent,
					{ type: "agent_end", messages: [], isTerminal: true } as AgentSessionEvent,
				],
				"t-dead",
			);
		});

		// No ghost runtime resurrection for the closed tab…
		expect(sessionRuntime("t-dead")).toBeNull();
		// …no completion notification for a tab the user closed…
		expect(notify).not.toHaveBeenCalled();
		// …and the live pane's stores are untouched by the dead tab's frames.
		expect(sessionRuntimeStore<MessagesStore>("t-live", "messages")?.getState().messages).toHaveLength(0);
		expect(sessionRuntimeStore<SessionStore>("t-live", "session")?.getState().isStreaming).toBe(false);
	});

	it("ignores a closed tab's late 'starting' status instead of resetting the focused pane", async () => {
		const { emitTabStatus } = installTabRoutedMockOmp();
		seedTwoTabs();
		await mount(<RpcEventsProbe />);
		await flush();
		// Append AFTER boot hydration — hydrate's transcript reconcile replaces
		// the message list, so seeding earlier would not survive mount.
		const kept = {
			role: "user",
			content: [{ type: "text", text: "keep me" }],
			timestamp: 1,
		} as AgentMessage;
		sessionRuntimeStore<MessagesStore>("t-live", "messages")?.getState().appendMessage(kept);
		await act(async () => {
			await useTabsStore.getState().closeTab("t-dead");
		});

		await act(async () => {
			emitTabStatus({ status: "starting", cwd: "/beta" } as IpcSidecarStatusPayload, "t-dead");
		});

		// Without the tombstone gate this frame falls through to the focused
		// runtime and resets its stores wholesale.
		expect(sessionRuntimeStore<MessagesStore>("t-live", "messages")?.getState().messages).toContain(kept);
	});
});
