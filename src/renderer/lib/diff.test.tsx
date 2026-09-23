import { parseHTML } from "linkedom";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { DiffView } from "./diff";
import { loadHljs } from "./highlight";
import { I18nProvider } from "./i18n";

function render(element: ReactElement): Document {
	const html = renderToStaticMarkup(<I18nProvider>{element}</I18nProvider>);
	return parseHTML(`<html><body>${html}</body></html>`).document;
}

beforeAll(async () => {
	await loadHljs();
});

describe("DiffView syntax highlighting", () => {
	it("renders decoded source text through React nodes while preserving highlight scopes", () => {
		const document = render(<DiffView diff={'@@ -1,1 +1,1 @@\n const value = "<tag>&";'} filePath="sample.ts" />);

		expect(document.querySelector(".hljs-keyword")?.textContent).toBe("const");
		expect(document.body.textContent).toContain('const value = "<tag>&";');
	});
});

/** A plain unified diff of `count` context rows, each identifiable by number. */
function contextDiff(count: number): string {
	const rows: string[] = ["@@ -1,1 +1,1 @@"];
	for (let i = 1; i <= count; i++) rows.push(` line ${i}`);
	return rows.join("\n");
}

/** Painted diff rows — the DOM nodes a large patch must not build all at once. */
function paintedRows(document: Document): number {
	return document.querySelectorAll('[class*="whitespace-pre"]').length;
}

describe("DiffView render budget", () => {
	it("paints the head of a long patch and puts the tail behind one click", () => {
		const document = render(<DiffView diff={contextDiff(400)} />);
		const text = document.body.textContent ?? "";

		// A diff row is several DOM nodes plus a possible hljs pass, so painting
		// the first 150 and asking before the rest is what keeps a large patch
		// from freezing the UI on expand.
		expect(paintedRows(document)).toBe(150);
		expect(text).toContain("line 150");
		expect(text).toContain("Show 250 more lines");
	});

	it("reveals in chunks and reserves the ellipsis row for what no click reaches", () => {
		const document = render(<DiffView diff={contextDiff(3200)} />);
		const text = document.body.textContent ?? "";

		// 3200 rows: the next click can still reach 600 of them, so the footer
		// must promise those rather than declare the 3000-row ceiling reached.
		expect(paintedRows(document)).toBe(150);
		expect(text).toContain("Show 600 more lines");
		expect(text).not.toContain("200 more lines");
	});

	it("offers the raw patch on the clipboard and leaves a short diff alone", () => {
		const long = render(<DiffView diff={contextDiff(400)} />);
		expect(long.querySelector("button[aria-label='Copy diff']")).not.toBeNull();

		const short = render(<DiffView diff={contextDiff(3)} />);
		expect(paintedRows(short)).toBe(3);
		expect(short.querySelector("button[aria-label='Copy diff']")).not.toBeNull();
		expect(short.body.textContent ?? "").not.toContain("more lines");
	});
});
