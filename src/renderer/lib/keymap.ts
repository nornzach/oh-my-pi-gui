/**
 * GUI keybinding remap layer (B3 — plan/15 §3.5, plan/17 §6.3).
 *
 * The TUI's `~/.omp/agent/keybindings.yml` is inert for the GUI: the agent
 * process's KeybindingsManager feeds only the TUI key dispatch, and
 * `omp --mode rpc-ui` never parses keys. GUI remapping is therefore GUI-local
 * by design — overrides live in the `keymapOverrides` prefs key (ui store
 * hydrates/persists) and are NEVER written to keybindings.yml.
 *
 * Model: an action table (TUI app.* naming for familiarity) of GUI-remappable
 * chords. At boot and on every change the defaults + overrides compile into a
 * `Map<chordString, actionId>` so keydown dispatch is an O(1) lookup, never a
 * config walk. A user binding REPLACES its action's default chord list (no
 * union — TUI parity). Conflict detection covers the TUI's getConflicts
 * semantics (same chord claimed by 2+ user bindings → error) plus a GUI-only
 * improvement: a user chord shadowing another action's live default → warning.
 *
 * Chord grammar: modifiers ⌃⌥⇧⌘ + a base key, serialized with modifiers in
 * the fixed order ⌥ ⇧ ⌃ ⌘ and the base key canonicalized (letters uppercase,
 * arrows/named keys as glyphs: ↑↓←→ ↵ ⇥ ␣ ⎋ ⌫ ⌦). Parsing additionally
 * accepts textual aliases — ctrl/control, alt/option, shift, cmd/command/
 * meta/super — joined by "+" or "-" ("ctrl+shift+p", "Control-Shift-P").
 * Every chord needs a real modifier (⌃/⌥/⌘): an unmodified key would eat
 * typing app-wide and a shift-only chord would hijack capital letters.
 */

import { NATIVE_CHORDS } from "../../shared/hotkeys";
import { isImeKeyEvent } from "./ime";

export interface Chord {
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
	/** Canonical base key: uppercase letter, digit, literal punctuation, glyph (↑↓←→↵⇥␣⎋⌫⌦), or F-key. */
	key: string;
}

/** Sections of the hotkeys reference the remappable rows are filed under. */
export type HotkeyGroupId = "generation" | "view" | "session";

/** Owner class of a non-remappable chord: a focused control, or the native layer. */
export type ReservedChordGroup = "input" | "native";

export interface KeymapAction {
	readonly id: string;
	/** i18n key for the row label in HotkeysDialog. */
	readonly labelKey: string;
	/** Canonical default chords (first is the primary display chord). */
	readonly defaults: readonly string[];
	/**
	 * True = fires even while an overlay/dialog owns the keyboard or a focused
	 * control consumed the key — the pre-B3 behavior of the unguarded ⌘ block
	 * (palette/settings/sidebar/panel/hotkeys toggles, and ⌃P model cycling).
	 * False = suppressed by overlayOpen / defaultPrevented / [role=dialog].
	 */
	readonly overlaySafe: boolean;
	/** Required so no action can exist without a row in the reference dialog. */
	readonly hotkeyGroup: HotkeyGroupId;
}

/** A chord something other than the keymap claims: the composer's own keydown
 *  (InputArea.handleKeyDown) or the native menu / global shortcut. Neither can
 *  be dispatched through the registry, so neither is remappable — but both
 *  occupy the chord, and the recorder must say so. */
export interface ReservedChord {
	readonly id: string;
	readonly labelKey: string;
	readonly chord: string;
	readonly hotkeyGroup: ReservedChordGroup;
}

/** actionId → replacement chord list (canonical or aliased; sanitized on hydration). */
export type KeymapOverrides = Record<string, string[]>;

const MOD_SYMBOLS: Record<string, "ctrl" | "alt" | "shift" | "meta"> = {
	"⌃": "ctrl",
	"⌥": "alt",
	"⇧": "shift",
	"⌘": "meta",
};

const TEXT_MOD_ALIASES: Record<string, "ctrl" | "alt" | "shift" | "meta"> = {
	ctrl: "ctrl",
	control: "ctrl",
	alt: "alt",
	option: "alt",
	shift: "shift",
	cmd: "meta",
	command: "meta",
	meta: "meta",
	super: "meta",
};

