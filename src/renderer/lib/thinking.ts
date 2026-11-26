/**
 * Thinking-display helpers, ported from the TUI
 * (packages/coding-agent/src/utils/thinking-display.ts +
 * modes/components/assistant-message.ts) so the GUI's ThinkingBlock matches
 * the terminal rendering: prose-only fence elision, comment-noise filtering,
 * and the hidden-thinking glyph pulse.
 *
 * The TUI memoizes formatThinkingForDisplay module-wide; the GUI instead
 * memoizes per component (useMemo), so these functions stay pure.
 */

export function reportedReasoningTokens(usage: unknown): number | undefined {
	if (!usage || typeof usage !== "object" || !("reasoningTokens" in usage)) return undefined;
	const count = usage.reasoningTokens;
	return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

/** Empty if the text is only dots/ellipsis/whitespace (placeholder blocks). */
export function canonicalizeThinking(text: string | null | undefined): string {
	if (!text) return "";
	const trimmed = text.trim();
	for (let i = 0; i < trimmed.length; i++) {
		const code = trimmed.charCodeAt(i);
		if (code !== 0x2e && code !== 0x2026 && code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
			return trimmed;
		}
	}
	return "";
}

// gpt-5.x reasoning summaries pad every summary part with an empty HTML
// comment (`**Headline**\n\n<!-- -->`), streamed as a `<!--` delta followed by
// ` -->`. Comments with actual content are left untouched.
const EMPTY_COMMENT_RE = /^<!--\s*-->$/;
const OPEN_COMMENT_RE = /^<!--\s*$/;

/**
 * Whether `line` is reasoning-summary comment noise: an empty HTML comment,
 * or its still-unterminated `<!--` prefix on the last line while streaming.
 */
function isCommentNoise(line: string, isLastLine: boolean): boolean {
	const trimmed = line.trim();
	return EMPTY_COMMENT_RE.test(trimmed) || (isLastLine && OPEN_COMMENT_RE.test(trimmed));
}

/**
 * Thinking text prepared for display. Both modes drop empty `<!-- -->`
 * sentinel lines outside code fences (see {@link isCommentNoise}); prose-only
 * mode additionally elides fenced code down to a trailing ellipsis.
 */
export function formatThinkingForDisplay(text: string, proseOnly: boolean): string {
	if (!text) return text;
	const hasComment = text.includes("<!--");
	if (!proseOnly && !hasComment) return text;

	const lines = text.split("\n");
	const resultLines: string[] = [];
	let inFence = false;
	let fenceChar = "";
	let fenceLen = 0;

	const FENCE = /^( {0,3})([`~]{3,})/;
	const appendEllipsis = () => {
		let lastLineIdx = resultLines.length - 1;
		while (lastLineIdx >= 0 && resultLines[lastLineIdx]!.trim() === "") {
			lastLineIdx--;
		}

		if (lastLineIdx >= 0) {
			const lastLine = resultLines[lastLineIdx]!;
			const trimmed = lastLine.trimEnd();
			if (trimmed.endsWith("...")) {
				resultLines[lastLineIdx] = trimmed;
			} else if (trimmed.endsWith(".")) {
				resultLines[lastLineIdx] = `${trimmed.slice(0, -1)}...`;
			} else {
				resultLines[lastLineIdx] = `${trimmed}...`;
			}
		} else {
			resultLines.push("...");
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;

		if (inFence) {
			const close = FENCE.exec(line);
			// A closing fence is the same char, at least as long, with nothing else on the line.
			if (
				close &&
				close[2]![0] === fenceChar &&
				close[2]!.length >= fenceLen &&
				line.slice(close[1]!.length + close[2]!.length).trim() === ""
			) {
				inFence = false;
				fenceChar = "";
				fenceLen = 0;
			}
			// Prose mode skips all fence lines; raw mode keeps them verbatim
			// (comment markers inside fences are code, not noise).
			if (!proseOnly) resultLines.push(line);
			continue;
		}

		// Drop the whole line so `**Headline**\n\n<!-- -->` leaves no blank tail.
		if (hasComment && isCommentNoise(line, i === lines.length - 1)) continue;

		const open = FENCE.exec(line);
		if (open) {
			const marker = open[2]!;
			const ch = marker[0]!;
			// A backtick fence's info string may not contain a backtick.
			if (!(ch === "`" && line.slice(open[1]!.length + marker.length).includes("`"))) {
				inFence = true;
				fenceChar = ch;
				fenceLen = marker.length;
				if (proseOnly) {
					appendEllipsis();
				} else {
					resultLines.push(line);
				}
				continue;
			}
		}
		resultLines.push(line);
	}

	return resultLines.join("\n");
}

/** Whether a formatted thinking block has non-placeholder content worth rendering. */
export function hasDisplayableThinking(
	text: string | null | undefined,
	formattedText: string | null | undefined,
): boolean {
	if (!text || !formattedText) return false;
	// Visibility keys off the formatted text: a block whose raw text is only
	// comment noise (`<!-- -->\n`) formats to whitespace and stays hidden. The
	// raw canonicalize check still hides dot/ellipsis-only placeholder blocks.
	return formattedText.trim().length > 0 && canonicalizeThinking(text).length > 0;
}

/**
 * Frames for the hidden-thinking pulse shown while reasoning streams with the
 * block suppressed (TUI THINKING_DOTS_FRAMES). A single fixed-width starburst
 * cycles through facets so the indicator animates in place.
 */
export const THINKING_GLYPH_FRAMES = ["✻", "✼", "❉", "❊", "✺", "✹", "✸", "✶"] as const;

/** Pulse cadence bounds (ms) — see {@link thinkingGlyphFrameDelay}. */
export const THINKING_GLYPH_FRAME_MS_MIN = 70;
export const THINKING_GLYPH_FRAME_MS_MAX = 230;

/**
 * Eased dwell (ms) for a pulse frame: a raised cosine over the 8-frame cycle,
 * continuous across the wrap, so the rotation breathes (quickest at cycle
 * start, slowest at midpoint) instead of ticking at one fixed rate.
 */
export function thinkingGlyphFrameDelay(frame: number): number {
	const phase = (1 - Math.cos((2 * Math.PI * frame) / THINKING_GLYPH_FRAMES.length)) / 2;
	return THINKING_GLYPH_FRAME_MS_MIN + (THINKING_GLYPH_FRAME_MS_MAX - THINKING_GLYPH_FRAME_MS_MIN) * phase;
}

/** Rolling window (ms) over which streaming-rate observations are averaged. */
const SPEED_WINDOW_MS = 3000;
/** Clamp ceiling: a rate at or above this maps to the full accent color. */
export const SPEED_MAX = 200;

/**
 * Streaming-speed gauge (TUI SpeedTracker port). Accumulates instantaneous
 * rate observations and reports their windowed average. The Token Meter
 * supplies streaming-buffer growth in characters per second.
 */
export class SpeedTracker {
	#observations: Array<{ time: number; rate: number }> = [];

	#prune(now: number): void {
		const threshold = now - SPEED_WINDOW_MS;
		while (this.#observations.length > 0 && this.#observations[0]!.time < threshold) {
			this.#observations.shift();
		}
	}

	/** Record one instantaneous reading, clamped to {@link SPEED_MAX} so a
	 *  single oversized delta (e.g. a batched reflow tick) can't poison the
	 *  windowed average. Non-finite/negative rates ignored. */
	observe(rate: number, now = performance.now()): void {
		if (!Number.isFinite(rate) || rate < 0) return;
		this.#observations.push({ time: now, rate: Math.min(rate, SPEED_MAX) });
		this.#prune(now);
	}

	/** Windowed-average tok/s; 0 once observations age out of the window. */
	getSpeed(now = performance.now()): number {
		this.#prune(now);
		if (this.#observations.length === 0) return 0;
		let sum = 0;
		for (const o of this.#observations) sum += o.rate;
		return sum / this.#observations.length;
	}

	reset(): void {
		this.#observations = [];
	}
}
