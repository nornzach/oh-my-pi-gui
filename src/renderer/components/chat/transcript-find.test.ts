/**
 * Find in this conversation: the count the find bar shows comes from message
 * data, and each mounted row resolves its occurrences to DOM ranges to paint.
 */

import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../../shared/rpc-types";
import { buildHistoryRows } from "./chat-stream-utils";
import { findTextSpans, findTranscriptMatches } from "./transcript-find";

const at = "2026-10-24T00:00:00.000Z";

describe("findTranscriptMatches", () => {
	it("counts each occurrence regardless of case, as its own match in transcript order", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "Deploy the app", timestamp: at },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I will deploy it, then DEPLOY again." },
					{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "deploy" } },
				],
				timestamp: at,
			},
		];
		const rows = buildHistoryRows(messages, "compact");
		const narrationIndex = rows.findIndex(row => row.kind === "message" && row.narration);
		expect(narrationIndex).toBeGreaterThan(0);

		expect(findTranscriptMatches(rows, "  deploy ")).toEqual([
			{ rowIndex: 0, occurrence: 0 },
			{ rowIndex: narrationIndex, occurrence: 0 },
			{ rowIndex: narrationIndex, occurrence: 1 },
		]);
	});
});

describe("findTextSpans", () => {
	it("maps a match across inline formatting to one span, ending inside the earlier node on a boundary", () => {
		// <p>Run <strong>bun</strong> check, then bun check again</p>
		const texts = ["Run ", "bun", " check, then bun check again"];
		expect(findTextSpans(texts, "BUN CHECK")).toEqual([
			{ start: { node: 1, offset: 0 }, end: { node: 2, offset: 6 } },
			{ start: { node: 2, offset: 13 }, end: { node: 2, offset: 22 } },
		]);
		expect(findTextSpans(texts, "run bun")).toEqual([{ start: { node: 0, offset: 0 }, end: { node: 1, offset: 3 } }]);
	});
});