/** Textual aliases for multi-char base keys (single-char glyphs pass through as-is). */
const NAMED_KEY_ALIASES: Record<string, string> = {
	up: "↑",
	arrowup: "↑",
	down: "↓",
	arrowdown: "↓",
	left: "←",
	arrowleft: "←",
	right: "→",
	arrowright: "→",
	enter: "↵",
	return: "↵",
	tab: "⇥",
	space: "␣",
	spacebar: "␣",
	esc: "⎋",
	escape: "⎋",
	backspace: "⌫",
	delete: "⌦",
	del: "⌦",
};

function normalizeBaseKey(raw: string): string | null {
	if (!raw) return null;
	if (raw.length === 1) {
		// Letters canonicalize uppercase; digits/punctuation/glyphs stay literal.
		return /^[a-z]$/i.test(raw) ? raw.toUpperCase() : raw;
	}
	const alias = NAMED_KEY_ALIASES[raw.toLowerCase()];
	if (alias) return alias;
	const fkey = /^f(\d{1,2})$/i.exec(raw);
	if (fkey) {
		const n = Number(fkey[1]);
		if (n >= 1 && n <= 12) return `F${n}`;
	}
	return null;
}

/**
 * Parse a chord string (canonical unicode form or textual alias form) into a
 * Chord. Returns null for anything without a base key or without at least one
 * of ⌃/⌥/⌘ — unmodified and shift-only "chords" are unbindable by design.
 */
export function parseChord(input: string): Chord | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const flags = { ctrl: false, alt: false, shift: false, meta: false };
	let base = "";
	if (/[⌃⌥⇧⌘]/u.test(trimmed)) {
		// Canonical form: modifier glyphs may appear in any order; the rest is the base key.
		for (const ch of trimmed) {
			const mod = MOD_SYMBOLS[ch];
			if (mod) flags[mod] = true;
			else base += ch;
		}
	} else {
		// Textual form: consume leading "modifier<sep>" tokens; whatever remains is
		// the base key, so "ctrl+-" binds "-" and "ctrl++" binds "+".
		let rest = trimmed;
		for (;;) {
			const match = /^([a-z]+)\s*[+-]\s*/i.exec(rest);
			const mod = match?.[1] ? TEXT_MOD_ALIASES[match[1].toLowerCase()] : undefined;
			if (!match || !mod) break;
			flags[mod] = true;
			rest = rest.slice(match[0].length);
		}
		base = rest;
	}
	const key = normalizeBaseKey(base.trim());
	if (!key) return null;
	if (!flags.ctrl && !flags.alt && !flags.meta) return null;
	return { ...flags, key };
}

/** Canonical chord string: modifiers in ⌥⇧⌃⌘ order + the canonical base key. */
export function serializeChord(chord: Chord): string {
	return `${chord.alt ? "⌥" : ""}${chord.shift ? "⇧" : ""}${chord.ctrl ? "⌃" : ""}${chord.meta ? "⌘" : ""}${chord.key}`;
}

/** Structural subset of KeyboardEvent that chord extraction reads (test-friendly). */
export interface KeyEventLike {
	key: string;
	code: string;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
}

/** Anything an Escape handler can claim: React synthetic events and native events alike. */
interface EscapeCapable {
	key: string;
	keyCode?: number;
	isComposing?: boolean;
	nativeEvent?: { isComposing?: boolean };
	preventDefault(): void;
}

/**
 * Dismiss a transient surface with Escape and claim the keystroke. App.tsx aborts
 * the active turn on any Escape nobody prevented, so a rename field or dropdown
 * that closes on Escape must consume it or the running agent dies with it.
 */
export function onEscape(event: EscapeCapable, dismiss: () => void): boolean {
	if (isImeKeyEvent(event)) return false;
	if (event.key !== "Escape") return false;
	event.preventDefault();
	dismiss();
	return true;
}

const IGNORED_EVENT_KEYS: Record<string, true> = {
	Control: true,
	Shift: true,
	Alt: true,
	Meta: true,
	CapsLock: true,
	Fn: true,
	NumLock: true,
	ScrollLock: true,
	Dead: true,
};

const EVENT_KEY_GLYPHS: Record<string, string> = {
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	Enter: "↵",
	Tab: "⇥",
	" ": "␣",
	Escape: "⎋",
	Backspace: "⌫",
	Delete: "⌦",
};

/** Physical-code → base key for punctuation (layout-independent, immune to ⌥ composition). */
const CODE_BASE_KEYS: Record<string, string> = {
	Minus: "-",
	Equal: "=",
	BracketLeft: "[",
	BracketRight: "]",
	Backslash: "\\",
	Semicolon: ";",
	Quote: "'",
	Backquote: "`",
	Comma: ",",
	Period: ".",
	Slash: "/",
};

