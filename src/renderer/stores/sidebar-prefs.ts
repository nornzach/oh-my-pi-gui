/**
 * Sidebar presentation prefs: pinned workspaces/sessions, archived sessions,
 * explicit MRU access times, and workspace display aliases (rename). Persisted as one JSON blob
 * under the "sidebar" prefs key via window.omp.prefs (electron-store in main);
 * hydrate once at App mount. Recency bookkeeping writes fire-and-forget; the
 * pins, archive and aliases the user can SEE are optimistic writes that roll back when
 * the persist rejects, so a row never stays pinned across a restart.
 */
import { create } from "zustand";
import { describeError } from "../lib/errors";
import { translate } from "../lib/i18n";
import { optimisticWrite } from "../lib/optimistic";
import { toast } from "./toast";

const PREFS_KEY = "sidebar";

interface SidebarPrefsBlob {
	pinnedGroups?: string[];
	pinnedSessions?: string[];
	archivedSessions?: string[];
	groupAliases?: Record<string, string>;
	workspaceLastUsed?: Record<string, number>;
	sessionLastUsed?: Record<string, number>;
}

interface SidebarPrefsStore {
	pinnedGroups: string[];
	pinnedSessions: string[];
	/** Session files hidden from the lanes and listed under "Archived". */
	archivedSessions: string[];
	groupAliases: Record<string, string>;
	workspaceLastUsed: Record<string, number>;
	sessionLastUsed: Record<string, number>;
	hydrated: boolean;
	hydrate: () => Promise<void>;
	toggleGroupPin: (cwd: string) => Promise<void>;
	toggleSessionPin: (path: string) => Promise<void>;
	setSessionsArchived: (paths: readonly string[], archived: boolean) => Promise<void>;
	/** Drop deleted session files from the pinned and archived lists. */
	forgetSessions: (paths: readonly string[]) => void;
	/** Move pins and archive marks from files no longer listed to the sessions that carry them on. */
	inheritSessions: (heirs: ReadonlyMap<string, string>) => void;
	setGroupAlias: (cwd: string, alias: string | null) => Promise<void>;
	touchWorkspace: (cwd: string) => void;
	touchSession: (path: string, cwd?: string) => void;
	reset: () => void;
}

const MAX_RECENT_WORKSPACES = 100;
const MAX_RECENT_SESSIONS = 500;

function validRecencyMap(value: unknown): Record<string, number> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const result: Record<string, number> = {};
	for (const [key, timestamp] of Object.entries(value)) {
		if (key && typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0) {
			result[key] = timestamp;
		}
	}
	return result;
}

function nextTimestamp(...maps: Record<string, number>[]): number {
	let latest = 0;
	for (const map of maps) {
		for (const value of Object.values(map)) latest = Math.max(latest, value);
	}
	return Math.max(Date.now(), latest + 1);
}

function touchedMap(
	current: Record<string, number>,
	key: string,
	timestamp: number,
	limit: number,
): Record<string, number> {
	const entries = Object.entries({ ...current, [key]: timestamp }).sort((a, b) => b[1] - a[1]);
	return Object.fromEntries(entries.slice(0, limit));
}

function prefsBlob(state: SidebarPrefsStore): SidebarPrefsBlob {
	return {
		pinnedGroups: state.pinnedGroups,
		pinnedSessions: state.pinnedSessions,
		archivedSessions: state.archivedSessions,
		groupAliases: state.groupAliases,
		workspaceLastUsed: state.workspaceLastUsed,
		sessionLastUsed: state.sessionLastUsed,
	};
}

/** Recency bookkeeping: a lost write costs an ordering hint, nothing the user
 *  set out to do, so it stays fire-and-forget. */
function persist(get: () => SidebarPrefsStore): void {
	void writePrefs(get);
}

async function writePrefs(get: () => SidebarPrefsStore): Promise<{ success: boolean; error?: string }> {
	try {
		await window.omp.prefs.set(PREFS_KEY, prefsBlob(get()));
		return { success: true };
	} catch (cause) {
		return { success: false, error: describeError(cause) };
	}
}

