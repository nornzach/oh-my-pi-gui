/**
 * The `manage_scheduled_tasks` tool agent tabs get next to `schedule_task`:
 * list the workspace's scheduled tasks, change one, pause or resume it, or
 * delete it, from the conversation. It never changes what a run may do;
 * only the user raises that, in Scheduled Tasks. Delete archives the task:
 * it stops for good, and its runs stay until the user removes it there.
 */

import type { HostToolDefinition } from "../../shared/rpc-types";
import type {
	ScheduledTask,
	SchedulerLimits,
	TaskConfig,
	TaskSaveResult,
	TaskSchedule,
	TaskState,
	TaskToolPolicy,
} from "../../shared/scheduler-types";
import manageTasksChanged from "./prompts/manage-tasks-changed.md?raw";
import manageTasksList from "./prompts/manage-tasks-list.md?raw";
import manageTasksDescription from "./prompts/manage-tasks-tool.md?raw";
import {
	checkModel,
	parseScheduleArgs,
	problemValues,
	rejected,
	type ScheduleToolContext,
	type ToolReply,
	text,
	wallClock,
} from "./schedule-tool";
import { renderTemplate, type TemplateValues } from "./template";

export const MANAGE_TASKS_TOOL = "manage_scheduled_tasks";

const ACTIONS = ["list", "update", "pause", "resume", "delete"] as const;
export type ManageTasksAction = (typeof ACTIONS)[number];

export const MANAGE_TASKS_TOOL_DEFINITION: HostToolDefinition = {
	name: MANAGE_TASKS_TOOL,
	label: "Manage scheduled tasks",
	description: manageTasksDescription.trim(),
	loadMode: "essential",
	parameters: {
		type: "object",
		properties: {
			action: { type: "string", enum: [...ACTIONS] },
			taskId: { type: "string", description: "The task's id from list, or empty for list." },
			title: { type: "string", description: "New title, or empty to keep it." },
			prompt: { type: "string", description: "New instructions for each run, or empty to keep them." },
			scheduleKind: {
				type: "string",
				enum: ["", "cron", "interval", "once"],
				description: "New schedule kind, or empty to keep the schedule.",
			},
			cron: { type: "string", description: "Five-field cron in the user's local time, or empty." },
			everyMinutes: { type: "number", description: "Interval in minutes (at least 5), or 0." },
			at: { type: "string", description: "ISO 8601 date-time for a one-off run, or empty." },
			model: { type: "string", description: "provider/id, default for the workspace default, or empty to keep it." },
		},
		required: ["action", "taskId", "title", "prompt", "scheduleKind", "cron", "everyMinutes", "at", "model"],
		additionalProperties: false,
	},
};

export interface ManageTasksDeps {
	context: ScheduleToolContext;
	limits: SchedulerLimits;
	/** Every task the scheduler holds, any workspace or state. */
	tasks(): ScheduledTask[];
	/** `provider/id` of every model the tab can run, or null when they could not be read. */
	models(): Promise<string[] | null>;
	updateTask(id: string, config: TaskConfig): TaskSaveResult;
	setTaskEnabled(id: string, enabled: boolean): TaskSaveResult;
	archiveTask(id: string): void;
	/** The agent's call was cancelled: nothing changes after that. */
	cancelled(): boolean;
}

export interface ManageTasksResult extends ToolReply {
	/** What the chat card shows; absent when nothing changed. */
	details?:
		| { action: "list"; count: number }
		| {
				action: Exclude<ManageTasksAction, "list">;
				taskId: string;
				title: string;
				nextFireAt: number | null;
		  };
}

