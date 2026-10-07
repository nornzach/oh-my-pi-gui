export interface StableMarkdownBlock {
	/** Stable source-end offset; remains unchanged as later text arrives. */
	end: number;
	content: string;
}

export interface StreamingMarkdownSegments {
	blocks: StableMarkdownBlock[];
	tail: string;
	tailStart: number;
}

interface FenceState {
	marker: "`" | "~";
	length: number;
}

function openingFence(line: string): FenceState | null {
	const match = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
	const fence = match?.[1];
	if (!fence) return null;
	return { marker: fence[0] as "`" | "~", length: fence.length };
}

function closesFence(line: string, fence: FenceState): boolean {
	const candidate = line.replace(/^[ \t]{0,3}/, "");
	let length = 0;
	while (candidate[length] === fence.marker) length++;
	return length >= fence.length && candidate.slice(length).trim().length === 0;
}
const LIST_ITEM_RE = /^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])[ \t]/;
/** A lone, possibly-still-growing marker token ("-", "2", "2.") — a list
 * continuation candidate that must not yet end the block. */
const PARTIAL_MARKER_RE = /^(?:[-*+]|\d{1,9}[.)]?)$/;

/** Approximate visual columns of the line's leading whitespace (tab = 4). */
function leadingColumns(line: string): number {
	let columns = 0;
	for (const ch of line) {
		if (ch === " ") columns++;
		else if (ch === "\t") columns += 4 - (columns % 4);
		else break;
	}
	return columns;
}

/** Content column a list continuation must reach, or null when not a list. */
function listContentColumn(line: string): number | null {
	if (!LIST_ITEM_RE.test(line)) return null;
	const marker = line.trimStart().split(/[ \t]/, 1)[0] ?? "";
	return leadingColumns(line) + marker.length + 1;
}

/**
 * Split a growing Markdown stream into immutable blocks and one mutable tail.
 *
 * Blank lines are safe promotion points outside fenced code and display-math
 * blocks. A closed code/math fence is also promoted immediately. Stable blocks
 * can therefore be memoized and parsed exactly once while the unfinished tail
 * remains cheap plain text until its structure is complete.
 */
export function segmentStreamingMarkdown(text: string): StreamingMarkdownSegments {
	const blocks: StableMarkdownBlock[] = [];
	let blockStart = 0;
	let offset = 0;
	let fence: FenceState | null = null;
	let displayMath: "$$" | "\\]" | null = null;
	// Blank lines inside a list block are NOT stable boundaries: an indented
	// continuation or a further item still belongs to the same <li>, so
	// promotion defers until a line proves the list ended. Without this,
	// `1. first\n\n   second` rendered `second` outside the list live and
	// jumped at message_end.
	let listColumn: number | null = null;
	let sawFirstLine = false;
	let pendingBoundary: number | null = null;

	const promote = (end: number) => {
		const content = text.slice(blockStart, end);
		if (content.trim().length > 0) blocks.push({ end, content });
		blockStart = end;
		sawFirstLine = false;
		listColumn = null;
		pendingBoundary = null;
	};

	while (offset < text.length) {
		const newline = text.indexOf("\n", offset);
		const hasNewline = newline !== -1;
		const end = hasNewline ? newline + 1 : text.length;
		const line = text.slice(offset, hasNewline ? newline : text.length);
		const trimmed = line.trim();
		let closedFence = false;
		let closedMath = false;

		// A pending list boundary resolves against the FIRST following
		// non-blank line — even when that line opens a fence or math block,
		// which would otherwise swallow the boundary and strand a finished
		// list in the mutable tail for the whole fenced block. The check is
		// partial-line-safe: a bare "2" or "2." may still grow into an item,
		// so it counts as continuing instead of promoting (append-stable).
		if (pendingBoundary !== null && trimmed.length > 0) {
			const continuesList =
				LIST_ITEM_RE.test(line) || PARTIAL_MARKER_RE.test(trimmed) || leadingColumns(line) >= (listColumn ?? 0);
			if (!continuesList) promote(pendingBoundary);
			pendingBoundary = null;
		}

		if (fence) {
			if (closesFence(line, fence)) {
				fence = null;
				closedFence = true;
			}
		} else if (!displayMath) {
			fence = openingFence(line);
		}

		if (!fence && !closedFence) {
			if (displayMath === "$$" && trimmed === "$$") {
				displayMath = null;
				closedMath = true;
			} else if (!displayMath) {
				if (trimmed === "$$") displayMath = "$$";
				else if (trimmed.startsWith("\\[")) displayMath = "\\]";
			}
			// A bracket equation may start/end beside its body. A TeX row break
			// (`\\`) before `]` is content, not a closing delimiter.
			if (displayMath === "\\]" && /(?:^|[^\\])(?:\\\\)*\\\]$/.test(trimmed)) {
				displayMath = null;
				closedMath = true;
			}
		}

		if (hasNewline && !fence && !displayMath && (closedFence || (closedMath && listColumn === null))) {
			promote(end);
		} else if (!fence && !displayMath && !closedFence && !closedMath) {
			if (trimmed.length === 0) {
				if (hasNewline) {
					if (listColumn !== null) {
						if (pendingBoundary === null) pendingBoundary = end;
					} else {
						promote(end);
					}
				}
			} else if (hasNewline && !sawFirstLine) {
				// Classify list-ness only from complete lines — a partial first
				// line ("1.") would freeze a wrong non-list verdict.
				sawFirstLine = true;
				listColumn = listContentColumn(line);
			}
		}

		offset = end;
	}

	return {
		blocks,
		tail: text.slice(blockStart),
		tailStart: blockStart,
	};
}

