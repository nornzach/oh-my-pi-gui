import { type SessionTab, useTabsStore } from "./tabs";
import { type DiffScope, type PanelTab, useUiStore } from "./ui";

interface InspectorView {
	panelTab: PanelTab;
	diffScope: DiffScope;
}

function inspectorOwner(tab: SessionTab): string {
	return tab.sessionPath ?? tab.pendingSessionPath ?? (tab.sessionId ? `session:${tab.sessionId}` : `tab:${tab.id}`);
}

function sameConversation(previous: SessionTab, next: SessionTab): boolean {
	if (previous.sessionId && next.sessionId) return previous.sessionId === next.sessionId;
	const previousPath = previous.sessionPath ?? previous.pendingSessionPath;
	const nextPath = next.sessionPath ?? next.pendingSessionPath;
	return !previousPath || !nextPath || previousPath === nextPath;
}

export function connectSessionInspector(): () => void {
	const views = new Map<string, InspectorView>();
	return useTabsStore.subscribe((next, previous) => {
		if (next.tabs === previous.tabs && next.activeTabId === previous.activeTabId) return;
		if (views.size && next.tabs !== previous.tabs) {
			const oldTabs = new Map(previous.tabs.map(tab => [tab.id, tab]));
			for (const tab of next.tabs) {
				const old = oldTabs.get(tab.id);
				if (!old || old === tab || !sameConversation(old, tab)) continue;
				const oldOwner = inspectorOwner(old);
				const owner = inspectorOwner(tab);
				const saved = views.get(oldOwner);
				if (oldOwner !== owner && saved) {
					views.delete(oldOwner);
					views.set(owner, saved);
				}
			}
		}
		const outgoing = previous.tabs.find(tab => tab.id === previous.activeTabId);
		const incoming = next.tabs.find(tab => tab.id === next.activeTabId);
		if (outgoing === incoming) return;
		if (outgoing && incoming && outgoing.id === incoming.id && sameConversation(outgoing, incoming)) return;
		const { panelVisible, panelTab, diffScope } = useUiStore.getState();
		if (outgoing) {
			const updated = next.tabs.find(tab => tab.id === outgoing.id);
			const owner = inspectorOwner(updated && sameConversation(outgoing, updated) ? updated : outgoing);
			if (panelVisible) views.set(owner, { panelTab, diffScope });
			else views.delete(owner);
		}
		const view = incoming && views.get(inspectorOwner(incoming));
		if (!outgoing && !view && !panelVisible) return;
		const initial = useUiStore.getInitialState();
		useUiStore.setState({
			panelVisible: !!view,
			panelTab: view?.panelTab ?? initial.panelTab,
			diffScope: view?.diffScope ?? initial.diffScope,
			dockFocus: null,
			filePreviewPath: null,
			filePreviewLine: null,
			filePreviewImage: null,
		});
	});
}
