/**
 * Live dictation into the composer. The microphone is captured here (16 kHz PCM16 from an
 * AudioWorklet) and streamed to the sidecar, whose speech controller sends back the words
 * as `host_dictation_*` frames: in-progress words while the user speaks, final words as each
 * phrase ends.
 *
 * The microphone opens on the click, while the sidecar loads the model, so the first words
 * are not lost: audio heard before the model is ready is held and sent once it is. A model
 * that must be downloaded first closes the microphone until it is ready instead.
 */
import type { RpcDictationFrame, RpcDictationStartResult, RpcResponse } from "../../shared/rpc-types";
import { describeError } from "./errors";

export type DictationPhase =
	/** Waiting for microphone access. */
	| "opening"
	/** Loading the speech model; heard audio is held. */
	| "preparing"
	/** Downloading the speech model; the microphone is closed meanwhile. */
	| "downloading"
	| "recording"
	/** Stopped; the last words are being finished. */
	| "transcribing";

export interface DictationView {
	phase: DictationPhase;
	/** Microphone loudness, 0–1. */
	level: number;
	/** Words still being recognized; replaced as more audio arrives. */
	partial: string;
	download?: { label: string; percent: number };
}

/** The composer edits a capture makes. */
export interface DictationEditor {
	/** Insert final words at the caret. */
	commit(text: string): void;
	/** Delete `count` characters before the caret (a spoken "submit"). */
	trim(count: number): void;
	/** Send the message (`stt.submitTrigger`), once the capture has ended. */
	submit(): void;
}

export interface MicCapture {
	stop(): void;
}

/** Opens the microphone and calls `onChunk` with each 100 ms of 16 kHz PCM16 audio. */
export type OpenMic = (onChunk: (pcm: Int16Array, level: number) => void) => Promise<MicCapture>;

export interface DictationRpc {
	dictationStart(): Promise<RpcResponse>;
	dictationAudio(pcm16Base64: string): Promise<RpcResponse>;
	dictationStop(): Promise<RpcResponse>;
	dictationCancel(): Promise<RpcResponse>;
}

export interface DictationDeps {
	rpc: DictationRpc;
	/** This tab's dictation frames; returns the unsubscribe. */
	subscribe(listener: (frame: RpcDictationFrame) => void): () => void;
	openMic: OpenMic;
	editor: DictationEditor;
	/** The strip's view; `null` once the capture has ended. */
	onView(view: DictationView | null): void;
	/** Why the capture could not run. */
	onWarning(message: string): void;
	/** The capture ended without hearing any words. */
	onNothingHeard(): void;
}

/** Audio held while the model loads; older audio is dropped past this. */
const MAX_HELD_CHUNKS = 300;

