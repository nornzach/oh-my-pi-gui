import { diffWords } from "diff";
import type { HLJSApi } from "highlight.js";
import { Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { copyText, cx, languageFromPath } from "./format";
import { getLoadedHljs, loadHljs } from "./highlight";
import { useT } from "./i18n";

export interface DiffLine {
	type: "add" | "remove" | "context";
	content: string;
	/** Old-file line number (remove/context rows), when known. */
	oldLine?: number;
	/** New-file line number (add/context rows), when known. */
	newLine?: number;
}

/** A parsed diff row: a code line, or a gap marker between non-contiguous regions. */
interface DiffRow {
	type: DiffLine["type"] | "gap";
	content: string;
	oldLine?: number;
	newLine?: number;
}

const HUNK_HEADER_RE = /^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/;
const NUMBERED_ROW_RE = /^([+\- ])(\d+)\|(.*)$/s;

/**
 * Parse a diff into rows with old/new line numbers and gap markers.
 * Handles the canonical numbered wire format (`-N|content` with `@@` hunk
 * headers and blank gap rows) and plain unified diffs (numbers derived from
 * hunk headers). Rows without either stay unnumbered.
 */
function parseDiffRows(text: string): DiffRow[] {
	const lines = text.split("\n");
	// The producer numbers every row when it numbers any; a plain unified diff
	// never contains the `N|` pipe form, so one hit settles the whole block.
	const numbered = lines.some(line => NUMBERED_ROW_RE.test(line));
	const rows: DiffRow[] = [];
	let oldCursor: number | undefined;
	let newCursor: number | undefined;
	// Unified file headers (`+++ b/x`) exist only before their file's first
	// hunk. Once hunk content begins, `--- disabled` (removed SQL comment) and
	// `+++i` (added C increment) are source lines, not headers.
	let sawHunk = false;

	const pushGap = () => {
		if (rows.length > 0 && rows[rows.length - 1]!.type !== "gap") {
			rows.push({ type: "gap", content: "" });
		}
	};

	for (const raw of lines) {
		const hunk = HUNK_HEADER_RE.exec(raw);
		if (hunk) {
			sawHunk = true;
			oldCursor = Number(hunk[1]);
			newCursor = Number(hunk[2]);
			pushGap();
			continue;
		}
		if (/^diff --git /.test(raw) || /^Index: /.test(raw)) {
			sawHunk = false;
			continue;
		}
		if (!sawHunk && /^(---|\+\+\+) \S/.test(raw)) continue;
		if (raw.length === 0) {
			// Blank rows are gap markers in the numbered wire format; in plain
			// diffs they only appear as a trailing split artifact.
			if (numbered) pushGap();
			continue;
		}
		const numberedRow = numbered ? NUMBERED_ROW_RE.exec(raw) : null;
		if (numberedRow) {
			const prefix = numberedRow[1]!;
			const lineNumber = Number(numberedRow[2]);
			const content = numberedRow[3] ?? "";
			if (prefix === "-") {
				rows.push({ type: "remove", content, oldLine: lineNumber });
				oldCursor = lineNumber + 1;
			} else if (prefix === "+") {
				rows.push({ type: "add", content, newLine: lineNumber });
				newCursor = lineNumber + 1;
			} else {
				// Context rows are numbered in old-file coordinates; shift by the
				// net change so far to recover the new-file number.
				const newLine =
					oldCursor !== undefined && newCursor !== undefined ? lineNumber + (newCursor - oldCursor) : undefined;
				rows.push({ type: "context", content, oldLine: lineNumber, newLine });
				oldCursor = lineNumber + 1;
				if (newLine !== undefined) newCursor = newLine + 1;
			}
			continue;
		}
		const marker = raw[0]!;
		if (marker === "+" || marker === "-" || marker === " ") {
			const type = marker === "+" ? "add" : marker === "-" ? "remove" : "context";
			rows.push({
				type,
				content: raw.slice(1),
				oldLine: type !== "add" ? oldCursor : undefined,
				newLine: type !== "remove" ? newCursor : undefined,
			});
			if (type !== "add" && oldCursor !== undefined) oldCursor += 1;
			if (type !== "remove" && newCursor !== undefined) newCursor += 1;
			continue;
		}
		rows.push({ type: "context", content: raw });
	}
	while (rows.length > 0 && rows[rows.length - 1]!.type === "gap") rows.pop();
	return rows;
}

/**
 * Parses a unified diff string into structured lines. Gap rows and hunk
 * headers are folded away; numbered wire rows are stripped to clean content.
 */
export function parseDiff(text: string): DiffLine[] {
	const lines: DiffLine[] = [];
	for (const row of parseDiffRows(text)) {
		if (row.type === "gap") continue;
		lines.push({ type: row.type, content: row.content, oldLine: row.oldLine, newLine: row.newLine });
	}
	return lines;
}

interface IntraSegment {
	text: string;
	changed: boolean;
}

const INTRA_LINE_CHAR_CAP = 2000;

/**
 * Word-level segments for a paired remove+add line. diffWords groups
 * whitespace with adjacent words; leading indentation stays unhighlighted
 * (matching the TUI) so inverse emphasis lands on real changes only.
 */
function intraLineSegments(oldText: string, newText: string): { removed: IntraSegment[]; added: IntraSegment[] } {
	const removed: IntraSegment[] = [];
	const added: IntraSegment[] = [];
	let isFirstRemoved = true;
	let isFirstAdded = true;
	for (const part of diffWords(oldText, newText)) {
		if (part.removed) {
			let value = part.value;
			if (isFirstRemoved) {
				const leading = /^\s*/.exec(value)?.[0] ?? "";
				if (leading) {
					removed.push({ text: leading, changed: false });
					value = value.slice(leading.length);
				}
				isFirstRemoved = false;
			}
			if (value) removed.push({ text: value, changed: true });
		} else if (part.added) {
			let value = part.value;
			if (isFirstAdded) {
				const leading = /^\s*/.exec(value)?.[0] ?? "";
				if (leading) {
					added.push({ text: leading, changed: false });
					value = value.slice(leading.length);
				}
				isFirstAdded = false;
			}
			if (value) added.push({ text: value, changed: true });
		} else {
			removed.push({ text: part.value, changed: false });
			added.push({ text: part.value, changed: false });
		}
	}
	return { removed, added };
}

/**
 * Attach word-level segments to single-line replacements (one remove row
 * directly followed by one add row). Keyed by row index.
 */
function computeIntraLine(rows: DiffRow[]): Map<number, IntraSegment[]> {
	const segments = new Map<number, IntraSegment[]>();
	let i = 0;
	while (i < rows.length) {
		if (rows[i]!.type !== "remove") {
			i += 1;
			continue;
		}
		let removeEnd = i;
		while (removeEnd < rows.length && rows[removeEnd]!.type === "remove") removeEnd += 1;
		let addEnd = removeEnd;
		while (addEnd < rows.length && rows[addEnd]!.type === "add") addEnd += 1;
		if (removeEnd - i === 1 && addEnd - removeEnd === 1) {
			const oldText = rows[i]!.content;
			const newText = rows[removeEnd]!.content;
			if (oldText.length <= INTRA_LINE_CHAR_CAP && newText.length <= INTRA_LINE_CHAR_CAP) {
				const pair = intraLineSegments(oldText, newText);
				segments.set(i, pair.removed);
				segments.set(removeEnd, pair.added);
			}
		}
		i = addEnd;
	}
	return segments;
}

const TAB_WIDTH = 4;
// Arrow centered in a tab stop: 2 spaces + → + 1 space at the default width 4.
const TAB_MARKER = `${" ".repeat(Math.floor(TAB_WIDTH / 2))}→${" ".repeat(Math.max(0, TAB_WIDTH - Math.floor(TAB_WIDTH / 2) - 1))}`;

/** Dim glyphs visualizing leading whitespace: · per space, padded → per tab. */
function indentGlyphs(content: string): { glyphs: string; width: number } {
	const indent = /^[ \t]+/.exec(content)?.[0] ?? "";
	let glyphs = "";
	for (const ch of indent) glyphs += ch === "\t" ? TAB_MARKER : "·";
	return { glyphs, width: indent.length };
}

const HIGHLIGHT_CHAR_CAP = 20_000;

interface HighlightToken {
	className: string | null;
	text: string;
}

const HIGHLIGHT_ENTITY_RE = /&(amp|lt|gt|quot|#x27);/g;
const HIGHLIGHT_ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	"#x27": "'",
};

function decodeHighlightedText(text: string): string {
	return text.replace(HIGHLIGHT_ENTITY_RE, entity => HIGHLIGHT_ENTITIES[entity.slice(1, -1)] ?? entity);
}

/**
 * Split flat-span hljs HTML into per-line React tokens. hljs output never
 * nests spans and escapes every text node, so decoding its five fixed
 * entities here preserves the original source without injecting HTML.
 */
function splitHighlightedLines(html: string): HighlightToken[][] {
	const lines: HighlightToken[][] = [[]];
	let openClass: string | null = null;
	const tokenRe = /<span class="([^"]*)">|<\/span>|[^<]+/g;
	const pushText = (raw: string): void => {
		if (raw.length === 0) return;
		const text = decodeHighlightedText(raw);
		const line = lines[lines.length - 1]!;
		const previous = line[line.length - 1];
		if (previous?.className === openClass) {
			previous.text += text;
		} else {
			line.push({ className: openClass, text });
		}
	};

	let match = tokenRe.exec(html);
	while (match !== null) {
		const [token, spanClass] = match;
		if (spanClass !== undefined) {
			openClass = spanClass;
		} else if (token === "</span>") {
			openClass = null;
		} else {
			const parts = token.split("\n");
			for (let i = 0; i < parts.length; i++) {
				if (i > 0) lines.push([]);
				pushText(parts[i]!);
			}
		}
		match = tokenRe.exec(html);
	}
	return lines;
}

