import { describe, expect, it } from "vitest";
import { presentStreamingTail, segmentStreamingMarkdown } from "./streaming-markdown";

describe("streaming Markdown segmentation", () => {
	it("promotes complete paragraphs while leaving the unfinished tail mutable", () => {
		const source = "First **complete** paragraph.\n\nSecond paragraph is still growing";
		const result = segmentStreamingMarkdown(source);

		expect(result.blocks).toEqual([{ end: 31, content: "First **complete** paragraph.\n\n" }]);
		expect(result.tailStart).toBe(31);
		expect(result.tail).toBe("Second paragraph is still growing");
	});

	it("does not split blank lines inside an unfinished fenced code block", () => {
		const source = "```ts\nconst first = 1;\n\nconst second = 2;";
		const result = segmentStreamingMarkdown(source);

		expect(result.blocks).toEqual([]);
		expect(result.tail).toBe(source);
	});

	it("promotes a fenced code block as soon as its closing line is complete", () => {
		const code = "```ts\nconst first = 1;\n\nconst second = 2;\n```\n";
		const result = segmentStreamingMarkdown(`${code}Next`);

		expect(result.blocks).toEqual([{ end: code.length, content: code }]);
		expect(result.tail).toBe("Next");
	});

	it("keeps display-math blank lines together until the closing fence", () => {
		const math = "$$\na + b\n\nc + d\n$$\n";
		const result = segmentStreamingMarkdown(`${math}Explanation`);

		expect(result.blocks).toEqual([{ end: math.length, content: math }]);
		expect(result.tail).toBe("Explanation");
	});
	it("keeps bracket math intact when delimiters share lines with the formula", () => {
		const unfinished = String.raw`\[a

\\]

+ b`;
		expect(segmentStreamingMarkdown(unfinished).blocks).toEqual([]);
		const completed = `${unfinished}\\]\n`;
		const result = segmentStreamingMarkdown(`${completed}Explanation`);
		expect(result.blocks).toEqual([{ end: completed.length, content: completed }]);
		expect(result.tail).toBe("Explanation");
	});

	it("keeps a completed list equation with its following indented explanation", () => {
		const source = "- Equation:\n\n  \\[\n  x = y\n  \\]\n\n  Explanation";
		const result = segmentStreamingMarkdown(source);
		expect(result.blocks).toEqual([]);
		expect(result.tail).toBe(source);
	});
	it("keeps indented list continuations in the same block across blank lines", () => {
		// Live: `second` belongs to the first <li>; promoting at the blank line
		// dropped it out of the list until message_end re-parsed everything.
		const source = "1. first\n\n   second paragraph";
		const result = segmentStreamingMarkdown(source);
		expect(result.blocks).toEqual([]);
		expect(result.tail).toBe(source);
	});

	it("ends the list block when a non-indented line follows a blank line", () => {
		const head = "1. first\n\n";
		const result = segmentStreamingMarkdown(`${head}Second paragraph`);
		expect(result.blocks).toEqual([{ end: head.length, content: head }]);
		expect(result.tailStart).toBe(head.length);
		expect(result.tail).toBe("Second paragraph");
	});

	it("keeps further list items in the same block after blank lines", () => {
		const source = "- alpha\n\n- beta still streaming";
		const result = segmentStreamingMarkdown(source);
		expect(result.blocks).toEqual([]);
		expect(result.tail).toBe(source);
	});
});

describe("streaming tail presentation", () => {
	it("closes an open fence so the code block grows in place", () => {
		expect(presentStreamingTail("~~~~py\nprint(1")).toEqual({ markdown: "~~~~py\nprint(1\n~~~~", plain: "" });
	});

	it("keeps unfinished display math as plain text so KaTeX never sees half a formula", () => {
		expect(presentStreamingTail("Before\n$$\nx = \\frac{1}{")).toEqual({
			markdown: "Before",
			plain: "$$\nx = \\frac{1}{",
		});
	});

	it("holds back a partial line that would render as a different block", () => {
		// A bare `##`, a list marker without text, and a `--` that would turn the
		// paragraph above into a setext heading.
		expect(presentStreamingTail("Intro\n##").markdown).toBe("Intro");
		expect(presentStreamingTail("Intro\n12.").markdown).toBe("Intro");
		expect(presentStreamingTail("Some paragraph\n--").markdown).toBe("Some paragraph");
	});

	it("shows only the text of a link whose target is still arriving", () => {
		expect(presentStreamingTail("See [the docs](https://exa").markdown).toBe("See the docs");
		expect(presentStreamingTail("Logo ![alt](./lo").markdown).toBe("Logo ");
	});

	it("closes nested emphasis innermost-first and leaves literal asterisks alone", () => {
		expect(presentStreamingTail("**bold and *both").markdown).toBe("**bold and *both***");
		expect(presentStreamingTail("2 * 3 = 6 and a * b").markdown).toBe("2 * 3 = 6 and a * b");
		expect(presentStreamingTail("- **Done**: item\n* next").markdown).toBe("- **Done**: item\n* next");
	});
});
