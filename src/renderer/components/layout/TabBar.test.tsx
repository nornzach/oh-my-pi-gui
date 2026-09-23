/**
 * TabBar render contract: one chip per session tab (title or cwd basename),
 * status label while a tab runs, done state on unreadDone, close × hidden at
 * the single-tab floor, "+" spawns a new tab in the current cwd. Same
 * linkedom + react-dom harness as the InputArea tests.
 */

import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { IpcSpawnTabPayload, IpcTabInfo, IpcTabStatusPayload, SessionInfo } from "../../../shared/ipc-types";
import type { RpcCommand, RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { closeActiveTab } from "../../lib/tab-close";
import { useComposerStore } from "../../stores/composer";
import { useMessagesStore } from "../../stores/messages";
import { useModelStore } from "../../stores/model";
import { useQueueStore } from "../../stores/queue";
import { useSessionStore } from "../../stores/session";
import { useSidebarPrefs } from "../../stores/sidebar-prefs";
import { useSubagentsStore } from "../../stores/subagents";
import { useTabsStore } from "../../stores/tabs";
import { useTodoStore } from "../../stores/todo";
import { useToolsStore } from "../../stores/tools";
import { useUiStore } from "../../stores/ui";
import { TabBar } from "./TabBar";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);
(window as unknown as { innerHeight: number; innerWidth: number }).innerWidth = 1024;
(window as unknown as { innerHeight: number; innerWidth: number }).innerHeight = 768;

interface TestElement {
	textContent: string | null;
	remove(): void;
	getAttribute(name: string): string | null;
	querySelector(selector: string): TestElement | null;
	querySelectorAll(selector: string): TestElement[];
	appendChild(child: TestElement): void;
}

function ok(data: unknown): RpcResponse {
	return { type: "response", command: "test", success: true, data };
}

function listedSession(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
	return {
		path: `/sessions/${id}.jsonl`,
		id,
		title: null,
		cwd: "/work/infron",
		created: "2026-08-16T00:00:00Z",
		modified: "2026-08-16T00:00:00Z",
		messageCount: 0,
		size: 512,
		status: "complete",
		firstMessage: "",
		...overrides,
	};
}

interface MockOmp {
	sessions: {
		list: Mock<() => Promise<SessionInfo[]>>;
	};
	tabs: {
		list: Mock<() => Promise<IpcTabInfo[]>>;
		spawn: Mock<(payload: IpcSpawnTabPayload) => Promise<{ tabId: string } | null>>;
		close: Mock<(tabId: string) => Promise<boolean>>;
		setActive: Mock<(tabId: string) => Promise<boolean>>;
		setView: Mock<(tabId: string, visibleTabIds: string[], split?: unknown) => Promise<boolean>>;
	};
	events: {
		onTabStatus: Mock<(callback: (payload: IpcTabStatusPayload) => void) => () => void>;
		onSessionsChanged: Mock<(callback: () => void) => () => void>;
	};
	rpc: {
		getState: Mock<() => Promise<RpcResponse>>;
		getTranscript: Mock<() => Promise<RpcResponse>>;
		getSubagents: Mock<() => Promise<RpcResponse>>;
		getGoal: Mock<() => Promise<RpcResponse>>;
		getLoopMode: Mock<() => Promise<RpcResponse>>;
		getVibeMode: Mock<() => Promise<RpcResponse>>;
		getQueue: Mock<() => Promise<RpcResponse>>;
		setSubagentSubscription: Mock<(level: string) => Promise<RpcResponse>>;
		commandForTab: Mock<(tabId: string, command: RpcCommand) => Promise<RpcResponse>>;
	};
}

