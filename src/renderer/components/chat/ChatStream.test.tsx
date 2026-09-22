import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../../shared/rpc-types";
import type { TodoSnapshot } from "../../stores/todo";
import {
	buildConversationAnchors,
	buildHistoryRowKeys,
	buildHistoryRows,
	buildTimelineMarkers,
	buildTranscriptRowKeys,
	claimRowEntrances,
	createRowEntranceState,
	findConversationAnchorIndex,
	hasStreamingTranscriptContent,
	isTranscriptAtLiveEdge,
	LIVE_EDGE_SLACK_PX,
	mergeTodoSnapshots,
	ROW_ENTRANCE_TAIL_ROWS,
	shouldRePinTranscript,
} from "./ChatStream";

const at = "2026-08-05T04:00:00.000Z";

function assistant(content: AgentMessage["content"]): AgentMessage {
	return { role: "assistant", content, timestamp: at };
}

function toolResult(toolCallId: string, isError = false): AgentMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "test",
		content: [{ type: "text", text: "result" }],
		isError,
		timestamp: at,
	};
}

const toolRun: AgentMessage[] = [
	assistant([
		{ type: "text", text: "I will inspect the source." },
		{ type: "toolCall", id: "call-read", name: "read", arguments: { path: "src/a.ts" } },
	]),
	toolResult("call-read"),
	assistant([{ type: "toolCall", id: "call-write", name: "write", arguments: { path: "src/a.ts" } }]),
	toolResult("call-write"),
	assistant([{ type: "text", text: "Implemented and verified." }]),
];

describe("compact transcript rows", () => {
	it("folds consecutive tool work into one process row and keeps the final answer visible", () => {
		const rows = buildHistoryRows(toolRun, "compact");
		expect(rows.map(row => row.kind)).toEqual(["process", "message"]);

		const process = rows[0];
		if (process?.kind !== "process") throw new Error("process row missing");
		expect(process.stepCount).toBe(2);
		expect(process.toolNames).toEqual(["read", "write"]);
		expect(process.messages).toHaveLength(2);

		const answer = rows[1];
		if (answer?.kind !== "message") throw new Error("final answer row missing");
		expect(answer.message.content).toEqual([{ type: "text", text: "Implemented and verified." }]);
	});

	it("splits final reasoning from final text so only the answer stays outside the process row", () => {
		const rows = buildHistoryRows(
			[
				assistant([
					{ type: "thinking", thinking: "Check the boundary first." },
					{ type: "text", text: "The public answer." },
				]),
			],
			"compact",
		);
		expect(rows.map(row => row.kind)).toEqual(["process", "message"]);

		const process = rows[0];
		const answer = rows[1];
		if (process?.kind !== "process" || answer?.kind !== "message") throw new Error("split rows missing");
		expect(process.stepCount).toBe(1);
		expect(process.messages[0]?.content).toEqual([{ type: "thinking", thinking: "Check the boundary first." }]);
		expect(answer.message.content).toEqual([{ type: "text", text: "The public answer." }]);
	});

	it("omits punctuation filler instead of allocating an invisible virtual row", () => {
		expect(
			buildHistoryRows(
				[
					assistant([
						{ type: "thinking", thinking: "." },
						{ type: "text", text: "." },
					]),
				],
				"compact",
			),
		).toEqual([]);
	});

	it("folds narrated phases and filler tool calls into one activity summary before the final answer", () => {
		const rows = buildHistoryRows(
			[
				assistant([
					{ type: "text", text: "Validate the updater." },
					{ type: "toolCall", id: "call-check", name: "bash", arguments: { command: "bun check" } },
				]),
				assistant([
					{ type: "text", text: "." },
					{ type: "toolCall", id: "call-format", name: "bash", arguments: { command: "bun format" } },
				]),
				{
					role: "custom",
					customType: "launch-completion",
					content: "Supervised process audit failed with exit code 1.",
					details: { daemons: [{ name: "audit", state: "failed", exitCode: 1 }] },
					display: true,
					timestamp: at,
				},
				assistant([
					{ type: "thinking", thinking: "The checks passed; launch the audit build." },
					{ type: "text", text: "Launch the audit build." },
					{ type: "toolCall", id: "call-build", name: "bash", arguments: { command: "bun run build" } },
				]),
				assistant([
					{ type: "text", text: "." },
					{ type: "toolCall", id: "call-launch", name: "hub", arguments: { name: "gui-final" } },
				]),
				{
					role: "custom",
					customType: "async-result",
					content: "<system-notice>Background job bg-1 has completed.\npassed</system-notice>",
					details: { jobs: [{ jobId: "bg-1", type: "bash", label: "tests" }] },
					display: true,
					timestamp: at,
				},
			],
			"compact",
		);

		expect(rows.map(row => row.kind)).toEqual(["process"]);
		const process = rows[0];
		if (process?.kind !== "process") throw new Error("process row missing");
		expect(process.stepCount).toBe(5);
		expect(process.failedEvents).toBe(1);
		expect(process.toolNames).toEqual(["bash", "bash", "bash", "hub"]);
		expect(process.messages.map(message => message.customType).filter(Boolean)).toEqual([
			"launch-completion",
			"async-result",
		]);
		expect(buildTimelineMarkers(rows)[0]?.state).toBe("error");
	});
});

