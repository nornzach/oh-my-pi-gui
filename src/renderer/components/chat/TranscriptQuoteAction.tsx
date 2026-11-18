/**
 * The "Quote" action that appears over a text selection in the transcript
 * (#54). Selecting part of one message offers to insert that excerpt into the
 * composer as a Markdown blockquote at the caret.
 */

import { Quote } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../lib/i18n";
import { quotableContainer, rangeQuoteText, toBlockquote } from "../../lib/quote-selection";

interface Anchor {
	/** Viewport point the action is centered above. */
	x: number;
	y: number;
	/** Shown below the selection when there is no room above it. */
	below: boolean;
}

/** Room the action needs above the selection before it flips below it. */
const FLIP_MARGIN = 44;

export function TranscriptQuoteAction({
	transcriptRef,
	tabId,
}: {
	transcriptRef: RefObject<HTMLElement | null>;
	tabId: string | null | undefined;
}) {
	const t = useT();
	const [anchor, setAnchor] = useState<Anchor | null>(null);
	const pointerDown = useRef(false);
	const pending = useRef<number | null>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const shown = useRef(false);
	shown.current = anchor !== null;

	useEffect(() => {
		const measure = () => {
			pending.current = null;
			const transcript = transcriptRef.current;
			const selection = document.getSelection();
			if (!transcript || pointerDown.current || !quotableContainer(selection, transcript) || !selection) {
				setAnchor(null);
				return;
			}
			const bounds = transcript.getBoundingClientRect();
			const rects = [...selection.getRangeAt(0).getClientRects()].filter(
				rect => rect.width > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom,
			);
			const first = rects[0];
			const last = rects[rects.length - 1];
			if (!first || !last) {
				setAnchor(null);
				return;
			}
			// Flip below when the space above the selection inside the transcript runs
			// out, so the action never covers the tab bar or title bar.
			const below = first.top < bounds.top + FLIP_MARGIN;
			setAnchor(
				below
					? { x: last.left + last.width / 2, y: last.bottom, below: true }
					: { x: first.left + first.width / 2, y: first.top, below: false },
			);
		};
		const schedule = () => {
			if (pending.current !== null) cancelAnimationFrame(pending.current);
			pending.current = requestAnimationFrame(measure);
		};
		// The action waits for the drag to finish: it never chases the pointer mid-selection.
		const onPointerDown = (event: PointerEvent) => {
			if ((event.target as Element | null)?.closest?.("[data-quote-action]")) return;
			pointerDown.current = true;
			setAnchor(null);
		};
		const onPointerUp = () => {
			pointerDown.current = false;
			schedule();
		};
		const hide = () => setAnchor(null);
		const reposition = () => {
			if (shown.current) schedule();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				// Leaving the action hands focus back to the transcript it came from.
				if (document.activeElement === buttonRef.current) transcriptRef.current?.focus();
				hide();
			}
			// A keyboard selection reaches the action with Tab; focusing a button keeps
			// the selection, and Enter then quotes it.
			if (
				event.key === "Tab" &&
				!event.shiftKey &&
				shown.current &&
				transcriptRef.current?.contains(document.activeElement)
			) {
				event.preventDefault();
				buttonRef.current?.focus();
			}
		};
		document.addEventListener("selectionchange", schedule);
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("pointerup", onPointerUp, true);
		document.addEventListener("pointercancel", onPointerUp, true);
		document.addEventListener("keydown", onKeyDown);
		// Layout and auto-follow can move a selection that is still visible.
		const transcript = transcriptRef.current;
		transcript?.addEventListener("scroll", reposition, { passive: true });
		window.addEventListener("resize", reposition);
		return () => {
			if (pending.current !== null) cancelAnimationFrame(pending.current);
			document.removeEventListener("selectionchange", schedule);
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("pointerup", onPointerUp, true);
			document.removeEventListener("pointercancel", onPointerUp, true);
			document.removeEventListener("keydown", onKeyDown);
			transcript?.removeEventListener("scroll", reposition);
			window.removeEventListener("resize", reposition);
		};
	}, [transcriptRef]);

	const quote = () => {
		const transcript = transcriptRef.current;
		const selection = document.getSelection();
		if (!transcript || !selection || !quotableContainer(selection, transcript)) return;
		const text = toBlockquote(rangeQuoteText(selection.getRangeAt(0)));
		setAnchor(null);
		if (!text) return;
		selection.removeAllRanges();
		window.dispatchEvent(
			new CustomEvent("omp:quote-composer", { detail: { quote: text, tabId: tabId ?? undefined } }),
		);
	};

	if (!anchor) return null;
	return createPortal(
		<button
			type="button"
			data-quote-action
			ref={buttonRef}
			className="omp-quote-action omp-pop-in fixed z-[90] flex h-7 items-center gap-1.5 rounded-lg border border-(--omp-border) bg-(--omp-bg-elevated) px-2.5 text-omp-xs font-medium text-(--omp-text) shadow-(--omp-shadow-md) hover:bg-(--omp-selected-bg)"
			onClick={quote}
			// Keep the selection: a mousedown on a button would otherwise collapse it first.
			onMouseDown={event => event.preventDefault()}
			style={{
				left: anchor.x,
				top: anchor.y,
				// `translate`, not `transform`: the pop-in keyframes animate `transform`
				// and would otherwise drop the action onto the selected text.
				translate: anchor.below ? "-50% 8px" : "-50% calc(-100% - 8px)",
			}}
		>
			<Quote aria-hidden="true" size={12} />
			{t("chat.quoteSelection")}
		</button>,
		document.body,
	);
}
