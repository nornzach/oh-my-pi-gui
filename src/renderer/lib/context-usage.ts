import type { ContextUsage, RpcContextUsageBreakdown } from "../../shared/rpc-types";
import { formatTokens } from "./format";

/**
 * Context numbers as a display surface should read them.
 *
 * Core reports `contextWindow: 0` for a model whose capacity the host does not
 * publish, while the token reading itself is measured locally and stays valid.
 * Percentages and remainders only mean anything when `capacityKnown` is true.
 */
export interface ContextUsageView {
	capacityKnown: boolean;
	contextWindow: number;
	percent: number;
	remainingTokens: number;
	usedTokens: number;
}

export function contextUsageView(
	usage?: Partial<ContextUsage> | null,
	breakdown?: Pick<RpcContextUsageBreakdown, "contextWindow" | "usedTokens">,
): ContextUsageView {
	const contextWindow = breakdown?.contextWindow || usage?.contextWindow || 0;
	const usedTokens = breakdown?.usedTokens ?? usage?.tokens ?? 0;
	const capacityKnown = contextWindow > 0;
	return {
		capacityKnown,
		contextWindow,
		percent: capacityKnown ? Math.min(100, (usedTokens / contextWindow) * 100) : 0,
		remainingTokens: capacityKnown ? Math.max(0, contextWindow - usedTokens) : 0,
		usedTokens,
	};
}

/** `161.9k/1.0M`, or the bare reading when there is no capacity to compare against. */
export function formatContextUsage(view: ContextUsageView): string {
	return view.capacityKnown
		? `${formatTokens(view.usedTokens)}/${formatTokens(view.contextWindow)}`
		: formatTokens(view.usedTokens);
}
