import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo, RpcChatConfig, RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { useModelStore } from "../../stores/model";
import { useSessionStore } from "../../stores/session";
import { useSettingsStore } from "../../stores/settings";
import { useUiStore } from "../../stores/ui";

const { document, window, Event, HTMLElement, Element, Node, PointerEvent } = parseHTML("<html><body></body></html>");
Object.assign(globalThis as Record<string, unknown>, {
	document,
	window,
	Event,
	HTMLElement,
	Element,
	Node,
	PointerEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const DEFAULTS: RpcChatConfig = { systemPrompt: "", history: "continuous", historyTurns: 0 };
/** This chat's own settings, as `get_chat_config` returns them. */
let config: RpcChatConfig = DEFAULTS;
const ok = (data?: unknown): RpcResponse => ({ type: "response", command: "x", success: true, data });
const getChatConfig = vi.fn(async () => ok(config));
const setChatConfig = vi.fn(async (patch: Partial<RpcChatConfig>) => {
	config = { ...config, ...patch };
	return ok(config);
});
(window as unknown as { omp: unknown }).omp = {
	rpc: { getChatConfig, setChatConfig },
	events: { onConfigUpdate: () => () => {} },
};

const { createRoot } = await import("react-dom/client");
const { ChatContextBar } = await import("./ChatContextBar");

let container: HTMLElement;
let root: Root;

const model: ModelInfo = {
	provider: "openai",
	id: "gpt-5.5",
	name: "GPT-5.5",
	api: "openai-responses",
	input: ["text", "image"],
	contextWindow: 400_000,
};

async function mount(saved: Partial<RpcChatConfig>): Promise<void> {
	config = { ...DEFAULTS, ...saved };
	useModelStore.setState({ model });
	useSessionStore.setState({ status: "ready", sessionId: "s1" });
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<ChatContextBar />
			</I18nProvider>,
		);
	});
	const trigger = container.querySelector("button[aria-haspopup='dialog']") as unknown as HTMLElement;
	await act(async () => trigger.click());
}

const trigger = () => container.querySelector("button[aria-haspopup='dialog']")?.textContent ?? "";
const radio = (name: string) =>
	[...document.querySelectorAll("[role='radio']")].find(node => node.textContent?.trim() === name) as unknown as
		| HTMLButtonElement
		| undefined;
const radioStartingWith = (name: string) =>
	[...document.querySelectorAll("[role='radio']")].find(node => node.textContent?.startsWith(name)) as unknown as
		| HTMLButtonElement
		| undefined;
const button = (name: string) =>
	[...document.querySelectorAll("button")].find(node => node.textContent?.trim() === name) as unknown as
		| HTMLButtonElement
		| undefined;

/** Set the controlled prompt box's value and drive its React onChange. */
async function typePrompt(text: string): Promise<void> {
	const box = document.querySelector("[role='dialog'] textarea") as unknown as HTMLTextAreaElement;
	box.value = text;
	const props = Object.getOwnPropertyNames(box).find(key => key.startsWith("__reactProps$"));
	const onChange = (box as unknown as Record<string, { onChange: (event: object) => void }>)[props ?? ""].onChange;
	await act(async () => onChange({ target: box, currentTarget: box }));
}

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	for (const node of [...document.querySelectorAll("[role='dialog']")]) node.remove();
	config = DEFAULTS;
	vi.clearAllMocks();
	useModelStore.getState().reset();
	useSessionStore.getState().reset();
	useSettingsStore.getState().reset();
	useUiStore.getState().closeSessionOverlays();
});

describe("ChatContextBar", () => {
	it("switches a single-turn chat back to the depth it had", async () => {
		await mount({ history: "single", historyTurns: 3 });
		expect(trigger()).toContain("Single turn");
		// Depth only applies to a continuous chat.
		expect(radio("3")?.disabled).toBe(true);

		await act(async () => radioStartingWith("Continuous")?.click());

		expect(setChatConfig.mock.calls).toEqual([[{ history: "continuous" }]]);
		expect(trigger()).toContain("Last 3 turns");
	});

	it("limits a continuous chat to a depth, and All lifts the limit", async () => {
		await mount({});
		expect(trigger()).toContain("All turns");

		await act(async () => radio("1")?.click());
		expect(trigger()).toContain("Last turn");

		await act(async () => radio("All")?.click());
		expect(setChatConfig.mock.calls).toEqual([[{ historyTurns: 1 }], [{ historyTurns: 0 }]]);
		expect(trigger()).toContain("All turns");
	});

	it("saves an edited system prompt, and Use default clears it", async () => {
		await mount({});
		expect(trigger()).not.toContain("Custom system prompt");

		await typePrompt("Answer like a ship's cook.");
		await act(async () => button("Save")?.click());
		expect(setChatConfig.mock.calls).toEqual([[{ systemPrompt: "Answer like a ship's cook." }]]);
		expect(trigger()).toContain("Custom system prompt");

		await act(async () => button("Use default")?.click());
		expect(setChatConfig.mock.calls.at(-1)).toEqual([{ systemPrompt: "" }]);
		expect(trigger()).not.toContain("Custom system prompt");
	});
});
