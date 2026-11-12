/**
 * The user's saved shortcuts as the main process applies them: the menu's
 * accelerators and the system-wide show/hide shortcut. The renderer's Keyboard
 * Shortcuts settings page writes the same two prefs keys; ipc.ts calls
 * `applyWindowToggle` and rebuilds the menu whenever either changes.
 */

import { globalShortcut } from "electron";
import Store from "electron-store";
import {
	type KeyboardLayout,
	keyboardLayout,
	keyboardLayoutFrom,
	positionalAccelerator,
	setKeyboardLayout,
} from "../shared/chord";
import { KEYMAP_DISABLED_PREF, KEYMAP_OVERRIDES_PREF, type NativeChordId, nativeAccelerator } from "../shared/hotkeys";
import type { IpcWindowToggleStatus } from "../shared/ipc-types";

// electron-store re-reads the file on every get, so this sees the IPC handler's writes.
const prefs = new Store<Record<string, unknown>>({ name: "prefs" });
const mac = process.platform === "darwin";
// The layout the renderer last reported, kept so the first registration at
// startup already lands on the right key.
const layoutStore = new Store<{ layout?: Record<string, string> }>({ name: "keyboard-layout" });
setKeyboardLayout(storedLayout());

let toggleHandler: (() => void) | null = null;
let registeredAccelerator: string | undefined;
let status: IpcWindowToggleStatus = { registered: false };

/** Accelerator for a native shortcut under the saved prefs; undefined when turned off. */
export function nativeShortcut(id: NativeChordId): string | undefined {
	return nativeAccelerator(id, prefs.get(KEYMAP_OVERRIDES_PREF), prefs.get(KEYMAP_DISABLED_PREF), mac);
}

/** Install the show/hide handler and register it under the saved shortcut. */
export function bindWindowToggle(handler: () => void): void {
	toggleHandler = handler;
	applyWindowToggle();
}

/** Re-register the show/hide shortcut after the saved shortcuts changed. */
export function applyWindowToggle(): IpcWindowToggleStatus {
	if (registeredAccelerator) globalShortcut.unregister(registeredAccelerator);
	registeredAccelerator = undefined;
	const accelerator = nativeShortcut("window.toggle");
	if (!accelerator || !toggleHandler) {
		status = { accelerator, registered: false };
		return status;
	}
	// macOS registers by US key position; Windows and Linux already go by the layout's character.
	const target = mac ? positionalAccelerator(accelerator, keyboardLayout()) : accelerator;
	let registered = false;
	try {
		registered = globalShortcut.register(target, toggleHandler);
	} catch (error) {
		console.warn(`[shortcuts] could not register ${target}:`, error);
	}
	if (registered) registeredAccelerator = target;
	else console.warn(`[shortcuts] ${accelerator} is held by another app; the window shortcut is inactive`);
	status = { accelerator, registered };
	return status;
}

export function windowToggleStatus(): IpcWindowToggleStatus {
	return status;
}

/**
 * The keyboard layout a window read (`navigator.keyboard.getLayoutMap()`): the
 * main process reads built-in browser keystrokes and places the system-wide
 * shortcut by it. Re-registers only when the layout changed.
 */
export function updateKeyboardLayout(raw: unknown): void {
	if (!raw || typeof raw !== "object") return;
	const layout = keyboardLayoutFrom(Object.entries(raw));
	if (sameLayout(layout, keyboardLayout())) return;
	setKeyboardLayout(layout);
	layoutStore.set("layout", layout);
	if (toggleHandler) applyWindowToggle();
}

function storedLayout(): KeyboardLayout {
	const raw = layoutStore.get("layout");
	return raw && typeof raw === "object" ? keyboardLayoutFrom(Object.entries(raw)) : {};
}

function sameLayout(a: KeyboardLayout, b: KeyboardLayout): boolean {
	const codes = Object.keys(a);
	return codes.length === Object.keys(b).length && codes.every(code => a[code] === b[code]);
}
