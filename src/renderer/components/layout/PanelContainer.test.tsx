/**
 * PanelContainer chat filter: a tool-free chat tab renders only the files
 * drawer tab (diffs can't exist without tools); an agent tab also gets
 * diff. Logs live in their own dialog, never in the drawer. Todo/plan/agents/queue moved to the center dock — they must not
 * appear here. Same linkedom + react-dom harness as mode-visibility.test.tsx.
 */

import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import { useSessionStore } from "../../stores/session";
import { useTabsStore } from "../../stores/tabs";
import { useUiStore } from "../../stores/ui";
import { PanelContainer } from "./PanelContainer";

// xterm's bundle (the Terminal view) reads `self` when it loads, before any test code runs.
vi.hoisted(() => {
	(globalThis as Record<string, unknown>).self = globalThis;
});

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");

const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);
const ompWindow = window as unknown as { omp?: unknown };
const initialOmp = ompWindow.omp;

interface TestElement {
	textContent: string | null;
	remove: () => void;
}

let container: TestElement;
let root: Root;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

async function mount(element: ReactElement): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(<I18nProvider>{element}</I18nProvider>);
	});
	await flush();
}

afterEach(async () => {
	if (root) {
		await act(async () => {
			root.unmount();
		});
	}
	container?.remove();
	useSessionStore.getState().reset();
	useTabsStore.getState().reset();
	useUiStore.setState({ panelTab: "files", panelVisible: true, filePreviewPath: null, filePreviewLine: null });
	if (initialOmp === undefined) delete ompWindow.omp;
	else ompWindow.omp = initialOmp;
	Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
});

function seedActiveTab(kind: "agent" | "chat"): void {
	useTabsStore.setState({
		tabs: [{ id: "t0", cwd: "/work", status: "ready", kind, unreadDone: false }],
		activeTabId: "t0",
		bundles: new Map(),
	});
}

function drawerTabLabels(): string[] {
	return [...document.querySelectorAll("aside button")].map(button => (button.textContent ?? "").trim());
}

function dispatchPointer(element: Element, type: string, clientX: number): void {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperties(event, {
		clientX: { value: clientX },
		pointerId: { value: 1 },
	});
	element.dispatchEvent(event);
}

function FileLinkHarness({ content = "[report](docs/report.md)" }: { content?: string }) {
	const panelVisible = useUiStore(s => s.panelVisible);
	return (
		<>
			<MarkdownRenderer content={content} />
			{panelVisible && <PanelContainer />}
		</>
	);
}

