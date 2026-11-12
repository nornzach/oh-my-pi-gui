import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ArrowDown,
	BookOpen,
	Bug,
	ChevronRight,
	Code2,
	FileDiff,
	Handshake,
	Languages,
	Layers,
	Lightbulb,
	ListTodo,
	PenLine,
	RotateCw,
	SearchCode,
	Sparkles,
	X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RpcQueuedMessage } from "../../../shared/rpc-types";
import { useDisplayPreference } from "../../lib/display-preferences";
import { describeError, describeProviderError } from "../../lib/errors";
import { cx, formatClock } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { messageTimestampMs } from "../../lib/message-identity";
import { abortActiveTurn, isRenderableMessageText } from "../../lib/messages";
import { collapsibleReadTarget, groupReadRows, type ReadGroupEntry } from "../../lib/read-group";
import { useTabRpc } from "../../lib/tab-rpc";
import { useMessagesStore } from "../../stores/messages";
import { type QueueLane, useQueuedMessages, useQueueStore } from "../../stores/queue";
import { useSessionStore } from "../../stores/session";
import { useRuntimeTabId } from "../../stores/session-runtime-context";
import { useActiveTabKind, useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { type TodoSnapshot, useTodoStore } from "../../stores/todo";
import { type ToolEntry, toolEntryKey, useToolsStore } from "../../stores/tools";
import { TRANSCRIPT_FOCUS_TTL_MS, useTranscriptFocusStore } from "../../stores/transcript-focus";
import { useUiStore } from "../../stores/ui";
import { LongTaskStatus, PiLogo } from "../common";
import { buildEditCandidates } from "../panels/DiffPanel";
import { DiffStat } from "../panels/workspace-ui";
import { ReadGroupCard } from "../tools/ReadGroupCard";
import { ToolCard } from "../tools/ToolCard";
import { ConversationNavigator } from "./ConversationNavigator";
import {
	buildConversationAnchors,
	buildHistoryRows,
	buildTranscriptRowKeys,
	claimRowEntrances,
	createRowEntranceState,
	findConversationAnchorIndex,
	type GestureTowardTail,
	type HistoryRow,
	isTranscriptAtLiveEdge,
	isVisibleTranscriptMessage,
	locateEntryRow,
	type MountedTranscriptRow,
	mergeTodoSnapshots,
	type Row,
	shouldRePinTranscript,
	summarizeTurnChanges,
	type TurnChangeSummary,
	tabAwaitsTranscript,
} from "./chat-stream-utils";
import { ExecutionGroup } from "./ExecutionGroup";
import { MessageBubble } from "./MessageBubble";
import { StreamingText } from "./StreamingText";
import { ThinkingBlock } from "./ThinkingBlock";
import { TranscriptFindBar } from "./TranscriptFindBar";
import { TranscriptLoading } from "./TranscriptLoading";
import { findRangesInRow, findTranscriptMatches, paintFindHighlights } from "./transcript-find";
import { useReadOnlyTranscript } from "./transcript-mode";

// TanStack's end check needs one CSS pixel for fractional scrollTop rounding.
// User intent is enforced separately by switching away from end anchoring.
const LIVE_EDGE_THRESHOLD_PX = 1;
/** How long a message opened from search stays marked. */
const FOUND_MARK_MS = 1800;
/** A revealed row or match settles this far below the top, clear of the docked composer. */
const REVEAL_TOP_INSET_PX = 96;
/** Frames a reveal keeps re-aiming while rows above it are measured (~1.5s). */
const REVEAL_MAX_FRAMES = 90;
/** Consecutive frames without movement that count as settled. */
const REVEAL_STILL_FRAMES = 3;

/**
 * Virtual-scroll message list. Stays pinned to the bottom while streaming
 * unless the user scrolls up; a floating "jump to latest" button appears when
 * unpinned. The in-flight assistant turn renders as live rows (thinking,
 * tool cards, streaming text) that unmount once message_end finalizes.
 */
export function ChatStream() {
	const tabId = useRuntimeTabId();
	const sessionId = useSessionStore(s => s.sessionId);
	return <SessionTranscript key={`${tabId ?? ""}:${sessionId}`} />;
}

function SessionTranscript() {
	const t = useT();
	const tabId = useRuntimeTabId();
	// A subagent page: someone else's history, with nothing to start or review.
	const readOnly = useReadOnlyTranscript();
	const messages = useMessagesStore(s => s.messages);
	const liveMessages = useMessagesStore(s => s.liveMessages);
	const displayMessages = useMemo(() => [...messages, ...liveMessages], [messages, liveMessages]);
	const streamingMessage = useMessagesStore(s => s.streamingMessage);
	const hasStreamingText = useMessagesStore(s => isRenderableMessageText(s.streamingText));
	const hasStreamingThinking = useMessagesStore(s => isRenderableMessageText(s.streamingThinking));
	// Primitive-valued selector: the tools store replaces the whole Map on
	// every tool event (including high-frequency partial results), so
	// subscribing to the map itself re-rendered the whole transcript window
	// per event. Only the boolean this row set cares about may re-render it.
	const hasLiveToolsForStream = useToolsStore(s => {
		if (!streamingMessage) return false;
		const streamStart = messageTimestampMs(streamingMessage);
		for (const entry of s.activeTools.values()) {
			if ((entry.status === "pending" || entry.status === "running") && entry.startTime >= streamStart) {
				return true;
			}
		}
		return false;
	});
	const isStreaming = useSessionStore(s => s.isStreaming);
	const awaitingModelSince = useSessionStore(s => s.awaitingModelSince);
	const retryInfo = useSessionStore(s => s.retryInfo);
	const compactionInfo = useSessionStore(s => s.compactionInfo);
	const manualMaintenance = useSessionStore(s => s.manualMaintenance);
	const status = useSessionStore(s => s.status);
	const sessionId = useSessionStore(s => s.sessionId);
	// Shared agent compaction preference and GUI-local transcript detail.
	const collapseCompacted = useDisplayPreference("collapseCompacted");
	const transcriptDetail = useUiStore(s => s.transcriptDetail);
	const switchPending = useSessionStore(s => s.switchPending);
	const savedView = useSessionStore(s => s.transcriptView);
	const saveView = useSessionStore(s => s.saveTranscriptView);
	const [restoreView] = useState(() => (savedView?.sessionId === sessionId ? savedView : null));
	const [preCompactionOpen, setPreCompactionOpen] = useState(restoreView?.preCompactionOpen ?? false);
	const [expandedProcessKeys, setExpandedProcessKeys] = useState<Set<string>>(
		() => restoreView?.expandedProcessKeys ?? new Set(),
	);
	const [pinned, setPinned] = useState(restoreView?.pinned ?? true);
	const [visibleRowIndex, setVisibleRowIndex] = useState(Number.MAX_SAFE_INTEGER);
	// Virtualizer measurements and programmatic scrollToIndex both emit scroll
	// events. Only an actual wheel/touch/scrollbar/keyboard gesture may unpin the
	// transcript; otherwise a session hydrate can mistake its own layout shift
	// for user intent and strand the view in arbitrary history.
	const userScrollIntentRef = useRef(!pinned);
	// Where the reader was looking when they last moved the viewport themselves.
	const gestureAnchorRef = useRef<{ index: string; offset: number } | null>(null);
	// And which way they moved it: only a gesture toward the tail may re-engage
	// following, so a stray tail-follow write cannot masquerade as reader intent.
	const gestureTowardTailRef = useRef<GestureTowardTail>(null);
	// Stops an in-flight reveal (search hit, find match); any reader gesture calls it.
	const revealCancelRef = useRef<(() => void) | null>(null);

	const lastCompactionIndex = displayMessages.findLastIndex(message => message.role === "compactionSummary");
	const hiddenCount = collapseCompacted && !preCompactionOpen && lastCompactionIndex > 0 ? lastCompactionIndex : 0;
	const todoHistory = useTodoStore(s => s.history);
	const historyRows = useMemo<HistoryRow[]>(() => {
		const built = buildHistoryRows(
			hiddenCount > 0 ? displayMessages.slice(hiddenCount) : displayMessages,
			transcriptDetail,
			expandedProcessKeys,
		);
		// Read-tool grouping (TUI parity) folds consecutive collapsible reads into
		// one card — only in full mode; compact mode's ProcessGroup already folds
		// ALL consecutive tool work, so a second fold would nest redundantly.
		const grouped = transcriptDetail === "compact" ? built : (groupReadRows(built) as HistoryRow[]);
		// Archived todo changes interleave by timestamp (transcript archive rows).
		return mergeTodoSnapshots(grouped, todoHistory);
	}, [displayMessages, hiddenCount, transcriptDetail, todoHistory, expandedProcessKeys]);

	// What the latest run changed on disk, once it has settled: closes the turn
	// with one line leading to the review drawer. Tool events stream in at a high
	// rate mid-run, so the map is only subscribed while idle.
	const toolsTab = useActiveTabKind() !== "chat" && readOnly === null;
	const lastPromptAt = useMemo(() => {
		const prompt = displayMessages.findLast(message => message.role === "user");
		return prompt ? messageTimestampMs(prompt) : null;
	}, [displayMessages]);
	const settledTools = useToolsStore(s => (isStreaming ? null : s.activeTools));
	const turnChanges = useMemo(
		() =>
			toolsTab && settledTools && lastPromptAt !== null
				? summarizeTurnChanges(buildEditCandidates(settledTools), lastPromptAt)
				: null,
		[toolsTab, settledTools, lastPromptAt],
	);

	// The assistant message exists as an empty shell from message_start until
	// the first delta — only real content swaps the status row for the
	// streaming rows, so the shell window never reads as dead air.
	const hasStreamedContent =
		streamingMessage != null &&
		(hasStreamingText ||
			hasStreamingThinking ||
			isVisibleTranscriptMessage(streamingMessage) ||
			hasLiveToolsForStream);

	// One status row for every "agent busy but nothing visible" window,
	// mirroring the TUI's loader line: auto-retry delay/attempt (warning),
	// auto-compaction maintenance, or waiting on the model's first event.
	// Priority matches the TUI, whose transient loaders replace the working
	// loader; tool-execution windows show running tool cards instead.
	const showStatusRow =
		retryInfo != null ||
		compactionInfo != null ||
		manualMaintenance != null ||
		(isStreaming && awaitingModelSince != null && !hasStreamedContent);

	// Pending queue bubbles tail the stream in delivery order (steering
	// interrupts first, follow-ups after) — the future user turns, deletable
	// in place via queue_remove.
	const queued = useQueuedMessages();

	// Streaming deltas rerender this component for the live row, but they do not
	// change finalized history. Keep the O(history) row/key projection stable so
	// a long transcript does not get rebuilt for every token.
	const { rows, rowKeys } = useMemo(() => {
		const nextRows: Row[] = [];
		if (hiddenCount > 0) {
			nextRows.push({ kind: "expander", count: hiddenCount });
		}
		nextRows.push(...historyRows);
		if (turnChanges && lastPromptAt !== null && !isStreaming && !showStatusRow) {
			nextRows.push({ kind: "turnChanges", since: lastPromptAt, summary: turnChanges });
		}
		if (hasStreamedContent && streamingMessage) {
			nextRows.push({ kind: "streaming", message: streamingMessage });
		}
		if (showStatusRow) {
			nextRows.push({ kind: "pending" });
		}
		for (const item of queued.steering) {
			nextRows.push({ kind: "queued", item, lane: "steering" });
		}
		for (const item of queued.followUp) {
			nextRows.push({ kind: "queued", item, lane: "followUp" });
		}
		return {
			rows: nextRows,
			rowKeys: buildTranscriptRowKeys(nextRows),
		};
	}, [
		hiddenCount,
		historyRows,
		turnChanges,
		lastPromptAt,
		isStreaming,
		hasStreamedContent,
		showStatusRow,
		queued.steering,
		queued.followUp,
		streamingMessage,
	]);

	const parentRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLDivElement>(null);
	const conversationAnchors = useMemo(() => buildConversationAnchors(rows, rowKeys), [rows, rowKeys]);
	const tailRowKey = rowKeys.at(-1);
	const activeConversationIndex = useMemo(
		() => findConversationAnchorIndex(conversationAnchors, visibleRowIndex),
		[conversationAnchors, visibleRowIndex],
	);
	const handleVirtualizerChange = useCallback((instance: { range: { startIndex: number } | null }) => {
		const next = instance.range?.startIndex;
		if (next == null) return;
		setVisibleRowIndex(current => (current === next ? current : next));
	}, []);

	const STARTERS = [
		{ icon: Code2, title: t("chat.starter.understand.title"), prompt: t("chat.starter.understand.prompt") },
		{ icon: Bug, title: t("chat.starter.fix.title"), prompt: t("chat.starter.fix.prompt") },
		{ icon: Sparkles, title: t("chat.starter.build.title"), prompt: t("chat.starter.build.prompt") },
		{ icon: SearchCode, title: t("chat.starter.review.title"), prompt: t("chat.starter.review.prompt") },
	] as const;
	const CHAT_STARTERS = [
		{ icon: BookOpen, title: t("chat.starter.explain.title"), prompt: t("chat.starter.explain.prompt") },
		{ icon: PenLine, title: t("chat.starter.draft.title"), prompt: t("chat.starter.draft.prompt") },
		{ icon: Lightbulb, title: t("chat.starter.brainstorm.title"), prompt: t("chat.starter.brainstorm.prompt") },
		{ icon: Languages, title: t("chat.starter.translate.title"), prompt: t("chat.starter.translate.prompt") },
	] as const;
	/** Chat tabs get a conversation-oriented empty state (agent starters imply tools). */
	const isChat = useActiveTabKind() === "chat";
	const starters = isChat ? CHAT_STARTERS : STARTERS;
	// A fresh tab has no transcript to wait for: its start screen can show while
	// the sidecar boots instead of a spinner on a blank page. A tab resuming a
	// session keeps the spinner, so the start screen never flashes before history.
	const tabHasHistory = useTabsStore(state =>
		tabAwaitsTranscript(state.tabs.find(candidate => candidate.id === tabId)),
	);
	const awaitingTranscript = status === "starting" && (tabHasHistory || readOnly !== null);

	const virtualizer = useVirtualizer({
		count: rows.length,
		initialOffset: restoreView?.scrollOffset ?? 0,
		initialMeasurementsCache: restoreView?.measurements,
		getItemKey: index => rowKeys[index] ?? index,
		// The reader's gesture is the only thing that may move the viewport away from
		// the tail, so the virtualizer never anchors on its own: an end anchor
		// reconciles on every measurement, and one of those reconciliations landing in
		// the same frame as a wheel-up drags the reader back to the live edge. Tail
		// following is the explicit, gesture-vetoed effect below instead.
		anchorTo: "start",
		// Appends are followed by the explicit `pinned` effect below. Keeping the
		// virtualizer's independent append follower enabled made a small manual
		// scroll-up lose to streaming growth before React could unpin the view.
		followOnAppend: false,
		scrollEndThreshold: LIVE_EDGE_THRESHOLD_PX,
		// Row measurements can arrive while React is committing hydrated history.
		// Async rerenders avoid react-dom flushSync re-entry and the stale compositor
		// layers it produced on large transcripts.
		useFlushSync: false,
		getScrollElement: () => parentRef.current,
		estimateSize: i => {
			const kind = rows[i]?.kind;
			if (kind === "streaming") return 80;
			if (kind === "pending" || kind === "queued" || kind === "turnChanges") return 56;
			if (kind === "expander" || kind === "process" || kind === "todoSnapshot") return 48;
			if (kind === "message") return 72;
			return 160;
		},
		overscan: 8,
		onChange: handleVirtualizerChange,
	});
	const totalSize = virtualizer.getTotalSize();
	const viewRef = useRef({ pinned, preCompactionOpen, expandedProcessKeys });
	viewRef.current = { pinned, preCompactionOpen, expandedProcessKeys };
	useLayoutEffect(
		() => () => {
			const scrollOffset = virtualizer.scrollOffset ?? 0;
			const anchor = virtualizer.getVirtualItemForOffset(scrollOffset);
			saveView({
				sessionId,
				...viewRef.current,
				scrollOffset,
				anchorKey: typeof anchor?.key === "string" ? anchor.key : undefined,
				anchorOffset: anchor ? scrollOffset - anchor.start : 0,
				measurements: virtualizer.takeSnapshot(),
			});
		},
		[sessionId, saveView, virtualizer],
	);
	const restoredAnchor = useRef(false);
	useLayoutEffect(() => {
		if (restoredAnchor.current || !restoreView || restoreView.pinned) return;
		const index = rowKeys.indexOf(restoreView.anchorKey ?? "");
		if (index < 0) return;
		const offset = virtualizer.getOffsetForIndex(index, "start")?.[0];
		if (offset === undefined) return;
		virtualizer.scrollToOffset(offset + restoreView.anchorOffset);
		restoredAnchor.current = true;
	}, [restoreView, rowKeys, virtualizer]);

	// Whether the tail belongs to the follower. An upward gesture is the only thing
	// that revokes it: `pinned` carries the reader's intent, and the measured edge is
	// the fallback for a stale unpinned flag from a restored view. Reading only the
	// measured edge let one frame of lag strand the stream — `scrollToEnd()` targets
	// the virtualizer's size, which trails a row that is still growing, so the view
	// fell outside the edge slack and the tail was abandoned for the rest of the run.
	const followsTail = useCallback(
		(el: HTMLElement) =>
			viewRef.current.pinned || (isTranscriptAtLiveEdge(el) && gestureTowardTailRef.current !== false),
		[],
	);

	// Follow appended rows and same-count tail replacements (notably the
	// pending -> streaming transition) while the viewport sits at the live edge.
	useEffect(() => {
		if (rows.length === 0 || totalSize === 0) return;
		void sessionId;
		void tailRowKey;
		const frame = requestAnimationFrame(() => {
			const el = parentRef.current;
			if (!el) return;
			if (!followsTail(el)) return;
			// A wheel gesture can arrive before React cleans up this queued frame.
			if (userScrollIntentRef.current) return;
			virtualizer.scrollToEnd();
		});
		return () => cancelAnimationFrame(frame);
	}, [virtualizer, followsTail, rows.length, tailRowKey, sessionId, totalSize]);

	// Row measurements, fonts and images move the live edge after React has
	// committed the new rows: observe the canvas sizer. The viewport moves it
	// too — a composer growing with a long draft, a dock card opening, the window
	// resizing — so a pinned transcript follows the scroll container's own box
	// as well, instead of letting the latest turn slide under the composer.
	useEffect(() => {
		const el = parentRef.current;
		const canvas = canvasRef.current;
		if (!el || !canvas || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			if (userScrollIntentRef.current) return;
			if (followsTail(el)) virtualizer.scrollToEnd();
		});
		observer.observe(canvas);
		observer.observe(el);
		return () => observer.disconnect();
	}, [virtualizer, followsTail]);

	// Entrance motion for content that genuinely arrives. Marking is imperative and
	// one-shot per row key so it never replays when the virtualizer recycles a row
	// back into the viewport, and never resets a fade that is still running.
	const lastAppended = useMessagesStore(s => s.lastAppended);
	const liveAppendRef = useRef(lastAppended);
	const entranceRef = useRef(createRowEntranceState(sessionId, rowKeys));
	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const slots = new Map<string, HTMLElement>();
		const mounted: MountedTranscriptRow[] = [];
		for (const slot of canvas.querySelectorAll<HTMLElement>("[data-transcript-kind][data-row-key]")) {
			const key = slot.dataset.rowKey;
			const index = Number(slot.dataset.index);
			if (key === undefined || !Number.isFinite(index)) continue;
			slots.set(key, slot);
			mounted.push({ index, key });
		}
		const claims = claimRowEntrances(entranceRef.current, {
			sessionId,
			// `lastAppended` is untouched by hydration and pagination, so a change
			// here is a message this window has not shown before.
			live: isStreaming || lastAppended !== liveAppendRef.current,
			rowKeys,
			mounted,
		});
		liveAppendRef.current = lastAppended;
		for (const key of claims) slots.get(key)?.classList.add("omp-row-arrive");
	});

	// The row the reader is looking at, plus how far it sits from the top of the
	// viewport. Row indices are stable while a transcript streams, so this survives
	// the virtualizer swapping height estimates for measurements.
	const readingAnchor = useCallback((el: HTMLElement) => {
		const top = el.getBoundingClientRect().top;
		for (const row of el.querySelectorAll<HTMLElement>("[data-index]")) {
			const box = row.getBoundingClientRect();
			if (box.bottom > top + 4) return { index: row.dataset.index ?? "", offset: box.top - top };
		}
		return null;
	}, []);

	const handleScroll = useCallback(() => {
		if (!userScrollIntentRef.current) return;
		const el = parentRef.current;
		if (!el) return;
		const anchor = readingAnchor(el);
		if (anchor) {
			const looked = gestureAnchorRef.current;
			gestureAnchorRef.current = anchor;
			// Same row, same place in it: the document moved under the reader, which
			// happens when measurements replace estimates above the viewport. Reading
			// that as "the reader came back" re-pins a view they just took.
			if (looked && looked.index === anchor.index && Math.abs(looked.offset - anchor.offset) < 2) return;
		}
		const nextPinned = shouldRePinTranscript(gestureTowardTailRef.current, isTranscriptAtLiveEdge(el));
		setPinned(nextPinned);
		// Reaching the live edge by a tailward gesture hands layout growth back to
		// the follower until another explicit gesture.
		if (nextPinned) userScrollIntentRef.current = false;
	}, [readingAnchor]);

	// Every reader gesture takes the viewport: block the follower, forget the previous
	// reading anchor, and record which way they moved so only a trip back to the tail
	// can hand it over again.
	const beginGesture = useCallback((towardTail: GestureTowardTail) => {
		revealCancelRef.current?.();
		userScrollIntentRef.current = true;
		gestureAnchorRef.current = null;
		gestureTowardTailRef.current = towardTail;
	}, []);

	// A gesture can end without ever producing a scroll delta: a downward flick
	// while already at the bottom, or a scrollbar press that never moves. Since
	// handleScroll is the only other place the latch clears, an unlatched scroll
	// would leave the transcript latched forever — `pinned` stays true (so "jump
	// to latest" never appears) and both follow paths stay blocked.
	const endScrollGesture = useCallback(() => {
		const el = parentRef.current;
		userScrollIntentRef.current = false;
		gestureAnchorRef.current = null;
		if (el && isTranscriptAtLiveEdge(el)) setPinned(true);
	}, []);

	const releaseTailPin = useCallback(() => {
		beginGesture(null);
		setPinned(false);
	}, [beginGesture]);

	const handleWheel = useCallback(
		(event: React.WheelEvent<HTMLDivElement>) => {
			if (event.deltaY === 0) return; // A horizontal wheel claims nothing.
			revealCancelRef.current?.();
			if (event.deltaY > 0) {
				// Toward the tail needs no veto: an unpinned follower never moves the view,
				// and `handleScroll` re-pins once the movement lands. Latching here could
				// strand the transcript for good — a wheel that stops a few pixels short of
				// the edge emits no further scroll event to release the latch, so a pinned
				// view would stop following with nothing for the reader to act on.
				gestureTowardTailRef.current = true;
				return;
			}
			beginGesture(false);
			setPinned(false);
		},
		[beginGesture],
	);

	const handleScrollPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const right = event.currentTarget.getBoundingClientRect().right;
			if (event.clientX >= right - 20) {
				beginGesture(null);
				setPinned(false);
			}
		},
		[beginGesture],
	);

	const handleScrollKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) {
				revealCancelRef.current?.();
				gestureTowardTailRef.current = true;
				return;
			}
			if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
				beginGesture(false);
				setPinned(false);
			}
		},
		[beginGesture],
	);

	const jumpToLatest = useCallback(() => {
		userScrollIntentRef.current = false;
		gestureAnchorRef.current = null;
		gestureTowardTailRef.current = true;
		setPinned(true);
		virtualizer.scrollToEnd();
	}, [virtualizer]);

	// A send reclaims the live edge even when the user had scrolled up. Mounted
	// keyed per tab+session, so seeding from the mount-time value keeps a
	// historical nonce from yanking a restored mid-transcript view to the bottom.
	const pinNonce = useSessionStore(s => s.transcriptPinNonce);
	const lastPinNonce = useRef(pinNonce);
	useEffect(() => {
		if (lastPinNonce.current === pinNonce) return;
		lastPinNonce.current = pinNonce;
		jumpToLatest();
	}, [pinNonce, jumpToLatest]);

	// Bring one row (or a spot inside it) near the top of the view and hold it
	// there. Rows above it measure taller than their estimates as they mount, and
	// the virtualizer never re-anchors on its own (see `anchorTo`), so a single
	// scrollToIndex lands short and the row drifts out of view; re-aim each frame
	// until it holds still. Any reader gesture cancels it.
	const revealRow = useCallback(
		(index: number, locate?: (row: HTMLElement) => number | null) => {
			revealCancelRef.current?.();
			userScrollIntentRef.current = false;
			gestureAnchorRef.current = null;
			gestureTowardTailRef.current = false;
			viewRef.current.pinned = false;
			setPinned(false);
			virtualizer.scrollToIndex(index, { align: "start" });
			let frames = 0;
			let still = 0;
			let handle = 0;
			const stop = () => {
				cancelAnimationFrame(handle);
				if (revealCancelRef.current === stop) revealCancelRef.current = null;
			};
			const aim = () => {
				const scroller = parentRef.current;
				if (!scroller || ++frames > REVEAL_MAX_FRAMES) return stop();
				const row = scroller.querySelector<HTMLElement>(`[data-index="${index}"]`);
				if (!row) {
					virtualizer.scrollToIndex(index, { align: "start" });
					handle = requestAnimationFrame(aim);
					return;
				}
				const inset = Math.min(REVEAL_TOP_INSET_PX, scroller.clientHeight / 4);
				const top = locate?.(row) ?? row.getBoundingClientRect().top;
				const delta = top - scroller.getBoundingClientRect().top - inset;
				const before = scroller.scrollTop;
				if (Math.abs(delta) >= 1) scroller.scrollTop = before + delta;
				// Settled, or pinned against either end of the document.
				if (Math.abs(delta) < 1 || scroller.scrollTop === before) {
					if (++still >= REVEAL_STILL_FRAMES) return stop();
				} else {
					still = 0;
				}
				handle = requestAnimationFrame(aim);
			};
			revealCancelRef.current = stop;
			handle = requestAnimationFrame(aim);
		},
		[virtualizer],
	);
	useEffect(() => () => revealCancelRef.current?.(), []);
	const jumpToConversation = useCallback((rowIndex: number) => revealRow(rowIndex), [revealRow]);
	const updateProcessExpanded = useCallback((key: string, expanded: boolean) => {
		setExpandedProcessKeys(current => {
			if (current.has(key) === expanded) return current;
			const next = new Set(current);
			if (expanded) next.add(key);
			else next.delete(key);
			return next;
		});
	}, []);

	// Open at a message (conversation search): once this tab shows the requested
	// session file with its history loaded, bring the message near the top of the
	// view and mark it. Earlier-than-compaction history opens first; a folded
	// process group opens to show it. A message on another branch says so.
	const sessionFile = useSessionStore(s => s.sessionFile);
	const focusTarget = useTranscriptFocusStore(s => s.target);
	const settleFocus = useTranscriptFocusStore(s => s.settle);
	const [foundKey, setFoundKey] = useState<string | null>(null);
	useEffect(() => {
		const target = focusTarget;
		if (!target || target.sessionPath !== sessionFile) return;
		if (Date.now() - target.requestedAt > TRANSCRIPT_FOCUS_TTL_MS) {
			settleFocus(target.nonce);
			return;
		}
		if (status !== "ready" || switchPending || messages.length === 0) return;
		if (hiddenCount > 0 && displayMessages.slice(0, hiddenCount).some(m => m.entryId === target.entryId)) {
			setPreCompactionOpen(true);
			return;
		}
		settleFocus(target.nonce);
		const found = locateEntryRow(rows, target.entryId);
		if (!found) {
			toast({ variant: "info", message: t("search.notOnBranch") });
			return;
		}
		const key = rowKeys[found.index] ?? null;
		if (found.kind === "process" && key) updateProcessExpanded(key, true);
		// Hold the view on the message: no tail following until the reader heads back down.
		revealRow(found.index);
		setFoundKey(key);
	}, [
		focusTarget,
		sessionFile,
		status,
		switchPending,
		messages.length,
		hiddenCount,
		displayMessages,
		rows,
		rowKeys,
		settleFocus,
		t,
		updateProcessExpanded,
		revealRow,
	]);
	useEffect(() => {
		if (foundKey === null) return;
		const timer = window.setTimeout(() => setFoundKey(null), FOUND_MARK_MS);
		return () => clearTimeout(timer);
	}, [foundKey]);

	// Find in this conversation (⌘F). Matches come from the message data, since
	// rows scrolled out of view are not in the DOM for the browser's own find.
	const findRequest = useUiStore(s => s.transcriptFindRequest);
	const activeTabId = useTabsStore(s => s.activeTabId);
	const [findOpen, setFindOpen] = useState(false);
	const [findQuery, setFindQuery] = useState("");
	const [findIndex, setFindIndex] = useState(0);
	const findInputRef = useRef<HTMLInputElement>(null);
	const seenFindRequest = useRef(findRequest.nonce);
	// The handlers below are rebuilt every render; the request effect reads the latest.
	const findActions = useRef({ changeQuery: (_query: string) => {}, step: (_direction: 1 | -1) => {} });
	useEffect(() => {
		if (findRequest.nonce === seenFindRequest.current) return;
		seenFindRequest.current = findRequest.nonce;
		// Split panes each hold a transcript; only the focused tab answers.
		if (tabId && tabId !== activeTabId) return;
		if (findRequest.command !== "find") {
			findActions.current.step(findRequest.command === "next" ? 1 : -1);
			return;
		}
		// Selected text on one line becomes the query, and the view goes to it.
		const selected = window.getSelection()?.toString().trim();
		if (selected && !selected.includes("\n")) findActions.current.changeQuery(selected);
		setFindOpen(true);
		// A bar that is already open takes focus back; a new one autofocuses.
		findInputRef.current?.focus();
		findInputRef.current?.select();
	}, [findRequest, tabId, activeTabId]);
	const findMatches = useMemo(
		() => (findOpen ? findTranscriptMatches(rows, findQuery) : []),
		[findOpen, rows, findQuery],
	);
	const findCurrent = findMatches.length === 0 ? 0 : Math.min(findIndex, findMatches.length - 1);
	const goToMatch = useCallback(
		(match: { rowIndex: number; occurrence: number }, query: string) => {
			const row = rows[match.rowIndex];
			const key = rowKeys[match.rowIndex];
			if (row?.kind === "process" && key) updateProcessExpanded(key, true);
			revealRow(match.rowIndex, element => {
				const ranges = findRangesInRow(element, query);
				return ranges[Math.min(match.occurrence, ranges.length - 1)]?.getBoundingClientRect().top ?? null;
			});
		},
		[rows, rowKeys, revealRow, updateProcessExpanded],
	);
	const changeFindQuery = (query: string) => {
		setFindQuery(query);
		// A new query starts from where the reader is, not from the top.
		const matches = findTranscriptMatches(rows, query);
		const ahead = matches.findIndex(match => match.rowIndex >= visibleRowIndex);
		const next = ahead === -1 ? 0 : ahead;
		setFindIndex(next);
		const match = matches[next];
		if (match) goToMatch(match, query);
	};
	const stepFind = (direction: 1 | -1) => {
		if (findMatches.length === 0) return;
		const next = (findCurrent + direction + findMatches.length) % findMatches.length;
		setFindIndex(next);
		const match = findMatches[next];
		if (match) goToMatch(match, findQuery);
	};
	findActions.current = { changeQuery: changeFindQuery, step: stepFind };
	const closeFind = () => {
		setFindOpen(false);
		paintFindHighlights([], null);
		parentRef.current?.focus({ preventScroll: true });
	};
	// Repaint after every render while open: rows mount and unmount as the reader scrolls.
	useLayoutEffect(() => {
		if (!findOpen) return;
		const scroller = parentRef.current;
		if (!scroller || findMatches.length === 0) {
			paintFindHighlights([], null);
			return;
		}
		const current = findMatches[findCurrent];
		const matchedRows = new Set(findMatches.map(match => match.rowIndex));
		const all: Range[] = [];
		let currentRange: Range | null = null;
		for (const element of scroller.querySelectorAll<HTMLElement>("[data-index]")) {
			const index = Number(element.dataset.index);
			if (!matchedRows.has(index)) continue;
			const ranges = findRangesInRow(element, findQuery);
			all.push(...ranges);
			if (current?.rowIndex === index)
				currentRange = ranges[Math.min(current.occurrence, ranges.length - 1)] ?? null;
		}
		paintFindHighlights(all, currentRange);
	});
	useEffect(() => () => paintFindHighlights([], null), []);

	// Messages hydrate via hydrateSession (use-rpc-events) on sidecar ready —
	// no separate fetch here (that would double-download the transcript).

	return (
		<>
			<div className="omp-transcript-editorial relative min-h-0 flex-1 bg-transparent">
				{findOpen && (
					<TranscriptFindBar
						current={findCurrent}
						inputRef={findInputRef}
						onClose={closeFind}
						onQueryChange={changeFindQuery}
						onStep={stepFind}
						query={findQuery}
						total={findMatches.length}
					/>
				)}
				<div
					ref={parentRef}
					aria-label={t("chat.transcript.label")}
					onScroll={handleScroll}
					onWheel={handleWheel}
					onTouchMove={releaseTailPin}
					onTouchEnd={endScrollGesture}
					onPointerDown={handleScrollPointerDown}
					onPointerUp={endScrollGesture}
					onPointerCancel={endScrollGesture}
					onKeyDown={handleScrollKeyDown}
					tabIndex={0}
					className="omp-transcript-scroll h-full overflow-y-auto overscroll-contain"
				>
					{switchPending && (
						<div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px overflow-hidden">
							<div className="omp-indeterminate-progress h-full bg-[var(--omp-accent)]" />
						</div>
					)}
					{awaitingTranscript && rows.length === 0 && !switchPending && <TranscriptLoading />}
					{!awaitingTranscript && rows.length === 0 && !isStreaming && !switchPending && readOnly === null && (
						<div className="omp-empty-canvas flex min-h-full flex-col justify-center pb-20">
							<div className="omp-empty-logo mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--omp-border-muted)] bg-[var(--omp-selected-bg)] text-[var(--omp-accent)]">
								<PiLogo size={22} />
							</div>
							<h1 className="font-display text-omp-display font-semibold leading-tight tracking-[-0.025em] text-[var(--omp-text)]">
								{isChat ? t("chat.empty.title.chat") : t("chat.empty.title")}
							</h1>
							<p className="mt-2 max-w-2xl text-omp-xl leading-relaxed text-[var(--omp-muted)]">
								{isChat ? t("chat.empty.subtitle.chat") : t("chat.empty.subtitle")}
							</p>
							<div className="omp-starter-grid mt-8 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
								{starters.map(({ icon: Icon, title, prompt }) => (
									<button
										key={title}
										type="button"
										onClick={() =>
											window.dispatchEvent(
												new CustomEvent("omp:fill-composer", { detail: { text: prompt, tabId } }),
											)
										}
										className="omp-starter-card omp-lift group flex min-h-20 items-start gap-3 rounded-2xl border border-[var(--omp-border)] p-4 text-left shadow-[var(--omp-shadow-sm)] hover:border-[var(--omp-border-accent)] hover:bg-[var(--omp-bg-secondary)]"
									>
										<span className="omp-starter-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--omp-selected-bg)] text-[var(--omp-accent)]">
											<Icon size={17} />
										</span>
										<span>
											<span className="block text-omp-lg font-semibold text-[var(--omp-text)]">{title}</span>
											<span className="mt-1 block text-omp-lg leading-snug text-[var(--omp-muted)]">
												{prompt}
											</span>
										</span>
									</button>
								))}
							</div>
						</div>
					)}
					<div
						ref={canvasRef}
						className="omp-transcript-canvas"
						style={{ height: totalSize, position: "relative", width: "100%" }}
					>
						{virtualizer.getVirtualItems().map(item => {
							const row = rows[item.index];
							if (!row) return null;
							const rowKey = rowKeys[item.index] ?? String(item.key);
							return (
								<div
									key={item.key}
									data-index={item.index}
									data-row-key={rowKey}
									data-transcript-kind={row.kind}
									className={rowKey === foundKey ? "omp-row-found" : undefined}
									ref={virtualizer.measureElement}
									style={{
										position: "absolute",
										top: 0,
										left: 0,
										width: "100%",
										transform: `translateY(${item.start}px)`,
									}}
								>
									<div className="omp-transcript-row w-full">
										{row.kind === "message" ? (
											<MessageBubble
												message={row.message}
												reaction={row.reaction}
												repeats={row.repeats}
												runningIndicator="dot"
											/>
										) : row.kind === "readGroup" ? (
											<ReadGroupCard entries={row.entries} runningIndicator="dot" usage={row.usage} />
										) : row.kind === "process" ? (
											<ProcessGroup
												expanded={expandedProcessKeys.has(rowKey)}
												onExpandedChange={expanded => updateProcessExpanded(rowKey, expanded)}
												row={row}
											/>
										) : row.kind === "streaming" ? (
											<StreamingRows
												expanded={expandedProcessKeys.has(rowKey)}
												onExpandedChange={expanded => updateProcessExpanded(rowKey, expanded)}
											/>
										) : row.kind === "queued" ? (
											<QueuedMessageBubble item={row.item} lane={row.lane} />
										) : row.kind === "todoSnapshot" ? (
											<TodoSnapshotCard entry={row.entry} />
										) : row.kind === "turnChanges" ? (
											<TurnChangesRow summary={row.summary} />
										) : row.kind === "expander" ? (
											<button
												type="button"
												onClick={() => setPreCompactionOpen(true)}
												className="omp-history-expander omp-pressable ml-(--omp-editorial-inset) mr-(--omp-editorial-edge) my-2 flex items-center gap-2 rounded-lg border border-[var(--omp-border)] px-3 py-1.5 text-omp-sm font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-bg-tertiary)] hover:text-[var(--omp-text)]"
											>
												{t("chat.compaction.showEarlier", { count: row.count })}
											</button>
										) : (
											<TurnStatusRow />
										)}
									</div>
								</div>
							);
						})}
					</div>
				</div>
				<button
					type="button"
					onClick={jumpToLatest}
					aria-label={t("chat.jumpToLatest")}
					className={cx(
						"absolute bottom-5 left-1/2 flex h-9 -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] px-4 text-omp-md font-medium text-[var(--omp-text)] shadow-[var(--omp-shadow-md)] transition-all hover:bg-[var(--omp-selected-bg)]",
						pinned ? "pointer-events-none translate-y-12 opacity-0" : "translate-y-0 opacity-100",
					)}
				>
					<ArrowDown size={14} />
					{t("chat.jumpToLatest")}
				</button>
			</div>
			<ConversationNavigator
				activeIndex={activeConversationIndex}
				anchors={conversationAnchors}
				onNavigate={jumpToConversation}
			/>
		</>
	);
}

