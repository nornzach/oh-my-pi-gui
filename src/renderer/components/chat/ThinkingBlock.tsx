import { Brain, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ThinkingLevel } from "../../../shared/rpc-types";
import { STREAM_FORMAT_FLUSH_MS, useThrottledText } from "../../hooks/use-throttled-text";
import { useDisplayPreference } from "../../lib/display-preferences";
import { cx, durationBetween } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import { isRenderableMessageText } from "../../lib/messages";
import {
	formatThinkingForDisplay,
	hasDisplayableThinking,
	reportedReasoningTokens,
	THINKING_GLYPH_FRAMES,
	thinkingGlyphFrameDelay,
} from "../../lib/thinking";
import { useMessagesStore } from "../../stores/messages";
import { useModelStore } from "../../stores/model";
import { useUiStore } from "../../stores/ui";
import { Collapse, CollapseButton } from "../common/Collapse";
import { isTranscriptAtLiveEdge } from "./chat-stream-utils";
import { ReasoningGauge } from "./ReasoningGauge";
import { StreamingMarkdown } from "./StreamingText";

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
	messageReasoningTokens?: number;
	disclosure?: { expanded: boolean; onExpandedChange: (expanded: boolean) => void };
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

/**
 * Collapsible reasoning trace (TUI parity):
 * - `proseOnlyThinking` elides fenced code to a `...` placeholder and drops
 *   empty `<!-- -->` summary sentinels (formatThinkingForDisplay port).
 * - `hideThinkingBlock` suppresses the block entirely; while reasoning is
 *   still streaming, an eased starburst pulse (✻✼❉…) shows in its place,
 *   ending once text output starts or the block finalizes.
 *
 * GUI extras kept: collapsed by default, word/line counts, duration badge,
 * thinking-level accent (--omp-thinking-*). Settings arrive via get_settings
 * (settings store) and re-render live on config_update.
 */
export function ThinkingBlock({
	text,
	live = false,
	startTime,
	endTime,
	level,
	messageReasoningTokens,
	disclosure,
}: ThinkingBlockProps) {
	const t = useT();
	// Finalized blocks must not subscribe to the live buffer: every thinking
	// delta would re-render every mounted history block in the window.
	const streamingThinking = useMessagesStore(s => (live ? s.streamingThinking : ""));
	const reported = useMessagesStore(s => (live ? reportedReasoningTokens(s.streamingMessage?.usage) : undefined));
	const streamTime = useMessagesStore(s => (live ? s.streamingMessage?.timestamp : undefined));
	const streamingTextStarted = useMessagesStore(s => live && isRenderableMessageText(s.streamingText));
	const storeLevel = useModelStore(s => s.thinkingLevel);
	const hideThinkingBlock = useDisplayPreference("hideThinkingBlock");
	const proseOnly = useDisplayPreference("proseOnlyThinking");
	const thinkingExpanded = useUiStore(s => s.thinkingExpanded);
	const autoCollapseProcess = useUiStore(s => s.autoCollapseProcess);
	const compact = useUiStore(s => s.transcriptDetail === "compact");
	const defaultOpen = live && !streamingTextStarted
		? thinkingExpanded || (!compact && autoCollapseProcess)
		: thinkingExpanded && !autoCollapseProcess;
	const [localOpen, setLocalOpen] = useState(defaultOpen);
	const open = disclosure?.expanded ?? localOpen;
	const setOpen = disclosure?.onExpandedChange ?? setLocalOpen;
	// The Settings → GUI toggle applies to already-mounted blocks too; a manual
	// chevron click then overrides until the pref or live state changes again.
	useEffect(() => setLocalOpen(defaultOpen), [defaultOpen]);

	const content = live ? streamingThinking : (text ?? "");
	const isLive = live && !streamingTextStarted && content.length > 0;
	// Formatting, word/line counts, and Markdown parse share the same bounded cadence as reply text.
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
	const showPulse = hideThinkingBlock && isLive;

	const bodyRef = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	const lastScrollTop = useRef(0);
	useLayoutEffect(() => {
		const body = bodyRef.current;
		if (!body || !isLive || !open || hideThinkingBlock) follow.current = true;
		else if (follow.current && formatted) {
			body.scrollTop = body.scrollHeight;
			lastScrollTop.current = body.scrollTop;
		}
	}, [formatted, isLive, open, hideThinkingBlock]);
	const gauge = isLive ? (
		<ReasoningGauge key={`${streamTime}:${reported !== undefined}`} text={content} reported={reported} />
	) : messageReasoningTokens !== undefined ? (
		<span className="tabular-nums text-[var(--omp-dim)]">
			{t("chat.thinking.messageTokens", { count: messageReasoningTokens.toLocaleString() })}
		</span>
	) : null;

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
				{gauge}
			</div>
		);
	}

	if (!hasDisplayableThinking(content, formatted)) return null;

	const trimmed = compact ? "" : formatted.trim();
	const words = trimmed ? trimmed.split(/\s+/).length : 0;
	const lines = compact ? 0 : formatted.split("\n").length;

	return (
		<div
			className="omp-thinking-block mb-2 overflow-hidden rounded-md border-l-2 transition-colors"
			style={{ borderLeftColor: `var(--omp-thinking-${tokenLevel})` }}
		>
			<button
				type="button"
				aria-expanded={open}
				aria-label={t(open ? "chat.thinking.hide" : "chat.thinking.show")}
				onClick={() => setOpen(!open)}
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
				{gauge}
				{!compact && (
					<span className="omp-thinking-count tabular-nums text-[var(--omp-dim)]">
						{t("chat.thinking.words", { count: words.toLocaleString(), plural: words === 1 ? "" : "s" })} ·{" "}
						{t("chat.thinking.lines", { count: lines.toLocaleString(), plural: lines === 1 ? "" : "s" })}
					</span>
				)}
				{duration && (
					<span className="omp-thinking-duration ml-auto tabular-nums text-[var(--omp-dim)]">{duration}</span>
				)}
			</button>
			<Collapse open={open}>
				<div
					ref={bodyRef}
					onScroll={event => {
						const body = event.currentTarget;
						if (isTranscriptAtLiveEdge(body, 2)) follow.current = true;
						else if (body.scrollTop < lastScrollTop.current) follow.current = false;
						lastScrollTop.current = body.scrollTop;
					}}
					className="omp-thinking-body max-h-64 overflow-y-auto px-3 pb-2 font-mono text-omp-sm leading-[1.45] text-[var(--omp-muted)]"
				>
					{isLive ? (
						<StreamingMarkdown content={formatted} throttle={false} />
					) : (
						<MarkdownRenderer content={formatted} />
					)}
				</div>
				<CollapseButton label={t("chat.thinking.collapse")} onClick={() => setOpen(false)} />
			</Collapse>
		</div>
	);
}
