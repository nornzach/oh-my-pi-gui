import { useCallback, useEffect, useRef, useState } from "react";
import { CONTEXT_SETTING_PATH_LIST, type CompactionConfig, parseCompactionConfig } from "../lib/context-strategy";
import { useT } from "../lib/i18n";
import { useTabRpc } from "../lib/tab-rpc";
import { useSessionStore } from "../stores/session";
import { toast } from "../stores/toast";

export interface CompactionConfigHandle {
	/** `null` until the first read lands (or while the sidecar is not ready). */
	config: CompactionConfig | null;
	/** True while a write is in flight. */
	saving: boolean;
	/** Apply `set_setting` writes in order; resolves true only if every one succeeded. */
	write: (patch: Array<{ path: string; value: unknown }>) => Promise<boolean>;
}

/**
 * Live compaction settings for the focused task. Re-read on sidecar ready,
 * session change and every `config_update` push, so an edit made in Settings,
 * the TUI or another window shows up here without a reload.
 */
export function useCompactionConfig(): CompactionConfigHandle {
	const t = useT();
	const rpc = useTabRpc();
	const ready = useSessionStore(state => state.status) === "ready";
	const sessionId = useSessionStore(state => state.sessionId);
	const [config, setConfig] = useState<CompactionConfig | null>(null);
	const [saving, setSaving] = useState(false);
	const version = useRef(0);

	const read = useCallback(async () => {
		const mine = ++version.current;
		try {
			const response = await rpc.getSettings(CONTEXT_SETTING_PATH_LIST);
			// A newer read, or a write that landed meanwhile, supersedes this one.
			if (mine !== version.current || !response.success) return;
			const values = (response.data as { values?: Record<string, unknown> } | undefined)?.values;
			setConfig(parseCompactionConfig(values));
		} catch {
			// Unreadable settings leave the last known config in place.
		}
	}, [rpc]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new session re-reads even when the sidecar stays ready
	useEffect(() => {
		if (!ready) {
			setConfig(null);
			return;
		}
		void read();
		return window.omp.events.onConfigUpdate(() => void read());
	}, [ready, sessionId, read]);

	const write = useCallback(
		async (patch: Array<{ path: string; value: unknown }>) => {
			setSaving(true);
			try {
				for (const { path, value } of patch) {
					const response = await rpc.setSetting(path, value);
					if (!response.success) throw new Error(response.error);
				}
				return true;
			} catch (cause) {
				toast({ variant: "error", title: t("contextStrategy.saveFailed"), message: String(cause) });
				return false;
			} finally {
				setSaving(false);
				await read();
			}
		},
		[rpc, read, t],
	);

	return { config, saving, write };
}
