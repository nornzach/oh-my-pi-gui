import { describe, expect, it } from "vitest";
import type { AgentProgress, SubagentSnapshot } from "../../../shared/rpc-types";
import { buildSubagentList, subagentElapsedMs, subagentPrimaryLabel } from "./subagent-graph";

function progress(durationMs: number): AgentProgress {
	return {
		index: 0,
		id: "agent-1",
		agent: "explore",
		agentSource: "bundled",
		status: "running",
		task: "Audit the renderer",
		recentTools: [],
		recentOutput: [],
		toolCount: 0,
		requests: 0,
		tokens: 0,
		cost: 0,
		durationMs,
	};
}

function snapshot(status: string, lastUpdate: number, durationMs?: number): SubagentSnapshot {
	return {
		id: "agent-1",
		index: 0,
		agent: "explore",
		status,
		lastUpdate,
		progress:
			durationMs === undefined ? undefined : { ...progress(durationMs), status: status as AgentProgress["status"] },
	};
}

describe("subagent elapsed time", () => {
	it("continues a live sidecar duration sample instead of restarting when the panel opens", () => {
		const agent = snapshot("running", 10_000, 42_000);
		expect(subagentElapsedMs(agent, 13_500)).toBe(45_500);
	});

	it("freezes terminal rows at the sidecar's final duration", () => {
		const agent = snapshot("completed", 10_000, 42_000);
		expect(subagentElapsedMs(agent, 99_000)).toBe(42_000);
	});

	it("keeps a valid sidecar duration when a malformed timestamp crosses the wire", () => {
		const agent = snapshot("running", Number.NaN, 42_000);
		expect(subagentElapsedMs(agent, 99_000)).toBe(42_000);
	});

	it("uses the lifecycle timestamp for a bare live registry snapshot", () => {
		const agent = snapshot("started", 10_000);
		expect(subagentElapsedMs(agent, 13_500)).toBe(3_500);
	});

	it("does not invent a duration for a terminal snapshot without progress", () => {
		const agent = snapshot("failed", 10_000);
		expect(subagentElapsedMs(agent, 99_000)).toBeNull();
	});
});

describe("subagent list projection", () => {
	it("renders nested spawns directly after their parent with an explicit depth", () => {
		const root = { ...snapshot("running", 1), id: "root", index: 0, assignment: "Audit renderer" };
		const sibling = { ...snapshot("running", 1), id: "sibling", index: 1, assignment: "Audit IPC" };
		const child = {
			...snapshot("running", 1),
			id: "child",
			index: 2,
			parentSubagentId: "root",
			assignment: "Trace virtualizer",
		};

		const rows = buildSubagentList([root, sibling, child], new Set(), new Map());
		expect(rows.map(row => [row.agent.id, row.depth])).toEqual([
			["root", 0],
			["child", 1],
			["sibling", 0],
		]);
	});

	it("uses the generated UI description ahead of the full delegated assignment", () => {
		const agent = {
			...snapshot("running", 1),
			assignment: "# Target\nInspect session switching and report every implementation detail",
			description: "Inspect session switching",
		};
		expect(subagentPrimaryLabel(agent)).toBe("Inspect session switching");
	});

	it("falls back to the delegated assignment when no generated UI label exists", () => {
		const agent = { ...snapshot("running", 1), assignment: "Inspect session switching" };
		expect(subagentPrimaryLabel(agent)).toBe("Inspect session switching");
	});

	it("heads a delegated assignment with its gist, not its markdown scaffolding", () => {
		const agent = {
			...snapshot("running", 1),
			assignment: "# Target\n`src/retry.ts`\n\n# Change\n- Stop retrying on a 4xx\n\n# Acceptance\nTests pass",
		};
		expect(subagentPrimaryLabel(agent)).toBe("Stop retrying on a 4xx");
	});
});