describe("full transcript rows", () => {
	it("moves an opening assistant emoji onto the preceding user message", () => {
		const rows = buildHistoryRows(
			[
				{ role: "user", content: [{ type: "text", text: "Ship it?" }], timestamp: at },
				assistant([{ type: "text", text: "👍\nShipped." }]),
			],
			"full",
		);

		expect(rows).toHaveLength(2);
		const user = rows[0];
		const reply = rows[1];
		if (user?.kind !== "message" || reply?.kind !== "message") throw new Error("reaction rows missing");
		expect(user.reaction).toBe("👍");
		expect(reply.message.content).toEqual([{ type: "text", text: "Shipped." }]);
	});

	it("preserves an earlier failure after the user starts another turn", () => {
		const rows = buildHistoryRows(
			[
				{ ...assistant([{ type: "text", text: "Partial reply" }]), errorMessage: "network disconnected" },
				{ role: "user", content: [{ type: "text", text: "Try again" }], timestamp: at },
			],
			"full",
		);

		expect(rows).toHaveLength(2);
		const failed = rows[0];
		if (failed?.kind !== "message") throw new Error("partial reply row missing");
		expect(failed.message.errorMessage).toBe("network disconnected");
		expect(failed.message.content).toEqual([{ type: "text", text: "Partial reply" }]);
	});

	it("keeps individual process messages but removes standalone tool-result transport rows", () => {
		const rows = buildHistoryRows(toolRun, "full");
		expect(rows.map(row => row.kind)).toEqual(["message", "message", "message"]);
		for (const row of rows) {
			if (row.kind !== "message") throw new Error("full mode unexpectedly folded a process row");
			expect(row.message.role).toBe("assistant");
		}
	});

	it("renders one marker per narrated phase and aggregates continuation tool state", () => {
		const phaseRows = buildHistoryRows(
			[
				assistant([
					{ type: "text", text: "Validate the updater." },
					{ type: "toolCall", id: "call-check", name: "bash", arguments: { command: "bun check" } },
				]),
				assistant([
					{ type: "text", text: "." },
					{ type: "toolCall", id: "call-format", name: "bash", arguments: { command: "bun format" } },
				]),
				assistant([
					{ type: "thinking", thinking: "The checks passed; launch the audit build." },
					{ type: "text", text: "Launch the audit build." },
					{ type: "toolCall", id: "call-build", name: "bash", arguments: { command: "bun run build" } },
				]),
				assistant([
					{ type: "text", text: "." },
					{ type: "toolCall", id: "call-hub", name: "hub", arguments: { name: "gui-final" } },
				]),
				assistant([
					{ type: "text", text: "." },
					{ type: "toolCall", id: "call-write", name: "write", arguments: { path: "xd://browser" } },
				]),
				{ role: "custom", customType: "launch-completion", content: "gui-final exited with code 0", timestamp: at },
			],
			"full",
		);

		const markers = buildTimelineMarkers(phaseRows);
		expect(markers.map(marker => marker?.state ?? null)).toEqual(["done", null, "done", null, null, "launch"]);
		expect(markers[0]?.toolIds).toEqual(["call-check", "call-format"]);
		expect(markers[2]?.toolIds).toEqual(["call-build", "call-hub", "call-write"]);
	});
});

