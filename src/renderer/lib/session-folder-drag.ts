import type { DragEvent } from "react";
import { folderMembership, tabFolderKey, useSessionFolders } from "../stores/session-folders";
import { useTabsStore } from "../stores/tabs";

export type FolderSource = { paths: string[] } | { tabId: string };

const folderDragType = `application/x-omp-session-folder-${crypto.randomUUID()}`;

export function startFolderDrag(transfer: DataTransfer, source: FolderSource) {
	transfer.effectAllowed = "tabId" in source ? "copyMove" : "copy";
	transfer.setData(folderDragType, JSON.stringify(source));
}

export function allowFolderDrop(event: DragEvent<HTMLElement>) {
	if (!event.dataTransfer.types.includes(folderDragType)) return false;
	event.preventDefault();
	event.stopPropagation();
	event.dataTransfer.dropEffect = "copy";
	return true;
}

export function addFolderReferences(source: FolderSource, targets: string[]) {
	const state = useSessionFolders.getState();
	const ids = targets.filter(id => state.folders.some(folder => folder.id === id));
	if (!ids.length) return;
	const tabs = useTabsStore.getState();
	const tab = "tabId" in source ? tabs.tabs.find(entry => entry.id === source.tabId) : undefined;
	const paths = "paths" in source ? source.paths : tab ? [tabFolderKey(tab)] : [];
	if (!paths.length) return;
	state.add(paths, ids);
	if (tab) {
		for (const id of ids) state.show(id, tabFolderKey(tab), false);
	} else {
		const membership = folderMembership(state.folders);
		for (const open of tabs.tabs) {
			const key = tabFolderKey(open);
			if (paths.includes(key) && !membership.has(key) && !state.hidden.includes(key)) state.show(ids[0], key);
		}
	}
	void tabs.refreshFolderView();
}

export function dropOnFolder(event: DragEvent<HTMLElement>, id: string) {
	if (!allowFolderDrop(event)) return false;
	const source: FolderSource = JSON.parse(event.dataTransfer.getData(folderDragType));
	if ("tabId" in source) window.dispatchEvent(new CustomEvent("omp:tab-drag", { detail: { tabId: null } }));
	addFolderReferences(source, [id]);
	return true;
}
