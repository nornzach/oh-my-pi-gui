import { createStore } from "zustand/vanilla";
import type { AgentMessage, AgentSessionEvent, MessagesPage } from "../../shared/rpc-types";
import { messageIdentity, sameMessageContent } from "../lib/message-identity";
import { createScopedStoreHook } from "./session-runtime-context";

/**
 * Session-tab snapshot of committed history plus the active run overlay. The
 * accumulated strings are sufficient
 * to resume after a tab switch; keeping a second chunk-array copy only made
 * every snapshot and every join progressively more expensive.
 */
export interface MessagesSnapshot {
	messages: AgentMessage[];
	liveMessages: AgentMessage[];
	lastAppended: AgentMessage[];
	streamingMessage: AgentMessage | null;
	streamingText: string;
	streamingThinking: string;
	totalMessages: number;
	nextCursor: string | undefined;
	isLoadingPage: boolean;
}

export interface MessagesStore {
	messages: AgentMessage[];
	/** Uncommitted local echo and message_end deliveries for the active run. */
	liveMessages: AgentMessage[];
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
	/**
	 * A settled run left delivered rows its agent_end did not commit (a retried
	 * or continued run reports only its own messages). They were kept in
	 * `messages` without entry ids; the next transcript fetch replaces them.
	 */
	needsTranscriptSync: boolean;
	applyEvents: (events: AgentSessionEvent[]) => void;
	loadPage: (page: MessagesPage) => void;
	appendMessage: (message: AgentMessage) => void;
	removeMessage: (message: AgentMessage) => void;
	appendLiveMessage: (message: AgentMessage) => void;
	removeLiveMessage: (message: AgentMessage) => void;
	/** Clear partial assistant stream buffers without touching committed or live rows. */
	clearStreaming: () => void;
	/** Drop delivered live rows after an idle transcript hydrate; keep unsent local echo. */
	clearDeliveredLiveMessages: () => void;
	/**
	 * Apply a fetched committed transcript. In-flight stable rows are merged by
	 * mergeFetchedTranscript before this replacement.
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
	liveMessages: [] as AgentMessage[],
	lastAppended: [] as AgentMessage[],
	streamingMessage: null as AgentMessage | null,
	streamingText: "",
	streamingThinking: "",
	totalMessages: 0,
	nextCursor: undefined as string | undefined,
	isLoadingPage: false,
	needsTranscriptSync: false,
};

function isOptimisticUser(message: AgentMessage): boolean {
	return message.role === "user" && message.optimistic === true;
}

/**
 * A transcript fetch answered after the run persisted this message but before
 * its batched message_end arrived: the committed row already shows it.
 */
function alreadyCommitted(message: AgentMessage, committed: AgentMessage[]): boolean {
	const identity = messageIdentity(message);
	if (identity === undefined) return false;
	return committed.some(
		entry => entry.entryId !== undefined && messageIdentity(entry) === identity && sameMessageContent(message, entry),
	);
}

function appendLiveMessages(
	messages: AgentMessage[],
	delivered: AgentMessage[],
	committed: AgentMessage[],
): AgentMessage[] {
	let next = messages;
	for (const message of delivered) {
		const shown = alreadyCommitted(message, committed);
		const optimisticIndex =
			message.role === "user" && !message.steering
				? next.findIndex(entry => isOptimisticUser(entry) && !entry.optimisticDelivered)
				: -1;
		if (optimisticIndex >= 0) {
			const optimistic = next[optimisticIndex];
			next = [...next];
			// The delivery still retires its echo, even when it adds no row of its own.
			if (shown) next.splice(optimisticIndex, 1);
			else
				next[optimisticIndex] = {
					...message,
					optimistic: true,
					optimisticDelivered: true,
					optimisticAfterEntryId: optimistic?.optimisticAfterEntryId,
				};
			continue;
		}
		if (!shown) next = [...next, message];
	}
	return next;
}

/** Match the delivered prompt after its anchor, without consuming an unrelated queued prompt. */
function optimisticUserWasCommitted(message: AgentMessage, fetched: AgentMessage[]): boolean {
	if (!isOptimisticUser(message) || message.optimisticAfterEntryId === undefined) return false;
	const anchorIndex =
		message.optimisticAfterEntryId === null
			? -1
			: fetched.findIndex(entry => entry.entryId === message.optimisticAfterEntryId);
	if (message.optimisticAfterEntryId !== null && anchorIndex < 0) return false;
	return fetched
		.slice(anchorIndex + 1)
		.some(entry => entry.entryId !== undefined && sameMessageContent(message, entry));
}

/** A delivered live row as a plain transcript row: the local-echo markers only mean something in `liveMessages`. */
function settledLiveRow(message: AgentMessage): AgentMessage {
	if (!isOptimisticUser(message)) return message;
	const {
		optimistic: _optimistic,
		optimisticDelivered: _delivered,
		optimisticAfterEntryId: _anchor,
		...row
	} = message;
	return row;
}

/**
 * Delivered live rows the run's commit does not cover. An auto-retry or other
 * continuation runs a fresh agent loop, and the deferred agent_end carries only
 * that last loop's messages — never the prompt that started the saga.
 */
function uncommittedLiveRows(liveMessages: AgentMessage[], committed: AgentMessage[]): AgentMessage[] {
	const pending = committed.filter(message => message.entryId);
	return liveMessages.filter(message => {
		if (isOptimisticUser(message) && !message.optimisticDelivered) return false;
		const identity = messageIdentity(message);
		const index = pending.findIndex(
			entry => messageIdentity(entry) === identity && sameMessageContent(message, entry),
		);
		if (index < 0) return true;
		pending.splice(index, 1);
		return false;
	});
}

function upsertCommittedMessages(current: AgentMessage[], committed: AgentMessage[]): AgentMessage[] {
	const persisted = committed.filter(message => message.entryId);
	if (persisted.length === 0) return current;
	const indexByEntryId = new Map<string, number>();
	current.forEach((message, index) => {
		if (message.entryId) indexByEntryId.set(message.entryId, index);
	});
	const next = [...current];
	for (const message of persisted) {
		if (!message.entryId) continue;
		const index = indexByEntryId.get(message.entryId);
		if (index === undefined) {
			indexByEntryId.set(message.entryId, next.length);
			next.push(message);
		} else {
			next[index] = message;
		}
	}
	return next;
}

/** Preserve only committed rows appended after a transcript request began. */
export function mergeFetchedTranscript(
	fetched: AgentMessage[],
	before: AgentMessage[],
	current: AgentMessage[],
): AgentMessage[] {
	const prefixIntact =
		current.length >= before.length &&
		before.every((message, index) => {
			const currentMessage = current[index];
			if (!currentMessage) return false;
			return message.entryId || currentMessage.entryId
				? message.entryId !== undefined && message.entryId === currentMessage.entryId
				: message === currentMessage;
		});
	if (!prefixIntact) return fetched;
	const fetchedIds = new Set(fetched.flatMap(message => (message.entryId ? [message.entryId] : [])));
	const tail = current.slice(before.length).filter(message => message.entryId && !fetchedIds.has(message.entryId));
	return tail.length === 0 ? fetched : [...fetched, ...tail];
}

export const createMessagesStore = () =>
	createStore<MessagesStore>()((set, get) => ({
		...initialState,
		applyEvents: events => {
			const state = get();
			let { messages, liveMessages, streamingMessage, streamingText, streamingThinking, needsTranscriptSync } =
				state;
			for (const event of events) {
				switch (event.type) {
					case "message_start":
						// Only assistant messages stream. Other deliveries are atomic.
						if (event.message.role !== "assistant") break;
						streamingMessage = event.message;
						streamingText = "";
						streamingThinking = "";
						break;
					case "message_update": {
						const update = event.assistantMessageEvent;
						if (update.type === "text_delta") streamingText += update.delta;
						else if (update.type === "thinking_delta") streamingThinking += update.delta;
						break;
					}
					case "message_end":
						liveMessages = appendLiveMessages(liveMessages, [event.message], messages);
						if (event.message.role === "assistant") {
							streamingMessage = null;
							streamingText = "";
							streamingThinking = "";
						}
						break;
					case "agent_end":
						if (event.messages) {
							const committed = event.messages.some(message => message.entryId);
							// Keep what the commit missed in wire order, ahead of the rows it adds.
							const uncommitted = committed
								? uncommittedLiveRows(liveMessages, event.messages).map(settledLiveRow)
								: [];
							if (uncommitted.length > 0) needsTranscriptSync = true;
							messages = upsertCommittedMessages(
								uncommitted.length > 0 ? [...messages, ...uncommitted] : messages,
								event.messages,
							);
							if (committed) {
								// A prompt queued locally after this run ended is not part of its commit.
								liveMessages = liveMessages.filter(
									message =>
										isOptimisticUser(message) &&
										!message.optimisticDelivered &&
										!optimisticUserWasCommitted(message, messages),
								);
							}
						}
						streamingMessage = null;
						streamingText = "";
						streamingThinking = "";
						break;
				}
			}
			if (
				messages === state.messages &&
				liveMessages === state.liveMessages &&
				streamingMessage === state.streamingMessage &&
				streamingText === state.streamingText &&
				streamingThinking === state.streamingThinking &&
				needsTranscriptSync === state.needsTranscriptSync
			)
				return;
			// Preserve wire order above; publish only once per presentation frame.
			const appended = messages.slice(state.messages.length);
			set({
				messages,
				liveMessages,
				streamingMessage,
				streamingText,
				streamingThinking,
				needsTranscriptSync,
				...(messages !== state.messages ? { totalMessages: messages.length } : {}),
				...(appended.length > 0 ? { lastAppended: appended } : {}),
			});
		},
		loadPage: page =>
			set({
				messages: page.messages,
				liveMessages: [],
				lastAppended: [],
				totalMessages: page.totalMessages,
				nextCursor: page.nextCursor,
				isLoadingPage: false,
				needsTranscriptSync: false,
			}),
		appendMessage: message =>
			set(s => ({
				messages: [...s.messages, message],
				lastAppended: [message],
				totalMessages: s.totalMessages + 1,
			})),
		/** Drop a locally appended placeholder (e.g. the composer's running-eval bubble) by identity. */
		removeMessage: message =>
			set(s => {
				const messages = s.messages.filter(entry => entry !== message);
				const removed = s.messages.length - messages.length;
				if (removed === 0) return s;
				return { messages, totalMessages: Math.max(0, s.totalMessages - removed) };
			}),
		appendLiveMessage: message => set(s => ({ liveMessages: [...s.liveMessages, message] })),
		removeLiveMessage: message => set(s => ({ liveMessages: s.liveMessages.filter(entry => entry !== message) })),
		clearStreaming: () => set({ streamingMessage: null, streamingText: "", streamingThinking: "" }),
		clearDeliveredLiveMessages: () =>
			set(s => ({
				liveMessages: s.liveMessages.filter(message => isOptimisticUser(message) && !message.optimisticDelivered),
			})),
		reconcileFetched: fetched => {
			const state = get();
			const committedByIdentity = new Map<string, AgentMessage[]>();
			for (const message of fetched) {
				const identity = messageIdentity(message);
				if (!message.entryId || !identity) continue;
				const matches = committedByIdentity.get(identity);
				if (matches) matches.push(message);
				else committedByIdentity.set(identity, [message]);
			}
			const liveMessages = state.liveMessages.filter(message => {
				const identity = messageIdentity(message);
				const matches = identity ? committedByIdentity.get(identity) : undefined;
				const index = matches?.findIndex(entry => sameMessageContent(message, entry)) ?? -1;
				if (index >= 0) {
					matches?.splice(index, 1);
					return false;
				}
				return !optimisticUserWasCommitted(message, fetched);
			});
			const messagesUnchanged =
				fetched.length === state.messages.length &&
				fetched.every((message, index) => message === state.messages[index]);
			if (messagesUnchanged && liveMessages.length === state.liveMessages.length && !state.needsTranscriptSync)
				return;
			set({
				messages: fetched,
				needsTranscriptSync: false,
				liveMessages: liveMessages.length === state.liveMessages.length ? state.liveMessages : liveMessages,
				totalMessages: fetched.length,
			});
		},
		snapshot: () => {
			const state = get();
			return {
				messages: state.messages,
				liveMessages: state.liveMessages,
				lastAppended: state.lastAppended,
				streamingMessage: state.streamingMessage,
				streamingText: state.streamingText,
				streamingThinking: state.streamingThinking,
				totalMessages: state.totalMessages,
				nextCursor: state.nextCursor,
				isLoadingPage: state.isLoadingPage,
			};
		},
		restoreSnapshot: snapshot => {
			if (!snapshot) {
				get().reset();
				return;
			}
			set({
				messages: snapshot.messages,
				liveMessages: snapshot.liveMessages,
				lastAppended: snapshot.lastAppended,
				streamingMessage: snapshot.streamingMessage,
				streamingText: snapshot.streamingText,
				streamingThinking: snapshot.streamingThinking,
				totalMessages: snapshot.totalMessages,
				nextCursor: snapshot.nextCursor,
				isLoadingPage: snapshot.isLoadingPage,
			});
		},
		reset: () => set(initialState),
	}));

const defaultMessagesStore = createMessagesStore();
export const useMessagesStore = createScopedStoreHook("messages", defaultMessagesStore);
