/**
 * setPanelTab chat clamp: a tool-free chat tab only carries files in the
 * workspace drawer (todo/plan/agents/queue moved to the center dock), so
 * force-opening the diff tab there is a no-op. The clamp lives in the ui
 * store — not just the PanelContainer tab list — because several call sites
 * force the panel open.
 */
import { afterEach, describe, expect, it } from "vitest";
import { connectSessionInspector } from "./session-inspector";
import { useTabsStore } from "./tabs";
import { useUiStore } from "./ui";

function seedActiveTab(kind: "agent" | "chat"): void {
	useTabsStore.setState({
		tabs: [{ id: "t0", cwd: "/work", status: "ready", kind, unreadDone: false }],
		activeTabId: "t0",
		bundles: new Map(),
	});
}

afterEach(() => {
	useTabsStore.getState().reset();
	useUiStore.setState({ panelTab: "files", panelVisible: false, diffScope: "repository" });
});

describe("setPanelTab chat clamp", () => {
	it("refuses the diff tab in a chat tab but allows files and side questions", () => {
		seedActiveTab("chat");
		// Baseline: a chat-visible tab, so a clamped no-op leaves a provable state.
		useUiStore.setState({ panelTab: "files", panelVisible: false });
		useUiStore.getState().setPanelTab("diff");
		expect(useUiStore.getState().panelTab).toBe("files");
		expect(useUiStore.getState().panelVisible).toBe(false);

		useUiStore.getState().setPanelTab("files");
		expect(useUiStore.getState().panelTab).toBe("files");
		expect(useUiStore.getState().panelVisible).toBe(true);

		useUiStore.getState().setPanelTab("btw");
		expect(useUiStore.getState().panelTab).toBe("btw");
		expect(useUiStore.getState().panelVisible).toBe(true);
	});

	it("opens every tab in an agent tab", () => {
		seedActiveTab("agent");
		for (const tab of ["diff", "files"] as const) {
			useUiStore.getState().setPanelTab(tab);
			expect(useUiStore.getState().panelTab).toBe(tab);
		}
	});
});

describe("openChanges", () => {
	// The transcript's "Review" link must land on the edits it counted, not on
	// whichever scope the drawer was last left at.
	it("opens the drawer on Changes at the requested scope", () => {
		seedActiveTab("agent");
		useUiStore.getState().openChanges("current");
		expect(useUiStore.getState()).toMatchObject({ panelVisible: true, panelTab: "diff", diffScope: "current" });
	});

	it("leaves a chat tab's drawer and scope alone", () => {
		seedActiveTab("chat");
		useUiStore.getState().openChanges("current");
		expect(useUiStore.getState()).toMatchObject({ panelVisible: false, panelTab: "files", diffScope: "repository" });
	});
});

describe("togglePanel", () => {
	// The bare toggle answers "what is going on here?", whatever tab was last open;
	// closing must not disturb the tab a link set.
	it("opens on Overview, in an agent or a chat tab, and closes without changing the tab", () => {
		for (const kind of ["agent", "chat"] as const) {
			seedActiveTab(kind);
			useUiStore.setState({ panelTab: "files", panelVisible: false });
			useUiStore.getState().togglePanel();
			expect(useUiStore.getState()).toMatchObject({ panelVisible: true, panelTab: "overview" });

			useUiStore.setState({ panelTab: "files" });
			useUiStore.getState().togglePanel();
			expect(useUiStore.getState()).toMatchObject({ panelVisible: false, panelTab: "files" });
		}
	});
});

describe("session inspector", () => {
	it("restores the correct drawer after background session identification and in-place history switches", () => {
		seedActiveTab("agent");
		const initial = useTabsStore.getState().tabs[0];
		const other = { ...initial, id: "other", sessionId: "other" };
		const first = { ...initial, sessionPath: "/work/first.jsonl", sessionId: "first" };
		const second = { ...initial, sessionPath: "/work/second.jsonl", sessionId: "second" };
		const disconnect = connectSessionInspector();
		try {
			useUiStore.getState().setPanelTab("browser");
			useTabsStore.setState({ activeTabId: other.id, tabs: [initial, other] });
			useTabsStore.setState({ tabs: [first, other] });
			expect(useUiStore.getState().panelVisible).toBe(false);
			useTabsStore.setState({ activeTabId: first.id });
			expect(useUiStore.getState()).toMatchObject({ panelVisible: true, panelTab: "browser" });
			useTabsStore.setState({ tabs: [second, other] });
			expect(useUiStore.getState().panelVisible).toBe(false);
			useUiStore.getState().setPanelTab("files");
			useTabsStore.setState({ tabs: [first, other] });
			expect(useUiStore.getState()).toMatchObject({ panelVisible: true, panelTab: "browser" });
			useTabsStore.setState({ tabs: [second, other] });
			expect(useUiStore.getState()).toMatchObject({ panelVisible: true, panelTab: "files" });
		} finally {
			disconnect();
		}
	});
});
