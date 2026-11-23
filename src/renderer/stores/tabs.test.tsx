/**
 * tabs store contract tests:
 * - boot GET_TABS reconciliation (initial sidecar = tab 0, never duplicated)
 * - switchTab snapshots the current tab's session-scoped slices (messages,
 *   session meta, todos, subagents, queue, model, composer draft), restores
 *   the target's bundle for instant paint, fires SET_ACTIVE_TAB BEFORE
 *   hydrate, then hydrates from the target sidecar
 * - closeTab keeps ≥1 tab and activates a neighbor when the active tab closes
 * - applyTabStatus stamps unreadDone on background run completion
 * - useSessionTabs completes the open-in-new-tab flow (pending session path
 *   applied on the tab's first ready push while active)
 *
 * Harness: linkedom + react-dom (same as use-rpc-events.test.tsx) — the hook
 * test needs React; store tests just reuse the globals.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { IpcSpawnTabPayload, IpcSpawnTabResult, IpcTabInfo, IpcTabStatusPayload } from "../../shared/ipc-types";
import type {
	AgentMessage,
	ModelInfo,
	RpcResponse,
	RpcSessionState,
	SubagentSnapshot,
	TodoPhase,
} from "../../shared/rpc-types";
import { acceptsActiveTabEvents } from "../lib/tab-routing";
import { tabSignalPresentation } from "../lib/tab-signal";
import { useComposerStore } from "./composer";
import { useExtensionUiStore } from "./extension-ui";
import { useForkHandoffStore } from "./fork-handoff";
import { useMessagesStore } from "./messages";
import { useModelStore } from "./model";
import { usePlanApprovalStore } from "./plan-approval";
import { useQueueStore } from "./queue";
import { type SessionStore, useSessionStore } from "./session";
import { sessionRuntime, sessionRuntimeStore, setFocusedSessionRuntime } from "./session-runtime-context";
import { useSubagentsStore } from "./subagents";
import { ensureTabRuntime } from "./tab-runtime";
import {
	cycleTab,
	isTabClosed,
	moveActiveTab,
	pushTabExtensionUiRequest,
	restoreTabComposer,
	type SessionTab,
	type SplitLayout,
	selectTabAt,
	settleTabPlanApproval,
	tabChipLabel,
	tabDisplayTitle,
	useSessionTabs,
	useTabsStore,
} from "./tabs";
import { useToastStore } from "./toast";
import { useTodoStore } from "./todo";
import { useToolsStore } from "./tools";
import { useUiStore } from "./ui";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

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

function msg(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 } as AgentMessage;
}

function tabInfo(tabId: string, cwd: string, status: IpcTabInfo["status"] = "ready"): IpcTabInfo {
	return { tabId, cwd, status, kind: "agent" };
}

interface MockOmp {
	tabs: {
		list: Mock<() => Promise<IpcTabInfo[]>>;
		spawn: Mock<(payload: IpcSpawnTabPayload) => Promise<IpcSpawnTabResult | null>>;
		close: Mock<(tabId: string) => Promise<boolean>>;
		setActive: Mock<(tabId: string) => Promise<boolean>>;
		setView: Mock<(tabId: string, visibleTabIds: string[], groups?: SplitLayout[]) => Promise<boolean>>;
		setOrder: Mock<(tabIds: string[]) => Promise<boolean>>;
	};
	events: {
		onTabStatus: Mock<(callback: (payload: IpcTabStatusPayload) => void) => () => void>;
	};
	rpc: {
		getState: Mock<() => Promise<RpcResponse>>;
		getTranscript: Mock<() => Promise<RpcResponse>>;
		getSubagents: Mock<() => Promise<RpcResponse>>;
		getGoal: Mock<() => Promise<RpcResponse>>;
		getLoopMode: Mock<() => Promise<RpcResponse>>;
		getVibeMode: Mock<() => Promise<RpcResponse>>;
		getQueue: Mock<() => Promise<RpcResponse>>;
		switchSession: Mock<(sessionPath: string) => Promise<RpcResponse>>;
		setSubagentSubscription: Mock<(level: string) => Promise<RpcResponse>>;
	};
}

type TabStatusHandler = (payload: IpcTabStatusPayload) => void;

function installMockOmp(): { omp: MockOmp; emitTabStatus: TabStatusHandler } {
	let tabStatusHandler: TabStatusHandler = () => {};
	const omp: MockOmp = {
		tabs: {
			list: vi.fn(async () => []),
			spawn: vi.fn(async () => null),
			close: vi.fn(async () => true),
			setActive: vi.fn(async () => true),
			setView: vi.fn(async () => true),
			setOrder: vi.fn(async () => true),
		},
		events: {
			onTabStatus: vi.fn((callback: TabStatusHandler) => {
				tabStatusHandler = callback;
				return () => {};
			}),
		},
		rpc: {
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
	return { omp, emitTabStatus: payload => tabStatusHandler(payload) };
}

/** Seed two tabs without going through spawn: t0 active, t1 background. */
function seedTabs(active: "t0" | "t1" | "t2" = "t0"): void {
	useTabsStore.setState({
		tabs: [
			{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
			{ kind: "agent", id: "t1", cwd: "/beta", status: "ready", unreadDone: false },
			{ kind: "agent", id: "t2", cwd: "/gamma", status: "ready", unreadDone: false },
		],
		activeTabId: active,
		bundles: new Map(),
	});
	for (const tabId of ["t0", "t1", "t2"]) ensureTabRuntime(tabId);
	setFocusedSessionRuntime(active);
}

/** Fill the live stores with t0's recognizable session state. */
function fillLiveStores(tag: string): void {
	useSessionStore.setState({
		sessionId: `s-${tag}`,
		sessionName: `Session ${tag}`,
		cwd: `/${tag}`,
		isStreaming: false,
		status: "ready",
		planModeEnabled: true,
		goal: { objective: `goal-${tag}` },
	});
	useMessagesStore.setState({ messages: [msg(`hello-${tag}`)], totalMessages: 1 });
	useTodoStore.getState().setPhases([{ name: `phase-${tag}`, tasks: [] } as TodoPhase]);
	useQueueStore.setState({
		steering: [{ id: `q-${tag}`, text: `steer-${tag}`, editable: true, timestamp: 1 }],
		followUp: [],
	});
	useSubagentsStore.setState({
		subagents: new Map<string, SubagentSnapshot>([
			[`a-${tag}`, { id: `a-${tag}`, index: 1, agent: "worker", status: "running", lastUpdate: 1, kind: "sub" }],
		]),
	});
	useModelStore.setState({
		model: { provider: "p", id: `m-${tag}` } as ModelInfo,
		fastModeEnabled: true,
	});
	useComposerStore.getState().setDraft(`draft-${tag}`);
	useComposerStore
		.getState()
		.setImages([
			{ content: { type: "image", data: `image-${tag}`, mimeType: "image/png" }, preview: `preview-${tag}` },
		]);
	usePlanApprovalStore.getState().showProposal({
		planFilePath: `/plan-${tag}.md`,
		planContent: `plan-${tag}`,
		options: ["execute"],
	});
	usePlanApprovalStore.getState().setFeedback(`feedback-${tag}`);
	useExtensionUiStore.getState().pushRequest({
		type: "extension_ui_request",
		id: `ui-${tag}`,
		method: "confirm",
		title: `Confirm ${tag}`,
		message: `Message ${tag}`,
	});
	useExtensionUiStore.getState().setStatus(`status-${tag}`, `Status ${tag}`);
	useExtensionUiStore.getState().setWidget(`widget-${tag}`, [`Widget ${tag}`]);
}

let omp: MockOmp;
let emitTabStatus: TabStatusHandler;

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
	useExtensionUiStore.getState().clearAll();
	useUiStore.getState().closeSessionOverlays();
	useUiStore.getState().closeStatsDashboard();
	useForkHandoffStore.getState().closeHandoffDialog();
}