function installMockOmp(): MockOmp {
	const omp: MockOmp = {
		sessions: { list: vi.fn(async () => []) },
		tabs: {
			list: vi.fn(async () => []),
			spawn: vi.fn(async () => ({ tabId: "t9" })),
			close: vi.fn(async () => true),
			setActive: vi.fn(async () => true),
			setView: vi.fn(async () => true),
		},
		events: {
			onTabStatus: vi.fn(() => () => {}),
			onSessionsChanged: vi.fn(() => () => {}),
		},
		rpc: {
			getState: vi.fn(async () =>
				ok({
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
				}),
			),
			getTranscript: vi.fn(async () => ok({ messages: [] })),
			getSubagents: vi.fn(async () => ok({ subagents: [] })),
			getGoal: vi.fn(async () => ok({ enabled: false })),
			getLoopMode: vi.fn(async () => ok({ enabled: false, state: "off" })),
			getVibeMode: vi.fn(async () => ok({ enabled: false })),
			getQueue: vi.fn(async () => ok({ steering: [], followUp: [] })),
			setSubagentSubscription: vi.fn(async () => ok({})),
			commandForTab: vi.fn(async (tabId, command) => {
				switch (command.type) {
					case "get_state":
						return ok({
							sessionId: "srv",
							sessionName: null,
							sessionFile: null,
							cwd: tabId === "t1" ? "/beta" : "/srv",
							isStreaming: false,
							isCompacting: false,
							contextUsage: null,
							messageCount: 0,
							queuedMessageCount: 0,
							planModeEnabled: false,
							todoPhases: [],
						});
					case "get_transcript":
						return ok({ messages: [] });
					case "get_subagents":
						return ok({ subagents: [] });
					case "get_queue":
						return ok({ steering: [], followUp: [] });
					default:
						return ok({ enabled: false });
				}
			}),
		},
	};
	(window as unknown as { omp: MockOmp }).omp = omp;
	return omp;
}

let omp: MockOmp;
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

/** Drive an element's React onClick (linkedom has no synthetic event system). */
async function click(element: TestElement): Promise<void> {
	const record = element as unknown as Record<string, unknown>;
	const propsKey = Object.getOwnPropertyNames(record).find(key => key.startsWith("__reactProps$"));
	const props = propsKey
		? (record[propsKey] as
				| { onClick?: (event: { stopPropagation(): void; preventDefault(): void }) => void }
				| undefined)
		: undefined;
	if (!props?.onClick) throw new Error("element onClick not found");
	await act(async () => props.onClick?.({ stopPropagation: () => {}, preventDefault: () => {} }));
	await flush();
}

/** Drive an element's React onContextMenu (linkedom has no synthetic event system). */
async function rightClick(element: TestElement): Promise<void> {
	const record = element as unknown as Record<string, unknown>;
	const propsKey = Object.getOwnPropertyNames(record).find(key => key.startsWith("__reactProps$"));
	const props = propsKey
		? (record[propsKey] as
				| { onContextMenu?: (event: { clientX: number; clientY: number; preventDefault(): void }) => void }
				| undefined)
		: undefined;
	if (!props?.onContextMenu) throw new Error("element onContextMenu not found");
	await act(async () => props.onContextMenu?.({ clientX: 80, clientY: 40, preventDefault: () => {} }));
	await flush();
}

/** Drive an element's React onMouseEnter (linkedom has no layout/event system). */
async function mouseEnter(element: TestElement): Promise<void> {
	const record = element as unknown as Record<string, unknown>;
	const propsKey = Object.getOwnPropertyNames(record).find(key => key.startsWith("__reactProps$"));
	const props = propsKey
		? (record[propsKey] as { onMouseEnter?: (event: { currentTarget: TestElement }) => void } | undefined)
		: undefined;
	if (!props?.onMouseEnter) throw new Error("element onMouseEnter not found");
	await act(async () => props.onMouseEnter?.({ currentTarget: element }));
}

function menuItem(label: string): TestElement | null {
	return (
		(document.body as unknown as TestElement)
			.querySelectorAll('[role="menuitem"]')
			.find(item => item.textContent?.trim() === label) ?? null
	);
}

function chips(): TestElement[] {
	return container.querySelectorAll('[role="tab"]');
}

function tabTitles(): Array<string | null> {
	return chips().map(chip => chip.querySelector("[data-tab-title]")?.textContent ?? null);
}

