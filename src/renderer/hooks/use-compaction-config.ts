import {
	CONTEXT_SETTING_PATH_LIST,
	type CompactionConfig,
	parseCompactionConfig,
	windowCompactionThreshold,
} from "../lib/context-strategy";
import { useT } from "../lib/i18n";
import { useSettingsStore } from "../stores/settings";
import { useChatHistoryLimited } from "./use-chat-config";
import { type LiveSettingsHandle, useLiveSettings } from "./use-live-settings";

export type CompactionConfigHandle = LiveSettingsHandle<CompactionConfig>;

/** Live compaction settings for the focused task. */
export function useCompactionConfig(): CompactionConfigHandle {
	const t = useT();
	return useLiveSettings(CONTEXT_SETTING_PATH_LIST, parseCompactionConfig, t("contextStrategy.saveFailed"));
}

/**
 * Where auto-compaction fires in a window of `contextWindow` tokens — the
 * threshold the strategy bar names — or null while it is off or unread.
 */
export function useAutoCompactAt(contextWindow: number): number | null {
	const autoCompaction = useSettingsStore(state => state.autoCompaction);
	const { config } = useCompactionConfig();
	const chatHistoryLimited = useChatHistoryLimited();
	return autoCompaction && config && !chatHistoryLimited ? windowCompactionThreshold(config, contextWindow) : null;
}
