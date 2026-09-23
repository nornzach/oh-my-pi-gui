import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { KEYMAP_ACTIONS, RESERVED_CHORDS } from "../../lib/keymap";
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
	useUiStore.setState({ keymapOverrides: {} });
});

describe("HotkeysDialog", () => {
	it("renders one row for every remappable action and every chord the app owns", async () => {
		// The dialog is derived from the keymap tables. A row missing here is an
		// action nobody can discover or remap, and a duplicated one offers two
		// editors for the same binding.
		await mount();
		const chords = displayedChords();
		for (const action of KEYMAP_ACTIONS) {
			const displayed = action.defaults.join(" / ");
			expect(
				chords.filter(chord => chord === displayed),
				action.id,
			).toHaveLength(1);
		}
		for (const entry of RESERVED_CHORDS) {
			expect(
				chords.filter(chord => chord === entry.chord),
				entry.id,
			).toHaveLength(1);
		}
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
