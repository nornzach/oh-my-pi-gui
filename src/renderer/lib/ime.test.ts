import { describe, expect, it } from "vitest";
import { isImeKeyEvent } from "./ime";

/**
 * Contract: while an IME owns the keystroke, no picker, composer, or dialog may
 * act on it. If this regresses, a Chinese/Japanese user committing a candidate
 * with Enter sends the composer message, switches the model, or closes the
 * dialog they were still typing in.
 */
function reactEvent(init: { key?: string; isComposing?: boolean; keyCode?: number }) {
	return {
		key: init.key ?? "Process",
		// React does not proxy `isComposing`; every renderer handler reads the
		// native flag through `nativeEvent`.
		nativeEvent: { isComposing: init.isComposing ?? false },
		keyCode: init.keyCode ?? 229,
	};
}

describe("isImeKeyEvent", () => {
	it("claims every key a React handler receives mid-composition, including Enter", () => {
		expect(isImeKeyEvent(reactEvent({ key: "Enter", isComposing: true }))).toBe(true);
		expect(isImeKeyEvent(reactEvent({ key: "ArrowDown", isComposing: true }))).toBe(true);
	});

	it("releases the key once the composition is closed", () => {
		expect(isImeKeyEvent(reactEvent({ key: "Enter", keyCode: 13 }))).toBe(false);
	});

	it("reads the flag directly on a document-level native event", () => {
		expect(isImeKeyEvent({ key: "Enter", isComposing: true, keyCode: 229 })).toBe(true);
		expect(isImeKeyEvent({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(false);
	});

	it("keeps Escape alive on the legacy 229 path but hands it to the IME while composing", () => {
		// Chromium keeps reporting keyCode 229 after composition ends; swallowing
		// Escape there traps the user in the overlay.
		expect(isImeKeyEvent(reactEvent({ key: "Escape" }))).toBe(false);
		expect(isImeKeyEvent(reactEvent({ key: "Escape", isComposing: true }))).toBe(true);
	});
});
