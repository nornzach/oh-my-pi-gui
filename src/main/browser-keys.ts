/**
 * Keystrokes in a focused built-in browser page. They reach the page's own
 * webContents, never the app's window, so the host claims the ones that are
 * not the page's: browser keys act on the page, and app keymap chords go back
 * to the window that owns them.
 */
import type { Input } from "electron";
import { baseKeyFromEvent, chordFromEvent, type KeyEventLike } from "../shared/chord";

/** What a keystroke in a focused page means to the host; null leaves it to the page. */
export type PageKeyCommand =
	| { kind: "reload"; ignoreCache: boolean }
	| { kind: "back" }
	| { kind: "forward" }
	| { kind: "devtools" }
	| { kind: "focusAddress" }
	| { kind: "shortcut"; key: KeyEventLike };

/**
 * Browser keys first (the macOS menu's ⌘R would reload the app window and
 * ⌥⌘I would open the app's DevTools), then chords of the app keymap that use
 * the platform's command modifier. Everything else — typing, ⌘C/⌘V, ⌘F,
 * Escape, ⌃-chords on macOS — stays with the page.
 */
export function pageKeyCommand(
	input: Pick<Input, "type" | "key" | "code" | "control" | "meta" | "alt" | "shift" | "isAutoRepeat">,
	appChords: ReadonlySet<string>,
	platform: NodeJS.Platform = process.platform,
): PageKeyCommand | null {
	if (input.type !== "keyDown") return null;
	const mac = platform === "darwin";
	const command = mac ? input.meta && !input.control : input.control && !input.meta;
	// By the character typed, like the app keymap, so ⌘R is the R on the keycap under any layout.
	const base = baseKeyFromEvent(input);
	if ((command && !input.alt && base === "R") || input.key === "F5") {
		return { kind: "reload", ignoreCache: input.shift };
	}
	const devtools = mac
		? input.meta && input.alt && !input.control && base === "I"
		: input.control && input.shift && !input.alt && base === "I";
	if (devtools || input.key === "F12") return { kind: "devtools" };
	if (mac ? command && !input.shift && !input.alt : input.alt && !input.control && !input.meta && !input.shift) {
		if (mac ? base === "[" : input.key === "ArrowLeft") return { kind: "back" };
		if (mac ? base === "]" : input.key === "ArrowRight") return { kind: "forward" };
	}
	if (command && !input.shift && !input.alt && base === "L") return { kind: "focusAddress" };
	if (!command) return null;
	const key: KeyEventLike = {
		key: input.key,
		code: input.code,
		ctrlKey: input.control,
		altKey: input.alt,
		shiftKey: input.shift,
		metaKey: input.meta,
	};
	const chord = chordFromEvent(key);
	return chord !== null && appChords.has(chord) ? { kind: "shortcut", key } : null;
}
