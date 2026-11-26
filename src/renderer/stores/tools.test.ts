import { describe, expect, it } from "vitest";
import type { AgentMessage, AgentSessionEvent } from "../../shared/rpc-types";
import { createToolsStore, toolEntryKey } from "./tools";

function call(id: string, timestamp = 1): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name: "read", arguments: { path: `${id}.ts` } }],
		timestamp,
	};
}

function result(id: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: "read",
		content: [{ type: "text", text: "ok" }],
		isError: false,
		timestamp: 2,
	};
}

const start = (toolCallId: string): AgentSessionEvent => ({
	type: "tool_execution_start",
	toolCallId,
	toolName: "read",
	args: { path: `${toolCallId}.ts` },
});

describe("tools store history rebuild", () => {
	it("ends an unanswered call from a finished turn instead of spinning forever", () => {
		const store = createToolsStore();
		// A turn interrupted before the tool returned leaves the call in the
		// transcript with no result row. Reloading such a session used to render
		// every one of those cards as still running, with a live duration clock.
		store.getState().hydrateMessages([call("read:0")]);

		expect(store.getState().activeTools.get("read:0")).toMatchObject({
			status: "aborted",
			endTime: null,
		});
	});

	it("keeps only the trailing unanswered call live while the turn is streaming", () => {
		const store = createToolsStore();
		const messages = [call("first"), result("first"), call("last")];
		store.getState().hydrateMessages(messages, { turnIsLive: true });

		expect(store.getState().activeTools.get("first")).toMatchObject({ status: "done" });
		expect(store.getState().activeTools.get("last")).toMatchObject({ status: "running" });
	});

	it("aborts the trailing unanswered call once the session reports it is idle", () => {
		const store = createToolsStore();
		store.getState().hydrateMessages([call("first"), result("first"), call("last")], { turnIsLive: false });

		expect(store.getState().activeTools.get("last")).toMatchObject({ status: "aborted" });
	});

	it("promotes the aborted placeholder when a late execution event arrives", () => {
		const store = createToolsStore();
		store.getState().hydrateMessages([call("read:0")]);
		// Mid-run attach: hydrate saw no result yet, then the live events resume
		// for the same call. The card must switch to running, not duplicate.
		store.getState().applyEvents([start("read:0")]);

		expect(store.getState().activeTools.size).toBe(1);
		expect(store.getState().activeTools.get("read:0")).toMatchObject({ status: "running" });

		store.getState().applyEvents([
			{
				type: "tool_execution_end",
				toolCallId: "read:0",
				toolName: "read",
				result: { content: [] },
				isError: false,
			},
		]);
		expect(store.getState().activeTools.get("read:0")).toMatchObject({ status: "done" });
	});

	it("does not resurrect an already answered call", () => {
		const store = createToolsStore();
		store.getState().hydrateMessages([call("read:0"), result("read:0")]);
		store.getState().applyEvents([start("read:0")]);

		// The finished call keeps its result; the new event opens its own card.
		expect(store.getState().activeTools.size).toBe(2);
		expect(store.getState().activeTools.get("read:0")).toMatchObject({ status: "done" });
	});
});

const messageStart: AgentSessionEvent = {
	type: "message_start",
	message: { role: "assistant", content: [], timestamp: 0 },
};

/** A delta-mode frame: no accumulated snapshot, so the call is unnamed. */
const argsDelta = (delta: string, contentIndex = 0): AgentSessionEvent => ({
	type: "message_update",
	message: { role: "assistant" },
	assistantMessageEvent: { type: "toolcall_delta", contentIndex, delta },
});

const callEnd = (id: string, contentIndex = 0): AgentSessionEvent => ({
	type: "message_update",
	message: { role: "assistant" },
	assistantMessageEvent: {
		type: "toolcall_end",
		contentIndex,
		toolCall: { type: "toolCall", id, name: "read", arguments: { path: `${id}.ts` } },
	},
});

const messageEnd = (message: AgentMessage): AgentSessionEvent => ({ type: "message_end", message });

const finish = (toolCallId: string): AgentSessionEvent => ({
	type: "tool_execution_end",
	toolCallId,
	toolName: "read",
	result: { content: [] },
	isError: false,
});

/** The finalized call block, the object the transcript resolves its card through. */
function block(message: AgentMessage) {
	const content = Array.isArray(message.content) ? message.content[0] : undefined;
	if (content?.type !== "toolCall") throw new Error("expected a tool call");
	return content;
}

