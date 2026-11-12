/**
 * The context breakdown's segments must fill a known window exactly — used
 * categories, the auto-compact buffer, then free space — as the TUI's /context does.
 */

import { describe, expect, it } from "vitest";
import type { RpcContextUsageBreakdown } from "../../shared/rpc-types";
import { contextSegments, contextUsageView } from "./context-usage";

const breakdown: RpcContextUsageBreakdown = {
	anchored: true,
	contextWindow: 200_000,
	usedTokens: 120_000,
	messagesTokens: 100_000,
	systemToolsTokens: 15_000,
	systemPromptTokens: 5_000,
	systemContextTokens: 0,
	skillsTokens: 0,
};

const segmentsAt = (used: number, autoCompactAt: number | null) => {
	const sized = { ...breakdown, usedTokens: used, messagesTokens: used - 20_000 };
	return contextSegments(sized, contextUsageView(null, sized), autoCompactAt);
};

describe("contextSegments", () => {
	it("splits the unused window into buffer past the threshold and free space before it", () => {
		expect(segmentsAt(120_000, 170_000)).toEqual([
			{ key: "messages", tokens: 100_000 },
			{ key: "systemTools", tokens: 15_000 },
			{ key: "systemPrompt", tokens: 5_000 },
			{ key: "autocompact", tokens: 30_000 },
			{ key: "free", tokens: 50_000 },
		]);
	});

	it("shrinks the buffer to what is left once usage passes the threshold, leaving no free space", () => {
		const segments = segmentsAt(185_000, 170_000);
		expect(segments.slice(-1)).toEqual([{ key: "autocompact", tokens: 15_000 }]);
	});

	it("leaves the whole remainder free when auto-compaction is off", () => {
		expect(segmentsAt(120_000, null).slice(-1)).toEqual([{ key: "free", tokens: 80_000 }]);
	});

	it("counts instruction files as their own category, so the measured parts still add up to what is used", () => {
		// omp 18.18.9+ reports instruction files apart from the system prompt instead of inside it.
		const sized = { ...breakdown, usedTokens: 120_000, messagesTokens: 97_000, instructionFilesTokens: 3_000 };
		const segments = contextSegments(sized, contextUsageView(null, sized), null);
		expect(segments.find(segment => segment.key === "instructionFiles")?.tokens).toBe(3_000);
		const measured = segments.filter(segment => segment.key !== "free" && segment.key !== "autocompact");
		expect(measured.reduce((sum, segment) => sum + segment.tokens, 0)).toBe(120_000);
	});

	it("lists only measured categories when the window is unknown", () => {
		const unknown = { ...breakdown, contextWindow: 0 };
		expect(contextSegments(unknown, contextUsageView(null, unknown), 170_000).map(s => s.key)).toEqual([
			"messages",
			"systemTools",
			"systemPrompt",
		]);
	});
});
