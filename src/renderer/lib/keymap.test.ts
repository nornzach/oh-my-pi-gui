/**
 * Contract tests for the GUI keybinding remap layer (B3 — plan/15 §3.5,
 * plan/17 §6.3): chord parse/serialize round-trips and alias acceptance,
 * replace-not-union compilation, both conflict classes (user-user error,
 * default-shadow warning), and override sanitization that ignores unknown
 * actions on hydration. B5 adds the single-chord-table invariants: every
 * shortcut has exactly one row, every chord the app owns (registry default,
 * composer key, or native menu accelerator) has one claimant, and the recorder
 * blocks or warns on chords another shortcut holds — including composer and
 * native shortcuts the user changed or turned off. GUI-local only — nothing
 * here touches the TUI's keybindings.yml.
 */

import { describe, expect, it } from "vitest";
import { NATIVE_CHORDS } from "../../shared/hotkeys";
import {
	chordFromEvent,
	compileKeymap,
	defaultChords,
	EDITABLE_SHORTCUTS,
	effectiveOverrides,
	findShortcutConflict,
	isComposerShortcut,
	isFollowUpSend,
	isSelectAll,
	KEYMAP_ACTIONS,
	parseChord,
	SHORTCUT_ENTRIES,
	sanitizeDisabled,
	sanitizeOverrides,
	serializeChord,
} from "./keymap";

/** Canonical form of an input chord; throws when the chord does not parse. */
function canonical(input: string): string {
	const parsed = parseChord(input);
	if (!parsed) throw new Error(`"${input}" does not parse`);
	return serializeChord(parsed);
}

/** Electron accelerator spelling → the canonical chord the dialog promises.
 *  "CmdOrCtrl" is one chord: the dialog shows the ⌘ form for both platforms. */
function acceleratorToChord(accelerator: string): string {
	const parts = accelerator.split("+");
	const key = (parts.pop() ?? "").toUpperCase();
	const flags = { ctrl: false, alt: false, shift: false, meta: false };
	for (const part of parts) {
		const token = part.toLowerCase();
		if (token === "ctrl" || token === "control") flags.ctrl = true;
		else if (token === "alt" || token === "option") flags.alt = true;
		else if (token === "shift") flags.shift = true;
		else if (token === "cmd" || token === "command" || token === "cmdorctrl" || token === "commandorcontrol")
			flags.meta = true;
	}
	return serializeChord({ ...flags, key });
}

const NO_MODS = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };

describe("parseChord/serializeChord", () => {
	it("round-trips every default chord in the action table", () => {
		for (const action of KEYMAP_ACTIONS) {
			for (const chord of action.defaults) {
				expect(canonical(chord), `${action.id} default "${chord}"`).toBe(chord);
			}
		}
	});

	it("accepts textual modifier aliases and normalizes order + case", () => {
		expect(canonical("ctrl+shift+p")).toBe("⇧⌃P");
		expect(canonical("Control-Shift-P")).toBe("⇧⌃P");
		expect(canonical("shift+ctrl+P")).toBe("⇧⌃P");
		expect(canonical("alt+r")).toBe("⌥R");
		expect(canonical("option+r")).toBe("⌥R");
		expect(canonical("alt+shift+p")).toBe("⌥⇧P");
		expect(canonical("cmd+k")).toBe("⌘K");
		expect(canonical("command+k")).toBe("⌘K");
		expect(canonical("meta+k")).toBe("⌘K");
		expect(canonical("super+k")).toBe("⌘K");
		expect(canonical("ctrl+alt+shift+meta+o")).toBe("⌥⇧⌃⌘O");
	});

	it("parses arrow, punctuation, and bare-plus/minus base keys", () => {
		expect(canonical("alt+up")).toBe("⌥↑");
		expect(canonical("ctrl+arrowup")).toBe("⌃↑");
		expect(canonical("cmd+,")).toBe("⌘,");
		expect(canonical("cmd+/")).toBe("⌘/");
		expect(canonical("ctrl+-")).toBe("⌃-");
		expect(canonical("ctrl++")).toBe("⌃+");
	});

	it("rejects chords without a real modifier or a base key", () => {
		expect(parseChord("p")).toBeNull();
		expect(parseChord("P")).toBeNull();
		expect(parseChord("shift+p")).toBeNull();
		expect(parseChord("⇧P")).toBeNull();
		expect(parseChord("")).toBeNull();
		expect(parseChord("ctrl+")).toBeNull();
		expect(parseChord("ctrl+shift")).toBeNull();
	});

	it("is stable through a second parse/serialize round-trip", () => {
		expect(canonical(canonical("Control-Shift-P"))).toBe("⇧⌃P");
		expect(canonical(canonical("alt+up"))).toBe("⌥↑");
	});
});

