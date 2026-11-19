/**
 * Contracts for the right-click menu on links, file paths, and selected text.
 * The failure modes: a link the user can neither open where they want nor
 * copy, a folder "previewed" as if it were a file, and selected reply text
 * with no way to copy it (Electron shows no menu of its own there).
 */
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { IpcResolvedPath } from "../../../shared/ipc-types";
import { I18nProvider } from "../../lib/i18n";
import { useTabsStore } from "../../stores/tabs";
import { useUiStore } from "../../stores/ui";
import type { ContextMenuItem } from "./ContextMenu";
import { LinkMenuHost, linkMenuItems } from "./LinkMenu";

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
Object.defineProperties(window, { innerWidth: { value: 1440 }, innerHeight: { value: 900 } });

const ompWindow = window as unknown as { omp?: unknown; getSelection?: unknown };
const t = (key: string) => key;

let openExternal: Mock;
let openPath: Mock;
let writeText: Mock;
let root: Root | null = null;

function rightClick(): Event {
	const event = new Event("contextmenu", { bubbles: true, cancelable: true });
	Object.defineProperties(event, { clientX: { value: 40 }, clientY: { value: 60 } });
	return event;
}

function seedActiveTab(kind: "agent" | "chat"): void {
	useTabsStore.setState({
		tabs: [{ id: "t0", cwd: "/work", status: "ready", kind, unreadDone: false }],
		activeTabId: "t0",
		bundles: new Map(),
	});
}

function select(items: ContextMenuItem[], id: string): void {
	const item = items.find(entry => entry.id === id);
	if (!item) throw new Error(`no menu item ${id}`);
	item.onSelect();
}

