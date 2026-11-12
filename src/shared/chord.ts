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

/** Physical-code → base key for punctuation at its US-layout position (immune to ⌥ composition). */
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

const PUNCTUATION_KEYS = new Set(Object.values(CODE_BASE_KEYS));

/**
 * The character each letter, digit and punctuation key types unshifted in the
 * keyboard layout in use, by physical key code: Colemak's `Semicolon` key types
 * "o". Only keys whose character a chord can name are kept.
 */
export type KeyboardLayout = Readonly<Record<string, string>>;

let activeLayout: KeyboardLayout = {};

/**
 * A KeyboardLayout from a layout map's entries (`navigator.keyboard.getLayoutMap()`
 * or a copy sent over IPC). Keys that type no Latin letter, digit or chord
 * punctuation — a Cyrillic layout's letters, AZERTY's digit row — are
 * left out, so they keep their US-layout position.
 */
export function keyboardLayoutFrom(entries: Iterable<readonly [unknown, unknown]>): Record<string, string> {
	const layout: Record<string, string> = {};
	for (const [code, typed] of entries) {
		if (typeof code !== "string" || typeof typed !== "string" || !positionKey(code)) continue;
		const key = typed.toLowerCase();
		if (/^[a-z0-9]$/.test(key) || PUNCTUATION_KEYS.has(key)) layout[code] = key;
	}
	return layout;
}

/** Use this layout to read keystrokes from now on (each process keeps its own). */
export function setKeyboardLayout(layout: KeyboardLayout): void {
	activeLayout = layout;
}

export function keyboardLayout(): KeyboardLayout {
	return activeLayout;
}

/** Base key at a physical code's US-layout position: KeyO → "O", Semicolon → ";". */
function positionKey(code: string): string | null {
	if (/^Key[A-Z]$/.test(code)) return code.slice(3);
	if (/^Digit[0-9]$/.test(code)) return code.slice(5);
	return CODE_BASE_KEYS[code] ?? null;
}

/**
 * Canonical base key of a keystroke. Letters, digits and punctuation are the
 * character the key types in the current layout, so a shortcut follows the
 * letter on the keycap under Colemak or Dvorak; a key whose layout character a
 * chord cannot name keeps its US position. Never event.key for these: with ⌥
 * held macOS composes it (⌥R → "®"), and ⇧ shifts it.
 */
export function baseKeyFromEvent(event: Pick<KeyEventLike, "key" | "code">): string | null {
	if (IGNORED_EVENT_KEYS[event.key]) return null;
	const glyph = EVENT_KEY_GLYPHS[event.key];
	if (glyph) return glyph;
	if (/^F(?:[1-9]|1[0-2])$/.test(event.key)) return event.key;
	const typed = activeLayout[event.code];
	if (typed) return /^[a-z]$/.test(typed) ? typed.toUpperCase() : typed;
	const position = positionKey(event.code);
	if (position) return position;
	if (event.key.length === 1) return /^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : event.key;
	return null;
}

/** Chord for a keydown event, or null for pure modifiers / unmodified / shift-only keys. */
export function eventToChord(event: KeyEventLike): Chord | null {
	const key = baseKeyFromEvent(event);
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

/**
 * A macOS system-wide accelerator moved to the key that types its letter in
 * the current layout. Electron registers system-wide shortcuts on macOS by key
 * position on a US keyboard, so under Colemak "Shift+Command+O" would fire on
 * the key that types Y; this returns "Shift+Command+;", where Colemak types O.
 * Unchanged when the layout types the letter nowhere or at its US position.
 */
export function positionalAccelerator(accelerator: string, layout: KeyboardLayout): string {
	const parts = accelerator.split("+");
	const last = parts[parts.length - 1] ?? "";
	if (last.length !== 1) return accelerator;
	const wanted = last.toLowerCase();
	for (const [code, typed] of Object.entries(layout)) {
		if (typed !== wanted) continue;
		const position = positionKey(code);
		if (!position) continue;
		parts[parts.length - 1] = position;
		return parts.join("+");
	}
	return accelerator;
}
