/**
 * One-line report snippets render `code` and **bold**, and nothing else a
 * model writes turns into markup.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineMarkdown } from "./inline-markdown";

const render = (text: string) => renderToStaticMarkup(<InlineMarkdown text={text} />);

describe("InlineMarkdown", () => {
	it("renders code and bold spans instead of printing their markers", () => {
		const html = render("Bump `undici` — **2 advisories**");
		expect(html).toContain('<code class="omp-inline-code">undici</code>');
		expect(html).toContain("<strong");
		expect(html).toContain(">2 advisories</strong>");
		expect(html).not.toContain("`");
		expect(html).not.toContain("**");
	});

	it("keeps HTML in model text as text", () => {
		const html = render('<img src=x onerror="alert(1)"> and `<b>`');
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
		expect(html).toContain('<code class="omp-inline-code">&lt;b&gt;</code>');
	});

	it("leaves an unclosed marker as literal text", () => {
		expect(render("a `b and **c")).toBe("a `b and **c");
	});
});
