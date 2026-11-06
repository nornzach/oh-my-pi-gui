/**
 * Activity and turn scope for subagent rosters (plan/24 §4).
 *
 * The wire status is free-form and "live" lumps parked and idle agents in
 * with working ones. Every count and live signal goes through
 * `subagentActivity` instead, and the default roster shows the latest turn:
 * agents spawned since the last user message, plus anything older that is
 * still working.
 */

import type { AgentMessage, SubagentSnapshot } from "../../../shared/rpc-types";
import { describeProviderError } from "../../lib/errors";
import { messageTimestampMs } from "../../lib/message-identity";
import type { SubagentListRow } from "../panels/subagent-graph";

export type SubagentActivity = "working" | "waiting" | "failed" | "done" | "stopped";

const ACTIVITY_RANK: Record<SubagentActivity, number> = { working: 0, waiting: 1, failed: 2, done: 3, stopped: 4 };

export function subagentActivity(agent: SubagentSnapshot): SubagentActivity {
	switch (agent.status) {
		case "started":
		case "running":
			return agent.live === false ? "stopped" : "working";
		case "pending":
		case "idle":
		case "parked":
		case "waiting":
			return "waiting";
		case "failed":
			return "failed";
		case "completed":
			return "done";
		default:
			return "stopped";
	}
}

/** Whether any agent is working (parked, idle and finished agents are not). */
export function hasWorkingSubagent(agents: Iterable<SubagentSnapshot>): boolean {
	for (const agent of agents) if (subagentActivity(agent) === "working") return true;
	return false;
}

function isTurnStart(message: AgentMessage): boolean {
	return message.role === "user" && !message.steering;
}

export interface LatestTurn {
	/** Tool calls the turn made, including the streaming message's. */
	toolCallIds: Set<string>;
	/** When the turn's user message was sent; null when no loaded message starts it. */
	startedAt: number | null;
}

/**
 * The latest turn: everything after the last user message (steering stays
 * inside its turn), including the streaming message.
 */
export function latestTurn(messages: readonly AgentMessage[]): LatestTurn {
	const toolCallIds = new Set<string>();
	let start = 0;
	let startedAt: number | null = null;
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]!;
		if (isTurnStart(message)) {
			start = index + 1;
			startedAt = messageTimestampMs(message) || null;
			break;
		}
	}
	for (let index = start; index < messages.length; index++) {
		const message = messages[index]!;
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) if (part.type === "toolCall") toolCallIds.add(part.id);
	}
	return { toolCallIds, startedAt };
}

/**
 * Agents that belong to the latest turn: those spawned since it started,
 * whoever spawned them, and every agent under a top-level agent the turn's
 * own tool calls spawned. Any agent still working belongs too, whatever turn
 * spawned it. `rows` is the spawn-order tree, so nesting follows the same
 * parent links the roster draws.
 */
export function subagentTurnMembers(rows: readonly SubagentListRow[], turn: LatestTurn): Set<string> {
	const members = new Set<string>();
	let underTurnRoot = false;
	for (const { agent, depth } of rows) {
		if (depth === 0)
			underTurnRoot = agent.parentToolCallId !== undefined && turn.toolCallIds.has(agent.parentToolCallId);
		const spawnedThisTurn =
			turn.startedAt !== null && agent.spawnedAt !== undefined && agent.spawnedAt >= turn.startedAt;
		if (underTurnRoot || spawnedThisTurn || subagentActivity(agent) === "working") members.add(agent.id);
	}
	return members;
}

export interface AgentTreeRow {
	agent: SubagentSnapshot;
	depth: number;
	activity: SubagentActivity;
	/** An ancestor kept so a member is never an indented orphan; not counted. */
	context: boolean;
	/** Visible children directly under this row. */
	childCount: number;
	/** Members anywhere below this row. */
	descendants: number;
	/** A member below this row is working. */
	workingBelow: boolean;
}

interface TreeNode {
	agent: SubagentSnapshot;
	children: TreeNode[];
}

/**
 * Project the spawn-order list into the roster's tree. With `members` the
 * tree keeps only members and their ancestors, ordering siblings by
 * activity; without it, every agent stays in spawn order.
 */
