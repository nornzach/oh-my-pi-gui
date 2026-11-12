/**
 * Keyboard chords as the GUI keymap spells them: modifiers ⌃⌥⇧⌘ plus a
 * canonical base key, serialized in the fixed order ⌥ ⇧ ⌃ ⌘. Shared so the
 * main process can recognize app shortcuts typed into a built-in browser page,
 * whose keystrokes never reach the renderer.
 */

export interface Chord {
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
	/** Canonical base key: uppercase letter, digit, literal punctuation, glyph (↑↓←→↵⇥␣⎋⌫⌦), or F-key. */
	key: string;
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

/** Electron accelerator names for the glyph base keys. */
const ACCELERATOR_KEYS: Record<string, string> = {
	"↑": "Up",
	"↓": "Down",
	"←": "Left",
	"→": "Right",
	"↵": "Return",
	"⇥": "Tab",
	"␣": "Space",
	"⎋": "Escape",
	"⌫": "Backspace",
	"⌦": "Delete",
	"+": "Plus",
};

/**
 * Electron accelerator for a chord string, taken literally: ⌘ is Command on
 * macOS and the Super key elsewhere. Null when the chord does not parse.
 */
export function chordToAccelerator(input: string, mac: boolean): string | null {
	const chord = parseChord(input);
	if (!chord) return null;
	const parts: string[] = [];
	if (chord.ctrl) parts.push("Control");
	if (chord.alt) parts.push("Alt");
	if (chord.shift) parts.push("Shift");
	if (chord.meta) parts.push(mac ? "Command" : "Super");
	parts.push(ACCELERATOR_KEYS[chord.key] ?? chord.key);
	return parts.join("+");
}
