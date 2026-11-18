import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "./i18n";
import { MarkdownRenderer } from "./markdown";

function render(content: string, singleDollarTextMath = true) {
	return parseHTML(
		renderToStaticMarkup(
			<I18nProvider>
				<MarkdownRenderer content={content} singleDollarTextMath={singleDollarTextMath} />
			</I18nProvider>,
		),
	).document;
}

describe("Markdown emphasis in CJK prose", () => {
	it.each([true, false])("renders bold list labels followed by digits or Han text (single-dollar math: %s)", math => {
		const document = render("- **有图但没建模：**16 个输入\n- **有模型但参数未证实：**例如墙高", math);
		const items = Array.from(document.querySelectorAll("li"));
		expect(items.map(item => item.querySelector("strong")?.textContent)).toEqual([
			"有图但没建模：",
			"有模型但参数未证实：",
		]);
		expect(items.map(item => item.textContent)).toEqual(["有图但没建模：16 个输入", "有模型但参数未证实：例如墙高"]);
	});

	it("preserves code spans and escaped markers", () => {
		const document = render("`**参数：**16`，以及 \\*\\*参数：\\*\\*16");
		expect(document.querySelector("code")?.textContent).toBe("**参数：**16");
		expect(document.querySelector("strong")).toBeNull();
		expect(document.querySelector("p")?.textContent).toBe("**参数：**16，以及 **参数：**16");
	});
});
