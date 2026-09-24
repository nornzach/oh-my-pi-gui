import { Brain, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ThinkingLevel } from "../../../shared/rpc-types";
import { STREAM_FORMAT_FLUSH_MS, useThrottledText } from "../../hooks/use-throttled-text";
import { useDisplayPreference } from "../../lib/display-preferences";
import { cx, durationBetween, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import {
	formatThinkingForDisplay,
	hasDisplayableThinking,
	SPEED_MAX,
	SpeedTracker,
	THINKING_GLYPH_FRAMES,
	thinkingGlyphFrameDelay,
} from "../../lib/thinking";
import { useMessagesStore } from "../../stores/messages";
import { useModelStore } from "../../stores/model";
import { useUiStore } from "../../stores/ui";

export interface ThinkingBlockProps {
	/** Finalized thinking text (from a completed message). */
	text?: string;
	/** Render the live streamingThinking buffer instead of `text`. */
	live?: boolean;
	/** Start/end (epoch ms or ISO) for the duration badge. */
	startTime?: number | string;
	endTime?: number | string;
	/** Override the accent level; defaults to the model store's thinkingLevel. */
	level?: ThinkingLevel;
}

const LEVEL_LABEL: Record<ThinkingLevel, string> = {
	inherit: "inherit",
	off: "off",
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};

/** Decay/refresh cadence (ms) for the live speed gauge while streaming. */
const GAUGE_TICK_MS = 500;

/**
 * Collapsible reasoning trace (TUI parity):
 * - `proseOnlyThinking` elides fenced code to a `...` placeholder and drops
 *   empty `<!-- -->` summary sentinels (formatThinkingForDisplay port).
 * - `hideThinkingBlock` suppresses the block entirely; while reasoning is
 *   still streaming, an eased starburst pulse (✻✼❉…) shows in its place,
 *   ending once text output starts or the block finalizes.
 * - While live, a speed gauge shows the reasoning-token count (buffer length)
 *   and a windowed tok/s rate observed from buffer growth, falling back to
 *   the model store's tokensPerSecond before the first observation.
 *
 * GUI extras kept: collapsed by default, word/line counts, duration badge,
 * thinking-level accent (--omp-thinking-*). Settings arrive via get_settings
 * (settings store) and re-render live on config_update.
 */
export function ThinkingBlock({ text, live = false, startTime, endTime, level }: ThinkingBlockProps) {
	const t = useT();
	// Finalized blocks must not subscribe to the live buffer: every thinking
	// delta would re-render every mounted history block in the window.
	const streamingThinking = useMessagesStore(s => (live ? s.streamingThinking : ""));
	const streamingTextStarted = useMessagesStore(s => s.streamingText.length > 0);
	const storeLevel = useModelStore(s => s.thinkingLevel);
	const tokensPerSecond = useModelStore(s => s.tokensPerSecond);
	const hideThinkingBlock = useDisplayPreference("hideThinkingBlock");
	const proseOnly = useDisplayPreference("proseOnlyThinking");
	const thinkingExpanded = useUiStore(s => s.thinkingExpanded);
	const [open, setOpen] = useState(thinkingExpanded);
	// The Settings → GUI toggle applies to already-mounted blocks too; a manual
	// chevron click then overrides until the pref changes again.
	useEffect(() => setOpen(thinkingExpanded), [thinkingExpanded]);

	const content = live ? streamingThinking : (text ?? "");
	const isLive = live && content.length > 0;
	// Raw length still drives the live speed gauge, but formatting, word/line
	// counts, and Markdown parse share the same bounded cadence as reply text.
	// Previously a long reasoning stream reprocessed its entire growing prefix
	// on every 16 ms event batch, even while the block was collapsed.
	const displayContent = useThrottledText(content, live ? STREAM_FORMAT_FLUSH_MS : 0);
	const formatted = useMemo(() => formatThinkingForDisplay(displayContent, proseOnly), [displayContent, proseOnly]);

	const resolvedLevel: ThinkingLevel = level ?? storeLevel ?? "medium";
	// Theme tokens only go up to xhigh; "max" shares its color.
	const tokenLevel = resolvedLevel === "max" ? "xhigh" : resolvedLevel;
	const duration = durationBetween(startTime, endTime);

	// The hidden pulse mirrors the TUI: only while this block is still
	// streaming and the model is reasoning right now — once text output starts
	// or the block finalizes, hidden thinking renders nothing.
	const showPulse = hideThinkingBlock && isLive && !streamingTextStarted;

	// ── tok/s speed gauge ─────────────────────────────────────────────────
	// Deltas (not cumulative totals) feed the windowed tracker, so a buffer
	// reset on a new block never produces a spike.
	const trackerRef = useRef<SpeedTracker | null>(null);
	if (trackerRef.current === null) trackerRef.current = new SpeedTracker();
	const lastSampleRef = useRef<{ len: number; time: number } | null>(null);
	const [, setGaugeTick] = useState(0);

	useEffect(() => {
		if (!isLive) {
			lastSampleRef.current = null;
			return;
		}
		const now = performance.now();
		const last = lastSampleRef.current;
		if (last !== null && content.length < last.len) trackerRef.current?.reset();
		if (last !== null && content.length > last.len && now > last.time) {
			trackerRef.current?.observe(((content.length - last.len) / (now - last.time)) * 1000, now);
		}
		lastSampleRef.current = { len: content.length, time: now };
	}, [content, isLive]);

	// Periodic re-render while live so the windowed rate decays during lulls.
	useEffect(() => {
		if (!isLive) return;
		const timer = setInterval(() => setGaugeTick(v => v + 1), GAUGE_TICK_MS);
		return () => clearInterval(timer);
	}, [isLive]);

	const observedRate = isLive ? (trackerRef.current?.getSpeed() ?? 0) : 0;
	const rate = observedRate >= 0.05 ? observedRate : isLive && tokensPerSecond !== null ? tokensPerSecond : 0;
	const showGauge = isLive && rate >= 0.05;
	// Gray at rest, brightening toward the level accent as tok/s climbs (sqrt
	// ease so mid-stream rates already read accent-tinted) — TUI badge lerp.
	const ratePct = Math.round(100 * Math.sqrt(Math.min(rate, SPEED_MAX) / SPEED_MAX));
	const rateColor = `color-mix(in srgb, var(--omp-thinking-${tokenLevel}) ${ratePct}%, var(--omp-dim))`;

	// ── Hidden-thinking glyph pulse ─────────────────────────────────────────
	const [glyphFrame, setGlyphFrame] = useState(0);
	useEffect(() => {
		if (!showPulse) return;
		let frame = 0;
		let timer = setTimeout(function tick() {
			frame += 1;
			setGlyphFrame(frame);
			timer = setTimeout(tick, thinkingGlyphFrameDelay(frame));
		}, thinkingGlyphFrameDelay(0));
		return () => clearTimeout(timer);
	}, [showPulse]);

	if (!content) return null;

	if (hideThinkingBlock) {
		if (!showPulse) return null;
		const glyph = THINKING_GLYPH_FRAMES[glyphFrame % THINKING_GLYPH_FRAMES.length] ?? "…";
		return (
			<div
				className="omp-thinking-block omp-thinking-block--pulse mb-2 flex items-center gap-1.5 overflow-hidden rounded-md border-l-2 px-2 py-1 text-omp-sm"
				style={{ borderLeftColor: `var(--omp-thinking-${tokenLevel})` }}
			>
				<span
					aria-hidden
					className="inline-block w-3.5 text-center"
					style={{ color: `var(--omp-thinking-${tokenLevel})` }}
				>
					{glyph}
				</span>
				<span className="font-medium text-[var(--omp-muted)]">{t("chat.thinking.live")}</span>
				{showGauge && (
					<>
						<span className="tabular-nums text-[var(--omp-dim)]">{formatTokens(content.length)}</span>
						<span className="tabular-nums" style={{ color: rateColor }}>
							{t("chat.thinking.speed", { rate: rate.toFixed(1) })}
						</span>
					</>
				)}
			</div>
		);
	}

	if (!hasDisplayableThinking(content, formatted)) return null;

	const trimmed = formatted.trim();
	const words = trimmed ? trimmed.split(/\s+/).length : 0;
	const lines = formatted.split("\n").length;
	const countLabel = `${t("chat.thinking.words", { count: words.toLocaleString(), plural: words === 1 ? "" : "s" })} · ${t("chat.thinking.lines", { count: lines.toLocaleString(), plural: lines === 1 ? "" : "s" })}`;

	return (
		<div
			className="omp-thinking-block mb-2 overflow-hidden rounded-md border-l-2 transition-colors"
			style={{ borderLeftColor: `var(--omp-thinking-${tokenLevel})` }}
		>
			<button
				type="button"
				aria-expanded={open}
				aria-label={t(open ? "chat.thinking.hide" : "chat.thinking.show")}
				onClick={() => setOpen(v => !v)}
				className="omp-thinking-header flex w-full items-center gap-1.5 px-2 py-1 text-left text-omp-sm text-[var(--omp-muted)] transition-colors hover:bg-[var(--omp-bg-tertiary)]"
			>
				<ChevronRight
					aria-hidden
					className={cx("omp-thinking-chevron omp-disclosure-chevron", open && "rotate-90")}
					size={12}
				/>
				<Brain size={12} className="omp-thinking-brain" style={{ color: `var(--omp-thinking-${tokenLevel})` }} />
				{isLive ? (
					<span className="omp-thinking-state omp-thinking-shimmer font-medium">{t("chat.thinking.live")}</span>
				) : (
					<span className="omp-thinking-state font-medium" style={{ color: `var(--omp-thinking-${tokenLevel})` }}>
						{t("chat.thinking.done")}
					</span>
				)}
				<span className="omp-thinking-level text-[var(--omp-dim)]">{LEVEL_LABEL[resolvedLevel]}</span>
				{showGauge && (
					<span className="omp-thinking-gauge contents">
						<span className="tabular-nums text-[var(--omp-dim)]">{formatTokens(content.length)}</span>
						<span className="tabular-nums" style={{ color: rateColor }}>
							{t("chat.thinking.speed", { rate: rate.toFixed(1) })}
						</span>
					</span>
				)}
				<span className="omp-thinking-count tabular-nums text-[var(--omp-dim)]">{countLabel}</span>
				{duration && (
					<span className="omp-thinking-duration ml-auto tabular-nums text-[var(--omp-dim)]">{duration}</span>
				)}
			</button>
			{open ? (
				<div className="omp-thinking-body max-h-64 overflow-y-auto px-3 pb-2 font-mono text-omp-sm leading-[1.45] text-[var(--omp-muted)]">
					{isLive ? (
						<div className="omp-streaming-tail">
							{formatted}
							<span aria-hidden className="omp-caret" />
						</div>
					) : (
						<MarkdownRenderer content={formatted} />
					)}
				</div>
			) : null}
		</div>
	);
}
