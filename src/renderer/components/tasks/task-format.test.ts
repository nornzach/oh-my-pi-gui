/**
 * The Tasks window's list shaping: what one-line rows show of a Markdown
 * report, which runs fold into a "Nothing new" streak, and where the per-day
 * chart starts.
 */
import { describe, expect, it } from "vitest";
import type { InsightsDay, RunReport, TaskRun } from "../../../shared/scheduler-types";
import { groupHistory, summaryLine, trimLeadingEmptyDays } from "./task-format";

function run(id: string, fields: Partial<TaskRun> = {}): TaskRun {
	return {
		id,
		taskId: "task",
		taskRevision: 1,
		trigger: "schedule",
		scheduledFor: null,
		createdAt: 0,
		state: "succeeded",
		blocked: [],
		changedFiles: [],
		verification: { state: "none" },
		review: { state: "none" },
		...fields,
	};
}

const quietReport: RunReport = { status: "nothing_to_report", summary: "All clear.", findings: [], changes: [] };
const quiet = (id: string) => run(id, { report: quietReport });

function day(index: number, runs = 0): InsightsDay {
	return { day: `2026-11-${String(index + 1).padStart(2, "0")}`, succeeded: runs, quiet: 0, failed: 0, skipped: 0 };
}

describe("summaryLine", () => {
	it("takes the first prose line, without heading or bullet markers and link targets", () => {
		expect(summaryLine("### Added\n- Muse Ember")).toBe("Added");
		expect(summaryLine("- See [the docs](https://example.com) for **why**")).toBe("See the docs for **why**");
	});

	it("skips a leading code fence instead of showing the code as the summary", () => {
		expect(summaryLine("```ts\nconst x = 1;\n```\nFixed the cache key.")).toBe("Fixed the cache key.");
	});
});

describe("groupHistory", () => {
	it("folds streaks of two or more quiet runs and leaves a lone quiet run as a row", () => {
		const items = groupHistory([
			quiet("q1"),
			quiet("q2"),
			run("failed", { state: "failed" }),
			quiet("q3"),
			run("found", { report: { ...quietReport, status: "done", summary: "Found one." } }),
			quiet("q4"),
			quiet("q5"),
			quiet("q6"),
		]);
		expect(items.map(item => (item.kind === "run" ? item.run.id : item.runs.map(r => r.id).join("+")))).toEqual([
			"q1+q2",
			"failed",
			"q3",
			"found",
			"q4+q5+q6",
		]);
	});

	it("never folds a quiet report that is still waiting for review", () => {
		const pending = run("pending", { report: quietReport, review: { state: "pending" } });
		expect(groupHistory([quiet("q1"), pending, quiet("q2")]).map(item => item.kind)).toEqual(["run", "run", "run"]);
	});
});

describe("trimLeadingEmptyDays", () => {
	const month = Array.from({ length: 30 }, (_, index) => day(index));

	it("starts the chart at the first day with runs", () => {
		const days = month.map((entry, index) => (index >= 10 ? { ...entry, succeeded: 1 } : entry));
		expect(trimLeadingEmptyDays(days)[0].day).toBe(month[10].day);
	});

	it("keeps a week when every run is in the last few days", () => {
		const days = month.map((entry, index) => (index >= 28 ? { ...entry, succeeded: 1 } : entry));
		expect(trimLeadingEmptyDays(days)).toHaveLength(7);
		expect(trimLeadingEmptyDays(days).at(-1)?.day).toBe(month[29].day);
	});
});
