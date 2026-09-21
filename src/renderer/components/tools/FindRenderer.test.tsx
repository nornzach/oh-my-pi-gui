/**
 * FindRenderer contract tests: the semantic-search (`find`) tool renderer added
 * for the omp 18.2.7 upstream. Defends the observable display contract —
 * ranked hit ordering, verified passage ranges, TUI-style sanitization of
 * snippet text, the empty/failed states, and localized labels under a language
 * switch. Follows the linkedom harness pattern (see UpstreamParityRenderers).
 */
import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../lib/i18n";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
Object.assign(globalThis as Record<string, unknown>, {
	document,
	window,
	Event,
	HTMLElement,
	Element,
	Node,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { FindRenderer } = await import("./FindRenderer");

let container: HTMLElement;
let root: Root;
const realLocalStorage = (globalThis as Record<string, unknown>).localStorage;

async function mount(element: ReactElement): Promise<void> {
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(<I18nProvider>{element}</I18nProvider>);
	});
}

/** Force the persisted language the provider seeds itself from. */
function setLanguage(lang: "en" | "zh"): void {
	(globalThis as Record<string, unknown>).localStorage = {
		getItem: (key: string) => (key === "omp.lang" ? lang : null),
		setItem: () => {},
	};
}

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	(globalThis as Record<string, unknown>).localStorage = realLocalStorage;
});

function findResult(details: Record<string, unknown>, text = "done") {
	return { content: [{ type: "text", text }], details };
}

describe("FindRenderer", () => {
	it("ranks hits by content score regardless of wire order and shows the query", async () => {
		await mount(
			<FindRenderer
				args={{ query: "auth flow" }}
				result={findResult({
					query: "auth flow",
					scopePath: "src",
					threshold: 0.35,
					cwd: "/repo",
					stats: { filesRead: 12, errors: 0, failures: [] },
					hits: [
						{
							rel: "src/low.ts",
							contentScore: 0.4,
							ranges: [{ start: 3, end: 3, p: 0.3, snippet: "weak" }],
							linesSeen: 20,
							truncated: false,
						},
						{
							rel: "src/high.ts",
							contentScore: 0.9,
							ranges: [{ start: 10, end: 12, p: 0.8, snippet: "login()" }],
							linesSeen: 100,
							truncated: false,
						},
					],
				})}
			/>,
		);

		expect(container.textContent).toContain("auth flow");
		const labels = [...container.querySelectorAll("li")].map(li => li.textContent ?? "");
		// Highest-scoring file must render first even though it arrived second.
		expect(labels[0]).toContain("src/high.ts");
		expect(labels[1]).toContain("src/low.ts");
		expect(container.textContent).toContain("0.90");
		expect(container.textContent).toContain(":10–12");
	});

	it("sanitizes snippet text: strips ANSI color and expands tabs", async () => {
		await mount(
			<FindRenderer
				args={{ query: "q" }}
				result={findResult({
					query: "q",
					cwd: "/repo",
					stats: { filesRead: 1, errors: 0, failures: [] },
					hits: [
						{
							rel: "src/a.ts",
							contentScore: 0.7,
							ranges: [{ start: 1, end: 1, p: 0.6, snippet: "\x1b[31mred\x1b[0m\tvalue" }],
							linesSeen: 5,
							truncated: false,
						},
					],
				})}
			/>,
		);

		expect(container.textContent).toContain("red    value");
		expect(container.textContent).not.toContain("\x1b");
	});

	it("shows the empty-state label when the search verified no passages", async () => {
		await mount(
			<FindRenderer
				args={{ query: "nothing" }}
				result={findResult({
					query: "nothing",
					cwd: "/repo",
					stats: { filesRead: 3, errors: 0, failures: [] },
					hits: [],
				})}
			/>,
		);
		expect(container.textContent).toContain("No relevant passages found");
	});

	it("shows the failure label and suppresses the hit list on error", async () => {
		await mount(
			<FindRenderer
				args={{ query: "boom" }}
				isError
				result={findResult(
					{ query: "boom", hits: [{ rel: "x.ts", contentScore: 1, ranges: [] }] },
					"index unavailable",
				)}
			/>,
		);
		expect(container.textContent).toContain("search failed");
		expect(container.querySelector("ol")).toBeNull();
	});

	it("localizes the failure label after a language switch to zh", async () => {
		setLanguage("zh");
		await mount(
			<FindRenderer
				args={{ query: "boom" }}
				isError
				result={findResult({ query: "boom", hits: [] }, "index unavailable")}
			/>,
		);
		expect(container.textContent).toContain("搜索失败");
		expect(container.textContent).not.toContain("search failed");
	});
});