export interface StreamingTailPresentation {
	/** Markdown that renders cleanly now: unfinished constructs are closed or held back. */
	markdown: string;
	/** An unfinished display-math block, shown as plain text until it closes. */
	plain: string;
}

const TABLE_ROW_RE = /^[ \t]{0,3}\|/;
const TABLE_DELIMITER_RE = /^[ \t]{0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
/**
 * A partial last line that would render as a different block than it becomes:
 * a bare heading marker, a list marker still waiting for text, or a run of
 * `-`/`=` that would briefly turn the paragraph above into a setext heading.
 */
const UNSETTLED_LINE_RE = /^[ \t]{0,3}(?:#{1,6}|[-*+]|\d{1,9}[.)]?|-+|=+|>)[ \t]*$/;

/** Collapse inline code spans to same-length filler so their content is never read as markup. */
function maskInlineCode(line: string): { masked: string; openTick: boolean } {
	let masked = "";
	let index = 0;
	while (index < line.length) {
		if (line[index] !== "`") {
			masked += line[index];
			index++;
			continue;
		}
		let run = 0;
		while (line[index + run] === "`") run++;
		const fence = "`".repeat(run);
		const close = line.indexOf(fence, index + run);
		if (close === -1) return { masked: masked + line.slice(index), openTick: true };
		masked += " ".repeat(close + run - index);
		index = close + run;
	}
	return { masked, openTick: false };
}

/** Offset where the inline context still being written begins: its paragraph or list item. */
function openInlineContextStart(body: string): number {
	const lines = body.split("\n");
	let line = lines.length - 1;
	while (line > 0 && !LIST_ITEM_RE.test(lines[line] ?? "") && (lines[line - 1] ?? "").trim() !== "") line--;
	let offset = 0;
	for (let index = 0; index < line; index++) offset += (lines[index]?.length ?? 0) + 1;
	return offset;
}

/**
 * Close emphasis and inline code that the model has opened but not yet closed,
 * so the live tail renders formatted instead of flashing raw `**`/`` ` ``
 * markers until the paragraph completes.
 */
function closeInlineMarkup(text: string): string {
	// A link or image whose target is still arriving shows only its text, and a
	// half-written HTML tag shows nothing.
	let out = text
		.replace(/!\[[^\]\n]*\](?:\([^)\n]*)?$/, "")
		.replace(/\[([^\]\n]*)\](?:\([^)\n]*)?$/, "$1")
		.replace(/\[([^\]\n]*)$/, "$1")
		.replace(/<\/?[A-Za-z][^>\n]*$/, "");
	// A marker with nothing after it yet would render literally.
	out = out.replace(/(?:^|(?<=\s))(?:\*{1,3}|~{1,2})$/, "");

	const trailing = /\s*$/.exec(out)?.[0] ?? "";
	let body = out.slice(0, out.length - trailing.length);
	const contextStart = openInlineContextStart(body);
	let scan = maskInlineCode(body.slice(contextStart));
	if (scan.openTick) {
		body += "`";
		scan = maskInlineCode(body.slice(contextStart));
	}
	const masked = scan.masked;

	let strong = -1;
	let strike = -1;
	let emphasis = -1;
	for (let index = 0; index < masked.length; index++) {
		const char = masked[index];
		const next = masked[index + 1] ?? "";
		if (char === "~" && next === "~") {
			strike = strike === -1 ? index : -1;
			index++;
		} else if (char === "*" && next === "*") {
			strong = strong === -1 ? index : -1;
			index++;
		} else if (char === "*") {
			const lineHead = masked.slice(masked.lastIndexOf("\n", index - 1) + 1, index);
			if (next === " " && lineHead.trim() === "") continue; // list bullet
			const previous = masked[index - 1] ?? "";
			if (emphasis === -1) {
				if (next && !/\s/.test(next)) emphasis = index;
			} else if (previous && !/\s/.test(previous)) {
				emphasis = -1;
			}
		}
	}
	const opens = [
		{ at: strong, marker: "**" },
		{ at: strike, marker: "~~" },
		{ at: emphasis, marker: "*" },
	]
		.filter(open => open.at !== -1)
		.sort((left, right) => right.at - left.at);
	return `${body}${opens.map(open => open.marker).join("")}${trailing}`;
}

