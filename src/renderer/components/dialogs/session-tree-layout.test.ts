import { describe, expect, it } from "vitest";
import { buildSessionTreeLayout, SESSION_ROOT_ID, type SessionTreeEntry } from "./session-tree-layout";

function chainEntries(count: number): SessionTreeEntry[] {
	return Array.from({ length: count }, (_, index) => ({
		entryId: `e${index}`,
		parentId: index === 0 ? null : `e${index - 1}`,
		role: index % 2 === 0 ? "user" : "assistant",
		textPreview: `message ${index}`,
		timestamp: index,
		onActiveBranch: true,
		isLeaf: index === count - 1,
	}));
}

describe("buildSessionTreeLayout", () => {
	it("lays out a single chain without recursion limits", () => {
		// 60k-deep lineage — the recursive tidy-tree walk overflowed the call
		// stack on sessions this long (RangeError in the dialog's render).
		const layout = buildSessionTreeLayout(chainEntries(60_000));
		expect(layout.nodeCount).toBe(60_000);
		expect(layout.forkCount).toBe(0);
		const deepest = layout.nodes.find(node => node.id === "e59999");
		expect(deepest?.depth).toBe(60_000);
	});

	it("re-roots parent cycles instead of recursing forever", () => {
		const entries: SessionTreeEntry[] = [
			{
				entryId: "a",
				parentId: "c",
				role: "user",
				textPreview: "a",
				timestamp: 1,
				onActiveBranch: false,
				isLeaf: false,
			},
			{
				entryId: "b",
				parentId: "a",
				role: "assistant",
				textPreview: "b",
				timestamp: 2,
				onActiveBranch: false,
				isLeaf: false,
			},
			{
				entryId: "c",
				parentId: "b",
				role: "user",
				textPreview: "c",
				timestamp: 3,
				onActiveBranch: true,
				isLeaf: true,
			},
		];
		const layout = buildSessionTreeLayout(entries);
		expect(layout.nodeCount).toBe(3);
		// Every node reachable from the synthetic root — no node may keep a
		// cyclic parent.
		const ids = new Set(layout.edges.map(edge => edge.childId));
		expect(ids).toEqual(new Set(["a", "b", "c"]));
	});

	it("centers parents over left-to-right siblings", () => {
		const entries: SessionTreeEntry[] = [
			{
				entryId: "p",
				parentId: null,
				role: "user",
				textPreview: "p",
				timestamp: 1,
				onActiveBranch: true,
				isLeaf: false,
			},
			{
				entryId: "l",
				parentId: "p",
				role: "assistant",
				textPreview: "l",
				timestamp: 2,
				onActiveBranch: false,
				isLeaf: false,
			},
			{
				entryId: "r",
				parentId: "p",
				role: "assistant",
				textPreview: "r",
				timestamp: 3,
				onActiveBranch: true,
				isLeaf: true,
			},
		];
		const layout = buildSessionTreeLayout(entries);
		const x = (id: string) => layout.nodes.find(node => node.id === id)?.x ?? -1;
		// Left child gets slot 0, right child slot 1, parent centered at 0.5.
		expect(x("l")).toBeLessThan(x("r"));
		expect(x("p")).toBeCloseTo((x("l") + x("r")) / 2, 6);
		expect(x(SESSION_ROOT_ID)).toBeCloseTo(x("p"), 6);
	});
});
