/**
 * Custom themes from ~/.omp/gui/themes (gui#38), for the theme picker. Main
 * reads the folder and pushes every change; this store parses the files and
 * hands the usable ones to the theme registry, so a theme on screen follows
 * edits to its file.
 */
import { create } from "zustand";
import type { IpcCustomThemes } from "../../shared/ipc-types";
import { type CustomThemeEntry, parseCustomThemeFile } from "../lib/custom-themes";
import { type CustomThemeSelection, setCustomThemes, type ThemeDefinition } from "../lib/themes";

interface CustomThemesState {
	/** The folder; null until main has answered. */
	dir: string | null;
	entries: CustomThemeEntry[];
	reset: () => void;
}

/**
 * The last version of each theme that parsed. A file saved mid-edit with a
 * typo keeps showing it instead of dropping the window to a built-in theme;
 * a deleted file takes it along.
 */
const lastGood = new Map<CustomThemeSelection, ThemeDefinition>();

export const useCustomThemesStore = create<CustomThemesState>()(set => ({
	dir: null,
	entries: [],
	reset: () => {
		lastGood.clear();
		set({ dir: null, entries: [] });
	},
}));

export function loadCustomThemes(themes: IpcCustomThemes): void {
	const entries = themes.files.map(parseCustomThemeFile);
	const usable = new Map<CustomThemeSelection, ThemeDefinition>();
	for (const entry of entries) {
		const theme = entry.theme ?? lastGood.get(entry.selection);
		if (theme) usable.set(entry.selection, theme);
	}
	lastGood.clear();
	for (const [selection, theme] of usable) lastGood.set(selection, theme);
	useCustomThemesStore.setState({ dir: themes.dir, entries });
	setCustomThemes(usable);
}

/** Reads the folder once and follows it; call once at App boot. Returns the teardown. */
export function initCustomThemes(): () => void {
	let pushed = false;
	const unsubscribe = window.omp.themes.onChanged(themes => {
		pushed = true;
		loadCustomThemes(themes);
	});
	void window.omp.themes
		.list()
		.then(themes => {
			// A change pushed meanwhile is newer than this read.
			if (!pushed) loadCustomThemes(themes);
		})
		.catch(() => {
			// Without the files a custom theme on screen would wait for them forever.
			if (!pushed) setCustomThemes(new Map());
		});
	return unsubscribe;
}
