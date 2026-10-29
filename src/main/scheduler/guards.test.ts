/**
 * IPC payload guards: a structurally broken draft from the renderer is
 * refused whole instead of reaching the store half-shaped.
 */

import { describe, expect, it } from "vitest";
import { asTaskDraft } from "./guards";

const valid = {
	title: "Nightly",
	prompt: "Check things.",
	cwd: "/work",
	schedule: { kind: "cron", expr: "0 2 * * *", tz: "UTC" },
	model: "",
	tools: "workspace",
	depth: { kind: "research", rounds: 4 },
	timeoutMs: 600_000,
	verify: { command: "bun test", timeoutMs: 60_000 },
	notify: "always",
	origin: { sessionPath: null, createdBy: "user" },
	startPaused: true,
};

describe("asTaskDraft", () => {
	it("accepts a well-formed draft and reads an empty model as the workspace default", () => {
		expect(asTaskDraft(valid)).toMatchObject({
			model: null,
			tools: "workspace",
			depth: { kind: "research", rounds: 4 },
			startPaused: true,
		});
	});

	it("refuses a draft with an unknown policy or depth, a malformed schedule or an incomplete check", () => {
		for (const broken of [
			{ ...valid, tools: "root" },
			{ ...valid, depth: { kind: "deep" } },
			{ ...valid, depth: { kind: "research" } },
			{ ...valid, schedule: { kind: "interval", everyMs: "5m", anchor: 0 } },
			{ ...valid, schedule: { kind: "cron", expr: "0 2 * * *" } },
			{ ...valid, verify: { command: "bun test" } },
			{ ...valid, origin: { sessionPath: null, createdBy: "someone" } },
		]) {
			expect(asTaskDraft(broken)).toBeNull();
		}
	});
});
