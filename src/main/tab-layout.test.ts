import { describe, expect, it } from "vitest";
import {
	MAX_PERSISTED_TABS,
	MAX_PERSISTED_TITLE,
	sanitizePersistedTabLayout,
	sanitizePersistedTabLayouts,
	type TabLayoutPathChecks,
} from "./tab-layout";

function pathChecks(directories: string[], files: string[], contentFiles: string[] = files): TabLayoutPathChecks {
	return {
		directoryExists: path => directories.includes(path),
		fileExists: path => files.includes(path),
		sessionHasContent: path => contentFiles.includes(path),
	};
}

describe("persisted tab layout", () => {
	it("preserves valid order, active selection, session kind, and worktree metadata", () => {
		const value = {
			version: 1,
			activeIndex: 1,
			tabs: [
				{ cwd: "/a", kind: "agent", sessionPath: "/sessions/a.jsonl" },
				{
					cwd: "/b",
					kind: "chat",
					worktree: { name: "feature", branch: "omp/gui/feature", baseCwd: "/repo" },
				},
			],
		};

		expect(sanitizePersistedTabLayout(value, pathChecks(["/a", "/b"], ["/sessions/a.jsonl"]))).toEqual(value);
	});

	it("carries a saved title and bounds the one read back from prefs", () => {
		const layout = sanitizePersistedTabLayout(
			{
				version: 1,
				activeIndex: 0,
				tabs: [
					{ cwd: "/a", kind: "agent", title: "x".repeat(400) },
					{ cwd: "/b", kind: "agent", title: 42 },
				],
			},
			pathChecks(["/a", "/b"], []),
		);

		// A restored tab stays unspawned until shown, so its saved title is the
		// only label it has — but prefs are untrusted input and must not grow.
		expect(layout?.tabs[0]?.title).toHaveLength(MAX_PERSISTED_TITLE);
		expect(layout?.tabs[1]?.title).toBeUndefined();
	});

	it("remaps and clamps a restored two-pane layout after invalid tabs are dropped", () => {
		const value = {
			version: 1,
			activeIndex: 2,
			tabs: [
				{ cwd: "/missing", kind: "agent" },
				{ cwd: "/a", kind: "agent" },
				{ cwd: "/b", kind: "chat" },
			],
			split: { axis: "rows", firstIndex: 1, secondIndex: 2, ratio: 0.95 },
		};

		expect(sanitizePersistedTabLayout(value, pathChecks(["/a", "/b"], []))).toEqual({
			version: 1,
			activeIndex: 1,
			tabs: [
				{ cwd: "/a", kind: "agent" },
				{ cwd: "/b", kind: "chat" },
			],
			split: { axis: "rows", firstIndex: 0, secondIndex: 1, ratio: 0.8 },
		});
	});

	it("drops missing workspaces and selects the nearest surviving tab", () => {
		const value = {
			version: 1,
			activeIndex: 1,
			tabs: [
				{ cwd: "/before", kind: "agent" },
				{ cwd: "/deleted", kind: "agent" },
				{ cwd: "/after", kind: "chat" },
			],
		};

		expect(sanitizePersistedTabLayout(value, pathChecks(["/before", "/after"], []))).toEqual({
			version: 1,
			activeIndex: 1,
			tabs: [
				{ cwd: "/before", kind: "agent" },
				{ cwd: "/after", kind: "chat" },
			],
		});
	});

	it("turns a deleted transcript into a fresh tab and removes duplicate session attachments", () => {
		const value = {
			version: 1,
			activeIndex: 0,
			tabs: [
				{ cwd: "/a", kind: "agent", sessionPath: "/sessions/deleted.jsonl" },
				{ cwd: "/b", kind: "agent", sessionPath: "/sessions/live.jsonl" },
				{ cwd: "/c", kind: "agent", sessionPath: "/sessions/live.jsonl" },
			],
		};

		expect(sanitizePersistedTabLayout(value, pathChecks(["/a", "/b", "/c"], ["/sessions/live.jsonl"]))).toEqual({
			version: 1,
			activeIndex: 0,
			tabs: [
				{ cwd: "/a", kind: "agent" },
				{ cwd: "/b", kind: "agent", sessionPath: "/sessions/live.jsonl" },
			],
		});
	});

	it("drops the disposable startup placeholder once an explicit tab exists", () => {
		const value = {
			version: 1,
			activeIndex: 0,
			tabs: [
				{ cwd: "/neutral", kind: "chat", placeholder: true },
				{ cwd: "/work", kind: "agent", sessionPath: "/sessions/work.jsonl" },
			],
		};

		expect(sanitizePersistedTabLayout(value, pathChecks(["/neutral", "/work"], ["/sessions/work.jsonl"]))).toEqual({
			version: 1,
			activeIndex: 0,
			tabs: [{ cwd: "/work", kind: "agent", sessionPath: "/sessions/work.jsonl" }],
		});
	});

	it("drops a lone startup placeholder so the next launch uses Work", () => {
		const value = {
			version: 1,
			activeIndex: 0,
			tabs: [{ cwd: "/neutral", kind: "chat", placeholder: true }],
		};

		expect(sanitizePersistedTabLayout(value, pathChecks(["/neutral"], []))).toBeNull();
	});

	it("migrates an empty first chat from layouts saved before placeholder metadata existed", () => {
		const value = {
			version: 1,
			activeIndex: 0,
			tabs: [
				{ cwd: "/neutral", kind: "chat", sessionPath: "/sessions/empty.jsonl" },
				{ cwd: "/work", kind: "agent", sessionPath: "/sessions/work.jsonl" },
			],
		};

		expect(
			sanitizePersistedTabLayout(
				value,
				pathChecks(
					["/neutral", "/work"],
					["/sessions/empty.jsonl", "/sessions/work.jsonl"],
					["/sessions/work.jsonl"],
				),
			),
		).toEqual({
			version: 1,
			activeIndex: 0,
			tabs: [{ cwd: "/work", kind: "agent", sessionPath: "/sessions/work.jsonl" }],
		});

		// A real first chat is never inferred to be a disposable placeholder.
		expect(
			sanitizePersistedTabLayout(
				value,
				pathChecks(
					["/neutral", "/work"],
					["/sessions/empty.jsonl", "/sessions/work.jsonl"],
					["/sessions/empty.jsonl", "/sessions/work.jsonl"],
				),
			),
		).toEqual(value);
	});

	it("rejects malformed or empty snapshots and enforces the sidecar cap", () => {
		expect(sanitizePersistedTabLayout(null, pathChecks([], []))).toBeNull();
		expect(sanitizePersistedTabLayout({ version: 2, tabs: [] }, pathChecks([], []))).toBeNull();
		expect(sanitizePersistedTabLayout({ version: 1, activeIndex: 0, tabs: [] }, pathChecks([], []))).toBeNull();

		const tabs = Array.from({ length: MAX_PERSISTED_TABS + 2 }, (_, index) => ({
			cwd: `/workspace-${index}`,
			kind: "agent",
		}));
		const directories = tabs.map(tab => tab.cwd);
		expect(
			sanitizePersistedTabLayout({ version: 1, activeIndex: 11, tabs }, pathChecks(directories, []))?.tabs,
		).toHaveLength(MAX_PERSISTED_TABS);
	});
});