function ProcessGroup({
	expanded,
	onExpandedChange,
	row,
}: {
	expanded: boolean;
	onExpandedChange: (expanded: boolean) => void;
	row: Extract<HistoryRow, { kind: "process" }>;
}) {
	return (
		<div className="ps-(--omp-editorial-inset) pe-(--omp-editorial-edge) py-2">
			<ExecutionGroup
				expanded={expanded}
				failureCount={row.failedEvents}
				onExpandedChange={onExpandedChange}
				stepCount={row.stepCount}
				toolCallIds={row.toolCallIds}
			>
				<div className="omp-process-group">
					{row.messages.map((message, index) => (
						<MessageBubble
							compact
							key={
								typeof message.id === "string"
									? message.id
									: `${String(message.timestamp ?? "process")}-${index}`
							}
							message={message}
							runningIndicator="dot"
						/>
					))}
				</div>
			</ExecutionGroup>
		</div>
	);
}

/**
 * The in-flight assistant turn: thinking block, any tool calls already
 * emitted, and the live text tail. Replaces itself with a finalized
 * MessageBubble on message_end.
 */
export function StreamingRows({
	expanded,
	onExpandedChange,
}: {
	expanded: boolean;
	onExpandedChange: (expanded: boolean) => void;
}) {
	const streamingMessage = useMessagesStore(s => s.streamingMessage);
	const streamingThinking = useMessagesStore(s => s.streamingThinking);
	const hasText = useMessagesStore(s => isRenderableMessageText(s.streamingText));
	// Full-map subscription is intentional here: this ONE live row legitimately
	// watches the whole active set (it renders every pending/running card).
	// Per-row isolation lives in ExecutionGroup/ToolCard.
	const activeTools = useToolsStore(s => s.activeTools);
	const transcriptDetail = useUiStore(s => s.transcriptDetail);
	if (!streamingMessage) return null;
	const content = Array.isArray(streamingMessage.content) ? streamingMessage.content : [];
	const toolCalls = content.filter(block => block.type === "toolCall");

	// streamingMessage.content only fills at message_end; mid-stream the live
	// tool calls accumulate in the tools store (toolcall_delta → pending while
	// args stream, tool_execution_start → running). Render those store entries
	// as live cards; on message_end this row unmounts and MessageBubble takes
	// over with the same toolCallIds. Entries from before this stream started
	// (hydrated history that never finished) are excluded by start time.
	const streamStart = messageTimestampMs(streamingMessage);
	const contentIds = new Set(toolCalls.map(block => toolEntryKey(block)));
	const liveTools: Array<{ id: string; entry: ToolEntry }> = [];
	for (const [id, entry] of activeTools) {
		if (contentIds.has(id)) continue;
		if (entry.status !== "pending" && entry.status !== "running") continue;
		if (entry.startTime < streamStart) continue;
		liveTools.push({ id, entry });
	}

	const hasThinking = isRenderableMessageText(streamingThinking);
	const hasProcess = hasThinking || toolCalls.length > 0 || liveTools.length > 0;
	const compactChrome = transcriptDetail === "compact" ? !hasText : !hasText && !hasThinking;
	const turnClass = compactChrome ? "omp-assistant-turn--compact" : "omp-assistant-turn";

	// Live read grouping (same predicate as the finalized path): consecutive
	// collapsible reads fold into one ReadGroupCard even mid-turn. Compact
	// detail keeps the same plain execution rows used by ProcessGroup.
	const allCards: Array<{ id: string; name: string; args: Record<string, unknown> }> = [
		...toolCalls.map(block => ({
			id: toolEntryKey(block),
			name: block.name,
			args: block.arguments as Record<string, unknown>,
		})),
		...liveTools.map(({ id, entry }) => ({ id, name: entry.toolName, args: entry.args as Record<string, unknown> })),
	];
	const groupedLiveCards = (() => {
		if (transcriptDetail === "compact") return null;
		const segments: Array<
			{ type: "group"; entries: ReadGroupEntry[] } | { type: "card"; card: (typeof allCards)[number] }
		> = [];
		let run: ReadGroupEntry[] = [];
		const flush = () => {
			if (run.length > 0) {
				segments.push({ type: "group", entries: run });
				run = [];
			}
		};
		for (const card of allCards) {
			const read = card.name === "read" ? collapsibleReadTarget(card.args) : null;
			if (read) {
				run.push({ callId: card.id, toolKey: card.id, ...read, args: card.args });
				continue;
			}
			flush();
			segments.push({ type: "card", card });
		}
		flush();
		// Keep the live shape identical to finalized `groupReadRows`: even one
		// collapsible read uses ReadGroupCard, preventing a card-type swap at
		// message_end.
		if (!segments.some(segment => segment.type === "group")) return null;
		return segments.map((segment, index) =>
			segment.type === "group" ? (
				<ReadGroupCard
					inset
					key={`rg-${segment.entries[0]?.callId ?? index}`}
					entries={segment.entries}
					runningIndicator="dot"
				/>
			) : (
				<ToolCard
					key={segment.card.id}
					toolCallId={segment.card.id}
					toolName={segment.card.name}
					args={segment.card.args}
					runningIndicator="dot"
				/>
			),
		);
	})();

	const toolCards = groupedLiveCards ?? (
		<>
			{toolCalls.map(block => (
				<ToolCard
					key={toolEntryKey(block)}
					toolCallId={toolEntryKey(block)}
					toolName={block.name}
					args={block.arguments}
					runningIndicator="dot"
				/>
			))}
			{liveTools.map(({ id, entry }) => (
				<ToolCard key={id} toolCallId={id} toolName={entry.toolName} args={entry.args} runningIndicator="dot" />
			))}
		</>
	);

	if (transcriptDetail === "full") {
		return (
			<div className={cx("omp-streaming-turn group flex px-6", turnClass)}>
				<div className="omp-transcript-content min-w-0">
					{/* streamingMessage.content only fills at message_end; mid-stream the
				    thinking deltas accumulate in the streamingThinking buffer, which
				    ThinkingBlock reads itself when live. */}
					{hasThinking ? <ThinkingBlock live /> : null}
					{toolCards}
					<StreamingText />
				</div>
			</div>
		);
	}

	return (
		<div className={cx("omp-streaming-turn group flex px-6", turnClass)}>
			<div className="omp-transcript-content min-w-0">
				{hasProcess ? (
					<ExecutionGroup
						expanded={expanded}
						live
						onExpandedChange={onExpandedChange}
						stepCount={toolCalls.length + liveTools.length + (hasThinking ? 1 : 0)}
						toolCallIds={allCards.map(card => card.id)}
					>
						<div className="omp-process-group omp-process-group--live">
							{hasThinking ? <ThinkingBlock live /> : null}
							{toolCalls.length + liveTools.length > 0 ? <div>{toolCards}</div> : null}
						</div>
					</ExecutionGroup>
				) : null}
				<div className={hasProcess ? "mt-1" : undefined}>
					<StreamingText />
				</div>
			</div>
		</div>
	);
}

