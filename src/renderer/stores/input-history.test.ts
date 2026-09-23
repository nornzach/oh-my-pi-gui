/**
 * Contract tests for the composer input-history store's secret scrubbing:
 * normal prompts are recorded and persisted, while secret-bearing slash
 * commands (`/login` callbacks, `/join` links, `/mcp add --token …`) stay in
 * the in-memory session list but are never written to prefs — including
 * secrets persisted before the guard existed, which hydrate scrubs and
 * rewrites. Mirror of the TUI input-controller's shouldSkipHistory guard.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { shouldSkipHistory, useInputHistoryStore } from "./input-history";

interface PrefsMock {
	get: Mock<(key: string) => Promise<unknown>>;
	set: Mock<(key: string, value: unknown) => Promise<void>>;
}

function installPrefs(stored: unknown = undefined): PrefsMock {
	const prefs: PrefsMock = {
		get: vi.fn(async (_key: string) => stored),
		set: vi.fn(async (_key: string, _value: unknown) => {}),
	};
	// Node test env has no preload bridge; install the mock OmpApi on a global window.
	(globalThis as Record<string, unknown>).window = { omp: { prefs } };
	return prefs;
}

/** Prompts from the most recent prefs.set() payload. */
function persistedPrompts(prefs: PrefsMock): string[] {
	const calls = prefs.set.mock.calls;
	if (calls.length === 0) return [];
	const entries = calls[calls.length - 1]?.[1] as Array<{ prompt: string }>;
	return entries.map(entry => entry.prompt);
}

beforeEach(() => {
	useInputHistoryStore.setState({ entries: [], hydrated: false, navIndex: -1, navDraft: "", navContext: undefined });
});

describe("input-history secret scrubbing", () => {
	it("records and persists a normal prompt", () => {
		const prefs = installPrefs();
		useInputHistoryStore.getState().record("fix the flaky login test");
		expect(useInputHistoryStore.getState().entries[0]?.prompt).toBe("fix the flaky login test");
		expect(persistedPrompts(prefs)).toEqual(["fix the flaky login test"]);
	});

	const secretInputs = [
		"/login sk-ant-oat01-secret",
		"/join omp://share/abc123def456?write=tok_secret",
		"/mcp add myserver --url http://x --token sk-secret123",
	];
	for (const secret of secretInputs) {
		it(`keeps "${secret.split(" ")[0]}" with secrets out of persisted prefs`, () => {
			const prefs = installPrefs();
			useInputHistoryStore.getState().record(secret);
			// Still recallable from the in-memory session list…
			expect(useInputHistoryStore.getState().entries[0]?.prompt).toBe(secret);
			// …but never written to prefs.
			expect(prefs.set).toHaveBeenCalled();
			expect(persistedPrompts(prefs)).toEqual([]);
		});
	}

	it("does not leak a session secret into the persist triggered by a later benign input", () => {
		const prefs = installPrefs();
		useInputHistoryStore.getState().record("/login sk-ant-oat01-secret");
		useInputHistoryStore.getState().record("summarize the diff");
		expect(useInputHistoryStore.getState().entries.map(entry => entry.prompt)).toEqual([
			"summarize the diff",
			"/login sk-ant-oat01-secret",
		]);
		expect(persistedPrompts(prefs)).toEqual(["summarize the diff"]);
	});

	it("persists /login without args and /mcp add without --token", () => {
		const prefs = installPrefs();
		useInputHistoryStore.getState().record("/mcp add myserver --url http://x");
		useInputHistoryStore.getState().record("/login");
		expect(persistedPrompts(prefs)).toEqual(["/login", "/mcp add myserver --url http://x"]);
	});

	it("hydrate drops previously persisted secrets and rewrites prefs", async () => {
		const prefs = installPrefs([
			{ prompt: "refactor the store", ts: 1 },
			{ prompt: "/login ?code=abc&state=xyz", ts: 2 },
			"/join omp:abc123def456",
		]);
		await useInputHistoryStore.getState().hydrate();
		expect(useInputHistoryStore.getState().entries.map(entry => entry.prompt)).toEqual(["refactor the store"]);
		expect(persistedPrompts(prefs)).toEqual(["refactor the store"]);
	});

	it("hydrate leaves a clean history untouched on disk", async () => {
		const prefs = installPrefs([{ prompt: "hello", ts: 1 }]);
		await useInputHistoryStore.getState().hydrate();
		expect(useInputHistoryStore.getState().entries.map(entry => entry.prompt)).toEqual(["hello"]);
		expect(prefs.set).not.toHaveBeenCalled();
	});

	it("recalls only the current workspace and does not cross tab owners", () => {
		installPrefs();
		useInputHistoryStore.getState().record("workspace one", "/work/one");
		useInputHistoryStore.getState().record("workspace two", "/work/two");

		expect(useInputHistoryStore.getState().prev("draft", { cwd: "/work/one", owner: "tab-one:s1" })).toBe(
			"workspace one",
		);
		expect(useInputHistoryStore.getState().next({ cwd: "/work/two", owner: "tab-two:s2" })).toBeUndefined();
	});
});

describe("shouldSkipHistory", () => {
	it("matches the TUI secret patterns, including colon-separated /login", () => {
		expect(shouldSkipHistory("/login:?code=abc&state=xyz")).toBe(true);
		expect(shouldSkipHistory("/join omp:abc123def456")).toBe(true);
		expect(shouldSkipHistory("/mcp add myserver --token tok123")).toBe(true);
	});

	it("ignores ordinary prompts and benign slash commands", () => {
		expect(shouldSkipHistory("how do I rotate an api-key?")).toBe(false);
		expect(shouldSkipHistory("/plan ship it")).toBe(false);
		expect(shouldSkipHistory("/login")).toBe(false);
		expect(shouldSkipHistory("/mcp list")).toBe(false);
	});
});
