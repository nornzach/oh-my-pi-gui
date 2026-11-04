import type { PromptCacheColdReason, PromptCacheStatus } from "../../shared/rpc-types";
import { formatClock, formatTokens } from "./format";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** One row of the Session Info prompt-cache section. */
export interface PromptCacheRow {
	label: string;
	value: string;
	tone?: "warning";
}

function reasonText(reason: PromptCacheColdReason, t: Translate): string {
	switch (reason.kind) {
		case "expired":
			return reason.at === undefined
				? t("sessionInfo.cache.reason.expiredUnknown")
				: t("sessionInfo.cache.reason.expired", { time: formatClock(reason.at) });
		case "refresh-missed":
			return t("sessionInfo.cache.reason.refreshMissed");
		case "model":
			return t("sessionInfo.cache.reason.model", { from: reason.from ?? "?", to: reason.to ?? "?" });
		case "thinking":
			return t("sessionInfo.cache.reason.thinking", { from: reason.from ?? "?", to: reason.to ?? "?" });
		case "tools":
			return t("sessionInfo.cache.reason.tools");
		case "system-prompt":
			return t("sessionInfo.cache.reason.systemPrompt");
		case "retention":
			return t("sessionInfo.cache.reason.retention");
		case "compaction":
			return t("sessionInfo.cache.reason.compaction");
	}
}

/**
 * What the next message re-sends uncached. A lapsed entry, a missed refresh, another model or another tool set
 * (the first cached block) leaves nothing to read; any other change keeps the cached blocks ahead of it, whose
 * share the agent cannot see, so the whole prompt is only the most it re-sends (as the terminal's `/session` says).
 */
function resendText(status: PromptCacheStatus, t: Translate): string {
	const tokens = formatTokens(status.nextTokens);
	switch (status.reason?.kind) {
		case "expired":
		case "refresh-missed":
		case "model":
		case "tools":
			return t("sessionInfo.cache.resends", { tokens });
		default:
			return t("sessionInfo.cache.resendsUpTo", { tokens });
	}
}

/** The rows the terminal's `/session` shows under Prompt Cache: state, why not, until when, and what the next message sends. */
export function promptCacheRows(status: PromptCacheStatus, t: Translate): PromptCacheRow[] {
	const state = t("sessionInfo.cache.state");
	const next = t("sessionInfo.cache.next");
	if (status.state === "cold") {
		return [
			{ label: state, value: t("sessionInfo.cache.notCached"), tone: "warning" },
			...(status.reason
				? [{ label: t("sessionInfo.cache.why"), value: reasonText(status.reason, t), tone: "warning" as const }]
				: []),
			{ label: next, value: resendText(status, t) },
		];
	}
	return [
		{ label: state, value: t(status.inferred ? "sessionInfo.cache.likelyCached" : "sessionInfo.cache.cached") },
		{
			label: t("sessionInfo.cache.until"),
			value:
				status.ttlMs === undefined ? t("sessionInfo.cache.noExpiry") : formatClock(status.touchedAt + status.ttlMs),
		},
		{
			label: next,
			value: t("sessionInfo.cache.reads", {
				tokens: formatTokens(Math.min(status.cachedTokens, status.nextTokens)),
			}),
		},
	];
}
