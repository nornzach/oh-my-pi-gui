/**
 * Todo store snapshot archive: the first setPhases after a reset is session
 * hydration (never a change), later identical re-applies (every agent_end
 * re-pulls state) dedupe by semantic fingerprint, and only real edits append
 * transcript snapshots — capped so the archive keeps the newest entries. A
 * reopened session has no live archive, so it replays the one its transcript
 * implies; a regression there drops every "Todos updated" row on reopen.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage, TodoPhase } from "../../shared/rpc-types";
import { todoHistoryFromMessages, todoPhasesFromToolResult, useTodoStore } from "./todo";

function phase(name: string, ...tasks: Array<[string, string]>): TodoPhase {
	return {
		name,
		tasks: tasks.map(([content, status]) => ({ content, status: status as TodoPhase["tasks"][number]["status"] })),
	};
}

/** A saved `todo` tool result, as get_messages returns it. */
function todoResult(second: number, phases: TodoPhase[], isError = false): AgentMessage {
	return {
		role: "toolResult",
		toolName: "todo",
		toolCallId: `todo-${second}`,
		isError,
		timestamp: `2026-10-26T03:39:${String(second).padStart(2, "0")}.000Z`,
		content: [],
		details: { phases },
	};
}

afterEach(() => {
	useTodoStore.getState().reset();
});

describe("todo snapshot archive", () => {
	it("treats the first setPhases as hydration and records no snapshot", () => {
		useTodoStore.getState().setPhases([phase("Build", ["scaffold", "pending"])]);
		expect(useTodoStore.getState().history).toEqual([]);
		expect(useTodoStore.getState().historyHydrated).toBe(true);
	});

	it("appends a snapshot only when the phases semantically change", () => {
		const store = useTodoStore.getState();
		store.setPhases([phase("Build", ["scaffold", "pending"])]);
		// Every agent_end re-pulls state with identical phases — no archive noise.
		useTodoStore.getState().setPhases([phase("Build", ["scaffold", "pending"])]);
		expect(useTodoStore.getState().history).toEqual([]);

		useTodoStore.getState().setPhases([phase("Build", ["scaffold", "completed"], ["wire", "in_progress"])]);
		const history = useTodoStore.getState().history;
		expect(history).toHaveLength(1);
		expect(history[0]?.phases[0]?.tasks.map(task => task.status)).toEqual(["completed", "in_progress"]);
	});

	it("updates one snapshot while the same todo list progresses", () => {
		useTodoStore.getState().setPhases([phase("Build", ["scaffold", "pending"], ["wire", "pending"])]);
		useTodoStore.getState().setPhases([phase("Build", ["scaffold", "in_progress"], ["wire", "pending"])]);
		const id = useTodoStore.getState().history[0]?.id;
		useTodoStore.getState().setPhases([phase("Build", ["scaffold", "completed"], ["wire", "completed"])]);

		const history = useTodoStore.getState().history;
		expect(history).toHaveLength(1);
		expect(history[0]?.id).toBe(id);
		expect(history[0]?.phases[0]?.tasks.map(task => task.status)).toEqual(["completed", "completed"]);
	});

	it("records an explicit clear transition as an empty snapshot", () => {
		useTodoStore.getState().setPhases([phase("Build", ["scaffold", "completed"])]);
		useTodoStore.getState().setPhases([]);
		const history = useTodoStore.getState().history;
		expect(history).toHaveLength(1);
		expect(history[0]?.phases).toEqual([]);
	});

	it("caps the archive at the newest entries", () => {
		for (let i = 0; i < 35; i++) {
			useTodoStore.getState().setPhases([phase("Build", [`task-${i}`, "pending"])]);
		}
		const history = useTodoStore.getState().history;
		expect(history).toHaveLength(30);
		expect(history.at(-1)?.phases[0]?.tasks[0]?.content).toBe("task-34");
	});

	it("resets the archive with the session", () => {
		useTodoStore.getState().setPhases([phase("Build", ["scaffold", "pending"])]);
		useTodoStore.getState().setPhases([phase("Build", ["scaffold", "completed"])]);
		expect(useTodoStore.getState().history).toHaveLength(1);
		useTodoStore.getState().reset();
		expect(useTodoStore.getState().history).toEqual([]);
		expect(useTodoStore.getState().historyHydrated).toBe(false);
	});
});

describe("todo archive of a reopened session", () => {
	const plan = (spawn: string, check: string) => [
		phase("Essays", ["Spawn the writers", spawn], ["Check the word counts", check]),
	];

	it("rebuilds the rows the live tab archived from the transcript's todo results", () => {
		const changes = [
			plan("in_progress", "pending"),
			plan("completed", "pending"),
			[phase("Review", ["Read the essays", "pending"])],
		];
		useTodoStore.getState().setPhases([]);
		for (const phases of changes) useTodoStore.getState().setPhases(phases);
		const live = useTodoStore.getState().history;

		const replayed = todoHistoryFromMessages([
			todoResult(1, changes[0]!),
			// A failed call changed nothing; a repeat of the same plan neither.
			todoResult(2, [phase("Broken", ["nothing", "pending"])], true),
			{ role: "toolResult", toolName: "read", content: [], details: { phases: [] } },
			todoResult(3, changes[1]!),
			todoResult(4, changes[1]!),
			todoResult(5, changes[2]!),
		]);

		expect(replayed.map(row => row.phases)).toEqual(live.map(row => row.phases));
		expect(replayed.map(row => row.ts)).toEqual([
			Date.parse("2026-10-26T03:39:01.000Z"),
			Date.parse("2026-10-26T03:39:05.000Z"),
		]);
	});

	it("restores into an empty archive only, and live progress continues the restored row", () => {
		const restored = todoHistoryFromMessages([todoResult(1, plan("in_progress", "pending"))]);
		useTodoStore.getState().seedHistory(restored);
		useTodoStore.getState().setPhases(plan("in_progress", "pending"));
		useTodoStore.getState().setPhases(plan("completed", "pending"));
		// A later re-hydrate must not replace what the tab has since archived.
		useTodoStore
			.getState()
			.seedHistory(todoHistoryFromMessages([todoResult(9, [phase("Stale", ["old", "pending"])])]));

		const history = useTodoStore.getState().history;
		expect(history.map(row => row.id)).toEqual([restored[0]?.id]);
		expect(history[0]?.phases[0]?.tasks.map(task => task.status)).toEqual(["completed", "pending"]);
	});
});

describe("todo results saved before omp 18.19", () => {
	it("reads a since-removed blocked task as pending instead of dropping the whole plan", () => {
		const phases = todoPhasesFromToolResult({
			details: {
				phases: [
					{
						name: "Ship",
						tasks: [
							{ content: "Wait on review", status: "blocked", blocker: "reviewer out" },
							{ content: "Merge", status: "completed" },
						],
					},
				],
			},
		});
		expect(phases?.[0]?.tasks.map(task => [task.content, task.status])).toEqual([
			["Wait on review", "pending"],
			["Merge", "completed"],
		]);
	});
});
