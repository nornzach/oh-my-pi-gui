/**
 * The user's saved shortcuts as the main process applies them: the menu's
 * accelerators and the system-wide show/hide shortcut. The renderer's Keyboard
 * Shortcuts settings page writes the same two prefs keys; ipc.ts calls
 * `applyWindowToggle` and rebuilds the menu whenever either changes.
 */

import { globalShortcut } from "electron";
import Store from "electron-store";
import { KEYMAP_DISABLED_PREF, KEYMAP_OVERRIDES_PREF, type NativeChordId, nativeAccelerator } from "../shared/hotkeys";
import type { IpcWindowToggleStatus } from "../shared/ipc-types";

// electron-store re-reads the file on every get, so this sees the IPC handler's writes.
const prefs = new Store<Record<string, unknown>>({ name: "prefs" });
const mac = process.platform === "darwin";

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
	let registered = false;
	try {
		registered = globalShortcut.register(accelerator, toggleHandler);
	} catch (error) {
		console.warn(`[shortcuts] could not register ${accelerator}:`, error);
	}
	if (registered) registeredAccelerator = accelerator;
	else console.warn(`[shortcuts] ${accelerator} is held by another app; the window shortcut is inactive`);
	status = { accelerator, registered };
	return status;
}

export function windowToggleStatus(): IpcWindowToggleStatus {
	return status;
}
