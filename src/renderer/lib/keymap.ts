/**
 * GUI keybinding remap layer (B3 — plan/15 §3.5, plan/17 §6.3).
 *
 * The TUI's `~/.omp/agent/keybindings.yml` is inert for the GUI: the agent
 * process's KeybindingsManager feeds only the TUI key dispatch, and
 * `omp --mode rpc-ui` never parses keys. GUI remapping is therefore GUI-local
 * by design — overrides live in the `keymapOverrides` prefs key and turned-off
 * shortcuts in `keymapDisabled` (ui store hydrates/persists; the main process
 * reads both for the menu and the system-wide show/hide shortcut). They are
 * NEVER written to keybindings.yml.
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
 *
 * Defaults are spelled for macOS. Off macOS ⌘ is the Windows/Super key, which
 * the OS keeps for itself, so a default's ⌘ becomes ⌃ there (Electron's
 * CmdOrCtrl); user bindings are taken literally on every platform.
 */

import { chordFromEvent, type KeyEventLike, parseChord, serializeChord } from "../../shared/chord";
import { NATIVE_CHORDS } from "../../shared/hotkeys";
import { isImeKeyEvent } from "./ime";

export * from "../../shared/chord";

/** Sections of the shortcut list the app's own actions are filed under. */
export type HotkeyGroupId = "generation" | "view" | "session";

/** Every section of the shortcut list: the app's groups, the composer's keys, and app-level shortcuts. */
export type ShortcutGroupId = "input" | HotkeyGroupId | "native";

/** Sections in list order; "sidebar" holds only built-in keys. Titles are `hotkeys.group.<id>`. */
export const SHORTCUT_SECTIONS = ["input", "generation", "view", "sidebar", "session", "native"] as const;
export type ShortcutSectionId = (typeof SHORTCUT_SECTIONS)[number];

/**
 * Who handles a shortcut. "app" = the renderer keymap below (App.tsx);
 * "composer" = InputArea's own keydown while the composer has focus;
 * "native" = the menu or the system-wide show/hide shortcut in the main
 * process, which takes the key before any page sees it.
 */
export type ShortcutKind = "app" | "composer" | "native";

export interface KeymapAction {
	readonly id: string;
	/** i18n key for the row label. */
	readonly labelKey: string;
	/** Canonical default chords (first is the primary display chord), as macOS spells them. */
	readonly defaults: readonly string[];
	/**
	 * Defaults off macOS, for an action whose ⌃ chord is another action's ⌘
	 * chord there once that becomes ⌃.
	 */
	readonly offMacDefaults?: readonly string[];
	/**
	 * True = fires even while an overlay/dialog owns the keyboard or a focused
	 * control consumed the key — the pre-B3 behavior of the unguarded ⌘ block
	 * (palette/settings/sidebar/panel/hotkeys toggles, and ⌃P model cycling).
	 * False = suppressed by overlayOpen / defaultPrevented / [role=dialog].
	 */
	readonly overlaySafe: boolean;
	/** Required so no action can exist without a row in the shortcut list. */
	readonly hotkeyGroup: HotkeyGroupId;
}

/** One row of the shortcut list, whoever handles it. */
export interface ShortcutEntry {
	readonly id: string;
	readonly labelKey: string;
	readonly kind: ShortcutKind;
	readonly group: ShortcutGroupId;
	/** As macOS spells them; off macOS a ⌘ default becomes ⌃ (see defaultChords). */
	readonly defaults: readonly string[];
	readonly offMacDefaults?: readonly string[];
	/** Shown for reference only: it cannot be changed or turned off. */
	readonly fixed?: boolean;
}

/**
 * shortcut id → the user's chords (canonical or aliased; sanitized on hydration).
 * Effective tables (see effectiveOverrides) also hold `[]` for a shortcut the user turned off.
 */
export type KeymapOverrides = Record<string, string[]>;

