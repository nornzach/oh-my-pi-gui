import type {
	AgentMessage,
	ImageContent,
	RpcResponse,
	RpcSessionTreeNode,
	RpcSessionTreeResult,
} from "../../shared/rpc-types";
import { hydrateSession, resetRetryPending } from "../hooks/use-rpc-events";
import { useMessagesStore } from "../stores/messages";
import { useSessionStore } from "../stores/session";
import { useTabsStore } from "../stores/tabs";
import { toast } from "../stores/toast";
import { useUiStore } from "../stores/ui";
import { translate } from "./i18n";

/**
 * Message-level actions shared between the command palette and the global
 * keyboard shortcuts (App.tsx), so both ride the same retry semantics.
 */

/**
 * Display-worthy model text. Punctuation/whitespace-only fragments (".",
 * "…", "---") are provider/model filler between tool calls, while letters,
 * numbers, and emoji are user-visible content in any script.
 */
const MESSAGE_TEXT_CONTENT_CHAR = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;
export function isRenderableMessageText(text: string): boolean {
	return MESSAGE_TEXT_CONTENT_CHAR.test(text);
}
/** Plain-text content of a message (user text lives in text blocks). */
export function messageText(message: AgentMessage): string {
	if (typeof message.content === "string") return message.content.trim();
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter(part => part.type === "text")
		.map(part => (part.type === "text" ? part.text : ""))
		.join("\n")
		.trim();
}

