/**
 * ApiKeyDialog contract: the pasted key reaches the save callback exactly as
 * typed (the agent trims it), a refusal is shown in the dialog which stays
 * open for another try, success closes it, and a blank key is never sent.
 */
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { ApiKeyDialog } from "./ApiKeyDialog";

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
}

let container: TestElement;
let root: Root;

/** The React props object linkedom elements carry, to drive handlers the DOM cannot dispatch. */
function reactProps(element: TestElement): Record<string, (event: object) => void | Promise<void>> {
	const record = element as unknown as Record<string, unknown>;
	const key = Object.getOwnPropertyNames(record).find(name => name.startsWith("__reactProps$"));
	return (key ? record[key] : {}) as Record<string, (event: object) => void | Promise<void>>;
}

async function typeKey(value: string): Promise<void> {
	const input = document.querySelector("input") as unknown as TestElement & { value: string };
	input.value = value;
	await act(async () => reactProps(input).onChange?.({ target: input, currentTarget: input }));
}

async function submit(): Promise<void> {
	const form = document.querySelector("form") as unknown as TestElement;
	await act(async () => reactProps(form).onSubmit?.({ preventDefault() {} }));
}

async function mount(onSave: (key: string) => Promise<string | null>, onClose: () => void): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<ApiKeyDialog onClose={onClose} onSave={onSave} open providerName="Anthropic" />
			</I18nProvider>,
		);
	});
}

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("ApiKeyDialog", () => {
	it("sends the typed key, closes on success, and masks it until revealed", async () => {
		const onSave = vi.fn(async () => null);
		const onClose = vi.fn();
		await mount(onSave, onClose);
		expect(document.querySelector("input")?.getAttribute("type")).toBe("password");

		await typeKey("sk-test-123");
		await submit();

		expect(onSave).toHaveBeenCalledExactlyOnceWith("sk-test-123");
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("shows a refusal and stays open so the key can be corrected", async () => {
		const onSave = vi.fn(async () => "That key was not accepted");
		const onClose = vi.fn();
		await mount(onSave, onClose);

		await typeKey("sk-wrong");
		await submit();

		expect(document.body.textContent).toContain("That key was not accepted");
		expect(onClose).not.toHaveBeenCalled();
	});

	it("never submits a blank key", async () => {
		const onSave = vi.fn(async () => null);
		await mount(onSave, vi.fn());

		await typeKey("   ");
		await submit();

		expect(onSave).not.toHaveBeenCalled();
	});
});
