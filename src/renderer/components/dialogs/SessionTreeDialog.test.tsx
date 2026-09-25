/**
 * DOM smoke tests for the visual session tree dialog: store wiring, empty
 * state, flat-chain fallback vs rich get_session_tree rendering (nodes, fork
 * edges, HEAD, active-branch highlight), pan/zoom/node-drag interactions, and
 * the branch action. Rendered with react-dom/client into a linkedom document
 * (same harness as ForkHandoffDialogs.test.tsx).
 */

import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { useTabsStore } from "../../stores/tabs";
import { useToastStore } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { SessionTreeDialog } from "./SessionTreeDialog";
import type { SessionTreeResult } from "./session-tree-layout";

const { document, window, Event, CustomEvent, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");

const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.CustomEvent = CustomEvent;
globals.HTMLElement = HTMLElement;
globals.Element = Element;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

const elementPrototype = HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof elementPrototype.scrollIntoView !== "function") elementPrototype.scrollIntoView = () => {};
if (typeof elementPrototype.focus !== "function") elementPrototype.focus = () => {};

/** Structural stand-in for linkedom nodes, keeping tests decoupled from its types. */
interface TestElement {
	textContent: string | null;
	className: string;
	disabled: boolean;
	remove: () => void;
	appendChild: (child: TestElement) => void;
	dispatchEvent: (event: object) => boolean;
	getAttribute: (name: string) => string | null;
	querySelector: (selector: string) => TestElement | null;
}

function success(data: unknown): RpcResponse {
	return { type: "response", command: "test", success: true, data };
}

function failure(error: string): RpcResponse {
	return { type: "response", command: "test", success: false, error };
}

interface MockRpc {
	getBranchMessages: Mock<() => Promise<RpcResponse>>;
	branch: Mock<(entryId: string) => Promise<RpcResponse>>;
	getState: Mock<() => Promise<RpcResponse>>;
	switchLeaf: Mock<
		(entryId: string, options?: { summarize?: boolean; customInstructions?: string }) => Promise<RpcResponse>
	>;
	resumeAfterAskReanswer: Mock<() => Promise<RpcResponse>>;
	getMessages: Mock<() => Promise<RpcResponse>>;
	getTranscript: Mock<() => Promise<RpcResponse>>;
	getSubagents: Mock<() => Promise<RpcResponse>>;
	setSubagentSubscription: Mock<(level: string) => Promise<RpcResponse>>;
	getSessionTree?: Mock<() => Promise<RpcResponse>>;
}

function installMockOmp(overrides: Partial<MockRpc> = {}): MockRpc {
	const rpc: MockRpc = {
		getBranchMessages: vi.fn(async () => success({ messages: [] })),
		branch: vi.fn(async () => success({ text: "", cancelled: false })),
		getState: vi.fn(async () => success({ sessionId: "s2", todoPhases: [], messageCount: 3, queuedMessageCount: 0 })),
		switchLeaf: vi.fn(async () => success({ cancelled: false, activeLeafId: "m1" })),
		resumeAfterAskReanswer: vi.fn(async () => success(undefined)),
		getMessages: vi.fn(async () => success({ messages: [] })),
		getTranscript: vi.fn(async () => success({ messages: [] })),
		getSubagents: vi.fn(async () => success({ subagents: [] })),
		setSubagentSubscription: vi.fn(async () => success({})),
		...overrides,
	};
	// linkedom's window lacks the preload bridge; install the mock OmpApi on it.
	const ompWindow = window as unknown as { omp: { rpc: MockRpc } };
	ompWindow.omp = { rpc };
	return rpc;
}

let container: TestElement;
let root: Root;

beforeEach(() => {
	useSessionStore.setState({ status: "ready" });
});

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

function queryAll(selector: string): TestElement[] {
	return Array.from(document.querySelectorAll(selector)) as unknown as TestElement[];
}

function canvas(): TestElement {
	const el = queryAll('[aria-label="Session tree canvas"]')[0];
	if (!el) throw new Error("canvas not rendered");
	return el;
}

function nodeCards(): TestElement[] {
	return queryAll("[data-tree-node]");
}

function edgePaths(): TestElement[] {
	return queryAll("path").filter(path => path.getAttribute("marker-end") !== null);
}

