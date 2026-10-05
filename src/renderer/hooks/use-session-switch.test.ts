/**
 * switchSessionNow F-OWN owner-guard contract tests: a session already
 * attached to a tab routes to the owner (switch in-window / focus the foreign
 * window) instead of double-attaching; main's raced refusal
 * (session_owned_elsewhere) routes via the error payload; ordinary failures
 * still toast.
 *
 * Harness: linkedom globals (hydrateSession's store graph expects them) +
 * a mocked window.omp, same shape as tabs.test.tsx.
 */

import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { IpcSessionOwner, SessionInfo } from "../../shared/ipc-types";
import type { RpcResponse, RpcSessionState } from "../../shared/rpc-types";
import { useComposerStore } from "../stores/composer";
import { useForkHandoffStore } from "../stores/fork-handoff";
import { useMessagesStore } from "../stores/messages";
import { useModelStore } from "../stores/model";
import { usePlanApprovalStore } from "../stores/plan-approval";
import { useQueueStore } from "../stores/queue";
import { useSessionStore } from "../stores/session";
import { useSubagentsStore } from "../stores/subagents";
import { useTabsStore } from "../stores/tabs";
import { useToastStore } from "../stores/toast";
import { useTodoStore } from "../stores/todo";
import { useToolsStore } from "../stores/tools";
import { useUiStore } from "../stores/ui";
import { dropSessionNow, newSessionNow, switchSessionNow } from "./use-session-switch";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;

function ok(data: unknown): RpcResponse {
	return { type: "response", command: "test", success: true, data };
}

function serverState(overrides: Partial<RpcSessionState> = {}): RpcSessionState {
	return {
		sessionId: "srv",
		sessionName: null,
		sessionFile: null,
		cwd: "/srv",
		isStreaming: false,
		isCompacting: false,
		contextUsage: null,
		messageCount: 0,
		queuedMessageCount: 0,
		planModeEnabled: false,
		todoPhases: [],
		...overrides,
	} as RpcSessionState;
}

function session(path: string): SessionInfo {
	return {
		path,
		id: path,
		title: "Session X",
		cwd: "/srv",
		created: "2026-01-01T00:00:00Z",
		modified: "2026-01-01T00:00:00Z",
		messageCount: 3,
		size: 100,
		status: "complete",
		firstMessage: "hello",
	};
}

interface MockOmp {
	tabs: {
		getSessionOwner: Mock<(sessionPath: string) => Promise<IpcSessionOwner | null>>;
		setActive: Mock<(tabId: string) => Promise<boolean>>;
		spawn: Mock<
			(payload: { cwd?: string; sessionPath?: string; kind?: "chat" | "agent" }) => Promise<{ tabId: string } | null>
		>;
	};
	sessions: {
		openInNewWindow: Mock<(payload: { sessionPath?: string; cwd?: string }) => Promise<boolean>>;
	};
	rpc: {
		dropSession: Mock<() => Promise<RpcResponse>>;
		newSession: Mock<() => Promise<RpcResponse>>;
		getState: Mock<() => Promise<RpcResponse>>;
		getTranscript: Mock<() => Promise<RpcResponse>>;
		getSubagents: Mock<() => Promise<RpcResponse>>;
		getGoal: Mock<() => Promise<RpcResponse>>;
		getLoopMode: Mock<() => Promise<RpcResponse>>;
		getVibeMode: Mock<() => Promise<RpcResponse>>;
		getQueue: Mock<() => Promise<RpcResponse>>;
		switchSession: Mock<(sessionPath: string, model?: { provider: string; modelId: string }) => Promise<RpcResponse>>;
		setSubagentSubscription: Mock<(level: string) => Promise<RpcResponse>>;
	};
}

function installMockOmp(): MockOmp {
	const omp: MockOmp = {
		tabs: {
			getSessionOwner: vi.fn(async () => null),
			setActive: vi.fn(async () => true),
			spawn: vi.fn(async () => ({ tabId: "t-spawned" })),
		},
		sessions: {
			openInNewWindow: vi.fn(async () => true),
		},
		rpc: {
			dropSession: vi.fn(async () => ok({ cancelled: false })),
			newSession: vi.fn(async () => ok({ cancelled: false })),
			getState: vi.fn(async () => ok(serverState())),
			getTranscript: vi.fn(async () => ok({ messages: [] })),
			getSubagents: vi.fn(async () => ok({ subagents: [] })),
			getGoal: vi.fn(async () => ok({ enabled: false })),
			getLoopMode: vi.fn(async () => ok({ enabled: false, state: "off" })),
			getVibeMode: vi.fn(async () => ok({ enabled: false })),
			getQueue: vi.fn(async () => ok({ steering: [], followUp: [] })),
			switchSession: vi.fn(async () => ok({})),
			setSubagentSubscription: vi.fn(async () => ok({})),
		},
	};
	(window as unknown as { omp: MockOmp }).omp = omp;
	return omp;
}

