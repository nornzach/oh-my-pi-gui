import { useEffect, useRef, useState } from "react";

/** Presentation cadence for growing Markdown/reasoning streams (~25 FPS). */
export const STREAM_FORMAT_FLUSH_MS = 40;

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
export function useThrottledText(text: string, intervalMs: number): string {
	const [displayed, setDisplayed] = useState(text);
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

		// Reset/replacement streams must never keep showing the old value.
		if (!text.startsWith(displayedRef.current) || intervalMs <= 0) {
			if (frameRequestRef.current !== undefined) cancelPresentationFrame(frameRequestRef.current);
			frameRequestRef.current = undefined;
			displayedRef.current = text;
			setDisplayed(text);
			return;
		}

		if (text === displayedRef.current || frameRequestRef.current !== undefined) return;

		const commitOnFrame = (now: number) => {
			const elapsed = now - lastCommitRef.current;
			if (lastCommitRef.current !== 0 && elapsed < intervalMs) {
				frameRequestRef.current = requestPresentationFrame(commitOnFrame);
				return;
			}

			frameRequestRef.current = undefined;
			const latest = latestRef.current;
			if (latest === displayedRef.current) return;
			displayedRef.current = latest;
			lastCommitRef.current = now;
			setDisplayed(latest);
		};

		frameRequestRef.current = requestPresentationFrame(commitOnFrame);
	}, [text, intervalMs]);

	return displayed;
}
