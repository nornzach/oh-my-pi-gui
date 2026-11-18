import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { STREAM_FORMAT_FLUSH_MS, useThrottledText } from "../../hooks/use-throttled-text";
import { MarkdownRenderer } from "../../lib/markdown";
import { presentStreamingTail, segmentStreamingMarkdown } from "../../lib/streaming-markdown";
import { useMessagesStore } from "../../stores/messages";

/** Past this many tail characters, re-parsing every frame costs more than the cadence buys. */
const LARGE_TAIL_CHARS = 8_000;
const LARGE_TAIL_FLUSH_MS = 120;

/** Deepest last element that still carries text — where the next character will appear. */
function lastTextElement(root: Element): Element | null {
	let node: Element | null = root;
	while (node) {
		let next: Element | null = null;
		for (let child: Element | null = node.lastElementChild; child; child = child.previousElementSibling) {
			if (child.textContent?.trim()) {
				next = child;
				break;
			}
		}
		if (!next) return node === root ? null : node;
		node = next;
	}
	return null;
}

/**
 * Shared presentation for streaming replies and reasoning. Finished Markdown
 * blocks are reused while unfinished syntax in the growing tail is closed or
 * held back. Reasoning supplies text that was throttled before formatting.
 */
export const StreamingMarkdown = memo(function StreamingMarkdown({
	content,
	throttle = true,
}: {
	content: string;
	throttle?: boolean;
}) {
	const tailLength = useRef(0);
	const interval = tailLength.current > LARGE_TAIL_CHARS ? LARGE_TAIL_FLUSH_MS : STREAM_FORMAT_FLUSH_MS;
	const throttled = useThrottledText(content, throttle ? interval : 0);
	const text = throttle ? throttled : content;
	const segments = useMemo(() => segmentStreamingMarkdown(text), [text]);
	const tail = useMemo(() => presentStreamingTail(segments.tail), [segments.tail]);
	const rootRef = useRef<HTMLDivElement>(null);

	// The caret rides the end of the last rendered line, inside whatever block
	// (paragraph, list item, table cell, code) is growing.
	useLayoutEffect(() => {
		tailLength.current = segments.tail.length;
		const root = rootRef.current;
		if (!root) return;
		const target = lastTextElement(root);
		for (const marked of root.querySelectorAll("[data-omp-caret]")) {
			if (marked !== target) marked.removeAttribute("data-omp-caret");
		}
		target?.setAttribute("data-omp-caret", "");
	});

	if (!content) return null;

	return (
		<div className="omp-streaming" ref={rootRef}>
			{segments.blocks.map(block => (
				<div className="omp-streaming-block" key={block.end}>
					<MarkdownRenderer content={block.content} />
				</div>
			))}
			<div className="omp-streaming-tail">
				{tail.markdown && <MarkdownRenderer content={tail.markdown} streaming />}
				{tail.plain && <div className="omp-streaming-plain">{tail.plain}</div>}
			</div>
		</div>
	);
});

export function StreamingText() {
	const content = useMessagesStore(s => s.streamingText);
	return <StreamingMarkdown content={content} />;
}
