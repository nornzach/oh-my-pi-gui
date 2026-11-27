import { describe, expect, it } from "vitest";
import type { SubagentSnapshot } from "../../../../shared/rpc-types";
import type { UiTodoPhase, UiTodoTask } from "../../../stores/todo";
import type { SubagentListRow } from "../../panels/subagent-graph";
import { buildAgentDockSummary, buildTodoDockSummary } from "./dock-summary";

function task(id: string, status: UiTodoTask["status"]): UiTodoTask {
	return { id, content: id, status };
}

function agent(id: string, status: string, lastUpdate: number, parentSubagentId?: string): SubagentSnapshot {
	return {
		id,
		index: Number(id.replace(/\D/g, "")) || 0,
		agent: id,
		status,
		lastUpdate,
		parentSubagentId,
	};
}

describe("dock summaries", () => {
	it("keeps every actionable todo and only the three newest completed tasks above ten items", () => {
		const phases: UiTodoPhase[] = [
			{
				id: "phase-1",
				name: "work",
				tasks: [
					task("pending", "pending"),
					task("running", "in_progress"),
					task("queued", "pending"),
					task("done-1", "completed"),
					task("done-2", "completed"),
					task("done-3", "completed"),
					task("done-4", "completed"),
					task("done-5", "completed"),
					task("done-6", "completed"),
					task("abandoned-1", "abandoned"),
					task("abandoned-2", "abandoned"),
				],
			},
		];

		const summary = buildTodoDockSummary(phases);
		const ids = summary.phases.flatMap(phase => phase.tasks.map(item => item.id));
		expect(ids).toEqual(["pending", "running", "queued", "done-4", "done-5", "done-6"]);
		expect(summary).toMatchObject({ totalCount: 11, hiddenCount: 5 });
	});

	it("keeps urgent agents, preserves their ancestors, and fills the preview with recent completions", () => {
		const rows: SubagentListRow[] = [
			{ agent: agent("a1", "completed", 1), depth: 0 },
			{ agent: agent("a2", "running", 2, "a1"), depth: 1 },
			{ agent: agent("a3", "waiting", 3), depth: 0 },
			{ agent: agent("a4", "failed", 4), depth: 0 },
			{ agent: agent("a5", "completed", 5), depth: 0 },
			{ agent: agent("a6", "completed", 6), depth: 0 },
			{ agent: agent("a7", "completed", 7), depth: 0 },
			{ agent: agent("a8", "completed", 8), depth: 0 },
		];

		const summary = buildAgentDockSummary(rows);
		expect(summary.rows.map(row => row.agent.id)).toEqual(["a1", "a2", "a3", "a4", "a8"]);
		expect(summary).toMatchObject({ totalCount: 8, hiddenCount: 3 });
	});
});
