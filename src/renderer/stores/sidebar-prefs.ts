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
	registeredWorkspaces?: string[];
	pinnedGroups?: string[];
	pinnedSessions?: string[];
	/** Pinned top-left navigation item ids in display order; absent/null = built-in defaults (#67). */
	pinnedNavIds?: string[] | null;
	archivedSessions?: string[];
	groupAliases?: Record<string, string>;
	workspaceLastUsed?: Record<string, number>;
	sessionLastUsed?: Record<string, number>;
	workspaceSort?: WorkspaceSort;
}

/** How the Recent section orders workspace groups; pinned groups stay first either way (#55). */
export type WorkspaceSort = "recent" | "name";

interface SidebarPrefsStore {
	registeredWorkspaces: string[];
	pinnedGroups: string[];
	pinnedSessions: string[];
	/** Pinned top-left navigation ids; null uses the built-in default split (#67). */
	pinnedNavIds: string[] | null;
	/** Session files hidden from the lanes and listed under "Archived". */
	archivedSessions: string[];
	groupAliases: Record<string, string>;
	workspaceLastUsed: Record<string, number>;
	sessionLastUsed: Record<string, number>;
	workspaceSort: WorkspaceSort;
	hydrated: boolean;
	hydrate: () => Promise<void>;
	addWorkspace: (cwd: string) => Promise<void>;
	toggleGroupPin: (cwd: string) => Promise<void>;
	toggleSessionPin: (path: string) => Promise<void>;
	setSessionsArchived: (paths: readonly string[], archived: boolean) => Promise<void>;
	/** Drop deleted session files from the pinned and archived lists. */
	forgetSessions: (paths: readonly string[]) => void;
	/** Move pins and archive marks from files no longer listed to the sessions that carry them on. */
	inheritSessions: (heirs: ReadonlyMap<string, string>) => void;
	setGroupAlias: (cwd: string, alias: string | null) => Promise<void>;
	setWorkspaceSort: (sort: WorkspaceSort) => Promise<void>;
	setPinnedNavIds: (ids: string[] | null) => Promise<void>;
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
		registeredWorkspaces: state.registeredWorkspaces,
		pinnedGroups: state.pinnedGroups,
		pinnedSessions: state.pinnedSessions,
		...(state.pinnedNavIds !== null ? { pinnedNavIds: state.pinnedNavIds } : {}),
		archivedSessions: state.archivedSessions,
		groupAliases: state.groupAliases,
		workspaceLastUsed: state.workspaceLastUsed,
		sessionLastUsed: state.sessionLastUsed,
		workspaceSort: state.workspaceSort,
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
	registeredWorkspaces: [],
	pinnedGroups: [],
	pinnedSessions: [],
	pinnedNavIds: null,
	archivedSessions: [],
	groupAliases: {},
	workspaceLastUsed: {},
	sessionLastUsed: {},
	workspaceSort: "recent",
	hydrated: false,

	hydrate: async () => {
		if (get().hydrated) return;
		try {
			const blob = (await window.omp.prefs.get(PREFS_KEY)) as SidebarPrefsBlob | null | undefined;
			set({
				registeredWorkspaces: Array.isArray(blob?.registeredWorkspaces)
					? [...new Set(blob.registeredWorkspaces.filter(path => typeof path === "string" && path.length > 0))]
					: [],
				pinnedGroups: Array.isArray(blob?.pinnedGroups) ? blob.pinnedGroups : [],
				pinnedSessions: Array.isArray(blob?.pinnedSessions) ? blob.pinnedSessions : [],
				pinnedNavIds: Array.isArray(blob?.pinnedNavIds)
					? [...new Set(blob.pinnedNavIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
					: null,
				archivedSessions: Array.isArray(blob?.archivedSessions) ? blob.archivedSessions : [],
				groupAliases: blob?.groupAliases && typeof blob.groupAliases === "object" ? blob.groupAliases : {},
				workspaceLastUsed: validRecencyMap(blob?.workspaceLastUsed),
				sessionLastUsed: validRecencyMap(blob?.sessionLastUsed),
				workspaceSort: blob?.workspaceSort === "name" ? "name" : "recent",
				hydrated: true,
			});
		} catch {
			set({ hydrated: true });
		}
	},

	addWorkspace: async cwd => {
		if (!cwd || get().registeredWorkspaces.includes(cwd)) return;
		await optimisticWrite({
			store: { getState: get, setState: set },
			mutate: state => ({ registeredWorkspaces: [...state.registeredWorkspaces, cwd] }),
			persist: () => writePrefs(get),
			onFailure: message => toast({ variant: "error", title: translate("titlebar.openProjectFailed"), message }),
		});
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

	setWorkspaceSort: sort =>
		optimisticWrite({
			store: { getState: get, setState: set },
			mutate: () => ({ workspaceSort: sort }),
			persist: () => writePrefs(get),
			onFailure: message => toast({ variant: "error", title: translate("sidebar.sort.failed"), message }),
		}),

	setPinnedNavIds: ids =>
		optimisticWrite({
			store: { getState: get, setState: set },
			mutate: () => ({ pinnedNavIds: ids }),
			persist: () => writePrefs(get),
			onFailure: message => toast({ variant: "error", title: translate("sidebar.pinFailed"), message }),
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
			registeredWorkspaces: [],
			pinnedGroups: [],
			pinnedSessions: [],
			pinnedNavIds: null,
			archivedSessions: [],
			groupAliases: {},
			workspaceLastUsed: {},
			sessionLastUsed: {},
			workspaceSort: "recent",
			hydrated: false,
		}),
}));
