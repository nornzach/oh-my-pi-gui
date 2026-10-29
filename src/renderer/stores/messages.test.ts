import { beforeEach, describe, expect, it } from "vitest";
import type { AgentMessage, AgentSessionEvent } from "../../shared/rpc-types";
import { createMessagesStore, mergeFetchedTranscript, useMessagesStore } from "./messages";

const streamingMessage: AgentMessage = {
	role: "assistant",
	content: [],
	timestamp: 1,
};

function delta(text: string): AgentSessionEvent {
	return {
		type: "message_update",
		message: streamingMessage,
		assistantMessageEvent: {
			type: "text_delta",
			contentIndex: 0,
			delta: text,
			partial: streamingMessage,
		},
	};
}

function userMessage(entryId: string): AgentMessage {
	return { role: "user", content: entryId, timestamp: Number(entryId.length), entryId };
}

beforeEach(() => useMessagesStore.getState().reset());

describe("messages streaming snapshots", () => {
	it("preserves the next reply and follow-up regardless of event batch boundaries", () => {
		const previous: AgentMessage = { role: "assistant", content: "previous", timestamp: 0, entryId: "previous" };
		const followUp: AgentMessage = { role: "user", content: "next request", timestamp: 2 };
		const events: AgentSessionEvent[] = [
			{ type: "message_end", message: previous },
			{ type: "agent_end", messages: [previous], isTerminal: false },
			{ type: "message_start", message: followUp },
			{ type: "message_end", message: followUp },
			{ type: "message_start", message: streamingMessage },
			delta("new reply"),
		];
		for (let cuts = 0; cuts < 2 ** (events.length - 1); cuts++) {
			const store = createMessagesStore();
			let start = 0;
			for (let end = 1; end <= events.length; end++) {
				if (end < events.length && !(cuts & (1 << (end - 1)))) continue;
				store.getState().applyEvents(events.slice(start, end));
				start = end;
			}
			expect(store.getState()).toMatchObject({
				messages: [previous],
				liveMessages: [followUp],
				streamingMessage,
				streamingText: "new reply",
			});
		}
	});
	it("resumes the accumulated prefix after switching away and back", () => {
		useMessagesStore.getState().applyEvents([{ type: "message_start", message: streamingMessage }, delta("hel")]);
		const snapshot = useMessagesStore.getState().snapshot();

		useMessagesStore.getState().applyEvents([delta("discarded")]);
		useMessagesStore.getState().restoreSnapshot(snapshot);
		useMessagesStore.getState().applyEvents([delta("lo")]);

		expect(useMessagesStore.getState().streamingText).toBe("hello");
	});

	it("starts a new stream from an empty buffer even when the start and delta share a batch", () => {
		useMessagesStore.setState({ streamingText: "old stream" });

		useMessagesStore.getState().applyEvents([{ type: "message_start", message: streamingMessage }, delta("new")]);

		expect(useMessagesStore.getState().streamingText).toBe("new");
	});

	it("keeps the assistant stream when an atomic background message arrives", () => {
		const notice: AgentMessage = {
			role: "custom",
			customType: "background",
			content: "Background task completed",
			timestamp: 2,
		};
		useMessagesStore
			.getState()
			.applyEvents([
				{ type: "message_start", message: streamingMessage },
				delta("Before "),
				{ type: "message_start", message: notice },
				{ type: "message_end", message: notice },
				delta("after"),
			]);
		expect(useMessagesStore.getState()).toMatchObject({
			streamingMessage,
			streamingText: "Before after",
			liveMessages: [notice],
		});
	});

	it("clears partial assistant buffers without deleting an optimistic user prompt", () => {
		const optimistic: AgentMessage = { role: "user", content: "send now", timestamp: 2, optimistic: true };
		useMessagesStore.getState().appendLiveMessage(optimistic);
		useMessagesStore.setState({
			streamingMessage,
			streamingText: "partial",
			streamingThinking: "thinking",
		});

		useMessagesStore.getState().clearStreaming();

		expect(useMessagesStore.getState().liveMessages).toEqual([optimistic]);
		expect(useMessagesStore.getState().streamingMessage).toBeNull();
	});
});