afterEach(() => {
	resetAll();
	vi.restoreAllMocks();
	({ omp, emitTabStatus } = installMockOmp());
});

({ omp, emitTabStatus } = installMockOmp());

describe("tabs store boot reconciliation", () => {
	it("adopts the window's initial sidecar as tab 0 and never duplicates it", async () => {
		omp.tabs.list.mockResolvedValue([tabInfo("t0", "/alpha")]);

		await useTabsStore.getState().reconcileTabs();
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t0"]);
		expect(useTabsStore.getState().activeTabId).toBe("t0");

		// Reconcile again (and after a status push that pre-created the entry):
		// merge is by tabId, so the initial sidecar appears exactly once.
		await useTabsStore.getState().reconcileTabs();
		expect(useTabsStore.getState().tabs).toHaveLength(1);

		useTabsStore
			.getState()
			.applyTabStatus({ kind: "agent", tabId: "t0", cwd: "/alpha", status: "ready", title: "Alpha" });
		await useTabsStore.getState().reconcileTabs();
		const tabs = useTabsStore.getState().tabs;
		expect(tabs).toHaveLength(1);
		expect(tabs[0]?.title).toBe("Alpha");
	});

	it("keeps renderer-known tabs the reply misses and re-converges active on reload", async () => {
		seedTabs("t1");
		// Main knows only two of three tabs (the third spawned mid-reply).
		omp.tabs.list.mockResolvedValue([tabInfo("t0", "/alpha"), tabInfo("t1", "/beta")]);

		await useTabsStore.getState().reconcileTabs();

		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t0", "t1", "t2"]);
		expect(useTabsStore.getState().activeTabId).toBe("t1");
		// >1 tabs after a renderer reload: main re-converges to the renderer's pick.
		expect(omp.tabs.setActive).toHaveBeenCalledWith("t1");
	});

	it("restores main's persisted active tab when renderer state is empty", async () => {
		omp.tabs.list.mockResolvedValue([tabInfo("t0", "/alpha"), { ...tabInfo("t1", "/beta"), active: true }]);

		await useTabsStore.getState().reconcileTabs();

		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t0", "t1"]);
		expect(useTabsStore.getState().activeTabId).toBe("t1");
		expect(omp.tabs.setActive).toHaveBeenCalledWith("t1");
	});

	it("retains the restored transcript path before session metadata arrives", async () => {
		omp.tabs.list.mockResolvedValue([
			{ ...tabInfo("t0", "/alpha"), sessionPath: "/sessions/restored.jsonl", active: true },
		]);

		await useTabsStore.getState().reconcileTabs();

		expect(useTabsStore.getState().tabs[0]).toMatchObject({
			id: "t0",
			sessionPath: "/sessions/restored.jsonl",
		});
	});

	it("invalidates a parked bundle when boot reconciliation observes a replacement session", async () => {
		seedTabs();
		fillLiveStores("old");
		useTabsStore.getState().applyTabStatus({
			kind: "agent",
			tabId: "t0",
			cwd: "/alpha",
			status: "ready",
			title: "Old",
			sessionId: "s-old",
		});
		await useTabsStore.getState().switchTab("t1");
		const oldRuntime = sessionRuntime("t0");
		expect(oldRuntime).not.toBeNull();
		omp.tabs.list.mockResolvedValue([
			{ kind: "agent", tabId: "t0", cwd: "/alpha", status: "ready", title: null, sessionId: "s-new" },
			tabInfo("t1", "/beta"),
			tabInfo("t2", "/gamma"),
		]);

		await useTabsStore.getState().reconcileTabs();

		expect(sessionRuntime("t0")).not.toBe(oldRuntime);
		expect(useTabsStore.getState().tabs[0]).toMatchObject({ sessionId: "s-new", title: undefined });
	});

	it("retains unsent input when restarting an unpersisted session changes its identity", () => {
		seedTabs();
		useTabsStore
			.getState()
			.applyTabStatus({ kind: "agent", tabId: "t0", cwd: "/alpha", status: "ready", sessionId: "before-restart" });
		useComposerStore.getState().setDraft("unsent recovery draft");
		useComposerStore.getState().setSubmissionUncertain(true);
		useTabsStore.getState().applyTabStatus({
			kind: "agent",
			tabId: "t0",
			cwd: "/alpha",
			status: "starting",
			sessionId: "before-restart",
		});
		useTabsStore
			.getState()
			.applyTabStatus({ kind: "agent", tabId: "t0", cwd: "/alpha", status: "ready", sessionId: "after-restart" });
		expect(useComposerStore.getState()).toMatchObject({
			draft: "unsent recovery draft",
			sending: false,
			submissionUncertain: true,
		});
	});
});

