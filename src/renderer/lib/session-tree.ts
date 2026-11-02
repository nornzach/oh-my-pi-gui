/**
 * Sidebar session forest. A session header records `parentSession` (a session
 * id or a session file path). Subagent transcripts also live in the artifact
 * directory beside the parent file; the session index points those at the
 * parent path. Either link nests the child under that session. A link that
 * does not name a session in this list, or that would cycle, leaves the
 * session at the root so it stays reachable.
 */

import type { SessionInfo } from "../../shared/ipc-types";

export interface SessionNode {
	session: SessionInfo;
	children: SessionNode[];
}

function pathKey(value: string): string {
	return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

function resolveParent(
	session: SessionInfo,
	byPath: ReadonlyMap<string, SessionInfo>,
	byId: ReadonlyMap<string, SessionInfo>,
): SessionInfo | undefined {
	const raw = session.parentSessionPath?.trim();
	if (!raw) return undefined;
	const parent = byPath.get(pathKey(raw)) ?? byId.get(raw);
	return parent && parent.path !== session.path ? parent : undefined;
}

/**
 * Each session's parent within `sessions`, keyed by session path. A link that
 * would close a cycle is dropped at the session the loop comes back to, which
 * becomes a root with the rest of the loop under it; a session that only
 * leads into the loop keeps its parent.
 */
export function sessionParents(sessions: readonly SessionInfo[]): Map<string, SessionInfo> {
	const byPath = new Map<string, SessionInfo>();
	const byId = new Map<string, SessionInfo>();
	for (const session of sessions) {
		byPath.set(pathKey(session.path), session);
		if (session.id && !byId.has(session.id)) byId.set(session.id, session);
	}

	const parentOf = new Map<string, SessionInfo>();
	for (const session of sessions) {
		const parent = resolveParent(session, byPath, byId);
		if (parent) parentOf.set(session.path, parent);
	}
	for (const session of sessions) {
		const seen = new Set<string>([session.path]);
		let cursor = parentOf.get(session.path);
		while (cursor) {
			if (seen.has(cursor.path)) {
				parentOf.delete(cursor.path);
				break;
			}
			seen.add(cursor.path);
			cursor = parentOf.get(cursor.path);
		}
	}
	return parentOf;
}

/** Roots in input order; each parent's children in the order they were given. */
export function buildSessionTree(sessions: readonly SessionInfo[]): SessionNode[] {
	const parentOf = sessionParents(sessions);

	const childrenOf = new Map<string, SessionInfo[]>();
	const roots: SessionInfo[] = [];
	for (const session of sessions) {
		const parent = parentOf.get(session.path);
		if (!parent) {
			roots.push(session);
			continue;
		}
		const children = childrenOf.get(parent.path);
		if (children) children.push(session);
		else childrenOf.set(parent.path, [session]);
	}

	const nodeFor = (session: SessionInfo): SessionNode => ({
		session,
		children: (childrenOf.get(session.path) ?? []).map(nodeFor),
	});
	return roots.map(nodeFor);
}

/**
 * A subagent transcript lives in its parent's artifact directory
 * (`<name>.jsonl` → `<name>/<agentId>.jsonl`); a fork or continuation of the
 * parent is a session file of its own beside it.
 */
export function isSubagentTranscript(child: SessionInfo, parent: SessionInfo): boolean {
	return insideArtifactDir(child.path, parent.path);
}

/**
 * A subagent transcript, by the parent the session index points it at. Lists
 * of sessions to browse (the resume picker, recent projects) leave these out:
 * the sidebar shows them under their session.
 */
export function isSubagentSession(session: SessionInfo): boolean {
	const parent = session.parentSessionPath?.trim();
	return parent !== undefined && insideArtifactDir(session.path, parent);
}

function insideArtifactDir(childPath: string, parentPath: string): boolean {
	const parent = pathKey(parentPath);
	if (!parent.endsWith(".jsonl")) return false;
	return pathKey(childPath).startsWith(`${parent.slice(0, -".jsonl".length)}/`);
}

export interface SessionRank {
	pinned: (session: SessionInfo) => boolean;
	recency: (session: SessionInfo) => number;
}

/**
 * Roots only: a family is pinned when any member is, and sorts by its newest
 * member, so a subagent that just ran keeps its parent with it at the top.
 * Children keep the order {@link buildSessionTree} recorded.
 */
export function orderSessionForest(nodes: readonly SessionNode[], rank: SessionRank): SessionNode[] {
	const pinned = (node: SessionNode): boolean => rank.pinned(node.session) || node.children.some(pinned);
	const recency = (node: SessionNode): number =>
		node.children.reduce((max, child) => Math.max(max, recency(child)), rank.recency(node.session));
	return [...nodes].sort((a, b) => {
		const pinDelta = (pinned(a) ? 0 : 1) - (pinned(b) ? 0 : 1);
		if (pinDelta !== 0) return pinDelta;
		return recency(b) - recency(a);
	});
}
