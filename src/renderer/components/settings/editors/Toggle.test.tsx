/**
 * Toggle contract: a change confirms itself beside the label, but a save that
 * fails or is not in effect yet (onChange rejects or resolves false) must not
 * claim "Saved".
 */
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../lib/i18n";
import { Toggle } from "./Toggle";

const { document, window, Event, CustomEvent, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.CustomEvent = CustomEvent;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;

interface TestElement {
	textContent: string | null;
	remove(): void;
}

let container: TestElement;
let root: Root;

async function mount(onChange: (value: boolean) => void | Promise<unknown>): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<Toggle checked={false} label="Show usage" onChange={onChange} />
			</I18nProvider>,
		);
	});
}

async function press(): Promise<void> {
	const button = document.querySelector("button") as unknown as TestElement;
	const record = button as unknown as Record<string, unknown>;
	const key = Object.getOwnPropertyNames(record).find(name => name.startsWith("__reactProps$"));
	const props = (key ? record[key] : {}) as { onClick?: () => void };
	await act(async () => props.onClick?.());
}

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("Toggle", () => {
	it("confirms a change, and not before it is made", async () => {
		const onChange = vi.fn();
		await mount(onChange);
		expect(container.textContent).not.toContain("Saved");

		await press();

		expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
		expect(container.textContent).toContain("Saved");
	});

	it.each([
		["rejects", () => Promise.reject(new Error("write failed"))],
		["resolves false (failed, or reported by its row)", () => Promise.resolve(false)],
	])("does not claim Saved when the save %s", async (_case, onChange) => {
		await mount(onChange);

		await press();

		expect(container.textContent).not.toContain("Saved");
	});
});