/** Elapsed time stays hidden for answers that arrive promptly — a counter on every turn is noise. */
const ELAPSED_VISIBLE_SECONDS = 5;
/** Seconds past which the waiting row escalates to the slow-response hint. */
const SLOW_RESPONSE_HINT_SECONDS = 30;
/**
 * Seconds past which the row escalates again to the stalled-connection hint.
 * The provider first-event watchdog fires at ~300s (and auto-retry may
 * follow); telling the user that up front turns a silent 5-minute wait into
 * an informed one — they know it's still alive, why, and that Stop aborts now.
 */
const STALLED_RESPONSE_HINT_SECONDS = 90;

/**
 * Live status row for the windows where the agent is busy but the transcript
 * has nothing to show yet:
 *
 * - retry: a provider failure the agent is retrying — countdown, attempt,
 *   the failure (unless the failed reply above already shows it), and Stop.
 * - compaction: `{reason}{action}…` for auto-maintenance, same reason/action
 *   vocabulary as the TUI loader.
 * - manual maintenance: a `/compact` or handoff this window asked for — the
 *   agent sends no event for it — with its elapsed time and Stop.
 * - waiting: between turn_start and the first streamed event. Elapsed time
 *   appears only once the wait is noticeable; past 30s a slow-response hint,
 *   past 90s a stalled hint with Stop.
 */
