import { GUI_DISPLAY_LEGACY_PATHS } from "../../lib/display-preferences";
/**
 * Settings schema helpers: condition-gated visibility and tab/group
 * bucketing, mirroring the TUI's settings-defs.ts. Extracted verbatim from
 * SettingsWindow.tsx.
 */

import type { SettingEntry } from "../../../shared/rpc-types";
import { ZH_SETTINGS } from "./schema-zh";

/**
 * Client-evaluable visibility gates, mirroring the TUI's CONDITIONS table
 * (settings-defs.ts). Each key is a `condition` name carried on the schema
 * entry; the predicate reads the current settings values. Gates that depend
 * on terminal capabilities (hasImageProtocol) are intentionally absent:
 * unresolvable conditions keep the entry visible.
 */
const CONDITION_EVALUATORS: Record<string, (values: Record<string, unknown>) => boolean> = {
	advisorEnabled: values => values["advisor.enabled"] === true,
	hindsightActive: values => values["memory.backend"] === "hindsight",
	mnemopiActive: values => values["memory.backend"] === "mnemopi",
	autolearnActive: values => values["autolearn.enabled"] === true,
	autoThinkingActive: values => values.defaultThinkingLevel === "auto",
	usageAwareFallbackEnabled: values => values["retry.usageAwareFallback"] === true,
	planModeEnabled: values => values["plan.enabled"] === true,
	vimModeEnabled: values => values["tui.vimMode"] === true,
	planAutosaveEnabled: values => values["plan.enabled"] === true && values["plan.autosave"] === true,
	unexpectedStopDetection: values => values["features.unexpectedStopDetection"] === true,
};

/**
 * Condition-gated visibility (TUI #defToItem parity): an entry is hidden only
 * when its condition names a known, client-evaluable gate that currently
 * resolves false. Unknown gates fail open (visible).
 */
export function isSettingVisible(entry: SettingEntry, values: Record<string, unknown>): boolean {
	if (entry.condition === undefined) return true;
	const evaluate = CONDITION_EVALUATORS[entry.condition];
	return evaluate === undefined ? true : evaluate(values);
}

/** Terminal display settings and equivalents owned by GUI preferences. */
const TERMINAL_DISPLAY_SETTINGS = new Set([
	...GUI_DISPLAY_LEGACY_PATHS,
	"tui.resizeScrollback",
	"statusLine.preset",
	"display.showTurnTime",
	"theme.dark",
	"theme.light",
	"tui.tight",
	"colorBlindMode",
	"spelling.typoDetection",
	"spelling.autocomplete",
	"spelling.autocorrect",
	// Vim mode's indicator is rendered only by the TUI status line. Keeping the
	// schema row out of the GUI prevents a control that can never affect this
	// renderer from being advertised under a conditional gate.
	"tui.vimModeDisplay",
	"tui.mouse",
	"tui.maxInlineImageColumns",
	"tui.maxInlineImageRows",
	"tui.maxInlineImages",
	"statusLine.leftSegments",
	"statusLine.rightSegments",
	"statusLine.segmentOptions",
]);

export function isSettingSupportedInGui(entry: { path?: string; tuiOnly?: boolean }): boolean {
	return entry.tuiOnly !== true && !TERMINAL_DISPLAY_SETTINGS.has(entry.path ?? "");
}

export function isSettingVisibleInGui(entry: SettingEntry, values: Record<string, unknown>): boolean {
	return isSettingSupportedInGui(entry) && isSettingVisible(entry, values);
}

/**
 * Bucket one tab's entries for rendering: ungrouped settings first (no
 * heading), then groups in the schema-declared order, with groups missing
 * from the declared order appended defensively at the end.
 */
export function groupSchemaEntries(
	entries: SettingEntry[],
	tabId: string,
	groups: string[],
): {
	tabEntries: SettingEntry[];
	ungrouped: SettingEntry[];
	orderedGroups: { name: string; entries: SettingEntry[] }[];
} {
	const tabEntries = entries.filter(entry => entry.tab === tabId);
	const byGroup = new Map<string, SettingEntry[]>();
	const ungrouped: SettingEntry[] = [];
	for (const entry of tabEntries) {
		if (entry.group === undefined) {
			ungrouped.push(entry);
			continue;
		}
		const list = byGroup.get(entry.group) ?? [];
		list.push(entry);
		byGroup.set(entry.group, list);
	}
	const ordered = groups.filter(group => byGroup.has(group));
	for (const name of byGroup.keys()) {
		if (!ordered.includes(name)) ordered.push(name);
	}
	return {
		tabEntries,
		ungrouped,
		orderedGroups: ordered.map(name => ({ name, entries: byGroup.get(name) ?? [] })),
	};
}

const CAPABILITIES_TAB_ID = "capabilities";
const RESOURCES_TAB_ID = "resources";

export function resolveSettingsTarget(target: string | null | undefined): {
	tab: string;
	resourceTab?: "plugins" | "marketplaces" | "templates" | "memory";
} {
	const requested = target || CAPABILITIES_TAB_ID;
	if (!requested.startsWith(`${RESOURCES_TAB_ID}:`)) return { tab: requested };
	const resource = requested.slice(RESOURCES_TAB_ID.length + 1);
	const resourceTab: "plugins" | "marketplaces" | "templates" | "memory" =
		resource === "marketplaces" || resource === "templates" || resource === "memory" ? resource : "plugins";
	return { tab: RESOURCES_TAB_ID, resourceTab };
}

/** Search the displayed Chinese labels as well as wire paths and English metadata. */
export function matchesSettingSearch(entry: SettingEntry, query: string): boolean {
	const zh = ZH_SETTINGS[entry.path];
	const haystack = [entry.path, entry.label, entry.description, zh?.label, zh?.description]
		.join(" ")
		.normalize("NFKC")
		.toLowerCase();
	return query
		.normalize("NFKC")
		.toLowerCase()
		.trim()
		.split(/\s+/)
		.every(word => haystack.includes(word));
}
