import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../shared/rpc-types";
import { usageTokPerSec } from "../components/chat/UsageRow";
import { effectiveCostPerMillion, lastTurnFacts, summarizeHistory, TOKEN_METER_WINDOW_MS } from "./token-meter";

describe("summarizeHistory", () => {
	it("keeps only the rolling window and reports its peak and mean", () => {
		const now = 100_000;
		const samples = [
			{ time: now - TOKEN_METER_WINDOW_MS - 1, rate: 999 },
			{ time: now - 30_000, rate: 40 },
			{ time: now - 10_000, rate: 80 },
			{ time: now, rate: 60 },
		];

		const { history, peak, average } = summarizeHistory(samples, now);

		expect(history).toEqual([40, 80, 60]);
		expect(peak).toBe(80);
		expect(average).toBe(60);
	});

	it("reports zeros for an empty window instead of NaN", () => {
		expect(summarizeHistory([], 1000)).toEqual({ history: [], peak: 0, average: 0 });
	});
});

describe("effectiveCostPerMillion", () => {
	it("scales session cost to a per-million rate", () => {
		expect(effectiveCostPerMillion(0.03, 1_000_000)).toBeCloseTo(0.03);
		expect(effectiveCostPerMillion(3, 2_000_000)).toBeCloseTo(1.5);
	});

	it("returns null when no tokens were counted", () => {
		expect(effectiveCostPerMillion(0.03, 0)).toBeNull();
	});
});

describe("usageTokPerSec", () => {
	it("rejects durations below the floor where the rate is nonsense", () => {
		expect(usageTokPerSec(100, 50)).toBeNull();
		expect(usageTokPerSec(100, 1000)).toBe(100);
	});
});

describe("lastTurnFacts", () => {
	const turn = (overrides: Partial<AgentMessage>): AgentMessage =>
		({
			role: "assistant",
			content: [],
			timestamp: 1,
			usage: { input: 10, output: 200, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
			duration: 1000,
			ttft: 300,
			...overrides,
		}) as AgentMessage;

	it("reads the newest turn that recorded usage, skipping usage-less rows", () => {
		const messages = [turn({}), { role: "assistant", content: [], timestamp: 2 } as AgentMessage];

		expect(lastTurnFacts(messages)).toEqual({ tps: 200, cost: 0.01, ttft: 300 });
	});

	it("reports null throughput for an instant turn but keeps its cost", () => {
		expect(lastTurnFacts([turn({ duration: 50 })])).toEqual({ tps: null, cost: 0.01, ttft: 300 });
	});

	it("returns nulls when no assistant turn recorded usage", () => {
		expect(lastTurnFacts([{ role: "user", content: "hi", timestamp: 1 } as AgentMessage])).toEqual({
			tps: null,
			cost: null,
			ttft: null,
		});
	});
});
