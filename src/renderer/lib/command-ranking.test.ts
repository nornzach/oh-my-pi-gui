import { describe, expect, it } from "vitest";
import { type RankableCommand, scoreCommand } from "./command-ranking";

const COMMANDS: RankableCommand[] = [
	{ name: "settings", label: "Settings", description: "Open settings" },
	{ name: "fresh", label: "Fresh", description: "Reset provider stream state" },
	{ name: "set-effort", label: "Set Effort Level", description: "Choose reasoning effort for this session" },
	{ name: "model-presets", label: "Model Presets", description: "Save and switch model presets" },
	{ name: "delete-session", label: "Delete Session", description: "Delete session and start new" },
	{ name: "find", label: "Search Conversations", aliases: ["find", "conversations"] },
	{ name: "providers", label: "Providers & Login", description: "Manage provider auth", aliases: ["setup"] },
];

function rank(query: string): string[] {
	return COMMANDS.flatMap(command => {
		const score = scoreCommand(query, command);
		return score === null ? [] : [{ name: command.name, score }];
	})
		.sort((a, b) => b.score - a.score)
		.map(entry => entry.name);
}

describe("scoreCommand", () => {
	it("ranks title prefixes above word prefixes, title subsequences and description hits", () => {
		// Regression: "set" listed Settings fifth, behind a description hit ("Reset")
		// and letter-by-letter matches such as "Delete Session".
		const order = rank("set");
		// Settings' own label outranks the shorter "setup" alias of Providers.
		expect(order.slice(0, 3)).toEqual(["settings", "set-effort", "providers"]);
		expect(order.indexOf("model-presets")).toBeLessThan(order.indexOf("fresh"));
		// Only its description spells s…e…t ("session and start"), so it no longer matches.
		expect(order).not.toContain("delete-session");
	});

	it("matches aliases like titles", () => {
		expect(rank("conv")[0]).toBe("find");
	});

	it("leaves a description subsequence unmatched", () => {
		// "rpst" is spelled out across "Reset provider stream state" but in no title.
		expect(scoreCommand("rpst", COMMANDS[1])).toBeNull();
	});
});