describe("streaming transcript visibility", () => {
	const shell = assistant([]);

	it("does not allocate a blank row for punctuation-only deltas", () => {
		expect(hasStreamingTranscriptContent(shell, ".", "…", new Map())).toBe(false);
	});

	it("shows a tool-only turn as soon as its live tool starts", () => {
		expect(
			hasStreamingTranscriptContent(
				shell,
				"",
				"",
				new Map([
					[
						"call-read",
						{
							toolName: "read",
							args: { path: "src/a.ts" },
							status: "running",
							partialResult: null,
							streamingArgs: "",
							result: null,
							isError: false,
							startTime: Date.parse(at),
							endTime: null,
						},
					],
				]),
			),
		).toBe(true);
	});
});

describe("virtual transcript identity", () => {
	it("keeps tail following across layout slack and releases on a real scroll-up", () => {
		expect(isTranscriptAtLiveEdge({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 })).toBe(true);
		// Row re-measurement and fractional scrollTop leave a few pixels under the
		// last row; that gap must not read as "the user scrolled away".
		expect(isTranscriptAtLiveEdge({ scrollHeight: 1000, scrollTop: 790, clientHeight: 200 })).toBe(true);
		expect(
			isTranscriptAtLiveEdge({ scrollHeight: 1000, scrollTop: 800 - LIVE_EDGE_SLACK_PX, clientHeight: 200 }),
		).toBe(false);
		expect(isTranscriptAtLiveEdge({ scrollHeight: 1000, scrollTop: 600, clientHeight: 200 })).toBe(false);
	});

	it("hands the tail back only to a gesture that moved toward it", () => {
		// A tail-follow write that slips into the same frame as an upward gesture
		// leaves the viewport at the live edge. Reading that position as intent clears
		// the gesture latch, so every later append follows and the view the reader just
		// took is lost for the rest of the run.
		expect(shouldRePinTranscript(false, true)).toBe(false);
		expect(shouldRePinTranscript(null, true)).toBe(false);
		// Dragging or flicking to the very bottom re-engages when the gesture ends,
		// not from a position the system itself produced.
		expect(shouldRePinTranscript(true, true)).toBe(true);
		// Toward the tail is not yet on it.
		expect(shouldRePinTranscript(true, false)).toBe(false);
		expect(shouldRePinTranscript(false, false)).toBe(false);
	});

	it("keeps an empty wire message anchored when a tool call finalizes it", () => {
		const message: AgentMessage = {
			role: "assistant",
			content: [],
			timestamp: at,
		};

		const liveKey = buildTranscriptRowKeys([{ kind: "streaming", message }]);
		const finalized: AgentMessage = {
			...message,
			entryId: "persisted-tool",
			content: [{ type: "toolCall", id: "call-finalized", name: "read", arguments: { path: "src/a.ts" } }],
		};
		const finalizedKey = buildHistoryRowKeys(buildHistoryRows([finalized], "full"));

		expect(liveKey).toEqual(finalizedKey);
	});

	it("keeps an expanded live phase separate when compact history absorbs it", () => {
		const first: AgentMessage = {
			role: "assistant",
			timestamp: 1,
			content: [{ type: "thinking", thinking: "First phase" }],
		};
		const next: AgentMessage = {
			role: "assistant",
			timestamp: 2,
			content: [{ type: "thinking", thinking: "Next phase" }],
		};
		const [expandedKey] = buildTranscriptRowKeys([{ kind: "streaming", message: next }]);
		expect(buildHistoryRows([first, next], "compact")).toHaveLength(1);
		const rows = buildHistoryRows([first, next], "compact", new Set([expandedKey]));
		expect(buildHistoryRowKeys(rows)).toContain(expandedKey);
		expect(rows).toHaveLength(2);
	});

	it("anchors compact finalization to the first row produced from the live assistant", () => {
		const cases: AgentMessage[] = [
			{
				id: "assistant-thinking",
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Inspect the boundary." },
					{ type: "text", text: "Final answer" },
				],
				timestamp: at,
			},
			{
				id: "assistant-tool",
				role: "assistant",
				content: [{ type: "toolCall", id: "call-compact", name: "read", arguments: { path: "src/a.ts" } }],
				timestamp: at,
			},
		];

		for (const message of cases) {
			const [liveKey] = buildTranscriptRowKeys([{ kind: "streaming", message }]);
			const [firstFinalizedKey] = buildHistoryRowKeys(buildHistoryRows([message], "compact"));
			expect(firstFinalizedKey).toBe(liveKey);
		}
	});

	it("keeps existing row keys stable when a new message is inserted before them", () => {
		const existingRows = buildHistoryRows(
			[assistant([{ type: "text", text: "First" }]), assistant([{ type: "text", text: "Second" }])],
			"full",
		);
		const existingKeys = buildHistoryRowKeys(existingRows);
		const prependedRows = buildHistoryRows(
			[
				{ role: "user", content: [{ type: "text", text: "Prompt" }], timestamp: "2026-08-05T03:59:59.000Z" },
				assistant([{ type: "text", text: "First" }]),
				assistant([{ type: "text", text: "Second" }]),
			],
			"full",
		);
		expect(buildHistoryRowKeys(prependedRows).slice(1)).toEqual(existingKeys);
	});
});

