/**
 * ForceToolDialog contract: on open it loads the pending force (get_force_tool)
 * and the forceable tools (get_active_tools); applying forces the selected
 * tool (set_force_tool {tool}) and sends the optional prompt as the next turn
 * (TUI `/force:<tool> [prompt]` parity); clearing drops the force
 * (set_force_tool {clear:true}).
 */
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { useToastStore } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { ForceToolDialog } from "./ForceToolDialog";

const { document, window, Event, CustomEvent, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.CustomEvent = CustomEvent;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

const elementPrototype = HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof elementPrototype.focus !== "function") elementPrototype.focus = () => {};

interface TestElement {
	textContent: string | null;
	remove(): void;
	dispatchEvent(event: object): boolean;
}

const ok = (data?: unknown) => ({ type: "response" as const, command: "x", success: true as const, data });

let container: TestElement;
let root: Root;
let rpc: Record<string, Mock>;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

/** Dispatch inside act(); linkedom's Event has a getter-only eventPhase React writes to. */
async function dispatch(target: TestElement, event: InstanceType<typeof Event>): Promise<void> {
	Object.defineProperty(event, "eventPhase", { value: 0, writable: true, configurable: true });
	await act(async () => {
		target.dispatchEvent(event);
	});
}

async function click(element: TestElement): Promise<void> {
	await dispatch(element, new Event("click", { bubbles: true, cancelable: true }));
	await flush();
}

/** Set a controlled input's value and drive its React onChange contract. */
async function typeInto(element: TestElement, value: string): Promise<void> {
	const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
	if (descriptor?.set) {
		descriptor.set.call(element, value);
	} else {
		(element as unknown as { value: string }).value = value;
	}
	const record = element as unknown as Record<string, unknown>;
	const propsKey = Object.getOwnPropertyNames(record).find(key => key.startsWith("__reactProps$"));
	const props = propsKey ? (record[propsKey] as { onChange?: (event: object) => void } | undefined) : undefined;
	if (props?.onChange) {
		await act(async () => props.onChange?.({ target: element, currentTarget: element }));
		return;
	}
	await dispatch(element, new Event("input", { bubbles: true, cancelable: true }));
}

function buttonWithText(text: string): TestElement | undefined {
	const buttons = Array.from(document.querySelectorAll("button")) as unknown as TestElement[];
	return buttons.find(button => button.textContent?.includes(text));
}

async function mount(): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<ForceToolDialog />
			</I18nProvider>,
		);
	});
	await flush();
}

beforeEach(() => {
	useSessionStore.setState({ status: "ready" });
	rpc = {
		getForceTool: vi.fn(async () => ok({ tool: null })),
		getActiveTools: vi.fn(async () =>
			ok({
				tools: [
					{ name: "read", description: "Read files", source: "builtin" },
					{ name: "write", description: "Write files", source: "builtin" },
				],
			}),
		),
		setForceTool: vi.fn(async () => ok({ tool: "write" })),
		prompt: vi.fn(async () => ok({ agentInvoked: true })),
	};
	(window as unknown as { omp: { rpc: Record<string, Mock> } }).omp = { rpc };
	useUiStore.setState({ forceToolOpen: true });
	useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
	if (root) {
		await act(async () => root.unmount());
	}
	container?.remove();
	useUiStore.setState({ forceToolOpen: false });
	useSessionStore.getState().reset();
});

describe("ForceToolDialog", () => {
	it("loads the tool list and shows no current force", async () => {
		await mount();
		expect(rpc.getForceTool).toHaveBeenCalled();
		expect(rpc.getActiveTools).toHaveBeenCalled();
		const rows = Array.from(document.querySelectorAll("button")) as unknown as TestElement[];
		expect(rows.some(row => row.textContent?.includes("read"))).toBe(true);
		expect(rows.some(row => row.textContent?.includes("write"))).toBe(true);
	});

	it("shows the pending force with a clear action that drops it", async () => {
		rpc.getForceTool.mockResolvedValueOnce(ok({ tool: "write" }));
		rpc.setForceTool.mockResolvedValueOnce(ok({ tool: null }));
		await mount();
		expect(document.body.textContent).toContain("write");
		const clearButton = buttonWithText("Clear");
		expect(clearButton).toBeDefined();
		await click(clearButton!);
		expect(rpc.setForceTool).toHaveBeenCalledWith({ clear: true });
	});

	it("forces the selected tool and sends the optional prompt", async () => {
		await mount();
		await click(buttonWithText("write")!);
		const inputs = Array.from(document.querySelectorAll("input")) as unknown as TestElement[];
		const promptInput = inputs.at(-1)!;
		await typeInto(promptInput, "ship the fix");
		await click(buttonWithText("Force")!);
		expect(rpc.setForceTool).toHaveBeenCalledWith({ tool: "write" });
		expect(rpc.prompt).toHaveBeenCalledWith("ship the fix");
		expect(useUiStore.getState().forceToolOpen).toBe(false);
	});

	it("forces without a prompt when the input is left empty", async () => {
		await mount();
		await click(buttonWithText("read")!);
		await click(buttonWithText("Force")!);
		expect(rpc.setForceTool).toHaveBeenCalledWith({ tool: "read" });
		expect(rpc.prompt).not.toHaveBeenCalled();
	});
});
