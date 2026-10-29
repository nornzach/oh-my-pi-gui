import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcSessionTreeNode } from "../../shared/rpc-types";
import { useMessagesStore } from "../stores/messages";
import { useSessionStore } from "../stores/session";
import { useTabsStore } from "../stores/tabs";
import {
	abortActiveTurn,
	editFromMessage,
	forkSessionFromEntryInNewTab,
	forkSessionFromMessageInNewTab,
	restoreQueuedMessages,
	splitReaction,
} from "./messages";

interface FillComposerDetail {
	text?: string;
	images?: unknown[];
	prepend?: boolean;
	tabId?: string;
}

interface SessionTreeResponse {
	success: true;
	data: { tree: RpcSessionTreeNode[]; activeLeafId: string | null };
}

function installWindow(messages: Array<{ text: string; mode: "steer" | "followUp" }>) {
	const deliveryOrder: string[] = [];
	let fillDetail: FillComposerDetail | undefined;
	const rpc = {
		abort: vi.fn(async () => ({ success: true as const })),
		abortRetry: vi.fn(async () => ({ success: true as const })),
		dequeue: vi.fn(async () => ({ success: true as const, data: { messages } })),
		steer: vi.fn(async (text: string) => {
			deliveryOrder.push(`steer:${text}`);
			return { success: true as const };
		}),
		followUp: vi.fn(async (text: string) => {
			deliveryOrder.push(`followUp:${text}`);
			return { success: true as const };
		}),
		forkFrom: vi.fn(async () => ({
			success: true as const,
			data: { sessionPath: "/sessions/branch.jsonl", sessionId: "branch-session" },
		})),
		getSessionTree: vi.fn(
			async (): Promise<SessionTreeResponse> => ({
				success: true,
				data: { tree: [], activeLeafId: null },
			}),
		),
	};
	(globalThis as Record<string, unknown>).window = {
		omp: { rpc },
		dispatchEvent: (event: CustomEvent<FillComposerDetail>) => {
			fillDetail = event.detail;
			return true;
		},
	};
	return { rpc, deliveryOrder, fillDetail: () => fillDetail };
}

afterEach(() => {
	delete (globalThis as Record<string, unknown>).window;
	useMessagesStore.getState().reset();
	useSessionStore.getState().reset();
	useTabsStore.getState().reset();
	useSessionStore.setState({ switchPending: null });
	vi.restoreAllMocks();
});

describe("splitReaction", () => {
	it("keeps a complete emoji grapheme together and removes its following whitespace", () => {
		expect(splitReaction("👨‍👩‍👧‍👦 \n\nDone")).toEqual({ emoji: "👨‍👩‍👧‍👦", body: "\nDone" });
		expect(splitReaction("1. First")).toEqual({ body: "1. First" });
	});
});