/**
 * Prepare the unfinished tail of a streaming reply for formatted display.
 *
 * The tail is rendered as Markdown every frame, so it must never contain a
 * construct that renders differently once more text arrives: open code fences
 * are closed (the block grows in place instead of appearing at the end), a table
 * waits for its delimiter row, half-written markers are closed or held back, and
 * unfinished display math stays plain text so KaTeX never typesets half a formula.
 */
export function presentStreamingTail(tail: string): StreamingTailPresentation {
	if (!tail) return { markdown: "", plain: "" };
	const lines = tail.split("\n");
	let fence: FenceState | null = null;
	let sawFence = false;
	let mathStart = -1;
	let displayMath: "$$" | "\\]" | null = null;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const trimmed = line.trim();
		if (fence) {
			if (closesFence(line, fence)) fence = null;
			continue;
		}
		if (!displayMath) {
			const opened = openingFence(line);
			if (opened) {
				fence = opened;
				sawFence = true;
				continue;
			}
			if (trimmed === "$$") {
				displayMath = "$$";
				mathStart = index;
			} else if (trimmed.startsWith("\\[")) {
				displayMath = "\\]";
				mathStart = index;
			}
			if (displayMath === "\\]" && /(?:^|[^\\])(?:\\\\)*\\\]$/.test(trimmed)) displayMath = null;
		} else if (
			(displayMath === "$$" && trimmed === "$$") ||
			(displayMath === "\\]" && /(?:^|[^\\])(?:\\\\)*\\\]$/.test(trimmed))
		) {
			displayMath = null;
		}
	}

	if (fence) {
		const separator = tail.endsWith("\n") ? "" : "\n";
		return { markdown: `${tail}${separator}${fence.marker.repeat(fence.length)}`, plain: "" };
	}
	if (displayMath) {
		return { markdown: lines.slice(0, mathStart).join("\n"), plain: lines.slice(mathStart).join("\n") };
	}

	let end = lines.length;
	const lastLine = lines[end - 1] ?? "";
	if (UNSETTLED_LINE_RE.test(lastLine)) end--;
	// A table renders only once its delimiter row is complete; until then its
	// rows would show as a paragraph of pipes.
	let tableStart = end;
	while (tableStart > 0 && TABLE_ROW_RE.test(lines[tableStart - 1] ?? "")) tableStart--;
	if (tableStart < end) {
		const delimiter = tableStart + 1;
		const delimiterComplete = delimiter < lines.length - 1 && TABLE_DELIMITER_RE.test(lines[delimiter] ?? "");
		if (!delimiterComplete) end = tableStart;
	}
	const kept = lines.slice(0, end).join("\n");
	if (sawFence) return { markdown: kept, plain: "" };
	return { markdown: closeInlineMarkup(kept), plain: "" };
}