describe("chordFromEvent", () => {
	it("serializes keydown events to canonical chords", () => {
		expect(chordFromEvent({ key: "p", code: "KeyP", ...NO_MODS, ctrlKey: true })).toBe("⌃P");
		expect(chordFromEvent({ key: "P", code: "KeyP", ...NO_MODS, ctrlKey: true, shiftKey: true })).toBe("⇧⌃P");
		expect(chordFromEvent({ key: "ArrowUp", code: "ArrowUp", ...NO_MODS, altKey: true })).toBe("⌥↑");
		expect(chordFromEvent({ key: ",", code: "Comma", ...NO_MODS, metaKey: true })).toBe("⌘,");
		expect(chordFromEvent({ key: "/", code: "Slash", ...NO_MODS, metaKey: true })).toBe("⌘/");
	});

	it("prefers the physical code over ⌥-composed event.key characters", () => {
		// macOS reports ⌥R as key "®" — the pre-B3 hardcoded chains were code-based
		// for exactly this reason.
		expect(chordFromEvent({ key: "®", code: "KeyR", ...NO_MODS, altKey: true })).toBe("⌥R");
		expect(chordFromEvent({ key: "∏", code: "KeyP", ...NO_MODS, altKey: true, shiftKey: true })).toBe("⌥⇧P");
	});

	it("never forms chords from bare, shift-only, or pure-modifier keys", () => {
		expect(chordFromEvent({ key: "p", code: "KeyP", ...NO_MODS })).toBeNull();
		expect(chordFromEvent({ key: "P", code: "KeyP", ...NO_MODS, shiftKey: true })).toBeNull();
		expect(chordFromEvent({ key: "Control", code: "ControlLeft", ...NO_MODS, ctrlKey: true })).toBeNull();
	});
});

describe("isFollowUpSend", () => {
	it.each([
		["⌘Enter on macOS", true, { metaKey: true, ctrlKey: false, altKey: false }, true],
		// The terminal's follow-up chord keeps working in the app.
		["⌃Enter on macOS", true, { metaKey: false, ctrlKey: true, altKey: false }, true],
		["a bare Enter", true, { metaKey: false, ctrlKey: false, altKey: false }, false],
		["Ctrl+Enter on Windows and Linux", false, { metaKey: false, ctrlKey: true, altKey: false }, true],
		// Win/Super+Enter belongs to the system there.
		["Win+Enter on Windows and Linux", false, { metaKey: true, ctrlKey: false, altKey: false }, false],
		// AltGr arrives as Ctrl+Alt on Windows; typing with it must never queue.
		["AltGr+Enter", false, { metaKey: false, ctrlKey: true, altKey: true }, false],
	])("%s → follow-up: %s", (_name, mac, event, followUp) => {
		expect(isFollowUpSend(event, mac)).toBe(followUp);
	});
});

