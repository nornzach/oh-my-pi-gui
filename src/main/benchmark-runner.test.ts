import { describe, expect, it } from "vitest";
import { benchmarkArgs, parseBenchmarkSummary } from "./benchmark-runner";

describe("benchmark runner contract", () => {
	it("builds a bounded argv-only bench invocation", () => {
		expect(
			benchmarkArgs({ models: ["anthropic/opus", "openai/gpt-5.6"], profile: "mix", runs: 3, parallel: 2 }),
		).toEqual([
			"bench",
			"anthropic/opus",
			"openai/gpt-5.6",
			"--profile",
			"mix",
			"--runs",
			"3",
			"--par",
			"2",
			"--json",
		]);
		expect(() => benchmarkArgs({ models: ["--help"], profile: "chat", runs: 1, parallel: 1 })).toThrow(
			"Invalid model selector",
		);
	});

	it("accepts the summary shape consumed by the GUI", () => {
		expect(parseBenchmarkSummary('{"runs":1,"models":[],"failures":0}')).toEqual({
			runs: 1,
			models: [],
			failures: 0,
		});
	});
});
