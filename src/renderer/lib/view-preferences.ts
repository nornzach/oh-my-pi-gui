/**
 * Shared view-preference actions: single source of truth for the TitleBar view
 * control center, keyboard shortcuts, command palette, and Settings.
 */
import { type ChatWidth, type ThemeMode, type TranscriptDetail, useUiStore } from "../stores/ui";
import { saveGuiPreference } from "./display-preferences";
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

export function applyThemeModePreference(mode: ThemeMode): void {
	applyThemeByName(mode);
	useUiStore.getState().setTheme(mode);
}

export function applyChatWidthPreference(next: ChatWidth): void {
	void saveGuiPreference("chatWidth", next, () => useUiStore.getState().setChatWidth(next));
}

export function cycleChatWidthPreference(): ChatWidth {
	const next = nextChatWidth(useUiStore.getState().chatWidth);
	applyChatWidthPreference(next);
	return next;
}

export function applyFontSizePreference(next: number): number {
	const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(next)));
	if (clamped !== useUiStore.getState().fontSize) {
		void saveGuiPreference("fontSize", clamped, () => useUiStore.getState().setFontSize(clamped));
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
	void saveGuiPreference("compactDensity", next, () => useUiStore.setState({ compactDensity: next }));
}

export function toggleCompactDensityPreference(): boolean {
	const next = !useUiStore.getState().compactDensity;
	applyCompactDensityPreference(next);
	return next;
}

export function applyProcessPresetPreference(preset: ProcessDetailPreset): void {
	const ui = useUiStore.getState();
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

	void saveGuiPreference("transcriptDetail", config.transcriptDetail, () =>
		ui.setTranscriptDetail(config.transcriptDetail),
	);
	void saveGuiPreference("autoCollapseProcess", config.autoCollapseProcess, () =>
		ui.setAutoCollapseProcess(config.autoCollapseProcess),
	);
	void saveGuiPreference("thinkingExpanded", config.thinkingExpanded, () =>
		ui.setThinkingExpanded(config.thinkingExpanded),
	);
}