function keyFromEvent(event: KeyEventLike): string | null {
	if (IGNORED_EVENT_KEYS[event.key]) return null;
	const glyph = EVENT_KEY_GLYPHS[event.key];
	if (glyph) return glyph;
	if (/^F(?:[1-9]|1[0-2])$/.test(event.key)) return event.key;
	// Prefer the physical code for letters/digits/punctuation: with ⌥ held,
	// macOS turns event.key into a composition character (⌥R → "®"), and the
	// pre-B3 hardcoded chains were already code-based for exactly this reason.
	if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
	if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
	const punct = CODE_BASE_KEYS[event.code];
	if (punct) return punct;
	if (event.key.length === 1) return /^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : event.key;
	return null;
}

/** Chord for a keydown event, or null for pure modifiers / unmodified / shift-only keys. */
export function eventToChord(event: KeyEventLike): Chord | null {
	const key = keyFromEvent(event);
	if (!key) return null;
	if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;
	return { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey, key };
}

/** Canonical chord string for a keydown event — the compiled-map lookup key. */
export function chordFromEvent(event: KeyEventLike): string | null {
	const chord = eventToChord(event);
	return chord ? serializeChord(chord) : null;
}

/**
 * GUI-remappable actions (TUI app.* naming, plan/17 §6.2). Single source for
 * App.tsx's dispatch and HotkeysDialog's rows; the native menu keeps its own
 * chords in shared/hotkeys.ts because Electron resolves those before the
 * renderer sees a keydown.
 * `defaults` for the ⌘ actions include their ⌃ twin: the pre-B3 handler
 * accepted `metaKey || ctrlKey` for that block, and the compiled map fully
 * replaces those chains.
 */
export const KEYMAP_ACTIONS = [
	// ⌃P is overlaySafe: its pre-B3 branch lived in the unguarded ⌘/⌃ block and
	// cycled the model even with an overlay open.
	{
		id: "model.cycleForward",
		labelKey: "hotkeys.row.modelNext",
		defaults: ["⌃P"],
		overlaySafe: true,
		hotkeyGroup: "generation",
	},
	{
		id: "model.cycleBackward",
		labelKey: "hotkeys.row.modelPrev",
		defaults: ["⇧⌃P"],
		overlaySafe: false,
		hotkeyGroup: "generation",
	},
	{ id: "retry", labelKey: "hotkeys.row.retry", defaults: ["⌥R"], overlaySafe: false, hotkeyGroup: "generation" },
	{ id: "pr.center", labelKey: "hotkeys.row.prCenter", defaults: ["⌥P"], overlaySafe: false, hotkeyGroup: "session" },
	{ id: "dequeue", labelKey: "hotkeys.row.dequeue", defaults: ["⌥↑"], overlaySafe: false, hotkeyGroup: "generation" },
	{
		id: "plan.toggle",
		labelKey: "hotkeys.row.planToggle",
		defaults: ["⌥⇧P"],
		overlaySafe: false,
		hotkeyGroup: "generation",
	},
	{
		id: "tools.expand",
		labelKey: "hotkeys.row.expandTools",
		defaults: ["⌃O"],
		overlaySafe: false,
		hotkeyGroup: "view",
	},
	{
		id: "thinking.toggle",
		labelKey: "hotkeys.row.thinkingToggle",
		defaults: ["⌃T"],
		overlaySafe: false,
		hotkeyGroup: "generation",
	},
	{
		id: "model.select",
		labelKey: "hotkeys.row.modelPicker",
		defaults: ["⌥M"],
		overlaySafe: false,
		hotkeyGroup: "session",
	},
	{
		id: "agents.hub",
		labelKey: "hotkeys.row.agentHub",
		defaults: ["⌥A"],
		overlaySafe: false,
		hotkeyGroup: "session",
	},
	{ id: "palette", labelKey: "hotkeys.row.palette", defaults: ["⌘K", "⌃K"], overlaySafe: true, hotkeyGroup: "view" },
	{ id: "tab.new", labelKey: "hotkeys.row.tabNew", defaults: ["⌘T"], overlaySafe: false, hotkeyGroup: "session" },
	{
		id: "tab.newChat",
		labelKey: "hotkeys.row.tabNewChat",
		defaults: ["⇧⌘T"],
		overlaySafe: false,
		hotkeyGroup: "session",
	},
	{
		id: "tab.newWorktree",
		labelKey: "hotkeys.row.tabNewWorktree",
		defaults: ["⌥T"],
		overlaySafe: false,
		hotkeyGroup: "session",
	},
	{
		// ⌘W closes the active TAB (⇧⌘W closes the window — shared/hotkeys.ts).
		id: "tab.close",
		labelKey: "hotkeys.row.tabClose",
		defaults: ["⌘W"],
		overlaySafe: false,
		hotkeyGroup: "session",
	},
	{
		id: "settings",
		labelKey: "hotkeys.row.settings",
		defaults: ["⌘,", "⌃,"],
		overlaySafe: true,
		hotkeyGroup: "view",
	},
	{
		id: "sidebar.toggle",
		labelKey: "hotkeys.row.sidebar",
		defaults: ["⌘B", "⌃B"],
		overlaySafe: true,
		hotkeyGroup: "view",
	},
	{
		id: "panel.toggle",
		labelKey: "hotkeys.row.panel",
		defaults: ["⌘J", "⌃J"],
		overlaySafe: true,
		hotkeyGroup: "view",
	},
	{ id: "hotkeys", labelKey: "hotkeys.row.hotkeys", defaults: ["⌘/", "⌃/"], overlaySafe: true, hotkeyGroup: "view" },
] as const satisfies readonly KeymapAction[];

