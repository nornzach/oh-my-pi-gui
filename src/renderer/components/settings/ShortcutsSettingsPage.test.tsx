/**
 * Settings → Keyboard shortcuts: the switch turns a shortcut off in the saved
 * prefs, recording keys saves them, a chord another binding holds is refused,
 * and a system-wide shortcut another app holds says so. Same linkedom harness
 * as the dialog tests.
 */
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { IpcWindowToggleStatus } from "../../../shared/ipc-types";
import { I18nProvider } from "../../lib/i18n";
import { useUiStore } from "../../stores/ui";
import { ShortcutsSettingsPage } from "./ShortcutsSettingsPage";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;

interface PrefsMock {
	get: Mock<(key?: string) => Promise<unknown>>;
	set: Mock<(key: string, value: unknown) => Promise<void>>;
	windowToggleStatus: Mock<() => Promise<IpcWindowToggleStatus>>;
}

let prefs: PrefsMock;
let container: HTMLElement;
let root: Root;

function install(status: IpcWindowToggleStatus = { accelerator: "CommandOrControl+Shift+O", registered: true }): void {
	prefs = {
		get: vi.fn(async () => undefined),
		set: vi.fn(async () => {}),
		windowToggleStatus: vi.fn(async () => status),
	};
	(window as unknown as { omp: unknown }).omp = { prefs };
}

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
				<ShortcutsSettingsPage />
			</I18nProvider>,
		);
	});
	await flush();
}

function byLabel(label: string): HTMLElement {
	const match = [...document.body.querySelectorAll("button")].find(el => el.getAttribute("aria-label") === label);
	if (!match) throw new Error(`no button labelled ${label}`);
	return match as unknown as HTMLElement;
}

async function click(el: HTMLElement): Promise<void> {
	await act(async () => {
		el.dispatchEvent(new Event("click", { bubbles: true }));
	});
	await flush();
}

async function press(keys: { key: string; code: string; ctrlKey?: boolean; shiftKey?: boolean }): Promise<void> {
	const event = Object.assign(new Event("keydown", { cancelable: true }), {
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		...keys,
	});
	await act(async () => {
		window.dispatchEvent(event);
	});
	await flush();
}

function lastSaved(key: string): unknown {
	const calls = prefs.set.mock.calls.filter(call => call[0] === key);
	return calls[calls.length - 1]?.[1];
}

beforeEach(() => install());

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	document.body.innerHTML = "";
	useUiStore.setState({ keymapOverrides: {}, keymapDisabled: [] });
});

describe("ShortcutsSettingsPage", () => {
	it("turns a shortcut off in the saved prefs and stops offering to change it", async () => {
		await mount();
		const toggle = byLabel("Show or hide the omp window");
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		await click(toggle);
		expect(lastSaved("keymapDisabled")).toEqual(["window.toggle"]);
		expect(byLabel("Show or hide the omp window").getAttribute("aria-checked")).toBe("false");
		expect(byLabel("Change the shortcut for “Show or hide the omp window”").hasAttribute("disabled")).toBe(true);
	});

	it("saves the keys recorded for a shortcut", async () => {
		await mount();
		await click(byLabel("Change the shortcut for “Retry last turn”"));
		await press({ key: "R", code: "KeyR", ctrlKey: true, shiftKey: true });
		expect(lastSaved("keymapOverrides")).toEqual({ retry: ["⇧⌃R"] });
		expect(useUiStore.getState().keymapOverrides).toEqual({ retry: ["⇧⌃R"] });
	});

	it("refuses keys another binding holds and keeps listening", async () => {
		useUiStore.setState({ keymapOverrides: { retry: ["⇧⌃R"] } });
		await mount();
		await click(byLabel("Change the shortcut for “Restore queued messages to composer”"));
		await press({ key: "R", code: "KeyR", ctrlKey: true, shiftKey: true });
		expect(lastSaved("keymapOverrides")).toBeUndefined();
		expect(document.body.textContent).toContain("Already used by “Retry last turn”");
		await press({ key: "D", code: "KeyD", ctrlKey: true, shiftKey: true });
		expect(lastSaved("keymapOverrides")).toEqual({ retry: ["⇧⌃R"], dequeue: ["⇧⌃D"] });
	});

	it("says when another app holds the system-wide shortcut", async () => {
		install({ accelerator: "CommandOrControl+Shift+O", registered: false });
		await mount();
		expect(document.body.textContent).toContain("Another app is already using these keys");
	});
});
