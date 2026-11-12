import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { defaultChords, SHORTCUT_ENTRIES } from "../../lib/keymap";
import { useUiStore } from "../../stores/ui";
import { HotkeysDialog } from "./HotkeysDialog";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");

const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

async function mount(): Promise<void> {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<HotkeysDialog open />
			</I18nProvider>,
		);
	});
	await flush();
}

/** The chord of every rendered row, in document order (the panel portals to body). */
function displayedChords(): string[] {
	return [...document.body.querySelectorAll("kbd")].map(cell => cell.textContent ?? "");
}

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	document.body.innerHTML = "";
	useUiStore.setState({ keymapOverrides: {}, keymapDisabled: [] });
});

describe("HotkeysDialog", () => {
	it("renders one row for every shortcut the app owns", async () => {
		// The dialog is derived from the keymap tables. A row missing here is a
		// shortcut nobody can discover, and a duplicated one lists one key twice.
		await mount();
		const chords = displayedChords();
		for (const entry of SHORTCUT_ENTRIES) {
			const displayed = defaultChords(entry).join(" / ");
			expect(
				chords.filter(chord => chord === displayed),
				entry.id,
			).toHaveLength(1);
		}
	});

	it("shows a turned-off shortcut as off instead of keys that do nothing", async () => {
		useUiStore.setState({ keymapDisabled: ["window.toggle"] });
		await mount();
		expect(displayedChords()).not.toContain("⇧⌘O");
		expect(document.body.textContent).toContain("Off");
	});

	it("labels every row and group in words, never as a raw translation key", async () => {
		// A label with no locale entry renders its key ("hotkeys.row.newWindow"),
		// which tells the reader nothing about what the chord does.
		await mount();
		const text = document.body.textContent ?? "";
		expect(text.match(/hotkeys\.(row|group)\.[A-Za-z]+/g) ?? []).toEqual([]);
	});

	it("shows a user override instead of the default it replaced", async () => {
		// A remapped action's old chord is dead; listing both tells the user a key
		// works that no longer does.
		useUiStore.setState({ keymapOverrides: { retry: ["⌥⇧R"] } });
		await mount();
		const chords = displayedChords();
		expect(chords).toContain("⌥⇧R");
		expect(chords).not.toContain("⌥R");
	});
});