function tabWorkspaces(): Array<string | null> {
	return chips().map(chip => chip.querySelector("[data-tab-workspace]")?.textContent ?? null);
}

afterEach(async () => {
	if (root) {
		await act(async () => {
			root.unmount();
		});
	}
	container?.remove();
	useTabsStore.getState().reset();
	useComposerStore.getState().reset();
	useSessionStore.getState().reset();
	useSidebarPrefs.getState().reset();
	useMessagesStore.getState().reset();
	useTodoStore.getState().reset();
	useQueueStore.setState({ steering: [], followUp: [] });
	useSubagentsStore.getState().reset();
	useModelStore.getState().reset();
	useToolsStore.getState().reset();
	// The arm-confirm and worktree-prompt flags live in the UI store; a chip left
	// armed by the previous test renders ✓/✕ instead of ×, so the next test's
	// `[aria-label="Close tab"]` query finds nothing.
	useUiStore.setState({ armedCloseTab: null, worktreeClosePrompt: null });
	vi.restoreAllMocks();
	omp = installMockOmp();
});

omp = installMockOmp();

describe("TabBar", () => {
	it("uses the restored session path before session_info arrives and matches the sidebar title", async () => {
		const firstMessage = "当前本地已修改代码,是否可以合并到 main 分支并完成全部验证";
		omp.sessions.list.mockResolvedValue([listedSession("s-infron", { firstMessage, messageCount: 2 })]);
		useTabsStore.setState({
			tabs: [
				{
					kind: "agent",
					id: "t0",
					// Exact restore race: GET_TABS already knows the transcript path,
					// but session_info_update has not supplied sessionId/title yet.
					sessionPath: "/sessions/s-infron.jsonl",
					cwd: "/work/infron",
					status: "ready",
					unreadDone: false,
				},
			],
			activeTabId: "t0",
			bundles: new Map(),
		});

		await mount(<TabBar />);

		expect(chips()[0]?.textContent).toContain(firstMessage);
		expect(chips()[0]?.getAttribute("title")).toBe(`${firstMessage} — infron`);
		expect(chips()[0]?.querySelector(".truncate")).not.toBeNull();
	});

	it("removes a truly empty startup placeholder after a real session tab exists", async () => {
		omp.sessions.list.mockResolvedValue([
			listedSession("s-empty"),
			listedSession("s-real", { firstMessage: "Real work", messageCount: 2 }),
		]);
		useTabsStore.setState({
			tabs: [
				{
					kind: "chat",
					id: "t-empty",
					sessionId: "s-empty",
					cwd: "/neutral",
					status: "ready",
					placeholder: true,
					unreadDone: false,
				},
				{
					kind: "agent",
					id: "t-real",
					sessionId: "s-real",
					cwd: "/work/infron",
					status: "ready",
					placeholder: false,
					unreadDone: false,
				},
			],
			activeTabId: "t-real",
			bundles: new Map(),
		});

		await mount(<TabBar />);
		await flush();

		expect(omp.tabs.close).toHaveBeenCalledWith("t-empty");
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t-real"]);
	});

	it("keeps an empty startup tab when it contains an unsent draft", async () => {
		omp.sessions.list.mockResolvedValue([
			listedSession("s-empty"),
			listedSession("s-real", { firstMessage: "Real work", messageCount: 2 }),
		]);
		useTabsStore.setState({
			tabs: [
				{
					kind: "chat",
					id: "t-empty",
					sessionId: "s-empty",
					cwd: "/neutral",
					status: "ready",
					placeholder: true,
					unreadDone: false,
				},
				{
					kind: "agent",
					id: "t-real",
					sessionId: "s-real",
					cwd: "/work/infron",
					status: "ready",
					placeholder: false,
					unreadDone: false,
				},
			],
			activeTabId: "t-empty",
			bundles: new Map(),
		});
		useComposerStore.getState().setDraft("do not lose this");

		await mount(<TabBar />);
		await flush();

		expect(omp.tabs.close).not.toHaveBeenCalled();
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t-empty", "t-real"]);
	});

	it("renders one chip per tab with title or cwd basename and marks the active tab", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/work/alpha", status: "ready", title: "Alpha plan", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/work/beta", status: "ready", unreadDone: false },
			],
			activeTabId: "t1",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		const rendered = chips();
		expect(rendered).toHaveLength(2);
		expect(rendered[0]?.textContent).toContain("Alpha plan");
		// No title → cwd basename fallback.
		expect(rendered[1]?.textContent).toContain("beta");
		expect(rendered[1]?.getAttribute("aria-selected")).toBe("true");
		expect(rendered[0]?.getAttribute("aria-selected")).toBe("false");
		expect(tabWorkspaces()).toEqual(["alpha", "beta"]);
	});

	it("keeps chips fixed-width and only arms hover scrolling for an overflowing title", async () => {
		useTabsStore.setState({
			tabs: [
				{
					kind: "agent",
					id: "t0",
					cwd: "/work/alpha",
					status: "ready",
					title: "A deliberately long session title",
					unreadDone: false,
				},
				{ kind: "agent", id: "t1", cwd: "/work/beta", status: "ready", title: "Short", unreadDone: false },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		const [longChip, shortChip] = chips();
		expect([longChip, shortChip].every(chip => chip?.getAttribute("class")?.split(/\s+/).includes("w-44"))).toBe(
			true,
		);
		const longTitle = longChip?.querySelector("[data-tab-title-wrap]");
		const longScroller = longTitle?.querySelector("[data-tab-title-scroll]");
		const shortTitle = shortChip?.querySelector("[data-tab-title-wrap]");
		const shortScroller = shortTitle?.querySelector("[data-tab-title-scroll]");
		if (!longTitle || !longScroller || !shortTitle || !shortScroller)
			throw new Error("tab title scrollers not rendered");
		Object.defineProperty(longTitle, "clientWidth", { configurable: true, value: 100 });
		Object.defineProperty(longScroller, "scrollWidth", { configurable: true, value: 240 });
		Object.defineProperty(shortTitle, "clientWidth", { configurable: true, value: 100 });
		Object.defineProperty(shortScroller, "scrollWidth", { configurable: true, value: 80 });

		await mouseEnter(longTitle);
		await mouseEnter(shortTitle);

		expect(longTitle.getAttribute("data-overflowing")).toBe("true");
		expect((longTitle as unknown as HTMLElement).style.getPropertyValue("--omp-tab-title-overflow")).toBe("140px");
		expect(shortTitle.getAttribute("data-overflowing")).toBe("false");
	});

	it("hides the close button at the single-tab floor and shows it with two tabs", async () => {
		useTabsStore.setState({
			tabs: [{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false }],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);
		expect(container.querySelectorAll('[role="tab"] button')).toHaveLength(0);

		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/beta", status: "ready", unreadDone: false },
			],
		});
		await flush();
		expect(container.querySelectorAll('[role="tab"] button').length).toBeGreaterThan(0);
	});

	it("renders slow vertical signal lights for running and completed tabs", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "running", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/beta", status: "ready", unreadDone: true },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		const rendered = chips();
		expect(rendered.every(chip => chip.querySelector(".omp-tab-signal") !== null)).toBe(true);
		expect(rendered.every(chip => chip.getAttribute("class")?.includes("overflow-hidden"))).toBe(true);
		expect(rendered.every(chip => !chip.getAttribute("class")?.includes("rounded"))).toBe(true);
		expect(rendered[0]?.querySelector(".omp-signal-light--active")).not.toBeNull();
		expect(rendered[1]?.querySelector(".omp-signal-light--active")).toBeNull();
		expect(rendered[0]?.querySelector('[aria-label="Working"]')).not.toBeNull();
		expect(rendered[1]?.querySelector('[aria-label="Run completed"]')).not.toBeNull();
		expect(rendered.every(chip => chip.getAttribute("draggable") === "true")).toBe(true);
	});

	it("right-click creates and removes a two-session split without changing either runtime", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/beta", status: "ready", unreadDone: false },
			],
			activeTabId: "t0",
			split: null,
			bundles: new Map(),
		});
		await mount(<TabBar />);

		await rightClick(chips()[1]!);
		await click(menuItem("Split right")!);
		expect(useTabsStore.getState()).toMatchObject({
			activeTabId: "t1",
			split: { axis: "columns", firstTabId: "t0", secondTabId: "t1", ratio: 0.5 },
		});
		expect(omp.tabs.setView).toHaveBeenCalledWith("t1", ["t0", "t1"], {
			axis: "columns",
			firstTabId: "t0",
			secondTabId: "t1",
			ratio: 0.5,
		});

		await rightClick(chips()[1]!);
		await click(menuItem("Exit split view")!);
		expect(useTabsStore.getState().split).toBeNull();
		expect(omp.tabs.setActive).toHaveBeenLastCalledWith("t1");
	});

	it("right-click closes tabs to either side or replaces all original tabs", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/beta", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t2", cwd: "/gamma", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t3", cwd: "/delta", status: "ready", unreadDone: false },
			],
			activeTabId: "t2",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		await rightClick(chips()[2]!);
		expect(menuItem("Close tabs to the left")).not.toBeNull();
		expect(menuItem("Close tabs to the right")).not.toBeNull();
		expect(menuItem("Close all tabs")).not.toBeNull();
		await click(menuItem("Close tabs to the left")!);
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t2", "t3"]);

		await rightClick(chips()[0]!);
		await click(menuItem("Close tabs to the right")!);
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t2"]);

		await rightClick(chips()[0]!);
		await click(menuItem("Close all tabs")!);
		await flush();
		expect(omp.tabs.spawn).toHaveBeenCalledWith({ cwd: "/gamma", sessionPath: undefined, kind: "agent" });
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t9"]);
		expect(omp.tabs.close.mock.calls.map(([id]) => id)).toEqual(["t0", "t1", "t3", "t2"]);
	});

	it("clicking a chip switches tabs; the + button spawns a new tab in the current cwd", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/beta", status: "ready", unreadDone: false },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		// Hydrate on the switch pulls the target sidecar's state — its cwd is
		// what the + button reuses for the fresh tab.
		omp.rpc.getState.mockResolvedValue(
			ok({
				sessionId: "srv",
				sessionName: null,
				sessionFile: null,
				cwd: "/beta",
				isStreaming: false,
				isCompacting: false,
				contextUsage: null,
				messageCount: 0,
				queuedMessageCount: 0,
				planModeEnabled: false,
				todoPhases: [],
			}),
		);
		await mount(<TabBar />);

		await click(chips()[1]!);
		expect(omp.tabs.setActive).toHaveBeenCalledWith("t1");
		expect(useTabsStore.getState().activeTabId).toBe("t1");

		const plus = container.querySelector('[aria-label="New Agent Tab"]');
		expect(plus).not.toBeNull();
		await click(plus!);
		// One click = agent tab directly (the dominant path).
		expect(omp.tabs.spawn).toHaveBeenCalledWith({ cwd: "/beta", sessionPath: undefined, kind: "agent" });
	});

	it("the chat button spawns a chat tab in one click", async () => {
		useTabsStore.setState({
			tabs: [{ kind: "agent", id: "t0", cwd: "/beta", status: "ready", unreadDone: false }],
			activeTabId: "t0",
			bundles: new Map(),
		});
		useSessionStore.setState({ cwd: "/beta" });
		await mount(<TabBar />);

		const chatButton = container.querySelector('[aria-label="New Chat Tab"]');
		expect(chatButton).not.toBeNull();
		await click(chatButton!);
		expect(omp.tabs.spawn).toHaveBeenCalledWith({ cwd: "/beta", sessionPath: undefined, kind: "chat" });
	});

	it("agent and chat creation buttons are visible with labeled affordances", async () => {
		useTabsStore.setState({
			tabs: [{ kind: "agent", id: "t0", cwd: "/beta", status: "ready", unreadDone: false }],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		// Discoverability contract: both session types are one visible click away —
		// nothing behind right-click or a collapsed menu.
		expect(container.querySelector('[aria-label="New Agent Tab"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="New Chat Tab"]')).not.toBeNull();
		expect(container.querySelector('[role="menu"]')).toBeNull();
	});

	it("clicking a background chip's close releases it without switching", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/beta", status: "ready", unreadDone: false },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		const close = chips()[1]?.querySelector("button");
		expect(close).not.toBeNull();
		await click(close!);

		expect(omp.tabs.close).toHaveBeenCalledWith("t1");
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t0"]);
		expect(useTabsStore.getState().activeTabId).toBe("t0");
		expect(omp.tabs.setActive).not.toHaveBeenCalled();
	});
});