describe("tabs store switch", () => {
	it("openTab spawns in the current cwd, registers the tab, and switches to it", async () => {
		omp.tabs.list.mockResolvedValue([tabInfo("t0", "/alpha")]);
		await useTabsStore.getState().reconcileTabs();
		useSessionStore.setState({ cwd: "/alpha" });
		omp.tabs.spawn.mockResolvedValue({ tabId: "t1" });

		const tabId = await useTabsStore.getState().openTab();

		expect(tabId).toBe("t1");
		expect(omp.tabs.spawn).toHaveBeenCalledWith({ cwd: "/alpha", sessionPath: undefined, kind: "agent" });
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t0", "t1"]);
		expect(useTabsStore.getState().activeTabId).toBe("t1");
	});

	it("opens Work as an agent in the main-owned default workspace", async () => {
		omp.tabs.list.mockResolvedValue([tabInfo("t0", "/alpha")]);
		await useTabsStore.getState().reconcileTabs();
		useSessionStore.setState({ cwd: "/alpha" });
		omp.tabs.spawn.mockResolvedValue({ tabId: "t-work", cwd: "/Users/test/.omp/work" });

		const tabId = await useTabsStore.getState().openTab({ work: true });

		expect(tabId).toBe("t-work");
		expect(omp.tabs.spawn).toHaveBeenCalledWith({
			cwd: undefined,
			sessionPath: undefined,
			kind: "agent",
			defaultWorkspace: true,
			worktree: undefined,
		});
		expect(useTabsStore.getState().tabs.find(tab => tab.id === "t-work")?.cwd).toBe("/Users/test/.omp/work");
	});

	it("hydrates a fresh tab when its ready push beats full route wiring", async () => {
		omp.tabs.list.mockResolvedValue([tabInfo("t0", "/alpha")]);
		await useTabsStore.getState().reconcileTabs();
		useSessionStore.setState({ cwd: "/alpha", status: "ready" });
		omp.tabs.spawn.mockResolvedValue({ tabId: "t1" });
		const route = Promise.withResolvers<boolean>();
		omp.tabs.setActive.mockReturnValueOnce(route.promise);

		const opening = useTabsStore.getState().openTab({ kind: "chat" });
		await Promise.resolve();
		await Promise.resolve();
		expect(omp.tabs.setActive).toHaveBeenCalledWith("t1");

		// The light per-tab channel reports ready before main finishes attaching
		// the full active-tab channel, so no full ready event will replay.
		useTabsStore.getState().applyTabStatus({ kind: "chat", tabId: "t1", cwd: "/alpha", status: "ready" });
		route.resolve(true);
		await opening;

		expect(useSessionStore.getState().status).toBe("ready");
		expect(useSessionStore.getState().sessionId).toBe("srv");
		expect(omp.rpc.getState).toHaveBeenCalled();
	});

	it("reports the pool cap without mutating the tab list", async () => {
		seedTabs();
		omp.tabs.spawn.mockResolvedValue(null);

		const tabId = await useTabsStore.getState().openTab();

		expect(tabId).toBeNull();
		expect(useTabsStore.getState().tabs).toHaveLength(3);
		expect(useTabsStore.getState().activeTabId).toBe("t0");
		expect(omp.tabs.setActive).not.toHaveBeenCalled();
	});

	it("surfaces a kind-mismatch refusal as an error toast and adds no tab", async () => {
		seedTabs();
		omp.tabs.spawn.mockResolvedValue({ tabId: null, refusal: "kind-mismatch" });

		const tabId = await useTabsStore.getState().openTab({ sessionPath: "/sessions/agent.jsonl", kind: "chat" });

		expect(tabId).toBeNull();
		expect(useTabsStore.getState().tabs).toHaveLength(3);
		expect(useToastStore.getState().toasts.some(toast => toast.variant === "error")).toBe(true);
		expect(omp.tabs.setActive).not.toHaveBeenCalled();
	});

	it("fires SET_ACTIVE_TAB before hydrating from the target sidecar", async () => {
		seedTabs();

		await useTabsStore.getState().switchTab("t1");

		expect(omp.tabs.setActive).toHaveBeenCalledWith("t1");
		expect(omp.rpc.getState).toHaveBeenCalled();
		const setActiveOrder = omp.tabs.setActive.mock.invocationCallOrder[0];
		const getStateOrder = omp.rpc.getState.mock.invocationCallOrder[0];
		expect(setActiveOrder).toBeDefined();
		expect(getStateOrder).toBeDefined();
		expect(setActiveOrder!).toBeLessThan(getStateOrder!);
	});

	it("closes outgoing session overlays while keeping global windows open", async () => {
		seedTabs();
		useUiStore.getState().openSettings();
		useUiStore.getState().openContextReport();
		useUiStore.getState().openModes("goal");
		useUiStore.getState().openStatsDashboard();
		useForkHandoffStore.getState().openHandoffDialog();

		await useTabsStore.getState().switchTab("t1");

		expect(useUiStore.getState().settingsOpen).toBe(false);
		expect(useUiStore.getState().contextReportOpen).toBe(false);
		expect(useUiStore.getState().modesOpen).toBe(false);
		expect(useForkHandoffStore.getState().handoffDialogOpen).toBe(false);
		expect(useUiStore.getState().statsDashboardOpen).toBe(true);
	});

	it("serializes rapid switches and hydrates only the latest visible tab", async () => {
		seedTabs();
		const firstRoute = Promise.withResolvers<boolean>();
		const secondRoute = Promise.withResolvers<boolean>();
		omp.tabs.setActive.mockReturnValueOnce(firstRoute.promise).mockReturnValueOnce(secondRoute.promise);

		const firstSwitch = useTabsStore.getState().switchTab("t1");
		const secondSwitch = useTabsStore.getState().switchTab("t2");
		await Promise.resolve();

		// UI selection remains immediate even while main-process routing catches up.
		expect(useTabsStore.getState().activeTabId).toBe("t2");
		expect(acceptsActiveTabEvents()).toBe(false);
		expect(omp.tabs.setActive).toHaveBeenCalledTimes(1);

		firstRoute.resolve(true);
		await firstSwitch;
		expect(omp.tabs.setActive).toHaveBeenCalledTimes(2);
		// The superseded t1 route must not hydrate into t2's visible stores.
		expect(acceptsActiveTabEvents()).toBe(false);
		expect(omp.rpc.getState).not.toHaveBeenCalled();

		secondRoute.resolve(true);
		await Promise.all([firstSwitch, secondSwitch]);

		expect(omp.tabs.setActive.mock.calls.map(call => call[0])).toEqual(["t1", "t2"]);
		expect(omp.rpc.getState).toHaveBeenCalledTimes(1);
		expect(useTabsStore.getState().activeTabId).toBe("t2");
		expect(acceptsActiveTabEvents()).toBe(true);
	});

	it("snapshots the current tab's slices and restores the target's — draft included", async () => {
		seedTabs();
		fillLiveStores("t0");

		// Gate the transcript so the restored (pre-hydrate) state is observable.
		const gate = Promise.withResolvers<RpcResponse>();
		omp.rpc.getTranscript.mockReturnValueOnce(gate.promise);
		const firstSwitch = useTabsStore.getState().switchTab("t1");

		// t1 has no bundle: stores reset to empty instantly, before any RPC settles.
		expect(useComposerStore.getState().draft).toBe("");
		expect(useComposerStore.getState().images).toEqual([]);
		expect(useMessagesStore.getState().messages).toEqual([]);
		expect(useSessionStore.getState().sessionId).toBe("");
		expect(useExtensionUiStore.getState().pendingRequests).toEqual([]);
		expect(useExtensionUiStore.getState().statusWidgets).toEqual({});

		gate.resolve(ok({ messages: [msg("server-t1")] }));
		await firstSwitch;

		// Hydrate applied the target sidecar's state; the (empty) draft is untouched.
		expect(useSessionStore.getState().sessionId).toBe("srv");
		expect(useMessagesStore.getState().messages.map(m => messageText(m))).toEqual(["server-t1"]);

		// t0's bundle is parked; t1 now gets its own recognizable live state.
		fillLiveStores("t1");
		pushTabExtensionUiRequest("t0", {
			type: "extension_ui_request",
			id: "ui-t0-late",
			method: "confirm",
			title: "Late t0 request",
			message: "Still belongs to t0",
		});
		expect(useExtensionUiStore.getState().pendingRequests.map(request => request.id)).toEqual(["ui-t1"]);
		const gate2 = Promise.withResolvers<RpcResponse>();
		omp.rpc.getTranscript.mockReturnValueOnce(gate2.promise);
		const secondSwitch = useTabsStore.getState().switchTab("t0");

		// Instant restore of t0's parked bundle — every slice, before hydrate.
		expect(useComposerStore.getState().draft).toBe("draft-t0");
		expect(useComposerStore.getState().images[0]?.content.data).toBe("image-t0");
		expect(useMessagesStore.getState().messages.map(m => messageText(m))).toEqual(["hello-t0"]);
		expect(useSessionStore.getState().sessionId).toBe("s-t0");
		expect(useSessionStore.getState().sessionName).toBe("Session t0");
		expect(useSessionStore.getState().planModeEnabled).toBe(true);
		expect(useSessionStore.getState().goal?.objective).toBe("goal-t0");
		expect(useTodoStore.getState().phases.map(phase => phase.name)).toEqual(["phase-t0"]);
		expect(useQueueStore.getState().steering.map(entry => entry.id)).toEqual(["q-t0"]);
		expect(useSubagentsStore.getState().subagents.has("a-t0")).toBe(true);
		expect(useModelStore.getState().model?.id).toBe("m-t0");
		expect(useModelStore.getState().fastModeEnabled).toBe(true);
		expect(usePlanApprovalStore.getState().pending?.planContent).toBe("plan-t0");
		expect(usePlanApprovalStore.getState().feedback).toBe("feedback-t0");
		expect(useExtensionUiStore.getState().pendingRequests.map(request => request.id)).toEqual([
			"ui-t0",
			"ui-t0-late",
		]);
		expect(useExtensionUiStore.getState().statusWidgets).toEqual({ "status-t0": "Status t0" });
		expect(useExtensionUiStore.getState().widgetPanels).toEqual({ "widget-t0": ["Widget t0"] });

		gate2.resolve(ok({ messages: [msg("hello-t0")] }));
		await secondSwitch;

		// Hydrate never touches the composer draft: t0's draft survives the switch.
		expect(useComposerStore.getState().draft).toBe("draft-t0");

		// …and t1's bundle parked its own draft, restored on the way back.
		await useTabsStore.getState().switchTab("t1");
		expect(useComposerStore.getState().draft).toBe("draft-t1");
		expect(useComposerStore.getState().images[0]?.content.data).toBe("image-t1");
		expect(usePlanApprovalStore.getState().pending?.planContent).toBe("plan-t1");
		expect(useExtensionUiStore.getState().pendingRequests.map(request => request.id)).toEqual(["ui-t1"]);
	});

	it("settles an approval in its background tab without mutating the visible session", async () => {
		seedTabs();
		fillLiveStores("t0");
		const proposal = usePlanApprovalStore.getState().pending;
		expect(proposal).not.toBeNull();

		await useTabsStore.getState().switchTab("t1");
		fillLiveStores("t1");
		settleTabPlanApproval("t0", "s-t0", proposal!, { clear: true, exitPlanMode: true });

		expect(useSessionStore.getState().sessionId).toBe("s-t1");
		expect(useSessionStore.getState().planModeEnabled).toBe(true);
		expect(usePlanApprovalStore.getState().pending?.planContent).toBe("plan-t1");

		await useTabsStore.getState().switchTab("t0");
		expect(useSessionStore.getState().planModeEnabled).toBe(false);
		expect(usePlanApprovalStore.getState().pending).toBeNull();
	});

	it("restores a failed submit to its background tab without touching the visible composer", async () => {
		seedTabs();
		fillLiveStores("t0");
		await useTabsStore.getState().switchTab("t1");
		useComposerStore.getState().setDraft("visible-t1");

		restoreTabComposer("t0", "replaced-session", "stale-submit", []);
		restoreTabComposer("t0", "s-t0", "failed-t0", [
			{ content: { type: "image", data: "failed-image", mimeType: "image/png" }, preview: "failed-preview" },
		]);

		expect(useComposerStore.getState().draft).toBe("visible-t1");
		expect(useComposerStore.getState().images).toEqual([]);

		await useTabsStore.getState().switchTab("t0");
		expect(useComposerStore.getState().draft).toBe("failed-t0\ndraft-t0");
		expect(useComposerStore.getState().images.map(image => image.content.data)).toEqual(["failed-image", "image-t0"]);
	});

	it("derives run state from the tab entry when restoring a background-running tab", async () => {
		seedTabs();
		// t1's run kept going in the background; the pool reported it.
		useTabsStore.getState().applyTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "running" });

		// Gate the hydrate so the restored (pre-hydrate) state is observable.
		const gate = Promise.withResolvers<RpcResponse>();
		omp.rpc.getTranscript.mockReturnValueOnce(gate.promise);
		const switching = useTabsStore.getState().switchTab("t1");

		// Restore paints the run live before hydrate's get_state confirms it.
		expect(useSessionStore.getState().isStreaming).toBe(true);
		expect(useSessionStore.getState().status).toBe("ready");

		gate.resolve(ok({ messages: [] }));
		await switching;
		// Hydrate's get_state (mock: not streaming) is authoritative afterwards.
		expect(useSessionStore.getState().isStreaming).toBe(false);
	});

	it("re-arms a streaming tab's waiting marker when it returns from the background", async () => {
		seedTabs();
		// t0 is waiting on the model when the user leaves it; parked, it never
		// receives the message_end that would clear this marker.
		useSessionStore.setState({ isStreaming: true, awaitingModelSince: 1_000 });
		await useTabsStore.getState().switchTab("t1");

		omp.rpc.getState.mockResolvedValue(ok(serverState({ isStreaming: true })));
		const returnedAt = Date.now();
		await useTabsStore.getState().switchTab("t0");

		// Counting from 1_000 would read as decades of "waiting for the model".
		expect(useSessionStore.getState().awaitingModelSince).toBeGreaterThanOrEqual(returnedAt);
	});

	it("stamps the outgoing tab's chip when it was streaming in the foreground", async () => {
		seedTabs();
		useSessionStore.setState({ isStreaming: true });

		await useTabsStore.getState().switchTab("t1");

		const t0 = useTabsStore.getState().tabs.find(tab => tab.id === "t0");
		expect(t0?.status).toBe("running");
	});

	it("surfaces a SET_ACTIVE_TAB failure, re-converges from GET_TABS, and hydrates after the retry", async () => {
		seedTabs();
		useToastStore.setState({ toasts: [] });
		omp.tabs.setActive.mockRejectedValueOnce(new Error("routing wedged"));
		omp.tabs.list.mockResolvedValue([tabInfo("t0", "/alpha"), tabInfo("t1", "/beta"), tabInfo("t2", "/gamma")]);

		await useTabsStore.getState().switchTab("t1");

		// Surfaced, not swallowed…
		expect(useToastStore.getState().toasts.some(toast => toast.title === "Could not switch tab")).toBe(true);
		// …re-converged from GET_TABS — reconcile retries SET_ACTIVE_TAB for the
		// renderer's pick, so a transient failure re-points routing here…
		expect(omp.tabs.list).toHaveBeenCalled();
		expect(omp.tabs.setActive).toHaveBeenCalledTimes(2);
		// …then hydrate paints the target instead of leaving the restored empty
		// bundle on screen after the successful retry.
		expect(omp.rpc.getTranscript).toHaveBeenCalledTimes(1);
	});

	it("treats a false SET_ACTIVE_TAB reply as a routing failure and recovers on retry", async () => {
		seedTabs();
		useToastStore.setState({ toasts: [] });
		omp.tabs.setActive.mockResolvedValueOnce(false);
		omp.tabs.list.mockResolvedValue([tabInfo("t0", "/alpha"), tabInfo("t1", "/beta"), tabInfo("t2", "/gamma")]);

		await useTabsStore.getState().switchTab("t1");

		expect(useToastStore.getState().toasts.some(toast => toast.title === "Could not switch tab")).toBe(true);
		expect(omp.rpc.getTranscript).toHaveBeenCalledTimes(1);
	});

	it("does not hydrate when both the tab route and reconciliation route fail", async () => {
		seedTabs();
		omp.tabs.setActive.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
		omp.tabs.list.mockResolvedValue([tabInfo("t0", "/alpha"), tabInfo("t1", "/beta"), tabInfo("t2", "/gamma")]);

		await useTabsStore.getState().switchTab("t1");

		expect(omp.rpc.getTranscript).not.toHaveBeenCalled();
	});
});

