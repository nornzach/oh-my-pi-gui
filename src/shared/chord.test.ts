/**
 * Shortcuts follow the character the keyboard layout types (#49): a Colemak
 * user's ⌘O is the key labelled O, not the key at US-layout O. Keys whose
 * layout character a chord cannot name keep their US position, and the macOS
 * system-wide shortcut is moved to the key that types its letter.
 */
import { afterEach, describe, expect, it } from "vitest";
import { chordFromEvent, keyboardLayoutFrom, positionalAccelerator, setKeyboardLayout } from "./chord";

/** Colemak's keys that differ from US, as navigator.keyboard.getLayoutMap() reports them. */
const COLEMAK = keyboardLayoutFrom([
	["KeyE", "f"],
	["KeyR", "p"],
	["KeyT", "g"],
	["KeyY", "j"],
	["KeyU", "l"],
	["KeyI", "u"],
	["KeyO", "y"],
	["KeyP", ";"],
	["KeyS", "r"],
	["KeyD", "s"],
	["KeyF", "t"],
	["KeyG", "d"],
	["KeyJ", "n"],
	["KeyK", "e"],
	["KeyL", "i"],
	["KeyN", "k"],
	["Semicolon", "o"],
	["KeyA", "a"],
]);

/** Russian letters and AZERTY's digit row: nothing a chord can name. */
const NON_LATIN = keyboardLayoutFrom([
	["KeyK", "л"],
	["KeyO", "щ"],
	["Digit1", "&"],
	["Semicolon", "ж"],
]);

function press(code: string, key: string, mods: { alt?: boolean; shift?: boolean } = {}) {
	return { code, key, metaKey: true, ctrlKey: false, altKey: mods.alt ?? false, shiftKey: mods.shift ?? false };
}

afterEach(() => setKeyboardLayout({}));

describe("chordFromEvent under a keyboard layout", () => {
	it("names the letter the layout types, even when ⌥ composes event.key", () => {
		setKeyboardLayout(COLEMAK);
		expect(chordFromEvent(press("Semicolon", "o"))).toBe("⌘O");
		expect(chordFromEvent(press("Semicolon", "ø", { alt: true }))).toBe("⌥⌘O");
		expect(chordFromEvent(press("KeyO", "Y", { shift: true }))).toBe("⇧⌘Y");
		expect(chordFromEvent(press("KeyP", ";"))).toBe("⌘;");
	});

	it("falls back to the US position without a layout or for keys it cannot name", () => {
		expect(chordFromEvent(press("Semicolon", "o"))).toBe("⌘;");
		setKeyboardLayout(NON_LATIN);
		expect(NON_LATIN).toEqual({});
		expect(chordFromEvent(press("KeyK", "л"))).toBe("⌘K");
		expect(chordFromEvent(press("Digit1", "&"))).toBe("⌘1");
	});
});

describe("positionalAccelerator", () => {
	it("moves a system-wide accelerator to the key that types its letter", () => {
		expect(positionalAccelerator("CommandOrControl+Shift+O", COLEMAK)).toBe("CommandOrControl+Shift+;");
		expect(positionalAccelerator("Control+Alt+Shift+K", COLEMAK)).toBe("Control+Alt+Shift+N");
	});

	it("leaves named keys, letters at their US position and letters the layout lacks alone", () => {
		expect(positionalAccelerator("Control+Alt+Space", COLEMAK)).toBe("Control+Alt+Space");
		expect(positionalAccelerator("Command+A", COLEMAK)).toBe("Command+A");
		expect(positionalAccelerator("CommandOrControl+Shift+O", NON_LATIN)).toBe("CommandOrControl+Shift+O");
	});
});
