/**
 * What the main process registers for a menu or system-wide shortcut, read from
 * the same prefs the Keyboard shortcuts page writes: the default, the user's
 * chord spelled as an Electron accelerator, or nothing once turned off.
 */

import { describe, expect, it } from "vitest";
import { nativeAccelerator } from "./hotkeys";

describe("nativeAccelerator", () => {
	it("keeps the default when nothing is saved or the saved chord no longer parses", () => {
		expect(nativeAccelerator("window.toggle", undefined, undefined, true)).toBe("CommandOrControl+Shift+O");
		expect(nativeAccelerator("window.toggle", { "window.toggle": ["shift+o"] }, [], true)).toBe(
			"CommandOrControl+Shift+O",
		);
	});

	it("registers nothing for a shortcut the user turned off", () => {
		expect(nativeAccelerator("window.toggle", { "window.toggle": ["⌥⌃␣"] }, ["window.toggle"], true)).toBeUndefined();
		expect(nativeAccelerator("session.new", undefined, ["window.toggle"], true)).toBe("CmdOrCtrl+N");
	});

	it("spells the user's chord as an accelerator, ⌘ literally per platform", () => {
		expect(nativeAccelerator("window.toggle", { "window.toggle": ["⌥⌃␣"] }, [], true)).toBe("Control+Alt+Space");
		expect(nativeAccelerator("window.toggle", { "window.toggle": ["⇧⌘K"] }, [], true)).toBe("Shift+Command+K");
		// Off macOS ⌘ is the Windows/Super key, taken as written.
		expect(nativeAccelerator("window.toggle", { "window.toggle": ["⇧⌘K"] }, [], false)).toBe("Shift+Super+K");
		expect(nativeAccelerator("session.new", { "session.new": ["⌃+"] }, [], false)).toBe("Control+Plus");
		expect(nativeAccelerator("session.new", { "session.new": ["⌥↑"] }, [], true)).toBe("Alt+Up");
	});
});