describe("forkSessionFromEntryInNewTab", () => {
	it("copies the tree path and opens the independent session in the source tab kind", async () => {
		const harness = installWindow([]);
		useSessionStore.setState({ cwd: "/project" });
		useTabsStore.setState({
			activeTabId: "source-tab",
			tabs: [
				{
					id: "source-tab",
					cwd: "/project",
					status: "ready",
					kind: "chat",
					unreadDone: false,
				},
			],
		});
		const openTab = vi.spyOn(useTabsStore.getState(), "openTab").mockResolvedValue("branch-tab");

		expect(await forkSessionFromEntryInNewTab("assistant-entry")).toBe("opened");
		expect(harness.rpc.forkFrom).toHaveBeenCalledWith("assistant-entry");
		expect(openTab).toHaveBeenCalledWith({
			cwd: "/project",
			sessionPath: "/sessions/branch.jsonl",
			kind: "chat",
		});
	});

	it("resolves a legacy transcript message by content when its tree timestamp differs", async () => {
		const harness = installWindow([]);
		useTabsStore.setState({
			activeTabId: "source-tab",
			tabs: [{ id: "source-tab", cwd: "/project", status: "ready", kind: "agent", unreadDone: false }],
		});
		const timestamp = "2026-08-21T06:38:00.000Z";
		harness.rpc.getSessionTree.mockResolvedValue({
			success: true as const,
			data: {
				activeLeafId: "assistant-entry",
				tree: [
					{
						entryId: "assistant-entry",
						parentId: "user-entry",
						role: "assistant",
						textPreview: "legacy answer",
						timestamp: Date.parse(timestamp) + 1_000,
						onActiveBranch: true,
						isLeaf: true,
					},
				],
			},
		});
		vi.spyOn(useTabsStore.getState(), "openTab").mockResolvedValue("branch-tab");

		await forkSessionFromMessageInNewTab({
			role: "assistant",
			content: [{ type: "text", text: "legacy answer" }],
			timestamp,
		});

		expect(harness.rpc.getSessionTree).toHaveBeenCalledTimes(1);
		expect(harness.rpc.forkFrom).toHaveBeenCalledWith("assistant-entry");
	});

	it("resolves repeated legacy messages by their transcript occurrence", async () => {
		const harness = installWindow([]);
		useTabsStore.setState({
			activeTabId: "source-tab",
			tabs: [{ id: "source-tab", cwd: "/project", status: "ready", kind: "agent", unreadDone: false }],
		});
		const first = { role: "user" as const, content: "continue", timestamp: 1 };
		const second = { role: "user" as const, content: "continue", timestamp: 2 };
		useMessagesStore.setState({ messages: [first, second] });
		harness.rpc.getSessionTree.mockResolvedValue({
			success: true as const,
			data: {
				activeLeafId: "second-entry",
				tree: [
					{
						entryId: "first-entry",
						parentId: null,
						role: "user",
						textPreview: "continue",
						timestamp: 10,
						onActiveBranch: true,
						isLeaf: false,
					},
					{
						entryId: "second-entry",
						parentId: "first-entry",
						role: "user",
						textPreview: "continue",
						timestamp: 20,
						onActiveBranch: true,
						isLeaf: true,
					},
				],
			},
		});
		vi.spyOn(useTabsStore.getState(), "openTab").mockResolvedValue("branch-tab");

		await forkSessionFromMessageInNewTab(second);

		expect(harness.rpc.forkFrom).toHaveBeenCalledWith("second-entry");
	});

	it("does not send fork_from after the source tab changes", async () => {
		const harness = installWindow([]);
		useTabsStore.setState({
			activeTabId: "source-tab",
			tabs: [
				{ id: "source-tab", cwd: "/source", status: "ready", kind: "agent", unreadDone: false },
				{ id: "other-tab", cwd: "/other", status: "ready", kind: "agent", unreadDone: false },
			],
		});
		const tree = Promise.withResolvers<SessionTreeResponse>();
		harness.rpc.getSessionTree.mockReturnValue(tree.promise);
		const branch = forkSessionFromMessageInNewTab({ role: "user", content: "question", timestamp: 1 });
		useTabsStore.setState({ activeTabId: "other-tab" });
		tree.resolve({
			success: true,
			data: {
				activeLeafId: "user-entry",
				tree: [
					{
						entryId: "user-entry",
						parentId: null,
						role: "user",
						textPreview: "question",
						timestamp: 1,
						onActiveBranch: true,
						isLeaf: true,
					},
				],
			},
		});

		await expect(branch).rejects.toThrow("active session changed");
		expect(harness.rpc.forkFrom).not.toHaveBeenCalled();
	});

	it("does not steal focus when the user switches tabs while fork_from is running", async () => {
		const harness = installWindow([]);
		useTabsStore.setState({
			activeTabId: "source-tab",
			tabs: [
				{ id: "source-tab", cwd: "/source", status: "ready", kind: "agent", unreadDone: false },
				{ id: "other-tab", cwd: "/other", status: "ready", kind: "agent", unreadDone: false },
			],
		});
		const fork = Promise.withResolvers<{
			success: true;
			data: { sessionPath: string; sessionId: string };
		}>();
		harness.rpc.forkFrom.mockReturnValue(fork.promise);
		const openTab = vi.spyOn(useTabsStore.getState(), "openTab").mockResolvedValue("branch-tab");
		const branch = forkSessionFromEntryInNewTab("user-entry");
		useTabsStore.setState({ activeTabId: "other-tab" });
		fork.resolve({ success: true, data: { sessionPath: "/sessions/branch.jsonl", sessionId: "branch-session" } });

		expect(await branch).toBe("saved");
		expect(openTab).not.toHaveBeenCalled();
	});
});

