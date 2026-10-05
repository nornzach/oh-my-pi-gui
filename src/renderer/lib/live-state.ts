import type { RpcLiveFrame, RpcLivePhase } from "../../shared/rpc-types";

/** One realtime turn's transcript, coalesced from incremental `live_transcript` frames. */
export interface LiveTranscriptEntry {
	role: "user" | "assistant";
	turn: number;
	text: string;
	final: boolean;
}

/** Renderer view of a live voice session, folded from `live_*` frames and command results. */
export interface LiveViewState {
	active: boolean;
	phase: RpcLivePhase;
	muted: boolean;
	inputLevel: number;
	outputLevel: number;
	voice?: string;
	transcript: LiveTranscriptEntry[];
	error?: string;
}

/** Older turns scroll away; the dialog is a call companion, not a session log. */
export const LIVE_TRANSCRIPT_LIMIT = 20;

export const INITIAL_LIVE_STATE: LiveViewState = {
	active: false,
	phase: "connecting",
	muted: false,
	inputLevel: 0,
	outputLevel: 0,
	transcript: [],
};

export function reduceLiveFrame(state: LiveViewState, frame: RpcLiveFrame): LiveViewState {
	switch (frame.type) {
		case "live_phase":
			return { ...state, active: true, phase: frame.phase, muted: frame.phase === "muted" ? true : state.muted };
		case "live_levels":
			return state.active ? { ...state, inputLevel: frame.input, outputLevel: frame.output } : state;
		case "live_transcript": {
			if (!frame.text) return state;
			const entry: LiveTranscriptEntry = {
				role: frame.role,
				turn: frame.turn,
				text: frame.text,
				final: frame.final,
			};
			const index = state.transcript.findIndex(item => item.role === frame.role && item.turn === frame.turn);
			const transcript =
				index === -1
					? [...state.transcript, entry].slice(-LIVE_TRANSCRIPT_LIMIT)
					: state.transcript.map((item, i) => (i === index ? entry : item));
			return { ...state, transcript };
		}
		case "live_end":
			return {
				...state,
				active: false,
				phase: frame.error ? "error" : state.phase,
				muted: false,
				inputLevel: 0,
				outputLevel: 0,
				error: frame.error,
			};
	}
}
