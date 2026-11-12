import type { AgentMessage, MessageContent, ThinkingContent } from "../../shared/rpc-types";

/** Identity shared by live delivery, persisted transcript reconciliation, and viewport anchors. */
export function messageIdentity(message: AgentMessage): string | undefined {
	if (typeof message.id === "string" && message.id.length > 0) return message.id;
	if (message.timestamp !== undefined) return `${message.role}-${String(message.timestamp)}`;
	return message.entryId;
}

/** User text can arrive as either a string or text blocks on the wire. */
export function sameMessageContent(left: AgentMessage, right: AgentMessage): boolean {
	const leftContent = typeof left.content === "string" ? [{ type: "text", text: left.content }] : left.content;
	const rightContent = typeof right.content === "string" ? [{ type: "text", text: right.content }] : right.content;
	return left.role === right.role && JSON.stringify(leftContent) === JSON.stringify(rightContent);
}

/** A content block as the transcript normalizes it: thinking without its signature. */
function unsignedBlock(block: MessageContent): MessageContent {
	if (block.type !== "thinking") return block;
	const { thinkingSignature: _signature, ...rest } = block as ThinkingContent & { thinkingSignature?: unknown };
	return rest;
}

function isRedactedThinking(block: MessageContent): boolean {
	return (block.type as string) === "redactedThinking";
}

/**
 * Whether `committed` is the transcript's copy of the delivered reply `live`
 * with its tool calls taken out. The agent saves a reply before its tools run,
 * and a transcript read while they run drops each call that has no result yet,
 * clears the reply's thinking signatures and drops redacted thinking, then
 * counts the dropped calls in `strippedToolCalls`.
 */
export function isStrippedCopyOf(committed: AgentMessage, live: AgentMessage): boolean {
	const stripped = committed.strippedToolCalls;
	if (typeof stripped !== "number" || stripped <= 0) return false;
	if (committed.role !== "assistant" || live.role !== "assistant") return false;
	if (messageIdentity(committed) !== messageIdentity(live)) return false;
	if (!Array.isArray(committed.content) || !Array.isArray(live.content)) return false;
	const keptCalls = new Set(committed.content.flatMap(block => (block.type === "toolCall" ? [block.id] : [])));
	let dropped = 0;
	const remaining = live.content.filter(block => {
		if (block.type === "toolCall" && !keptCalls.has(block.id)) {
			dropped++;
			return false;
		}
		return !isRedactedThinking(block);
	});
	if (dropped !== stripped) return false;
	const normalize = (blocks: MessageContent[]) =>
		JSON.stringify(blocks.filter(block => !isRedactedThinking(block)).map(unsignedBlock));
	return normalize(remaining) === normalize(committed.content);
}

/** When the message was sent, in ms; 0 when the wire carried no usable time. */
export function messageTimestampMs(message: AgentMessage): number {
	const timestamp = message.timestamp;
	if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
	if (typeof timestamp === "string") {
		const parsed = Date.parse(timestamp);
		if (Number.isFinite(parsed)) return parsed;
	}
	return 0;
}
