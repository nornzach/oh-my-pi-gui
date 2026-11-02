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
const { BashRenderer } = await import("./BashRenderer");

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

function bashResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text", text }], details };
}

describe("BashRenderer", () => {
	it("renders SGR-colored output as styled spans instead of raw escapes", async () => {
		await mount(
			<BashRenderer
				args={{ command: "vitest run" }}
				result={bashResult("\x1b[32m✓ 12 passed\x1b[0m, \x1b[31m✗ 1 failed\x1b[0m")}
			/>,
		);
		const spans = [...container.querySelectorAll("span")].filter(el => el.getAttribute("style")?.includes("color"));
		expect(spans.length).toBeGreaterThanOrEqual(2);
		expect(container.textContent).toContain("✓ 12 passed, ✗ 1 failed");
		expect(container.textContent).not.toContain("[32m");
	});

	it("strips the exit-code trailer and restates it as a stats line", async () => {
		await mount(
			<BashRenderer
				args={{ command: "false" }}
				result={bashResult("boom output\nCommand exited with code 1", { exitCode: 1, wallTimeMs: 420 })}
				isError
			/>,
		);
		expect(container.textContent).toContain("boom output");
		expect(container.textContent).not.toContain("Command exited with code 1");
		expect(container.textContent).toContain("Wall: 0.42s");
		expect(container.textContent).toContain("Exit: 1");
	});

	it("states the output minimizer's rewrite on one plain line", async () => {
		await mount(
			<BashRenderer
				args={{ command: "git log" }}
				result={bashResult("abc123 fix parser", {
					wallTimeMs: 300,
					// A rehydrated session may carry any label: colors, a line break, a home path.
					meta: {
						minimized: {
							filter: "\x1b[31mgit\x1b[0m\n/Users/zach/notes",
							inputBytes: 123_290,
							outputBytes: 3_277,
							artifactId: "a1",
						},
					},
				})}
			/>,
		);
		expect(container.textContent).toContain("Minimized: git ~/notes 120.4 KB → 3.2 KB");
	});

	it("strips the background-job trailer and restates the job id", async () => {
		await mount(
			<BashRenderer
				args={{ command: "npm run dev" }}
				result={bashResult("server ready\nBackgrounded as job bg-7; result will be delivered automatically.", {
					async: { state: "running", jobId: "bg-7" },
				})}
			/>,
		);
		expect(container.textContent).toContain("server ready");
		expect(container.textContent).not.toContain("result will be delivered automatically");
		expect(container.textContent).toContain("Backgrounded: bg-7");
	});

	it("strips the wall-time notice when intermediate notices follow it", async () => {
		// Wire order: wall time is appended BEFORE timeout/pty notices, so it
		// sits mid-body — an end-anchored strip would leak it into the output.
		await mount(
			<BashRenderer
				args={{ command: "sleep 1" }}
				result={bashResult(
					"done\n\nWall time: 0.42 seconds\nTimeout clamped to 5s (requested 999s; allowed range 5-3600s).\n\nCommand exited with code 2",
					{ exitCode: 2, wallTimeMs: 420, timeoutSeconds: 5, requestedTimeoutSeconds: 999 },
				)}
				isError
			/>,
		);
		expect(container.textContent).toContain("done");
		expect(container.textContent).not.toContain("Wall time:");
		expect(container.textContent).not.toContain("Command exited with code");
		expect(container.textContent).toContain("Wall: 0.42s");
		expect(container.textContent).toContain("Exit: 2");
	});

	it("strips the exit-code trailer when the structured artifact id confirms the footer", async () => {
		// The byte-cap appends the footer after every notice and mirrors its id
		// in details, so printed lookalikes remain ordinary command output.
		await mount(
			<BashRenderer
				args={{ command: "huge-output" }}
				result={bashResult("tail of output\nCommand exited with code 1\n[raw output: artifact://42]", {
					exitCode: 1,
					artifactId: "42",
					meta: { truncation: { direction: "tail" } },
				})}
				isError
			/>,
		);
		expect(container.textContent).toContain("tail of output");
		expect(container.textContent).not.toContain("Command exited with code");
		expect(container.textContent).not.toContain("[raw output: artifact://42]");
		expect(container.textContent).toContain("Artifact: 42");
		expect(container.textContent).toContain("Exit: 1");
	});

	it("keeps plain output as a single text node (no span explosion)", async () => {
		await mount(<BashRenderer args={{ command: "ls" }} result={bashResult("a\nb\nc")} />);
		expect(container.textContent).toContain("a\nb\nc");
	});

	it("renders every terminal image returned beside bash output", async () => {
		await mount(
			<BashRenderer
				args={{ command: "show-images" }}
				result={{
					content: [
						{ type: "text", text: "captured" },
						{ type: "image", data: "first", mimeType: "image/png" },
						{ type: "image", data: "second", mimeType: "image/jpeg" },
					],
				}}
			/>,
		);
		const images = [...container.querySelectorAll("img")];
		expect(images.map(image => image.getAttribute("src"))).toEqual([
			"data:image/png;base64,first",
			"data:image/jpeg;base64,second",
		]);
	});
});
