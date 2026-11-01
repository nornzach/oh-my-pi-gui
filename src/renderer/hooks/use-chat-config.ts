import { useCallback, useEffect, useRef, useState } from "react";
import type { RpcChatConfig } from "../../shared/rpc-types";
import { useT } from "../lib/i18n";
import { useTabRpc } from "../lib/tab-rpc";
import { useSessionStore } from "../stores/session";
import { useActiveTabKind } from "../stores/tabs";
import { toast } from "../stores/toast";

/** One chat's own settings; a chat that saved none follows the agent's `chat.*` defaults. */
export type ChatConfig = RpcChatConfig;

export interface ChatConfigHandle {
	/** `null` until the first read lands, outside a chat, or while the sidecar is not ready. */
	config: ChatConfig | null;
	/** True while a save is in flight. */
	saving: boolean;
	/** Save `patch` into this chat only; resolves true when it was saved. */
	write: (patch: Partial<ChatConfig>) => Promise<boolean>;
}

/** Earlier turns each chat message carries, or `null` for the whole conversation (the agent's `chatHistoryLimit`). */
export function chatHistoryLimit(config: ChatConfig): number | null {
	if (config.history === "single") return 0;
	return config.historyTurns > 0 ? config.historyTurns : null;
}

/**
 * The focused chat's own settings (`enabled` false outside a chat). Re-read on
 * sidecar ready, session change and every `config_update` push, so a change to
 * the defaults shows up in a chat that still follows them. A failed save toasts.
 */
export function useChatConfig(enabled = true): ChatConfigHandle {
	const t = useT();
	const rpc = useTabRpc();
	const ready = useSessionStore(state => state.status) === "ready";
	const sessionId = useSessionStore(state => state.sessionId);
	const [config, setConfig] = useState<ChatConfig | null>(null);
	const [saving, setSaving] = useState(false);
	const version = useRef(0);

	const read = useCallback(async () => {
		const mine = ++version.current;
		try {
			const response = await rpc.getChatConfig();
			// A newer read, or a save that landed meanwhile, supersedes this one.
			if (mine !== version.current || !response.success) return;
			setConfig(response.data as ChatConfig);
		} catch {
			// An unreadable config leaves the last known one in place.
		}
	}, [rpc]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new session re-reads even when the sidecar stays ready
	useEffect(() => {
		if (!ready || !enabled) {
			setConfig(null);
			return;
		}
		void read();
		return window.omp.events.onConfigUpdate(() => void read());
	}, [ready, enabled, sessionId, read]);

	const write = useCallback(
		async (patch: Partial<ChatConfig>) => {
			setSaving(true);
			const mine = ++version.current;
			try {
				const response = await rpc.setChatConfig(patch);
				if (!response.success) throw new Error(response.error);
				if (mine === version.current) setConfig(response.data as ChatConfig);
				return true;
			} catch (cause) {
				toast({ variant: "error", title: t("settings.saveFailed"), message: String(cause) });
				void read();
				return false;
			} finally {
				setSaving(false);
			}
		},
		[rpc, read, t],
	);

	return { config, saving, write };
}

/**
 * Whether the focused task is a chat that sends only its latest turns. Such a chat
 * never auto-compacts: its stored history beyond those turns never reaches a request.
 */
export function useChatHistoryLimited(): boolean {
	const { config } = useChatConfig(useActiveTabKind() === "chat");
	return config !== null && chatHistoryLimit(config) !== null;
}
