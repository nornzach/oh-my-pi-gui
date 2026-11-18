/**
 * Pure view-model helpers for the Memory window: what the status line says,
 * how sessions group in Sources, and which projects the picker offers.
 */
import type { SessionInfo } from "../../../shared/ipc-types";
import type { RpcMemoryOverview, RpcMemorySource } from "../../../shared/rpc-types";

/** What the window's status line reports, most urgent first. */
export type MemoryStatus =
	| { kind: "off" }
	| { kind: "reading"; done: number; total: number; elsewhere: boolean }
	| { kind: "consolidating"; elsewhere: boolean }
	| { kind: "failed"; error: string }
	| { kind: "empty"; ready: number }
	| { kind: "current"; sessions: number; updatedAt?: number; ready: number };

export function memoryStatus(overview: RpcMemoryOverview): MemoryStatus {
	if (!overview.enabled) return { kind: "off" };
	const activity = overview.activity;
	if (activity?.phase === "reading") {
		return { kind: "reading", done: activity.done, total: activity.total, elsewhere: activity.elsewhere };
	}
	if (activity) return { kind: "consolidating", elsewhere: activity.elsewhere };
	if (overview.consolidation.error) return { kind: "failed", error: overview.consolidation.error };
	const groups = groupSources(overview.sources);
	const ready = groups.pending.filter(source => source.state === "queued").length;
	if (groups.remembered.length === 0 && !overview.summary) return { kind: "empty", ready };
	return {
		kind: "current",
		sessions: groups.remembered.length,
		updatedAt: overview.consolidation.updatedAt,
		ready,
	};
}

export interface SourceGroups {
	/** Sessions memory is built from. */
	remembered: RpcMemorySource[];
	/** Not read yet: ready, still active, being read, or failed. */
	pending: RpcMemorySource[];
	nothing: RpcMemorySource[];
	forgotten: RpcMemorySource[];
	/** Too old to be read; only counted. */
	old: number;
}

const PENDING_ORDER: Record<string, number> = { reading: 0, failed: 1, queued: 2, waiting: 3 };

export function groupSources(sources: readonly RpcMemorySource[]): SourceGroups {
	const groups: SourceGroups = { remembered: [], pending: [], nothing: [], forgotten: [], old: 0 };
	for (const source of sources) {
		switch (source.state) {
			case "remembered":
				groups.remembered.push(source);
				break;
			case "nothing":
				groups.nothing.push(source);
				break;
			case "forgotten":
				groups.forgotten.push(source);
				break;
			case "old":
				groups.old += 1;
				break;
			default:
				groups.pending.push(source);
		}
	}
	// Work in progress and problems first, then what reads next, then what waits.
	groups.pending.sort(
		(a, b) => (PENDING_ORDER[a.state] ?? 9) - (PENDING_ORDER[b.state] ?? 9) || b.updatedAt - a.updatedAt,
	);
	groups.forgotten.sort((a, b) => (b.forgottenAt ?? 0) - (a.forgottenAt ?? 0));
	return groups;
}

/** The title a source shows: the sidebar's own title for that file, else the session's header title. */
export function sourceTitle(source: RpcMemorySource, byPath: ReadonlyMap<string, SessionInfo>): string | undefined {
	const session = source.sessionPath ? byPath.get(source.sessionPath) : undefined;
	const title = session?.title?.trim() || source.title?.trim() || session?.firstMessage?.trim();
	return title ? title.replace(/\s+/g, " ") : undefined;
}

export interface MemoryProjectOption {
	cwd: string;
	label: string;
	/** Most recent session activity, ms since epoch. */
	lastUsed: number;
}

/**
 * Projects the picker offers: every folder with agent sessions, most recent
 * first, named the way the sidebar names them. The current project is always
 * offered, even before its first session.
 */
export function memoryProjects(
	sessions: readonly SessionInfo[],
	options: {
		current: string | null;
		aliases: Readonly<Record<string, string>>;
		registered?: readonly string[];
		workCwd: string | null;
		workLabel: string;
	},
): MemoryProjectOption[] {
	const byCwd = new Map<string, number>();
	for (const session of sessions) {
		if (session.kind === "chat" || !session.cwd) continue;
		const modified = Date.parse(session.modified) || 0;
		byCwd.set(session.cwd, Math.max(byCwd.get(session.cwd) ?? 0, modified));
	}
	for (const cwd of options.registered ?? []) {
		if (cwd && !byCwd.has(cwd)) byCwd.set(cwd, 0);
	}
	if (options.current && !byCwd.has(options.current)) byCwd.set(options.current, Date.now());
	const label = (cwd: string) =>
		cwd === options.workCwd
			? options.workLabel
			: options.aliases[cwd] || cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd;
	return [...byCwd.entries()]
		.map(([cwd, lastUsed]) => ({ cwd, label: label(cwd), lastUsed }))
		.sort((a, b) => b.lastUsed - a.lastUsed);
}

/** "1.2k" style token count. */
export function compactTokens(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	const thousands = tokens / 1000;
	return `${thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
}
