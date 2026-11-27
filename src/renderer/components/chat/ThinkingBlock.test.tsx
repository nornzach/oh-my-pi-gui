import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { useMessagesStore } from "../../stores/messages";
import { useSettingsStore } from "../../stores/settings";
import { useUiStore } from "../../stores/ui";
import { ReasoningGauge } from "./ReasoningGauge";
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
	useUiStore.getState().setAutoCollapseProcess(false);
	useUiStore.getState().setTranscriptDetail("compact");
});

describe("ThinkingBlock", () => {
	it("shows a rate derived from provider-reported reasoning token deltas", async () => {
		vi.useFakeTimers({ toFake: ["performance", "setInterval", "clearInterval"] });
		try {
			await mount(<ReasoningGauge reported={1} />);
			const report = (reported: number) =>
				act(async () => {
					root.render(
						<I18nProvider>
							<ReasoningGauge reported={reported} />
						</I18nProvider>,
					);
				});
			await act(async () => vi.advanceTimersByTime(2000));
			await report(11);
			await act(async () => vi.advanceTimersByTime(500));
			expect(container.textContent).toContain("11 tokens");
			expect(container.textContent).toContain("5.0 tok/s");
			expect(container.textContent).not.toContain("≈");
			await act(async () => vi.advanceTimersByTime(5000));
			expect(container.textContent).toContain("5.0 tok/s");
		} finally {
			vi.useRealTimers();
		}
	});

	it.each([true, false])("shows no guessed count and uses reported tokens with hideThinkingBlock=%s", async hidden => {
		useSettingsStore.setState({ hideThinkingBlock: hidden });
		const store = useMessagesStore.getState();
		store.applyEvents([
			{ type: "message_start", message: { role: "assistant" } },
			{
				type: "message_update",
				message: { role: "assistant" },
				assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "abcdefgh" },
			},
		]);
		await mount(<ThinkingBlock live />);
		expect(container.querySelector(".omp-thinking-gauge")).toBeNull();
		await act(async () =>
			store.applyEvents([
				{
					type: "message_update",
					message: { role: "assistant" },
					assistantMessageEvent: {
						type: "thinking_delta",
						contentIndex: 0,
						delta: "!",
						partial: { role: "assistant", usage: { output: 99, reasoningTokens: 3 } },
					},
				},
			]),
		);
		expect(container.querySelector(".omp-thinking-gauge")?.textContent).toBe("3 tokens");
	});

	it("leaves no thinking row after hidden reasoning completes, even with reported usage", async () => {
		useSettingsStore.setState({ hideThinkingBlock: true });
		await mount(<ThinkingBlock text="Reasoning" messageReasoningTokens={7} />);
		expect(container.querySelector(".omp-thinking-block")).toBeNull();
	});

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

	it("expands live thinking and collapses finalized thinking when autoCollapseProcess is enabled (#77)", async () => {
		useUiStore.setState({ transcriptDetail: "full", thinkingExpanded: false, autoCollapseProcess: true });
		useMessagesStore.setState({ streamingThinking: "Working through the plan" });
		await mount(<ThinkingBlock live />);
		expect(document.querySelector(".omp-thinking-header")?.getAttribute("aria-expanded")).toBe("true");

		await act(async () => {
			root.render(
				<I18nProvider>
					<ThinkingBlock text="Finished reasoning" />
				</I18nProvider>,
			);
		});
		expect(document.querySelector(".omp-thinking-header")?.getAttribute("aria-expanded")).toBe("false");
	});
});