/**
 * Batch-highlight runs of consecutive context rows so multi-line constructs
 * (block comments, template strings) tokenize correctly. Row index → tokens.
 */
function highlightContextRows(rows: DiffRow[], hljs: HLJSApi, lang: string): Map<number, HighlightToken[]> {
	const map = new Map<number, HighlightToken[]>();
	if (!hljs.getLanguage(lang)) return map;
	let runIndices: number[] = [];
	let runContents: string[] = [];
	const flush = () => {
		if (runContents.length === 0) return;
		const joined = runContents.join("\n");
		if (joined.length <= HIGHLIGHT_CHAR_CAP) {
			try {
				const perLine = splitHighlightedLines(hljs.highlight(joined, { language: lang }).value);
				for (let k = 0; k < runIndices.length; k++) {
					const html = perLine[k];
					if (html !== undefined) map.set(runIndices[k]!, html);
				}
			} catch {
				// Grammar edge — fall back to plain context rendering.
			}
		}
		runIndices = [];
		runContents = [];
	};
	for (let j = 0; j < rows.length; j++) {
		const row = rows[j]!;
		// Legacy collapse markers render as context but are not code;
		// highlighting them produces nonsense and stitches unrelated runs.
		const isCollapseMarker = row.content === "..." || row.content === "…";
		if (row.type === "context" && !isCollapseMarker) {
			runIndices.push(j);
			runContents.push(row.content);
		} else {
			flush();
		}
	}
	flush();
	return map;
}