describe("TabBar close confirm", () => {
	const sleep = (ms: number) => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, ms);
		return promise;
	};

	function seedRunning(): void {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/beta", status: "running", unreadDone: false },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
	}

	it("closing a running tab arms an inline confirm; the ✓ executes the close", async () => {
		seedRunning();
		await mount(<TabBar />);

		await click(chips()[1]!.querySelector('[aria-label="Close tab"]')!);

		// Armed, not executed: the chip swaps its label for the warning + ✓/✕.
		expect(omp.tabs.close).not.toHaveBeenCalled();
		expect(chips()[1]?.textContent).toContain("Close tab? The running task will be aborted");
		expect(chips()[1]?.querySelector('[aria-label="Close tab"]')).toBeNull();

		await click(chips()[1]!.querySelector('[aria-label="Confirm"]')!);

		expect(omp.tabs.close).toHaveBeenCalledWith("t1");
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t0"]);
	});

	it("the ✕ cancels the armed close and restores the chip", async () => {
		seedRunning();
		await mount(<TabBar />);

		await click(chips()[1]!.querySelector('[aria-label="Close tab"]')!);
		expect(chips()[1]?.textContent).toContain("Close tab? The running task will be aborted");

		await click(chips()[1]!.querySelector('[aria-label="Cancel"]')!);

		expect(omp.tabs.close).not.toHaveBeenCalled();
		expect(chips()[1]?.textContent).not.toContain("Close tab? The running task will be aborted");
		expect(chips()[1]?.querySelector('[aria-label="Close tab"]')).not.toBeNull();
	});

	it("the armed close auto-cancels after the timeout", async () => {
		// Real timers + a short injected window (bun-test compatible).
		seedRunning();
		await mount(<TabBar confirmCloseMs={25} />);

		await click(chips()[1]!.querySelector('[aria-label="Close tab"]')!);
		expect(chips()[1]?.textContent).toContain("Close tab? The running task will be aborted");

		await act(async () => {
			await sleep(60);
		});

		expect(omp.tabs.close).not.toHaveBeenCalled();
		expect(chips()[1]?.querySelector('[aria-label="Confirm"]')).toBeNull();
		expect(chips()[1]?.querySelector('[aria-label="Close tab"]')).not.toBeNull();
	});

	it("a starting tab arms, and so does the active tab's live stream", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/beta", status: "starting", unreadDone: false },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		// t1's sidecar is still booting — closing kills the launch, so it arms.
		await click(chips()[1]!.querySelector('[aria-label="Close tab"]')!);
		expect(omp.tabs.close).not.toHaveBeenCalled();
		expect(chips()[1]?.textContent).toContain("Close tab? The running task will be aborted");

		// The active tab's status push says ready, but the foreground stream is
		// live — foreground knowledge wins and the close arms.
		useSessionStore.setState({ isStreaming: true });
		await flush();
		await click(chips()[0]!.querySelector('[aria-label="Close tab"]')!);
		expect(omp.tabs.close).not.toHaveBeenCalled();
		expect(chips()[0]?.textContent).toContain("Close tab? The running task will be aborted");
	});

	it("closing an idle tab is immediate, active tab included", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/beta", status: "ready", unreadDone: false },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		// The active-but-idle tab closes with no confirm interlude.
		await click(chips()[0]!.querySelector('[aria-label="Close tab"]')!);
		expect(omp.tabs.close).toHaveBeenCalledWith("t0");
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t1"]);
	});

	it("⌘W and File → Close Tab leave the chip in exactly the × confirm state", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "running", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/beta", status: "ready", unreadDone: false },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		// The keystroke goes through the same rules as the button, so the chip the
		// user sees after ⌘W is the armed one — no second, divergent confirm UI.
		expect(closeActiveTab()).toBe("armed");
		await flush();
		expect(chips()[0]?.querySelector('[aria-label="Close tab"]')).toBeNull();
		expect(chips()[0]?.textContent).toContain("Close tab? The running task will be aborted");
		expect(useUiStore.getState().armedCloseTab).toEqual({ tabId: "t0" });

		// ✓ on that chip finishes the close.
		await click(chips()[0]!.querySelector('[aria-label="Confirm"]')!);
		expect(omp.tabs.close).toHaveBeenCalledWith("t0");
		expect(useUiStore.getState().armedCloseTab).toBeNull();
	});

	it("an idle worktree tab's × routes to the cleanup prompt, never straight to close (plan/20)", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/alpha", status: "ready", unreadDone: false },
				{
					kind: "agent",
					id: "t1",
					cwd: "/wt/gui-fix-deadbeef",
					status: "ready",
					unreadDone: false,
					worktree: { name: "fix", branch: "omp/gui/fix", baseCwd: "/alpha" },
				},
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		// The chip carries the worktree marker + branch tooltip…
		expect(chips()[1]?.getAttribute("title")).toBe("fix — gui-fix-deadbeef — omp/gui/fix");
		expect(chips()[1]?.textContent).toContain("fix");

		// …and its × opens the cleanup prompt WITHOUT closing the tab.
		await click(chips()[1]!.querySelector('[aria-label="Close tab"]')!);
		expect(omp.tabs.close).not.toHaveBeenCalled();
		expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["t0", "t1"]);
		expect(useUiStore.getState().worktreeClosePrompt).toEqual({ tabId: "t1" });
	});
});