describe("conversation navigation anchors", () => {
	it("indexes only user-authored turns and keeps their rendered row targets", () => {
		const rows = buildHistoryRows(
			[
				{ role: "user", content: [{ type: "text", text: "  First\nquestion  " }], timestamp: 100 },
				assistant([{ type: "text", text: "First answer" }]),
				{ role: "user", content: [{ type: "text", text: "Second question" }], timestamp: 300 },
			],
			"full",
		);
		const keys = buildHistoryRowKeys(rows);

		expect(buildConversationAnchors(rows, keys)).toEqual([
			{ key: keys[0], rowIndex: 0, preview: "First question", timestamp: 100 },
			{ key: keys[2], rowIndex: 2, preview: "Second question", timestamp: 300 },
		]);
	});

	it("selects the user turn at or immediately before the visible row", () => {
		const anchors = [
			{ key: "one", rowIndex: 2, preview: "One" },
			{ key: "two", rowIndex: 7, preview: "Two" },
			{ key: "three", rowIndex: 12, preview: "Three" },
		];

		expect(findConversationAnchorIndex(anchors, 0)).toBe(0);
		expect(findConversationAnchorIndex(anchors, 7)).toBe(1);
		expect(findConversationAnchorIndex(anchors, 11)).toBe(1);
		expect(findConversationAnchorIndex(anchors, 99)).toBe(2);
		expect(findConversationAnchorIndex([], 3)).toBe(-1);
	});

	it("bounds long prompt previews without changing their target row", () => {
		const rows = buildHistoryRows(
			[{ role: "user", content: [{ type: "text", text: "SQL ".repeat(100) }], timestamp: 100 }],
			"full",
		);
		const [anchor] = buildConversationAnchors(rows, buildHistoryRowKeys(rows));

		expect(anchor?.rowIndex).toBe(0);
		expect(anchor?.preview.length).toBeLessThanOrEqual(180);
		expect(anchor?.preview.endsWith("…")).toBe(true);
	});
});