describe("isSelectAll", () => {
	const keys = { key: "a", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
	it.each([
		["⌘A on macOS", true, { ...keys, metaKey: true }, true],
		// ⌃A moves to the line start on macOS; it never selects.
		["⌃A on macOS", true, { ...keys, ctrlKey: true }, false],
		["Ctrl+A on Windows and Linux", false, { ...keys, ctrlKey: true }, true],
		["Win+A on Windows and Linux", false, { ...keys, metaKey: true }, false],
		// Caps Lock or Shift reports an upper-case key.
		["⌘⇧A on macOS", true, { ...keys, key: "A", metaKey: true, shiftKey: true }, false],
		["⌘A with Caps Lock", true, { ...keys, key: "A", metaKey: true }, true],
	])("%s → select all: %s", (_name, mac, event, selectAll) => {
		expect(isSelectAll(event, mac)).toBe(selectAll);
	});
});

describe("compileKeymap", () => {
	it("maps every default chord to its action when there are no overrides", () => {
		const map = compileKeymap(KEYMAP_ACTIONS, {}, true);
		expect(map.get("⌃O")).toBe("tools.expand");
		expect(map.get("⇧⌃P")).toBe("model.cycleBackward");
		expect(map.get("⌥↑")).toBe("dequeue");
		expect(map.get("⌘K")).toBe("palette");
		expect(map.get("⌃K")).toBe("palette");
	});

	it("replaces an action's defaults with its override — never a union", () => {
		const map = compileKeymap(KEYMAP_ACTIONS, { "tools.expand": ["ctrl+shift+o"] }, true);
		expect(map.get("⇧⌃O")).toBe("tools.expand");
		// The old default chord is dead…
		expect(map.has("⌃O")).toBe(false);
		// …while untouched actions keep their defaults.
		expect(map.get("⌃T")).toBe("thinking.toggle");
	});

	it("leaves a turned-off action unbound, defaults included", () => {
		const map = compileKeymap(KEYMAP_ACTIONS, effectiveOverrides({}, ["palette"]), true);
		expect(map.has("⌘K")).toBe(false);
		expect(map.has("⌃K")).toBe(false);
		expect(map.get("⌃O")).toBe("tools.expand");
	});

	it("lets an explicit user chord win a shadowed default slot", () => {
		const map = compileKeymap(KEYMAP_ACTIONS, { retry: ["ctrl+o"] });
		expect(map.get("⌃O")).toBe("retry");
	});

	it("turns the defaults' ⌘ into ⌃ off macOS, where ⌘ is the Windows key", () => {
		// Windows keeps Win+T and Win+1…9 for itself, so ⌘ defaults never fired
		// there. ⌃T becomes the new tab, as in a browser, which moves thinking.
		const offMac = compileKeymap(KEYMAP_ACTIONS, {}, false);
		expect(offMac.get("⌃T")).toBe("tab.new");
		expect(offMac.get("⌃W")).toBe("tab.close");
		expect(offMac.get("⌃1")).toBe("tab.select");
		expect(offMac.get("⌥⇧⌃←")).toBe("tab.moveLeft");
		expect(offMac.get("⌥⇧T")).toBe("thinking.toggle");
		expect([...offMac.keys()].filter(chord => chord.includes("⌘"))).toEqual([]);
		const mac = compileKeymap(KEYMAP_ACTIONS, {}, true);
		expect(mac.get("⌘T")).toBe("tab.new");
		expect(mac.get("⌃T")).toBe("thinking.toggle");
	});
});

describe("findShortcutConflict", () => {
	it("refuses a chord another user binding already holds", () => {
		expect(findShortcutConflict("dequeue", "ctrl+shift+r", { retry: ["⌃⇧R"] }, true)).toEqual({
			kind: "error",
			reason: "taken",
			otherId: "retry",
		});
	});

	it("warns when the chord replaces another action's live default", () => {
		expect(findShortcutConflict("retry", "⌃O", {}, true)).toEqual({
			kind: "warning",
			reason: "shadow",
			otherId: "tools.expand",
		});
	});

	it("drops the shadow once that action is remapped or turned off", () => {
		expect(findShortcutConflict("retry", "⌃O", { "tools.expand": ["⌥⇧O"] }, true)).toBeNull();
		expect(findShortcutConflict("retry", "⌃O", effectiveOverrides({}, ["tools.expand"]), true)).toBeNull();
	});

	it("ignores the shortcut's own chords", () => {
		expect(findShortcutConflict("retry", "⌥R", {}, true)).toBeNull();
	});

	it("blocks any overlap with a menu or system-wide shortcut, in either direction", () => {
		// Electron takes a menu or global accelerator before the page sees the key,
		// so neither side of the overlap could ever fire.
		expect(findShortcutConflict("retry", "⌘N", {}, true)).toEqual({
			kind: "error",
			reason: "taken",
			otherId: "session.new",
		});
		// Off macOS the accelerators are CmdOrCtrl: ⌃N there.
		expect(findShortcutConflict("retry", "⌃N", {}, false)?.otherId).toBe("session.new");
		expect(findShortcutConflict("window.toggle", "⌘K", {}, true)).toEqual({
			kind: "error",
			reason: "taken",
			otherId: "palette",
		});
	});

	it("frees a menu shortcut's keys once the user turns it off", () => {
		expect(findShortcutConflict("retry", "⌘N", effectiveOverrides({}, ["session.new"]), true)).toBeNull();
	});

	it("warns between composer and app keys, and follows the composer's own remap", () => {
		expect(findShortcutConflict("retry", "⌃R", {}, true)).toEqual({
			kind: "warning",
			reason: "composer",
			otherId: "composer.history",
		});
		expect(findShortcutConflict("retry", "⌃R", { "composer.history": ["⌥H"] }, true)).toBeNull();
		expect(findShortcutConflict("composer.editor", "⌥H", { "composer.history": ["⌥H"] }, true)).toEqual({
			kind: "error",
			reason: "taken",
			otherId: "composer.history",
		});
	});
});

describe("isComposerShortcut", () => {
	const ctrlR = { ...NO_MODS, key: "r", code: "KeyR", ctrlKey: true };
	const altH = { ...NO_MODS, key: "˙", code: "KeyH", altKey: true };

	it("follows the user's chord and drops the default it replaced", () => {
		expect(isComposerShortcut("composer.history", ctrlR, {}, true)).toBe(true);
		const remapped = { "composer.history": ["⌥H"] };
		expect(isComposerShortcut("composer.history", altH, remapped, true)).toBe(true);
		expect(isComposerShortcut("composer.history", ctrlR, remapped, true)).toBe(false);
	});

	it("matches nothing once turned off", () => {
		expect(isComposerShortcut("composer.history", ctrlR, effectiveOverrides({}, ["composer.history"]), true)).toBe(
			false,
		);
	});
});

describe("hotkey reference table", () => {
	it("lists every shortcut once", () => {
		// A second row would offer two editors for one binding; a missing one could
		// never be changed or turned off.
		const ids = SHORTCUT_ENTRIES.map(entry => entry.id);
		expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
		for (const id of [...KEYMAP_ACTIONS.map(action => action.id), ...NATIVE_CHORDS.map(entry => entry.id)]) {
			expect(
				EDITABLE_SHORTCUTS.some(entry => entry.id === id),
				id,
			).toBe(true);
		}
	});

	it.each([
		["macOS", true],
		["Windows and Linux", false],
	])("gives every chord the app owns exactly one claimant on %s", (_platform, mac) => {
		// Two owners of one chord is a dead binding: the compiled map lets the
		// later action win, and a default landing on the composer's ⌃R or a menu
		// accelerator never reaches the renderer at all. Off macOS a ⌘ default
		// turns into ⌃ and can land on another action's ⌃ default.
		const claims = SHORTCUT_ENTRIES.flatMap(entry =>
			defaultChords(entry, mac).map(chord => ({ id: entry.id, chord })),
		);
		for (const claim of claims) expect(canonical(claim.chord), `"${claim.chord}"`).toBe(claim.chord);
		const chords = claims.map(claim => claim.chord);
		expect(chords.filter((chord, index) => chords.indexOf(chord) !== index)).toEqual([]);
	});

	it("spells every Electron accelerator with the keys the dialog displays", () => {
		// The menu registers the accelerator; the dialog promises the chord. Edit
		// only one of the two and the documented shortcut does nothing.
		for (const entry of NATIVE_CHORDS) {
			expect(acceleratorToChord(entry.accelerator), entry.id).toBe(entry.chord);
		}
	});
});

describe("sanitizeOverrides", () => {
	it("drops unknown and built-in shortcuts, non-arrays, unparsable and duplicate chords", () => {
		const raw = {
			"bogus.action": ["ctrl+q"],
			"composer.followUp": ["ctrl+enter"],
			retry: ["alt+shift+r", "⌥⇧R", "not a chord", 42],
			"tools.expand": "ctrl+o",
			dequeue: [],
			"window.toggle": ["ctrl+alt+space"],
		};
		expect(sanitizeOverrides(raw)).toEqual({ retry: ["⌥⇧R"], "window.toggle": ["⌥⌃␣"] });
	});

	it("returns an empty table for non-object payloads", () => {
		expect(sanitizeOverrides(null)).toEqual({});
		expect(sanitizeOverrides(["ctrl+o"])).toEqual({});
		expect(sanitizeOverrides("ctrl+o")).toEqual({});
	});
});

describe("sanitizeDisabled", () => {
	it("keeps known shortcut ids once and drops the rest", () => {
		expect(sanitizeDisabled(["window.toggle", "window.toggle", "bogus", 3, "composer.followUp", "retry"])).toEqual([
			"window.toggle",
			"retry",
		]);
		expect(sanitizeDisabled({ retry: true })).toEqual([]);
	});
});
