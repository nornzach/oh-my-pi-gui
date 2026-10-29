/**
 * Structural checks for scheduler payloads arriving over IPC. The renderer is
 * trusted to be ours but not to be bug-free: a malformed draft must come back
 * as an error, never reach the store half-shaped. Meaning (is the schedule
 * too frequent, is the folder set) is the scheduler's `validate`, not this.
 */

import type { TaskConfig, TaskDraft, TaskNotify, TaskSchedule, TaskToolPolicy } from "../../shared/scheduler-types";

const TOOL_POLICIES: Record<TaskToolPolicy, true> = { read_only: true, workspace: true, full: true };
const NOTIFY_MODES: Record<TaskNotify, true> = { always: true, on_change: true, on_failure: true };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function asSchedule(value: unknown): TaskSchedule | null {
	if (!isRecord(value)) return null;
	switch (value.kind) {
		case "once":
			return isFiniteNumber(value.at) ? { kind: "once", at: value.at } : null;
		case "interval":
			return isFiniteNumber(value.everyMs) && isFiniteNumber(value.anchor)
				? { kind: "interval", everyMs: value.everyMs, anchor: value.anchor }
				: null;
		case "cron":
			return typeof value.expr === "string" && typeof value.tz === "string"
				? { kind: "cron", expr: value.expr, tz: value.tz }
				: null;
		default:
			return null;
	}
}

export function asTaskConfig(value: unknown): TaskConfig | null {
	if (!isRecord(value)) return null;
	const schedule = asSchedule(value.schedule);
	if (!schedule) return null;
	if (typeof value.title !== "string" || typeof value.prompt !== "string" || typeof value.cwd !== "string")
		return null;
	if (value.model !== null && typeof value.model !== "string") return null;
	if (typeof value.tools !== "string" || !(value.tools in TOOL_POLICIES)) return null;
	if (typeof value.notify !== "string" || !(value.notify in NOTIFY_MODES)) return null;
	if (!isFiniteNumber(value.timeoutMs)) return null;
	let verify: TaskConfig["verify"] = null;
	if (value.verify !== null) {
		if (
			!isRecord(value.verify) ||
			typeof value.verify.command !== "string" ||
			!isFiniteNumber(value.verify.timeoutMs)
		) {
			return null;
		}
		verify = { command: value.verify.command, timeoutMs: value.verify.timeoutMs };
	}
	return {
		title: value.title,
		prompt: value.prompt,
		cwd: value.cwd,
		schedule,
		model: value.model === "" ? null : (value.model as string | null),
		tools: value.tools as TaskToolPolicy,
		timeoutMs: value.timeoutMs,
		verify,
		notify: value.notify as TaskNotify,
	};
}

export function asTaskDraft(value: unknown): TaskDraft | null {
	const config = asTaskConfig(value);
	if (!config || !isRecord(value)) return null;
	const origin = value.origin;
	if (!isRecord(origin) || (origin.createdBy !== "user" && origin.createdBy !== "agent")) return null;
	if (origin.sessionPath !== null && typeof origin.sessionPath !== "string") return null;
	return {
		...config,
		origin: { sessionPath: origin.sessionPath as string | null, createdBy: origin.createdBy },
		startPaused: value.startPaused === true,
	};
}