describe("TabBar chip labels (F-HYDRATE)", () => {
	it("disambiguates identical untitled labels with an index suffix in tab order", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/work/gui", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/other/gui", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t2", cwd: "/tmp/gui", status: "ready", unreadDone: false },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		const rendered = chips();
		expect(rendered).toHaveLength(3);
		// First occurrence stays bare; later collisions number from #2.
		expect(tabTitles()).toEqual(["gui", "gui #2", "gui #3"]);
		expect(tabWorkspaces()).toEqual(["gui", "gui", "gui"]);
	});

	it("prefers the session title and never suffixes titled tabs", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/work/gui", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/other/gui", status: "ready", title: "Release plan", unreadDone: false },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		// The titled tab left the collision set, so the untitled chip stays bare.
		expect(tabTitles()).toEqual(["gui", "Release plan"]);
	});

	it("drops the suffix once a colliding tab gains a title", async () => {
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t0", cwd: "/work/gui", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t1", cwd: "/other/gui", status: "ready", unreadDone: false },
			],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);
		expect(tabTitles()).toEqual(["gui", "gui #2"]);

		// The auto-title arrives via TAB_STATUS: labels recompute immediately.
		useTabsStore
			.getState()
			.applyTabStatus({ kind: "agent", tabId: "t1", cwd: "/other/gui", status: "ready", title: "Fix races" });
		await flush();
		expect(tabTitles()).toEqual(["gui", "Fix races"]);
	});

	it("uses the sidebar workspace alias as the visible tab subtitle", async () => {
		useSidebarPrefs.setState({ groupAliases: { "/work/infron": "Production API" } });
		useTabsStore.setState({
			tabs: [{ kind: "agent", id: "t0", cwd: "/work/infron", status: "ready", unreadDone: false }],
			activeTabId: "t0",
			bundles: new Map(),
		});
		await mount(<TabBar />);

		expect(tabWorkspaces()).toEqual(["Production API"]);
	});
});