describe("committed transcript ownership", () => {
	it("keeps the original prompt when steering and follow-up deliveries join the same run", () => {
		const original: AgentMessage = { role: "user", content: [{ type: "text", text: "original" }], timestamp: 10 };
		useMessagesStore.getState().appendLiveMessage({ ...original, optimistic: true, optimisticAfterEntryId: null });
		useMessagesStore.getState().applyEvents([
			{ type: "message_end", message: { ...original, content: "expanded original", timestamp: 11 } },
			{ type: "message_end", message: { role: "user", content: "correction", steering: true, timestamp: 12 } },
			{ type: "message_end", message: { role: "user", content: "follow-up", timestamp: 13 } },
		]);
		expect(useMessagesStore.getState().liveMessages.map(message => message.content)).toEqual([
			"expanded original",
			"correction",
			"follow-up",
		]);
	});

	it("reconciles delivered messages without dropping another delivery sharing its timestamp", () => {
		const first: AgentMessage = { role: "assistant", content: "saved reply", timestamp: 20 };
		const next: AgentMessage = { ...first, content: "next reply" };
		useMessagesStore.getState().applyEvents([
			{ type: "message_end", message: first },
			{ type: "message_end", message: next },
		]);
		useMessagesStore.getState().reconcileFetched([{ ...first, entryId: "saved" }]);
		expect(useMessagesStore.getState().messages).toEqual([{ ...first, entryId: "saved" }]);
		expect(useMessagesStore.getState().liveMessages).toEqual([next]);
	});
	it("keeps message_end deliveries temporary and commits the turn once by entry id", () => {
		const optimistic: AgentMessage = {
			role: "user",
			content: "question",
			timestamp: 10,
			optimistic: true,
			optimisticAfterEntryId: null,
		};
		const user: AgentMessage = { role: "user", content: "question", timestamp: 10 };
		const assistant: AgentMessage = { role: "assistant", content: "answer", timestamp: 11 };
		useMessagesStore.getState().appendLiveMessage(optimistic);

		useMessagesStore.getState().applyEvents([{ type: "message_end", message: user }]);
		useMessagesStore.getState().applyEvents([{ type: "message_end", message: assistant }]);
		expect(useMessagesStore.getState().messages).toEqual([]);
		expect(useMessagesStore.getState().liveMessages).toEqual([
			{ ...user, optimistic: true, optimisticDelivered: true, optimisticAfterEntryId: null },
			assistant,
		]);

		useMessagesStore.getState().applyEvents([
			{
				type: "agent_end",
				messages: [
					{ ...user, entryId: "user-entry" },
					{ ...assistant, entryId: "assistant-entry" },
				],
			},
		]);

		expect(useMessagesStore.getState().messages).toEqual([
			{ ...user, entryId: "user-entry" },
			{ ...assistant, entryId: "assistant-entry" },
		]);
		expect(useMessagesStore.getState().liveMessages).toEqual([]);
	});

	it("upserts repeated or maintenance-rewritten settlements by entry id", () => {
		const first = userMessage("entry-1");
		useMessagesStore.getState().applyEvents([{ type: "agent_end", messages: [first] }]);
		const rewritten = { ...first, content: "rewritten" };
		useMessagesStore.getState().applyEvents([{ type: "agent_end", messages: [rewritten] }]);

		expect(useMessagesStore.getState().messages).toEqual([rewritten]);
		expect(useMessagesStore.getState().totalMessages).toBe(1);
	});

	it("does not erase a live response without a persisted replacement", () => {
		const transient: AgentMessage = { role: "custom", customType: "notice", content: "temporary", timestamp: 1 };
		useMessagesStore.getState().applyEvents([{ type: "message_end", message: transient }]);
		useMessagesStore.getState().applyEvents([{ type: "agent_end", messages: [transient] }]);

		expect(useMessagesStore.getState().messages).toEqual([]);
		expect(useMessagesStore.getState().liveMessages).toEqual([transient]);
	});
});

