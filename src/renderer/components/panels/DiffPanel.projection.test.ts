import { expect, it } from "vitest";
import type { ToolEntry } from "../../stores/tools";
import { buildEditCandidates } from "./DiffPanel";

it("separates multi-file edits, failed results, write snapshots and virtual artifacts", () => {
	const base: ToolEntry = {
		toolName: "edit",
		args: {},
		status: "done",
		partialResult: null,
		streamingArgs: "",
		result: null,
		isError: false,
		startTime: 1,
		endTime: 2,
	};
	const entries = new Map<string, ToolEntry>([
		["pending", { ...base, status: "running" }],
		[
			"multi",
			{
				...base,
				result: {
					details: {
						perFileResults: [
							{ path: "a.ts", diff: "@@ -1 +1 @@\n-a\n+b" },
							{ path: "b.ts", error: "permission denied" },
						],
					},
				},
			},
		],
		["write", { ...base, toolName: "write", args: { path: "c.ts", content: "replacement content" } }],
		["virtual", { ...base, toolName: "write", args: { path: "artifact://plan.md", content: "plan" } }],
	]);
	const rows = buildEditCandidates(entries);
	expect(rows.map(row => row.file)).toEqual(["a.ts", "b.ts", "c.ts", "artifact://plan.md"]);
	expect(rows[0]).toMatchObject({ adds: 1, removes: 1, isContent: false });
	expect(rows[1]).toMatchObject({ adds: 0, removes: 0, isError: true, diff: "permission denied" });
	expect(rows[2]).toMatchObject({ adds: 0, removes: 0, isContent: true });
	expect(rows[3].isVirtual).toBe(true);
});