/** Chords the composer's own keydown handler owns (InputArea.handleKeyDown).
 *  They still work outside the composer, so a collision is a warning. */
const COMPOSER_CHORDS: readonly ReservedChord[] = [
	{ id: "composer.history", labelKey: "hotkeys.row.history", chord: "⌃R", hotkeyGroup: "input" },
	{ id: "composer.editor", labelKey: "hotkeys.row.composerEditor", chord: "⌃G", hotkeyGroup: "input" },
];

/** Every chord the GUI already owns that the registry cannot dispatch. */
export const RESERVED_CHORDS: readonly ReservedChord[] = [
	...COMPOSER_CHORDS,
	...NATIVE_CHORDS.map(entry => ({
		id: entry.id,
		labelKey: entry.labelKey,
		chord: entry.chord,
		hotkeyGroup: "native" as const,
	})),
];

/** Rows the reference dialog files under a group, in registry order. */
export function keymapActionsForGroup<const Group extends HotkeyGroupId>(
	group: Group,
): Extract<(typeof KEYMAP_ACTIONS)[number], { hotkeyGroup: Group }>[] {
	return KEYMAP_ACTIONS.filter(
		(action): action is Extract<(typeof KEYMAP_ACTIONS)[number], { hotkeyGroup: Group }> =>
			action.hotkeyGroup === group,
	);
}

/** Non-remappable rows the reference dialog files under a group. */
export function reservedChordsForGroup(group: ReservedChordGroup): ReservedChord[] {
	return RESERVED_CHORDS.filter(entry => entry.hotkeyGroup === group);
}

export interface ChordOwner {
	readonly labelKey: string;
	/** "action" = a remappable registry row; the others name who holds the chord. */
	readonly holds: "action" | ReservedChordGroup;
}

/** Who owns a chord id — a remappable action or a reserved chord. */
export function chordOwner(id: string): ChordOwner | undefined {
	const action: KeymapAction | undefined = KEYMAP_ACTIONS.find(candidate => candidate.id === id);
	if (action) return { labelKey: action.labelKey, holds: "action" };
	const reserved: ReservedChord | undefined = RESERVED_CHORDS.find(candidate => candidate.id === id);
	if (!reserved) return undefined;
	return { labelKey: reserved.labelKey, holds: reserved.hotkeyGroup };
}

export type KeymapActionId = (typeof KEYMAP_ACTIONS)[number]["id"];

const keymapActionById = {} as Record<KeymapActionId, KeymapAction>;
for (const action of KEYMAP_ACTIONS) keymapActionById[action.id] = action;

export const KEYMAP_ACTION_BY_ID: Readonly<Record<KeymapActionId, KeymapAction>> = keymapActionById;

/**
 * Compile defaults + overrides into the dispatch lookup. A user's binding
 * REPLACES its action's defaults (no union — TUI parity), so a remapped
 * action's old chords go dead. Defaults are applied first and user bindings
 * second, so on a shadow the explicit user chord deterministically wins the
 * slot; user-user collisions resolve in table order (and are surfaced as
 * errors by detectConflicts before they can be saved).
 */