/** Dispatch an event inside act(); linkedom's Event has a getter-only eventPhase React writes to. */
async function dispatch(target: TestElement, event: InstanceType<typeof Event>): Promise<void> {
	Object.defineProperty(event, "eventPhase", { value: 0, writable: true, configurable: true });
	await act(async () => {
		target.dispatchEvent(event);
	});
}

/** Dispatch a pointer event with the properties React reads patched on. */
async function pointer(
	target: TestElement,
	type: "pointerdown" | "pointermove" | "pointerup",
	x: number,
	y: number,
): Promise<void> {
	const event = new Event(type, { bubbles: true, cancelable: true });
	const patched = event as unknown as {
		button: number;
		clientX: number;
		clientY: number;
		pointerId: number;
	};
	patched.button = 0;
	patched.clientX = x;
	patched.clientY = y;
	patched.pointerId = 1;
	await dispatch(target, event);
}

async function click(element: TestElement): Promise<void> {
	await dispatch(element, new Event("click", { bubbles: true, cancelable: true }));
}

function seedSession(sessionId: string): void {
	useSessionStore.setState({ sessionId, sessionName: "Tree session" });
	useUiStore.getState().openSessionTree();
}

/** Extend the installed mock omp with the tabs/sessions surface the F-OWN guard uses. */
function installOwnerMocks(owner: { tabId: string; winId: number } | null): {
	getSessionOwner: Mock<(sessionPath: string) => Promise<{ tabId: string; winId: number } | null>>;
	setActive: Mock<(tabId: string) => Promise<boolean>>;
	openInNewWindow: Mock<(payload: { sessionPath?: string }) => Promise<boolean>>;
} {
	const getSessionOwner = vi.fn(async () => owner);
	const setActive = vi.fn(async () => true);
	const openInNewWindow = vi.fn(async () => true);
	const ompWindow = window as unknown as { omp: Record<string, unknown> };
	ompWindow.omp = { ...ompWindow.omp, tabs: { getSessionOwner, setActive }, sessions: { openInNewWindow } };
	return { getSessionOwner, setActive, openInNewWindow };
}

/** Node corner menu → "Switch to this point" (switchToLeaf's UI path). */
async function triggerSwitchToThisPoint(entryId: string): Promise<void> {
	const card = nodeCards().find(el => el.getAttribute("data-tree-node") === entryId);
	if (!card) throw new Error(`card ${entryId} not found`);
	const actionButton = card.querySelector("button");
	if (!actionButton) throw new Error("node action button not found");
	await click(actionButton);
	const switchItem = queryAll("button").find(button => button.textContent?.includes("Switch to this point"));
	if (!switchItem) throw new Error("switch action not found");
	await click(switchItem);
	await flush();
	await flush();
}

afterEach(async () => {
	if (root) {
		await act(async () => {
			root.unmount();
		});
	}
	container?.remove();
	useUiStore.getState().closeSessionTree();
	useSessionStore.getState().reset();
	useTabsStore.getState().reset();
	useToastStore.setState({ toasts: [] });
});

