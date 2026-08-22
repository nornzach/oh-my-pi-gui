import { create } from "zustand";
import type { AgentMessage, AgentSessionEvent, MessagesPage } from "../../shared/rpc-types";

/**
 * Session-tab snapshot of the message stream: the zustand fields PLUS the
 * streaming fields and run-dedupe set. The accumulated strings are sufficient
 * to resume after a tab switch; keeping a second chunk-array copy only made
 * every snapshot and every join progressively more expensive.
 */
export interface MessagesSnapshot {
	messages: AgentMessage[];
	lastAppended: AgentMessage[];
	streamingMessage: AgentMessage | null;
	streamingText: string;
	streamingThinking: string;
	totalMessages: number;
	nextCursor: string | undefined;
	isLoadingPage: boolean;
	deliveredKeys: string[];
}

interface MessagesStore {
	messages: AgentMessage[];
	/**
	 * Messages appended by the most recent applyEvents/appendMessage call —
	 * the voice auto-speak watcher's clean signal: hydration/pagination
	 * replaces `messages` wholesale without touching this field, so watchers
	 * only ever see genuinely new finalized messages (never history).
	 */
	lastAppended: AgentMessage[];
	streamingMessage: AgentMessage | null;
	streamingText: string;
	streamingThinking: string;
	totalMessages: number;
	nextCursor: string | undefined;
	isLoadingPage: boolean;
	applyEvents: (events: AgentSessionEvent[]) => void;
	loadPage: (page: MessagesPage) => void;
	appendMessage: (message: AgentMessage) => void;
	removeMessage: (message: AgentMessage) => void;
	/** Clear the live-stream slice and chunk buffers without touching history —
	 * for a run that settled unseen (background tab: its message_end/agent_end
	 * never forwarded), where hydrate's transcript merge owns the final content. */
	clearStreaming: () => void;
	/**
	 * Apply a fetched transcript. When delivery identities match the current
	 * prefix, patch in place instead of replacing the array (avoids a second
	 * paint after tab restore). A different identity sequence replaces wholesale.
	 */
	reconcileFetched: (fetched: AgentMessage[]) => void;
	/** Capture the full stream state (fields + buffers) for a session-tab switch. */
	snapshot: () => MessagesSnapshot;
	/** Restore a captured snapshot; null resets to the empty initial state. */
	restoreSnapshot: (snapshot: MessagesSnapshot | null) => void;
	reset: () => void;
}

const initialState = {
	messages: [] as AgentMessage[],
	lastAppended: [] as AgentMessage[],
	streamingMessage: null as AgentMessage | null,
	streamingText: "",
	streamingThinking: "",
	totalMessages: 0,
	nextCursor: undefined as string | undefined,
	isLoadingPage: false,
};

function assistantToolCallIds(message: AgentMessage): string[] {
	if (message.role !== "assistant") return [];
	const content: unknown = message.content;
	if (!Array.isArray(content)) return [];
	const blocks: unknown[] = content;
	const ids: string[] = [];
	for (const block of blocks) {
		if (
			block !== null &&
			typeof block === "object" &&
			"type" in block &&
			block.type === "toolCall" &&
			"id" in block &&
			typeof block.id === "string"
		) {
			ids.push(block.id);
		}
	}
	return ids;
}

/**
 * Delivery identity for run-local dedupe. Message content is intentionally
 * excluded: post-turn maintenance may rewrite a tool result (for example,
 * replacing its full text with a shake marker) before `agent_end` re-delivers
 * the run. Those are two representations of one message, not two transcript
 * entries.
 *
 * Provider response ids and tool-call ids strengthen the timestamp identity
 * where the wire exposes them.
 */
export function messageIdentityKey(message: AgentMessage): string {
	const stableId =
		message.role === "assistant"
			? [message.responseId ?? null, assistantToolCallIds(message)]
			: message.role === "toolResult"
				? message.toolCallId
				: null;
	return JSON.stringify([message.role, stableId, message.timestamp]);
}

