import { useEffect } from "react";
import { applyBrowserState, forgetTabBrowser, useBrowserStore } from "../stores/browser";
import { connectSessionInspector } from "../stores/session-inspector";
import { useTabsStore } from "../stores/tabs";
import {
	applyTerminalTheme,
	forgetTabTerminals,
	handleTerminalFrame,
	setActiveTerminal,
	useTerminalsStore,
} from "../stores/terminals";
import { useUiStore } from "../stores/ui";

/**
 * Feeds the Terminal and Browser drawer views for every tab, mounted once at
 * the app root: terminal output and browser state arrive for background tabs
 * too, and the drawer comes forward when the agent needs the user there — a
 * `pty: true` command waiting for input, or a page it just opened.
 */
export function useWorkspaceSurfaces(): void {
	useEffect(connectSessionInspector, []);
	useEffect(() => {
		const events = window.omp?.events;
		if (typeof events?.onTerminalFrame !== "function" || typeof events.onBrowserState !== "function") return;
		const offTerminal = events.onTerminalFrame(({ tabId, frame }) => handleTerminalFrame(tabId, frame));
		const offBrowser = events.onBrowserState(state => applyBrowserState(state, { reveal: true }));
		return () => {
			offTerminal();
			offBrowser();
		};
	}, []);

	// Reveals only follow the tab the user is looking at.
	useEffect(() => {
		const offTerminal = useTerminalsStore.subscribe((state, previous) => {
			const reveal = state.reveal;
			if (!reveal || reveal === previous.reveal || reveal.tabId !== useTabsStore.getState().activeTabId) return;
			setActiveTerminal(reveal.tabId, reveal.terminalId);
			useUiStore.getState().setPanelTab("terminal");
		});
		const offBrowser = useBrowserStore.subscribe((state, previous) => {
			const reveal = state.reveal;
			if (!reveal || reveal === previous.reveal || reveal.tabId !== useTabsStore.getState().activeTabId) return;
			useUiStore.getState().setPanelTab("browser");
		});
		return () => {
			offTerminal();
			offBrowser();
		};
	}, []);

	// A closed tab took its sidecar, terminals, and pages with it.
	useEffect(
		() =>
			useTabsStore.subscribe((state, previous) => {
				if (state.tabs === previous.tabs) return;
				const open = new Set(state.tabs.map(tab => tab.id));
				for (const tab of previous.tabs) {
					if (open.has(tab.id)) continue;
					forgetTabTerminals(tab.id);
					forgetTabBrowser(tab.id);
				}
			}),
		[],
	);

	// Terminals draw with resolved colors, so a theme switch re-themes them.
	useEffect(() => {
		const observer = new MutationObserver(() => applyTerminalTheme());
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
		return () => observer.disconnect();
	}, []);
}
