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
const { EvalRenderer } = await import("./EvalRenderer");
const { HubRenderer } = await import("./HubRenderer");
const { ImageRenderer } = await import("./ImageRenderer");
const { ReadRenderer } = await import("./ReadRenderer");

let container: HTMLElement;
let root: Root;

async function mount(element: ReactElement): Promise<void> {
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(<I18nProvider>{element}</I18nProvider>);
	});
}

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
});

describe("omp 17.3.5 renderer parity", () => {
	it("renders an image block returned by a PDF page read", async () => {
		await mount(
			<ReadRenderer
				args={{ path: "report.pdf:page-2.png" }}
				result={{
					content: [
						{ type: "text", text: "Rendered PDF page 2" },
						{ type: "image", data: "cG5n", mimeType: "image/png" },
					],
				}}
			/>,
		);

		const image = container.querySelector("img");
		expect(image?.getAttribute("src")).toBe("data:image/png;base64,cG5n");
		expect(image?.getAttribute("alt")).toBe("report.pdf:page-2.png");
	});

	it("labels a hub registration with no live turn instead of showing it as running", async () => {
		await mount(
			<HubRenderer
				args={{ op: "jobs" }}
				result={{
					content: [{ type: "text", text: "stale registration" }],
					details: { agents: [{ id: "Zombie", ageMs: 12_000, live: false }] },
				}}
			/>,
		);

		expect(container.textContent).toContain("Zombie");
		expect(container.textContent).toContain("no turn");
		expect(container.textContent).not.toContain("running");
	});
});

describe("omp 18.1.9 renderer parity", () => {
	it("renders every image while an eval cell is still streaming", async () => {
		await mount(
			<EvalRenderer
				args={{ code: "display(first); display(second)", language: "python" }}
				isPartial
				partialResult={{
					content: [{ type: "text", text: "" }],
					details: {
						images: [
							{ type: "image", data: "first", mimeType: "image/png" },
							{ type: "image", data: "second", mimeType: "image/jpeg" },
						],
					},
				}}
				result={null}
			/>,
		);

		expect([...container.querySelectorAll("img")].map(image => image.getAttribute("src"))).toEqual([
			"data:image/png;base64,first",
			"data:image/jpeg;base64,second",
		]);
	});
});

describe("omp 18.2.8 renderer parity", () => {
	it("previews every picture a generate_image call produced", async () => {
		// The tool's payload is `{data, mimeType}` pairs plus the saved files, not
		// content blocks: an unmapped name fell through to the key/value view, so
		// the transcript showed paths and a folded JSON blob instead of images.
		await mount(
			<ImageRenderer
				args={{ subject: "a red fox", action: "running through snow" }}
				result={{
					content: [{ type: "text", text: "Provider: openai\nModel: gpt-image-1\nGenerated 2 image(s):" }],
					details: {
						provider: "openai",
						model: "gpt-image-1",
						imageCount: 2,
						imagePaths: ["/tmp/omp-image-one.png", "/tmp/omp-image-two.jpg"],
						images: [
							{ data: "first", mimeType: "image/png" },
							{ data: "second", mimeType: "image/jpeg" },
						],
					},
				}}
			/>,
		);

		expect([...container.querySelectorAll("img")].map(image => image.getAttribute("src"))).toEqual([
			"data:image/png;base64,first",
			"data:image/jpeg;base64,second",
		]);
		// Header names the saved file and counts the set; the base64 never shows.
		expect(container.textContent).toContain("/tmp/omp-image-one.png");
		expect(container.textContent).toContain("×2");
		expect(container.textContent).not.toContain("first");
	});
});

describe("read preview", () => {
	it("keeps the copy control on a text file read", async () => {
		// The read card truncated the preview and offered no way to get the rest
		// onto the clipboard; the copy control every other code block carries had
		// been switched off here.
		await mount(
			<ReadRenderer
				args={{ path: "src/renderer/lib/diff.tsx" }}
				result={{ content: [{ type: "text", text: "export const INITIAL_RENDER_ROWS = 150;\n" }] }}
			/>,
		);

		expect(container.textContent).toContain("INITIAL_RENDER_ROWS");
		expect(container.querySelector("button[title='Copy code']")).not.toBeNull();
	});
});