/** True when `fetched` starts with the same delivery identities as `current`. */
export function sameIdentityPrefix(current: AgentMessage[], fetched: AgentMessage[]): boolean {
	const limit = Math.min(current.length, fetched.length);
	if (limit === 0) return current.length === 0 && fetched.length === 0;
	for (let i = 0; i < limit; i++) {
		const left = current[i];
		const right = fetched[i];
		if (!left || !right || messageIdentityKey(left) !== messageIdentityKey(right)) return false;
	}
	return true;
}

/**
 * Keys of messages appended during the current agent run. turn_end re-sends
 * the turn's assistant message (already appended via message_end), and batch
 * boundaries make a batch-local guard insufficient — dedupe run-wide.
 */
let deliveredThisRun = new Set<string>();

/**
 * Merge run-scoped agent_end messages onto the transcript. Messages streamed
 * live via message_end (or hydrated mid-run) already form a suffix of the
 * current list, so find the longest delivery-identity prefix of `run` matching
 * that suffix and append only the remainder. History is never replaced.
 */
function mergeRunMessages(current: AgentMessage[], run: AgentMessage[]): AgentMessage[] {
	if (run.length === 0) return current;
	if (current.length === 0) return run;
	const maxOverlap = Math.min(current.length, run.length);
	const runKeys = run.map(messageIdentityKey);
	const currentTailKeys = current.slice(current.length - maxOverlap).map(messageIdentityKey);
	let overlap = 0;
	for (let k = maxOverlap; k > 0; k--) {
		let match = true;
		for (let i = 0; i < k; i++) {
			if (currentTailKeys[maxOverlap - k + i] !== runKeys[i]) {
				match = false;
				break;
			}
		}
		if (match) {
			overlap = k;
			break;
		}
	}
	const merged = [...current];
	let changed = overlap < run.length;
	for (let index = 0; index < overlap; index++) {
		const currentIndex = current.length - overlap + index;
		const entryId = run[index]?.entryId;
		if (!entryId || merged[currentIndex]?.entryId === entryId) continue;
		merged[currentIndex] = { ...merged[currentIndex], entryId };
		changed = true;
	}
	if (overlap < run.length) merged.push(...run.slice(overlap));
	return changed ? merged : current;
}

