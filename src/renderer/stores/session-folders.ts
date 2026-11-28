import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionTab } from "./tabs";

export const DEFAULT_FOLDER = "default";

export interface SessionFolder {
	id: string;
	name: string;
	parentId: string;
	sessions: string[];
}

interface FolderView {
	order: string[];
	focused: string | null;
}

interface FolderData {
	active: string;
	folders: SessionFolder[];
	views: Record<string, FolderView>;
	hidden: string[];
}

interface FolderStore extends FolderData {
	select: (id: string) => void;
	createFolder: (name: string, parentId: string) => string | null;
	rename: (id: string, name: string) => void;
	deleteFolder: (id: string) => void;
	add: (paths: string[], ids: string[]) => void;
	remove: (path: string, id: string) => void;
	show: (id: string, key: string, focus?: boolean) => void;
	hide: (id: string, key: string) => void;
	focus: (id: string, key: string) => void;
	order: (id: string, keys: string[]) => void;
	rebind: (before: string, after: string, replaceMembership: boolean) => void;
}

const storageKey = "omp.sessionFolders.v1";
const activeKey = `${storageKey}.active`;
const emptyFolderData: FolderData = { active: DEFAULT_FOLDER, folders: [], views: {}, hidden: [] };
const emptyView: FolderView = { order: [], focused: null };

function windowFolder(): string | null {
	try {
		return sessionStorage.getItem(activeKey);
	} catch {
		return null;
	}
}

function rememberWindowFolder(id: string): void {
	try {
		sessionStorage.setItem(activeKey, id);
	} catch {
		return;
	}
}

export function tabFolderKey(tab: SessionTab): string {
	return tab.sessionPath ?? tab.pendingSessionPath ?? `tab:${tab.folderTabId ?? tab.id}`;
}

const membershipCache = new WeakMap<SessionFolder[], Map<string, string[]>>();

export function folderMembership(folders: SessionFolder[]): ReadonlyMap<string, string[]> {
	const cached = membershipCache.get(folders);
	if (cached) return cached;
	const index = new Map<string, string[]>();
	for (const folder of folders) {
		for (const session of folder.sessions) {
			const ids = index.get(session) ?? [];
			ids.push(folder.id);
			index.set(session, ids);
		}
	}
	membershipCache.set(folders, index);
	return index;
}

export function orderedFolders(folders: SessionFolder[]): { folder: SessionFolder; depth: number; path: string }[] {
	const children = new Map<string, SessionFolder[]>();
	for (const folder of folders) {
		const siblings = children.get(folder.parentId) ?? [];
		siblings.push(folder);
		children.set(folder.parentId, siblings);
	}
	const ordered: { folder: SessionFolder; depth: number; path: string }[] = [];
	const visited = new Set<string>();
	const append = (parent: string, depth: number, prefix: string) => {
		for (const folder of children.get(parent) ?? []) {
			if (visited.has(folder.id)) continue;
			visited.add(folder.id);
			const path = prefix ? `${prefix} / ${folder.name}` : folder.name;
			ordered.push({ folder, depth, path });
			append(folder.id, depth + 1, path);
		}
	};
	append(DEFAULT_FOLDER, 0, "");
	return ordered;
}

export function folderTabs(tabs: SessionTab[], state: FolderData, id = state.active): SessionTab[] {
	if (state.folders.length === 0) return tabs;
	const membership = folderMembership(state.folders);
	const byKey = new Map(tabs.map(tab => [tabFolderKey(tab), tab]));
	const hidden = new Set(state.hidden);
	const belongs = (key: string) =>
		id === DEFAULT_FOLDER ? !membership.has(key) && !hidden.has(key) : membership.get(key)?.includes(id);
	const ordered: SessionTab[] = [];
	for (const key of state.views[id]?.order ?? []) {
		const tab = byKey.get(key);
		if (!tab || !belongs(key)) continue;
		ordered.push(tab);
		byKey.delete(key);
	}
	if (id === DEFAULT_FOLDER) {
		for (const [key, tab] of byKey) if (belongs(key)) ordered.push(tab);
	}
	return ordered;
}

function removeFromView(view: FolderView, key: string): FolderView {
	return { order: view.order.filter(item => item !== key), focused: view.focused === key ? null : view.focused };
}

