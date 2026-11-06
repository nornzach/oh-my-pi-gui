/**
 * Right-clicking a file in the Files tree opens the file menu for the tab the
 * panel lists, so Reveal acts on that tab's file even when another tab's
 * workspace has a file at the same relative path.
 *
 * Opening a file shows what it is: its text, its picture, or a sentence saying
 * why neither is available.
 */
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { IpcResolvedPath } from "../../../shared/ipc-types";
import { I18nProvider } from "../../lib/i18n";
import { clearPathResolutionCache } from "../../lib/path-resolver";
import { setFocusedSessionRuntime } from "../../stores/session-runtime-context";
import { useUiStore } from "../../stores/ui";
import { LinkMenuHost } from "../common/LinkMenu";
import { FilesPanel } from "./FilesPanel";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");

const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);
Object.defineProperties(window, { innerWidth: { value: 1440 }, innerHeight: { value: 900 } });

const ompWindow = window as unknown as { omp?: unknown };

let root: Root | null = null;
let resolvePaths: Mock;
let revealPath: Mock;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

/** Dispatch inside act(); linkedom's Event has a getter-only eventPhase React writes to. */
async function dispatch(target: Element, event: InstanceType<typeof Event>): Promise<void> {
	Object.defineProperty(event, "eventPhase", { value: 0, writable: true, configurable: true });
	await act(async () => {
		target.dispatchEvent(event);
	});
	await flush();
}

afterEach(async () => {
	if (root) {
		await act(async () => root?.unmount());
		root = null;
	}
	document.body.innerHTML = "";
	delete ompWindow.omp;
	setFocusedSessionRuntime(null);
	clearPathResolutionCache();
	useUiStore.getState().closeFilePreview();
});

describe("FilesPanel right-click", () => {
	it("reveals the right-clicked file of the panel's own tab", async () => {
		const onDisk: IpcResolvedPath = { absolutePath: "/work/b/README.md", kind: "file", relativePath: "README.md" };
		resolvePaths = vi.fn(async (paths: string[]) => paths.map(() => onDisk));
		revealPath = vi.fn(async () => ({ ok: true }));
		ompWindow.omp = {
			fs: {
				list: vi.fn(async () => ({
					ok: true,
					entries: [{ name: "README.md", path: "README.md", kind: "file" }],
					truncated: false,
				})),
			},
			system: { resolvePaths, revealPath, openPath: vi.fn(async () => ({ ok: true })) },
		};
		setFocusedSessionRuntime("tab-b");
		const host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host as unknown as Element);
		await act(async () => {
			root?.render(
				<I18nProvider>
					<FilesPanel />
					<LinkMenuHost />
				</I18nProvider>,
			);
		});
		await flush();

		const row = document.querySelector('[data-tree-id="file:README.md"]');
		if (!row) throw new Error("README.md row missing");
		const event = new Event("contextmenu", { bubbles: true, cancelable: true });
		Object.defineProperties(event, { clientX: { value: 40 }, clientY: { value: 60 } });
		await dispatch(row as unknown as Element, event);

		expect(event.defaultPrevented).toBe(true);
		expect(resolvePaths).toHaveBeenCalledWith(["README.md"], "tab-b");
		const reveal = [...document.querySelectorAll('[role="menuitem"]')].find(item =>
			/Reveal|Show in/.test(item.textContent ?? ""),
		);
		if (!reveal) throw new Error("no reveal item");
		await dispatch(reveal as unknown as Element, new Event("click", { bubbles: true, cancelable: true }));
		expect(revealPath).toHaveBeenCalledWith("/work/b/README.md");
	});
});