/** Two tabs: t0 active, t1 background. */
function seedTabs(): void {
	useTabsStore.setState({
		tabs: [
			{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
			{ kind: "agent", id: "t1", cwd: "/beta", status: "ready", unreadDone: false },
		],
		activeTabId: "t0",
		bundles: new Map(),
	});
}

function resetAll(): void {
	useTabsStore.getState().reset();
	useComposerStore.getState().reset();
	useSessionStore.getState().reset();
	useMessagesStore.getState().reset();
	useTodoStore.getState().reset();
	useQueueStore.setState({ steering: [], followUp: [] });
	useSubagentsStore.getState().reset();
	useModelStore.getState().reset();
	useToolsStore.getState().reset();
	usePlanApprovalStore.getState().clearProposal();
	useUiStore.getState().closeSessionOverlays();
	useForkHandoffStore.getState().closeHandoffDialog();
	useToastStore.setState({ toasts: [] });
}

let omp: MockOmp;

afterEach(() => {
	resetAll();
	vi.restoreAllMocks();
	omp = installMockOmp();
});

omp = installMockOmp();

describe("switchSessionNow F-OWN owner guard", () => {
	it("clears old todo history and agents before a successful new session hydrates", async () => {
		useTodoStore.getState().setPhases([{ name: "old phase", tasks: [] }]);
		useTodoStore.getState().setPhases([{ name: "old updated phase", tasks: [] }]);
		useSubagentsStore.setState({
			subagents: new Map([
				["old-agent", { id: "old-agent", index: 0, agent: "task", status: "completed", lastUpdate: 1 }],
			]),
		});
		omp.rpc.getState.mockResolvedValue(ok(serverState({ sessionId: "fresh" })));

		await newSessionNow();

		expect(useTodoStore.getState()).toMatchObject({ phases: [], history: [], historyHydrated: true });
		expect(useSubagentsStore.getState().subagents.size).toBe(0);
		expect(useSessionStore.getState().sessionId).toBe("fresh");
	});

	it("preserves the old surface when a new-session hook cancels the transition", async () => {
		useTodoStore.getState().setPhases([{ name: "old phase", tasks: [] }]);
		useSubagentsStore.setState({
			subagents: new Map([
				["old-agent", { id: "old-agent", index: 0, agent: "task", status: "completed", lastUpdate: 1 }],
			]),
		});
		omp.rpc.newSession.mockResolvedValue(ok({ cancelled: true }));

		await newSessionNow();

		expect(useTodoStore.getState().phases).toHaveLength(1);
		expect(useSubagentsStore.getState().subagents.has("old-agent")).toBe(true);
		expect(omp.rpc.getState).not.toHaveBeenCalled();
	});

	it("clears the attached task before projecting its replacement after deletion", async () => {
		useMessagesStore.setState({ messages: [{ id: "old-message", role: "user", content: "old" }] });
		useSubagentsStore.setState({
			subagents: new Map([
				["old-agent", { id: "old-agent", index: 0, agent: "task", status: "completed", lastUpdate: 1 }],
			]),
		});
		omp.rpc.getState.mockResolvedValue(ok(serverState({ sessionId: "replacement" })));

		await dropSessionNow();

		expect(omp.rpc.dropSession).toHaveBeenCalledOnce();
		expect(useMessagesStore.getState().messages).toEqual([]);
		expect(useSubagentsStore.getState().subagents.size).toBe(0);
		expect(useSessionStore.getState().sessionId).toBe("replacement");
	});

	it("routes to the owning tab in this window without issuing switch_session", async () => {
		seedTabs();
		omp.tabs.getSessionOwner.mockResolvedValue({ tabId: "t1", winId: 1 });

		const result = await switchSessionNow(session("/sessions/x.jsonl"));

		expect(result).toBe(true);
		expect(omp.tabs.getSessionOwner).toHaveBeenCalledWith("/sessions/x.jsonl");
		expect(omp.rpc.switchSession).not.toHaveBeenCalled();
		// Routed via switchTab: SET_ACTIVE_TAB fired and the tab is foreground.
		expect(omp.tabs.setActive).toHaveBeenCalledWith("t1");
		expect(useTabsStore.getState().activeTabId).toBe("t1");
		expect(useToastStore.getState().toasts).toEqual([]);
	});

	it("focuses the foreign owner window instead of attaching", async () => {
		seedTabs();
		omp.tabs.getSessionOwner.mockResolvedValue({ tabId: "zz", winId: 9 });
		omp.sessions.openInNewWindow.mockResolvedValue(true);

		const result = await switchSessionNow(session("/sessions/x.jsonl"));

		expect(result).toBe(true);
		expect(omp.sessions.openInNewWindow).toHaveBeenCalledWith({ sessionPath: "/sessions/x.jsonl" });
		expect(omp.rpc.switchSession).not.toHaveBeenCalled();
		expect(omp.tabs.setActive).not.toHaveBeenCalled();
		expect(useTabsStore.getState().activeTabId).toBe("t0");
	});

	it("switches in place when no tab owns the session", async () => {
		seedTabs();
		omp.tabs.getSessionOwner.mockResolvedValue(null);

		const result = await switchSessionNow(session("/sessions/x.jsonl"));

		expect(result).toBe(true);
		expect(omp.rpc.switchSession).toHaveBeenCalledWith("/sessions/x.jsonl");
		// The existing flow hydrated after the switch.
		expect(omp.rpc.getState).toHaveBeenCalled();
		expect(omp.tabs.setActive).not.toHaveBeenCalled();
	});

	it("keeps the outgoing transcript painted until hydrate commits the next session", async () => {
		seedTabs();
		useComposerStore.setState({
			draft: "old draft",
			images: [{ content: { type: "image", data: "old-image", mimeType: "image/png" }, preview: "old-preview" }],
		});
		useMessagesStore.setState({
			messages: [{ role: "user", content: [{ type: "text", text: "old session" }], timestamp: 1 }],
			totalMessages: 1,
		});
		useToolsStore.setState({
			activeTools: new Map([
				[
					"old-tool",
					{
						toolName: "read",
						args: {},
						status: "done",
						partialResult: null,
						streamingArgs: "",
						result: null,
						isError: false,
						startTime: 1,
						endTime: 2,
					},
				],
			]),
		});
		useSubagentsStore.setState({
			subagents: new Map([
				["old-agent", { id: "old-agent", index: 0, agent: "explore", status: "completed", lastUpdate: 1 }],
			]),
		});
		useQueueStore.setState({
			steering: [{ id: "old-queue", text: "old follow-up", editable: true, timestamp: 1 }],
			followUp: [],
		});
		useTodoStore.getState().setPhases([{ name: "old phase", tasks: [] }]);
		useModelStore.setState({ model: { provider: "old", id: "old-model" } });
		usePlanApprovalStore.getState().showProposal({
			planFilePath: "/old-plan.md",
			planContent: "old plan",
			options: ["execute"],
		});
		useUiStore.getState().openContextReport();
		useForkHandoffStore.getState().openHandoffDialog();
		useSessionStore.setState({
			goal: { objective: "old goal" },
			loopMode: { enabled: true, state: "running" },
			vibeModeEnabled: true,
		});
		const transcript = Promise.withResolvers<RpcResponse>();
		const transcriptStarted = Promise.withResolvers<void>();
		omp.rpc.getTranscript.mockImplementation(() => {
			transcriptStarted.resolve();
			return transcript.promise;
		});

		const switching = switchSessionNow(session("/sessions/x.jsonl"));
		await transcriptStarted.promise;

		expect(useMessagesStore.getState().messages).toHaveLength(1);
		expect(useSessionStore.getState().switchPending).toEqual({
			fromId: useSessionStore.getState().sessionId,
			toId: "/sessions/x.jsonl",
		});

		transcript.resolve(ok({ messages: [] }));
		await expect(switching).resolves.toBe(true);
		expect(useMessagesStore.getState().messages).toEqual([]);
		expect(useSessionStore.getState().switchPending).toBeNull();
	});

	it("routes a raced session_owned_elsewhere refusal to the payload owner", async () => {
		seedTabs();
		// Pre-check saw no owner, but a parallel attach won the race → main refuses.
		omp.tabs.getSessionOwner.mockResolvedValue(null);
		omp.rpc.switchSession.mockResolvedValue({
			type: "response",
			command: "switch_session",
			success: false,
			error: "Session is already open in another tab",
			code: "session_owned_elsewhere",
			data: { ownerTabId: "t1", ownerWinId: 1 },
		});

		const result = await switchSessionNow(session("/sessions/x.jsonl"));

		expect(result).toBe(true);
		expect(omp.tabs.setActive).toHaveBeenCalledWith("t1");
		expect(useTabsStore.getState().activeTabId).toBe("t1");
		// The refusal is a routing signal, not a failure — no error toast.
		expect(useToastStore.getState().toasts).toEqual([]);
	});

	it("ignores a failed owner pre-check and lets main be the backstop", async () => {
		seedTabs();
		omp.tabs.getSessionOwner.mockRejectedValue(new Error("ipc down"));

		const result = await switchSessionNow(session("/sessions/x.jsonl"));

		expect(result).toBe(true);
		expect(omp.rpc.switchSession).toHaveBeenCalledWith("/sessions/x.jsonl");
	});

	it("keeps ordinary switch failures as error toasts", async () => {
		seedTabs();
		omp.rpc.switchSession.mockResolvedValue({
			type: "response",
			command: "switch_session",
			success: false,
			error: "boom",
		});

		const result = await switchSessionNow(session("/sessions/x.jsonl"));

		expect(result).toBe(false);
		expect(useToastStore.getState().toasts.some(toast => toast.variant === "error")).toBe(true);
	});

	it("keeps the outgoing transcript when switch_session fails", async () => {
		seedTabs();
		const kept = { role: "user" as const, content: "stay", timestamp: 1 };
		useMessagesStore.setState({ messages: [kept], totalMessages: 1 });
		omp.rpc.switchSession.mockResolvedValue({
			type: "response",
			command: "switch_session",
			success: false,
			error: "boom",
		});

		await switchSessionNow(session("/sessions/x.jsonl"));

		expect(useMessagesStore.getState().messages).toEqual([kept]);
		expect(useSessionStore.getState().switchPending).toBeNull();
	});

	it("surfaces a cross-kind switch as an error toast without switching (session_kind_mismatch)", async () => {
		seedTabs();
		omp.rpc.switchSession.mockResolvedValue({
			type: "response",
			command: "switch_session",
			success: false,
			error: "Cannot switch from agent session to chat session. Open the target session in a new tab instead.",
			code: "session_kind_mismatch",
		});

		const result = await switchSessionNow(session("/sessions/chat.jsonl"));

		expect(result).toBe(false);
		expect(useToastStore.getState().toasts.some(toast => toast.variant === "error")).toBe(true);
		// No routing side-effects: the kind guard never defers to an owner or a new window.
		expect(omp.tabs.setActive).not.toHaveBeenCalled();
		expect(omp.sessions.openInNewWindow).not.toHaveBeenCalled();
	});

	it("opens a chat session in a new chat tab instead of switching the agent tab onto it", async () => {
		seedTabs();

		const result = await switchSessionNow({ ...session("/sessions/chat.jsonl"), kind: "chat" });

		expect(result).toBe(true);
		// Cross-kind: never a switch_session on the agent tab — a NEW chat tab instead.
		expect(omp.rpc.switchSession).not.toHaveBeenCalled();
		expect(omp.tabs.spawn).toHaveBeenCalledWith(
			expect.objectContaining({ sessionPath: "/sessions/chat.jsonl", kind: "chat" }),
		);
	});

	it("opens an agent session in a new agent tab when the active tab is chat", async () => {
		useTabsStore.setState({
			tabs: [{ kind: "chat", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false }],
			activeTabId: "t0",
			bundles: new Map(),
		});

		const result = await switchSessionNow(session("/sessions/agent.jsonl"));

		expect(result).toBe(true);
		expect(omp.rpc.switchSession).not.toHaveBeenCalled();
		expect(omp.tabs.spawn).toHaveBeenCalledWith(
			expect.objectContaining({ sessionPath: "/sessions/agent.jsonl", kind: "agent" }),
		);
	});

	it("offers the model-restore dialog instead of a toast when the saved model is unavailable", async () => {
		seedTabs();
		omp.rpc.switchSession.mockResolvedValue({
			type: "response",
			command: "switch_session",
			success: false,
			error: "Could not restore model gone/model-x",
		});

		const result = await switchSessionNow(session("/sessions/x.jsonl"));

		expect(result).toBe(false);
		expect(useUiStore.getState().modelRestorePrompt).toEqual({
			session: session("/sessions/x.jsonl"),
			missingModel: "gone/model-x",
		});
		expect(useToastStore.getState().toasts).toEqual([]);
		expect(useSessionStore.getState().switchPending).toBeNull();
	});

	it("binds the session to an explicit model and toasts if that still fails", async () => {
		seedTabs();
		const target = session("/sessions/x.jsonl");
		const model = { provider: "anthropic", modelId: "claude-opus" };

		await expect(switchSessionNow(target, model)).resolves.toBe(true);
		expect(omp.rpc.switchSession).toHaveBeenCalledWith("/sessions/x.jsonl", model);

		omp.rpc.switchSession.mockResolvedValue({
			type: "response",
			command: "switch_session",
			success: false,
			error: "Could not restore model gone/model-x",
		});
		await expect(switchSessionNow(target, model)).resolves.toBe(false);
		// No dialog loop: an explicit binding that fails is an ordinary error.
		expect(useUiStore.getState().modelRestorePrompt).toBeNull();
		expect(useToastStore.getState().toasts.some(toast => toast.variant === "error")).toBe(true);
	});

	it("switches in place when the file kind matches the active tab", async () => {
		seedTabs();

		const result = await switchSessionNow(session("/sessions/agent.jsonl"));

		expect(result).toBe(true);
		expect(omp.rpc.switchSession).toHaveBeenCalledWith("/sessions/agent.jsonl");
		expect(omp.tabs.spawn).not.toHaveBeenCalled();
	});
});
