import { afterEach, describe, expect, it } from "vitest";
import { keyboardLayoutFrom, setKeyboardLayout } from "../shared/chord";
import { pageKeyCommand } from "./browser-keys";

type KeyInput = Parameters<typeof pageKeyCommand>[0];

function key(code: string, keyName: string, mods: Partial<KeyInput> = {}): KeyInput {
	return {
		type: "keyDown",
		key: keyName,
		code,
		control: false,
		meta: false,
		alt: false,
		shift: false,
		isAutoRepeat: false,
		...mods,
	};
}

/** The app keymap's ⌘ chords and their ⌃ twins, as the renderer reports them. */
const APP_CHORDS = new Set(["⌘J", "⌃J", "⌘B", "⌃P"]);

describe("pageKeyCommand", () => {
	afterEach(() => setKeyboardLayout({}));

	it("reads browser keys by the letter the keyboard layout types", () => {
		// Colemak: R is typed at US S, L at US U.
		setKeyboardLayout(
			keyboardLayoutFrom([
				["KeyS", "r"],
				["KeyR", "p"],
				["KeyU", "l"],
				["KeyL", "i"],
			]),
		);
		expect(pageKeyCommand(key("KeyS", "r", { meta: true }), APP_CHORDS, "darwin")).toEqual({
			kind: "reload",
			ignoreCache: false,
		});
		expect(pageKeyCommand(key("KeyR", "p", { meta: true }), APP_CHORDS, "darwin")).toBeNull();
		expect(pageKeyCommand(key("KeyU", "l", { meta: true }), APP_CHORDS, "darwin")).toEqual({ kind: "focusAddress" });
	});

	it("reloads the page, not the app window the menu's ⌘R would reload", () => {
		expect(pageKeyCommand(key("KeyR", "r", { meta: true }), APP_CHORDS, "darwin")).toEqual({
			kind: "reload",
			ignoreCache: false,
		});
		expect(pageKeyCommand(key("KeyR", "R", { meta: true, shift: true }), APP_CHORDS, "darwin")).toEqual({
			kind: "reload",
			ignoreCache: true,
		});
		expect(pageKeyCommand(key("KeyR", "r", { control: true }), APP_CHORDS, "linux")).toEqual({
			kind: "reload",
			ignoreCache: false,
		});
		expect(pageKeyCommand(key("F5", "F5"), APP_CHORDS, "win32")).toEqual({ kind: "reload", ignoreCache: false });
	});

	it("maps each platform's back, forward, DevTools, and address-bar keys", () => {
		expect(pageKeyCommand(key("BracketLeft", "[", { meta: true }), APP_CHORDS, "darwin")).toEqual({ kind: "back" });
		expect(pageKeyCommand(key("BracketRight", "]", { meta: true }), APP_CHORDS, "darwin")).toEqual({
			kind: "forward",
		});
		expect(pageKeyCommand(key("ArrowLeft", "ArrowLeft", { alt: true }), APP_CHORDS, "linux")).toEqual({
			kind: "back",
		});
		// ⌥← on macOS moves by word in a text field.
		expect(pageKeyCommand(key("ArrowLeft", "ArrowLeft", { alt: true }), APP_CHORDS, "darwin")).toBeNull();
		expect(pageKeyCommand(key("KeyI", "ˆ", { meta: true, alt: true }), APP_CHORDS, "darwin")).toEqual({
			kind: "devtools",
		});
		expect(pageKeyCommand(key("KeyI", "I", { control: true, shift: true }), APP_CHORDS, "linux")).toEqual({
			kind: "devtools",
		});
		expect(pageKeyCommand(key("KeyL", "l", { meta: true }), APP_CHORDS, "darwin")).toEqual({ kind: "focusAddress" });
	});

	it("hands the app its keymap chords on the command modifier and leaves the rest to the page", () => {
		expect(pageKeyCommand(key("KeyJ", "j", { meta: true }), APP_CHORDS, "darwin")).toMatchObject({
			kind: "shortcut",
			key: { code: "KeyJ", metaKey: true },
		});
		expect(pageKeyCommand(key("KeyJ", "j", { control: true }), APP_CHORDS, "linux")).toMatchObject({
			kind: "shortcut",
		});
		// Not an app chord: copy stays the page's.
		expect(pageKeyCommand(key("KeyC", "c", { meta: true }), APP_CHORDS, "darwin")).toBeNull();
		// ⌃ chords on macOS are text editing in the page, even when the app binds them.
		expect(pageKeyCommand(key("KeyP", "p", { control: true }), APP_CHORDS, "darwin")).toBeNull();
		expect(pageKeyCommand({ ...key("KeyJ", "j", { meta: true }), type: "keyUp" }, APP_CHORDS, "darwin")).toBeNull();
	});
});
