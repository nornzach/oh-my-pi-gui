/**
 * DOM smoke tests for the handoff dialog: open-state store wiring, handoff
 * RPC invocation, background/cancellation guards, and success toasts. Rendered with
 * react-dom/client into a linkedom document (the repo has no jsdom;
 * renderToStaticMarkup cannot resolve zustand hooks).
 */

import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { closeHandoffDialog, openHandoffDialog, useForkHandoffStore } from "../../stores/fork-handoff";
import { useSessionStore } from "../../stores/session";
import {
	deleteSessionRuntime,
	registerSessionRuntime,
	setFocusedSessionRuntime,
} from "../../stores/session-runtime-context";
import { useToastStore } from "../../stores/toast";
import { HandoffDialog } from "./HandoffDialog";

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
if (typeof elementPrototype.focus !== "function") elementPrototype.focus = () => {};

/** Structural stand-in for linkedom nodes, keeping tests decoupled from its types. */
interface TestElement {
	textContent: string | null;
	className: string;
	disabled: boolean;
	remove: () => void;
	appendChild: (child: TestElement) => void;
	dispatchEvent: (event: object) => boolean;
}

function success(data: unknown): RpcResponse {
	return { type: "response", command: "test", success: true, data };
}

function failure(error: string): RpcResponse {
	return { type: "response", command: "test", success: false, error };
}

interface MockRpc {
	abort: Mock<() => Promise<RpcResponse>>;
	abortCompaction: Mock<() => Promise<RpcResponse>>;
	fork: Mock<() => Promise<RpcResponse>>;
	handoff: Mock<(customInstructions?: string) => Promise<RpcResponse>>;
	getState: Mock<() => Promise<RpcResponse>>;
	getTranscript: Mock<() => Promise<RpcResponse>>;
	getSubagents: Mock<() => Promise<RpcResponse>>;
	setSubagentSubscription: Mock<(level: string) => Promise<RpcResponse>>;
}

