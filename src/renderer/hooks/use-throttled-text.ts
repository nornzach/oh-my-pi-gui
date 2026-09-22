import { useEffect, useRef, useState } from "react";

/** Presentation cadence for growing Markdown/reasoning streams (~25 FPS). */
export const STREAM_FORMAT_FLUSH_MS = 40;

/**
 * Reveal starts kept per stream: one commit interval each, well past the
 * `--omp-motion-fast` transition a chunk fades through. Bounds the live DOM
 * without ever tearing down a chunk that is still animating.
 */
export const STREAM_REVEAL_FRONTIERS = 6;

export interface StreamingTextFrame {
	text: string;
	/**
	 * Source offsets where each of the last few reveals began, oldest first. The
	 * consumer renders one persistent chunk per interval so text that is already
	 * on screen never loses its DOM node mid-transition.
	 */
	frontiers: number[];
}

function nextFrontiers(previous: number[], deltaStart: number): number[] {
	if (previous[previous.length - 1] === deltaStart) return previous;
	return [...previous, deltaStart].slice(-STREAM_REVEAL_FRONTIERS);
}

function requestPresentationFrame(callback: FrameRequestCallback): number {
	if (typeof window.requestAnimationFrame === "function") return window.requestAnimationFrame(callback);
	return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelPresentationFrame(handle: number): void {
	if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(handle);
	else window.clearTimeout(handle);
}

/**
 * Align a fast-growing stream to browser paint frames. Incoming IPC batches may
 * arrive more frequently than the display should commit; this coalesces them
 * to the latest prefix at `intervalMs` cadence without adding timer drift.
 */
export function useStreamingTextFrame(text: string, intervalMs: number): StreamingTextFrame {
	const [frame, setFrame] = useState<StreamingTextFrame>({ text, frontiers: [0] });
	const latestRef = useRef(text);
	const displayedRef = useRef(text);
	const frameRequestRef = useRef<number | undefined>(undefined);
	const lastCommitRef = useRef(0);

	useEffect(
		() => () => {
			if (frameRequestRef.current !== undefined) cancelPresentationFrame(frameRequestRef.current);
		},
		[],
	);

	useEffect(() => {
		latestRef.current = text;

		// Reset/replacement streams must never reveal a suffix from the old value.
		if (!text.startsWith(displayedRef.current)) {
			if (frameRequestRef.current !== undefined) cancelPresentationFrame(frameRequestRef.current);
			frameRequestRef.current = undefined;
			const previousLength = displayedRef.current.length;
			displayedRef.current = text;
			const deltaStart = Math.min(previousLength, text.length);
			setFrame(() => ({ text, frontiers: [deltaStart] }));
			return;
		}

		if (text === displayedRef.current) return;
		if (intervalMs <= 0) {
			const deltaStart = displayedRef.current.length;
			displayedRef.current = text;
			setFrame(current => ({ text, frontiers: nextFrontiers(current.frontiers, deltaStart) }));
			return;
		}
		if (frameRequestRef.current !== undefined) return;

		const commitOnFrame = (now: number) => {
			const elapsed = now - lastCommitRef.current;
			if (lastCommitRef.current !== 0 && elapsed < intervalMs) {
				frameRequestRef.current = requestPresentationFrame(commitOnFrame);
				return;
			}

			frameRequestRef.current = undefined;
			const latest = latestRef.current;
			if (latest === displayedRef.current) return;
			const deltaStart = latest.startsWith(displayedRef.current) ? displayedRef.current.length : 0;
			displayedRef.current = latest;
			lastCommitRef.current = now;
			setFrame(current => ({
				text: latest,
				frontiers: deltaStart === 0 ? [0] : nextFrontiers(current.frontiers, deltaStart),
			}));
		};

		frameRequestRef.current = requestPresentationFrame(commitOnFrame);
	}, [text, intervalMs]);

	return frame;
}

/** Text-only convenience for formatted consumers that do not animate a tail. */
export function useThrottledText(text: string, intervalMs: number): string {
	return useStreamingTextFrame(text, intervalMs).text;
}
