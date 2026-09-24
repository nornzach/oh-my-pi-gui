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
const { WaitRenderer } = await import("./CoordinationRenderer");
const { WriteRenderer } = await import("./WriteRenderer");

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

describe("omp 18.3.0 coordination protocol renderers", () => {
	it("renders wait snapshots as compact job and agent rows", async () => {
		await mount(
			<WaitRenderer
				args={{}}
				result={{
					content: [{ type: "text", text: "Waiting on background work" }],
					details: {
						jobs: [
							{ id: "build-42", type: "bash", status: "running", label: "bun test", durationMs: 1_200 },
							{ id: "lint-7", type: "bash", status: "completed", label: "bun lint", durationMs: 800 },
						],
						agents: [{ id: "Scout", live: false, activity: "reviewing changes", ageMs: 5_000 }],
					},
				}}
			/>,
		);

		expect(container.textContent).toContain("build-42");
		expect(container.textContent).toContain("lint-7");
		expect(container.textContent).toContain("Scout");
		expect(container.textContent).toContain("stale");
	});

	it("renders proc reads with structured job details instead of a file preview", async () => {
		await mount(
			<ReadRenderer
				args={{ path: "proc://build-42" }}
				result={{
					content: [{ type: "text", text: "build-42 [bash] — running" }],
					details: {
						proc: {
							job: { id: "build-42", type: "bash", status: "running", label: "bun test", durationMs: 2_400 },
							log: "18 tests running",
						},
					},
				}}
			/>,
		);

		expect(container.textContent).toContain("Process build-42");
		expect(container.textContent).toContain("18 tests running");
		expect(container.querySelector("a")).toBeNull();
	});

	it("renders agent messages and proc cancellation as protocol operations", async () => {
		await mount(
			<WriteRenderer
				args={{ path: "agent://Scout", content: "please recheck the API" }}
				result={{
					content: [{ type: "text", text: "Delivered to Scout." }],
					details: { message: { to: "Scout", receipts: [{ to: "Scout", outcome: "injected" }] } },
				}}
			/>,
		);
		expect(container.textContent).toContain("Scout");
		expect(container.textContent).toContain("please recheck the API");
		expect(container.textContent).toContain("injected");

		await act(async () => root.unmount());
		await mount(
			<WriteRenderer
				args={{ path: "proc://build-42/kill" }}
				result={{
					content: [{ type: "text", text: "Cancelled build-42" }],
					details: {
						proc: {
							op: "cancel",
							jobs: [
								{ id: "build-42", type: "bash", status: "cancelled", label: "bun test", durationMs: 2_500 },
							],
							cancelled: [{ id: "build-42", status: "cancelled" }],
						},
					},
				}}
			/>,
		);
		expect(container.textContent).toContain("Process kill");
		expect(container.textContent).toContain("build-42");
		expect(container.textContent).toContain("cancelled");
	});
});
