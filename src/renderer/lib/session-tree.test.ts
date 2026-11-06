import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../../shared/ipc-types";
import { browsableSessions, buildSessionTree, listedSessions, orderSessionForest } from "./session-tree";

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

describe("listedSessions", () => {
	const shape = (sessions: readonly SessionInfo[]) =>
		Object.fromEntries(sessions.map(item => [item.path, item.parentSessionPath]));

	// The move the agent makes when its file is taken: parent and continuation both name the old id.
	const moved = (path: string, from: string, overrides: Partial<SessionInfo> = {}) =>
		session(path, {
			id: path,
			parentSessionPath: from,
			continuationOf: from,
			created: "2026-01-02T00:00:30Z",
			modified: "2026-01-03T00:00:00Z",
			...overrides,
		});
	const old = (path: string, overrides: Partial<SessionInfo> = {}) =>
		session(path, { created: "2026-01-02T00:00:00Z", modified: "2026-01-02T00:00:01Z", ...overrides });

	it("draws an edited branch that moved to a new file as one row under the root", () => {
		// The nesting from gui#42: root → untouched branch copy → the continuation you actually worked in.
		const root = session("/s/root.jsonl");
		const copy = old("/s/copy.jsonl", { parentSessionPath: "/s/root.jsonl" });
		const continuation = moved("/s/next.jsonl", "/s/copy.jsonl");

		const { sessions, heirs } = listedSessions([root, copy, continuation]);

		expect(shape(sessions)).toEqual({ "/s/root.jsonl": undefined, "/s/next.jsonl": "/s/root.jsonl" });
		expect([...heirs]).toEqual([["/s/copy.jsonl", "/s/next.jsonl"]]);
	});

	it("makes the newest file of a moved session the root of its family", () => {
		const first = old("/s/first.jsonl");
		const second = moved("/s/second.jsonl", "/s/first.jsonl", { modified: "2026-01-02T00:00:31Z" });
		const third = moved("/s/third.jsonl", "/s/second.jsonl", { created: "2026-01-02T00:01:00Z" });
		const fork = session("/s/fork.jsonl", { parentSessionPath: "/s/first.jsonl" });
		const transcript = session("/s/first/agent.jsonl", { parentSessionPath: "/s/first.jsonl", subagent: true });

		const { sessions, heirs } = listedSessions([first, second, third, fork, transcript]);

		// The index keeps the first file's copy of a transcript, so it has to follow the conversation.
		expect(shape(sessions)).toEqual({
			"/s/third.jsonl": undefined,
			"/s/fork.jsonl": "/s/third.jsonl",
			"/s/first/agent.jsonl": "/s/third.jsonl",
		});
		expect(heirs.get("/s/first.jsonl")).toBe("/s/third.jsonl");
		expect(heirs.get("/s/second.jsonl")).toBe("/s/third.jsonl");
	});

	it("keeps a file someone is still working in, with the continuation as its child", () => {
		const stillWritten = old("/s/old.jsonl", { modified: "2026-01-02T00:05:00Z" });
		const continuation = moved("/s/next.jsonl", "/s/old.jsonl");

		const { sessions, heirs } = listedSessions([stillWritten, continuation]);

		expect(shape(sessions)).toEqual({ "/s/old.jsonl": undefined, "/s/next.jsonl": "/s/old.jsonl" });
		expect(heirs.size).toBe(0);
	});

	it("keeps a file open in a tab", () => {
		const open = old("/s/old.jsonl");
		const continuation = moved("/s/next.jsonl", "/s/old.jsonl");

		const { sessions } = listedSessions([open, continuation], item => item.path === "/s/old.jsonl");

		expect(shape(sessions)).toEqual({ "/s/old.jsonl": undefined, "/s/next.jsonl": "/s/old.jsonl" });
	});

	it("flattens forks of forks onto the root and leaves subagents under the session that ran them", () => {
		const root = session("/s/root.jsonl", { id: "root-id" });
		const fork = session("/s/fork.jsonl", { id: "fork-id", parentSessionPath: "root-id" });
		const forkOfFork = session("/s/fork2.jsonl", { parentSessionPath: "/s/fork.jsonl" });
		const agent = session("/s/fork/agent.jsonl", { parentSessionPath: "/s/fork.jsonl", subagent: true });
		const nested = session("/s/fork/agent/helper.jsonl", {
			parentSessionPath: "/s/fork/agent.jsonl",
			subagent: true,
		});

		const { sessions } = listedSessions([root, fork, forkOfFork, agent, nested]);

		expect(shape(sessions)).toEqual({
			"/s/root.jsonl": undefined,
			"/s/fork.jsonl": "/s/root.jsonl",
			"/s/fork2.jsonl": "/s/root.jsonl",
			"/s/fork/agent.jsonl": "/s/fork.jsonl",
			"/s/fork/agent/helper.jsonl": "/s/fork/agent.jsonl",
		});
	});

	it("does not lose a session whose continuation link is malformed", () => {
		const a = session("/s/a.jsonl", { id: "a", continuationOf: "b" });
		const b = session("/s/b.jsonl", { id: "b", continuationOf: "a" });
		const self = session("/s/self.jsonl", { id: "self", continuationOf: "self" });
		const undated = session("/s/undated.jsonl", { created: "not a date", continuationOf: "a" });

		const { sessions, heirs } = listedSessions([a, b, self, undated]);

		expect(sessions.map(item => item.path)).toEqual([
			"/s/a.jsonl",
			"/s/b.jsonl",
			"/s/self.jsonl",
			"/s/undated.jsonl",
		]);
		expect(heirs.size).toBe(0);
	});

	it("gives a picker only the conversations", () => {
		const first = old("/s/first.jsonl");
		const second = moved("/s/second.jsonl", "/s/first.jsonl");
		const agent = session("/s/second/agent.jsonl", { parentSessionPath: "/s/second.jsonl", subagent: true });

		expect(browsableSessions([first, second, agent]).map(item => item.path)).toEqual(["/s/second.jsonl"]);
	});
});