async function settle(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

beforeEach(() => {
	openExternal = vi.fn(async () => {});
	openPath = vi.fn(async () => ({ ok: true }));
	writeText = vi.fn(async () => {});
	ompWindow.omp = {
		system: { openExternal, openPath, revealPath: vi.fn(async () => ({ ok: true })) },
		browser: { open: vi.fn(async () => ({})) },
	};
	vi.stubGlobal("navigator", { platform: "MacIntel", clipboard: { writeText } });
	seedActiveTab("agent");
});

afterEach(async () => {
	if (root) {
		await act(async () => root?.unmount());
		root = null;
	}
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
	delete ompWindow.omp;
	delete ompWindow.getSelection;
	useTabsStore.getState().reset();
	useUiStore.setState({ filePreviewPath: null, filePreviewLine: null });
});

describe("linkMenuItems for web links", () => {
	it("offers the browser panel only where the tab has one, and copy for every link", () => {
		const url = { target: { kind: "url" as const, url: "https://example.com/docs" }, selection: "" };
		expect(linkMenuItems(url, t).map(item => item.id)).toEqual(["open-panel", "open-external", "copy-link"]);

		seedActiveTab("chat");
		expect(linkMenuItems(url, t).map(item => item.id)).toEqual(["open-external", "copy-link"]);

		const mail = { target: { kind: "url" as const, url: "mailto:team@example.com" }, selection: "" };
		expect(linkMenuItems(mail, t).map(item => item.id)).toEqual(["copy-link"]);
	});

	it("sends the link to the system browser even from an agent tab, and copies it", async () => {
		const items = linkMenuItems({ target: { kind: "url", url: "https://example.com/docs" }, selection: "" }, t);
		select(items, "open-external");
		select(items, "copy-link");
		await settle();

		expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
		expect(writeText).toHaveBeenCalledWith("https://example.com/docs");
	});
});

describe("linkMenuItems for file paths", () => {
	const file: IpcResolvedPath = {
		absolutePath: "/work/src/app.ts",
		kind: "file",
		relativePath: "src/app.ts",
	};

	it("previews the resolved file at the referenced line and copies either path form", async () => {
		const items = linkMenuItems(
			{ target: { kind: "path", target: { path: "src/app.ts", line: 12 }, resolved: file }, selection: "" },
			t,
		);
		expect(items.map(item => item.id)).toEqual([
			"preview",
			"open-default",
			"reveal",
			"copy-path",
			"copy-relative-path",
		]);

		select(items, "preview");
		expect(useUiStore.getState()).toMatchObject({ filePreviewPath: "/work/src/app.ts", filePreviewLine: 12 });

		select(items, "copy-path");
		select(items, "copy-relative-path");
		await settle();
		expect(writeText.mock.calls).toEqual([["/work/src/app.ts"], ["src/app.ts"]]);
	});

	it("opens a folder in the file manager rather than previewing it", async () => {
		const folder: IpcResolvedPath = { absolutePath: "/work/src", kind: "directory", relativePath: "src" };
		const items = linkMenuItems(
			{ target: { kind: "path", target: { path: "src" }, resolved: folder }, selection: "" },
			t,
		);
		expect(items.map(item => item.id)).not.toContain("preview");
		expect(items.find(item => item.id === "open-default")?.label).toBe("links.openFolder");

		select(items, "open-default");
		await settle();
		expect(openPath).toHaveBeenCalledWith("/work/src");
	});

	it("omits the relative form for a path outside the workspace", () => {
		const outside: IpcResolvedPath = { absolutePath: "/tmp/report.txt", kind: "file" };
		const items = linkMenuItems(
			{ target: { kind: "path", target: { path: "/tmp/report.txt" }, resolved: outside }, selection: "" },
			t,
		);
		expect(items.map(item => item.id)).not.toContain("copy-relative-path");
	});

	it("offers only Copy path for a path with nothing on disk", () => {
		const items = linkMenuItems(
			{ target: { kind: "path", target: { path: "/work/old.ts" }, resolved: null }, selection: "" },
			t,
		);
		expect(items.map(item => item.id)).toEqual(["copy-path"]);
	});
});

describe("selected text", () => {
	it("puts Copy first and copies the selection, not the link", async () => {
		const items = linkMenuItems({ target: { kind: "url", url: "https://example.com" }, selection: "the docs" }, t);
		expect(items[0]?.id).toBe("copy");
		select(items, "copy");
		await settle();
		expect(writeText).toHaveBeenCalledWith("the docs");
	});

	it("shows Copy on a right-click over selected reply text but leaves text fields their own menu", async () => {
		ompWindow.getSelection = () => ({ isCollapsed: false, toString: () => "picked text" });
		const host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host as unknown as globalThis.Element);
		await act(async () => {
			root?.render(
				<I18nProvider>
					<LinkMenuHost />
				</I18nProvider>,
			);
		});

		const field = document.createElement("textarea");
		document.body.appendChild(field);
		const inField = rightClick();
		await act(async () => {
			field.dispatchEvent(inField);
		});
		expect(inField.defaultPrevented).toBe(false);
		expect(document.querySelector('[role="menu"]')).toBeNull();

		const prose = document.createElement("p");
		document.body.appendChild(prose);
		const onProse = rightClick();
		await act(async () => {
			prose.dispatchEvent(onProse);
		});
		await settle();
		expect(onProse.defaultPrevented).toBe(true);
		const labels = [...document.querySelectorAll('[role="menuitem"]')].map(item => (item.textContent ?? "").trim());
		expect(labels).toEqual(["Copy"]);
	});
});

it("keeps session output preview and copy inside the app without external actions", () => {
	const items = linkMenuItems(
		{
			target: {
				kind: "path",
				target: { path: "local://0.log" },
				resolved: { absolutePath: "/sessions/active/local/0.log", kind: "file" },
			},
			selection: "",
		},
		t,
	);
	expect(items.map(item => item.id)).toEqual(["preview", "copy-path"]);
	select(items, "preview");
	expect(useUiStore.getState().filePreviewPath).toBe("local://0.log");
	expect(openPath).not.toHaveBeenCalled();
});