describe("tools store delta-mode streaming", () => {
	it("names a tool from the opening frame and attaches the target to that same card before execution", () => {
		const store = createToolsStore();
		store.getState().applyEvents([
			messageStart,
			{
				type: "message_update",
				message: { role: "assistant" },
				assistantMessageEvent: {
					type: "toolcall_start",
					contentIndex: 0,
					block: { type: "toolCall", id: "", name: "read", arguments: {} },
				},
			},
			argsDelta('{"path":'),
		]);
		expect([...store.getState().activeTools.values()].map(entry => entry.toolName)).toEqual(["read"]);
		store.getState().applyEvents([callEnd("read:0")]);
		expect([...store.getState().activeTools.keys()]).toEqual(["read:0"]);
		expect(store.getState().activeTools.get("read:0")?.args).toEqual({ path: "read:0.ts" });
	});

	it("streams an unnamed call's args, then names and runs it on one card", () => {
		const store = createToolsStore();
		store.getState().applyEvents([messageStart, argsDelta('{"path":'), argsDelta('"a.ts"}')]);

		// Mid-stream the call has no id or name yet, but its card already shows the args.
		const [streaming] = [...store.getState().activeTools.values()];
		expect(store.getState().activeTools.size).toBe(1);
		expect(streaming).toMatchObject({ toolName: "", status: "pending", streamingArgs: '{"path":"a.ts"}' });

		store.getState().applyEvents([callEnd("read:0")]);
		expect([...store.getState().activeTools.keys()]).toEqual(["read:0"]);
		expect(store.getState().activeTools.get("read:0")).toMatchObject({
			toolName: "read",
			streamingArgs: '{"path":"a.ts"}',
		});

		const message = call("read:0");
		store.getState().applyEvents([messageEnd(message), start("read:0"), finish("read:0")]);
		expect(store.getState().activeTools.size).toBe(1);
		expect(store.getState().activeTools.get(toolEntryKey(block(message)))).toMatchObject({ status: "done" });
	});

	it("keeps a provider id reused across turns on separate cards", () => {
		const store = createToolsStore();
		const first = call("read:0");
		const second = call("read:0");
		for (const message of [first, second]) {
			store
				.getState()
				.applyEvents([
					messageStart,
					argsDelta("{}"),
					callEnd("read:0"),
					messageEnd(message),
					start("read:0"),
					finish("read:0"),
				]);
		}

		const firstKey = toolEntryKey(block(first));
		const secondKey = toolEntryKey(block(second));
		expect(firstKey).not.toBe(secondKey);
		expect(store.getState().activeTools.size).toBe(2);
		expect(store.getState().activeTools.get(firstKey)).toMatchObject({ status: "done" });
		expect(store.getState().activeTools.get(secondKey)).toMatchObject({ status: "done" });
	});

	it("names the call at message_end when its toolcall_end never arrived", () => {
		const store = createToolsStore();
		const message = call("read:0");
		store.getState().applyEvents([messageStart, argsDelta('{"path":"read:0.ts"}'), messageEnd(message)]);

		expect([...store.getState().activeTools.keys()]).toEqual(["read:0"]);
		expect(store.getState().activeTools.get("read:0")).toMatchObject({
			toolName: "read",
			args: { path: "read:0.ts" },
			status: "pending",
		});
	});

	it("drops a streaming card whose call did not survive the message", () => {
		const store = createToolsStore();
		store
			.getState()
			.applyEvents([
				messageStart,
				argsDelta('{"pa'),
				messageEnd({ role: "assistant", content: [{ type: "text", text: "stopped" }], timestamp: 1 }),
			]);

		// An orphaned pending entry would match no transcript block and never settle.
		expect(store.getState().activeTools.size).toBe(0);
	});

	it("still names the call from the first delta of a full-snapshot frame", () => {
		const store = createToolsStore();
		// A sidecar that ignores the delta opt-in keeps sending `partial`.
		store.getState().applyEvents([
			messageStart,
			{
				type: "message_update",
				message: { role: "assistant" },
				assistantMessageEvent: {
					type: "toolcall_delta",
					contentIndex: 0,
					delta: "{",
					partial: {
						role: "assistant",
						content: [{ type: "toolCall", id: "read:0", name: "read", arguments: {} }],
					},
				},
			},
		]);

		expect(store.getState().activeTools.get("read:0")).toMatchObject({ toolName: "read", streamingArgs: "{" });
	});
});