describe("persisted session (all windows)", () => {
	function layout(cwdCount: number, prefix: string, activeIndex = 0) {
		return {
			version: 1,
			activeIndex,
			tabs: Array.from({ length: cwdCount }, (_, index) => ({
				cwd: `/${prefix}-${index}`,
				kind: "agent",
			})),
		};
	}

	function dirs(...prefixes: string[]): string[] {
		return prefixes.flatMap(prefix => Array.from({ length: 12 }, (_, index) => `/${prefix}-${index}`));
	}

	it("restores one layout per window and still reads the pre-multi-window single object", () => {
		const first = layout(2, "a");
		const second = layout(1, "b");
		const paths = pathChecks(dirs("a", "b"), []);

		expect(sanitizePersistedTabLayouts([first, second], paths)).toEqual([first, second]);
		// An upgrade from the one-slot shape must not lose the session.
		expect(sanitizePersistedTabLayouts(first, paths)).toEqual([first]);
	});

	it("skips an unsalvageable window without shifting the rest", () => {
		const second = layout(1, "b");
		const restored = sanitizePersistedTabLayouts(
			[null, { version: 1, activeIndex: 0, tabs: [{ cwd: "/gone", kind: "agent" }] }, second],
			pathChecks(dirs("b"), []),
		);

		expect(restored).toEqual([second]);
	});

	it("shares the sidecar budget across windows and stops once it is spent", () => {
		const paths = pathChecks(dirs("a", "b"), []);

		// Window 1 alone consumes the pool's capacity: window 2 restores nothing.
		const full = sanitizePersistedTabLayouts([layout(MAX_PERSISTED_TABS, "a"), layout(2, "b")], paths);
		expect(full.map(entry => entry.tabs.length)).toEqual([MAX_PERSISTED_TABS]);

		// A partial overflow trims the last window's tabs, clamps its focus, and
		// drops a split whose panes no longer both exist.
		const overflowing = sanitizePersistedTabLayouts(
			[
				layout(MAX_PERSISTED_TABS - 2, "a"),
				{ ...layout(4, "b", 3), split: { axis: "rows", firstIndex: 2, secondIndex: 3, ratio: 0.5 } },
			],
			paths,
		);
		expect(overflowing.map(entry => entry.tabs.length)).toEqual([MAX_PERSISTED_TABS - 2, 2]);
		expect(overflowing[1]?.tabs.map(tab => tab.cwd)).toEqual(["/b-0", "/b-1"]);
		expect(overflowing[1]?.activeIndex).toBe(1);
		expect(overflowing[1]?.split).toBeUndefined();
	});

	it("returns nothing for a session with no restorable window", () => {
		expect(sanitizePersistedTabLayouts([], pathChecks([], []))).toEqual([]);
		expect(sanitizePersistedTabLayouts(undefined, pathChecks([], []))).toEqual([]);
	});
});
