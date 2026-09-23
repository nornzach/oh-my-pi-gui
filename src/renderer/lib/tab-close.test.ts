/**
 * The close-a-tab rules every entry point shares (chip ×, ⌘W, File → Close Tab):
 * work that would die with the tab arms the inline confirm first, a
 * worktree-bound tab detours to the cleanup prompt, the last tab hands the
 * keystroke to the window, and an idle tab closes at once.
 */

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { IpcSpawnTabPayload, IpcTabInfo } from "../../shared/ipc-types";
import { useSessionStore } from "../stores/session";
import { type SessionTab, useTabsStore } from "../stores/tabs";
import { useUiStore } from "../stores/ui";
import { closeActiveTab, performTabClose, tabNeedsCloseConfirm } from "./tab-close";

interface MockOmp {
	tabs: {
		list: Mock<() => Promise<IpcTabInfo[]>>;
		spawn: Mock<(payload: IpcSpawnTabPayload) => Promise<{ tabId: string } | null>>;
		close: Mock<(tabId: string) => Promise<boolean>>;
		setActive: Mock<(tabId: string) => Promise<boolean>>;
		setView: Mock<(tabId: string, visibleTabIds: string[], split?: unknown) => Promise<boolean>>;
	};
}

function installMockOmp(): MockOmp {
	const omp: MockOmp = {
		tabs: {
			list: vi.fn(async () => []),
			spawn: vi.fn(async () => ({ tabId: "t9" })),
			close: vi.fn(async () => true),
			setActive: vi.fn(async () => true),
			setView: vi.fn(async () => true),
		},
	};
	(globalThis as Record<string, unknown>).window = {
		omp,
		close: vi.fn(),
	} as unknown as Window & typeof globalThis;
	return omp;
}

function tab(id: string, overrides: Partial<SessionTab> = {}): SessionTab {
	return { kind: "agent", id, cwd: `/work/${id}`, status: "ready", unreadDone: false, ...overrides };
}

let omp: MockOmp;

beforeEach(() => {
	omp = installMockOmp();
});

afterEach(() => {
	vi.restoreAllMocks();
	delete (globalThis as Record<string, unknown>).window;
	useTabsStore.getState().reset();
	useSessionStore.getState().reset();
	useUiStore.setState({ armedCloseTab: null, worktreeClosePrompt: null });
});

describe("tabNeedsCloseConfirm", () => {
	const idle = { activeTabId: "a", streaming: false, compacting: false };

	it("arms any tab whose run, compaction, or boot is still in flight", () => {
		expect(tabNeedsCloseConfirm(tab("a", { status: "running" }), idle)).toBe(true);
		expect(tabNeedsCloseConfirm(tab("a", { status: "ready", compacting: true }), idle)).toBe(true);
		expect(tabNeedsCloseConfirm(tab("a", { status: "starting" }), idle)).toBe(true);
	});

	it("arms the foreground tab from the live stream the status push has not reported yet", () => {
		expect(tabNeedsCloseConfirm(tab("a"), { activeTabId: "a", streaming: true, compacting: false })).toBe(true);
		// …and only the foreground one: a background tab's run arrives as
		// status "running", so the active-tab stream says nothing about it.
		expect(tabNeedsCloseConfirm(tab("b"), { activeTabId: "a", streaming: true, compacting: false })).toBe(false);
	});

	it("leaves settled tabs alone", () => {
		expect(tabNeedsCloseConfirm(tab("a"), idle)).toBe(false);
		expect(tabNeedsCloseConfirm(tab("a", { unreadDone: true }), idle)).toBe(false);
		expect(tabNeedsCloseConfirm(tab("a", { status: "error" }), idle)).toBe(false);
		// A restored tab with no process cannot lose work; ⌘W must close it flat.
		expect(tabNeedsCloseConfirm(tab("a", { status: "asleep" }), idle)).toBe(false);
	});
});

describe("closeActiveTab", () => {
	it("hands ⌘W to the window at the single-tab floor", async () => {
		useTabsStore.setState({ tabs: [tab("only")], activeTabId: "only" });

		expect(closeActiveTab()).toBe("window");
		expect(window.close).toHaveBeenCalledTimes(1);
		expect(omp.tabs.close).not.toHaveBeenCalled();
		expect(useTabsStore.getState().tabs).toHaveLength(1);
	});

	it("arms a live tab on the first press and closes it on the second", async () => {
		useTabsStore.setState({ tabs: [tab("a", { status: "running" }), tab("b")], activeTabId: "a" });

		expect(closeActiveTab()).toBe("armed");
		expect(useUiStore.getState().armedCloseTab).toEqual({ tabId: "a" });
		expect(omp.tabs.close).not.toHaveBeenCalled();

		expect(closeActiveTab()).toBe("closed");
		await vi.waitFor(() => expect(omp.tabs.close).toHaveBeenCalledWith("a"));
		expect(useUiStore.getState().armedCloseTab).toBeNull();
		expect(useTabsStore.getState().tabs.map(entry => entry.id)).toEqual(["b"]);
	});

	it("routes a worktree tab's close to the cleanup prompt instead of dropping the checkout", async () => {
		useTabsStore.setState({
			tabs: [tab("a", { worktree: { name: "fix", branch: "omp/gui/fix", baseCwd: "/work/base" } }), tab("b")],
			activeTabId: "a",
		});

		expect(closeActiveTab()).toBe("worktree-prompt");
		expect(useUiStore.getState().worktreeClosePrompt).toEqual({ tabId: "a" });
		expect(omp.tabs.close).not.toHaveBeenCalled();
		expect(useTabsStore.getState().tabs).toHaveLength(2);
	});

	it("closes an idle tab with no confirm interlude", async () => {
		useTabsStore.setState({ tabs: [tab("a"), tab("b")], activeTabId: "a" });

		expect(closeActiveTab()).toBe("closed");
		await vi.waitFor(() => expect(omp.tabs.close).toHaveBeenCalledWith("a"));
	});

	it("does nothing without an active tab", () => {
		useTabsStore.setState({ tabs: [tab("a")], activeTabId: null });

		expect(closeActiveTab()).toBe("nothing");
		expect(window.close).not.toHaveBeenCalled();
		expect(omp.tabs.close).not.toHaveBeenCalled();
	});
});

describe("performTabClose", () => {
	it("clears a pending arm left on another tab before closing", async () => {
		useTabsStore.setState({ tabs: [tab("a"), tab("b")], activeTabId: "a" });
		useUiStore.getState().armCloseTab("a");

		expect(performTabClose(tab("b"))).toBe("closed");
		expect(useUiStore.getState().armedCloseTab).toBeNull();
		await vi.waitFor(() => expect(omp.tabs.close).toHaveBeenCalledWith("b"));
	});
});
