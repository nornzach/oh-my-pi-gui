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

export type ContextSegmentKey =
	| "messages"
	| "systemTools"
	| "systemPrompt"
	| "systemContext"
	| "instructionFiles"
	| "skills"
	| "autocompact"
	| "free";

export interface ContextSegment {
	key: ContextSegmentKey;
	tokens: number;
}

/**
 * The report's categories, conversation first, then — with a
 * known window — the auto-compact buffer and free space, so the segments fill
 * the window exactly as `/context` in the terminal does. The buffer runs from
 * `autoCompactAt` to the window edge but never past what is still unused;
 * `autoCompactAt` is null when auto-compaction is off. Empty categories drop out.
 */
export function contextSegments(
	breakdown: RpcContextUsageBreakdown,
	view: Pick<ContextUsageView, "capacityKnown" | "contextWindow" | "usedTokens">,
	autoCompactAt: number | null,
): ContextSegment[] {
	const segments: ContextSegment[] = [
		{ key: "messages", tokens: breakdown.messagesTokens },
		{ key: "systemTools", tokens: breakdown.systemToolsTokens },
		{ key: "systemPrompt", tokens: breakdown.systemPromptTokens },
		{ key: "systemContext", tokens: breakdown.systemContextTokens },
		{ key: "instructionFiles", tokens: breakdown.instructionFilesTokens ?? 0 },
		{ key: "skills", tokens: breakdown.skillsTokens },
	];
	if (view.capacityKnown) {
		const unused = Math.max(0, view.contextWindow - view.usedTokens);
		const buffer =
			autoCompactAt !== null && autoCompactAt > 0 && autoCompactAt <= view.contextWindow
				? Math.min(view.contextWindow - autoCompactAt, unused)
				: 0;
		segments.push({ key: "autocompact", tokens: buffer }, { key: "free", tokens: unused - buffer });
	}
	return segments.filter(segment => segment.tokens > 0);
}

/** `161.9k/1.0M`, or the bare reading when there is no capacity to compare against. */
export function formatContextUsage(view: ContextUsageView): string {
	return view.capacityKnown
		? `${formatTokens(view.usedTokens)}/${formatTokens(view.contextWindow)}`
		: formatTokens(view.usedTokens);
}