describe("SessionTreeDialog", () => {
	it("preserves the empty state", async () => {
		installMockOmp();
		seedSession("tree-empty");
		await mount(<SessionTreeDialog />);
		expect(document.body.textContent).toContain("No messages in this session yet.");
	});

	it("falls back to a flat chain over get_branch_messages when no tree RPC exists", async () => {
		const rpc = installMockOmp({
			getBranchMessages: vi.fn(async () =>
				success({
					messages: [
						{ entryId: "m1", text: "first prompt" },
						{ entryId: "m2", text: "second prompt" },
						{ entryId: "m3", text: "third prompt" },
					],
				}),
			),
		});
		seedSession("tree-chain");
		await mount(<SessionTreeDialog />);
		expect(rpc.getBranchMessages).toHaveBeenCalledTimes(1);
		// Root anchor + three cards + three edges (root→m1→m2→m3), HEAD on the last.
		expect(document.body.textContent).toContain("session start");
		expect(nodeCards().map(card => card.getAttribute("data-tree-node"))).toEqual(["m1", "m2", "m3"]);
		expect(edgePaths()).toHaveLength(3);
		expect(document.body.textContent).toContain("head");
		expect(document.body.textContent).toContain("lineage view");
	});

	it("renders the rich get_session_tree with fork edges and active-branch highlight", async () => {
		const tree: SessionTreeResult = {
			activeLeafId: "c",
			tree: [
				{
					entryId: "a",
					parentId: null,
					role: "user",
					textPreview: "first question",
					timestamp: 1700000000000,
					onActiveBranch: true,
					isLeaf: false,
				},
				{
					entryId: "b",
					parentId: "a",
					role: "assistant",
					textPreview: "first answer",
					timestamp: 1700000001000,
					onActiveBranch: true,
					isLeaf: false,
				},
				{
					entryId: "c",
					parentId: "b",
					role: "user",
					textPreview: "follow up",
					timestamp: 1700000002000,
					label: "experiment",
					onActiveBranch: true,
					isLeaf: true,
				},
				{
					entryId: "d",
					parentId: "b",
					role: "user",
					textPreview: "alternate path",
					timestamp: 1700000003000,
					onActiveBranch: false,
					isLeaf: false,
				},
			],
		};
		installMockOmp({ getSessionTree: vi.fn(async () => success(tree)) });
		seedSession("tree-fork");
		await mount(<SessionTreeDialog />);
		expect(nodeCards()).toHaveLength(4);
		// Edges: root→a, a→b, b→c, b→d (the fork).
		expect(edgePaths()).toHaveLength(4);
		expect(document.body.textContent).toContain("4 messages · 1 fork");
		expect(document.body.textContent).toContain("experiment");
		// Exactly one HEAD badge (Badge root span), and the off-branch card is dimmed.
		expect(
			queryAll("span").filter(el => el.textContent === "head" && el.className.includes("rounded-full")),
		).toHaveLength(1);
		const offBranch = nodeCards().find(card => card.getAttribute("data-tree-node") === "d");
		expect(offBranch?.className).toContain("opacity-75");
	});

	it("drags a node to a cosmetic offset that survives re-render", async () => {
		installMockOmp({
			getBranchMessages: vi.fn(async () =>
				success({
					messages: [
						{ entryId: "m1", text: "alpha" },
						{ entryId: "m2", text: "beta" },
					],
				}),
			),
		});
		seedSession("tree-drag");
		await mount(<SessionTreeDialog />);
		const card = nodeCards().find(el => el.getAttribute("data-tree-node") === "m1");
		if (!card) throw new Error("card m1 not found");
		const before = card.getAttribute("style") ?? "";
		// Initial fit runs at scale 1 for a two-node chain, so screen delta == world delta.
		await pointer(card, "pointerdown", 100, 100);
		await pointer(canvas(), "pointermove", 140, 170);
		await pointer(canvas(), "pointerup", 140, 170);
		await flush();
		const after = card.getAttribute("style") ?? "";
		const px = (style: string, prop: string) => {
			const match = style.match(new RegExp(`${prop}:\\s*(-?\\d+(?:\\.\\d+)?)px`));
			return match ? Number.parseFloat(match[1] ?? "0") : Number.NaN;
		};
		expect(px(after, "left") - px(before, "left")).toBeCloseTo(40, 1);
		expect(px(after, "top") - px(before, "top")).toBeCloseTo(70, 1);
		// The drag was cosmetic: no branch RPC fired.
	});

	it("pans the canvas by dragging the background", async () => {
		installMockOmp({
			getBranchMessages: vi.fn(async () => success({ messages: [{ entryId: "m1", text: "alpha" }] })),
		});
		seedSession("tree-pan");
		await mount(<SessionTreeDialog />);
		const world = queryAll("div").find(el => el.getAttribute("style")?.includes("scale("));
		if (!world) throw new Error("world transform div not found");
		const before = world.getAttribute("style") ?? "";
		await pointer(canvas(), "pointerdown", 300, 300);
		await pointer(canvas(), "pointermove", 250, 340);
		await pointer(canvas(), "pointerup", 250, 340);
		await flush();
		const after = world.getAttribute("style") ?? "";
		expect(after).not.toBe(before);
		expect(after).toContain("scale(");
	});

	it("zooms on wheel and reports the percentage", async () => {
		installMockOmp({
			getBranchMessages: vi.fn(async () => success({ messages: [{ entryId: "m1", text: "alpha" }] })),
		});
		seedSession("tree-zoom");
		await mount(<SessionTreeDialog />);
		expect(document.body.textContent).toContain("100%");
		const wheel = new Event("wheel", { bubbles: true, cancelable: true });
		(wheel as unknown as { deltaY: number }).deltaY = -100;
		await dispatch(canvas(), wheel);
		await flush();
		expect(document.body.textContent).toContain("116%");
	});

	it("branches from a node via the footer detail and closes", async () => {
		const rpc = installMockOmp({
			getBranchMessages: vi.fn(async () =>
				success({
					messages: [
						{ entryId: "m1", text: "alpha prompt" },
						{ entryId: "m2", text: "beta prompt" },
					],
				}),
			),
			branch: vi.fn(async () => success({ text: "restored branch draft", cancelled: false })),
		});
		seedSession("tree-branch");
		await mount(<SessionTreeDialog />);
		let restoredDraft: string | undefined;
		window.addEventListener(
			"omp:fill-composer",
			(event: Event) => {
				restoredDraft = (event as CustomEvent<{ text?: string }>).detail.text;
			},
			{ once: true },
		);
		const card = nodeCards().find(el => el.getAttribute("data-tree-node") === "m1");
		if (!card) throw new Error("card m1 not found");
		// Click (pointerdown+up without movement) selects the node and shows the detail footer.
		await pointer(card, "pointerdown", 100, 100);
		await pointer(canvas(), "pointerup", 100, 100);
		await flush();
		expect(document.body.textContent).toContain("alpha prompt");
		// Target the footer detail's common <Button> (inline-flex), not the per-node
		// hover branch affordance (a custom small button that also reads "Branch").
		const branchButton = queryAll("button").find(
			button => button.textContent?.trim() === "Branch" && button.className.includes("inline-flex"),
		);
		if (!branchButton) throw new Error("footer Branch button not found");
		await click(branchButton);
		await flush();
		await flush();
		expect(rpc.branch).toHaveBeenCalledWith("m1");
		expect(restoredDraft).toBe("restored branch draft");
		expect(rpc.getState).toHaveBeenCalled();
		expect(useUiStore.getState().sessionTreeOpen).toBe(false);
	});

	it("surfaces a branch failure as a toast and stays open", async () => {
		const rpc = installMockOmp({
			getBranchMessages: vi.fn(async () => success({ messages: [{ entryId: "m1", text: "alpha" }] })),
			branch: vi.fn(async () => failure("nope")),
		});
		seedSession("tree-branch-fail");
		await mount(<SessionTreeDialog />);
		const card = nodeCards().find(el => el.getAttribute("data-tree-node") === "m1");
		if (!card) throw new Error("card m1 not found");
		const circleButton = card.querySelector("button");
		if (!circleButton) throw new Error("node action button not found");
		// The corner button opens the node-action menu; branch is a menu item.
		await click(circleButton);
		await flush();
		const branchItem = queryAll("button").find(button => button.textContent?.includes("Branch from here"));
		if (!branchItem) throw new Error("branch menu item not found");
		await click(branchItem);
		await flush();
		expect(rpc.branch).toHaveBeenCalledWith("m1");
		expect(useToastStore.getState().toasts.some(toast => toast.variant === "error")).toBe(true);
		expect(useUiStore.getState().sessionTreeOpen).toBe(true);
	});
	it("hydrates the committed ask re-answer before resuming the agent", async () => {
		const rpc = installMockOmp({
			getBranchMessages: vi.fn(async () => success({ messages: [{ entryId: "m1", text: "choose again" }] })),
			switchLeaf: vi.fn(async () =>
				success({ cancelled: false, activeLeafId: "answer-2", askReanswerCommitted: true }),
			),
		});
		seedSession("tree-reanswer");
		await mount(<SessionTreeDialog />);
		const card = nodeCards().find(el => el.getAttribute("data-tree-node") === "m1");
		if (!card) throw new Error("card m1 not found");
		const actionButton = card.querySelector("button");
		if (!actionButton) throw new Error("node action button not found");
		await click(actionButton);
		const switchItem = queryAll("button").find(button => button.textContent?.includes("Switch to this point"));
		if (!switchItem) throw new Error("switch action not found");
		await click(switchItem);
		await flush();
		await flush();

		expect(rpc.switchLeaf).toHaveBeenCalledWith("m1", undefined);
		expect(rpc.getState).toHaveBeenCalled();
		expect(rpc.resumeAfterAskReanswer).toHaveBeenCalledTimes(1);
		expect(rpc.getState.mock.invocationCallOrder[0]).toBeLessThan(
			rpc.resumeAfterAskReanswer.mock.invocationCallOrder[0]!,
		);
		expect(useUiStore.getState().sessionTreeOpen).toBe(false);
	});

	it("defers switch-leaf to the owning tab when the session file is owned elsewhere (F-OWN)", async () => {
		const rpc = installMockOmp({
			getBranchMessages: vi.fn(async () => success({ messages: [{ entryId: "m1", text: "alpha" }] })),
		});
		// The attached session file is owned by a DIFFERENT tab (diverged state).
		const { getSessionOwner, setActive, openInNewWindow } = installOwnerMocks({ tabId: "t-owner", winId: 1 });
		useSessionStore.setState({ sessionFile: "/sessions/x.jsonl" });
		useTabsStore.setState({
			tabs: [
				{ kind: "agent", id: "t-me", cwd: "/a", status: "ready", unreadDone: false },
				{ kind: "agent", id: "t-owner", cwd: "/a", status: "ready", unreadDone: false },
			],
			activeTabId: "t-me",
			bundles: new Map(),
		});
		seedSession("tree-owned");
		await mount(<SessionTreeDialog />);
		await triggerSwitchToThisPoint("m1");

		expect(getSessionOwner).toHaveBeenCalledWith("/sessions/x.jsonl");
		expect(rpc.switchLeaf).not.toHaveBeenCalled();
		// Owner lives in this window → routed via switchTab (SET_ACTIVE_TAB proof).
		expect(setActive).toHaveBeenCalledWith("t-owner");
		expect(openInNewWindow).not.toHaveBeenCalled();
		expect(useUiStore.getState().sessionTreeOpen).toBe(false);
	});

	it("focuses the foreign owner window for switch-leaf when the owner is in another window", async () => {
		const rpc = installMockOmp({
			getBranchMessages: vi.fn(async () => success({ messages: [{ entryId: "m1", text: "alpha" }] })),
		});
		const { getSessionOwner, setActive, openInNewWindow } = installOwnerMocks({ tabId: "t-elsewhere", winId: 9 });
		useSessionStore.setState({ sessionFile: "/sessions/x.jsonl" });
		useTabsStore.setState({
			tabs: [{ kind: "agent", id: "t-me", cwd: "/a", status: "ready", unreadDone: false }],
			activeTabId: "t-me",
			bundles: new Map(),
		});
		seedSession("tree-foreign-owned");
		await mount(<SessionTreeDialog />);
		await triggerSwitchToThisPoint("m1");

		expect(getSessionOwner).toHaveBeenCalledWith("/sessions/x.jsonl");
		expect(rpc.switchLeaf).not.toHaveBeenCalled();
		expect(setActive).not.toHaveBeenCalled();
		expect(openInNewWindow).toHaveBeenCalledWith({ sessionPath: "/sessions/x.jsonl" });
		expect(useUiStore.getState().sessionTreeOpen).toBe(false);
	});

	it("proceeds with switch-leaf when the current tab owns the session file", async () => {
		const rpc = installMockOmp({
			getBranchMessages: vi.fn(async () => success({ messages: [{ entryId: "m1", text: "alpha" }] })),
		});
		installOwnerMocks({ tabId: "t-me", winId: 1 });
		useSessionStore.setState({ sessionFile: "/sessions/x.jsonl" });
		useTabsStore.setState({
			tabs: [{ kind: "agent", id: "t-me", cwd: "/a", status: "ready", unreadDone: false }],
			activeTabId: "t-me",
			bundles: new Map(),
		});
		seedSession("tree-self-owned");
		await mount(<SessionTreeDialog />);
		await triggerSwitchToThisPoint("m1");

		expect(rpc.switchLeaf).toHaveBeenCalledWith("m1", undefined);
		expect(useUiStore.getState().sessionTreeOpen).toBe(false);
	});
});