describe("tabs store split pairs (gui#30)", () => {
	const pair = (firstTabId: string, secondTabId: string, ratio = 0.5): SplitLayout => ({
		axis: "columns",
		firstTabId,
		secondTabId,
		ratio,
	});
	const ids = () => useTabsStore.getState().tabs.map(tab => tab.id);

	/** Seed ready tabs t0…tN-1 with these pairs, `active` focused. */
	function seedStrip(count: number, active: string, groups: SplitLayout[]): void {
		const tabs: SessionTab[] = Array.from({ length: count }, (_, index) => ({
			kind: "agent",
			id: `t${index}`,
			cwd: `/w${index}`,
			status: "ready",
			unreadDone: false,
		}));
		for (const tab of tabs) ensureTabRuntime(tab.id);
		const split = groups.find(group => group.firstTabId === active || group.secondTabId === active) ?? null;
		useTabsStore.setState({ tabs, activeTabId: active, groups, split, bundles: new Map() });
		setFocusedSessionRuntime(active);
	}

	it("shows a pair whenever either tab is picked, and a single tab alone without breaking the pair", async () => {
		seedStrip(3, "t2", [pair("t0", "t1", 0.3)]);
		const hydrated: string[] = [];
		(omp.rpc as unknown as { commandForTab: unknown }).commandForTab = vi.fn(
			async (tabId: string, command: { type: string }) => {
				if (command.type === "get_state") hydrated.push(tabId);
				return command.type === "get_state" ? ok(serverState()) : ok({ messages: [] });
			},
		);

		await useTabsStore.getState().switchTab("t1");

		expect(useTabsStore.getState().split).toEqual(pair("t0", "t1", 0.3));
		expect(omp.tabs.setView).toHaveBeenLastCalledWith("t1", ["t0", "t1"], [pair("t0", "t1", 0.3)]);
		// The partner came on screen beside the picked tab, so both hydrate.
		expect(hydrated.sort()).toEqual(["t0", "t1"]);

		await useTabsStore.getState().switchTab("t2");
		expect(useTabsStore.getState().split).toBeNull();
		expect(useTabsStore.getState().groups).toEqual([pair("t0", "t1", 0.3)]);
		// Main already holds the pair: the single tab is named alone.
		expect(omp.tabs.setActive).toHaveBeenLastCalledWith("t2");

		await useTabsStore.getState().switchTab("t0");
		expect(useTabsStore.getState().activeTabId).toBe("t0");
		expect(useTabsStore.getState().split).toEqual(pair("t0", "t1", 0.3));
	});

	it("pairs a tab beside the focused one, breaking both old pairs, and keeps the new pair's chips together", async () => {
		seedStrip(5, "t3", [pair("t0", "t1"), pair("t3", "t4")]);

		await useTabsStore.getState().splitTab("t0", "left");

		const state = useTabsStore.getState();
		expect(state.groups).toEqual([{ axis: "columns", firstTabId: "t0", secondTabId: "t3", ratio: 0.5 }]);
		expect(state.activeTabId).toBe("t0");
		expect(state.split).toBe(state.groups[0]);
		expect(ids()).toEqual(["t0", "t3", "t1", "t2", "t4"]);
		expect(omp.tabs.setOrder).toHaveBeenLastCalledWith(["t0", "t3", "t1", "t2", "t4"]);
	});

	it("drops a tab into one pane of the shown pair; the tab it replaces stays open on its own", async () => {
		seedStrip(4, "t0", [pair("t0", "t1", 0.7), pair("t2", "t3")]);

		await useTabsStore.getState().replacePane("t1", "t2");

		const state = useTabsStore.getState();
		expect(state.groups).toEqual([pair("t0", "t2", 0.7)]);
		expect(state.activeTabId).toBe("t2");
		expect(ids()).toEqual(["t0", "t2", "t1", "t3"]);
		expect(omp.tabs.setView).toHaveBeenLastCalledWith("t2", ["t0", "t2"], [pair("t0", "t2", 0.7)]);
	});

	it("separates the pair on screen in place, and a background pair without moving the view", async () => {
		seedStrip(4, "t0", [pair("t0", "t1"), pair("t2", "t3")]);

		await useTabsStore.getState().unsplit("t2");
		expect(useTabsStore.getState().groups).toEqual([pair("t0", "t1")]);
		expect(useTabsStore.getState().activeTabId).toBe("t0");
		expect(useTabsStore.getState().split).toEqual(pair("t0", "t1"));

		await useTabsStore.getState().unsplit("t1");
		expect(useTabsStore.getState().groups).toEqual([]);
		expect(useTabsStore.getState().activeTabId).toBe("t1");
		expect(omp.tabs.setView).toHaveBeenLastCalledWith("t1", ["t1"], []);
	});

	it("closing a tab of the shown pair leaves its partner on screen; a background pair just loses it", async () => {
		seedStrip(4, "t1", [pair("t0", "t1"), pair("t2", "t3")]);

		await useTabsStore.getState().closeTab("t1");
		expect(useTabsStore.getState().activeTabId).toBe("t0");
		expect(useTabsStore.getState().split).toBeNull();

		await useTabsStore.getState().closeTab("t3");
		expect(useTabsStore.getState().groups).toEqual([]);
		expect(useTabsStore.getState().activeTabId).toBe("t0");
		expect(ids()).toEqual(["t0", "t2"]);
	});

	it("drags a chip before or after another, moving a pair as one", async () => {
		seedStrip(4, "t0", [pair("t1", "t2")]);
		const { moveTab } = useTabsStore.getState();

		moveTab("t3", "t1", "before");
		expect(ids()).toEqual(["t0", "t3", "t1", "t2"]);
		moveTab("t2", "t0", "before");
		expect(ids()).toEqual(["t1", "t2", "t0", "t3"]);
		moveTab("t0", "t2", "after");
		expect(ids()).toEqual(["t1", "t2", "t0", "t3"]);
		// Onto its own partner: nothing to move.
		moveTab("t1", "t2", "after");
		expect(ids()).toEqual(["t1", "t2", "t0", "t3"]);
		await vi.waitFor(() => expect(omp.tabs.setOrder).toHaveBeenCalledTimes(2));
		expect(omp.tabs.setOrder).toHaveBeenLastCalledWith(["t1", "t2", "t0", "t3"]);
	});

	it("rebuilds pairs from main's tab list on reconcile", async () => {
		omp.tabs.list.mockResolvedValue([
			{ ...tabInfo("t0", "/a"), group: { axis: "rows", index: 0, ratio: 0.6, partnerTabId: "t1" } },
			{ ...tabInfo("t1", "/b"), active: true, group: { axis: "rows", index: 1, ratio: 0.6, partnerTabId: "t0" } },
			tabInfo("t2", "/c"),
		]);

		await useTabsStore.getState().reconcileTabs();

		const pairFromMain = { axis: "rows", firstTabId: "t0", secondTabId: "t1", ratio: 0.6 };
		expect(useTabsStore.getState().groups).toEqual([pairFromMain]);
		expect(useTabsStore.getState().split).toEqual(pairFromMain);
	});

	it("steps through chips by keyboard with a pair counting once and returning to its last focused tab", async () => {
		seedStrip(4, "t0", [pair("t1", "t2")]);
		await useTabsStore.getState().switchTab("t2");
		await useTabsStore.getState().switchTab("t0");

		cycleTab(1);
		await vi.waitFor(() => expect(useTabsStore.getState().activeTabId).toBe("t2"));
		cycleTab(1);
		await vi.waitFor(() => expect(useTabsStore.getState().activeTabId).toBe("t3"));
		cycleTab(1);
		await vi.waitFor(() => expect(useTabsStore.getState().activeTabId).toBe("t0"));
		selectTabAt(9);
		await vi.waitFor(() => expect(useTabsStore.getState().activeTabId).toBe("t3"));
		selectTabAt(2);
		await vi.waitFor(() => expect(useTabsStore.getState().activeTabId).toBe("t2"));

		moveActiveTab(-1);
		expect(ids()).toEqual(["t1", "t2", "t0", "t3"]);
	});
});

