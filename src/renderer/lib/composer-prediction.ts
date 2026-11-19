/**
 * Composer predictions (omp 19): after a run finishes, the agent guesses the
 * user's next message with a short side turn on the same context. The sidecar
 * owns the request (the `composer.predictions` setting, billing, staleness);
 * the GUI asks only while its composer is empty, shows the guess over it, and
 * reports how it was used so a dismissed guess stops costing.
 */

import type { AgentMessage } from "../../shared/rpc-types";
import type { ComposerStore } from "../stores/composer";
import { sessionRuntime, sessionRuntimeStore } from "../stores/session-runtime-context";
import type { TabRpc } from "./tab-rpc";

export type PredictionFeedback = "shown" | "accepted" | "dismissed";

/** Tabs with a request out whose answer has not arrived: a new run must still cancel it. */
const awaiting = new Set<string>();

/** A run worth predicting after: it ended with a reply, not an error or a stop (TUI `#settledRunStatus`). */
export function runFinishedWithReply(messages: readonly AgentMessage[] | undefined): boolean {
	const last = messages?.findLast(message => message.role === "assistant");
	if (last?.role !== "assistant") return false;
	return last.stopReason !== "error" && last.stopReason !== "aborted";
}

/** Ask tab `tabId`'s sidecar for a prediction while its composer is empty. */
export function requestComposerPrediction(tabId: string): void {
	const composer = sessionRuntimeStore<ComposerStore>(tabId, "composer")?.getState();
	// No runtime, or a draft (text or images) already under way: nothing to guess for.
	if (composer?.draft.trim() !== "" || composer.images.length > 0) return;
	const runtime = sessionRuntime(tabId);
	if (!runtime) return;
	awaiting.add(tabId);
	runtime.command({ type: "composer_prediction_request" }).catch(() => awaiting.delete(tabId));
}

/** A `composer_prediction` frame arrived for tab `tabId`: show it (an empty one withdraws the last). */
export function receiveComposerPrediction(tabId: string, choices: string[]): void {
	awaiting.delete(tabId);
	sessionRuntimeStore<ComposerStore>(tabId, "composer")?.getState().setPredictions(choices);
}

/** A new run started on tab `tabId`: withdraw the guess it made moot, and stop paying for one still coming. */
export function retireComposerPrediction(tabId: string): void {
	const composer = sessionRuntimeStore<ComposerStore>(tabId, "composer")?.getState();
	const shown = (composer?.predictions.length ?? 0) > 0;
	// A request still out (skipped or not yet answered) is cancelled as well, so it stops billing.
	if (!shown && !awaiting.delete(tabId)) return;
	if (shown) composer?.setPredictions([]);
	sessionRuntime(tabId)
		?.command({ type: "composer_prediction_feedback", action: "dismissed" })
		.catch(() => {});
}

/** Report how the user treated the prediction; `dismissed` also aborts a request still running. */
export function sendPredictionFeedback(rpc: TabRpc, action: PredictionFeedback, rank?: number): void {
	rpc.command({ type: "composer_prediction_feedback", action, ...(rank !== undefined ? { rank } : {}) }).catch(
		() => {},
	);
}
