import { afterEach, expect, it } from "vitest";
import { useFileTabs } from "./file-tabs";

afterEach(() => useFileTabs.setState({ workspaces: new Map() }));

it("reuses a tab for relative and absolute links to the same file and honors a line link", () => {
	const cwd = "/work/project";
	const tabs = useFileTabs.getState();
	tabs.open(cwd, "pages/guide.md", null, 1);
	const first = useFileTabs.getState().workspaces.get(cwd);
	expect(first?.tabs[0]?.view).toBe("preview");
	tabs.open(cwd, "/work/project/pages/./guide.md", 12, 2);
	const second = useFileTabs.getState().workspaces.get(cwd);
	expect(second?.tabs).toHaveLength(1);
	expect(second?.tabs[0]).toMatchObject({ id: first?.activeId, line: 12, lineRequest: 2, view: "source" });
});

it("remembers each file's view and keeps open tabs scoped to their project", () => {
	const tabs = useFileTabs.getState();
	tabs.open("/alpha", "README.md", null, 1);
	tabs.open("/alpha", "a.txt", null, 2);
	tabs.open("/beta", "a.txt", null, 3);
	const alpha = useFileTabs.getState().workspaces.get("/alpha");
	const beta = useFileTabs.getState().workspaces.get("/beta");
	expect(beta?.activeId).not.toBe(alpha?.activeId);
	if (!alpha?.tabs[0] || !alpha.activeId) throw new Error("Missing project tabs");
	tabs.changeView("/alpha", alpha.tabs[0].id, "source");
	tabs.remove("/alpha", alpha.activeId);
	expect(useFileTabs.getState().workspaces.get("/alpha")).toMatchObject({
		activeId: alpha.tabs[0].id,
		tabs: [{ path: "README.md", view: "source" }],
	});
	expect(useFileTabs.getState().workspaces.get("/beta")).toBe(beta);
});

it("drops session output tabs on session switches without discarding project file tabs", () => {
	const tabs = useFileTabs.getState();
	expect(tabs.scopeSession("/alpha", "tab-one/session-one")).toBe(false);
	tabs.open("/alpha", "README.md", null, 1);
	tabs.open("/alpha", "local://0.log", null, 2);
	tabs.open("/alpha", "artifact://42", null, 3);
	expect(tabs.scopeSession("/alpha", "tab-one/session-one")).toBe(false);
	expect(useFileTabs.getState().workspaces.get("/alpha")?.tabs).toHaveLength(3);
	expect(tabs.scopeSession("/alpha", "tab-two/session-two")).toBe(true);
	expect(
		useFileTabs
			.getState()
			.workspaces.get("/alpha")
			?.tabs.map(tab => tab.path),
	).toEqual(["README.md"]);
});
