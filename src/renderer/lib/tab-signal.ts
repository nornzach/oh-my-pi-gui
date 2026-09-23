import type { SessionTab } from "../stores/tabs";

export interface TabSignalPresentation {
	active: boolean;
	color: string;
	labelKey: string;
	running: boolean;
}

export function tabSignalPresentation(tab: SessionTab, activeRuntime = false): TabSignalPresentation {
	const running = tab.status === "running" || tab.compacting === true || activeRuntime;
	if (running) {
		return { active: true, color: "var(--omp-accent)", labelKey: "titlebar.status.working", running: true };
	}
	if (tab.unreadDone) {
		return { active: false, color: "var(--omp-success)", labelKey: "tabs.done", running: false };
	}
	if (tab.status === "ready") {
		return { active: false, color: "var(--omp-dim)", labelKey: "titlebar.status.ready", running: false };
	}
	if (tab.status === "starting") {
		return { active: true, color: "var(--omp-warning)", labelKey: "titlebar.status.connecting", running: false };
	}
	// A restored tab whose process has not been spawned yet. Inert, not a
	// warning: nothing is wrong and nothing is happening.
	if (tab.status === "asleep") {
		return { active: false, color: "var(--omp-dim)", labelKey: "titlebar.status.asleep", running: false };
	}
	return {
		active: tab.status === "restarting",
		color: tab.status === "error" || tab.status === "exited" ? "var(--omp-error)" : "var(--omp-warning)",
		labelKey: `titlebar.status.${tab.status}`,
		running: false,
	};
}