interface ViewRow {
	type: DiffRow["type"];
	content: string;
	displayOld: string;
	displayNew: string;
}

/** Per-row gutter text, blanking a number that repeats the row above (paired `-N`/`+N`). */
function buildViewRows(rows: DiffRow[], count: number): ViewRow[] {
	const view: ViewRow[] = [];
	let prevOld: number | undefined;
	let prevNew: number | undefined;
	for (let i = 0; i < count; i++) {
		const row = rows[i]!;
		if (row.type === "gap") {
			prevOld = undefined;
			prevNew = undefined;
			view.push({ type: "gap", content: "", displayOld: "", displayNew: "" });
			continue;
		}
		const displayOld = row.oldLine !== undefined && row.oldLine !== prevOld ? String(row.oldLine) : "";
		const displayNew = row.newLine !== undefined && row.newLine !== prevNew ? String(row.newLine) : "";
		if (row.oldLine !== undefined) prevOld = row.oldLine;
		if (row.newLine !== undefined) prevNew = row.newLine;
		view.push({ type: row.type, content: row.content, displayOld, displayNew });
	}
	return view;
}

/**
 * Rows painted before the diff asks permission to keep going. Every row is a
 * real DOM element with several spans plus a possible hljs pass, so rendering
 * the whole budget at once is what made a large patch freeze the UI on expand.
 */
