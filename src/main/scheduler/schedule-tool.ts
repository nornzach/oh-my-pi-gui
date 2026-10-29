/**
 * The `schedule_task` tool agent tabs get (plan/23 §5): its definition, the
 * mapping from the agent's arguments to a task draft, and the call itself.
 * The user asked for the task in the conversation, so it is created right
 * away and the agent reports it there. Runs are always read-only; only the
 * user raises that, in Scheduled Tasks.
 */

import type { HostToolDefinition } from "../../shared/rpc-types";
import type {
	DraftProblem,
	SchedulerLimits,
	TaskDepth,
	TaskDraft,
	TaskSaveResult,
	TaskSchedule,
} from "../../shared/scheduler-types";
import { DEFAULT_TASK_DEPTH, RESEARCH_ROUNDS } from "../../shared/task-depth";
import { DEFAULT_TIMEOUT_MS, MAX_RUN_ROUNDS } from "./policy";
import scheduleTaskCreated from "./prompts/schedule-task-created.md?raw";
import scheduleTaskDescription from "./prompts/schedule-task-tool.md?raw";
import taskToolRejected from "./prompts/task-tool-rejected.md?raw";
import { renderTemplate, type TemplateValues } from "./template";

export const SCHEDULE_TASK_TOOL = "schedule_task";

export const DEPTH_DESCRIPTION =
	"How far each run goes: check (one pass), goal (work until done), research (several rounds, each deeper).";
export const ROUNDS_DESCRIPTION = "Research rounds per run, 2 to 6, or 0 for 3; ignored for other depths.";

export const SCHEDULE_TASK_TOOL_DEFINITION: HostToolDefinition = {
	name: SCHEDULE_TASK_TOOL,
	label: "Schedule task",
	description: scheduleTaskDescription.trim(),
	loadMode: "essential",
	parameters: {
		type: "object",
		properties: {
			title: { type: "string", description: "Short name for the task, under 60 characters." },
			prompt: { type: "string", description: "Complete instructions for each run." },
			scheduleKind: { type: "string", enum: ["cron", "interval", "once"] },
			cron: { type: "string", description: "Five-field cron in the user's local time, or empty." },
			everyMinutes: { type: "number", description: "Interval in minutes (at least 5), or 0." },
			at: { type: "string", description: "ISO 8601 date-time for a one-off run, or empty." },
			model: { type: "string", description: "provider/id the user asked for, or empty for the default." },
			depth: { type: "string", enum: ["check", "goal", "research"], description: DEPTH_DESCRIPTION },
			rounds: { type: "number", description: ROUNDS_DESCRIPTION },
		},
		required: ["title", "prompt", "scheduleKind", "cron", "everyMinutes", "at", "model", "depth", "rounds"],
		additionalProperties: false,
	},
};

export interface ScheduleToolContext {
	cwd: string;
	now: number;
	timeZone: string;
	sessionPath: string | null;
}

export type ParsedScheduleTool = { ok: true; draft: TaskDraft; model: string | null } | { ok: false; error: string };

export const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The depth a tool call picked with `depth` (and `rounds` for research); null when it left depth empty. */
export function parseDepthArgs(
	args: Record<string, unknown>,
): { ok: true; depth: TaskDepth | null } | { ok: false; error: string } {
	const kind = text(args.depth);
	if (!kind) return { ok: true, depth: null };
	if (kind === "check" || kind === "goal") return { ok: true, depth: { kind } };
	if (kind !== "research") return { ok: false, error: "depth must be check, goal or research" };
	const asked = typeof args.rounds === "number" ? Math.round(args.rounds) : 0;
	const rounds = asked > 0 ? asked : RESEARCH_ROUNDS.default;
	if (rounds < RESEARCH_ROUNDS.min || rounds > RESEARCH_ROUNDS.max) {
		return { ok: false, error: `rounds must be between ${RESEARCH_ROUNDS.min} and ${RESEARCH_ROUNDS.max}` };
	}
	return { ok: true, depth: { kind: "research", rounds } };
}

