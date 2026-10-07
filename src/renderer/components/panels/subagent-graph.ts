/**
 * Shared subagent graph model: status metadata, elapsed-time helpers, the
 * tool-call ownership registry used to recover parent→child spawn edges, and
 * the pure layered-tree layout builder behind SubagentDag.
 *
 * The wire carries an explicit parent link for nested spawns
 * (`parentSubagentId`); frames that predate it fall back to attributing the
 * spawning `task` tool call (`parentToolCallId`) to its owning session —
 * the main session's messages for top-level spawns, the tool-call ownership
 * registry (filled in as transcripts load) for nested ones.
 */

import { useSubagentGraphStore } from "../../stores/subagent-graph";

export * from "../../stores/subagent-graph";

import type { AgentMessage, SubagentSnapshot } from "../../../shared/rpc-types";
import type { BadgeVariant } from "../common";

/**
 * Status presentation for a subagent row. The wire's status is FREE-FORM
 * (lifecycle statuses plus arbitrary progress payloads: "started", "running",
 * "pending", "completed", "failed", "aborted", "cancelled", "idle", "parked",
 * and anything an agent emits). Never index a Record with it unchecked — a
 * missing key was the white-screen crash on the agents tab (meta.live of
 * undefined). Always go through statusMeta()/isLiveSubagentStatus().
 */
export interface StatusMeta {
	label: string;
	variant: BadgeVariant;
	live: boolean;
	labelKey: string;
}

const STATUS_META: Record<string, StatusMeta> = {
	started: { label: "running", variant: "info", live: true, labelKey: "subagent.status.started" },
	running: { label: "running", variant: "info", live: true, labelKey: "subagent.status.started" },
	pending: { label: "pending", variant: "muted", live: true, labelKey: "subagent.status.pending" },
	idle: { label: "idle", variant: "muted", live: true, labelKey: "subagent.status.idle" },
	parked: { label: "parked", variant: "muted", live: true, labelKey: "subagent.status.parked" },
	stale: { label: "stale", variant: "warning", live: false, labelKey: "subagent.status.stale" },
	completed: { label: "completed", variant: "success", live: false, labelKey: "subagent.status.completed" },
	failed: { label: "failed", variant: "error", live: false, labelKey: "subagent.status.failed" },
	aborted: { label: "cancelled", variant: "muted", live: false, labelKey: "subagent.status.cancelled" },
	cancelled: { label: "cancelled", variant: "muted", live: false, labelKey: "subagent.status.cancelled" },
};

/** Total lookup — unknown/future statuses degrade to a muted badge with the raw status text. */
export function statusMeta(status: string): StatusMeta {
	return STATUS_META[status] ?? { label: status, variant: "muted", live: false, labelKey: "subagent.status.unknown" };
}

/** True for non-terminal statuses (drives elapsed timers, pulse dots, running counts). */
export function isLiveSubagentStatus(status: string): boolean {
	return statusMeta(status).live;
}

/**
 * Elapsed runtime from the agent's own progress clock.
 *
 * `durationMs` is sampled by the sidecar when a progress frame is emitted;
 * `lastUpdate` is when the renderer received that frame. Advancing the sample
 * by the time since `lastUpdate` keeps a live row moving without inventing a
 * new start time when the panel happens to open. Terminal rows stay frozen at
 * their final duration. Bare live registry snapshots have no duration sample,
 * so their first lifecycle timestamp is the only honest fallback.
 */
export function subagentElapsedMs(agent: SubagentSnapshot, now: number): number | null {
	const live = isLiveSubagentStatus(agent.status);
	const sampled = agent.progress?.durationMs;
	if (typeof sampled === "number" && Number.isFinite(sampled)) {
		const sinceSample = live && Number.isFinite(agent.lastUpdate) ? Math.max(0, now - agent.lastUpdate) : 0;
		return Math.max(0, sampled + sinceSample);
	}
	if (live && Number.isFinite(agent.lastUpdate)) return Math.max(0, now - agent.lastUpdate);
	return null;
}

export function formatElapsed(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Ids of `task` tool calls found in a message list (main session or a subagent transcript). */
export function extractTaskToolCallIds(messages: AgentMessage[]): string[] {
	const ids: string[] = [];
	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part.type === "toolCall" && part.name === "task") ids.push(part.id);
		}
	}
	return ids;
}

/** Register every `task` tool call found in a loaded transcript page as owned by that subagent. */
export function registerTranscriptToolCalls(agentId: string, messages: AgentMessage[]): void {
	const ids = extractTaskToolCallIds(messages);
	if (ids.length > 0) useSubagentGraphStore.getState().registerToolCallOwners(agentId, ids);
}

// ============================================================================
// DAG layout
// ============================================================================

/** Synthetic node anchoring every top-level (or unresolved) spawn. */
export const MAIN_NODE_ID = "__main__";
export const DAG_NODE_WIDTH = 216;
export const DAG_NODE_HEIGHT = 56;
const DAG_GAP_X = 64;
const DAG_GAP_Y = 14;
const DAG_PAD = 14;