describe("tabs store close", () => {
	it("keeps the last tab open", async () => {
		omp.tabs.list.mockResolvedValue([tabInfo("t0", "/alpha")]);
		await useTabsStore.getState().reconcileTabs();

		await useTabsStore.getState().closeTab("t0");

		expect(useTabsStore.getState().tabs).toHaveLength(1);
		expect(omp.tabs.close).not.toHaveBeenCalled();
	});

	it("closing the active tab activates its right neighbor first, then releases", async () => {
		seedTabs("t1");

		await useTabsStore.getState().closeTab("t1");

		const state = useTabsStore.getState();
		expect(state.tabs.map(tab => tab.id)).toEqual(["t0", "t2"]);
		expect(state.activeTabId).toBe("t2");
		// Neighbor was activated BEFORE the release hit main.
		expect(omp.tabs.setActive).toHaveBeenCalledWith("t2");
		expect(omp.tabs.close).toHaveBeenCalledWith("t1");
		const setActiveOrder = omp.tabs.setActive.mock.invocationCallOrder[0];
		const closeOrder = omp.tabs.close.mock.invocationCallOrder[0];
		expect(setActiveOrder!).toBeLessThan(closeOrder!);
		// The closed tab's parked bundle is gone.
		expect(state.bundles.has("t1")).toBe(false);
	});

	it("closing the last tab in the strip activates its left neighbor", async () => {
		seedTabs("t2");

		await useTabsStore.getState().closeTab("t2");

		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t0", "t1"]);
		expect(useTabsStore.getState().activeTabId).toBe("t1");
	});

	it("closing a background tab leaves the active tab attached", async () => {
		seedTabs("t0");

		await useTabsStore.getState().closeTab("t1");

		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t0", "t2"]);
		expect(useTabsStore.getState().activeTabId).toBe("t0");
		expect(omp.tabs.setActive).not.toHaveBeenCalled();
		expect(omp.tabs.close).toHaveBeenCalledWith("t1");
	});
});

