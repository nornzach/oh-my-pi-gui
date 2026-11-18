import { create } from "zustand";
import { HTML_DOCUMENT, TABLE_DOCUMENT } from "../../../shared/document-preview";

const ABSOLUTE_PATH = /^(?:[A-Za-z]:)?\//;
export const isMarkdownFile = (path: string): boolean => /\.mdx?$/i.test(path);
export const hasFormattedPreview = (path: string): boolean =>
	isMarkdownFile(path) || HTML_DOCUMENT.test(path) || TABLE_DOCUMENT.test(path);

export function projectRelativeFile(cwd: string, file: string): string | null {
	const path = file.replace(/\\/g, "/");
	const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	const relative = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
	if (ABSOLUTE_PATH.test(relative) || relative.startsWith("~/")) return null;
	const parts: string[] = [];
	for (const part of relative.split("/")) {
		if (!part || part === ".") continue;
		if (part !== "..") parts.push(part);
		else if (parts.length) parts.pop();
		else return null;
	}
	return parts.join("/");
}

export type FileView = "source" | "preview";
export interface WorkspaceFileTab {
	id: string;
	path: string;
	line: number | null;
	lineRequest?: number;
	view: FileView;
}

interface WorkspaceFiles {
	tabs: WorkspaceFileTab[];
	activeId: string | null;
}

export const EMPTY_FILE_TABS: WorkspaceFiles = { tabs: [], activeId: null };
interface FileTabsStore {
	workspaces: ReadonlyMap<string, WorkspaceFiles>;
	open(cwd: string, path: string, line: number | null, request: number): void;
	remove(cwd: string, id: string): void;
	changeView(cwd: string, id: string, view: FileView): void;
}

export const useFileTabs = create<FileTabsStore>()(set => {
	const update = (cwd: string, change: (workspace: WorkspaceFiles) => WorkspaceFiles) =>
		set(state => {
			const current = state.workspaces.get(cwd) ?? EMPTY_FILE_TABS;
			const next = change(current);
			if (current === next) return state;
			const workspaces = new Map(state.workspaces);
			if (next.tabs.length) workspaces.set(cwd, next);
			else workspaces.delete(cwd);
			return { workspaces };
		});
	return {
		workspaces: new Map(),
		open: (cwd, path, line, request) =>
			update(cwd, workspace => {
				const id = JSON.stringify([cwd, projectRelativeFile(cwd, path) ?? path]);
				const existing = workspace.tabs.find(tab => tab.id === id);
				if (!existing) {
					const view = line === null && hasFormattedPreview(path) ? "preview" : "source";
					return { activeId: id, tabs: [...workspace.tabs, { id, path, line, lineRequest: request, view }] };
				}
				if (line === null && workspace.activeId === id) return workspace;
				return {
					activeId: id,
					tabs:
						line === null
							? workspace.tabs
							: workspace.tabs.map(tab =>
									tab.id === id ? { ...tab, line, lineRequest: request, view: "source" } : tab,
								),
				};
			}),
		remove: (cwd, id) =>
			update(cwd, workspace => {
				const index = workspace.tabs.findIndex(tab => tab.id === id);
				if (index === -1) return workspace;
				const tabs = workspace.tabs.filter(tab => tab.id !== id);
				const activeId =
					workspace.activeId === id ? (tabs[index]?.id ?? tabs[index - 1]?.id ?? null) : workspace.activeId;
				return { tabs, activeId };
			}),
		changeView: (cwd, id, view) =>
			update(cwd, workspace => ({
				...workspace,
				tabs: workspace.tabs.map(tab => (tab.id === id ? { ...tab, view } : tab)),
			})),
	};
});