function installMockOmp(overrides: Partial<MockRpc> = {}): MockRpc {
	const rpc: MockRpc = {
		abort: vi.fn(async () => success({})),
		abortCompaction: vi.fn(async () => success({})),
		fork: vi.fn(async () => success({})),
		handoff: vi.fn(async () => success({})),
		getState: vi.fn(async () => success({ sessionId: "s2", todoPhases: [], messageCount: 3, queuedMessageCount: 0 })),
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

function buttonWithText(text: string): TestElement | undefined {
	const buttons = Array.from(document.querySelectorAll("button")) as unknown as TestElement[];
	return buttons.find(button => button.textContent?.includes(text));
}

function click(element: TestElement): void {
	element.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
}

afterEach(async () => {
	if (root) {
		await act(async () => {
			root.unmount();
		});
	}
	container?.remove();
	closeHandoffDialog();
	useSessionStore.getState().reset();
	useToastStore.setState({ toasts: [] });
});

describe("fork-handoff store", () => {
	it("opens and closes the handoff dialog", () => {
		expect(useForkHandoffStore.getState().handoffDialogOpen).toBe(false);
		openHandoffDialog();
		expect(useForkHandoffStore.getState().handoffDialogOpen).toBe(true);
		closeHandoffDialog();
		expect(useForkHandoffStore.getState().handoffDialogOpen).toBe(false);
	});
});

describe("HandoffDialog", () => {
	it("accepts Core 19's empty success result without forking or replacing the live session", async () => {
		useSessionStore.setState({ sessionId: "s1", isStreaming: true, messageCount: 5 });
		const rpc = installMockOmp();
		openHandoffDialog();
		await mount(<HandoffDialog />);
		expect(document.body.textContent).toContain("Background Handoff");
		expect(document.body.textContent).toContain("continue in this session");
		const submit = buttonWithText("Start Handoff")!;
		expect(submit.disabled).toBe(false);
		await act(async () => click(submit));
		await flush();
		expect(rpc.handoff).toHaveBeenCalledWith(undefined);
		expect(rpc.fork).not.toHaveBeenCalled();
		expect(rpc.getState).not.toHaveBeenCalled();
		expect(rpc.getTranscript).not.toHaveBeenCalled();
		expect(useSessionStore.getState().sessionId).toBe("s1");
		expect(useSessionStore.getState().isStreaming).toBe(true);
		expect(useForkHandoffStore.getState().handoffDialogOpen).toBe(false);
		expect(useToastStore.getState().toasts.some(item => item.title === "Handoff complete")).toBe(true);
	});

	it.each([
		{ state: { messageCount: 0 }, reason: "no context to hand off" },
		{ state: { messageCount: 5, isCompacting: true }, reason: "Context maintenance is already running" },
		{
			state: { messageCount: 5, manualMaintenance: { kind: "handoff" as const, startedAt: 1 } },
			reason: "Context maintenance is already running",
		},
	])("blocks unavailable context: $reason", async ({ state, reason }) => {
		useSessionStore.setState(state);
		const rpc = installMockOmp();
		openHandoffDialog();
		await mount(<HandoffDialog />);
		expect(document.body.textContent).toContain(reason);
		expect(buttonWithText("Start Handoff")!.disabled).toBe(true);
		expect(rpc.handoff).not.toHaveBeenCalled();
	});

	it("keeps the dialog open and reports RPC failures", async () => {
		useSessionStore.setState({ messageCount: 5 });
		const rpc = installMockOmp({ handoff: vi.fn(async () => failure("handoff exploded")) });
		openHandoffDialog();
		await mount(<HandoffDialog />);
		await act(async () => click(buttonWithText("Start Handoff")!));
		await flush();
		expect(rpc.handoff).toHaveBeenCalledTimes(1);
		expect(useForkHandoffStore.getState().handoffDialogOpen).toBe(true);
		expect(document.body.textContent).toContain("handoff exploded");
		expect(useToastStore.getState().toasts.some(item => item.variant === "success")).toBe(false);
	});

	it("stops only the handoff and keeps the live response running", async () => {
		useSessionStore.setState({ sessionId: "s1", isStreaming: true, messageCount: 5 });
		const summary = Promise.withResolvers<RpcResponse>();
		const rpc = installMockOmp({ handoff: vi.fn(() => summary.promise) });
		openHandoffDialog();
		await mount(<HandoffDialog />);
		await act(async () => click(buttonWithText("Start Handoff")!));
		await act(async () => click(buttonWithText("Stop handoff")!));
		expect(rpc.abortCompaction).toHaveBeenCalledTimes(1);
		expect(rpc.abort).not.toHaveBeenCalled();
		summary.resolve(failure("Compaction cancelled"));
		await flush();
		expect(rpc.fork).not.toHaveBeenCalled();
		expect(useSessionStore.getState().isStreaming).toBe(true);
		expect(buttonWithText("Start Handoff")!.disabled).toBe(false);
		expect(useToastStore.getState().toasts.some(item => item.message === "Handoff cancelled")).toBe(true);
	});

	it("can dismiss and reopen a pending handoff without starting a duplicate", async () => {
		useSessionStore.setState({ messageCount: 5 });
		const summary = Promise.withResolvers<RpcResponse>();
		const rpc = installMockOmp({ handoff: vi.fn(() => summary.promise) });
		openHandoffDialog();
		await mount(<HandoffDialog />);
		await act(async () => click(buttonWithText("Start Handoff")!));
		const closeButton = document.querySelector('button[aria-label="Close"]') as unknown as TestElement;
		expect(closeButton).toBeTruthy();
		await act(async () => click(closeButton));
		expect(useForkHandoffStore.getState().handoffDialogOpen).toBe(false);
		expect(rpc.abortCompaction).not.toHaveBeenCalled();
		await act(async () => openHandoffDialog());
		expect(buttonWithText("Stop handoff")).toBeDefined();
		await act(async () => click(buttonWithText("Start Handoff")!));
		expect(rpc.handoff).toHaveBeenCalledTimes(1);
		summary.resolve(success({}));
		await flush();
		expect(useForkHandoffStore.getState().handoffDialogOpen).toBe(false);
	});

	it("cancels the originating tab even after focus moves to another tab", async () => {
		useSessionStore.setState({ messageCount: 5 });
		installMockOmp();
		const summary = Promise.withResolvers<RpcResponse>();
		const firstCommand = vi.fn((command: { type: string }) =>
			command.type === "handoff" ? summary.promise : Promise.resolve(success({})),
		);
		const secondCommand = vi.fn(async () => success({}));
		registerSessionRuntime({ tabId: "handoff-origin", command: firstCommand, stores: new Map() });
		registerSessionRuntime({ tabId: "handoff-other", command: secondCommand, stores: new Map() });
		try {
			setFocusedSessionRuntime("handoff-origin");
			openHandoffDialog();
			await mount(<HandoffDialog />);
			await act(async () => click(buttonWithText("Start Handoff")!));
			setFocusedSessionRuntime("handoff-other");
			await act(async () => click(buttonWithText("Stop handoff")!));
			expect(firstCommand.mock.calls.map(([command]) => command.type)).toEqual(["handoff", "abort_compaction"]);
			expect(secondCommand).not.toHaveBeenCalled();
			summary.resolve(failure("Compaction cancelled"));
			await flush();
		} finally {
			deleteSessionRuntime("handoff-origin");
			deleteSessionRuntime("handoff-other");
			setFocusedSessionRuntime(null);
		}
	});

	it("reports a failed stop and allows retrying cancellation without aborting the main response", async () => {
		useSessionStore.setState({ messageCount: 5 });
		const summary = Promise.withResolvers<RpcResponse>();
		const rpc = installMockOmp({
			handoff: vi.fn(() => summary.promise),
			abortCompaction: vi.fn().mockResolvedValueOnce(failure("stop failed")).mockResolvedValueOnce(success({})),
		});
		openHandoffDialog();
		await mount(<HandoffDialog />);
		await act(async () => click(buttonWithText("Start Handoff")!));
		await act(async () => click(buttonWithText("Stop handoff")!));
		await flush();
		expect(document.body.textContent).toContain("stop failed");
		expect(buttonWithText("Stop handoff")!.disabled).toBe(false);
		await act(async () => click(buttonWithText("Stop handoff")!));
		expect(rpc.abortCompaction).toHaveBeenCalledTimes(2);
		expect(rpc.abort).not.toHaveBeenCalled();
		summary.resolve(failure("Compaction cancelled"));
		await flush();
	});
});