describe("tabs store applyTabStatus", () => {
	it("sets unreadDone when a background run settles, cleared on visit", async () => {
		seedTabs();

		useTabsStore.getState().applyTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "running" });
		expect(useTabsStore.getState().tabs.find(tab => tab.id === "t1")?.unreadDone).toBe(false);

		useTabsStore.getState().applyTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "ready" });
		expect(useTabsStore.getState().tabs.find(tab => tab.id === "t1")?.unreadDone).toBe(true);

		await useTabsStore.getState().switchTab("t1");
		expect(useTabsStore.getState().tabs.find(tab => tab.id === "t1")?.unreadDone).toBe(false);
	});

	it("announces a background run's outcome, failure with its error, and stays quiet for the active tab", () => {
		seedTabs();
		useToastStore.setState({ toasts: [] });
		const apply = useTabsStore.getState().applyTabStatus;

		apply({ kind: "agent", tabId: "t1", cwd: "/beta", status: "running", title: "Beta work" });
		apply({ kind: "agent", tabId: "t1", cwd: "/beta", status: "running", attention: "retrying" });
		apply({
			kind: "agent",
			tabId: "t1",
			cwd: "/beta",
			status: "ready",
			attention: "failed",
			attentionDetail: "upstream overloaded",
		});
		apply({ kind: "agent", tabId: "t2", cwd: "/gamma", status: "running" });
		apply({ kind: "agent", tabId: "t2", cwd: "/gamma", status: "ready" });
		apply({ kind: "agent", tabId: "t0", cwd: "/alpha", status: "running" });
		apply({ kind: "agent", tabId: "t0", cwd: "/alpha", status: "ready" });

		expect(useToastStore.getState().toasts.map(toast => [toast.variant, toast.title ?? toast.message])).toEqual([
			["error", "“Beta work” stopped with an error"],
			["success", "“gamma” finished"],
		]);
		expect(useToastStore.getState().toasts[0]?.message).toBe("upstream overloaded");
		const failed = useTabsStore.getState().tabs.find(tab => tab.id === "t1");
		expect(failed && tabSignalPresentation(failed).labelKey).toBe("tabs.failed");
	});

	it("seeds a parked tab's retry row from main's snapshot, and clears it with the saga", () => {
		seedTabs();
		const retry = { attempt: 2, maxAttempts: 5, delayMs: 4000, errorMessage: "overloaded", startedAt: 1000 };
		const session = () => sessionRuntimeStore<SessionStore>("t1", "session")?.getState();
		useTabsStore.getState().applyTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "running", retry });
		expect(session()?.retryInfo).toEqual(retry);
		useTabsStore
			.getState()
			.applyTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "running", retry: null });
		expect(session()?.retryInfo).toBeNull();
	});

	it("does not badge the active tab's own run settling", () => {
		seedTabs();
		useTabsStore.getState().applyTabStatus({ kind: "agent", tabId: "t0", cwd: "/alpha", status: "running" });
		useTabsStore.getState().applyTabStatus({ kind: "agent", tabId: "t0", cwd: "/alpha", status: "ready" });
		expect(useTabsStore.getState().tabs.find(tab => tab.id === "t0")?.unreadDone).toBe(false);
	});

	it("mirrors only the active tab's keyed connection status into the composer", () => {
		seedTabs();
		useSessionStore.setState({ status: "starting", cwd: "" });

		useTabsStore.getState().applyTabStatus({ kind: "agent", tabId: "t0", cwd: "/alpha", status: "ready" });
		expect(useSessionStore.getState().status).toBe("ready");
		expect(useSessionStore.getState().cwd).toBe("/alpha");

		useTabsStore.getState().applyTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "exited" });
		expect(useSessionStore.getState().status).toBe("ready");
		expect(useSessionStore.getState().cwd).toBe("/alpha");
	});

	it("upserts unknown tabs and preserves title/sessionId across pushes", () => {
		seedTabs();
		useTabsStore.getState().applyTabStatus({ kind: "agent", tabId: "t9", cwd: "/new", status: "starting" });
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toContain("t9");

		useTabsStore
			.getState()
			.applyTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "ready", title: "Beta", sessionId: "s9" });
		useTabsStore.getState().applyTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "ready" });
		const t1 = useTabsStore.getState().tabs.find(tab => tab.id === "t1");
		expect(t1?.title).toBe("Beta");
		expect(t1?.sessionId).toBe("s9");
	});

	it("clears a stale transcript path when main reports a fresh unsaved session", () => {
		seedTabs();
		useTabsStore.getState().applyTabStatus({
			kind: "agent",
			tabId: "t0",
			cwd: "/alpha",
			status: "ready",
			sessionPath: "/sessions/old.jsonl",
		});
		expect(useTabsStore.getState().tabs[0]?.sessionPath).toBe("/sessions/old.jsonl");

		useTabsStore.getState().applyTabStatus({
			kind: "agent",
			tabId: "t0",
			cwd: "/alpha",
			status: "ready",
			sessionPath: null,
		});
		expect(useTabsStore.getState().tabs[0]?.sessionPath).toBeUndefined();
	});

	it("drops a parked bundle when the sidecar replaces its session", async () => {
		seedTabs();
		fillLiveStores("old");
		useTabsStore.getState().applyTabStatus({
			kind: "agent",
			tabId: "t0",
			cwd: "/old",
			status: "ready",
			title: "Old title",
			sessionId: "s-old",
		});
		await useTabsStore.getState().switchTab("t1");
		const oldRuntime = sessionRuntime("t0");
		expect(oldRuntime).not.toBeNull();

		useTabsStore.getState().applyTabStatus({
			kind: "agent",
			tabId: "t0",
			cwd: "/old",
			status: "ready",
			title: null,
			sessionId: "s-new",
		});

		const tab = useTabsStore.getState().tabs.find(entry => entry.id === "t0");
		expect(tab?.title).toBeUndefined();
		expect(tab?.sessionId).toBe("s-new");
		expect(sessionRuntime("t0")).not.toBe(oldRuntime);
		omp.rpc.getState.mockResolvedValue(ok(serverState({ sessionId: "s-new", cwd: "/old" })));

		await useTabsStore.getState().switchTab("t0");
		expect(useComposerStore.getState().draft).toBe("");
		expect(useMessagesStore.getState().messages).toEqual([]);
		expect(usePlanApprovalStore.getState().pending).toBeNull();
	});
});

