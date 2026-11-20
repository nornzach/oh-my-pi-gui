import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { useMessagesStore } from "../../stores/messages";
import { useSettingsStore } from "../../stores/settings";
import { useUiStore } from "../../stores/ui";
import { ThinkingBlock } from "./ThinkingBlock";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");

const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Element = Element;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

/** Structural stand-in for linkedom nodes, keeping tests decoupled from its types. */
interface TestElement {
	textContent: string | null;
	remove: () => void;
	querySelector: (selector: string) => TestElement | null;
	querySelectorAll: (selector: string) => TestElement[];
}

const HEADLINED_THINKING =
	"**Planning nested repository boundary insertion**\n\n**Clarifying .gitignore and commit boundaries**";

let container: TestElement;
let root: Root;

async function mount(element: ReactElement): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(<I18nProvider>{element}</I18nProvider>);
	});
}

async function mountExpandedThinking(text: string): Promise<void> {
	useUiStore.getState().setThinkingExpanded(true);
	await mount(<ThinkingBlock text={text} />);
}

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container?.remove();
	useSettingsStore.getState().reset();
	useMessagesStore.getState().reset();
	useUiStore.getState().setThinkingExpanded(false);
});

describe("ThinkingBlock", () => {
	it("renders reasoning markdown instead of literal syntax (TUI parity)", async () => {
		await mountExpandedThinking(HEADLINED_THINKING);

		const strongs = Array.from(document.querySelectorAll("strong")) as unknown as TestElement[];
		expect(strongs.length).toBe(2);
		expect(strongs[0]?.textContent).toBe("Planning nested repository boundary insertion");
		expect(container.textContent).not.toContain("**Planning");
	});

	it("keeps fenced code as a code block in raw mode", async () => {
		useSettingsStore.setState({ proseOnlyThinking: false });
		await mountExpandedThinking("Plan:\n\n```ts\nconst ok = true;\n```");

		expect(container.querySelector("code.language-typescript")).not.toBeNull();
		expect(container.textContent).toContain("const ok = true;");
	});

	it("elides fenced code to an ellipsis placeholder in prose-only mode", async () => {
		useSettingsStore.setState({ proseOnlyThinking: true });
		await mountExpandedThinking("Plan:\n\n```ts\nconst ok = true;\n```\n\nThen verify.");

		expect(container.textContent).toContain("Then verify.");
		expect(container.querySelector("code.language-ts")).toBeNull();
	});

	it("does not mount markdown while the live block is collapsed", async () => {
		useUiStore.getState().setThinkingExpanded(false);
		useMessagesStore.setState({ streamingThinking: HEADLINED_THINKING });
		await mount(<ThinkingBlock live />);
		expect(container.querySelector(".markdown-body")).toBeNull();
		expect(container.querySelector(".omp-thinking-body")).toBeNull();
	});

	it("formats live reasoning markdown and keeps the caret on the unfinished text", async () => {
		useUiStore.getState().setThinkingExpanded(true);
		useMessagesStore.setState({ streamingThinking: `${HEADLINED_THINKING}\n\n**核对族实例数量` });
		await mount(<ThinkingBlock live />);

		expect(container.querySelectorAll("strong")).toHaveLength(3);
		expect(container.querySelector("strong[data-omp-caret]")?.textContent).toBe("核对族实例数量");
		expect(container.textContent).not.toContain("**");
		expect(container.querySelector(".omp-thinking-pulse")).toBeNull();
	});

	it("keeps live thinking folded after its own bottom button is clicked and more text arrives", async () => {
		useUiStore.getState().setThinkingExpanded(true);
		useMessagesStore.setState({ streamingThinking: "First phase" });
		await mount(<ThinkingBlock live />);
		const footer = document.querySelector<HTMLButtonElement>(".omp-collapse-button");
		if (!footer) throw new Error("Expanded live thinking has no bottom button");
		await act(async () => footer.click());
		await act(async () => useMessagesStore.setState({ streamingThinking: "First phase continues" }));
		expect(document.querySelector(".omp-thinking-header")?.getAttribute("aria-expanded")).toBe("false");
	});
});