describe("transcript hydration", () => {
	it("preserves a committed tail that arrived while the snapshot was in flight", () => {
		const a = userMessage("a");
		const before = [a];
		const b = userMessage("b");
		const current = [a, b];

		useMessagesStore.getState().reconcileFetched(mergeFetchedTranscript([a], before, current));
		expect(useMessagesStore.getState().messages).toEqual([a, b]);
	});

	it("preserves the tail when an existing committed row was replaced by the same entry id", () => {
		const a = userMessage("a");
		const b = userMessage("b");
		const refreshedA = { ...a, content: "refreshed" };
		const fetchedA = { ...a, content: "fetched" };

		expect(mergeFetchedTranscript([fetchedA], [a], [refreshedA, b])).toEqual([fetchedA, b]);
	});

	it("clears delivered live rows after idle hydration but preserves local echo", () => {
		const optimistic: AgentMessage = { role: "user", content: "pending", timestamp: 1, optimistic: true };
		const delivered: AgentMessage = { role: "assistant", content: "stale", timestamp: 2 };
		useMessagesStore.setState({ liveMessages: [optimistic, delivered] });

		useMessagesStore.getState().clearDeliveredLiveMessages();

		expect(useMessagesStore.getState().liveMessages).toEqual([optimistic]);
	});

	it("retires the live user echo when streaming hydration persists that turn", () => {
		const previous = userMessage("previous-entry");
		const optimistic: AgentMessage = {
			role: "user",
			content: "new question",
			timestamp: 2,
			optimistic: true,
			optimisticAfterEntryId: previous.entryId ?? null,
		};
		const delivered: AgentMessage = { role: "user", content: "new question", timestamp: 3 };
		const persisted = { ...delivered, entryId: "current-entry" };
		useMessagesStore.setState({ messages: [previous], totalMessages: 1 });
		useMessagesStore.getState().appendLiveMessage(optimistic);
		useMessagesStore.getState().applyEvents([{ type: "message_end", message: delivered }]);

		useMessagesStore.getState().reconcileFetched([previous, persisted]);

		expect(useMessagesStore.getState().messages).toEqual([previous, persisted]);
		expect(useMessagesStore.getState().liveMessages).toEqual([]);
	});

	it("shows a turn once when its transcript fetch overtakes the message_end events", () => {
		const user: AgentMessage = { role: "user", content: "question", timestamp: 2 };
		const reply: AgentMessage = { role: "assistant", content: "answer", timestamp: 3 };
		const committed = [
			{ ...user, entryId: "user-entry" },
			{ ...reply, entryId: "reply-entry" },
		];
		useMessagesStore
			.getState()
			.appendLiveMessage({ ...user, timestamp: 1, optimistic: true, optimisticAfterEntryId: null });

		useMessagesStore.getState().reconcileFetched(committed);
		useMessagesStore.getState().applyEvents([
			{ type: "message_end", message: user },
			{ type: "message_start", message: reply },
			{ type: "message_end", message: reply },
		]);

		const state = useMessagesStore.getState();
		expect([...state.messages, ...state.liveMessages]).toEqual(committed);
		expect(state.streamingMessage).toBeNull();
	});

	it("retires the local echo when the transcript already committed its expanded prompt", () => {
		const delivered: AgentMessage = { role: "user", content: "expanded question", timestamp: 2 };
		const committed = { ...delivered, entryId: "user-entry" };
		useMessagesStore.getState().appendLiveMessage({
			role: "user",
			content: "question",
			timestamp: 1,
			optimistic: true,
			optimisticAfterEntryId: null,
		});

		useMessagesStore.getState().reconcileFetched([committed]);
		useMessagesStore.getState().applyEvents([{ type: "message_end", message: delivered }]);

		const state = useMessagesStore.getState();
		expect([...state.messages, ...state.liveMessages]).toEqual([committed]);
	});

	it("replaces a different persisted branch instead of guessing by content or timestamp", () => {
		const a = userMessage("a");
		useMessagesStore.setState({ messages: [a], totalMessages: 1 });
		const next = userMessage("other");
		useMessagesStore.getState().reconcileFetched([next]);
		expect(useMessagesStore.getState().messages).toEqual([next]);
	});
});