export interface DagNode {
	id: string;
	/** Null only for the synthetic main-session node. */
	agent: SubagentSnapshot | null;
	depth: number;
	x: number;
	y: number;
}

export interface DagEdge {
	id: string;
	parentId: string;
	childId: string;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface SubagentDagLayout {
	nodes: DagNode[];
	edges: DagEdge[];
	width: number;
	height: number;
	/** Agent ids whose parent tool call could not be attributed; attached to the main node instead. */
	unresolved: string[];
}

/** The spawning subagent id, absent for root spawns from the main session. */
export function parentSubagentIdOf(agent: SubagentSnapshot): string | undefined {
	return agent.parentSubagentId;
}

/** Human task label used consistently by list, graph, and hub surfaces. */
export function subagentPrimaryLabel(agent: SubagentSnapshot, maxLength = 60): string {
	// `description` is the sidecar's tiny-model UI label. `assignment` is the
	// complete delegated prompt and may include markdown/system scaffolding, so
	// it belongs in the transcript rather than the compact row heading.
	const raw = agent.description ?? agent.assignment ?? agent.task ?? agent.agent;
	const text = raw.trim() || agent.agent;
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function resolveParent(
	agent: SubagentSnapshot,
	byId: Map<string, SubagentSnapshot>,
	rootToolCallIds: ReadonlySet<string>,
	toolCallOwners: ReadonlyMap<string, string>,
): { parentId: string; inferred: boolean } {
	// Preferred: explicit spawn link on the wire.
	const parentId = parentSubagentIdOf(agent);
	if (parentId && parentId !== agent.id && byId.has(parentId)) return { parentId, inferred: false };

	// Fallback: attribute the spawning `task` tool call to its owning session.
	const callId = agent.parentToolCallId;
	if (!callId) return { parentId: MAIN_NODE_ID, inferred: parentId !== undefined };
	const owner = toolCallOwners.get(callId);
	if (owner && owner !== agent.id && byId.has(owner)) return { parentId: owner, inferred: false };
	if (rootToolCallIds.has(callId)) return { parentId: MAIN_NODE_ID, inferred: false };
	return { parentId: MAIN_NODE_ID, inferred: true };
}

/**
 * Layered tidy-tree layout: depth columns left→right, siblings stacked
 * vertically, parents centered on their children. Every agent hangs off the
 * synthetic main node unless its `parentToolCallId` resolves to another
 * subagent, so the result is always a single tree.
 */
export function buildSubagentDag(
	agents: SubagentSnapshot[],
	rootToolCallIds: ReadonlySet<string>,
	toolCallOwners: ReadonlyMap<string, string>,
): SubagentDagLayout {
	const sorted = [...agents].sort((a, b) => a.index - b.index);
	const byId = new Map<string, SubagentSnapshot>();
	for (const agent of sorted) byId.set(agent.id, agent);

	const parentOf = new Map<string, string>();
	const unresolved: string[] = [];
	for (const agent of sorted) {
		const { parentId, inferred } = resolveParent(agent, byId, rootToolCallIds, toolCallOwners);
		parentOf.set(agent.id, parentId);
		if (inferred) unresolved.push(agent.id);
	}

	// Depth via walk-up with cycle protection; a cycle re-attaches the walked
	// node to main. Depths are memoized and backfilled along each walk, so a
	// long lineage resolves in one pass instead of an O(n²) walk-per-node.
	const depthOf = new Map<string, number>([[MAIN_NODE_ID, 0]]);
	for (const agent of sorted) {
		if (depthOf.has(agent.id)) continue;
		const path: string[] = [];
		const onPath = new Set<string>();
		let cursor = agent.id;
		let base: number | null = null;
		while (cursor !== MAIN_NODE_ID) {
			const known = depthOf.get(cursor);
			if (known !== undefined) {
				base = known;
				break;
			}
			if (onPath.has(cursor)) break; // re-entered this walk's path → cycle
			onPath.add(cursor);
			path.push(cursor);
			cursor = parentOf.get(cursor) ?? MAIN_NODE_ID;
		}
		if (base === null && cursor !== MAIN_NODE_ID) {
			// Walked into a cycle: re-root the node and leave the rest of the
			// path unresolved — they walk again and terminate at the re-root.
			parentOf.set(agent.id, MAIN_NODE_ID);
			depthOf.set(agent.id, 1);
			continue;
		}
		const baseDepth = base ?? 0;
		for (let i = path.length - 1; i >= 0; i--) {
			depthOf.set(path[i]!, baseDepth + (path.length - i));
		}
	}

	const childrenOf = new Map<string, string[]>();
	for (const agent of sorted) {
		const parent = parentOf.get(agent.id) ?? MAIN_NODE_ID;
		const siblings = childrenOf.get(parent);
		if (siblings) siblings.push(agent.id);
		else childrenOf.set(parent, [agent.id]);
	}

	// Tidy rows: leaves take successive slots; internal nodes center on children.
	// Iterative post-order — recursion over a deep lineage overflows the stack.
	let leafCount = 0;
	const slotOf = new Map<string, number>();
	const postOrder: string[] = [];
	const expanded = new Set<string>();
	const pending: Array<{ id: string; expanded: boolean }> = [{ id: MAIN_NODE_ID, expanded: false }];
	while (pending.length > 0) {
		const top = pending.pop()!;
		if (top.expanded) {
			postOrder.push(top.id);
			continue;
		}
		if (expanded.has(top.id)) continue; // residual cycle: skip instead of looping
		expanded.add(top.id);
		pending.push({ id: top.id, expanded: true });
		// Pushed in reverse so the left-to-right sibling order survives the LIFO pop.
		const kids = childrenOf.get(top.id) ?? [];
		for (let i = kids.length - 1; i >= 0; i--) pending.push({ id: kids[i]!, expanded: false });
	}
	for (const id of postOrder) {
		const kids = childrenOf.get(id) ?? [];
		if (kids.length === 0) {
			slotOf.set(id, leafCount++);
			continue;
		}
		let first = Number.POSITIVE_INFINITY;
		let last = Number.NEGATIVE_INFINITY;
		for (const kid of kids) {
			const slot = slotOf.get(kid) ?? 0;
			first = Math.min(first, slot);
			last = Math.max(last, slot);
		}
		slotOf.set(id, (first + last) / 2);
	}

	const rowPitch = DAG_NODE_HEIGHT + DAG_GAP_Y;
	const colPitch = DAG_NODE_WIDTH + DAG_GAP_X;
	const nodes: DagNode[] = [
		{
			id: MAIN_NODE_ID,
			agent: null,
			depth: 0,
			x: DAG_PAD,
			y: DAG_PAD + (slotOf.get(MAIN_NODE_ID) ?? 0) * rowPitch,
		},
	];
	let maxDepth = 0;
	for (const agent of sorted) {
		const depth = depthOf.get(agent.id) ?? 1;
		maxDepth = Math.max(maxDepth, depth);
		nodes.push({
			id: agent.id,
			agent,
			depth,
			x: DAG_PAD + depth * colPitch,
			y: DAG_PAD + (slotOf.get(agent.id) ?? 0) * rowPitch,
		});
	}

	const nodeById = new Map<string, DagNode>();
	for (const node of nodes) nodeById.set(node.id, node);
	const edges: DagEdge[] = [];
	for (const node of nodes) {
		if (node.id === MAIN_NODE_ID) continue;
		const parentId = parentOf.get(node.id) ?? MAIN_NODE_ID;
		const parent = nodeById.get(parentId);
		if (!parent) continue;
		edges.push({
			id: `${parentId}->${node.id}`,
			parentId,
			childId: node.id,
			x1: parent.x + DAG_NODE_WIDTH,
			y1: parent.y + DAG_NODE_HEIGHT / 2,
			x2: node.x,
			y2: node.y + DAG_NODE_HEIGHT / 2,
		});
	}

	return {
		nodes,
		edges,
		width: DAG_PAD * 2 + maxDepth * colPitch + DAG_NODE_WIDTH,
		height: DAG_PAD * 2 + Math.max(1, leafCount) * rowPitch - DAG_GAP_Y,
		unresolved,
	};
}

export interface SubagentListRow {
	agent: SubagentSnapshot;
	depth: number;
}

/** Pre-order list projection of the same resolved spawn graph used by the DAG. */
export function buildSubagentList(
	agents: SubagentSnapshot[],
	rootToolCallIds: ReadonlySet<string>,
	toolCallOwners: ReadonlyMap<string, string>,
): SubagentListRow[] {
	const layout = buildSubagentDag(agents, rootToolCallIds, toolCallOwners);
	const agentById = new Map(agents.map(agent => [agent.id, agent]));
	const depthById = new Map(layout.nodes.map(node => [node.id, node.depth]));
	const children = new Map<string, string[]>();
	for (const edge of layout.edges) {
		const ids = children.get(edge.parentId);
		if (ids) ids.push(edge.childId);
		else children.set(edge.parentId, [edge.childId]);
	}
	for (const ids of children.values()) {
		ids.sort((a, b) => (agentById.get(a)?.index ?? 0) - (agentById.get(b)?.index ?? 0));
	}

	const rows: SubagentListRow[] = [];
	const visited = new Set<string>();
	const visit = (parentId: string): void => {
		for (const id of children.get(parentId) ?? []) {
			if (visited.has(id)) continue;
			visited.add(id);
			const agent = agentById.get(id);
			if (agent) rows.push({ agent, depth: Math.max(0, (depthById.get(id) ?? 1) - 1) });
			visit(id);
		}
	};
	visit(MAIN_NODE_ID);
	return rows;
}
