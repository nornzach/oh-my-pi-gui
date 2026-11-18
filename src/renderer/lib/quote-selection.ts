/**
 * Quoting a transcript selection into the composer (#54).
 *
 * A quote is plain Markdown from the start: the excerpt becomes `> ` lines in
 * the draft, so the model reads ordinary quoted text and a quote you typed by
 * hand looks the same as one you inserted.
 */

/** Containers a quote may come from: one message's rendered text. */
const QUOTABLE = ".markdown-body, .omp-user-bubble-content";
/**
 * Inside these the text is not the conversation itself, or not settled yet. The
 * live turn as a whole: its thinking block renders beside the streamed text,
 * not inside it, and changes just as much.
 */
const EXCLUDED = ".omp-streaming-turn, .omp-streaming, .omp-tool-card";
/** Chrome rendered inside message text that is not part of what was said. */
const CHROME = "button, .omp-code-block-header, .katex-mathml, [aria-hidden='true']:not(.katex-html)";

/**
 * The single message body that holds the whole selection, or null when the
 * selection is empty, spans two bodies, or sits outside the transcript.
 */
export function quotableContainer(selection: Selection | null, transcript: Element): Element | null {
	if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
	const range = selection.getRangeAt(0);
	const start = elementOf(range.startContainer)?.closest(QUOTABLE) ?? null;
	const end = elementOf(range.endContainer)?.closest(QUOTABLE) ?? null;
	if (!start || start !== end || !transcript.contains(start)) return null;
	if (start.closest(EXCLUDED)) return null;
	return start;
}

function elementOf(node: Node): Element | null {
	return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

/**
 * The visible text of `range` with its line breaks. Formulas read as their TeX
 * source instead of the doubled MathML-plus-glyph text a plain copy yields, and
 * code-block labels and copy buttons are left out.
 */
export function rangeQuoteText(range: Range): string {
	const fragment = range.cloneContents();
	for (const formula of fragment.querySelectorAll(".katex")) {
		const tex = formula.querySelector("annotation[encoding='application/x-tex']")?.textContent?.trim();
		if (!tex) continue;
		const display = formula.parentElement?.classList.contains("katex-display") === true;
		formula.replaceWith(display ? `$$${tex}$$` : `$${tex}$`);
	}
	for (const chrome of fragment.querySelectorAll(CHROME)) chrome.remove();
	// innerText needs layout to turn blocks into line breaks: measure the
	// fragment in an off-screen host instead of guessing from the markup.
	const host = document.createElement("div");
	host.style.cssText = "position:fixed;left:-99999px;top:0;width:800px;white-space:normal;pointer-events:none";
	host.append(fragment);
	document.body.append(host);
	const text = host.innerText;
	host.remove();
	return text;
}

/** `text` as a Markdown blockquote: `> ` on every line, blank edges trimmed. */
export function toBlockquote(text: string): string {
	const lines = text
		.replace(/\r\n?/g, "\n")
		.replace(/\u00a0/g, " ")
		.split("\n");
	while (lines.length > 0 && !lines[0].trim()) lines.shift();
	while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
	return lines.map(line => (line.trim() ? `> ${line.trimEnd()}` : ">")).join("\n");
}

/**
 * The draft with `quote` inserted at `caret`, set off by blank lines from text
 * on either side, and the caret placed on a fresh line after it, ready for the
 * reply to the quoted text.
 */
export function insertQuote(draft: string, caret: number, quote: string): { text: string; caret: number } {
	const at = Math.max(0, Math.min(caret, draft.length));
	const before = draft.slice(0, at).replace(/[ \t]+$/, "");
	const after = draft.slice(at).replace(/^[ \t]+/, "");
	const lead = before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
	const head = `${before}${lead}${quote}\n\n`;
	const tail = after.replace(/^\n+/, "");
	return { text: `${head}${tail}`, caret: head.length };
}
