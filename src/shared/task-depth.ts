/**
 * How far one run of a scheduled task goes before it is over. The run judges
 * itself against the depth through its report: a check takes one pass, a
 * goal keeps going while the work is unfinished, and research takes at least
 * its rounds, each going deeper than the last. Shared by the scheduler, the
 * agent's scheduling tools and the task editor.
 */

import type { TaskDepth } from "./scheduler-types";

export const RESEARCH_ROUNDS = { min: 2, max: 6, default: 3 } as const;

/** What a task gets when nobody chose: finish the work, not just a first pass. */
export const DEFAULT_TASK_DEPTH: TaskDepth = { kind: "goal" };

export function depthIsValid(depth: TaskDepth): boolean {
	if (depth.kind !== "research") return depth.kind === "check" || depth.kind === "goal";
	return Number.isInteger(depth.rounds) && depth.rounds >= RESEARCH_ROUNDS.min && depth.rounds <= RESEARCH_ROUNDS.max;
}

/** A stored task's depth; tasks saved before depth existed run as goals. */
export function storedDepth(value: unknown): TaskDepth {
	if (typeof value !== "object" || value === null) return DEFAULT_TASK_DEPTH;
	const depth = value as Partial<{ kind: string; rounds: number }>;
	if (depth.kind === "check" || depth.kind === "goal") return { kind: depth.kind };
	if (depth.kind === "research") {
		const rounds = typeof depth.rounds === "number" ? Math.round(depth.rounds) : RESEARCH_ROUNDS.default;
		return { kind: "research", rounds: Math.min(RESEARCH_ROUNDS.max, Math.max(RESEARCH_ROUNDS.min, rounds)) };
	}
	return DEFAULT_TASK_DEPTH;
}