/** Whether this renderer runs on macOS, where ⌘ is the command key. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

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

/**
 * GUI-remappable actions (TUI app.* naming, plan/17 §6.2). Single source for
 * App.tsx's dispatch and the shortcut list; the native menu keeps its own
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
		// Off macOS ⌃T is a new tab (⌘T), as in a browser.
		id: "thinking.toggle",
		labelKey: "hotkeys.row.thinkingToggle",
		defaults: ["⌃T"],
		offMacDefaults: ["⌥⇧T"],
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
	{
		id: "memory.open",
		labelKey: "hotkeys.row.memory",
		defaults: ["⌥⇧M"],
		overlaySafe: false,
		hotkeyGroup: "session",
	},
	{ id: "palette", labelKey: "hotkeys.row.palette", defaults: ["⌘K", "⌃K"], overlaySafe: true, hotkeyGroup: "view" },
	{
		id: "search.conversations",
		labelKey: "hotkeys.row.searchConversations",
		defaults: ["⇧⌘F"],
		overlaySafe: false,
		hotkeyGroup: "session",
	},
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
	{ id: "tab.next", labelKey: "hotkeys.row.tabNext", defaults: ["⌃⇥"], overlaySafe: false, hotkeyGroup: "session" },
	{
		id: "tab.previous",
		labelKey: "hotkeys.row.tabPrevious",
		defaults: ["⇧⌃⇥"],
		overlaySafe: false,
		hotkeyGroup: "session",
	},
	{
		// The digit picks the chip: ⌘1…⌘8 by position, ⌘9 the last (gui#30).
		id: "tab.select",
		labelKey: "hotkeys.row.tabSelect",
		defaults: ["⌘1", "⌘2", "⌘3", "⌘4", "⌘5", "⌘6", "⌘7", "⌘8", "⌘9"],
		overlaySafe: false,
		hotkeyGroup: "session",
	},
	{
		id: "tab.moveLeft",
		labelKey: "hotkeys.row.tabMoveLeft",
		defaults: ["⌥⇧⌘←"],
		overlaySafe: false,
		hotkeyGroup: "session",
	},
	{
		id: "tab.moveRight",
		labelKey: "hotkeys.row.tabMoveRight",
		defaults: ["⌥⇧⌘→"],
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

/** The composer's own keys (InputArea.handleKeyDown), active while it has focus. */
const COMPOSER_SHORTCUTS: readonly ShortcutEntry[] = [
	// ⌘↵ is Enter with a modifier, not a chord of its own: it follows the send key.
	{
		id: "composer.followUp",
		labelKey: "hotkeys.row.followUpSend",
		kind: "composer",
		group: "input",
		defaults: ["⌘↵"],
		fixed: true,
	},
	{ id: "composer.history", labelKey: "hotkeys.row.history", kind: "composer", group: "input", defaults: ["⌃R"] },
	{
		id: "composer.editor",
		labelKey: "hotkeys.row.composerEditor",
		kind: "composer",
		group: "input",
		defaults: ["⌃G"],
	},
];

/** Ids of the composer shortcuts InputArea looks up. */
export type ComposerShortcutId = "composer.history" | "composer.editor";

/** Every shortcut in list order: composer keys, the app's actions by group, then app-level shortcuts. */
export const SHORTCUT_ENTRIES: readonly ShortcutEntry[] = [
	...COMPOSER_SHORTCUTS,
	...(["generation", "view", "session"] as const).flatMap(group =>
		KEYMAP_ACTIONS.filter(action => action.hotkeyGroup === group).map(
			(action: KeymapAction): ShortcutEntry => ({
				id: action.id,
				labelKey: action.labelKey,
				kind: "app",
				group,
				defaults: action.defaults,
				offMacDefaults: action.offMacDefaults,
			}),
		),
	),
	...NATIVE_CHORDS.map(
		(entry): ShortcutEntry => ({
			id: entry.id,
			labelKey: entry.labelKey,
			kind: "native",
			group: "native",
			defaults: [entry.chord],
		}),
	),
];

/** A built-in key the list shows for reference: typing keys, modifier clicks, and find steps. */
export interface BuiltInShortcut {
	readonly section: ShortcutSectionId;
	readonly keys: string;
	readonly labelKey: string;
	/** Listed before the section's shortcuts rather than after. */
	readonly first?: boolean;
}

/**
 * The keys no keymap owns. Unmodified keys (Enter, @, /) and the shift-only
 * ⇧Tab / Escape belong to focused controls and stay as they are; terminal-only
 * TUI rows (suspend, display reset, $EDITOR) are deliberately absent.
 */
export const BUILT_IN_SHORTCUTS: readonly BuiltInShortcut[] = [
	{ section: "input", keys: "Enter", labelKey: "hotkeys.row.send", first: true },
	{ section: "input", keys: "⇧Enter", labelKey: "hotkeys.row.newline", first: true },
	{ section: "input", keys: "-> / =>", labelKey: "hotkeys.row.queueShorthand", first: true },
	{ section: "input", keys: "!", labelKey: "hotkeys.row.bashMode", first: true },
	{ section: "input", keys: "$", labelKey: "hotkeys.row.pythonMode", first: true },
	{ section: "input", keys: "@", labelKey: "hotkeys.row.mention", first: true },
	{ section: "input", keys: "/", labelKey: "hotkeys.row.commands", first: true },
	{ section: "input", keys: "↑ / ↓", labelKey: "hotkeys.row.historyNav", first: true },
	{ section: "generation", keys: "Esc", labelKey: "hotkeys.row.abort", first: true },
	{ section: "generation", keys: "⇧Tab", labelKey: "hotkeys.row.thinkingCycle", first: true },
	{ section: "view", keys: "Enter / ⇧Enter", labelKey: "hotkeys.row.findStep" },
	// The menu's accelerators: ⌘G on macOS, F3 elsewhere (main/menu.ts).
	{ section: "view", keys: IS_MAC ? "⌘G / ⇧⌘G" : "F3 / ⇧F3", labelKey: "hotkeys.row.findStepMenu" },
	// The sidebar takes either modifier; each platform is shown its own.
	{ section: "sidebar", keys: IS_MAC ? "⌘-click" : "⌃-click", labelKey: "hotkeys.row.sidebarToggleSelect" },
	{ section: "sidebar", keys: "⇧-click", labelKey: "hotkeys.row.sidebarRangeSelect" },
	{ section: "sidebar", keys: platformChord("⌘A"), labelKey: "hotkeys.row.sidebarSelectAll" },
	{ section: "sidebar", keys: "⌫", labelKey: "hotkeys.row.sidebarDeleteSelected" },
	{ section: "sidebar", keys: "Esc", labelKey: "hotkeys.row.sidebarEndSelect" },
];