export function TurnStatusRow() {
	const t = useT();
	const rpc = useTabRpc();
	const tabId = useRuntimeTabId();
	const retryInfo = useSessionStore(s => s.retryInfo);
	const compactionInfo = useSessionStore(s => s.compactionInfo);
	const manualMaintenance = useSessionStore(s => s.manualMaintenance);
	const awaitingModelSince = useSessionStore(s => s.awaitingModelSince);
	// The failed reply already in the transcript, so the retry row never prints its error twice.
	const shownError = useMessagesStore(s => {
		const last = s.liveMessages.at(-1) ?? s.messages.at(-1);
		return last?.role === "assistant" && typeof last.errorMessage === "string" ? last.errorMessage : null;
	});
	const now = Date.now();
	// 1s ticking clock shared by the countdown/elapsed variants.
	const [, setNowTick] = useState(0);
	useEffect(() => {
		const interval = setInterval(() => setNowTick(tick => tick + 1), 1000);
		return () => clearInterval(interval);
	}, []);
	const stop = () => void abortActiveTurn(rpc, tabId);

	if (retryInfo) {
		const remainingSeconds = Math.max(0, Math.ceil((retryInfo.startedAt + retryInfo.delayMs - now) / 1000));
		const when =
			remainingSeconds >= 60
				? t("chat.retry.scheduled", { time: formatClock(retryInfo.startedAt + retryInfo.delayMs) })
				: remainingSeconds > 0
					? t("chat.retry.pending", { seconds: remainingSeconds })
					: t("chat.retry.inflight");
		const detail = retryInfo.errorMessage && retryInfo.errorMessage !== shownError ? retryInfo.errorMessage : null;
		return (
			<div className="omp-status-turn ps-(--omp-editorial-inset) pe-(--omp-editorial-edge)">
				<span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
					{t("chat.retry.announcement", { attempt: retryInfo.attempt, maxAttempts: retryInfo.maxAttempts })}
				</span>
				<div className="omp-retry-card flex min-w-0 items-start gap-3 rounded-xl border px-3.5 py-2.5">
					<RotateCw aria-hidden size={14} className="mt-0.5 shrink-0 animate-spin text-[var(--omp-warning)]" />
					<div className="min-w-0 flex-1">
						<p className="text-omp-md text-[var(--omp-text)]">
							{when}
							<span className="ms-2 text-omp-sm tabular-nums text-[var(--omp-dim)]">
								{t("chat.retry.attempt", { attempt: retryInfo.attempt, maxAttempts: retryInfo.maxAttempts })}
							</span>
						</p>
						{detail && (
							<p className="mt-0.5 line-clamp-2 break-words text-omp-sm text-[var(--omp-muted)]" title={detail}>
								{describeProviderError(detail)}
							</p>
						)}
					</div>
					<button
						type="button"
						onClick={stop}
						className="omp-pressable -my-0.5 h-7 shrink-0 rounded-full px-2.5 text-omp-sm font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
					>
						{t("chat.retry.stop")}
					</button>
				</div>
			</div>
		);
	}

	if (!compactionInfo && manualMaintenance) {
		return (
			<div className="omp-status-turn ps-(--omp-editorial-inset) pe-(--omp-editorial-edge)">
				<LongTaskStatus
					card={{
						icon: manualMaintenance.kind === "compact" ? <Layers size={15} /> : <Handshake size={15} />,
						detail: t(`chat.maintenance.detail.${manualMaintenance.kind}`),
					}}
					label={t(`chat.maintenance.${manualMaintenance.kind}`)}
					onStop={stop}
					slowHint={t("chat.maintenance.slow")}
					startedAt={manualMaintenance.startedAt}
				/>
			</div>
		);
	}

	let label: string;
	let announcement: string;
	let elapsed: string | null = null;
	let hint: { text: string; tone: "dim" | "warning"; stop: boolean } | null = null;
	if (compactionInfo) {
		const reason = compactionInfo.reason === "threshold" ? "" : t(`chat.compaction.reason.${compactionInfo.reason}`);
		const actionKey =
			compactionInfo.action === "handoff"
				? "chat.compaction.action.handoff"
				: compactionInfo.action === "shake"
					? "chat.compaction.action.shake"
					: compactionInfo.action === "snapcompact"
						? "chat.compaction.action.snapcompact"
						: "chat.compaction.action.default";
		label = `${reason}${t(actionKey)}…`;
		announcement = label;
	} else if (awaitingModelSince != null) {
		const elapsedSeconds = Math.max(0, Math.floor((now - awaitingModelSince) / 1000));
		label = t("chat.awaitingModel");
		announcement = t("chat.awaitingModel.announcement");
		if (elapsedSeconds >= ELAPSED_VISIBLE_SECONDS) elapsed = t("time.secondsShort", { count: elapsedSeconds });
		if (elapsedSeconds >= STALLED_RESPONSE_HINT_SECONDS) {
			hint = { text: t("chat.awaitingModel.stalled"), tone: "warning", stop: true };
		} else if (elapsedSeconds >= SLOW_RESPONSE_HINT_SECONDS) {
			hint = { text: t("chat.awaitingModel.slow"), tone: "dim", stop: false };
		}
	} else {
		return null;
	}

	return (
		<div className="omp-status-turn flex flex-col gap-1 ps-(--omp-editorial-inset) pe-(--omp-editorial-edge)">
			<span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
				{announcement}
			</span>
			<div className="flex items-center gap-2.5 text-omp-md">
				<span aria-hidden className="omp-working-dot" />
				<span className="omp-shimmer-text">{label}</span>
				{elapsed && <span className="tabular-nums text-[var(--omp-dim)]">{elapsed}</span>}
			</div>
			{hint && (
				<div className="flex items-center gap-2 ps-[18px] text-omp-sm">
					<span className={hint.tone === "warning" ? "text-[var(--omp-warning)]" : "text-[var(--omp-dim)]"}>
						{hint.text}
					</span>
					{hint.stop && (
						<button
							type="button"
							onClick={stop}
							className="omp-pressable h-6 shrink-0 rounded-full px-2 font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
						>
							{t("chat.retry.stop")}
						</button>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * Closes a settled run that changed files: how many, by how much, and the way
 * to review them — the session's edits in the review drawer, the same edits
 * this line counted.
 */
function TurnChangesRow({ summary }: { summary: TurnChangeSummary }) {
	const t = useT();
	const openChanges = useUiStore(s => s.openChanges);
	return (
		<div className="ps-(--omp-editorial-inset) pe-(--omp-editorial-edge) pt-1 pb-4">
			<button
				type="button"
				onClick={() => openChanges("current")}
				className="omp-turn-changes omp-pressable group/changes flex h-9 max-w-full items-center gap-2.5 rounded-xl px-3 text-omp-sm"
			>
				<FileDiff aria-hidden size={14} className="shrink-0 text-[var(--omp-dim)]" />
				<span className="truncate font-medium text-[var(--omp-text)]">
					{t("chat.turnChanges.files", { count: summary.files, plural: summary.files === 1 ? "" : "s" })}
				</span>
				{summary.adds + summary.removes > 0 && <DiffStat adds={summary.adds} removes={summary.removes} />}
				<span className="ms-1 flex shrink-0 items-center gap-0.5 text-[var(--omp-muted)] group-hover/changes:text-[var(--omp-text)]">
					{t("chat.turnChanges.review")}
					<ChevronRight aria-hidden size={13} />
				</span>
			</button>
		</div>
	);
}

/**
 * Grey pending bubble for one queued steer/follow-up message (queue_update
 * data source), rendered at the message-stream tail in delivery order —
 * steering (mid-run interrupt) first, then follow-ups. The × deletes the
 * entry via queue_remove; the queue_update frame the removal emits confirms
 * success. Failed responses and rejected transport calls re-enable the action,
 * toast the error, and attempt an authoritative refresh.
 */
function QueuedMessageBubble({ item, lane }: { item: RpcQueuedMessage; lane: QueueLane }) {
	const t = useT();
	const rpc = useTabRpc();
	const refreshQueue = useQueueStore(state => state.refresh);
	const [removing, setRemoving] = useState(false);

	const remove = async () => {
		setRemoving(true);
		let failure: string | undefined;
		try {
			const response = await rpc.queueRemove(item.id);
			if (response.success) return;
			failure = response.error;
		} catch (cause) {
			failure = describeError(cause);
		}
		setRemoving(false);
		toast({ variant: "error", title: t("pendingBubble.removeFailed"), message: failure });
		await refreshQueue();
	};

	return (
		<div className="omp-queued-turn group flex justify-end ps-(--omp-editorial-inset) pe-(--omp-editorial-edge) py-1.5">
			<div className="omp-transcript-content omp-queued-bubble flex items-start gap-2 rounded-xl border border-dashed border-[var(--omp-border)] px-3.5 py-2.5">
				<div className="min-w-0 flex-1">
					<div className="mb-0.5 text-omp-xs font-semibold text-[var(--omp-dim)]">
						{t(lane === "steering" ? "pendingBubble.steering" : "pendingBubble.followUp")}
					</div>
					<div className="whitespace-pre-wrap break-words text-omp-lg leading-snug text-[var(--omp-muted)]">
						{item.text || "…"}
					</div>
				</div>
				<button
					type="button"
					onClick={() => void remove()}
					disabled={removing}
					title={t("pendingBubble.remove")}
					className="omp-pressable -mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--omp-dim)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-error)] disabled:opacity-50"
				>
					<X size={13} />
				</button>
			</div>
		</div>
	);
}

/**
 * Archived todo state rendered inline in the transcript where the change
 * happened (todo store history). Collapses to a one-line summary; expanding
 * shows the phase/task state at that time, read-only — the live dock card
 * above the composer carries the editable current list.
 */
function TodoSnapshotCard({ entry }: { entry: TodoSnapshot }) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const total = entry.phases.reduce((n, phase) => n + phase.tasks.length, 0);
	const done = entry.phases.reduce(
		(n, phase) => n + phase.tasks.filter(task => task.status === "completed").length,
		0,
	);
	const cleared = total === 0;

	return (
		<div className="ml-(--omp-editorial-inset) mr-(--omp-editorial-edge) my-1.5">
			<button
				aria-expanded={expanded}
				className="omp-pressable flex items-center gap-1.5 rounded-lg border border-[var(--omp-border-muted)] px-2.5 py-1 text-omp-sm text-[var(--omp-muted)] hover:text-[var(--omp-text)]"
				disabled={cleared}
				onClick={() => setExpanded(value => !value)}
				type="button"
			>
				<ChevronRight
					className="omp-disclosure-chevron shrink-0 text-[var(--omp-dim)]"
					size={11}
					style={{ transform: expanded ? "rotate(90deg)" : undefined }}
				/>
				<ListTodo className="shrink-0 text-[var(--omp-dim)]" size={12} />
				<span className="font-medium">{cleared ? t("todoSnapshot.cleared") : t("todoSnapshot.title")}</span>
				{!cleared && (
					<span className="tabular-nums text-[var(--omp-dim)]">{t("todoSnapshot.progress", { done, total })}</span>
				)}
			</button>
			{expanded && !cleared && (
				<div className="mt-1 ml-1 space-y-1 border-l border-[var(--omp-border-muted)] pl-3">
					{entry.phases.map((phase, phaseIndex) => (
						<div key={`${phase.name}-${phaseIndex}`}>
							{entry.phases.length > 1 && (
								<div className="py-0.5 text-omp-xs font-semibold text-[var(--omp-dim)]">{phase.name}</div>
							)}
							{phase.tasks.map((task, taskIndex) => (
								<div
									key={`${task.content}-${taskIndex}`}
									className="flex items-center gap-1.5 py-0.5 text-omp-sm"
								>
									<span
										aria-hidden
										className={cx(
											"h-1.5 w-1.5 shrink-0 rounded-full",
											task.status === "completed"
												? "bg-[var(--omp-success)]"
												: task.status === "in_progress"
													? "bg-[var(--omp-link)]"
													: task.status === "abandoned"
														? "bg-[var(--omp-error)]"
														: "bg-[var(--omp-border)]",
										)}
									/>
									<span
										className={cx(
											"min-w-0 flex-1 truncate",
											task.status === "completed" || task.status === "abandoned"
												? "text-[var(--omp-dim)] line-through"
												: "text-[var(--omp-muted)]",
										)}
										title={task.content}
									>
										{task.content}
									</span>
								</div>
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export type { HistoryRow, Row, TimelineMarkerSeed } from "./chat-stream-utils";
// Re-export transcript helpers for consumers/tests that import them from ChatStream.
export {
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
	locateEntryRow,
	mergeTodoSnapshots,
	ROW_ENTRANCE_TAIL_ROWS,
	shouldRePinTranscript,
	summarizeTurnChanges,
	tabAwaitsTranscript,
} from "./chat-stream-utils";
