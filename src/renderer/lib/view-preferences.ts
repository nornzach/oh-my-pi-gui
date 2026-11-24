/**
 * Shared view-preference actions: single source of truth for the TitleBar view
 * control center, keyboard shortcuts, command palette, and Settings.
 */
import { toast } from "../stores/toast";
import { type ChatWidth, type ThemeMode, type TranscriptDetail, useUiStore } from "../stores/ui";
import { translate } from "./i18n";
import { applyChatWidth, applyCompactDensity, applyFontSize } from "./theme";
import { applyThemeByName } from "./themes";

export const WIDTH_ORDER: readonly ChatWidth[] = ["standard", "wide", "full"];
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 20;
export const FONT_SIZE_DEFAULT = 15;

/** Unified 3-tier conversation process visibility preset (resolves overlapping switches). */
export type ProcessDetailPreset = "minimal" | "balanced" | "detailed";

export function nextChatWidth(current: ChatWidth): ChatWidth {
	const index = WIDTH_ORDER.indexOf(current);
	return WIDTH_ORDER[(index + 1) % WIDTH_ORDER.length] ?? "standard";
}

export function resolveProcessPreset(state: {
	transcriptDetail: TranscriptDetail;
	autoCollapseProcess: boolean;
	thinkingExpanded: boolean;
}): ProcessDetailPreset {
	if (state.transcriptDetail === "compact") return "minimal";
	if (state.thinkingExpanded && !state.autoCollapseProcess) return "detailed";
	return "balanced";
}

async function persistPrefs(entries: readonly (readonly [string, unknown])[], rollback: () => void): Promise<boolean> {
	try {
		await Promise.all(entries.map(([key, value]) => window.omp.prefs.set(key, value)));
		return true;
	} catch (error) {
		rollback();
		toast({ variant: "error", title: translate("settings.saveFailed"), message: String(error) });
		return false;
	}
}

export function applyThemeModePreference(mode: ThemeMode): void {
	applyThemeByName(mode);
	useUiStore.getState().setTheme(mode);
}

export function applyChatWidthPreference(next: ChatWidth): void {
	const previous = useUiStore.getState().chatWidth;
	if (previous === next) return;
	applyChatWidth(next);
	useUiStore.getState().setChatWidth(next);
	void persistPrefs([["chatWidth", next]], () => {
		applyChatWidth(previous);
		useUiStore.getState().setChatWidth(previous);
	});
}

export function cycleChatWidthPreference(): ChatWidth {
	const next = nextChatWidth(useUiStore.getState().chatWidth);
	applyChatWidthPreference(next);
	return next;
}

export function applyFontSizePreference(next: number): number {
	const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(next)));
	const previous = useUiStore.getState().fontSize;
	if (clamped !== previous) {
		applyFontSize(clamped);
		useUiStore.getState().setFontSize(clamped);
		void persistPrefs([["fontSize", clamped]], () => {
			applyFontSize(previous);
			useUiStore.getState().setFontSize(previous);
		});
	}
	return clamped;
}

export function stepFontSizePreference(delta: number): number {
	return applyFontSizePreference(useUiStore.getState().fontSize + delta);
}

export function resetFontSizePreference(): number {
	return applyFontSizePreference(FONT_SIZE_DEFAULT);
}

export function applyCompactDensityPreference(next: boolean): void {
	const previous = useUiStore.getState().compactDensity;
	if (previous === next) return;
	applyCompactDensity(next);
	useUiStore.setState({ compactDensity: next });
	void persistPrefs([["compactDensity", next]], () => {
		applyCompactDensity(previous);
		useUiStore.setState({ compactDensity: previous });
	});
}

export function toggleCompactDensityPreference(): boolean {
	const next = !useUiStore.getState().compactDensity;
	applyCompactDensityPreference(next);
	return next;
}

export function applyProcessPresetPreference(preset: ProcessDetailPreset): void {
	const ui = useUiStore.getState();
	const previous = {
		transcriptDetail: ui.transcriptDetail,
		autoCollapseProcess: ui.autoCollapseProcess,
		thinkingExpanded: ui.thinkingExpanded,
	};
	const config: {
		transcriptDetail: TranscriptDetail;
		autoCollapseProcess: boolean;
		thinkingExpanded: boolean;
	} =
		preset === "minimal"
			? { transcriptDetail: "compact", autoCollapseProcess: true, thinkingExpanded: false }
			: preset === "detailed"
				? { transcriptDetail: "full", autoCollapseProcess: false, thinkingExpanded: true }
				: { transcriptDetail: "full", autoCollapseProcess: true, thinkingExpanded: false };

	// Atomic single-commit update: avoids 3 consecutive ChatStream row rebuilds
	// and intermediate preset states when switching Minimal / Balanced / Detailed.
	useUiStore.setState(config);
	void persistPrefs(
		[
			["transcriptDetail", config.transcriptDetail],
			["autoCollapseProcess", config.autoCollapseProcess],
			["thinkingExpanded", config.thinkingExpanded],
		],
		() => useUiStore.setState(previous),
	);
}
