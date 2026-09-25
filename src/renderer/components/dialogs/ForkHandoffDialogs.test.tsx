/**
 * DOM smoke tests for the handoff dialog: open-state store wiring, handoff
 * RPC invocation, streaming/empty guards, and success toasts. Rendered with
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
	fork: Mock<() => Promise<RpcResponse>>;
	handoff: Mock<(customInstructions?: string) => Promise<RpcResponse>>;
	getState: Mock<() => Promise<RpcResponse>>;
	getTranscript: Mock<() => Promise<RpcResponse>>;
	getSubagents: Mock<() => Promise<RpcResponse>>;
	setSubagentSubscription: Mock<(level: string) => Promise<RpcResponse>>;
}

function installMockOmp(overrides: Partial<MockRpc> = {}): MockRpc {
	const rpc: MockRpc = {
		fork: vi.fn(async () => success({})),
		handoff: vi.fn(async () => success({ savedPath: undefined })),
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
	it("explains handoff and submits custom instructions", async () => {
		useSessionStore.setState({ isStreaming: false, messageCount: 5 });
		const rpc = installMockOmp({ handoff: vi.fn(async () => success({ savedPath: "/tmp/handoff.md" })) });
		openHandoffDialog();
		await mount(<HandoffDialog />);

		expect(document.body.textContent).toContain("Handoff to New Session");
		expect(document.body.textContent).toContain("handoff document");

		const submit = buttonWithText("Start Handoff");
		expect(submit).toBeDefined();
		if (!submit) return;
		expect(submit.disabled).toBe(false);

		await act(async () => {
			click(submit);
		});
		await flush();

		// Empty instructions are sent as undefined.
		expect(rpc.handoff).toHaveBeenCalledTimes(1);
		expect(rpc.handoff).toHaveBeenCalledWith(undefined);
		expect(rpc.getState).toHaveBeenCalled();
		expect(useForkHandoffStore.getState().handoffDialogOpen).toBe(false);
		const toasts = useToastStore.getState().toasts;
		expect(
			toasts.some(toastItem => toastItem.variant === "success" && toastItem.title === "New session started"),
		).toBe(true);
	});

	it("is disabled with a reason while the agent is streaming", async () => {
		useSessionStore.setState({ isStreaming: true, messageCount: 5 });
		const rpc = installMockOmp();
		openHandoffDialog();
		await mount(<HandoffDialog />);

		expect(document.body.textContent).toContain("unavailable while the agent is responding");
		const submit = buttonWithText("Start Handoff");
		expect(submit).toBeDefined();
		if (!submit) return;
		expect(submit.disabled).toBe(true);

		await act(async () => {
			click(submit);
		});
		await flush();
		expect(rpc.handoff).not.toHaveBeenCalled();
	});

	it("is disabled with a reason when the session has no messages", async () => {
		useSessionStore.setState({ isStreaming: false, messageCount: 0 });
		const rpc = installMockOmp();
		openHandoffDialog();
		await mount(<HandoffDialog />);

		expect(document.body.textContent).toContain("no context to hand off");
		const submit = buttonWithText("Start Handoff");
		expect(submit).toBeDefined();
		if (!submit) return;
		expect(submit.disabled).toBe(true);
		expect(rpc.handoff).not.toHaveBeenCalled();
	});

	it("keeps the dialog open and shows an inline error on RPC failure", async () => {
		useSessionStore.setState({ isStreaming: false, messageCount: 5 });
		const rpc = installMockOmp({ handoff: vi.fn(async () => failure("handoff exploded")) });
		openHandoffDialog();
		await mount(<HandoffDialog />);

		const submit = buttonWithText("Start Handoff");
		if (!submit) throw new Error("submit missing");
		await act(async () => {
			click(submit);
		});
		await flush();

		expect(rpc.handoff).toHaveBeenCalledTimes(1);
		expect(useForkHandoffStore.getState().handoffDialogOpen).toBe(true);
		expect(document.body.textContent).toContain("handoff exploded");
		expect(useToastStore.getState().toasts.some(toastItem => toastItem.variant === "success")).toBe(false);
	});
	it("retries opening the continuation after a failed fork without generating another summary", async () => {
		useSessionStore.setState({ sessionId: "s1", isStreaming: false, messageCount: 5 });
		const rpc = installMockOmp({
			fork: vi
				.fn()
				.mockResolvedValueOnce(failure("disk full"))
				.mockResolvedValueOnce(success({ cancelled: false })),
			getState: vi.fn(async () => success({ sessionId: "s1", todoPhases: [], messageCount: 5 })),
		});
		openHandoffDialog();
		await mount(<HandoffDialog />);
		await act(async () => {
			click(buttonWithText("Start Handoff")!);
		});
		await flush();
		expect(document.body.textContent).toContain("disk full");
		expect(useForkHandoffStore.getState().handoffDialogOpen).toBe(true);
		const retry = Array.from(document.querySelectorAll("button")).find(button =>
			button.textContent?.includes("Continue from saved handoff"),
		);
		if (!retry) throw new Error("retry missing");
		await act(async () => {
			retry.dispatchEvent(new Event("click", { bubbles: true }));
		});
		await flush();
		expect(rpc.handoff).toHaveBeenCalledTimes(1);
		expect(rpc.fork).toHaveBeenCalledTimes(2);
		expect(useForkHandoffStore.getState().handoffDialogOpen).toBe(false);
	});
});