/** A section's rows in display order: leading built-in keys, its shortcuts, then the rest. */
export function shortcutSectionRows(
	section: ShortcutSectionId,
): ({ kind: "entry"; entry: ShortcutEntry } | { kind: "builtIn"; row: BuiltInShortcut })[] {
	const builtIn = BUILT_IN_SHORTCUTS.filter(row => row.section === section);
	return [
		...builtIn.filter(row => row.first).map(row => ({ kind: "builtIn" as const, row })),
		...SHORTCUT_ENTRIES.filter(entry => entry.group === section).map(entry => ({ kind: "entry" as const, entry })),
		...builtIn.filter(row => !row.first).map(row => ({ kind: "builtIn" as const, row })),
	];
}

/** The shortcuts a user can change or turn off. */
export const EDITABLE_SHORTCUTS: readonly ShortcutEntry[] = SHORTCUT_ENTRIES.filter(entry => !entry.fixed);

const shortcutById = new Map(SHORTCUT_ENTRIES.map(entry => [entry.id, entry]));

export function shortcutEntry(id: string): ShortcutEntry | undefined {
	return shortcutById.get(id);
}

/** The composer's follow-up send chord as the platform's keyboard has it. */
export const FOLLOW_UP_CHORD = platformChord("⌘↵");

/**
 * Whether Enter (or a send-button click) with these modifiers sends a follow-up,
 * queued behind the running turn, instead of steering it: ⌘ on macOS, where the
 * TUI's ⌃ still works too, and Ctrl elsewhere. AltGr reports Ctrl+Alt and never counts.
 */
export function isFollowUpSend(event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }, mac = IS_MAC): boolean {
	if (event.altKey) return false;
	return mac ? event.metaKey || event.ctrlKey : event.ctrlKey;
}