function SessionTabsProbe(): null {
	useSessionTabs();
	return null;
}

describe("useSessionTabs hook", () => {
	let container: { remove(): void };
	let root: Root;

	async function mount(): Promise<void> {
		const element = document.createElement("div") as unknown as { remove(): void };
		container = element;
		document.body.appendChild(element as never);
		root = createRoot(container as unknown as Element);
		await act(async () => {
			root.render(<SessionTabsProbe />);
		});
	}

	afterEach(async () => {
		if (root) {
			await act(async () => {
				root.unmount();
			});
		}
		container?.remove();
	});

	it("reconciles on mount and subscribes to TAB_STATUS", async () => {
		omp.tabs.list.mockResolvedValue([tabInfo("t0", "/alpha")]);

		await mount();

		expect(omp.tabs.list).toHaveBeenCalled();
		expect(omp.events.onTabStatus).toHaveBeenCalled();
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t0"]);
		expect(useTabsStore.getState().activeTabId).toBe("t0");
	});

	it("hydrates the restored active tab when it was ready before renderer subscriptions", async () => {
		omp.tabs.list.mockResolvedValue([tabInfo("t0", "/alpha"), { ...tabInfo("t1", "/beta"), active: true }]);
		omp.rpc.getState.mockResolvedValue(ok(serverState({ sessionId: "restored", cwd: "/beta" })));

		await mount();
		await act(async () => {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, 0);
			await promise;
		});

		expect(useTabsStore.getState().activeTabId).toBe("t1");
		expect(useSessionStore.getState()).toMatchObject({ sessionId: "restored", cwd: "/beta", status: "ready" });
		expect(omp.rpc.getTranscript).toHaveBeenCalled();
	});

	it("restores transcript and controls when metadata arrives before the boot status snapshot", async () => {
		ensureTabRuntime("t0");
		setFocusedSessionRuntime("t0");
		useSessionStore.setState({ sessionId: "restored", cwd: "/alpha", status: "starting" });
		omp.tabs.list.mockResolvedValue([{ ...tabInfo("t0", "/alpha"), active: true }]);
		omp.rpc.getState.mockResolvedValue(ok(serverState({ sessionId: "restored", cwd: "/alpha", messageCount: 1 })));
		omp.rpc.getTranscript.mockResolvedValue(ok({ messages: [msg("restored history")] }));
		await mount();
		await act(async () => {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, 0);
			await promise;
		});
		expect(useSessionStore.getState()).toMatchObject({ sessionId: "restored", status: "ready" });
		expect(useMessagesStore.getState().messages).toEqual([msg("restored history")]);
	});

	it("restores history when metadata precedes ready on the light channel", async () => {
		useTabsStore.setState({
			tabs: [{ kind: "chat", id: "t1", cwd: "/beta", status: "starting", unreadDone: false }],
			activeTabId: "t1",
			bundles: new Map(),
		});
		await mount();
		ensureTabRuntime("t1");
		setFocusedSessionRuntime("t1");
		useSessionStore.setState({ sessionId: "restored", status: "starting" });
		omp.rpc.getState.mockResolvedValue(ok(serverState({ sessionId: "restored", messageCount: 1 })));
		omp.rpc.getTranscript.mockResolvedValue(ok({ messages: [msg("restored history")] }));

		await act(async () => {
			emitTabStatus({ kind: "chat", tabId: "t1", cwd: "/beta", status: "ready" });
		});
		await act(async () => {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, 0);
			await promise;
		});

		expect(useSessionStore.getState().status).toBe("ready");
		expect(useMessagesStore.getState().messages).toEqual([msg("restored history")]);
	});

	it("applies a tab's pending session path on its first ready push while active", async () => {
		useTabsStore.setState({
			tabs: [
				{
					kind: "agent",
					id: "t1",
					cwd: "/beta",
					status: "starting",
					unreadDone: false,
					pendingSessionPath: "/s.json",
				},
			],
			activeTabId: "t1",
			bundles: new Map(),
		});
		await mount();

		await act(async () => {
			emitTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "ready" });
		});
		// The switch + hydrate run in a trailing microtask chain.
		await act(async () => {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, 0);
			await promise;
		});

		expect(omp.rpc.switchSession).toHaveBeenCalledWith("/s.json");
		expect(omp.rpc.getState).toHaveBeenCalled();
		expect(useTabsStore.getState().tabs[0]?.pendingSessionPath).toBeUndefined();

		// A duplicate ready push must not re-enter the flow.
		await act(async () => {
			emitTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "ready" });
		});
		expect(omp.rpc.switchSession).toHaveBeenCalledTimes(1);
	});

	it("skips the ready-time switchSession when the sidecar is already on the pending session", async () => {
		useTabsStore.setState({
			tabs: [
				{
					kind: "agent",
					id: "t1",
					cwd: "/beta",
					status: "starting",
					unreadDone: false,
					pendingSessionPath: "/s.json",
				},
			],
			activeTabId: "t1",
			bundles: new Map(),
		});
		// Spawned WITH --session /s.json: get_state already reports that file,
		// so a second switch would only abort the in-flight resume.
		omp.rpc.getState.mockResolvedValue(ok(serverState({ sessionFile: "/s.json" })));
		await mount();

		await act(async () => {
			emitTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "ready" });
		});
		// The gate + hydrate run in a trailing microtask chain.
		await act(async () => {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, 0);
			await promise;
		});

		// No redundant switch — but the transcript still hydrates and the
		// pending path is consumed.
		expect(omp.rpc.switchSession).not.toHaveBeenCalled();
		expect(omp.rpc.getTranscript).toHaveBeenCalled();
		expect(useTabsStore.getState().tabs[0]?.pendingSessionPath).toBeUndefined();
	});

	it("does not switch the session for a background tab's pending path", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
				{
					kind: "agent",
					id: "t1",
					cwd: "/beta",
					status: "starting",
					unreadDone: false,
					pendingSessionPath: "/s.json",
				},
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount();

		await act(async () => {
			emitTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "ready" });
		});

		expect(omp.rpc.switchSession).not.toHaveBeenCalled();
		// Pending path survives for when the user actually switches to t1.
		expect(useTabsStore.getState().tabs.find(tab => tab.id === "t1")?.pendingSessionPath).toBe("/s.json");
	});

	it("subscribes a background tab's subagent frames through its own sidecar (plan/24)", async () => {
		seedTabs();
		useSessionStore.setState({ sessionId: "active" });
		const commandForTab = vi.fn(async () => ({ type: "response" as const, command: "", success: true as const }));
		Object.assign(omp.rpc, { commandForTab });
		try {
			await mount();
			commandForTab.mockClear();
			omp.rpc.setSubagentSubscription.mockClear();

			await act(async () => {
				emitTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "ready" });
			});
			expect(commandForTab).toHaveBeenCalledWith(
				"t1",
				{ type: "set_subagent_subscription", level: "progress" },
				undefined,
			);
			expect(omp.rpc.setSubagentSubscription).not.toHaveBeenCalled();
		} finally {
			delete (omp.rpc as { commandForTab?: unknown }).commandForTab;
		}
	});

	it("subscribes subagent frames on a tab's ready only while it is active without tab-addressed commands (F-HYDRATE)", async () => {
		seedTabs();
		useSessionStore.setState({ sessionId: "active" });
		await mount();
		await act(async () => {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, 0);
			await promise;
		});
		omp.rpc.setSubagentSubscription.mockClear();

		// Background ready: renderer RPC routes through the ACTIVE tab, so a
		// background tab's ready must NOT fire the command (it would land on
		// the wrong sidecar). hydrateSession re-asserts on switch-in instead.
		await act(async () => {
			emitTabStatus({ kind: "agent", tabId: "t1", cwd: "/beta", status: "ready" });
		});
		expect(omp.rpc.setSubagentSubscription).not.toHaveBeenCalled();

		await act(async () => {
			emitTabStatus({ kind: "agent", tabId: "t0", cwd: "/alpha", status: "ready" });
		});
		expect(omp.rpc.setSubagentSubscription).toHaveBeenCalledWith("progress");
	});
});