const INITIAL_RENDER_ROWS = 150;
/** Rows a single "show more" click reveals. */
const MORE_RENDER_ROWS = 600;
/** Absolute ceiling; past it the remainder is reported, never rendered. */
const MAX_RENDER_ROWS = 3000;

const LINE_STYLES: Record<DiffLine["type"], string> = {
	add: "text-[var(--omp-diff-added)] bg-[color-mix(in_srgb,var(--omp-diff-added)_10%,transparent)]",
	remove: "text-[var(--omp-diff-removed)] bg-[color-mix(in_srgb,var(--omp-diff-removed)_10%,transparent)]",
	context: "text-[var(--omp-diff-context)]",
};

const LINE_PREFIXES: Record<DiffLine["type"], string> = {
	add: "+",
	remove: "-",
	context: " ",
};

const INTRA_STYLES: Record<"add" | "remove", string> = {
	add: "rounded-[2px] bg-[color-mix(in_srgb,var(--omp-diff-added)_30%,transparent)]",
	remove: "rounded-[2px] bg-[color-mix(in_srgb,var(--omp-diff-removed)_30%,transparent)]",
};

interface DiffViewProps {
	diff: string;
	/** Path of the edited file — infers the context-line highlight language. */
	filePath?: string;
	className?: string;
}

/**
 * Renders a unified diff at TUI parity: old/new line-number gutter, word-level
 * intra-line highlight on single-line replacements, leading-whitespace
 * visualization, syntax-highlighted context lines, and gap ellipsis rows.
 */
