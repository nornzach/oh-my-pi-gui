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
] as const satisfies readonly NativeChord[];

export type NativeChordId = (typeof NATIVE_CHORDS)[number]["id"];

const nativeChordById = {} as Record<NativeChordId, (typeof NATIVE_CHORDS)[number]>;
for (const entry of NATIVE_CHORDS) nativeChordById[entry.id] = entry;

/** Electron accelerator for a native chord id. */
export function nativeAccelerator(id: NativeChordId): string {
	return nativeChordById[id].accelerator;
}
