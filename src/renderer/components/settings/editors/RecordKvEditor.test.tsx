/**
 * RecordKvEditor tests: the row editor commits whole records on change, so the
 * contract these defend is that an edit never destroys a neighbouring entry —
 * renaming a key onto one that already exists must be refused, not silently
 * written over.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, translate } from "../../../lib/i18n";
import { RecordKvEditor } from "./RecordKvEditor";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
Object.assign(globalThis as Record<string, unknown>, {
	document,
	window,
	Event,
	HTMLElement,
	Element,
	Node,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const committed: Record<string, unknown>[] = [];
const onCommit = vi.fn((next: Record<string, unknown>) => committed.push(next));

let root: Root;

async function mount(value: Record<string, unknown>): Promise<void> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<RecordKvEditor onCommit={onCommit} value={value} />
			</I18nProvider>,
		);
	});
}

/** Key inputs come first in each row: [key, value, key, value, …]. */
function keyInput(index: number): HTMLInputElement {
	return document.body.querySelectorAll("input")[index * 2] as unknown as HTMLInputElement;
}

async function rename(index: number, next: string): Promise<void> {
	const input = keyInput(index);
	await act(async () => {
		input.value = next;
		input.dispatchEvent(new window.Event("focusout", { bubbles: true }));
	});
}

afterEach(async () => {
	await act(async () => {
		root?.unmount();
	});
	document.body.innerHTML = "";
	onCommit.mockClear();
	committed.length = 0;
});

describe("RecordKvEditor", () => {
	it("refuses a rename that would overwrite another entry's value", async () => {
		await mount({ alpha: "keep-me", beta: "other" });

		await rename(0, "beta");

		expect(onCommit).not.toHaveBeenCalled();
		expect(committed).toEqual([]);
		expect(document.body.textContent).toContain(translate("settings.editors.kvDuplicateKey", { key: "beta" }));

		// The row stays editable; the next unique name commits normally.
		await rename(0, "gamma");
		expect(committed).toEqual([{ gamma: "keep-me", beta: "other" }]);
	});
});
