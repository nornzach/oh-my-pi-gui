import { describe, expect, it } from "vitest";
import { insertQuote, toBlockquote } from "./quote-selection";

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
