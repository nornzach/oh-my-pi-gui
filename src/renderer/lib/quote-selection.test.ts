import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { insertQuote, quotableContainer, toBlockquote } from "./quote-selection";

const { document } = parseHTML(`<html><body>
	<div id="transcript">
		<div class="omp-user-bubble-content"><div class="markdown-body"><p id="user">Question</p></div></div>
		<div class="omp-assistant-turn"><div class="markdown-body"><p id="a1">First</p><p id="a2">Second</p></div>
			<div class="omp-tool-card"><div class="markdown-body"><p id="tool">Tool output</p></div></div>
		</div>
		<div class="omp-streaming-turn">
			<div class="omp-thinking-block"><div class="markdown-body"><p id="thinking">Live thought</p></div></div>
		</div>
	</div>
	<div class="markdown-body"><p id="outside">Elsewhere</p></div>
</body></html>`);
const transcript = document.getElementById("transcript") as unknown as Element;

/** A one-range selection from the text of `fromId` to the text of `toId`. */
function selectionOf(fromId: string, toId = fromId): Selection {
	const text = (id: string) => (document.getElementById(id) as unknown as Element).firstChild as Node;
	return {
		isCollapsed: false,
		rangeCount: 1,
		getRangeAt: () => ({ startContainer: text(fromId), endContainer: text(toId) }) as unknown as Range,
	} as unknown as Selection;
}

describe("quotableContainer", () => {
	it("accepts a selection inside one settled message, across its paragraphs", () => {
		expect(quotableContainer(selectionOf("a1", "a2"), transcript)).not.toBeNull();
	});

	it("refuses a selection that spans two messages", () => {
		expect(quotableContainer(selectionOf("user", "a1"), transcript)).toBeNull();
	});

	it("refuses the live turn, including its thinking block beside the streamed text", () => {
		expect(quotableContainer(selectionOf("thinking"), transcript)).toBeNull();
	});

	it("refuses tool output and text outside the transcript", () => {
		expect(quotableContainer(selectionOf("tool"), transcript)).toBeNull();
		expect(quotableContainer(selectionOf("outside"), transcript)).toBeNull();
	});
});

describe("toBlockquote", () => {
	it("prefixes every line, keeps inner blank lines as bare markers and trims blank edges", () => {
		expect(toBlockquote("\n\nfirst line  \r\n\r\nsecond line\n\n")).toBe("> first line\n>\n> second line");
	});

	it("yields nothing for a whitespace-only selection, so no empty quote is inserted", () => {
		expect(toBlockquote(" \n\t\n")).toBe("");
	});
});

describe("insertQuote", () => {
	it("fills an empty draft and leaves the caret on the line after the quote", () => {
		expect(insertQuote("", 0, "> a")).toEqual({ text: "> a\n\n", caret: 5 });
	});

	it("sets the quote off from text on both sides of the caret", () => {
		const draft = "Look at this:then answer";
		const result = insertQuote(draft, "Look at this:".length, "> a\n> b");
		expect(result.text).toBe("Look at this:\n\n> a\n> b\n\nthen answer");
		expect(result.text.slice(result.caret)).toBe("then answer");
	});

	it("does not stack blank lines when the caret already sits after a paragraph break", () => {
		expect(insertQuote("first\n\n", 7, "> q").text).toBe("first\n\n> q\n\n");
	});
});