describe("PanelContainer chat tab filter", () => {
	it("renders the side questions and files tabs in a chat tab", async () => {
		seedActiveTab("chat");
		useUiStore.setState({ panelTab: "files", panelVisible: true });
		await mount(<PanelContainer />);

		const labels = drawerTabLabels();
		expect(labels).toContain("Files");
		expect(labels).toContain("Side questions");
		// Agents, diff, shells, and browsing need tools; todo/plan/queue live in the center dock.
		for (const agentOnly of ["Agents", "Changes", "Terminal", "Browser"]) {
			expect(labels).not.toContain(agentOnly);
		}
	});

	it("falls back to the files surface when the agent-only diff tab was selected before entering chat", async () => {
		seedActiveTab("chat");
		useUiStore.setState({ panelTab: "diff", panelVisible: true });
		await mount(<PanelContainer />);

		expect(document.querySelector('button[aria-label="Refresh file tree"]')).not.toBeNull();
	});

	it("renders all drawer tabs in an agent tab", async () => {
		seedActiveTab("agent");
		useUiStore.setState({ panelTab: "files", panelVisible: true });
		await mount(<PanelContainer />);

		const labels = drawerTabLabels();
		for (const visible of ["Agents", "Side questions", "Changes", "Files", "Terminal", "Browser"]) {
			expect(labels).toContain(visible);
		}
		// Live-execution tabs moved to the center dock, logs to their own dialog.
		for (const moved of ["Todo", "Plan", "Queue", "Logs"]) {
			expect(labels).not.toContain(moved);
		}
	});

	it("brings a tab opened from elsewhere into view in a strip too narrow to show them all", async () => {
		seedActiveTab("agent");
		useUiStore.setState({ panelTab: "overview", panelVisible: true });
		const scrolledTo: string[] = [];
		const proto = HTMLElement.prototype as unknown as { scrollIntoView?: (this: HTMLElement) => void };
		const original = proto.scrollIntoView;
		proto.scrollIntoView = function () {
			scrolledTo.push(this.getAttribute("title") ?? "");
		};
		try {
			await mount(<PanelContainer />);
			scrolledTo.length = 0;
			await act(async () => {
				useUiStore.getState().setPanelTab("browser");
			});
			await flush();
			expect(scrolledTo).toEqual(["Browser"]);
		} finally {
			if (original) proto.scrollIntoView = original;
			else delete proto.scrollIntoView;
		}
	});

	it("uses the available window width instead of a fixed narrow drawer", async () => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: 2400 });
		seedActiveTab("agent");
		await mount(<PanelContainer />);

		expect((document.querySelector("aside") as HTMLElement | null)?.style.width).toBe("672px");
	});

	it("resizes from the window edge in both directions without snapping closed", async () => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
		seedActiveTab("agent");
		await mount(<PanelContainer />);

		const aside = document.querySelector("aside") as HTMLElement;
		const separator = document.querySelector('[role="separator"]') as HTMLElement & {
			setPointerCapture: (pointerId: number) => void;
		};
		separator.setPointerCapture = vi.fn();

		await act(async () => {
			dispatchPointer(separator, "pointerdown", 1037);
			dispatchPointer(separator, "pointermove", 900);
		});
		expect(aside.style.width).toBe("540px");

		await act(async () => {
			dispatchPointer(separator, "pointermove", 1000);
			dispatchPointer(separator, "pointerup", 1000);
		});
		expect(aside.style.width).toBe("440px");
		expect(useUiStore.getState().panelVisible).toBe(true);
	});

	it("opens a local markdown link inside the Files drawer", async () => {
		seedActiveTab("agent");
		useUiStore.setState({ panelVisible: false, filePreviewPath: null });
		const read = vi.fn(async () => ({
			ok: true,
			content: "# Preview heading\n\nRendered body.",
			truncated: false,
			binary: false,
			size: 34,
		}));
		ompWindow.omp = {
			fs: {
				list: vi.fn(async () => ({ ok: true, entries: [], truncated: false })),
				read,
			},
			system: {
				openExternal: vi.fn(async () => {}),
				openPath: vi.fn(async () => ({ ok: true })),
			},
		};
		await mount(<FileLinkHarness />);

		await act(async () => {
			document
				.querySelector(`[role="link"]`)
				?.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
		});
		await flush();

		expect(useUiStore.getState()).toMatchObject({
			panelVisible: true,
			panelTab: "files",
			filePreviewPath: "docs/report.md",
		});
		expect(read).toHaveBeenCalledWith("docs/report.md", 200_000);
		expect(document.querySelector("aside h1")?.textContent).toBe("Preview heading");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it("decodes an absolute file URL and renders non-Markdown text as code", async () => {
		seedActiveTab("agent");
		useUiStore.setState({ panelVisible: false, filePreviewPath: null });
		const read = vi.fn(async () => ({
			ok: true,
			content: "SELECT 1;",
			truncated: false,
			binary: false,
			size: 9,
		}));
		ompWindow.omp = {
			fs: {
				list: vi.fn(async () => ({ ok: true, entries: [], truncated: false })),
				read,
			},
			system: {
				openExternal: vi.fn(async () => {}),
				openPath: vi.fn(async () => ({ ok: true })),
			},
		};
		await mount(<FileLinkHarness content="[sql](file:///tmp/my%20query.sql)" />);

		await act(async () => {
			document
				.querySelector(`[role="link"]`)
				?.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
		});
		await flush();

		expect(read).toHaveBeenCalledWith("/tmp/my query.sql", 200_000);
		expect(document.querySelector("aside pre")?.textContent).toContain("SELECT 1;");
	});

	it("opens a Markdown link that names a line as source with that line marked", async () => {
		seedActiveTab("agent");
		useUiStore.setState({ panelVisible: false, filePreviewPath: null });
		ompWindow.omp = {
			fs: {
				list: vi.fn(async () => ({ ok: true, entries: [], truncated: false })),
				read: vi.fn(async () => ({
					ok: true,
					content: "# Title\n\nIntro.\n\n## Usage\n",
					truncated: false,
					binary: false,
					size: 30,
				})),
			},
			system: {
				openExternal: vi.fn(async () => {}),
				openPath: vi.fn(async () => ({ ok: true })),
			},
		};
		await mount(<FileLinkHarness content="[usage](docs/guide.md#L5)" />);

		await act(async () => {
			document
				.querySelector(`[role="link"]`)
				?.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
		});
		await flush();

		// Rendered prose has no line 5 to land on; the source does.
		expect(document.querySelector("aside h1")).toBeNull();
		expect(document.querySelector("aside pre")?.textContent).toContain("## Usage");
		expect(document.querySelector("aside [data-marked]")?.textContent).toBe("5");
	});
});
