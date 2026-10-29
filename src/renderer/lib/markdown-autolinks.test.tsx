/**
 * Contracts for bare web addresses in replies written in Chinese, where no
 * space follows the address (nornzach/oh-my-pi-gui#35). GFM ran the link to
 * the next space: `http://127.0.0.1:18091，仅` linked the comma and the next
 * word, the browser panel refused the mangled address, and a `**…**` around
 * the address rendered as literal asterisks.
 */
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "./i18n";
import { MarkdownRenderer } from "./markdown";
import { findTextLinks } from "./terminal-links";

function render(content: string, singleDollarTextMath = true) {
	return parseHTML(
		renderToStaticMarkup(
			<I18nProvider>
				<MarkdownRenderer content={content} singleDollarTextMath={singleDollarTextMath} />
			</I18nProvider>,
		),
	).document;
}

/** Each link's (decoded) target and visible text, in order. */
function links(content: string, singleDollarTextMath = true) {
	return Array.from(render(content, singleDollarTextMath).querySelectorAll("a"), anchor => ({
		href: decodeURI(anchor.getAttribute("href") ?? ""),
		text: anchor.textContent,
	}));
}

const hrefs = (content: string) => links(content).map(link => link.href);

describe("Bare addresses in CJK prose", () => {
	it.each([true, false])("ends the link at full-width punctuation (single-dollar math: %s)", singleDollar => {
		const content = "运行于 http://127.0.0.1:18091，仅 CK002 可用。";
		expect(links(content, singleDollar)).toEqual([
			{ href: "http://127.0.0.1:18091", text: "http://127.0.0.1:18091" },
		]);
		expect(render(content, singleDollar).querySelector("p")?.textContent).toBe(content);
	});

	it("ends the link where Chinese text meets the host or port", () => {
		expect(hrefs("运行于 http://127.0.0.1:18091仅 CK002")).toEqual(["http://127.0.0.1:18091"]);
		expect(hrefs("端口 http://localhost:3000.仅供测试")).toEqual(["http://localhost:3000"]);
		expect(hrefs("访问 https://example.com仅供参考")).toEqual(["https://example.com"]);
	});

	it("renders a bold-wrapped address as bold with the address linked inside", () => {
		const document = render("运行于 **http://127.0.0.1:18091**，仅 CK002；后台 **http://localhost:3000/admin**进入");
		expect(Array.from(document.querySelectorAll("strong > a"), anchor => anchor.getAttribute("href"))).toEqual([
			"http://127.0.0.1:18091",
			"http://localhost:3000/admin",
		]);
		expect(document.querySelector("p")?.textContent).not.toContain("*");
	});

	it("keeps trimming ASCII sentence punctuation as before", () => {
		expect(hrefs("See https://example.com/a. Then https://example.com/b, or (https://example.com/c).")).toEqual([
			"https://example.com/a",
			"https://example.com/b",
			"https://example.com/c",
		]);
	});

	it("keeps Chinese in paths and hosts part of the address", () => {
		expect(hrefs("见 https://zh.wikipedia.org/wiki/中文，或 https://中文.com 和 https://example.中国 。")).toEqual([
			"https://zh.wikipedia.org/wiki/中文",
			"https://中文.com",
			"https://example.中国",
		]);
	});

	it("ends a www address that follows Chinese punctuation", () => {
		expect(links("官网：www.example.com，欢迎访问")).toEqual([
			{ href: "http://www.example.com", text: "www.example.com" },
		]);
		expect(render("官网：www.example.com，欢迎访问").querySelector("p")?.textContent).toBe(
			"官网：www.example.com，欢迎访问",
		);
	});

	it("leaves explicit links and angle-bracket autolinks as written", () => {
		expect(hrefs("[服务](http://127.0.0.1:18091/a，b) 与 <http://127.0.0.1:18091/c，d>")).toEqual([
			"http://127.0.0.1:18091/a，b",
			"http://127.0.0.1:18091/c，d",
		]);
	});

	it("finds the same addresses in plain text as in rendered markdown", () => {
		// Terminal output, tool output, and the last-link command read raw text.
		const lines = [
			"运行于 **http://127.0.0.1:18091**，仅 CK002",
			"运行于 http://127.0.0.1:18091仅 CK002",
			"后台 **http://localhost:3000/admin**进入",
			"见 https://zh.wikipedia.org/wiki/中文，以及 https://example.com/b.",
			"地址（http://localhost:5173/）已就绪",
		];
		for (const line of lines) {
			expect(findTextLinks(line).map(link => link.url)).toEqual(hrefs(line));
		}
	});
});