describe("editFromMessage", () => {
	it("branches the bubble's own tab before the message and refills that tab's composer", async () => {
		const harness = installWindow([]);
		const branch = vi.fn(async (_entryId: string) => ({
			type: "response" as const,
			command: "branch",
			success: true as const,
			data: { text: "original prompt", cancelled: false },
		}));
		const getSessionTree = vi.fn();
		const result = await editFromMessage(
			{ role: "user", content: "original prompt", timestamp: 1, entryId: "user-entry" },
			{ branch, getSessionTree },
			"pane-tab",
		);
		expect(result).toBe("branched");
		expect(getSessionTree).not.toHaveBeenCalled();
		expect(branch).toHaveBeenCalledWith("user-entry");
		expect(harness.fillDetail()).toEqual({ text: "original prompt", tabId: "pane-tab" });
	});

	it("reports a cancelled branch without touching the composer", async () => {
		const harness = installWindow([]);
		const branch = vi.fn(async (_entryId: string) => ({
			type: "response" as const,
			command: "branch",
			success: true as const,
			data: { text: "", cancelled: true },
		}));
		const result = await editFromMessage(
			{ role: "user", content: "x", timestamp: 1, entryId: "user-entry" },
			{ branch, getSessionTree: vi.fn() },
			"pane-tab",
		);
		expect(result).toBe("cancelled");
		expect(harness.fillDetail()).toBeUndefined();
	});

	it("surfaces a refused branch", async () => {
		installWindow([]);
		const branch = vi.fn(async (_entryId: string) => ({
			type: "response" as const,
			command: "branch",
			success: false as const,
			error: "Agent is busy",
		}));
		await expect(
			editFromMessage(
				{ role: "user", content: "x", timestamp: 1, entryId: "e" },
				{ branch, getSessionTree: vi.fn() },
			),
		).rejects.toThrow("Agent is busy");
	});
});

describe("abortActiveTurn", () => {
	it("clears a retry immediately and cancels it before aborting the turn", async () => {
		const harness = installWindow([]);
		const retryAbort = Promise.withResolvers<{ success: true }>();
		harness.rpc.abortRetry.mockReturnValue(retryAbort.promise);
		useSessionStore.setState({
			isStreaming: true,
			awaitingModelSince: Date.now(),
			retryInfo: { attempt: 1, maxAttempts: 10, delayMs: 5_000, errorMessage: "timeout", startedAt: Date.now() },
		});

		const aborting = abortActiveTurn();

		expect(useSessionStore.getState().retryInfo).toBeNull();
		expect(useSessionStore.getState().awaitingModelSince).toBeNull();
		expect(harness.rpc.abortRetry).toHaveBeenCalledTimes(1);
		expect(harness.rpc.abort).not.toHaveBeenCalled();

		retryAbort.resolve({ success: true });
		await aborting;

		expect(harness.rpc.abort).toHaveBeenCalledTimes(1);
		expect(harness.rpc.abortRetry.mock.invocationCallOrder[0]).toBeLessThan(
			harness.rpc.abort.mock.invocationCallOrder[0],
		);
	});
});

describe("restoreQueuedMessages", () => {
	it("restores the newest item and preserves each earlier delivery lane and order", async () => {
		const harness = installWindow([
			{ text: "older follow-up", mode: "followUp" },
			{ text: "newer steer", mode: "steer" },
			{ text: "newest follow-up", mode: "followUp" },
		]);

		await restoreQueuedMessages(() => {
			throw new Error("queue unexpectedly empty");
		});

		expect(harness.fillDetail()).toMatchObject({ text: "newest follow-up", prepend: true });
		expect(harness.deliveryOrder).toEqual(["followUp:older follow-up", "steer:newer steer"]);
		expect(harness.rpc.followUp).toHaveBeenCalledTimes(1);
		expect(harness.rpc.steer).toHaveBeenCalledTimes(1);
	});

	it("reports an empty queue without dispatching or re-queuing", async () => {
		const harness = installWindow([]);
		const onEmpty = vi.fn();

		await restoreQueuedMessages(onEmpty);

		expect(onEmpty).toHaveBeenCalledTimes(1);
		expect(harness.fillDetail()).toBeUndefined();
		expect(harness.deliveryOrder).toEqual([]);
	});
});
