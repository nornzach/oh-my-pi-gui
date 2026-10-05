import { describe, expect, it } from "vitest";
import { parseModelRestoreFailure } from "./model-restore";

describe("parseModelRestoreFailure", () => {
	it("reads the model from the RPC switch/open error", () => {
		expect(parseModelRestoreFailure("Could not restore model local/local-model")).toBe("local/local-model");
		expect(parseModelRestoreFailure("Could not restore model openrouter/anthropic/claude-3.5:beta")).toBe(
			"openrouter/anthropic/claude-3.5:beta",
		);
	});

	it("skips Bun's echoed template-literal source line in boot stderr", () => {
		const stderr = [
			// biome-ignore lint/suspicious/noTemplateCurlyInString: Bun echoes the throwing source line verbatim.
			"2754 |\t\t\tthrow new Error(`Could not restore model ${sessionModelStrings[0]}`);",
			"                     ^",
			"error: Could not restore model ghostprov/missing-model",
			"      at createAgentSessionScoped (/$bunfs/root/omp:620033:13)",
		].join("\n");
		expect(parseModelRestoreFailure(stderr)).toBe("ghostprov/missing-model");
	});

	it("drops trailing sentence punctuation", () => {
		expect(parseModelRestoreFailure("Could not restore model a/b. Using c/d")).toBe("a/b");
	});

	it("is null for unrelated failures", () => {
		expect(parseModelRestoreFailure("boom")).toBeNull();
		expect(parseModelRestoreFailure(undefined)).toBeNull();
		expect(parseModelRestoreFailure("")).toBeNull();
	});
});