export function buildAgentTree(rows: readonly SubagentListRow[], members: ReadonlySet<string> | null): AgentTreeRow[] {
	const roots: TreeNode[] = [];
	const stack: TreeNode[] = [];
	for (const row of rows) {
		const node: TreeNode = { agent: row.agent, children: [] };
		stack.length = Math.min(stack.length, row.depth);
		const parent = stack.at(-1);
		if (parent) parent.children.push(node);
		else roots.push(node);
		stack.push(node);
	}

	const keep = (node: TreeNode): boolean => {
		node.children = node.children.filter(keep);
		return !members || members.has(node.agent.id) || node.children.length > 0;
	};
	const kept = roots.filter(keep);

	// A subtree ranks by its most active member, so a context parent of a
	// working agent sorts with the working ones and survives the sidebar's cut.
	const ranks = new Map<TreeNode, number>();
	const rankOf = (node: TreeNode): number => {
		let best =
			!members || members.has(node.agent.id)
				? ACTIVITY_RANK[subagentActivity(node.agent)]
				: Number.POSITIVE_INFINITY;
		for (const child of node.children) best = Math.min(best, rankOf(child));
		ranks.set(node, best);
		return best;
	};
	// The sort is stable, so equal ranks keep the rows' spawn order.
	const sortSiblings = (nodes: TreeNode[]): void => {
		if (members) nodes.sort((a, b) => ranks.get(a)! - ranks.get(b)!);
		for (const node of nodes) sortSiblings(node.children);
	};
	if (members) for (const node of kept) rankOf(node);
	sortSiblings(kept);

	const out: AgentTreeRow[] = [];
	const visit = (node: TreeNode, depth: number): { members: number; working: boolean } => {
		const activity = subagentActivity(node.agent);
		const context = members !== null && !members.has(node.agent.id);
		const row: AgentTreeRow = {
			agent: node.agent,
			depth,
			activity,
			context,
			childCount: node.children.length,
			descendants: 0,
			workingBelow: false,
		};
		out.push(row);
		for (const child of node.children) {
			const below = visit(child, depth + 1);
			row.descendants += below.members;
			row.workingBelow ||= below.working;
		}
		return {
			members: row.descendants + (context ? 0 : 1),
			working: row.workingBelow || (!context && activity === "working"),
		};
	};
	for (const node of kept) visit(node, 0);
	return out;
}

/** Hide rows under collapsed parents. */
export function visibleTreeRows(rows: readonly AgentTreeRow[], collapsed: ReadonlySet<string>): AgentTreeRow[] {
	const out: AgentTreeRow[] = [];
	let hiddenBelow: number | null = null;
	for (const row of rows) {
		if (hiddenBelow !== null) {
			if (row.depth > hiddenBelow) continue;
			hiddenBelow = null;
		}
		out.push(row);
		if (row.childCount > 0 && collapsed.has(row.agent.id)) hiddenBelow = row.depth;
	}
	return out;
}

export interface AgentTreeCut {
	rows: AgentTreeRow[];
	hidden: number;
	hiddenWorking: number;
	hiddenFailed: number;
}

/** The sidebar's first rows, and what the "N more" line says about the rest. */
export function cutAgentTree(rows: readonly AgentTreeRow[], limit: number): AgentTreeCut {
	const shown = rows.slice(0, limit);
	let hidden = 0;
	let hiddenWorking = 0;
	let hiddenFailed = 0;
	for (const row of rows.slice(limit)) {
		if (row.context) continue;
		hidden++;
		if (row.activity === "working") hiddenWorking++;
		else if (row.activity === "failed") hiddenFailed++;
	}
	return { rows: shown, hidden, hiddenWorking, hiddenFailed };
}

export type AgentNowLine =
	| { kind: "retry"; attempt: number; maxAttempts: number; error: string }
	| { kind: "tool"; tool: string; args: string }
	| { kind: "intent"; text: string }
	| { kind: "error"; text: string };

/** What a row says about an agent right now (plan/24 §5.2); the first match wins. */
export function agentNowLine(agent: SubagentSnapshot): AgentNowLine | null {
	const progress = agent.progress;
	const activity = subagentActivity(agent);
	if (activity === "working" && progress) {
		const retry = progress.retryState;
		if (retry) {
			return {
				kind: "retry",
				attempt: retry.attempt,
				maxAttempts: retry.maxAttempts,
				error: describeProviderError(retry.errorMessage),
			};
		}
		// A parent running `task` is doing what its children do.
		if (progress.currentTool === "task") return null;
		if (progress.currentTool)
			return { kind: "tool", tool: progress.currentTool, args: progress.currentToolArgs ?? "" };
		if (progress.lastIntent?.trim()) return { kind: "intent", text: progress.lastIntent.trim() };
		return null;
	}
	if (activity === "failed") {
		const failure = progress?.retryFailure?.errorMessage;
		const text = failure ? describeProviderError(failure) : progress?.recentOutput?.at(-1);
		return text?.trim() ? { kind: "error", text: text.trim() } : null;
	}
	return null;
}
