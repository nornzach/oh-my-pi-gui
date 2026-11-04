import { describe, expect, it } from "vitest";
import type { PromptCacheStatus } from "../../shared/rpc-types";
import { translate } from "./i18n";
import { promptCacheRows } from "./prompt-cache";

const base = {
	inferred: false,
	tier: "short",
	touchedAt: Date.now(),
	cachedTokens: 40_000,
	nextTokens: 12_300,
} as const;

describe("promptCacheRows", () => {
	it("says a model change re-sends the whole prompt and flags it", () => {
		const status: PromptCacheStatus = {
			...base,
			state: "cold",
			reason: { kind: "model", from: "claude-a", to: "claude-b" },
			ttlMs: 300_000,
		};
		expect(promptCacheRows(status, translate)).toEqual([
			{ label: "State", value: "Not cached", tone: "warning" },
			{ label: "Why not cached", value: "Model changed: claude-a → claude-b", tone: "warning" },
			{ label: "Next message", value: "Re-sends ~12.3k uncached" },
		]);
	});

	it("bounds the re-send when the cached tools still lead the prompt", () => {
		const status: PromptCacheStatus = { ...base, state: "cold", reason: { kind: "system-prompt" }, ttlMs: 300_000 };
		expect(promptCacheRows(status, translate).at(-1)).toEqual({
			label: "Next message",
			value: "Re-sends up to ~12.3k uncached",
		});
	});

	it("reads at most the next prompt from a cache inferred from a reopened session", () => {
		const status: PromptCacheStatus = { ...base, state: "warm", inferred: true };
		expect(promptCacheRows(status, translate)).toEqual([
			{ label: "State", value: "Likely cached" },
			{ label: "Cached until", value: "No expiry" },
			{ label: "Next message", value: "Reads ~12.3k from cache" },
		]);
	});
});