/** Whether a keydown is the platform's select-all: ⌘A on macOS, Ctrl+A elsewhere. */
export function isSelectAll(
	event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
	mac = IS_MAC,
): boolean {
	if (event.altKey || event.shiftKey || event.key.toLowerCase() !== "a") return false;
	return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** `chord` as the platform's keyboard has it: off macOS a default's ⌘ is ⌃. */
export function platformChord(chord: string, mac = IS_MAC): string {
	const parsed = parseChord(chord);
	if (mac || !parsed?.meta) return chord;
	return serializeChord({ ...parsed, ctrl: true, meta: false });
}

/** A shortcut's default chords on this platform. */
export function defaultChords(
	shortcut: Pick<ShortcutEntry, "defaults" | "offMacDefaults">,
	mac = IS_MAC,
): readonly string[] {
	if (mac) return shortcut.defaults;
	return [...new Set((shortcut.offMacDefaults ?? shortcut.defaults).map(chord => platformChord(chord, false)))];
}

/**
 * The chords that fire a shortcut: the user's binding, else its platform defaults.
 * An effective table's `[]` (turned off) yields none.
 */
export function actionChords(
	shortcut: Pick<ShortcutEntry, "id" | "defaults" | "offMacDefaults">,
	overrides: KeymapOverrides,
	mac = IS_MAC,
): readonly string[] {
	return overrides[shortcut.id] ?? defaultChords(shortcut, mac);
}

/** The saved overrides with `[]` for every shortcut the user turned off. */
export function effectiveOverrides(overrides: KeymapOverrides, disabled: readonly string[]): KeymapOverrides {
	if (disabled.length === 0) return overrides;
	const result: KeymapOverrides = { ...overrides };
	for (const id of disabled) result[id] = [];
	return result;
}

/** Whether a keydown in the composer is this composer shortcut under the effective table. */
export function isComposerShortcut(
	id: ComposerShortcutId,
	event: KeyEventLike,
	overrides: KeymapOverrides,
	mac = IS_MAC,
): boolean {
	const chord = chordFromEvent(event);
	const entry = shortcutById.get(id);
	if (!chord || !entry) return false;
	return actionChords(entry, overrides, mac).some(candidate => canonicalChord(candidate) === chord);
}

function canonicalChord(chord: string): string | null {
	const parsed = parseChord(chord);
	return parsed ? serializeChord(parsed) : null;
}

export type KeymapActionId = (typeof KEYMAP_ACTIONS)[number]["id"];

const keymapActionById = {} as Record<KeymapActionId, KeymapAction>;
for (const action of KEYMAP_ACTIONS) keymapActionById[action.id] = action;

export const KEYMAP_ACTION_BY_ID: Readonly<Record<KeymapActionId, KeymapAction>> = keymapActionById;

/**
 * Compile defaults + overrides into the dispatch lookup. A user's binding
 * REPLACES its action's defaults (no union — TUI parity), so a remapped
 * action's old chords go dead, and an effective `[]` leaves it unbound.
 * Defaults are applied first and user bindings second, so on a shadow the
 * explicit user chord deterministically wins the slot; user-user collisions
 * resolve in table order (findShortcutConflict refuses them before they save).
 */
export function compileKeymap<A extends KeymapAction>(
	actions: readonly A[],
	overrides: KeymapOverrides,
	mac = IS_MAC,
): Map<string, A["id"]> {
	const map = new Map<string, A["id"]>();
	for (const action of actions) {
		if (overrides[action.id] !== undefined) continue; // replaced or turned off, not merged
		for (const raw of defaultChords(action, mac)) {
			const chord = canonicalChord(raw);
			if (chord) map.set(chord, action.id);
		}
	}
	for (const action of actions) {
		for (const raw of overrides[action.id] ?? []) {
			const chord = canonicalChord(raw);
			if (chord) map.set(chord, action.id);
		}
	}
	return map;
}

export interface ShortcutConflict {
	/** "error" blocks saving: the key could not reach this shortcut. "warning" saves anyway. */
	kind: "error" | "warning";
	/**
	 * "taken" = another shortcut keeps the key (a menu or system shortcut, a
	 * user binding, or another composer key). "shadow" = this replaces another
	 * action's default. "composer" = the focused composer takes the key, and
	 * the app action gets it everywhere else.
	 */
	reason: "taken" | "shadow" | "composer";
	/** The shortcut that also claims the chord. */
	otherId: string;
}

/**
 * What binding `chord` to shortcut `id` would collide with, given the
 * effective table (turned-off shortcuts hold `[]` and claim nothing). Errors
 * win over warnings. Menu and system shortcuts take keys before any page sees
 * them, so any overlap with one is an error, in either direction.
 */
export function findShortcutConflict(
	id: string,
	chord: string,
	overrides: KeymapOverrides,
	mac = IS_MAC,
): ShortcutConflict | null {
	const self = shortcutById.get(id);
	const target = canonicalChord(chord);
	if (!self || !target) return null;
	let warning: ShortcutConflict | null = null;
	for (const other of SHORTCUT_ENTRIES) {
		if (other.id === id) continue;
		const claims = actionChords(other, overrides, mac).some(candidate => canonicalChord(candidate) === target);
		if (!claims) continue;
		if (self.kind === "native" || other.kind === "native")
			return { kind: "error", reason: "taken", otherId: other.id };
		if (self.kind === other.kind) {
			if (self.kind === "composer") return { kind: "error", reason: "taken", otherId: other.id };
			if (overrides[other.id]?.length) return { kind: "error", reason: "taken", otherId: other.id };
			warning ??= { kind: "warning", reason: "shadow", otherId: other.id };
			continue;
		}
		warning ??= { kind: "warning", reason: "composer", otherId: other.id };
	}
	return warning;
}

/**
 * Validate a raw prefs payload into overrides: unknown or fixed shortcuts are
 * ignored (prefs drift across builds), values must be string arrays, each
 * chord must parse, chords canonicalize and dedupe, and empty lists drop out
 * (a shortcut with no chords falls back to its defaults).
 */
export function sanitizeOverrides(raw: unknown): KeymapOverrides {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const result: KeymapOverrides = {};
	for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!editableIds.has(id) || !Array.isArray(value)) continue;
		const chords: string[] = [];
		for (const item of value) {
			if (typeof item !== "string") continue;
			const chord = canonicalChord(item);
			if (chord && !chords.includes(chord)) chords.push(chord);
		}
		if (chords.length > 0) result[id] = chords;
	}
	return result;
}

/** Validate a raw prefs payload into the ids of turned-off shortcuts. */
export function sanitizeDisabled(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return [...new Set(raw.filter((id): id is string => typeof id === "string" && editableIds.has(id)))];
}

const editableIds = new Set(EDITABLE_SHORTCUTS.map(entry => entry.id));
