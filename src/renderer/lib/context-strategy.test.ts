import { describe, expect, it } from "vitest";
import {
	type CompactionConfig,
	compactionThreshold,
	DEFAULT_COMPACTION_CONFIG,
	detectStrategy,
	expectedMethod,
	type ModelProfile,
	modelProfile,
	parseCompactionConfig,
	recommendStrategy,
	STRATEGIES,
	strategyPatch,
} from "./context-strategy";

const config = (overrides: Partial<CompactionConfig> = {}): CompactionConfig => ({
	...DEFAULT_COMPACTION_CONFIG,
	methodOrder: [...DEFAULT_COMPACTION_CONFIG.methodOrder],
	...overrides,
});

const textOnly: ModelProfile = { windowTokens: 262_144, vision: false, nativeRemote: false };
const vision: ModelProfile = { windowTokens: 262_144, vision: true, nativeRemote: false };
const native: ModelProfile = { windowTokens: 400_000, vision: true, nativeRemote: true };

describe("modelProfile", () => {
	it("reads window, vision and server compaction from the wire model", () => {
		expect(modelProfile({ api: "openai-responses", contextWindow: 400_000, input: ["text", "image"] })).toEqual(
			native,
		);
		expect(modelProfile({ api: "openai-completions", contextWindow: 262_144, input: ["text"] })).toEqual(textOnly);
	});

	it("treats an Anthropic-lane model as native only when the catalog says its route supports it", () => {
		expect(modelProfile({ api: "anthropic-messages", compat: { supportsServerCompaction: true } }).nativeRemote).toBe(
			true,
		);
		expect(
			modelProfile({ api: "anthropic-messages", compat: { supportsServerCompaction: false } }).nativeRemote,
		).toBe(false);
	});

	it("reports an unpublished window as unknown, and a missing model as capable of nothing", () => {
		expect(modelProfile({ contextWindow: 0 }).windowTokens).toBeNull();
		expect(modelProfile(null)).toEqual({ windowTokens: null, vision: false, nativeRemote: false });
	});
});

describe("expectedMethod", () => {
	it("skips methods the model cannot run, in order", () => {
		// The default order on a vision model without server compaction lands on the image archive.
		expect(expectedMethod(config(), vision)).toBe("snapcompact");
		expect(expectedMethod(config(), native)).toBe("remote");
		// Text-only without server compaction falls past both to the handoff document.
		expect(expectedMethod(config(), textOnly)).toBe("handoff");
	});

	it("names the notes mode over any method order", () => {
		expect(expectedMethod(config({ notesBacked: true }), native)).toBe("notes");
	});

	it("reports nothing runnable when every listed method needs a capability the model lacks", () => {
		expect(expectedMethod(config({ methodOrder: ["remote", "snapcompact"] }), textOnly)).toBeNull();
	});
});

describe("detectStrategy", () => {
	it("recognizes each strategy from its settings, and anything else as custom", () => {
		expect(detectStrategy(config())).toBe("balanced");
		expect(detectStrategy(config({ ...STRATEGIES.preserve }))).toBe("preserve");
		expect(detectStrategy(config({ ...STRATEGIES.notes }))).toBe("notes");
		// One setting off the strategy is a custom setup, not a silent match.
		expect(detectStrategy(config({ ...STRATEGIES.preserve, keepRecentTokens: 25_000 }))).toBe("custom");
		expect(detectStrategy(config({ methodOrder: ["handoff", "shake"] }))).toBe("custom");
	});

	it("round-trips: applying a strategy's patch yields that strategy", () => {
		for (const id of ["balanced", "preserve", "notes"] as const) {
			const values: Record<string, unknown> = {};
			for (const { path, value } of strategyPatch(id)) values[path] = value;
			expect(detectStrategy(parseCompactionConfig(values))).toBe(id);
		}
	});
});

describe("recommendStrategy", () => {
	it("keeps the defaults where the provider compacts server-side", () => {
		expect(recommendStrategy(native)).toEqual({ strategy: "balanced", reasonKey: "native" });
	});

	it("steers other models away from a lossy default, with the reason that applies to them", () => {
		expect(recommendStrategy(vision)).toEqual({ strategy: "preserve", reasonKey: "vision" });
		expect(recommendStrategy(textOnly)).toEqual({ strategy: "preserve", reasonKey: "text" });
	});
});

describe("compactionThreshold", () => {
	it("uses the agent's reserve rule by default: the larger of 15% and 16,384 tokens stays free", () => {
		expect(compactionThreshold(config(), { ...textOnly, windowTokens: 262_144 })).toBe(
			262_144 - Math.floor(262_144 * 0.15),
		);
		// A small window falls back to the fixed reserve instead of the percentage.
		expect(compactionThreshold(config(), { ...textOnly, windowTokens: 32_000 })).toBe(32_000 - 16_384);
	});

	it("honors an explicit percentage and reports an unknown window as unknown", () => {
		expect(compactionThreshold(config({ thresholdPercent: 70 }), { ...textOnly, windowTokens: 200_000 })).toBe(
			140_000,
		);
		expect(compactionThreshold(config(), { ...textOnly, windowTokens: null })).toBeNull();
	});
});

describe("parseCompactionConfig", () => {
	it("falls back to the agent default per field and drops unknown methods", () => {
		const parsed = parseCompactionConfig({
			"compaction.methodOrder": ["shake", "bogus", "soft"],
			"compaction.keepRecentTokens": -5,
			"compaction.enabled": false,
		});
		expect(parsed.methodOrder).toEqual(["shake", "soft"]);
		expect(parsed.keepRecentTokens).toBe(DEFAULT_COMPACTION_CONFIG.keepRecentTokens);
		expect(parsed.enabled).toBe(false);
		expect(parsed.promotion).toBe(false);
		expect(parseCompactionConfig({ "compaction.methodOrder": ["bogus"] }).methodOrder).toEqual(
			DEFAULT_COMPACTION_CONFIG.methodOrder,
		);
	});
});
