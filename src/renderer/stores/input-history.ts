import { create } from "zustand";

/**
 * Composer prompt history (GUI counterpart of the TUI's HistoryStorage +
 * `app.history.search` Ctrl+R overlay and Up/Down recall).
 *
 * Every sent composer input — prompts, `!` bash commands, `$` python input,
 * slash commands — is recorded newest-first, capped, and persisted through
 * the prefs IPC channel so history survives restarts. Secret-bearing slash
 * commands (`/login` callbacks, `/join` links, `/mcp add --token …`) are kept
 * in the in-memory session list but never persisted (see shouldSkipHistory).
 */

export interface InputHistoryEntry {
	/** The composer text exactly as sent (sigils included). */
	prompt: string;
	/** Epoch ms when sent; 0 for legacy entries without a timestamp. */
	ts: number;
	/** Working directory at submission; absent on legacy history. */
	cwd?: string;
}

export interface InputHistoryContext {
	cwd: string;
	/** A tab/session pair, so switching composers cannot restore another draft. */
	owner: string;
}

export function workspaceHistory(entries: InputHistoryEntry[], cwd?: string): InputHistoryEntry[] {
	return cwd === undefined ? entries : entries.filter(entry => entry.cwd === cwd);
}

const PREFS_KEY = "inputHistory";
const MAX_ENTRIES = 200;
const DEFAULT_LIMIT = 100;

/** Token-AND filter matching the TUI history search semantics:
 *  every whitespace-separated query token must appear in the prompt. */
export function filterHistory(entries: InputHistoryEntry[], query: string, limit = DEFAULT_LIMIT): InputHistoryEntry[] {
	if (limit <= 0) return [];
	const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return entries.slice(0, limit);
	const matches: InputHistoryEntry[] = [];
	for (const entry of entries) {
		const haystack = entry.prompt.toLowerCase();
		if (tokens.every(token => haystack.includes(token))) {
			matches.push(entry);
			if (matches.length >= limit) break;
		}
	}
	return matches;
}

/**
 * Slash commands that may carry secrets in their arguments should never be
 * persisted to history. Ported from the TUI input-controller's guard.
 *
 * - /login accepts three callback forms (redirect URL, query string, raw auth
 *   code) — all can contain OAuth code=/state= params.
 * - /join <link> carries a 32-byte room key and optional write token.
 * - /mcp add --token <token> carries a bearer token.
 *
 * The command name is extracted the same way as the agent's parseSlashCommand()
 * — splitting on the earliest whitespace or colon — so /login:?code=... is
 * correctly matched.
 */
export function shouldSkipHistory(text: string): boolean {
	if (!text.startsWith("/")) return false;
	const body = text.slice(1);
	// Match parseSlashCommand: split on earliest whitespace or colon.
	const firstWs = body.search(/\s/);
	const firstColon = body.indexOf(":");
	const sep = firstWs === -1 ? firstColon : firstColon === -1 ? firstWs : Math.min(firstWs, firstColon);
	const name = sep === -1 ? body : body.slice(0, sep);
	const hasArgs = sep !== -1;
	// /login <anything> — redirect URLs, query strings (?code=...), and raw
	// auth codes all carry secrets.
	if (name === "login" && hasArgs) return true;
	// /join <link> — the link carries the 32-byte room key and write token.
	if (name === "join" && hasArgs) return true;
	if (name === "mcp") {
		const args = body.slice(sep + 1).trim();
		return args.startsWith("add") && /--token\s/.test(args);
	}
	return false;
}

interface InputHistoryStore {
	/** Newest-first list of sent composer inputs. */
	entries: InputHistoryEntry[];
	/** Whether the initial prefs load has completed. */
	hydrated: boolean;
	/** Up/Down recall position: -1 = not navigating; >= 0 = index into entries. */
	navIndex: number;
	/** Draft stashed when recall began; restored when cycling back down past the newest entry. */
	navDraft: string;
	navContext: InputHistoryContext | undefined;
	/** Load persisted history once. Safe to call on every composer mount. */
	hydrate: () => Promise<void>;
	/** Record a sent input (dedupes against the most recent entry, caps, persists, exits recall).
	 *  Secret-bearing commands are recorded in memory but scrubbed from the persisted prefs. */
	record: (prompt: string, cwd?: string) => void;
	/** Token-AND search over entries, newest first. Empty query returns recent entries. */
	search: (query: string, limit?: number) => InputHistoryEntry[];
	/** Most recent entries, newest first. */
	recent: (limit?: number) => InputHistoryEntry[];
	/** Recall an older entry. `currentDraft` is stashed on the first step so `next` can restore it.
	 *  Returns the text to show, or undefined when history is empty or the oldest entry is reached. */
	prev: (currentDraft: string, context?: InputHistoryContext) => string | undefined;
	/** Recall a newer entry; past the newest entry restores the stashed draft.
	 *  Returns undefined when not navigating. */
	next: (context?: InputHistoryContext) => string | undefined;
	/** Leave recall mode (on send or manual edit). */
	resetNav: () => void;
}

