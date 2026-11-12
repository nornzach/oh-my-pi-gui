/**
 * Session search ranking, shared by the session picker and the sidebar.
 * Mirrors the TUI session-selector (`rankSessionSearchMatches`): multi-token
 * queries, literal substring matches first (recency/alpha order), then
 * subsequence fuzzy matches ranked by score. Full-transcript hits from the
 * main-process content grep are merged in after metadata matches.
 */

import type { SessionInfo } from "../../shared/ipc-types";

/** Subsequence fuzzy score; null = no match. Consecutive letters score double, so denser matches win. */
export function fuzzyScore(query: string, target: string): number | null {
	const q = query.toLowerCase();
	const t = target.toLowerCase();
	if (q.length === 0) return 0;
	let qi = 0;
	let score = 0;
	let last = -2;
	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) {
			score += ti === last + 1 ? 2 : 1;
			last = ti;
			qi++;
		}
	}
	return qi === q.length ? score : null;
}

export type SessionSortMode = "recent" | "alpha";

/** Lowercased per-session haystack, built once per listing via WeakMap. */
const haystacks = new WeakMap<SessionInfo, string>();

function haystack(session: SessionInfo): string {
	let text = haystacks.get(session);
	if (text === undefined) {
		text = `${session.title ?? ""} ${session.firstMessage} ${session.cwd} ${session.id}`.toLowerCase();
		haystacks.set(session, text);
	}
	return text;
}

function compareRecency(a: SessionInfo, b: SessionInfo): number {
	return Date.parse(b.modified) - Date.parse(a.modified);
}

function compareAlpha(a: SessionInfo, b: SessionInfo): number {
	return (
		(a.title ?? a.firstMessage).localeCompare(b.title ?? b.firstMessage, undefined, { sensitivity: "base" }) ||
		compareRecency(a, b)
	);
}

/**
 * Filter and rank sessions for a query. Literal matches (every token present
 * verbatim) rank purely by the active sort; pure fuzzy/acronym matches follow,
 * ranked by score. An empty query returns the full list in sort order.
 */
export function rankSessions(sessions: SessionInfo[], query: string, sort: SessionSortMode = "recent"): SessionInfo[] {
	const tiebreak = sort === "alpha" ? compareAlpha : compareRecency;
	const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return [...sessions].sort(tiebreak);

	const literal: { session: SessionInfo; index: number }[] = [];
	const fuzzy: { session: SessionInfo; score: number; index: number }[] = [];
	sessions.forEach((session, index) => {
		const text = haystack(session);
		if (tokens.every(token => text.includes(token))) {
			literal.push({ session, index });
			return;
		}
		let score = 0;
		for (const token of tokens) {
			const tokenScore = fuzzyScore(token, text);
			if (tokenScore === null) return;
			score += tokenScore;
		}
		fuzzy.push({ session, score, index });
	});

	literal.sort((a, b) => tiebreak(a.session, b.session) || a.index - b.index);
	fuzzy.sort((a, b) => b.score - a.score || tiebreak(a.session, b.session) || a.index - b.index);
	return [...literal.map(match => match.session), ...fuzzy.map(match => match.session)];
}

/**
 * Append full-transcript content hits after the metadata-ranked matches.
 * Content hit paths come from the main-process `sessions:search` grep; a
 * session already matched on metadata is never duplicated.
 */
export function mergeContentMatches(
	ranked: SessionInfo[],
	sessions: SessionInfo[],
	contentPaths: ReadonlySet<string>,
): SessionInfo[] {
	if (contentPaths.size === 0) return ranked;
	const seen = new Set(ranked.map(session => session.path));
	const extra = sessions.filter(session => contentPaths.has(session.path) && !seen.has(session.path));
	return extra.length === 0 ? ranked : [...ranked, ...extra];
}