export const useMessagesStore = create<MessagesStore>()((set, get) => ({
	...initialState,
	applyEvents: events => {
		let textAccum = "";
		let thinkAccum = "";
		const newMessages: AgentMessage[] = [];
		let runMessages: AgentMessage[] | null = null;
		let streamingStart: AgentMessage | null = null;
		let streamingEnd = false;

		for (const event of events) {
			switch (event.type) {
				case "agent_start": {
					deliveredThisRun = new Set();
					break;
				}
				case "message_start": {
					streamingStart = event.message;
					textAccum = "";
					thinkAccum = "";
					break;
				}
				case "message_update": {
					const { assistantMessageEvent } = event;
					if (assistantMessageEvent.type === "text_delta") {
						textAccum += assistantMessageEvent.delta;
					} else if (assistantMessageEvent.type === "thinking_delta") {
						thinkAccum += assistantMessageEvent.delta;
					}
					break;
				}
				case "message_end": {
					newMessages.push(event.message);
					deliveredThisRun.add(messageIdentityKey(event.message));
					streamingEnd = true;
					break;
				}
				case "agent_end": {
					// Wire sends run-scoped newMessages, NOT the full transcript —
					// append-merge onto history, never replace.
					if (event.messages) {
						runMessages = event.messages;
					}
					break;
				}
				case "turn_end": {
					// turn_end re-delivers the turn's assistant message; append only
					// when this run has not already delivered it via message_end.
					if (event.message) {
						const key = messageIdentityKey(event.message);
						if (!deliveredThisRun.has(key)) {
							newMessages.push(event.message);
							deliveredThisRun.add(key);
						}
					}
					break;
				}
				default:
					break;
			}
		}

		// Single set() call per batch — one React re-render
		const state = get();
		const patch: Partial<MessagesStore> = {};

		if (streamingStart) {
			patch.streamingMessage = streamingStart;
			patch.streamingText = "";
			patch.streamingThinking = "";
		}
		if (textAccum) {
			patch.streamingText = `${streamingStart ? "" : state.streamingText}${textAccum}`;
		}
		if (thinkAccum) {
			patch.streamingThinking = `${streamingStart ? "" : state.streamingThinking}${thinkAccum}`;
		}

		let messages = state.messages;
		if (newMessages.length > 0) {
			messages = [...messages, ...newMessages];
		}
		if (runMessages) {
			messages = mergeRunMessages(messages, runMessages);
		}
		if (messages !== state.messages) {
			patch.messages = messages;
			patch.totalMessages = state.totalMessages + (messages.length - state.messages.length);
			// Both paths above are append-only, so everything beyond the prior
			// length is new (message_end/turn_end/agent_end deliveries).
			const appended = messages.slice(state.messages.length);
			if (appended.length > 0) patch.lastAppended = appended;
		}

		if (streamingEnd || runMessages) {
			patch.streamingMessage = null;
			patch.streamingText = "";
			patch.streamingThinking = "";
		}

		if (Object.keys(patch).length > 0) {
			set(patch);
		}
	},
	loadPage: page =>
		set({
			messages: page.messages,
			lastAppended: [],
			totalMessages: page.totalMessages,
			nextCursor: page.nextCursor,
			isLoadingPage: false,
		}),
	appendMessage: message =>
		set(s => ({ messages: [...s.messages, message], lastAppended: [message], totalMessages: s.totalMessages + 1 })),
	/** Drop a locally appended placeholder (e.g. the composer's running-eval bubble) by identity. */
	removeMessage: message =>
		set(s => {
			const messages = s.messages.filter(entry => entry !== message);
			const removed = s.messages.length - messages.length;
			if (removed === 0) return s;
			return { messages, totalMessages: Math.max(0, s.totalMessages - removed) };
		}),
	clearStreaming: () => {
		set({ streamingMessage: null, streamingText: "", streamingThinking: "" });
	},
	reconcileFetched: fetched => {
		const current = get().messages;
		if (sameIdentityPrefix(current, fetched)) {
			if (fetched.length === current.length) {
				let changed = false;
				const next = current.map((message, index) => {
					const incoming = fetched[index];
					if (!incoming || incoming === message) return message;
					changed = true;
					return incoming;
				});
				if (!changed) return;
				set({ messages: next, totalMessages: next.length });
				return;
			}
			if (fetched.length > current.length) {
				set({ messages: [...current, ...fetched.slice(current.length)], totalMessages: fetched.length });
				return;
			}
		}
		set({ messages: fetched, totalMessages: fetched.length });
	},
	snapshot: () => {
		const state = get();
		return {
			messages: state.messages,
			lastAppended: state.lastAppended,
			streamingMessage: state.streamingMessage,
			streamingText: state.streamingText,
			streamingThinking: state.streamingThinking,
			totalMessages: state.totalMessages,
			nextCursor: state.nextCursor,
			isLoadingPage: state.isLoadingPage,
			deliveredKeys: [...deliveredThisRun],
		};
	},
	restoreSnapshot: snapshot => {
		if (!snapshot) {
			get().reset();
			return;
		}
		deliveredThisRun = new Set(snapshot.deliveredKeys);
		set({
			messages: snapshot.messages,
			lastAppended: snapshot.lastAppended,
			streamingMessage: snapshot.streamingMessage,
			streamingText: snapshot.streamingText,
			streamingThinking: snapshot.streamingThinking,
			totalMessages: snapshot.totalMessages,
			nextCursor: snapshot.nextCursor,
			isLoadingPage: snapshot.isLoadingPage,
		});
	},
	reset: () => {
		deliveredThisRun = new Set();
		set(initialState);
	},
}));
