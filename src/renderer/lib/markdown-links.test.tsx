/**
 * Contracts for links inside rendered replies. Inline code that names a file
 * on disk becomes a link that previews the file at the named line; inline code
 * that names nothing stays code; a web address in inline code opens beside the
 * work. Before this, all three rendered as dead text the user had to retype.
 */
import * as path from "node:path";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { toAbsolutePath } from "../../main/workspace-paths";
import type { IpcResolvedPath } from "../../shared/ipc-types";
import { useTabsStore } from "../stores/tabs";
import { useUiStore } from "../stores/ui";
import { I18nProvider } from "./i18n";
import { MarkdownRenderer } from "./markdown";
import { clearPathResolutionCache } from "./path-resolver";

const { document, window, Event, HTMLElement, Node, Element } = parseHTML("<html><body></body></html>");

const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.Element = Element;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

const ompWindow = window as unknown as { omp?: unknown };

const ON_DISK: Record<string, IpcResolvedPath> = {
	"src/app.ts": { absolutePath: "/work/src/app.ts", kind: "file", relativePath: "src/app.ts" },
};

let resolvePaths: Mock;
let openPath: Mock;
let browserOpen: Mock;
let host: globalThis.Element;
let root: Root;

async function settle(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

async function render(content: string, sourcePath?: string): Promise<void> {
	host = document.createElement("div") as unknown as globalThis.Element;
	document.body.appendChild(host as never);
	root = createRoot(host);
	await act(async () => {
		root.render(
			<I18nProvider>
				<MarkdownRenderer content={content} sourcePath={sourcePath} />
			</I18nProvider>,
		);
	});
	await settle();
}

function click(element: globalThis.Element | null, modifiers: { metaKey?: boolean } = {}): void {
	const event = new Event("click", { bubbles: true, cancelable: true });
	Object.defineProperties(event, { metaKey: { value: modifiers.metaKey ?? false }, ctrlKey: { value: false } });
	element?.dispatchEvent(event);
}

beforeEach(() => {
	resolvePaths = vi.fn(async (paths: string[]) => paths.map(path => ON_DISK[path] ?? null));
	openPath = vi.fn(async () => ({ ok: true }));
	browserOpen = vi.fn(async () => ({}));
	ompWindow.omp = {
		system: { resolvePaths, openPath, openExternal: vi.fn(async () => {}) },
		browser: { open: browserOpen },
	};
	useTabsStore.setState({
		tabs: [{ id: "t0", cwd: "/work", status: "ready", kind: "agent", unreadDone: false }],
		activeTabId: "t0",
		bundles: new Map(),
	});
});

afterEach(async () => {
	await act(async () => root.unmount());
	document.body.innerHTML = "";
	delete ompWindow.omp;
	clearPathResolutionCache();
	useTabsStore.getState().reset();
	useUiStore.setState({ filePreviewPath: null, filePreviewLine: null });
});

describe("inline code paths", () => {
	it("resolves a relative path beside the markdown file being previewed", async () => {
		await render("See `app.ts:12`.", "src/README.md");
		const link = host.querySelector('[role="link"]');
		expect(link?.textContent).toBe("app.ts:12");
		await act(async () => click(link));
		expect(useUiStore.getState()).toMatchObject({ filePreviewPath: "/work/src/app.ts", filePreviewLine: 12 });
	});

	it("opens a bare path in a reply at its line number", async () => {
		await render("请看 src/app.ts:12，修改这里。");
		const link = host.querySelector('[role="link"]');
		expect(link?.textContent).toBe("src/app.ts:12");
		await act(async () => click(link));
		expect(useUiStore.getState()).toMatchObject({ filePreviewPath: "/work/src/app.ts", filePreviewLine: 12 });
	});

	it("links a path that exists and leaves one that does not as code, in one lookup", async () => {
		await render("Edit `src/app.ts:12` and `src/gone.ts`, then run `bun run build`.");

		const links = [...host.querySelectorAll('[role="link"]')];
		expect(links.map(link => link.textContent)).toEqual(["src/app.ts:12"]);
		expect([...host.querySelectorAll("code")].map(code => code.textContent)).toEqual([
			"src/app.ts:12",
			"src/gone.ts",
			"bun run build",
		]);
		// Every candidate in the reply goes to the main process together; the
		// command is never asked about.
		expect(resolvePaths).toHaveBeenCalledTimes(1);
		expect(resolvePaths.mock.calls[0]?.[0]).toEqual(["src/app.ts", "src/gone.ts"]);
	});

	it("previews the file at the named line on click and opens it outside on ⌘-click", async () => {
		await render("See `src/app.ts:12`.");
		const link = host.querySelector('[role="link"]');

		await act(async () => click(link));
		expect(useUiStore.getState()).toMatchObject({
			filePreviewPath: "/work/src/app.ts",
			filePreviewLine: 12,
			panelTab: "files",
			panelVisible: true,
		});

		await act(async () => click(link, { metaKey: true }));
		expect(openPath).toHaveBeenCalledWith("/work/src/app.ts");
	});
});

describe("links to Windows paths", () => {
	// The main process on Windows, with its real path rules: paths resolve
	// against C:\\work, and only these files exist (matched without case, as on NTFS).
	const WINDOWS_FILES = ["E:\\ymt\\scan.js", "E:\\项目\\a b.js", "\\\\nas\\share\\doc.md", "C:\\work\\src\\app.ts"];
	function resolveOnWindows(paths: string[]): Array<IpcResolvedPath | null> {
		return paths.map(target => {
			const absolute = toAbsolutePath(target, "C:\\work", path.win32);
			if ("error" in absolute) return null;
			const exists = WINDOWS_FILES.some(file => file.toLowerCase() === absolute.path.toLowerCase());
			return exists ? { absolutePath: absolute.path, kind: "file" } : null;
		});
	}

	// Each way a reply names a file must reach the file itself. The first rows
	// read C:\\E:\\… or rendered a dead link before (issue #27).
	it.each([
		["a file URL", "[scan](file:///E:/ymt/scan.js)", "E:\\ymt\\scan.js", null],
		["a file URL naming localhost", "[scan](file://localhost/E:/ymt/scan.js)", "E:\\ymt\\scan.js", null],
		["a file URL one slash short", "[scan](file://E:/ymt/scan.js)", "E:\\ymt\\scan.js", null],
		["a drive path with backslashes", "[scan](E:\\ymt\\scan.js)", "E:\\ymt\\scan.js", null],
		["a lowercase drive with a #L anchor", "[scan](e:/ymt/scan.js#L7)", "e:\\ymt\\scan.js", 7],
		["a URL-style drive path with :line", "[scan](/E:/ymt/scan.js:7)", "E:\\ymt\\scan.js", 7],
		["a path with spaces and CJK", "[a](<E:\\项目\\a b.js>)", "E:\\项目\\a b.js", null],
		["an encoded file URL", "[a](file:///E:/%E9%A1%B9%E7%9B%AE/a%20b.js)", "E:\\项目\\a b.js", null],
		["a network share URL", "[doc](file://nas/share/doc.md)", "\\\\nas\\share\\doc.md", null],
		["a raw HTML link", '<a href="E:\\ymt\\scan.js">scan</a>', "E:\\ymt\\scan.js", null],
		["inline code with a line", "`E:\\ymt\\scan.js:7`", "E:\\ymt\\scan.js", 7],
		["inline code naming a share", "`\\\\nas\\share\\doc.md`", "\\\\nas\\share\\doc.md", null],
		["a workspace-relative link", "[app](src/app.ts)", "C:\\work\\src\\app.ts", null],
	])("%s opens the file", async (_form, content, expected, line) => {
		resolvePaths.mockImplementation(async (paths: string[]) => resolveOnWindows(paths));
		await render(content);
		const link = host.querySelector('[role="link"]');
		expect(link).not.toBeNull();
		await act(async () => click(link));
		expect(useUiStore.getState()).toMatchObject({ filePreviewPath: expected, filePreviewLine: line });
	});

	it("reads an image named by drive path from that drive, and lets no script address through", async () => {
		const readImage = vi.fn(async () => ({ ok: false, dataUrl: null, mime: null, size: 0 }));
		(ompWindow.omp as { fs?: unknown }).fs = { readImage };
		await render(
			'![shot](E:\\ymt\\shot.png) [x](javascript:alert(1)) <a href="vbscript:msgbox">y</a> <img src="javascript:alert(1)">',
		);
		const asked = readImage.mock.calls.map(call => toAbsolutePath(String((call as unknown[])[0]), null, path.win32));
		expect(asked).toEqual([{ path: "E:\\ymt\\shot.png" }]);
		expect(host.querySelector('[href^="javascript:"], [href^="vbscript:"], [role="link"]')).toBeNull();
	});
});

describe("inline code web addresses", () => {
	it("opens the address in the tab's browser panel", async () => {
		await render("The dev server is at `http://localhost:5173/`.");
		const anchor = host.querySelector("a");
		expect(anchor?.getAttribute("href")).toBe("http://localhost:5173/");

		await act(async () => click(anchor));
		expect(browserOpen).toHaveBeenCalledWith("t0", "http://localhost:5173/");
	});

	it("keeps code inside a markdown link part of that one link", async () => {
		await render("[`src/app.ts`](https://example.com/app)");
		await settle();

		expect(host.querySelectorAll("a")).toHaveLength(1);
		expect(host.querySelector('[role="link"]')).toBeNull();
		expect(resolvePaths).not.toHaveBeenCalled();
	});
});

describe("session output links", () => {
	it.each([
		"[output](local://0.log)",
		"`local://0.log`",
		"See local://0.log.",
		"[old output](artifact://42)",
		"See artifact://42.",
	])("previews %s through the native read-only route", async content => {
		const uri = content.includes("artifact://") ? "artifact://42" : "local://0.log";
		resolvePaths.mockImplementation(async (paths: string[]) =>
			paths.map(path => (path === uri ? { absolutePath: "/sessions/active/local/0.log", kind: "file" } : null)),
		);
		await render(content, "/work/README.md");
		const link = host.querySelector('[role="link"]');
		expect(link).not.toBeNull();
		await act(async () => click(link, { metaKey: true }));
		expect(useUiStore.getState().filePreviewPath).toBe(uri);
		expect(openPath).not.toHaveBeenCalled();
		expect(browserOpen).not.toHaveBeenCalled();
	});
	it.each(["local://missing.log", "local:/missing.log", "artifact:42"])(
		"does not dispatch an unresolved %s reference to an OS handler",
		async uri => {
			await render(`[missing](${uri})`);
			await act(async () => click(host.querySelector('[role="link"]'), { metaKey: true }));
			expect(useUiStore.getState().filePreviewPath).toBeNull();
			expect(openPath).not.toHaveBeenCalled();
		},
	);
});