function messagePreview(message: AgentMessage): string {
	const text = messageText(message).replace(/\s+/g, " ").trim();
	return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/**
 * Retry the last turn: re-send the most recent user message, interrupting the
 * active turn when streaming (TUI app.retry parity). `onEmpty` fires when the
 * session has no user message to retry; RPC failures throw for the caller to
 * surface.
 */
export async function retryLastTurn(onEmpty: () => void): Promise<void> {
	const { messages } = useMessagesStore.getState();
	const lastUser = [...messages].reverse().find(message => message.role === "user");
	const text = lastUser ? messageText(lastUser) : "";
	if (!text) {
		onEmpty();
		return;
	}
	const streaming = useSessionStore.getState().isStreaming;
	const response = streaming ? await window.omp.rpc.abortAndPrompt(text) : await window.omp.rpc.prompt(text);
	if (!response.success) throw new Error(response.error);
}

/** Abort the active turn and synchronously retire any live retry UI. */
export async function abortActiveTurn(): Promise<RpcResponse> {
	const retrying = useSessionStore.getState().retryInfo !== null;
	if (retrying) {
		resetRetryPending();
		useSessionStore.setState({ retryInfo: null, awaitingModelSince: null });
		try {
			await window.omp.rpc.abortRetry();
		} catch {
			// Generic abort below also cancels retry server-side.
		}
	}
	return window.omp.rpc.abort();
}

/** Branch from a user entry, restoring its draft and refreshing the session. */
export async function branchSessionFromEntry(entryId: string): Promise<"branched" | "cancelled"> {
	const response = await window.omp.rpc.branch(entryId);
	if (!response.success) throw new Error(response.error);
	const data = response.data as { cancelled?: boolean; text?: string } | undefined;
	if (data?.cancelled) return "cancelled";
	if (data?.text !== undefined) {
		window.dispatchEvent(new CustomEvent("omp:fill-composer", { detail: { text: data.text } }));
	}
	await hydrateSession();
	return "branched";
}

/** Copy the tree path through one message into an independent session and open it in a new tab. */
export async function forkSessionFromEntryInNewTab(
	entryId: string,
	sourceTabId = useTabsStore.getState().activeTabId,
): Promise<"opened" | "saved"> {
	const tabs = useTabsStore.getState();
	if (!sourceTabId || tabs.activeTabId !== sourceTabId || useUiStore.getState().switchPending !== null) {
		throw new Error("The active session changed while preparing the branch");
	}
	const sourceTab = tabs.tabs.find(tab => tab.id === sourceTabId);
	if (!sourceTab) throw new Error("The source session is no longer open");
	const response = await window.omp.rpc.forkFrom(entryId);
	if (!response.success) throw new Error(response.error);
	const data = response.data as { sessionPath?: string } | undefined;
	if (!data?.sessionPath) throw new Error("fork_from did not return a session path");
	if (useTabsStore.getState().activeTabId !== sourceTabId || useUiStore.getState().switchPending !== null) {
		return "saved";
	}
	const tabId = await useTabsStore.getState().openTab({
		cwd: sourceTab.cwd,
		sessionPath: data.sessionPath,
		kind: sourceTab.kind,
	});
	return tabId ? "opened" : "saved";
}

/** Resolve legacy transcript messages through the active OMP session tree, then fork them. */
export async function forkSessionFromMessageInNewTab(message: AgentMessage): Promise<"opened" | "saved"> {
	const sourceTabId = useTabsStore.getState().activeTabId;
	if (!sourceTabId || useUiStore.getState().switchPending !== null) {
		throw new Error("The active session changed while preparing the branch");
	}
	let entryId = message.entryId;
	if (!entryId) {
		const response = await window.omp.rpc.getSessionTree();
		if (!response.success) throw new Error(response.error);
		const data = response.data as RpcSessionTreeResult | undefined;
		const timestamp =
			typeof message.timestamp === "number" ? message.timestamp : Date.parse(message.timestamp ?? "") || 0;
		const candidates = (data?.tree ?? []).filter(
			(node: RpcSessionTreeNode) => node.onActiveBranch && node.role === message.role,
		);
		const timestampMatches = timestamp === 0 ? [] : candidates.filter(node => node.timestamp === timestamp);
		if (timestampMatches.length === 1) entryId = timestampMatches[0]?.entryId;
		const preview = messagePreview(message);
		const previewMatches = candidates.filter(node => node.textPreview === preview);
		if (!entryId && previewMatches.length === 1) entryId = previewMatches[0]?.entryId;
		if (!entryId && previewMatches.length > 1) {
			const transcript = useMessagesStore.getState().messages;
			const targetIndex = transcript.indexOf(message);
			if (targetIndex >= 0) {
				let occurrence = 0;
				for (let index = 0; index < targetIndex; index++) {
					const candidate = transcript[index];
					if (candidate?.role === message.role && messagePreview(candidate) === preview) occurrence++;
				}
				entryId = previewMatches[occurrence]?.entryId;
			}
		}
	}
	if (!entryId) throw new Error("Could not locate this message in the active session tree");
	return forkSessionFromEntryInNewTab(entryId, sourceTabId);
}

/** One queued steer/follow-up message pulled back by the dequeue RPC. */
interface DequeuedMessage {
	text: string;
	images?: ImageContent[];
	mode: "steer" | "followUp";
}

/**
 * Restore queued messages into the composer (TUI app.message.dequeue / Alt+Up
 * parity): the RPC drains every user-authored queued steer/follow-up in their
 * cross-lane enqueue order (oldest first); the last (newest) goes back into
 * the composer for editing — text prepended ahead of any draft, images
 * appended to the image strip — and earlier messages are re-queued through
 * their original delivery lane, in order. `onEmpty` fires when nothing was
 * queued; RPC failures throw for the caller to surface.
 */
export async function restoreQueuedMessages(onEmpty: () => void): Promise<void> {
	const response = await window.omp.rpc.dequeue();
	if (!response.success) throw new Error(response.error);
	const data = response.data as { messages?: DequeuedMessage[] } | undefined;
	const messages = data?.messages ?? [];
	if (messages.length === 0) {
		onEmpty();
		return;
	}
	const restored = messages[messages.length - 1];
	// Fill the composer first so the message being edited is safe even if a
	// re-queue below fails; InputArea owns the "omp:fill-composer" listener.
	window.dispatchEvent(
		new CustomEvent("omp:fill-composer", {
			detail: { text: restored.text, images: restored.images, prepend: true },
		}),
	);
	// Re-queue sequentially through each message's original delivery lane.
	for (const queued of messages.slice(0, -1)) {
		const requeue =
			queued.mode === "steer"
				? await window.omp.rpc.steer(queued.text, queued.images)
				: await window.omp.rpc.followUp(queued.text, queued.images);
		if (!requeue.success) throw new Error(requeue.error);
	}
}

/**
 * Clear the conversation context in place (TUI /clear parity via the
 * clear_context RPC): drops the context, keeps the session id and transcript
 * file. Refused with a warning while streaming / a foreground execution runs
 * (server code "busy"); on success rehydrates the transcript + context bar
 * and reports the dropped count. Returns whether the context was cleared.
 */
export async function clearSessionContext(): Promise<boolean> {
	const response = await window.omp.rpc.clearContext();
	if (!response.success) {
		toast({ variant: "warning", message: response.error });
		return false;
	}
	const data = response.data as { droppedCount?: number } | undefined;
	toast({ variant: "success", message: translate("input.clear.done", { count: data?.droppedCount ?? 0 }) });
	await hydrateSession();
	return true;
}
