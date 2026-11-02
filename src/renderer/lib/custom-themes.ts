/**
 * Custom theme files (gui#38). A file names a built-in theme to start from
 * and overrides any of its tokens, so it can be a few lines and keeps working
 * when later releases add tokens:
 *
 *   { "name": "Midnight", "extends": "dark", "tokens": { "accent": "#c792ea" } }
 *
 * - `extends`: a built-in theme id (dark, light, nord, …). Without it the
 *   theme starts from dark, or from light when `scheme` is "light".
 * - `scheme`: "dark" or "light", for native controls and scheme-aware parts
 *   (charts, diagrams). Defaults to the base theme's.
 * - `tokens`: token names with or without the `--omp-` prefix. Each value is
 *   checked on its own; an unknown name or a value that is not a color (or a
 *   box shadow for the shadow tokens) is skipped and reported, and the rest
 *   of the theme still applies.
 */

import type { IpcCustomThemeFile } from "../../shared/ipc-types";
import {
	type CustomThemeSelection,
	isThemeTokenValue,
	THEME_TOKEN_KEYS,
	THEMES,
	type ThemeDefinition,
	type ThemeName,
	type ThemeTokenKey,
} from "./themes";

export type CustomThemeProblem =
	/** The file could not be read or is not valid JSON (`detail` says why). */
	| "unreadable"
	| "notObject"
	/** `extends` names no built-in theme (`detail` is the name). */
	| "unknownBase"
	/** `scheme` is neither "dark" nor "light". */
	| "badScheme";

export interface CustomThemeEntry {
	selection: CustomThemeSelection;
	fileName: string;
	/** The theme, filled from its base; absent when the file has a problem. */
	theme?: ThemeDefinition;
	problem?: CustomThemeProblem;
	detail?: string;
	/** Token entries left out: unknown names or values that are not colors. */
	skipped: string[];
}

const TOKEN_KEYS = new Set<string>(THEME_TOKEN_KEYS);
const MAX_LABEL = 60;
const MAX_DESCRIPTION = 200;

function isBuiltin(name: string): name is ThemeName {
	return Object.hasOwn(THEMES, name);
}

function text(value: unknown, max: number): string {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function parseCustomThemeFile(file: IpcCustomThemeFile): CustomThemeEntry {
	const entry: CustomThemeEntry = { selection: `custom:${file.id}`, fileName: file.fileName, skipped: [] };
	if (file.error !== undefined) return { ...entry, problem: "unreadable", detail: file.error };
	const data = file.data;
	if (typeof data !== "object" || data === null || Array.isArray(data)) return { ...entry, problem: "notObject" };
	const json = data as Record<string, unknown>;

	if (json.scheme !== undefined && json.scheme !== "dark" && json.scheme !== "light") {
		return { ...entry, problem: "badScheme" };
	}
	let base: ThemeDefinition;
	if (json.extends !== undefined) {
		const name = typeof json.extends === "string" ? json.extends : "";
		if (!isBuiltin(name)) return { ...entry, problem: "unknownBase", detail: String(json.extends) };
		base = THEMES[name];
	} else {
		base = THEMES[json.scheme === "light" ? "light" : "dark"];
	}

	const tokens = { ...base.tokens };
	const overrides = json.tokens;
	if (typeof overrides === "object" && overrides !== null && !Array.isArray(overrides)) {
		for (const [name, value] of Object.entries(overrides)) {
			const key = name.startsWith("--omp-") ? name : `--omp-${name}`;
			const trimmed = typeof value === "string" ? value.trim() : "";
			if (!TOKEN_KEYS.has(key) || !isThemeTokenValue(key as ThemeTokenKey, trimmed)) {
				entry.skipped.push(name);
				continue;
			}
			tokens[key as ThemeTokenKey] = trimmed;
		}
	} else if (overrides !== undefined) {
		entry.skipped.push("tokens");
	}

	return {
		...entry,
		theme: {
			label: text(json.name, MAX_LABEL) || file.id,
			description: text(json.description, MAX_DESCRIPTION),
			scheme: json.scheme === "dark" || json.scheme === "light" ? json.scheme : base.scheme,
			tokens,
		},
	};
}
