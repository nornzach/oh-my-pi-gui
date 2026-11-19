import { describe, expect, it } from "vitest";
import { DEFAULT_PINNED_NAV_IDS, pinNavItemId, resolveSidebarNavigation, unpinNavItemId } from "./sidebar-nav";

const ALL_ITEMS = [
	{ id: "commands" },
	{ id: "search" },
	{ id: "agents" },
	{ id: "memory" },
	{ id: "plugins" },
	{ id: "pull-requests" },
	{ id: "scheduled-tasks" },
	{ id: "capabilities" },
	{ id: "providers" },
	{ id: "usage" },
	{ id: "stats" },
	{ id: "hotkeys" },
	{ id: "feedback" },
];
const VALID_IDS = new Set(ALL_ITEMS.map(item => item.id));

describe("sidebar-nav", () => {
	it("uses the built-in primary/secondary split when no custom pin list is saved", () => {
		const { primary, secondary } = resolveSidebarNavigation(ALL_ITEMS, null);
		expect(primary.map(i => i.id)).toEqual([...DEFAULT_PINNED_NAV_IDS]);
		expect(secondary.map(i => i.id)).toEqual(["capabilities", "providers", "usage", "stats", "hotkeys", "feedback"]);
	});

	it("pins an item from More into the primary list at the end or before a target item (#67)", () => {
		const appended = pinNavItemId(null, "providers", VALID_IDS);
		expect(appended.at(-1)).toBe("providers");
		const inserted = pinNavItemId(null, "stats", VALID_IDS, "search");
		expect(inserted.indexOf("stats")).toBe(1);
		expect(inserted.indexOf("search")).toBe(2);

		const { primary, secondary } = resolveSidebarNavigation(ALL_ITEMS, inserted);
		expect(primary.map(i => i.id)).toEqual(inserted);
		expect(secondary.map(i => i.id)).not.toContain("stats");
	});

	it("reorders already-pinned items and unpins items back to More", () => {
		const reordered = pinNavItemId(["commands", "search", "agents"], "agents", VALID_IDS, "commands");
		expect(reordered).toEqual(["agents", "commands", "search"]);

		const unpinned = unpinNavItemId(reordered, "commands", VALID_IDS);
		expect(unpinned).toEqual(["agents", "search"]);
		const { secondary } = resolveSidebarNavigation(ALL_ITEMS, unpinned);
		expect(secondary.map(i => i.id)).toContain("commands");
	});

	it("ignores unknown ids persisted from older or newer builds", () => {
		const { primary } = resolveSidebarNavigation(ALL_ITEMS, ["commands", "nonexistent", "providers", "commands"]);
		expect(primary.map(i => i.id)).toEqual(["commands", "providers"]);
	});
});
