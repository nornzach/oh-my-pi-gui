/**
 * `manage_scheduled_tasks` lets the agent list, change, pause, resume and
 * delete the tasks of its own workspace from the conversation. A change
 * touches only the fields the agent gave and never what a run may do, and a
 * call the scheduler refuses changes nothing and says why.
 */

import { describe, expect, it, vi } from "vitest";
import type { ScheduledTask, TaskConfig, TaskSaveResult } from "../../shared/scheduler-types";
import { type ManageTasksDeps, runManageTasksTool } from "./manage-tasks-tool";
import { DEFAULT_LIMITS } from "./policy";

const NOW = Date.parse("2026-10-26T08:00:00Z");
const NEXT = Date.parse("2026-10-27T08:00:00Z");
const context = { cwd: "/work/app", now: NOW, timeZone: "Europe/Berlin", sessionPath: null };

function task(id: string, overrides: Partial<ScheduledTask> = {}): ScheduledTask {
	return {
		id,
		title: `Task ${id}`,
		prompt: "Summarize failing CI jobs.",
		cwd: "/work/app",
		schedule: { kind: "cron", expr: "0 9 * * 1-5", tz: "Europe/Berlin" },
		model: null,
		tools: "read_only",
		timeoutMs: 30 * 60_000,
		verify: null,
		notify: "on_change",
		revision: 1,
		state: "active",
		origin: { sessionPath: null, createdBy: "agent" },
		createdAt: NOW,
		updatedAt: NOW,
		nextFireAt: NEXT,
		...overrides,
	};
}

const TASKS = [
	task("ci"),
	task("elsewhere", { cwd: "/work/other" }),
	task("gone", { state: "archived", nextFireAt: null }),
	task("deps", {
		createdAt: NOW + 1,
		schedule: { kind: "interval", everyMs: 30 * 60_000, anchor: NOW },
		state: "paused",
		nextFireAt: null,
		model: "anthropic/claude-opus-5-5",
		tools: "workspace",
	}),
];

const args = (overrides: Record<string, unknown> = {}) => ({
	action: "list",
	taskId: "",
	title: "",
	prompt: "",
	scheduleKind: "",
	cron: "",
	everyMinutes: 0,
	at: "",
	model: "",
	...overrides,
});

function deps(overrides: Partial<ManageTasksDeps> = {}): ManageTasksDeps {
	const byId = (id: string) => TASKS.find(candidate => candidate.id === id) as ScheduledTask;
	return {
		context,
		limits: DEFAULT_LIMITS,
		tasks: () => TASKS,
		models: async () => ["anthropic/claude-opus-5-5", "openai/gpt-5.5"],
		updateTask: vi.fn(
			(id: string, config: TaskConfig): TaskSaveResult => ({ ok: true, task: { ...byId(id), ...config } }),
		),
		setTaskEnabled: vi.fn(
			(id: string, enabled: boolean): TaskSaveResult => ({
				ok: true,
				task: { ...byId(id), state: enabled ? "active" : "paused" },
			}),
		),
		archiveTask: vi.fn(),
		cancelled: () => false,
		...overrides,
	};
}

describe("manage_scheduled_tasks", () => {
	it("lists only this workspace's live tasks, with ids, schedules, state and next run on the user's clock", async () => {
		const result = await runManageTasksTool(args(), deps());

		expect(result?.details).toEqual({ action: "list", count: 2 });
		const [first, second] = (result?.text ?? "").split("\n").filter(line => line.startsWith("- "));
		expect(first).toContain("ci");
		expect(first).toContain("next run 2026-10-27 09:00 Europe/Berlin");
		expect(second).toContain("deps");
		expect(second).toContain("every 30 minutes");
		expect(second).toContain("paused");
		expect(result?.text).not.toContain("elsewhere");
		expect(result?.text).not.toContain("gone");
	});

	it("changes only the fields given and never what the task's runs may do", async () => {
		const toolDeps = deps();
		const result = await runManageTasksTool(
			args({ action: "update", taskId: "deps", scheduleKind: "interval", everyMinutes: 60, model: "default" }),
			toolDeps,
		);

		expect(toolDeps.updateTask).toHaveBeenCalledWith("deps", {
			title: "Task deps",
			prompt: "Summarize failing CI jobs.",
			cwd: "/work/app",
			schedule: { kind: "interval", everyMs: 3_600_000, anchor: NOW + 3_600_000 },
			model: null,
			tools: "workspace",
			timeoutMs: 30 * 60_000,
			verify: null,
			notify: "on_change",
		});
		expect(result).toMatchObject({ isError: false, details: { action: "update", taskId: "deps" } });

		const empty = deps();
		expect((await runManageTasksTool(args({ action: "update", taskId: "ci" }), empty))?.isError).toBe(true);
		expect(empty.updateTask).not.toHaveBeenCalled();
	});

	it("changes nothing for a task outside this workspace, and shows the agent the ids it can use", async () => {
		const toolDeps = deps();
		const result = await runManageTasksTool(args({ action: "pause", taskId: "elsewhere" }), toolDeps);

		expect(result?.isError).toBe(true);
		expect(result?.text).toContain("- ci:");
		expect(toolDeps.setTaskEnabled).not.toHaveBeenCalled();
	});

	it("pauses, resumes and deletes through the scheduler, and passes its refusal back", async () => {
		const toolDeps = deps();
		await runManageTasksTool(args({ action: "pause", taskId: "ci" }), toolDeps);
		expect(toolDeps.setTaskEnabled).toHaveBeenCalledWith("ci", false);

		const deleted = await runManageTasksTool(args({ action: "delete", taskId: "ci" }), toolDeps);
		expect(toolDeps.archiveTask).toHaveBeenCalledWith("ci");
		expect(deleted?.details).toMatchObject({ action: "delete", taskId: "ci", nextFireAt: null });

		const full = await runManageTasksTool(
			args({ action: "resume", taskId: "deps" }),
			deps({ setTaskEnabled: () => ({ ok: false, problems: ["too_many_enabled"] }) }),
		);
		expect(full?.isError).toBe(true);
		expect(full?.text).toContain(`${DEFAULT_LIMITS.maxEnabledTasks} active scheduled tasks`);
	});
});
