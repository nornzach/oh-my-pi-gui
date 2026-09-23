/**
 * Keeps the system-tray menu in sync: derives a TrayState snapshot from the
 * live stores (model, settings, session, language, workspace list) and pushes
 * it to the main process on every change. Main installs a new native menu only
 * when a visible label changed and never while one is open, so pushing on every
 * session-list refresh costs a comparison instead of swapping the menu under the
 * cursor. Actions route back here via MENU_ACTION.
 */

import { useEffect } from "react";
import type { TrayState } from "../../shared/ipc-types";
import { contextUsageView } from "../lib/context-usage";
import { basename } from "../lib/format";
import { useLang } from "../lib/i18n";
import { useModelStore } from "../stores/model";
import { useSessionStore } from "../stores/session";
import { useSettingsStore } from "../stores/settings";
import { useAwaitingConfirmation } from "./use-awaiting-confirmation";
import { useSessionList } from "./use-session-list";

export function useTraySync(): void {
	const { lang } = useLang();
	const model = useModelStore(s => s.model);
	const thinkingLevel = useModelStore(s => s.thinkingLevel);
	const fastMode = useModelStore(s => s.fastModeEnabled);
	const approvalMode = useSettingsStore(s => s.approvalMode);
	const cwd = useSessionStore(s => s.cwd);
	const isStreaming = useSessionStore(s => s.isStreaming);
	const awaitingConfirmation = useAwaitingConfirmation();
	const status = useSessionStore(s => s.status);
	const contextUsage = useSessionStore(s => s.contextUsage);
	// Primitives so the push effect re-runs on a real change, not a new object.
	const contextView = contextUsageView(contextUsage);
	const contextPercent = contextUsage && contextView.capacityKnown ? contextView.percent : null;
	const contextTokens = contextUsage ? contextView.usedTokens : null;
	const { sessions } = useSessionList("global");

	useEffect(() => {
		// Unique workspaces by cwd, most-recently-active first, current flagged.
		const byCwd = new Map<string, number>();
		for (const session of sessions) {
			const modified = Date.parse(session.modified) || 0;
			if (modified > (byCwd.get(session.cwd) ?? -1)) byCwd.set(session.cwd, modified);
		}
		if (cwd && !byCwd.has(cwd)) byCwd.set(cwd, 0);
		const workspaces = [...byCwd.keys()]
			.sort((a, b) => (byCwd.get(b) ?? 0) - (byCwd.get(a) ?? 0))
			.slice(0, 9)
			.map(wsCwd => ({ cwd: wsCwd, name: basename(wsCwd) || wsCwd, current: wsCwd === cwd }));

		const trayStatus: TrayState["status"] =
			status === "error" ? "error" : awaitingConfirmation ? "waiting" : isStreaming ? "streaming" : "idle";

		window.omp.tray.pushState({
			status: trayStatus,
			language: lang === "en" ? "en" : "zh",
			cwd: cwd || null,
			projectName: cwd ? basename(cwd) || cwd : "omp",
			modelId: model?.id ?? null,
			thinkingLevel: thinkingLevel ?? "off",
			fastMode,
			approvalMode,
			contextPercent,
			contextTokens,
			workspaces,
		});
	}, [
		lang,
		model,
		thinkingLevel,
		fastMode,
		approvalMode,
		cwd,
		isStreaming,
		awaitingConfirmation,
		status,
		contextPercent,
		contextTokens,
		sessions,
	]);
}
