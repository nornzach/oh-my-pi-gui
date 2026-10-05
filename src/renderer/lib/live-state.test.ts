import { describe, expect, it } from "vitest";
import type { RpcLiveFrame } from "../../shared/rpc-types";
import { INITIAL_LIVE_STATE, LIVE_TRANSCRIPT_LIMIT, type LiveViewState, reduceLiveFrame } from "./live-state";

const fold = (frames: RpcLiveFrame[], start: LiveViewState = INITIAL_LIVE_STATE) =>
	frames.reduce(reduceLiveFrame, start);

describe("reduceLiveFrame", () => {
	it("activates on the first phase and tracks levels only while active", () => {
		expect(fold([{ type: "live_levels", input: 0.5, output: 0.2 }]).inputLevel).toBe(0);
		const state = fold([
			{ type: "live_phase", phase: "listening" },
			{ type: "live_levels", input: 0.5, output: 0.2 },
		]);
		expect(state).toMatchObject({ active: true, phase: "listening", inputLevel: 0.5, outputLevel: 0.2 });
	});

	it("coalesces incremental transcript frames on role + turn", () => {
		const state = fold([
			{ type: "live_phase", phase: "listening" },
			{ type: "live_transcript", role: "user", turn: 1, text: "fix the", final: false },
			{ type: "live_transcript", role: "user", turn: 1, text: "fix the build", final: true },
			{ type: "live_transcript", role: "assistant", turn: 1, text: "On it.", final: false },
		]);
		expect(state.transcript).toEqual([
			{ role: "user", turn: 1, text: "fix the build", final: true },
			{ role: "assistant", turn: 1, text: "On it.", final: false },
		]);
	});

	it("ignores empty transcript text and caps the history", () => {
		const frames: RpcLiveFrame[] = [{ type: "live_transcript", role: "user", turn: 0, text: "", final: true }];
		for (let turn = 1; turn <= LIVE_TRANSCRIPT_LIMIT + 5; turn++) {
			frames.push({ type: "live_transcript", role: "user", turn, text: `turn ${turn}`, final: true });
		}
		const { transcript } = fold(frames);
		expect(transcript).toHaveLength(LIVE_TRANSCRIPT_LIMIT);
		expect(transcript[0]?.turn).toBe(6);
		expect(transcript.at(-1)?.turn).toBe(LIVE_TRANSCRIPT_LIMIT + 5);
	});

	it("ends cleanly, keeping the transcript and surfacing a failure cause", () => {
		const live = fold([
			{ type: "live_phase", phase: "speaking" },
			{ type: "live_levels", input: 0.4, output: 0.9 },
			{ type: "live_transcript", role: "assistant", turn: 2, text: "Done.", final: true },
		]);
		const ended = reduceLiveFrame(live, { type: "live_end" });
		expect(ended).toMatchObject({
			active: false,
			phase: "speaking",
			inputLevel: 0,
			outputLevel: 0,
			error: undefined,
		});
		expect(ended.transcript).toHaveLength(1);

		const failed = reduceLiveFrame(live, { type: "live_end", error: "socket closed" });
		expect(failed).toMatchObject({ active: false, phase: "error", error: "socket closed" });
	});

	it("reflects a muted phase", () => {
		expect(fold([{ type: "live_phase", phase: "muted" }]).muted).toBe(true);
	});
});