describe("mergeTodoSnapshots", () => {
	function snapshot(id: string, ts: number): TodoSnapshot {
		return { id, ts, phases: [{ name: "Build", tasks: [{ content: "task", status: "pending" }] }] };
	}

	it("interleaves snapshots by timestamp and tails the newest changes", () => {
		const rows = buildHistoryRows(
			[
				{ role: "user", content: [{ type: "text", text: "One" }], timestamp: 100 },
				{ role: "user", content: [{ type: "text", text: "Two" }], timestamp: 300 },
			],
			"full",
		);
		const merged = mergeTodoSnapshots(rows, [snapshot("s1", 50), snapshot("s2", 200), snapshot("s3", 400)]);
		expect(merged.map(row => row.kind)).toEqual([
			"todoSnapshot",
			"message",
			"todoSnapshot",
			"message",
			"todoSnapshot",
		]);
		expect(merged.map(row => (row.kind === "todoSnapshot" ? row.entry.id : null))).toEqual([
			"s1",
			null,
			"s2",
			null,
			"s3",
		]);
	});

	it("passes rows through untouched when there are no snapshots", () => {
		const rows = buildHistoryRows([assistant([{ type: "text", text: "Solo" }])], "full");
		expect(mergeTodoSnapshots(rows, [])).toEqual(rows);
	});
});

describe("transcript row entrances", () => {
	function claim(
		latch: ReturnType<typeof createRowEntranceState>,
		sessionId: string,
		live: boolean,
		rowKeys: string[],
	) {
		const mounted = rowKeys.map((key, index) => ({ index, key }));
		return claimRowEntrances(latch, { sessionId, live, rowKeys, mounted });
	}

	/** A transcript long enough that its tail is a definite place. */
	function history(count: number): string[] {
		return Array.from({ length: count }, (_, index) => `r${index}`);
	}

	it("leaves a restored transcript alone, however it lands", () => {
		const latch = createRowEntranceState("session-a", []);
		const restored = history(5);
		// Opening a session restores a view, not content arriving: no cascade, even
		// though the row set grew well past its empty baseline.
		expect(claim(latch, "session-a", false, restored)).toEqual([]);
		expect(claim(latch, "session-a", true, restored)).toEqual([]);
	});

	it("claims a row appended at the tail, exactly once", () => {
		const restored = history(20);
		const latch = createRowEntranceState("session-a", restored);
		const next = [...restored, "live"];
		expect(claim(latch, "session-a", true, next)).toEqual(["live"]);
		// The same row keeps mounting as the view follows the run: no replay.
		expect(claim(latch, "session-a", true, next)).toEqual([]);
	});

	it("claims the reply even when it replaces the waiting row", () => {
		const restored = [...history(20), "pending"];
		const latch = createRowEntranceState("session-a", restored);
		// Sending trades the placeholder for the user row, so the row count never
		// grows: arrival has to be read from the tail, not from a delta.
		expect(claim(latch, "session-a", true, [...history(20), "user", "streaming"])).toEqual(["user", "streaming"]);
	});

	it("does not claim history landing above the tail", () => {
		const restored = history(20);
		const latch = createRowEntranceState("session-a", restored);
		// A page of older rows is fetched while the run is live, so `live` alone
		// cannot tell them apart from the reply.
		const older = ["older-1", "older-2"];
		const next = [...older, ...restored, "live"];
		const claims = claimRowEntrances(latch, {
			sessionId: "session-a",
			live: true,
			rowKeys: next,
			mounted: next.map((key, index) => ({ index, key })),
		});
		expect(claims).toEqual(["live"]);
	});

	it("treats a bulk jump as a restore", () => {
		const latch = createRowEntranceState("session-a", history(2));
		const page = [...history(2), ...Array.from({ length: ROW_ENTRANCE_TAIL_ROWS + 8 }, (_, i) => `hydrated-${i}`)];
		expect(claim(latch, "session-a", true, page)).toEqual([]);
		// The hydrate becomes the baseline: the next live row is the only claim.
		expect(claim(latch, "session-a", true, [...page, "live"])).toEqual(["live"]);
	});

	it("rebaselines on a session switch instead of animating the new view", () => {
		const latch = createRowEntranceState("session-a", history(20));
		const other = history(30);
		expect(claim(latch, "session-b", true, other)).toEqual([]);
		expect(claim(latch, "session-b", true, [...other, "a30"])).toEqual(["a30"]);
	});
});
