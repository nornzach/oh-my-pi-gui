/**
 * Chords owned by the native (main-process) layer: the app menu and the
 * system-wide window shortcut. Electron resolves these before the keydown
 * reaches any renderer, so a GUI action bound onto one of them can never fire —
 * the keymap registry therefore treats them as reserved and refuses the binding,
 * and the shortcuts dialog lists them alongside the remappable rows.
 *
 * This is the only place these chords are spelled out: `main/menu.ts` and
 * `main/index.ts` ask for the Electron accelerator by id, and the renderer
 * derives its display + conflict table from the same list.
 */

import { chordToAccelerator } from "./chord";

export interface NativeChord {
	readonly id: string;
	/** Renderer i18n key for the reference row. */
	readonly labelKey: string;
	/** Canonical chord as the shortcuts dialog displays it (⌥⇧⌃⌘ order). */
	readonly chord: string;
	/** Electron accelerator spelling for the same keys. */
	readonly accelerator: string;
}

export const NATIVE_CHORDS = [
	{
		id: "window.toggle",
		labelKey: "hotkeys.row.windowToggle",
		chord: "⇧⌘O",
		accelerator: "CommandOrControl+Shift+O",
	},
	{ id: "session.new", labelKey: "hotkeys.row.newSession", chord: "⌘N", accelerator: "CmdOrCtrl+N" },
	{ id: "session.exportHtml", labelKey: "hotkeys.row.exportHtml", chord: "⌘E", accelerator: "CmdOrCtrl+E" },
	{ id: "window.new", labelKey: "hotkeys.row.newWindow", chord: "⇧⌘N", accelerator: "CmdOrCtrl+Shift+N" },
	// ⌘W closes a TAB and lives in the renderer keymap, so the window-level
	// close has to sit one modifier away or the two chords would fight.
	{ id: "window.close", labelKey: "hotkeys.row.windowClose", chord: "⇧⌘W", accelerator: "CmdOrCtrl+Shift+W" },
	// Find in the browser panel's page. A page that takes ⌘F itself keeps it.
	{ id: "browser.find", labelKey: "hotkeys.row.findInPage", chord: "⌘F", accelerator: "CmdOrCtrl+F" },
] as const satisfies readonly NativeChord[];

export type NativeChordId = (typeof NATIVE_CHORDS)[number]["id"];

const nativeChordById = {} as Record<NativeChordId, (typeof NATIVE_CHORDS)[number]>;
for (const entry of NATIVE_CHORDS) nativeChordById[entry.id] = entry;

/** Prefs key for the user's chord per shortcut id (a list; the first chord is the native one). */
export const KEYMAP_OVERRIDES_PREF = "keymapOverrides";
/** Prefs key for the ids of shortcuts the user turned off. */
export const KEYMAP_DISABLED_PREF = "keymapDisabled";

/** Whether a stored disabled list turns this shortcut off. */
export function isShortcutDisabled(id: string, disabled: unknown): boolean {
	return Array.isArray(disabled) && disabled.includes(id);
}

/**
 * Electron accelerator for a native chord id under the user's saved shortcuts,
 * or undefined when the user turned it off. A stored chord that no longer
 * parses falls back to the default rather than leaving the action unbound.
 */
export function nativeAccelerator(
	id: NativeChordId,
	overrides: unknown,
	disabled: unknown,
	mac: boolean,
): string | undefined {
	if (isShortcutDisabled(id, disabled)) return undefined;
	if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
		const chords = (overrides as Record<string, unknown>)[id];
		const first = Array.isArray(chords) ? chords[0] : undefined;
		const accelerator = typeof first === "string" ? chordToAccelerator(first, mac) : null;
		if (accelerator) return accelerator;
	}
	return nativeChordById[id].accelerator;
}