export function DiffView({ diff, filePath, className }: DiffViewProps) {
	const t = useT();
	const allRows = useMemo(() => parseDiffRows(diff), [diff]);
	/**
	 * Rows the current budget allows to be painted. A large patch is read from
	 * its top, so the tail stays behind a "show more" row instead of becoming
	 * three thousand DOM nodes on first expand.
	 */
	const [rowBudget, setRowBudget] = useState(INITIAL_RENDER_ROWS);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new `diff` is a new patch (the panel's file selector, a re-keyed tool card), so its first paint must be cheap again — the effect body deliberately only resets state.
	useEffect(() => setRowBudget(INITIAL_RENDER_ROWS), [diff]);
	const rendered = Math.min(rowBudget, allRows.length, MAX_RENDER_ROWS);
	const rows = useMemo(() => allRows.slice(0, rendered), [allRows, rendered]);
	const intra = useMemo(() => computeIntraLine(rows), [rows]);
	const lang = languageFromPath(filePath);

	const [copied, setCopied] = useState(false);
	const handleCopy = () => {
		void copyText(diff).then(ok => {
			if (!ok) return;
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1400);
		});
	};

	const [hljs, setHljs] = useState(getLoadedHljs);
	useEffect(() => {
		if (hljs || lang === "plaintext") return;
		let cancelled = false;
		void loadHljs().then(loaded => {
			if (!cancelled) setHljs(loaded);
		});
		return () => {
			cancelled = true;
		};
	}, [hljs, lang]);

	const highlights = useMemo(
		() => (hljs && lang !== "plaintext" ? highlightContextRows(rows, hljs, lang) : null),
		[rows, hljs, lang],
	);

	/** Rows the budget still hides, and the part of them one click reveals. */
	const hiddenRows = allRows.length - rendered;
	const revealRows = Math.min(hiddenRows, MORE_RENDER_ROWS);
	/** Rows no budget paints — an ellipsis row reports them instead. */
	const unreachableRows = Math.max(0, allRows.length - MAX_RENDER_ROWS);
	const viewRows = useMemo(() => buildViewRows(rows, rows.length), [rows]);
	const gutterWidth = useMemo(() => {
		let width = 0;
		for (const row of rows) {
			if (row.oldLine !== undefined) width = Math.max(width, String(row.oldLine).length);
			if (row.newLine !== undefined) width = Math.max(width, String(row.newLine).length);
		}
		return width;
	}, [rows]);

	const renderContent = (index: number, row: ViewRow): ReactNode => {
		const tokens = highlights?.get(index);
		if (tokens !== undefined) {
			return (
				<span>
					{tokens.map((token, tokenIndex) =>
						token.className === null ? (
							token.text
						) : (
							<span key={tokenIndex} className={token.className}>
								{token.text}
							</span>
						),
					)}
				</span>
			);
		}
		const { glyphs, width: indentWidth } = indentGlyphs(row.content);
		const segments = intra.get(index) ?? [{ text: row.content, changed: false }];
		let offset = 0;
		return (
			<span>
				{glyphs && (
					<span aria-hidden className="select-none opacity-40">
						{glyphs}
					</span>
				)}
				{segments.map(segment => {
					const start = offset;
					offset += segment.text.length;
					const text = start < indentWidth ? segment.text.slice(indentWidth - start) : segment.text;
					if (!text) return null;
					return segment.changed && (row.type === "add" || row.type === "remove") ? (
						<span key={start} className={INTRA_STYLES[row.type]}>
							{text}
						</span>
					) : (
						<span key={start}>{text}</span>
					);
				})}
			</span>
		);
	};

	return (
		// The copy affordance hangs off this box, not the scroller below, so it
		// stays put while the patch scrolls.
		<div className="group/diff relative">
			<button
				aria-label={t("diff.copy")}
				className="absolute top-0 right-0 z-10 flex h-5 w-5 items-center justify-center rounded-md text-[var(--omp-dim)] opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)] focus:opacity-100 group-hover/diff:opacity-100"
				onClick={handleCopy}
				title={t(copied ? "diff.copied" : "diff.copy")}
				type="button"
			>
				{copied ? <Check size={12} className="text-[var(--omp-success)]" /> : <Copy size={12} />}
			</button>
			<div className={cx("font-mono text-xs leading-[1.4] overflow-x-auto [tab-size:4]", className)}>
				{viewRows.map((row, i) => {
					if (row.type === "gap") {
						return (
							<div key={i} className="whitespace-pre px-2 text-[var(--omp-diff-context)]">
								{gutterWidth > 0 && (
									<>
										<span
											aria-hidden
											className="mr-1 inline-block select-none"
											style={{ width: `${gutterWidth}ch` }}
										/>
										<span
											aria-hidden
											className="mr-2 inline-block select-none"
											style={{ width: `${gutterWidth}ch` }}
										/>
									</>
								)}
								<span aria-hidden className="mr-2 select-none opacity-50">
									{" "}
								</span>
								<span className="opacity-50">…</span>
							</div>
						);
					}
					return (
						<div key={i} className={cx("whitespace-pre px-2", LINE_STYLES[row.type])}>
							{gutterWidth > 0 && (
								<>
									<span
										aria-hidden
										className="mr-1 inline-block select-none text-right opacity-50"
										style={{ width: `${gutterWidth}ch` }}
									>
										{row.displayOld}
									</span>
									<span
										aria-hidden
										className="mr-2 inline-block select-none text-right opacity-50"
										style={{ width: `${gutterWidth}ch` }}
									>
										{row.displayNew}
									</span>
								</>
							)}
							<span aria-hidden className="mr-2 select-none opacity-50">
								{LINE_PREFIXES[row.type]}
							</span>
							{renderContent(i, row)}
						</div>
					);
				})}
				{hiddenRows > unreachableRows ? (
					<button
						className="w-full px-2 py-1 text-left text-[var(--omp-dim)] underline-offset-2 hover:underline"
						onClick={() => setRowBudget(budget => budget + MORE_RENDER_ROWS)}
						type="button"
					>
						{t("diff.showMore", { count: revealRows })}
					</button>
				) : unreachableRows > 0 ? (
					<div className="whitespace-pre px-2 text-[var(--omp-diff-context)]">
						<span className="opacity-50">{t("diff.moreLines", { count: unreachableRows })}</span>
					</div>
				) : null}
			</div>
		</div>
	);
}
