/**
 * Read-tool grouping (TUI read-tool-group.ts parity, GUI port): consecutive
 * collapsible `read` calls fold into ONE group card that accretes across
 * assistant messages for as long as the run is uninterrupted.
 *
 * Break rules (mirrors the TUI): a newly visible assistant text or non-empty
 * thinking block, any non-read tool card, a user/custom/fileMention message,
 * or a turn boundary seals the run. Selector suffixes (`path:1-5,7`) merge
 * for consecutive same-file reads.
 *
 * Both render paths share this module (plan/17 §7.4): buildHistoryRows
 * output is post-processed here for the finalized transcript; the live
 * StreamingRows path groups its read cards with the same predicate.
 */

import type { AgentMessage, MessageContent } from "../../shared/rpc-types";
import { toolEntryKey } from "../stores/tools";
import { isRenderableMessageText } from "./messages";

/** One read call inside a group. Result/status resolution happens in the card. */
export interface ReadGroupEntry {
	callId: string;
	/** Occurrence-specific key; raw provider ids may repeat across turns. */
	toolKey: string;
	path: string;
	/** Selector suffix split from the path (`1-5,7,20-25`). */
	selector?: string;
	/** Original tool-call arguments (the expanded ToolCard renders from these + the store). */
	args: Record<string, unknown>;
}

export type ReadGroupRow =
	| { kind: "readGroup"; entries: ReadGroupEntry[]; usage?: ReadGroupUsage[] }
	| { kind: "message"; message: AgentMessage };

/**
 * Usage fields carried from a fully-consumed assistant message onto a read
 * group (TUI read-tool-group.ts parity: a pure-read turn keeps its usage row).
 * Rides the same wire shape UsageRow reads; readUsage decides whether to render.
 */
export interface ReadGroupUsage {
	role: "assistant";
	usage: unknown;
	model?: string;
	duration?: number;
	ttft?: number;
	timestamp?: string | number;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
/** Numeric selector suffix: `:50`, `:50-100`, `:50+150`, `:5-16,960-973`. */
const SELECTOR_RE = /:(\d+(?:[-+]\d+)?(?:,\d+(?:[-+]\d+)?)*)$/;

/**
 * Collapse predicate (readArgsCollapseIntoGroup parity): `xd://` targets and
 * anything the internal-URL router would NOT handle collapse; scheme URLs
 * (skill://, agent://, …) render full. Unknown/missing path → not collapsible.
 */
export function collapsibleReadTarget(args: unknown): { path: string; selector?: string } | null {
	if (args === null || typeof args !== "object") return null;
	const record = args as Record<string, unknown>;
	// Legacy alias tolerated: older reads carried file_path.
	const target =
		typeof record.path === "string" ? record.path : typeof record.file_path === "string" ? record.file_path : null;
	if (!target) return null;
	if (SCHEME_RE.test(target) && !target.startsWith("xd://")) return null;
	const selectorMatch = SELECTOR_RE.exec(target);
	if (selectorMatch) {
		return { path: target.slice(0, selectorMatch.index), selector: selectorMatch[1] };
	}
	return { path: target };
}

/** A visible non-read block seals the run; empty thinking/invisible filler does not. */
function isVisibleBlock(block: MessageContent): boolean {
	switch (block.type) {
		case "text":
			return isRenderableMessageText(block.text);
		case "thinking":
			return isRenderableMessageText(block.thinking);
		case "toolCall":
		case "image":
			return true;
	}
	return false;
}

interface ReadGroupableRow {
	kind: string;
	message?: AgentMessage;
}

/**
 * Post-process finalized history rows: extract collapsible read blocks from
 * assistant messages into `readGroup` rows that accrete across messages.
 * Messages left with remaining visible content keep rendering (trimmed).
 */
export function groupReadRows<R extends ReadGroupableRow>(rows: R[]): Array<R | ReadGroupRow> {
	const out: Array<R | ReadGroupRow> = [];
	let run: ReadGroupEntry[] = [];
	let runUsage: ReadGroupUsage[] = [];
	const flush = () => {
		if (run.length === 0) return;
		const row: ReadGroupRow = { kind: "readGroup", entries: run };
		if (runUsage.length > 0) row.usage = runUsage;
		out.push(row);
		run = [];
		runUsage = [];
	};

	for (const row of rows) {
		const message = row.kind === "message" ? row.message : undefined;
		if (
			message?.role !== "assistant" ||
			message.errorMessage ||
			message.steering ||
			!Array.isArray(message.content)
		) {
			flush();
			out.push(row);
			continue;
		}

		const kept: MessageContent[] = [];
		for (const block of message.content) {
			if (block.type === "toolCall" && block.name === "read") {
				const read = collapsibleReadTarget(block.arguments);
				if (read) {
					run.push({
						callId: block.id,
						toolKey: toolEntryKey(block),
						...read,
						args: block.arguments as Record<string, unknown>,
					});
					continue;
				}
			}
			if (isVisibleBlock(block)) flush();
			kept.push(block);
		}
		if (kept.some(isVisibleBlock)) {
			out.push({ ...row, message: { ...message, content: kept } });
		} else if (message.usage != null && typeof message.usage === "object") {
			// The message was fully consumed into the run (no visible content
			// left to render a bubble) — keep its usage so a pure-read turn
			// still shows tokens/cost/duration on the group card.
			runUsage.push({
				role: "assistant",
				usage: message.usage,
				model: typeof message.model === "string" ? message.model : undefined,
				duration: typeof message.duration === "number" ? message.duration : undefined,
				ttft: typeof message.ttft === "number" ? message.ttft : undefined,
				timestamp: message.timestamp,
			});
		}
	}
	flush();
	return out;
}

/** Display rows after same-file selector merge (consecutive batches only). */
export interface ReadGroupDisplayRow {
	path: string;
	selector?: string;
	callIds: string[];
	toolKeys: string[];
}

export function mergeReadGroupEntries(entries: ReadGroupEntry[]): ReadGroupDisplayRow[] {
	const rows: ReadGroupDisplayRow[] = [];
	for (const entry of entries) {
		const last = rows[rows.length - 1];
		if (last && last.path === entry.path) {
			last.callIds.push(entry.callId);
			last.toolKeys.push(entry.toolKey);
			if (entry.selector) last.selector = last.selector ? `${last.selector},${entry.selector}` : entry.selector;
			continue;
		}
		rows.push({ path: entry.path, selector: entry.selector, callIds: [entry.callId], toolKeys: [entry.toolKey] });
	}
	return rows;
}

/** Card label: one read renders inline; N reads render the tree header. */
export function readGroupTitle(entries: ReadGroupEntry[]): string {
	return entries.length === 1 ? "Read" : `Read (${entries.length})`;
}
