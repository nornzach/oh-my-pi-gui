import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../../shared/ipc-types";
import { buildSessionTree, isSubagentTranscript, orderSessionForest } from "./session-tree";

function session(path: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
	return {
		path,
		id: path,
		title: path,
		cwd: "/work",
		created: "2026-01-01T00:00:00Z",
		modified: "2026-01-01T00:00:00Z",
		messageCount: 1,
		size: 10,
		status: "complete",
		firstMessage: "hello",
		...overrides,
	};
}

describe("buildSessionTree", () => {
	it("nests a child under the parent named by session id or by file path", () => {
		const parent = session("/s/parent.jsonl", { id: "parent-id" });
		const byId = session("/s/by-id.jsonl", { parentSessionPath: "parent-id" });
		const byPath = session("/s/by-path.jsonl", { parentSessionPath: "/s/parent.jsonl" });
		const windows = session("/s/windows.jsonl", { parentSessionPath: "\\s\\parent.jsonl" });
		const unrelated = session("/s/other.jsonl");

		const roots = buildSessionTree([byId, unrelated, parent, windows, byPath]);

		expect(roots.map(node => node.session.path)).toEqual(["/s/other.jsonl", "/s/parent.jsonl"]);
		expect(roots[1]?.children.map(node => node.session.path)).toEqual([
			"/s/by-id.jsonl",
			"/s/windows.jsonl",
			"/s/by-path.jsonl",
		]);
	});

	it("keeps a nested subagent under its spawning session, not the root", () => {
		const parent = session("/s/parent.jsonl", { id: "parent-id" });
		const child = session("/s/parent/agent.jsonl", { id: "agent", parentSessionPath: "/s/parent.jsonl" });
		const nested = session("/s/parent/agent/helper.jsonl", {
			id: "helper",
			parentSessionPath: "/s/parent/agent.jsonl",
		});

		const [root] = buildSessionTree([nested, parent, child]);

		expect(root?.session.path).toBe("/s/parent.jsonl");
		expect(root?.children.map(node => node.session.path)).toEqual(["/s/parent/agent.jsonl"]);
		expect(root?.children[0]?.children.map(node => node.session.path)).toEqual(["/s/parent/agent/helper.jsonl"]);
	});

	it("leaves an orphan at the root and does not loop on a cycle", () => {
		const a = session("/s/a.jsonl", { id: "a", parentSessionPath: "b" });
		const b = session("/s/b.jsonl", { id: "b", parentSessionPath: "a" });
		const orphan = session("/s/orphan.jsonl", { parentSessionPath: "missing" });

		const roots = buildSessionTree([a, b, orphan]);
		const paths = roots.flatMap(function walk(node): string[] {
			return [node.session.path, ...node.children.flatMap(walk)];
		});

		expect(paths.sort()).toEqual(["/s/a.jsonl", "/s/b.jsonl", "/s/orphan.jsonl"]);
		expect(roots.some(node => node.session.path === "/s/orphan.jsonl" && node.children.length === 0)).toBe(true);
	});

	it("keeps a session that only leads into a cycle under its parent", () => {
		const a = session("/s/a.jsonl", { id: "a", parentSessionPath: "b" });
		const b = session("/s/b.jsonl", { id: "b", parentSessionPath: "a" });
		const c = session("/s/c.jsonl", { id: "c", parentSessionPath: "a" });

		const roots = buildSessionTree([c, a, b]);

		expect(roots.map(node => node.session.path)).toEqual(["/s/a.jsonl"]);
		expect(roots[0]?.children.map(node => node.session.path).sort()).toEqual(["/s/b.jsonl", "/s/c.jsonl"]);
	});
});

describe("orderSessionForest", () => {
	it("lifts a parent to its newest child's place and keeps a pinned family first", () => {
		const parent = session("/s/parent.jsonl", { modified: "2026-01-01T00:00:00Z" });
		const child = session("/s/child.jsonl", {
			modified: "2026-01-03T00:00:00Z",
			parentSessionPath: "/s/parent.jsonl",
		});
		const pinned = session("/s/pinned.jsonl", { modified: "2026-01-02T00:00:00Z" });
		const nodes = buildSessionTree([child, pinned, parent]);

		const ordered = orderSessionForest(nodes, {
			pinned: session => session.path === "/s/pinned.jsonl",
			recency: session => Date.parse(session.modified),
		});

		expect(ordered.map(node => node.session.path)).toEqual(["/s/pinned.jsonl", "/s/parent.jsonl"]);
		expect(ordered[1]?.children.map(node => node.session.path)).toEqual(["/s/child.jsonl"]);
	});
});

describe("isSubagentTranscript", () => {
	it("tells a transcript in the parent's artifact directory from a fork beside it", () => {
		const parent = session("/s/parent.jsonl");
		expect(isSubagentTranscript(session("/s/parent/agent.jsonl"), parent)).toBe(true);
		expect(isSubagentTranscript(session("/s/parent/agent/helper.jsonl"), parent)).toBe(true);
		expect(isSubagentTranscript(session("C:\\s\\parent\\agent.jsonl"), session("C:\\s\\parent.jsonl"))).toBe(true);
		expect(isSubagentTranscript(session("/s/fork.jsonl"), parent)).toBe(false);
		expect(isSubagentTranscript(session("/s/parent-2/agent.jsonl"), parent)).toBe(false);
	});
});
