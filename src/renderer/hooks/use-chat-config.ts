import { useT } from "../lib/i18n";
import { useActiveTabKind } from "../stores/tabs";
import { type LiveSettingsHandle, useLiveSettings } from "./use-live-settings";

/** The agent's `chat.*` settings, shared by every chat tab. */
export interface ChatConfig {
	/** Sent as the whole system prompt; blank keeps the default chat prompt. */
	systemPrompt: string;
	/** `single` sends every message on its own. */
	history: "continuous" | "single";
	/** Earlier turns a continuous chat sends with each message; 0 sends them all. */
	historyTurns: number;
}

export const CHAT_SETTING_PATHS = {
	systemPrompt: "chat.systemPrompt",
	history: "chat.history",
	historyTurns: "chat.historyTurns",
} as const;
const CHAT_SETTING_PATH_LIST: string[] = Object.values(CHAT_SETTING_PATHS);

function parseChatConfig(values: Record<string, unknown> | undefined): ChatConfig {
	const systemPrompt = values?.[CHAT_SETTING_PATHS.systemPrompt];
	const turns = values?.[CHAT_SETTING_PATHS.historyTurns];
	return {
		systemPrompt: typeof systemPrompt === "string" ? systemPrompt : "",
		history: values?.[CHAT_SETTING_PATHS.history] === "single" ? "single" : "continuous",
		historyTurns: typeof turns === "number" && Number.isInteger(turns) && turns > 0 ? turns : 0,
	};
}

/** Earlier turns each chat message carries, or `null` for the whole conversation (the agent's `chatHistoryLimit`). */
export function chatHistoryLimit(config: ChatConfig): number | null {
	if (config.history === "single") return 0;
	return config.historyTurns > 0 ? config.historyTurns : null;
}

/** Live chat settings for the focused task. */
export function useChatConfig(): LiveSettingsHandle<ChatConfig> {
	const t = useT();
	return useLiveSettings(CHAT_SETTING_PATH_LIST, parseChatConfig, t("settings.saveFailed"));
}

/**
 * Whether the focused task is a chat that sends only its latest turns. Such a chat
 * never auto-compacts: its stored history beyond those turns never reaches a request.
 */
export function useChatHistoryLimited(): boolean {
	const isChat = useActiveTabKind() === "chat";
	const { config } = useChatConfig();
	return isChat && config !== null && chatHistoryLimit(config) !== null;
}
