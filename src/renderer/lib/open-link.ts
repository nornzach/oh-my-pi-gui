/**
 * Links the user clicks in a conversation (replies, tool output) open in the
 * tab's built-in browser, beside the work. ⌘/Ctrl-click, chat tabs (which have
 * no browser), and anything that is not a web page go to the system browser.
 */
import { useTabsStore } from "../stores/tabs";
import { type LinkOpenMode, useUiStore } from "../stores/ui";

export type LinkDestination = "panel" | "external";

export function linkDestination(
	href: string,
	options: { modifier: boolean; panel: boolean; defaultMode?: LinkOpenMode },
): LinkDestination {
	if (!options.panel || !/^https?:\/\//i.test(href)) return "external";
	const defaultMode = options.defaultMode ?? "panel";
	if (defaultMode === "external") return options.modifier ? "panel" : "external";
	return options.modifier ? "external" : "panel";
}

/** Whether the active tab has a browser panel; chat tabs show only files. */
export function browserPanelAvailable(): boolean {
	const { tabs, activeTabId } = useTabsStore.getState();
	const tab = tabs.find(entry => entry.id === activeTabId);
	return tab !== undefined && tab.kind !== "chat";
}

export function openLink(
	href: string,
	event?: { metaKey: boolean; ctrlKey: boolean },
	options?: { destination?: LinkDestination },
): void {
	const { tabs, activeTabId } = useTabsStore.getState();
	const tab = tabs.find(entry => entry.id === activeTabId);
	const panel = browserPanelAvailable();
	const destination =
		options?.destination !== undefined
			? options.destination === "panel" && panel && /^https?:\/\//i.test(href)
				? "panel"
				: "external"
			: linkDestination(href, {
					modifier: event?.metaKey === true || event?.ctrlKey === true,
					panel,
					defaultMode: useUiStore.getState().linkOpenMode,
				});
	if (destination === "external" || !tab) {
		void window.omp.system.openExternal(href);
		return;
	}
	useUiStore.getState().setPanelTab("browser");
	window.omp.browser.open(tab.id, href).then(
		state => {
			if (!state) void window.omp.system.openExternal(href);
		},
		() => void window.omp.system.openExternal(href),
	);
}