export function compileKeymap<A extends KeymapAction>(
	actions: readonly A[],
	overrides: KeymapOverrides,
): Map<string, A["id"]> {
	const map = new Map<string, A["id"]>();
	for (const action of actions) {
		if (overrides[action.id]?.length) continue; // replaced, not merged
		for (const raw of action.defaults) {
			const parsed = parseChord(raw);
			if (parsed) map.set(serializeChord(parsed), action.id);
		}
	}
	for (const action of actions) {
		const userChords = overrides[action.id];
		if (!userChords?.length) continue;
		for (const raw of userChords) {
			const parsed = parseChord(raw);
			if (parsed) map.set(serializeChord(parsed), action.id);
		}
	}
	return map;
}

export interface KeymapConflict {
	/** "error" blocks saving (ambiguous dispatch, or a chord native code owns);
	 *  "warning" allows it (the user binding wins the slot). */
	kind: "error" | "warning";
	/** Canonical chord string in dispute. */
	chord: string;
	/** Claimants: the colliding user actions (error) or [user action, shadowed owner]. */
	actionIds: string[];
}

/**
 * (a) user-user: one chord claimed by 2+ user bindings → error (TUI
 * getConflicts parity). (b) shadow: a user chord equals another action's LIVE
 * default chord → warning — the TUI never detects this; the GUI does (plan/17
 * §6.3). Defaults of an action that is itself remapped are dead and cast no
 * shadow. (c) reserved: a user chord taken by a focused control → warning (it
 * still fires elsewhere), or by the native menu / global shortcut → error
 * (Electron resolves it before the renderer ever sees the keydown).
 */
export function detectConflicts(
	actions: readonly KeymapAction[],
	overrides: KeymapOverrides,
	reserved: readonly ReservedChord[] = RESERVED_CHORDS,
): KeymapConflict[] {
	const defaultChords = new Map<string, Set<string>>();
	for (const action of actions) {
		const chords = new Set<string>();
		for (const raw of action.defaults) {
			const parsed = parseChord(raw);
			if (parsed) chords.add(serializeChord(parsed));
		}
		defaultChords.set(action.id, chords);
	}
	const userClaims = new Map<string, string[]>();
	for (const action of actions) {
		const userChords = overrides[action.id];
		if (!userChords) continue;
		for (const raw of userChords) {
			const parsed = parseChord(raw);
			if (!parsed) continue;
			const chord = serializeChord(parsed);
			const claimants = userClaims.get(chord) ?? [];
			// The same action listing a chord twice is redundant, not a conflict.
			if (!claimants.includes(action.id)) claimants.push(action.id);
			userClaims.set(chord, claimants);
		}
	}
	const conflicts: KeymapConflict[] = [];
	for (const [chord, claimants] of userClaims) {
		if (claimants.length > 1) conflicts.push({ kind: "error", chord, actionIds: claimants });
	}
	for (const [chord, claimants] of userClaims) {
		if (claimants.length > 1) continue; // already reported as an error
		const [userAction] = claimants;
		if (!userAction) continue;
		for (const action of actions) {
			if (action.id === userAction) continue;
			if (overrides[action.id]?.length) continue; // that action's defaults were replaced — dead
			if (defaultChords.get(action.id)?.has(chord)) {
				conflicts.push({ kind: "warning", chord, actionIds: [userAction, action.id] });
			}
		}
		for (const entry of reserved) {
			const parsed = parseChord(entry.chord);
			if (!parsed || serializeChord(parsed) !== chord) continue;
			conflicts.push({
				kind: entry.hotkeyGroup === "native" ? "error" : "warning",
				chord,
				actionIds: [userAction, entry.id],
			});
		}
	}
	return conflicts;
}

/**
 * Validate a raw prefs payload into overrides: unknown actions are ignored
 * (prefs drift across builds), values must be string arrays, each chord must
 * parse, chords canonicalize and dedupe, and empty lists drop out (an action
 * with no chords falls back to its defaults).
 */
export function sanitizeOverrides(actions: readonly KeymapAction[], raw: unknown): KeymapOverrides {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const known = new Set(actions.map(action => action.id));
	const result: KeymapOverrides = {};
	for (const [actionId, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!known.has(actionId)) continue;
		if (!Array.isArray(value)) continue;
		const chords: string[] = [];
		for (const item of value) {
			if (typeof item !== "string") continue;
			const parsed = parseChord(item);
			if (!parsed) continue;
			const chord = serializeChord(parsed);
			if (!chords.includes(chord)) chords.push(chord);
		}
		if (chords.length > 0) result[actionId] = chords;
	}
	return result;
}