/** Run one call. Null once the call was cancelled. */
export async function runManageTasksTool(
	args: Record<string, unknown>,
	deps: ManageTasksDeps,
): Promise<ManageTasksResult | null> {
	const action = ACTIONS.find(name => name === args.action);
	if (!action) return notChanged({ error: `action must be one of ${ACTIONS.join(", ")}`, retry: true });
	const tasks = deps
		.tasks()
		.filter(task => task.cwd === deps.context.cwd && task.state !== "archived")
		.sort((a, b) => a.createdAt - b.createdAt);
	const list = renderTemplate(manageTasksList, {
		tasks: tasks.map(task => taskLine(task, deps.context.timeZone)).join("\n"),
		none: tasks.length === 0,
	});
	if (action === "list") return { text: list, isError: false, details: { action, count: tasks.length } };

	const taskId = text(args.taskId);
	const task = tasks.find(candidate => candidate.id === taskId);
	if (!task) return notChanged({ unknownTask: JSON.stringify(taskId), taskList: list, retry: true });

	let saved: TaskSaveResult;
	switch (action) {
		case "update": {
			const config = await updatedConfig(task, args, deps);
			if (config === null) return null;
			if ("text" in config) return config;
			saved = deps.updateTask(task.id, config);
			break;
		}
		case "pause":
			saved = deps.setTaskEnabled(task.id, false);
			break;
		case "resume":
			saved = deps.setTaskEnabled(task.id, true);
			break;
		case "delete":
			deps.archiveTask(task.id);
			saved = { ok: true, task: { ...task, state: "archived", nextFireAt: null } };
			break;
	}
	if (!saved.ok) return notChanged(problemValues(saved.problems, deps.limits));
	const changed = saved.task;
	const showsRuns = action === "update" || action === "resume";
	return {
		text: renderTemplate(manageTasksChanged, {
			[DONE[action]]: true,
			title: changed.title,
			taskId: changed.id,
			nextRun: showsRuns && changed.nextFireAt !== null ? wallClock(changed.nextFireAt, deps.context.timeZone) : "",
			model: showsRuns ? changed.model : "",
			defaultModel: showsRuns && changed.model === null,
		}),
		isError: false,
		details: { action, taskId: changed.id, title: changed.title, nextFireAt: changed.nextFireAt },
	};
}

/** The task's settings with the call's changes, or what to fix. Null once the call was cancelled. */
async function updatedConfig(
	task: ScheduledTask,
	args: Record<string, unknown>,
	deps: ManageTasksDeps,
): Promise<TaskConfig | ToolReply | null> {
	const config: TaskConfig = {
		title: task.title,
		prompt: task.prompt,
		cwd: task.cwd,
		schedule: task.schedule,
		model: task.model,
		tools: task.tools,
		timeoutMs: task.timeoutMs,
		verify: task.verify,
		notify: task.notify,
	};
	let changes = 0;
	const title = text(args.title).slice(0, 80);
	if (title) {
		config.title = title;
		changes++;
	}
	const prompt = text(args.prompt);
	if (prompt) {
		config.prompt = prompt;
		changes++;
	}
	if (text(args.scheduleKind)) {
		const parsed = parseScheduleArgs(args, deps.context);
		if (!parsed.ok) return notChanged({ error: parsed.error, retry: true });
		config.schedule = parsed.schedule;
		changes++;
	}
	const model = text(args.model);
	if (model === "default") {
		config.model = null;
		changes++;
	} else if (model) {
		const checked = await checkModel(model, deps);
		if (!checked) return null;
		if (!checked.ok) return notChanged(checked.problem);
		config.model = checked.model;
		changes++;
	}
	if (changes === 0) return notChanged({ nothingToUpdate: true, retry: true });
	return deps.cancelled() ? null : config;
}

const notChanged = (values: TemplateValues) => rejected("notChanged", values);

/** The template section for each change. */
const DONE: Record<Exclude<ManageTasksAction, "list">, string> = {
	update: "updated",
	pause: "paused",
	resume: "resumed",
	delete: "deleted",
};

const STATE_TEXT: Record<TaskState, string> = {
	active: "active",
	paused: "paused",
	disabled: "stopped after failing runs; resume to retry",
	archived: "deleted",
};

const ACCESS_TEXT: Record<TaskToolPolicy, string> = {
	read_only: "read-only",
	workspace: "edits files in a worktree",
	full: "full access",
};

/** One task as the agent reads it: id, title, schedule, state, next run, model, access. */
function taskLine(task: ScheduledTask, timeZone: string): string {
	const state = STATE_TEXT[task.state];
	const next = task.nextFireAt === null ? "" : `, next run ${wallClock(task.nextFireAt, timeZone)}`;
	const model = task.model ?? "workspace default model";
	return `- ${task.id}: "${task.title}", ${scheduleText(task.schedule, timeZone)}, ${state}${next}, ${model}, ${ACCESS_TEXT[task.tools]}`;
}

function scheduleText(schedule: TaskSchedule, timeZone: string): string {
	if (schedule.kind === "cron") return `cron "${schedule.expr}"`;
	if (schedule.kind === "interval") return `every ${Math.round(schedule.everyMs / 60_000)} minutes`;
	return `once at ${wallClock(schedule.at, timeZone)}`;
}