describe("FilesPanel preview", () => {
	const PNG_URL = "data:image/png;base64,iVBORw0KGgo=";
	const SVG_URL = "data:image/svg+xml;base64,PHN2Zy8+";
	const SVG_SOURCE = '<svg xmlns="http://www.w3.org/2000/svg">\n<circle r="4"/>\n</svg>\n';
	const NOT_AN_IMAGE = { ok: false, dataUrl: null, mime: null, size: 0, error: "Not a supported image" };

	const binary = () => ({ ok: true, content: "", truncated: false, binary: true, size: 2048 });
	const text = (content: string) => ({ ok: true, content, truncated: false, binary: false, size: content.length });

	async function open(path: string, fs: Record<string, unknown>, line?: number): Promise<void> {
		ompWindow.omp = {
			fs: { list: vi.fn(async () => ({ ok: true, entries: [], truncated: false })), ...fs },
			system: { resolvePaths: vi.fn(async (paths: string[]) => paths.map(() => null)) },
		};
		useUiStore.getState().openFilePreview(path, line);
		const host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host as unknown as Element);
		await act(async () => {
			root?.render(
				<I18nProvider>
					<FilesPanel />
				</I18nProvider>,
			);
		});
		await flush();
	}

	const shownImage = () => document.querySelector("[data-file-preview] img");
	const shownText = () => document.querySelector("[data-file-preview]")?.textContent ?? "";

	it("draws a binary image from the tab's workspace, not a notice or line numbers", async () => {
		const readImage = vi.fn(async () => ({ ok: true, dataUrl: PNG_URL, mime: "image/png", size: 2048 }));
		setFocusedSessionRuntime("tab-b");

		await open("assets/shot.png", { read: vi.fn(async () => binary()), readImage });

		expect(readImage).toHaveBeenCalledWith("assets/shot.png", "tab-b");
		expect(shownImage()?.getAttribute("src")).toBe(PNG_URL);
		expect(shownImage()?.getAttribute("alt")).toBe("shot.png");
		expect(shownText()).not.toContain("Binary file");
		expect(document.querySelector("[data-file-preview] pre")).toBeNull();
	});

	it("says a binary file that isn't an image can't be previewed", async () => {
		await open("archive.zip", { read: vi.fn(async () => binary()), readImage: vi.fn(async () => NOT_AN_IMAGE) });

		expect(shownImage()).toBeNull();
		expect(shownText()).toContain("Binary file");
	});

	it("gives an oversized image's size instead of calling it a binary file", async () => {
		const tooLarge = { ok: false, dataUrl: null, mime: "image/png", size: 31_457_280, tooLarge: true };

		await open("huge.png", { read: vi.fn(async () => binary()), readImage: vi.fn(async () => tooLarge) });

		expect(shownImage()).toBeNull();
		expect(shownText()).toContain("too large");
		expect(shownText()).toContain("30.0 MB");
		expect(shownText()).not.toContain("Binary file");
	});

	it("shows a text file as text even when its first bytes look like an image type", async () => {
		// "BM" sniffs as a bitmap, so asking for an image here would get one back.
		const readImage = vi.fn(async () => ({
			ok: true,
			dataUrl: "data:image/bmp;base64,Qk0=",
			mime: "image/bmp",
			size: 9,
		}));

		await open("notes.txt", { read: vi.fn(async () => text("BM is a person's initials")), readImage });

		expect(shownImage()).toBeNull();
		expect(shownText()).toContain("BM is a person's initials");
	});

	it("draws an SVG, but shows its source when a link named a line", async () => {
		const fs = {
			read: vi.fn(async () => text(SVG_SOURCE)),
			readImage: vi.fn(async () => ({ ok: true, dataUrl: SVG_URL, mime: "image/svg+xml", size: 60 })),
		};

		await open("icon.svg", fs);
		expect(shownImage()?.getAttribute("src")).toBe(SVG_URL);
		expect(shownText()).not.toContain("<circle");

		await act(async () => root?.unmount());
		await open("icon.svg", fs, 2);
		expect(shownImage()).toBeNull();
		expect(shownText()).toContain("<circle");
		expect(document.querySelector("[data-marked]")?.textContent).toBe("2");
	});

	it.each([
		["doesn't sniff as an image", vi.fn(async () => NOT_AN_IMAGE)],
		["can't be read as an image", vi.fn(async () => Promise.reject(new Error("gone")))],
	])("falls back to the source of an .svg that %s", async (_label, readImage) => {
		await open("broken.svg", { read: vi.fn(async () => text("<!-- not drawable -->")), readImage });

		expect(shownImage()).toBeNull();
		expect(shownText()).toContain("not drawable");
	});

	it("says so when a binary image doesn't decode", async () => {
		await open("damaged.png", {
			read: vi.fn(async () => binary()),
			readImage: vi.fn(async () => ({ ok: true, dataUrl: PNG_URL, mime: "image/png", size: 2048 })),
		});

		await dispatch(shownImage() as unknown as Element, new Event("error"));

		expect(shownImage()).toBeNull();
		expect(shownText()).toContain("Couldn't display this image");
	});

	it("says a file couldn't be read, without the system's wording", async () => {
		const missing = { ok: false, content: "", truncated: false, binary: false, size: 0 };
		const error = "ENOENT: no such file or directory, stat '/work/gone.png'";

		await open("gone.png", { read: vi.fn(async () => ({ ...missing, error })), readImage: vi.fn() });

		expect(shownText()).toContain("Couldn't read this file");
		expect(shownText()).not.toContain("ENOENT");
	});

	it("shows the source of an SVG that doesn't decode", async () => {
		await open("damaged.svg", {
			read: vi.fn(async () => text(SVG_SOURCE)),
			readImage: vi.fn(async () => ({ ok: true, dataUrl: SVG_URL, mime: "image/svg+xml", size: 60 })),
		});

		await dispatch(shownImage() as unknown as Element, new Event("error"));

		expect(shownImage()).toBeNull();
		expect(shownText()).toContain("<circle");
		expect(shownText()).not.toContain("Couldn't display this image");
	});

	it("gives a raster's pixel size and a vector's file size only", async () => {
		const loaded = async (url: string, mime: string, name: string) => {
			await open(name, {
				read: vi.fn(async () => binary()),
				readImage: vi.fn(async () => ({ ok: true, dataUrl: url, mime, size: 2048 })),
			});
			const image = shownImage();
			Object.defineProperties(image, { naturalWidth: { value: 1920 }, naturalHeight: { value: 1080 } });
			await dispatch(image as unknown as Element, new Event("load"));
			return shownText();
		};

		expect(await loaded(PNG_URL, "image/png", "shot.png")).toContain("1920 × 1080 · 2.0 KB");

		await act(async () => root?.unmount());
		const vector = await loaded(SVG_URL, "image/svg+xml", "icon.svg");
		expect(vector).toContain("2.0 KB");
		expect(vector).not.toContain("1920");
	});

	it("doesn't let a slow image replace the file opened after it", async () => {
		const slow = Promise.withResolvers<unknown>();
		await open("slow.png", {
			read: vi.fn(async (path: string) => (path === "slow.png" ? binary() : text("the newer file"))),
			readImage: vi.fn(() => slow.promise),
		});

		await act(async () => useUiStore.getState().openFilePreview("newer.txt"));
		await flush();
		await act(async () => slow.resolve({ ok: true, dataUrl: PNG_URL, mime: "image/png", size: 2048 }));
		await flush();

		expect(shownImage()).toBeNull();
		expect(shownText()).toContain("the newer file");
	});
});