/** The template values that say how far each run goes. */
export function depthValues(depth: TaskDepth): TemplateValues {
	return {
		[`${depth.kind}Depth`]: true,
		rounds: depth.kind === "research" ? String(depth.rounds) : undefined,
		maxRounds: String(MAX_RUN_ROUNDS),
	};
}

/** The schedule a tool call picked with `scheduleKind` and that kind's field. */
export function parseScheduleArgs(
	args: Record<string, unknown>,
	context: ScheduleToolContext,
): { ok: true; schedule: TaskSchedule } | { ok: false; error: string } {
	switch (args.scheduleKind) {
		case "cron": {
			const expr = text(args.cron);
			if (!expr) return { ok: false, error: "cron is required when scheduleKind is cron" };
			return { ok: true, schedule: { kind: "cron", expr, tz: context.timeZone } };
		}
		case "interval": {
			const minutes = typeof args.everyMinutes === "number" ? args.everyMinutes : Number(args.everyMinutes);
			if (!Number.isFinite(minutes) || minutes <= 0) {
				return { ok: false, error: "everyMinutes must be a positive number when scheduleKind is interval" };
			}
			const everyMs = Math.round(minutes) * 60_000;
			return { ok: true, schedule: { kind: "interval", everyMs, anchor: context.now + everyMs } };
		}
		case "once": {
			const at = Date.parse(text(args.at));
			if (!Number.isFinite(at))
				return { ok: false, error: "at must be an ISO 8601 date-time when scheduleKind is once" };
			return { ok: true, schedule: { kind: "once", at } };
		}
		default:
			return { ok: false, error: "scheduleKind must be cron, interval or once" };
	}
}

export function parseScheduleToolArgs(args: Record<string, unknown>, context: ScheduleToolContext): ParsedScheduleTool {
	const title = text(args.title).slice(0, 80);
	const prompt = text(args.prompt);
	if (!title) return { ok: false, error: "title is required" };
	if (!prompt) return { ok: false, error: "prompt is required" };
	const parsed = parseScheduleArgs(args, context);
	if (!parsed.ok) return parsed;
	const schedule = parsed.schedule;
	const depth = parseDepthArgs(args);
	if (!depth.ok) return depth;
	return {
		ok: true,
		draft: {
			title,
			prompt,
			cwd: context.cwd,
			schedule,
			model: null,
			tools: "read_only",
			depth: depth.depth ?? DEFAULT_TASK_DEPTH,
			timeoutMs: DEFAULT_TIMEOUT_MS,
			verify: null,
			notify: "on_change",
			origin: { sessionPath: context.sessionPath, createdBy: "agent" },
			startPaused: false,
		},
		model: text(args.model) || null,
	};
}

/**
 * The agent's model as a run's `--model`: one of the workspace's
 * `provider/id`s, or a bare id exactly one provider has, keeping a trailing
 * `:level`. Null when it names no model here.
 */
export function resolveModel(requested: string, models: readonly string[]): string | null {
	if (models.includes(requested)) return requested;
	const colon = requested.lastIndexOf(":");
	const base = colon > 0 ? requested.slice(0, colon) : requested;
	const level = colon > 0 ? requested.slice(colon) : "";
	if (models.includes(base)) return requested;
	if (base.includes("/")) return null;
	const matches = models.filter(model => model.endsWith(`/${base}`));
	return matches.length === 1 ? `${matches[0]}${level}` : null;
}

export interface ScheduleToolDeps {
	context: ScheduleToolContext;
	limits: SchedulerLimits;
	/** `provider/id` of every model the tab can run, or null when they could not be read. */
	models(): Promise<string[] | null>;
	createTask(draft: TaskDraft): TaskSaveResult;
	/** The agent's call was cancelled: nothing is created after that. */
	cancelled(): boolean;
}

