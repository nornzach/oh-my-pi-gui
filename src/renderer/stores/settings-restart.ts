/**
 * Restart-required settings saved while a tab's agent was running. The agent
 * read them when it started, so the save only applies once that agent starts
 * again; until then the Settings window says so and offers the restart. Kept
 * per tab and cleared when the tab's agent next starts, however it restarts.
 */

import { create } from "zustand";

export interface PendingRestart {
	path: string;
	label: string;
}

interface SettingsRestartStore {
	byTab: Record<string, PendingRestart[]>;
}

export const useSettingsRestartStore = create<SettingsRestartStore>(() => ({ byTab: {} }));

let watching = false;

function clearTab(tabId: string): void {
	useSettingsRestartStore.setState(state => {
		if (!state.byTab[tabId]) return state;
		const { [tabId]: _cleared, ...rest } = state.byTab;
		return { byTab: rest };
	});
}

function watchRestarts(): void {
	if (watching) return;
	watching = true;
	window.omp.events.onTabSidecarStatus((payload, tabId) => {
		if (payload.status === "starting" || payload.status === "restarting") clearTab(tabId);
	});
}

/** Record a saved restart-required setting against the tab whose agent is still on the old value. */
export function notePendingRestart(tabId: string, entry: PendingRestart): void {
	watchRestarts();
	useSettingsRestartStore.setState(state => {
		const list = state.byTab[tabId] ?? [];
		if (list.some(item => item.path === entry.path)) return state;
		return { byTab: { ...state.byTab, [tabId]: [...list, entry] } };
	});
}

const NONE: PendingRestart[] = [];

/** The settings waiting on this tab's next agent start. */
export function usePendingRestarts(tabId: string | null): PendingRestart[] {
	return useSettingsRestartStore(state => (tabId ? (state.byTab[tabId] ?? NONE) : NONE));
}