describe("tabChipLabel (F-HYDRATE)", () => {
	function chip(id: string, cwd: string, title?: string): SessionTab {
		const tab: SessionTab = { id, cwd, status: "ready", kind: "agent", unreadDone: false };
		if (title !== undefined) tab.title = title;
		return tab;
	}

	it("prefers the session title, then the cwd basename, then the new-session label", () => {
		expect(tabChipLabel(chip("t0", "/work/alpha", "Alpha plan"), [])).toBe("Alpha plan");
		expect(tabChipLabel(chip("t1", "/work/beta"), [])).toBe("beta");
		expect(tabChipLabel(chip("t2", ""), [])).toBe("New session");
		// Empty-string titles (never-generated auto-title slot) fall through too.
		expect(tabChipLabel(chip("t3", "/work/gamma", ""), [])).toBe("gamma");
	});

	it("keeps an untitled global chat unnamed instead of exposing its internal cwd as a workspace", () => {
		const chat = { ...chip("chat-0", "/Users/tester"), kind: "chat" as const };
		expect(tabChipLabel(chat, [chat])).toBe("New session");
	});

	it("suffixes identical untitled labels in tab order, first occurrence bare", () => {
		const tabs = [chip("t0", "/work/gui"), chip("t1", "/other/gui"), chip("t2", "/tmp/gui")];
		expect(tabs.map(tab => tabChipLabel(tab, tabs))).toEqual(["gui", "gui #2", "gui #3"]);
		// Distinct basenames never collide, even beside a suffixed group.
		const mixed = [chip("t0", "/work/gui"), chip("t1", "/work/beta"), chip("t2", "/other/gui")];
		expect(mixed.map(tab => tabChipLabel(tab, mixed))).toEqual(["gui", "beta", "gui #2"]);
	});

	it("never suffixes titled tabs — a title is itself the disambiguator", () => {
		const tabs = [chip("t0", "/work/gui"), chip("t1", "/other/gui", "Release plan")];
		// The titled tab left the collision set, so the untitled one stays bare.
		expect(tabs.map(tab => tabChipLabel(tab, tabs))).toEqual(["gui", "Release plan"]);
	});

	it("uses indexed session content instead of a cwd fallback on every tab surface", () => {
		const tab = chip("t0", "/work/Infron");
		expect(tabDisplayTitle(tab, [tab], { title: null, firstMessage: "Review the MySQL migration" }, "Untitled")).toBe(
			"Review the MySQL migration",
		);
	});
});

describe("tab runtime lifecycle guards", () => {
	it("keeps static store access on a focused tab whose runtime was rebuilt by a session change", () => {
		seedTabs("t0");
		const before = sessionRuntime("t0");
		expect(before).not.toBeNull();
		// Stamp the tab's session identity first (sessionChanged only fires when
		// BOTH the cached and the incoming frame carry a sessionId/sessionPath).
		useTabsStore.getState().applyTabStatus({
			kind: "agent",
			tabId: "t0",
			cwd: "/alpha",
			status: "ready",
			sessionId: "s-old",
			sessionPath: "/old.jsonl",
		});

		// In-place session switch: TAB_STATUS carries a NEW sessionId for the
		// focused tab (e.g. /new) — the runtime is rebuilt around it.
		useTabsStore.getState().applyTabStatus({
			kind: "agent",
			tabId: "t0",
			cwd: "/alpha",
			status: "ready",
			sessionId: "s-new",
			sessionPath: "/new.jsonl",
		});

		const rebuilt = sessionRuntime("t0");
		expect(rebuilt).not.toBeNull();
		expect(rebuilt).not.toBe(before);
		// Focus must survive the rebuild: static (focus-following) access still
		// resolves to t0's fresh runtime store, never the module-level default.
		const rebuiltSession = rebuilt?.stores.get("session") as { getState: () => unknown } | undefined;
		expect(useSessionStore.getState()).toBe(rebuiltSession?.getState());
	});

	it("tombstones a closed tab: late extension requests never resurrect a ghost runtime", async () => {
		seedTabs("t0");
		await useTabsStore.getState().closeTab("t1");

		expect(isTabClosed("t1")).toBe(true);
		pushTabExtensionUiRequest("t1", {
			type: "extension_ui_request",
			id: "ui-late",
			method: "confirm",
			title: "Late",
			message: "Late request",
		});
		expect(sessionRuntime("t1")).toBeNull();

		// reset() clears tombstones (test isolation; live ids are never reused).
		useTabsStore.getState().reset();
		expect(isTabClosed("t1")).toBe(false);
	});

	it("refuses to re-split a tab that already occupies a pane", async () => {
		seedTabs("t0");
		const pair = { axis: "columns" as const, firstTabId: "t0", secondTabId: "t1", ratio: 0.7 };
		useTabsStore.setState({ groups: [pair], split: pair });

		await useTabsStore.getState().splitTab("t1", "top");

		// No ratio reset, no axis flip, no focus move.
		expect(useTabsStore.getState().split).toEqual({
			axis: "columns",
			firstTabId: "t0",
			secondTabId: "t1",
			ratio: 0.7,
		});
		expect(useTabsStore.getState().activeTabId).toBe("t0");
	});
});

function messageText(message: AgentMessage): string {
	const content = message.content;
	if (!Array.isArray(content)) return "";
	return content.map(part => (part && typeof part === "object" && "text" in part ? String(part.text) : "")).join("");
}
