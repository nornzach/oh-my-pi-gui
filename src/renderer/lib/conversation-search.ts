/**
 * Conversation search (⇧⌘F) outside the dialog: reading match markers out of
 * snippets, the keyboard order of hits, opening a session at a message, and the
 * remembered recent searches.
 */
import type { ConversationHit, ConversationSearchResult, SessionInfo } from "../../shared/ipc-types";
import { requestSessionSwitch } from "../hooks/use-session-switch";
import { useSessionFolders } from "../stores/session-folders";
import { useTabsStore } from "../stores/tabs";
import { useTranscriptFocusStore } from "../stores/transcript-focus";

/** Snippet match delimiters written by the main-process index. */
const MARK_OPEN = "\u0001";
const MARK_CLOSE = "\u0002";
const RECENT_KEY = "omp.conversationSearch.recent";
const RECENT_LIMIT = 6;

export interface SnippetPart {
	text: string;
	match: boolean;
}

/** A snippet split into plain and matching runs; stray markers never reach the screen. */
export function snippetParts(snippet: string): SnippetPart[] {
	const parts: SnippetPart[] = [];
	let match = false;
	let text = "";
	const flush = () => {
		if (text) parts.push({ text, match });
		text = "";
	};
	for (const char of snippet) {
		if (char === MARK_OPEN || char === MARK_CLOSE) {
			flush();
			match = char === MARK_OPEN;
			continue;
		}
		text += char;
	}
	flush();
	return parts;
}

export interface FlatHit {
	result: ConversationSearchResult;
	hit: ConversationHit;
}

/** Hits in on-screen order, which is the arrow-key order. */
export function flattenHits(results: readonly ConversationSearchResult[]): FlatHit[] {
	return results.flatMap(result => result.hits.map(hit => ({ result, hit })));
}

/** Enough of a session for the switch flow, which reads path, id, kind, cwd and title. */
function sessionInfoFor(result: ConversationSearchResult): SessionInfo {
	const modified = new Date(result.modified).toISOString();
	return {
		path: result.path,
		id: result.sessionId,
		title: result.title,
		cwd: result.cwd,
		created: modified,
		modified,
		messageCount: 0,
		size: 0,
		status: "unknown",
		kind: result.kind,
		firstMessage: "",
	};
}

/**
 * Show `hit` in its session: in this tab when the session belongs to the
 * project being worked in, otherwise — or on request — in a tab of its own
 * (an already-open session just comes to the front).
 */
export function openConversationHit(
	{ result, hit }: FlatHit,
	options: { newTab: boolean; currentCwd: string | null; folderId?: string },
): void {
	useTranscriptFocusStore.getState().focus(result.path, hit.entryId);
	if (
		useSessionFolders.getState().folders.length > 0 ||
		options.newTab ||
		!options.currentCwd ||
		options.currentCwd !== result.cwd
	) {
		void useTabsStore.getState().openTab({
			cwd: result.cwd || undefined,
			sessionPath: result.path,
			kind: result.kind ?? "agent",
			...(options.folderId ? { folderId: options.folderId } : {}),
		});
		return;
	}
	requestSessionSwitch(sessionInfoFor(result));
}

export function loadRecentSearches(): string[] {
	try {
		const raw = localStorage.getItem(RECENT_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

/** Most recent first, case-insensitively de-duplicated. */
export function rememberSearch(recent: readonly string[], query: string): string[] {
	const trimmed = query.trim();
	if (!trimmed) return [...recent];
	const next = [trimmed, ...recent.filter(item => item.toLowerCase() !== trimmed.toLowerCase())].slice(
		0,
		RECENT_LIMIT,
	);
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify(next));
	} catch {
		// Storage unavailable — recents are a convenience.
	}
	return next;
}