/** What a scheduler tool tells the agent. */
export interface ToolReply {
	text: string;
	isError: boolean;
}

export interface ScheduleToolResult extends ToolReply {
	/** What the chat card shows; absent when nothing was created. */
	details?: { outcome: "created"; taskId: string; nextFireAt: number | null; model: string | null; depth: TaskDepth };
}

const MAX_LISTED_MODELS = 40;

/**
 * The model a tool call asked for, checked against the workspace's models:
 * the run's `--model`, or the rejection's values, listing what it can use.
 * Null once the call was cancelled.
 */
export async function checkModel(
	requested: string,
	deps: Pick<ScheduleToolDeps, "models" | "cancelled">,
): Promise<{ ok: true; model: string } | { ok: false; problem: TemplateValues } | null> {
	const models = await deps.models();
	if (deps.cancelled()) return null;
	if (!models) return { ok: false, problem: { modelsUnreadable: requested, retry: true } };
	const model = resolveModel(requested, models);
	if (model) return { ok: true, model };
	const listed = models.slice(0, MAX_LISTED_MODELS).join(", ");
	return { ok: false, problem: { unknownModel: requested, models: listed || "none", retry: true } };
}

/** Create the task the agent asked for, or tell it what to fix. Null once the call was cancelled. */
export async function runScheduleTool(
	args: Record<string, unknown>,
	deps: ScheduleToolDeps,
): Promise<ScheduleToolResult | null> {
	const parsed = parseScheduleToolArgs(args, deps.context);
	if (!parsed.ok) return notScheduled({ error: parsed.error, retry: true });
	const draft = parsed.draft;
	if (parsed.model) {
		const checked = await checkModel(parsed.model, deps);
		if (!checked) return null;
		if (!checked.ok) return notScheduled(checked.problem);
		draft.model = checked.model;
	}
	if (deps.cancelled()) return null;
	const saved = deps.createTask(draft);
	if (!saved.ok) return notScheduled(problemValues(saved.problems, deps.limits));
	const { task } = saved;
	return {
		text: renderTemplate(scheduleTaskCreated, {
			title: task.title,
			taskId: task.id,
			firstRun: task.nextFireAt === null ? "" : wallClock(task.nextFireAt, deps.context.timeZone),
			model: task.model,
			defaultModel: task.model === null,
			...depthValues(task.depth),
		}),
		isError: false,
		details: {
			outcome: "created",
			taskId: task.id,
			nextFireAt: task.nextFireAt,
			model: task.model,
			depth: task.depth,
		},
	};
}

const EXPLAINED_PROBLEMS = new Set<DraftProblem>([
	"schedule_invalid",
	"schedule_in_past",
	"too_frequent",
	"too_many_enabled",
]);

export function problemValues(problems: readonly DraftProblem[], limits: SchedulerLimits): TemplateValues {
	const values: TemplateValues = {
		minIntervalMinutes: String(Math.round(limits.minIntervalMs / 60_000)),
		maxEnabledTasks: String(limits.maxEnabledTasks),
		other: problems.filter(problem => !EXPLAINED_PROBLEMS.has(problem)).join(", "),
		retry: !problems.includes("too_many_enabled"),
	};
	for (const problem of problems) values[problem] = true;
	return values;
}

/** A refused call: what was wrong, under the `headline` section the template names. */
export function rejected(headline: "notScheduled" | "notChanged", values: TemplateValues): ToolReply {
	return { text: renderTemplate(taskToolRejected, { ...values, [headline]: true }), isError: true };
}

const notScheduled = (values: TemplateValues) => rejected("notScheduled", values);

/** "2026-10-30 09:00 Asia/Shanghai": the user's wall clock, for the agent to repeat. */
export function wallClock(at: number, timeZone: string): string {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(at)
			.map(part => [part.type, part.value]),
	);
	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${timeZone}`;
}