export const useSessionFolders = create<FolderStore>()(
	persist(
		(set, get) => ({
			...emptyFolderData,
			select: id => {
				const active = get().folders.some(folder => folder.id === id) ? id : DEFAULT_FOLDER;
				rememberWindowFolder(active);
				if (get().active !== active) set({ active });
			},
			createFolder: (name, parentId) => {
				const clean = name.trim();
				if (!clean) return null;
				const id = crypto.randomUUID();
				set(state => ({
					folders: [...state.folders, { id, name: clean, parentId, sessions: [] }],
				}));
				return id;
			},
			rename: (id, name) => {
				const clean = name.trim();
				if (!clean) return;
				set(state => ({
					folders: state.folders.map(folder => (folder.id === id ? { ...folder, name: clean } : folder)),
				}));
			},
			deleteFolder: id => {
				const state = get();
				const removed = new Set([id]);
				for (const { folder } of orderedFolders(state.folders)) {
					if (removed.has(folder.parentId)) removed.add(folder.id);
				}
				const folders = state.folders.filter(folder => !removed.has(folder.id));
				const views = Object.fromEntries(Object.entries(state.views).filter(([key]) => !removed.has(key)));
				const parent = state.folders.find(folder => folder.id === id)?.parentId ?? DEFAULT_FOLDER;
				const active = removed.has(state.active) ? parent : state.active;
				rememberWindowFolder(active);
				set({ folders, views, active });
			},
			add: (paths, ids) => {
				const targets = new Set(ids);
				set(state => ({
					folders: state.folders.map(folder =>
						targets.has(folder.id)
							? { ...folder, sessions: [...new Set([...folder.sessions, ...paths])] }
							: folder,
					),
					hidden: state.hidden.filter(path => !paths.includes(path)),
				}));
			},
			remove: (path, id) =>
				set(state => ({
					folders: state.folders.map(folder =>
						folder.id === id
							? { ...folder, sessions: folder.sessions.filter(session => session !== path) }
							: folder,
					),
					views: { ...state.views, [id]: removeFromView(state.views[id] ?? emptyView, path) },
				})),
			show: (id, key, focus = true) =>
				set(state => {
					const view = state.views[id] ?? emptyView;
					const order = view.order.includes(key) ? view.order : [...view.order, key];
					return {
						views: { ...state.views, [id]: { order, focused: focus ? key : view.focused } },
						hidden: id === DEFAULT_FOLDER ? state.hidden.filter(item => item !== key) : state.hidden,
					};
				}),
			hide: (id, key) =>
				set(state => ({
					views: { ...state.views, [id]: removeFromView(state.views[id] ?? emptyView, key) },
					hidden: id === DEFAULT_FOLDER ? [...new Set([...state.hidden, key])] : state.hidden,
				})),
			focus: (id, key) => {
				const view = get().views[id] ?? emptyView;
				if (view.focused !== key) set(state => ({ views: { ...state.views, [id]: { ...view, focused: key } } }));
			},
			order: (id, keys) =>
				set(state => ({
					views: { ...state.views, [id]: { ...(state.views[id] ?? emptyView), order: keys } },
				})),
			rebind: (before, after, replaceMembership) => {
				const state = get();
				if (
					!state.hidden.includes(before) &&
					!folderMembership(state.folders).has(before) &&
					!Object.values(state.views).some(view => view.order.includes(before) || view.focused === before)
				)
					return;
				const replace = (keys: string[]) => [...new Set(keys.map(key => (key === before ? after : key)))];
				const folders = state.folders.map(folder =>
					folder.sessions.includes(before) && replaceMembership
						? { ...folder, sessions: replace(folder.sessions) }
						: folder,
				);
				const views = Object.fromEntries(
					Object.entries(state.views).map(([id, view]) => [
						id,
						{
							order: replace(view.order),
							focused: view.focused === before ? after : view.focused,
						},
					]),
				);
				set({ folders, views, hidden: replace(state.hidden) });
			},
		}),
		{
			name: storageKey,
			partialize: ({ active, folders, views, hidden }) => ({ active, folders, views, hidden }),
			merge: (persisted, current) => {
				if (!persisted) return current;
				const data = persisted as FolderData;
				const preferred = windowFolder() ?? data.active;
				const active = data.folders.some(folder => folder.id === preferred) ? preferred : DEFAULT_FOLDER;
				return { ...current, ...data, active };
			},
		},
	),
);

export function syncSessionFolders(refreshView: () => void): () => void {
	rememberWindowFolder(useSessionFolders.getState().active);
	const sync = (event: StorageEvent) => {
		if (event.key !== storageKey) return;
		void Promise.resolve(useSessionFolders.persist?.rehydrate()).then(refreshView);
	};
	window.addEventListener("storage", sync);
	return () => window.removeEventListener("storage", sync);
}