export function pcm16ToBase64(pcm: Int16Array): string {
	const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

/** One dictation, from the click that starts it until its words are in the composer. */
export class DictationSession {
	readonly #deps: DictationDeps;
	#view: DictationView = { phase: "opening", level: 0, partial: "" };
	#ended = false;
	#mic: MicCapture | undefined;
	#micOpening = false;
	/** Bumped whenever the microphone closes, so a late-opening one is closed at once. */
	#micGeneration = 0;
	#held: Int16Array[] = [];
	/** The sidecar is transcribing audio; the strip says so only once the microphone is open too. */
	#sidecarRecording = false;
	#heardWords = false;
	#submitPending = false;
	readonly #unsubscribe: () => void;

	constructor(deps: DictationDeps) {
		this.#deps = deps;
		this.#unsubscribe = deps.subscribe(frame => this.#onFrame(frame));
	}

	get phase(): DictationPhase | null {
		return this.#ended ? null : this.#view.phase;
	}

	/** Open the microphone and the speech model together. */
	start(): void {
		this.#emit();
		this.#openMic();
		void this.#deps.rpc.dictationStart().then(
			response => {
				if (this.#ended) return;
				if (!response.success) return this.#fail(response.error);
				// A start that settled idle was cancelled, or failed with a notice already shown.
				if ((response.data as RpcDictationStartResult | undefined)?.state === "idle") this.#end();
			},
			(error: unknown) => this.#fail(describeError(error)),
		);
	}

	/** Finish: transcribe what was said. Before recording begins there is nothing to keep, so it cancels. */
	stop(): void {
		if (this.#ended) return;
		if (this.#view.phase !== "recording") {
			if (this.#view.phase !== "transcribing") this.cancel();
			return;
		}
		this.#closeMic();
		this.#update({ phase: "transcribing", level: 0 });
		void this.#deps.rpc.dictationStop().then(
			response => {
				if (!response.success) this.#fail(response.error);
			},
			(error: unknown) => this.#fail(describeError(error)),
		);
	}

	/** Discard the capture and whatever was not yet inserted. */
	cancel(): void {
		if (this.#ended) return;
		void this.#deps.rpc.dictationCancel().catch(() => {});
		this.#submitPending = false;
		this.#heardWords = true; // Discarding on purpose is not "nothing heard".
		this.#end();
	}

	#onFrame(frame: RpcDictationFrame): void {
		if (this.#ended) return;
		switch (frame.type) {
			case "host_dictation_state":
				if (frame.state === "recording") this.#beginRecording();
				else if (frame.state === "transcribing") {
					this.#sidecarRecording = false;
					this.#closeMic();
					this.#update({ phase: "transcribing", level: 0 });
				} else if (frame.state === "idle") this.#end();
				return;
			case "host_dictation_download":
				// Minutes of held audio would arrive as a wall of stale words; ask again once ready.
				if (this.#view.phase !== "downloading") {
					this.#closeMic();
					this.#held = [];
				}
				this.#update({ phase: "downloading", level: 0, download: { label: frame.label, percent: frame.percent } });
				return;
			case "host_dictation_text":
				switch (frame.op) {
					case "volatile":
						this.#update({ partial: frame.text });
						return;
					case "clear":
						this.#update({ partial: "" });
						return;
					case "commit":
						this.#heardWords = true;
						this.#update({ partial: "" });
						this.#deps.editor.commit(frame.text);
						return;
					case "trim":
						this.#deps.editor.trim(frame.count);
						return;
					case "submit":
						this.#submitPending = true;
						return;
				}
				return;
			case "host_dictation_notice":
				// Status lines ("Transcribing...") mirror the state frames the strip already shows.
				if (frame.level === "warning") {
					this.#heardWords = true;
					this.#deps.onWarning(frame.message);
				}
				return;
		}
	}

	#beginRecording(): void {
		this.#sidecarRecording = true;
		const held = this.#held;
		this.#held = [];
		for (const chunk of held) this.#send(chunk);
		if (this.#mic) {
			this.#update({ phase: "recording", download: undefined });
			return;
		}
		// Still waiting on microphone access (or reopening it after a download): "Listening…"
		// over a dead meter would claim words are being heard.
		this.#update({ phase: "opening", download: undefined });
		if (!this.#micOpening) this.#openMic();
	}

	#openMic(): void {
		const generation = this.#micGeneration;
		this.#micOpening = true;
		this.#deps
			.openMic((pcm, level) => {
				if (this.#ended || generation !== this.#micGeneration) return;
				this.#update({ level });
				if (this.#sidecarRecording) this.#send(pcm);
				else if (this.#view.phase === "opening" || this.#view.phase === "preparing") {
					this.#held.push(pcm);
					if (this.#held.length > MAX_HELD_CHUNKS) this.#held.shift();
				}
			})
			.then(
				mic => {
					if (generation === this.#micGeneration) this.#micOpening = false;
					if (this.#ended || generation !== this.#micGeneration) {
						mic.stop();
						return;
					}
					this.#mic = mic;
					if (this.#view.phase === "opening")
						this.#update({ phase: this.#sidecarRecording ? "recording" : "preparing" });
				},
				(error: unknown) => {
					if (generation === this.#micGeneration) this.#micOpening = false;
					if (this.#ended || generation !== this.#micGeneration) return;
					void this.#deps.rpc.dictationCancel().catch(() => {});
					this.#fail(describeError(error));
				},
			);
	}

	#closeMic(): void {
		this.#micGeneration += 1;
		this.#micOpening = false;
		this.#mic?.stop();
		this.#mic = undefined;
	}

	#send(pcm: Int16Array): void {
		void this.#deps.rpc.dictationAudio(pcm16ToBase64(pcm)).catch((error: unknown) => {
			if (this.#ended) return;
			this.#fail(describeError(error));
		});
	}

	#update(patch: Partial<DictationView>): void {
		this.#view = { ...this.#view, ...patch };
		this.#emit();
	}

	#emit(): void {
		if (!this.#ended) this.#deps.onView(this.#view);
	}

	#fail(message: string): void {
		if (this.#ended) return;
		this.#heardWords = true;
		this.#deps.onWarning(message);
		this.#end();
	}

	#end(): void {
		if (this.#ended) return;
		this.#ended = true;
		this.#closeMic();
		this.#held = [];
		this.#unsubscribe();
		this.#deps.onView(null);
		if (this.#submitPending) this.#deps.editor.submit();
		else if (!this.#heardWords) this.#deps.onNothingHeard();
	}
}

/** The browser microphone through the capture worklet in `public/dictation-worklet.js`. */
export const openBrowserMic: OpenMic = async onChunk => {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
	});
	const context = new AudioContext({ sampleRate: 16_000, latencyHint: "interactive" });
	try {
		// A permission prompt can outlast the click's activation; a suspended context hears nothing.
		if (context.state === "suspended") await context.resume();
		await context.audioWorklet.addModule(new URL("./dictation-worklet.js", document.baseURI).href);
		const source = context.createMediaStreamSource(stream);
		const capture = new AudioWorkletNode(context, "dictation-capture", {
			numberOfInputs: 1,
			numberOfOutputs: 0,
			channelCount: 1,
			channelCountMode: "explicit",
		});
		capture.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; level: number }>) =>
			onChunk(new Int16Array(event.data.pcm), event.data.level);
		source.connect(capture);
	} catch (error) {
		for (const track of stream.getTracks()) track.stop();
		void context.close();
		throw error;
	}
	return {
		stop: () => {
			for (const track of stream.getTracks()) track.stop();
			void context.close();
		},
	};
};

/** Closing punctuation hugs the word before it rather than taking a space. */
const HUGS_PREVIOUS = /^[,.;:!?)\]}…，。！？；：）」』]/;

/**
 * Insert dictated words over the `start`–`end` selection, spaced like typed text: no space at the
 * start of a line or after whitespace, one space after a word, and one before a word that follows.
 * The caret lands after the words, before that following space, so the next phrase joins on.
 */
export function insertDictated(
	value: string,
	start: number,
	end: number,
	text: string,
): { value: string; caret: number } {
	if (!text.trim()) return { value, caret: start };
	const before = value.slice(0, start);
	const after = value.slice(end);
	let words = text;
	if (before === "" || /\s$/.test(before)) words = words.trimStart();
	else if (!/^\s/.test(words) && !HUGS_PREVIOUS.test(words)) words = ` ${words}`;
	const gap = after !== "" && !/^\s/.test(after) && !HUGS_PREVIOUS.test(after) ? " " : "";
	return { value: `${before}${words}${gap}${after}`, caret: before.length + words.length };
}

/** Delete `count` characters before the caret. */
export function trimBeforeCaret(value: string, caret: number, count: number): { value: string; caret: number } {
	const from = Math.max(0, caret - count);
	return { value: value.slice(0, from) + value.slice(caret), caret: from };
}