export const useSidebarPrefs = create<SidebarPrefsStore>()((set, get) => ({
	pinnedGroups: [],
	pinnedSessions: [],
	archivedSessions: [],
	groupAliases: {},
	workspaceLastUsed: {},
	sessionLastUsed: {},
	hydrated: false,

	hydrate: async () => {
		if (get().hydrated) return;
		try {
			const blob = (await window.omp.prefs.get(PREFS_KEY)) as SidebarPrefsBlob | null | undefined;
			set({
				pinnedGroups: Array.isArray(blob?.pinnedGroups) ? blob.pinnedGroups : [],
				pinnedSessions: Array.isArray(blob?.pinnedSessions) ? blob.pinnedSessions : [],
				archivedSessions: Array.isArray(blob?.archivedSessions) ? blob.archivedSessions : [],
				groupAliases: blob?.groupAliases && typeof blob.groupAliases === "object" ? blob.groupAliases : {},
				workspaceLastUsed: validRecencyMap(blob?.workspaceLastUsed),
				sessionLastUsed: validRecencyMap(blob?.sessionLastUsed),
				hydrated: true,
			});
		} catch {
			set({ hydrated: true });
		}
	},

	toggleGroupPin: cwd =>
		optimisticWrite({
			store: { getState: get, setState: set },
			mutate: state => ({
				pinnedGroups: state.pinnedGroups.includes(cwd)
					? state.pinnedGroups.filter(item => item !== cwd)
					: [...state.pinnedGroups, cwd],
			}),
			persist: () => writePrefs(get),
			onFailure: message => toast({ variant: "error", title: translate("sidebar.pinFailed"), message }),
		}),

	toggleSessionPin: path =>
		optimisticWrite({
			store: { getState: get, setState: set },
			mutate: state => ({
				pinnedSessions: state.pinnedSessions.includes(path)
					? state.pinnedSessions.filter(item => item !== path)
					: [...state.pinnedSessions, path],
			}),
			persist: () => writePrefs(get),
			onFailure: message => toast({ variant: "error", title: translate("sidebar.pinFailed"), message }),
		}),

	setSessionsArchived: (paths, archived) =>
		optimisticWrite({
			store: { getState: get, setState: set },
			mutate: state => {
				const changed = new Set(paths);
				const rest = state.archivedSessions.filter(path => !changed.has(path));
				return { archivedSessions: archived ? [...rest, ...changed] : rest };
			},
			persist: () => writePrefs(get),
			onFailure: message => toast({ variant: "error", title: translate("sidebar.archiveFailed"), message }),
		}),

	forgetSessions: paths => {
		const gone = new Set(paths);
		const state = get();
		if (!state.pinnedSessions.some(path => gone.has(path)) && !state.archivedSessions.some(path => gone.has(path))) {
			return;
		}
		set({
			pinnedSessions: state.pinnedSessions.filter(path => !gone.has(path)),
			archivedSessions: state.archivedSessions.filter(path => !gone.has(path)),
		});
		persist(get);
	},

	inheritSessions: heirs => {
		const state = get();
		if (
			!state.pinnedSessions.some(path => heirs.has(path)) &&
			!state.archivedSessions.some(path => heirs.has(path))
		) {
			return;
		}
		const inherited = (paths: readonly string[]) => [...new Set(paths.map(path => heirs.get(path) ?? path))];
		set({
			pinnedSessions: inherited(state.pinnedSessions),
			archivedSessions: inherited(state.archivedSessions),
		});
		persist(get);
	},

	setGroupAlias: (cwd, alias) =>
		optimisticWrite({
			store: { getState: get, setState: set },
			mutate: state => {
				const groupAliases = { ...state.groupAliases };
				if (alias?.trim()) groupAliases[cwd] = alias.trim();
				else delete groupAliases[cwd];
				return { groupAliases };
			},
			persist: () => writePrefs(get),
			onFailure: message => toast({ variant: "error", title: translate("sidebar.renameFailed"), message }),
		}),

	touchWorkspace: cwd => {
		if (!cwd) return;
		const state = get();
		const timestamp = nextTimestamp(state.workspaceLastUsed, state.sessionLastUsed);
		set({ workspaceLastUsed: touchedMap(state.workspaceLastUsed, cwd, timestamp, MAX_RECENT_WORKSPACES) });
		persist(get);
	},

	touchSession: (path, cwd) => {
		if (!path) return;
		const state = get();
		const timestamp = nextTimestamp(state.workspaceLastUsed, state.sessionLastUsed);
		set({
			sessionLastUsed: touchedMap(state.sessionLastUsed, path, timestamp, MAX_RECENT_SESSIONS),
			workspaceLastUsed: cwd
				? touchedMap(state.workspaceLastUsed, cwd, timestamp, MAX_RECENT_WORKSPACES)
				: state.workspaceLastUsed,
		});
		persist(get);
	},

	reset: () =>
		set({
			pinnedGroups: [],
			pinnedSessions: [],
			archivedSessions: [],
			groupAliases: {},
			workspaceLastUsed: {},
			sessionLastUsed: {},
			hydrated: false,
		}),
}));