function persist(entries: InputHistoryEntry[]): void {
	// Secret-bearing commands may live in the in-memory session list for
	// recall during this run, but are never written to prefs. Filtering here
	// (rather than in record) also keeps earlier session secrets out of the
	// payload when a later benign input triggers a persist.
	const safe = entries.filter(entry => !shouldSkipHistory(entry.prompt));
	void window.omp.prefs.set(PREFS_KEY, safe).catch(() => {});
}

function parseStored(raw: unknown): InputHistoryEntry[] {
	if (!Array.isArray(raw)) return [];
	const entries: InputHistoryEntry[] = [];
	for (const item of raw) {
		if (entries.length >= MAX_ENTRIES) break;
		if (typeof item === "string") {
			if (item.trim()) entries.push({ prompt: item, ts: 0 });
			continue;
		}
		if (item && typeof item === "object") {
			const candidate = item as { prompt?: unknown; ts?: unknown; cwd?: unknown };
			if (typeof candidate.prompt === "string" && candidate.prompt.trim()) {
				entries.push({
					prompt: candidate.prompt,
					ts: typeof candidate.ts === "number" && Number.isFinite(candidate.ts) ? candidate.ts : 0,
					...(typeof candidate.cwd === "string" ? { cwd: candidate.cwd } : {}),
				});
			}
		}
	}
	return entries;
}

export const useInputHistoryStore = create<InputHistoryStore>()((set, get) => ({
	entries: [],
	hydrated: false,
	navIndex: -1,
	navDraft: "",
	navContext: undefined,

	hydrate: async () => {
		if (get().hydrated) return;
		try {
			const raw = await window.omp.prefs.get(PREFS_KEY);
			const parsed = parseStored(raw);
			// Scrub secrets persisted before the skip guard existed.
			const entries = parsed.filter(entry => !shouldSkipHistory(entry.prompt));
			set({ entries, hydrated: true });
			if (entries.length !== parsed.length) persist(entries);
		} catch {
			set({ hydrated: true });
		}
	},

	record: (prompt, cwd) => {
		const trimmed = prompt.trim();
		if (!trimmed) return;
		const { entries } = get();
		const head = entries[0];
		// Re-sending the same input just refreshes its timestamp instead of duplicating it.
		const entry = { prompt: trimmed, ts: Date.now(), ...(cwd === undefined ? {} : { cwd }) };
		const next =
			head && head.prompt === trimmed && head.cwd === cwd ? [entry, ...entries.slice(1)] : [entry, ...entries];
		if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
		set({ entries: next, navIndex: -1, navDraft: "", navContext: undefined });
		persist(next);
	},

	search: (query, limit) => filterHistory(get().entries, query, limit),

	recent: (limit = DEFAULT_LIMIT) => get().entries.slice(0, limit),

	prev: (currentDraft, context) => {
		const state = get();
		const entries = workspaceHistory(state.entries, context?.cwd);
		const sameContext = state.navContext?.owner === context?.owner && state.navContext?.cwd === context?.cwd;
		const navIndex = sameContext ? state.navIndex : -1;
		const navDraft = sameContext ? state.navDraft : "";
		if (entries.length === 0) return undefined;
		const nextIndex = navIndex + 1;
		if (nextIndex >= entries.length) return undefined;
		set({ navIndex: nextIndex, navDraft: navIndex === -1 ? currentDraft : navDraft, navContext: context });
		return entries[nextIndex].prompt;
	},

	next: context => {
		const { entries: allEntries, navIndex, navDraft, navContext } = get();
		if (navContext?.owner !== context?.owner || navContext?.cwd !== context?.cwd) return undefined;
		const entries = workspaceHistory(allEntries, context?.cwd);
		if (navIndex === -1) return undefined;
		const nextIndex = navIndex - 1;
		if (nextIndex === -1) {
			set({ navIndex: -1, navDraft: "" });
			return navDraft;
		}
		set({ navIndex: nextIndex });
		return entries[nextIndex]?.prompt;
	},

	resetNav: () => {
		if (get().navIndex !== -1 || get().navContext !== undefined) {
			set({ navIndex: -1, navDraft: "", navContext: undefined });
		}
	},
}));
