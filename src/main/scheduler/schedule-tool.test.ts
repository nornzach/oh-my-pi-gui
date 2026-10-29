/**
 * The agent's `schedule_task` call creates the task at once and tells the
 * agent what it made, or what to fix. Runs stay read-only, a named model must
 * be one the workspace has, and nothing is created for a rejected or
 * cancelled call.
 */

import { describe, expect, it, vi } from "vitest";
import type { ScheduledTask, TaskDraft, TaskSaveResult } from "../../shared/scheduler-types";
import { DEFAULT_LIMITS } from "./policy";
import { parseScheduleToolArgs, resolveModel, runScheduleTool, type ScheduleToolDeps } from "./schedule-tool";

const NOW = Date.parse("2026-10-26T08:00:00Z");
const context = { cwd: "/work/app", now: NOW, timeZone: "Europe/Berlin", sessionPath: "/s/tab.jsonl" };
const args = (overrides: Record<string, unknown> = {}) => ({
	title: "Morning CI",
	prompt: "Summarize failing CI jobs.",
	scheduleKind: "cron",
	cron: "0 9 * * 1-5",
	everyMinutes: 0,
	at: "",
	model: "",
	...overrides,
});

const FIRST_RUN = Date.parse("2026-10-27T08:00:00Z");

function saved(draft: TaskDraft): TaskSaveResult {
	return { ok: true, task: { ...draft, id: "task-42", nextFireAt: FIRST_RUN } as unknown as ScheduledTask };
}

function deps(overrides: Partial<ScheduleToolDeps> = {}): ScheduleToolDeps {
	return {
		context,
		limits: DEFAULT_LIMITS,
		models: async () => ["anthropic/claude-opus-5-5", "openai/gpt-5.5"],
		createTask: vi.fn(saved),
		cancelled: () => false,
		...overrides,
	};
}

describe("schedule_task arguments", () => {
	it("drafts read-only with no model pin, keeping the requested model apart for checking", () => {
		const parsed = parseScheduleToolArgs(args({ model: "anthropic/claude-opus-5-5" }), context);
		expect(parsed).toMatchObject({
			ok: true,
			model: "anthropic/claude-opus-5-5",
			draft: {
				tools: "read_only",
				model: null,
				cwd: "/work/app",
				schedule: { kind: "cron", expr: "0 9 * * 1-5", tz: "Europe/Berlin" },
				origin: { createdBy: "agent", sessionPath: "/s/tab.jsonl" },
			},
		});
	});

	it("maps intervals to milliseconds on a grid starting one interval out, and one-offs to their instant", () => {
		const interval = parseScheduleToolArgs(args({ scheduleKind: "interval", everyMinutes: 30 }), context);
		expect(interval.ok && interval.draft.schedule).toEqual({
			kind: "interval",
			everyMs: 1_800_000,
			anchor: NOW + 1_800_000,
		});
		const once = parseScheduleToolArgs(args({ scheduleKind: "once", at: "2026-10-27T07:30:00Z" }), context);
		expect(once.ok && once.draft.schedule).toEqual({ kind: "once", at: Date.parse("2026-10-27T07:30:00Z") });
	});

	it("refuses a call whose chosen schedule field is missing or unknown", () => {
		for (const bad of [
			args({ cron: "" }),
			args({ scheduleKind: "interval", everyMinutes: 0 }),
			args({ scheduleKind: "once", at: "tomorrow-ish" }),
			args({ scheduleKind: "weekly" }),
			args({ prompt: "  " }),
		]) {
			expect(parseScheduleToolArgs(bad, context).ok).toBe(false);
		}
	});
});

describe("resolveModel", () => {
	it("takes a known id as written, keeps a thinking level, and resolves a bare id only when one provider has it", () => {
		const models = ["ollama/llama3:8b", "anthropic/claude-opus-5-5", "openai/gpt-5.5", "azure/gpt-5.5"];
		expect(resolveModel("ollama/llama3:8b", models)).toBe("ollama/llama3:8b");
		expect(resolveModel("anthropic/claude-opus-5-5:high", models)).toBe("anthropic/claude-opus-5-5:high");
		expect(resolveModel("claude-opus-5-5:high", models)).toBe("anthropic/claude-opus-5-5:high");
		expect(resolveModel("gpt-5.5", models)).toBeNull();
		expect(resolveModel("google/claude-opus-5-5", models)).toBeNull();
	});
});

describe("runScheduleTool", () => {
	it("creates the task at once and tells the agent its id and first run on the user's clock", async () => {
		const toolDeps = deps();
		const result = await runScheduleTool(args(), toolDeps);

		expect(toolDeps.createTask).toHaveBeenCalledTimes(1);
		expect(vi.mocked(toolDeps.createTask).mock.calls[0][0]).toMatchObject({ tools: "read_only", model: null });
		expect(result).toMatchObject({
			isError: false,
			details: { outcome: "created", taskId: "task-42", nextFireAt: FIRST_RUN, model: null },
		});
		// 08:00 UTC is 09:00 in Berlin once summer time has ended.
		expect(result?.text).toContain("task-42");
		expect(result?.text).toContain("2026-10-27 09:00 Europe/Berlin");
	});

	it("pins the model the user named once the workspace has it, and creates nothing for one it lacks", async () => {
		const known = deps();
		await runScheduleTool(args({ model: "claude-opus-5-5" }), known);
		expect(vi.mocked(known.createTask).mock.calls[0][0].model).toBe("anthropic/claude-opus-5-5");

		const unknown = deps();
		const result = await runScheduleTool(args({ model: "gemini-9" }), unknown);
		expect(unknown.createTask).not.toHaveBeenCalled();
		expect(result?.isError).toBe(true);
		expect(result?.text).toContain("openai/gpt-5.5");

		const unreadable = deps({ models: async () => null });
		expect((await runScheduleTool(args({ model: "claude-opus-5-5" }), unreadable))?.isError).toBe(true);
		expect(unreadable.createTask).not.toHaveBeenCalled();
	});

	it("turns the scheduler's problems into what to fix, and stops retries when the task limit is full", async () => {
		const tooFrequent = await runScheduleTool(
			args({ scheduleKind: "interval", everyMinutes: 1 }),
			deps({ createTask: () => ({ ok: false, problems: ["too_frequent"] }) }),
		);
		expect(tooFrequent?.isError).toBe(true);
		expect(tooFrequent?.text).toContain(`at least ${DEFAULT_LIMITS.minIntervalMs / 60_000} minutes`);
		expect(tooFrequent?.text).toContain("call the tool again");

		const full = await runScheduleTool(
			args(),
			deps({ createTask: () => ({ ok: false, problems: ["too_many_enabled"] }) }),
		);
		expect(full?.text).toContain(String(DEFAULT_LIMITS.maxEnabledTasks));
		expect(full?.text).not.toContain("call the tool again");
	});

	it("creates nothing when the agent's call is cancelled while the models are read", async () => {
		let cancelled = false;
		const toolDeps = deps({
			models: async () => {
				cancelled = true;
				return ["anthropic/claude-opus-5-5"];
			},
			cancelled: () => cancelled,
		});
		expect(await runScheduleTool(args({ model: "anthropic/claude-opus-5-5" }), toolDeps)).toBeNull();
		expect(toolDeps.createTask).not.toHaveBeenCalled();
	});
});
