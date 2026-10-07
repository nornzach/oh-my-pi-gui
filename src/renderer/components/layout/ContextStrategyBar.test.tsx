import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo, RpcResponse } from "../../../shared/rpc-types";
import { OVERLAY_EXIT_MS } from "../../hooks/use-overlay-presence";
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

/** The agent's live settings, as `get_settings` returns them. */
let values: Record<string, unknown> = {};
const ok = (data?: unknown): RpcResponse => ({ type: "response", command: "x", success: true, data });
const getSettings = vi.fn(async () => ok({ values }));
const setSetting = vi.fn(async (path: string, value: unknown) => {
	values = { ...values, [path]: value };
	return ok();
});
const setAutoCompaction = vi.fn(async () => ok());
const getState = vi.fn(async () => ok({}));
(window as unknown as { omp: unknown }).omp = {
	rpc: { getSettings, setSetting, setAutoCompaction, getState },
	events: { onConfigUpdate: () => () => {} },
};

const { createRoot } = await import("react-dom/client");
const { ContextStrategyBar } = await import("./ContextStrategyBar");

let container: HTMLElement;
let root: Root;

/** A vision model on the OpenAI-compatible API: no server compaction, so the defaults archive to images. */
const kimi: ModelInfo = {
	provider: "kimi-code",
	id: "k3-256k",
	name: "Kimi K3 256K",
	api: "openai-completions",
	input: ["text", "image"],
	contextWindow: 262_144,
};
const gpt: ModelInfo = {
	provider: "openai",
	id: "gpt-5.5",
	name: "GPT-5.5",
	api: "openai-responses",
	input: ["text", "image"],
	contextWindow: 400_000,
};

async function mount(model: ModelInfo): Promise<void> {
	useModelStore.setState({ model });
	useSessionStore.setState({ status: "ready", sessionId: "s1" });
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<ContextStrategyBar />
			</I18nProvider>,
		);
	});
}

async function openPopover(): Promise<void> {
	const trigger = container.querySelector("button[aria-haspopup='dialog']") as unknown as HTMLElement;
	await act(async () => trigger.click());
}

const radio = (name: string) =>
	[...document.querySelectorAll("[role='radio']")].find(node => node.textContent?.includes(name)) as unknown as
		| HTMLElement
		| undefined;

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	for (const node of [...document.querySelectorAll("[role='dialog']")]) node.remove();
	values = {};
	vi.clearAllMocks();
	useModelStore.getState().reset();
	useSessionStore.getState().reset();
	useSettingsStore.getState().reset();
	useUiStore.getState().closeSessionOverlays();
});

describe("ContextStrategyBar", () => {
	it("shows the model, the strategy and the method this model will really run", async () => {
		await mount(kimi);

		const row = container.textContent ?? "";
		expect(row).toContain("Kimi K3 256K");
		expect(row).toContain("Balanced");
		// No server compaction, reads images: the default order lands on the image archive.
		expect(row).toContain("Image archive");
		// 262,144 less the 15% reserve.
		expect(row).toContain("at 222.8k");
		// A defaults user on a model the defaults serve poorly is nudged, quietly.
		expect(container.querySelector("[role='img']")?.getAttribute("aria-label")).toContain("Preserve detail");
	});

	it("keeps the defaults for a server-compacting model without a nudge", async () => {
		await mount(gpt);

		expect(container.textContent).toContain("Server compaction");
		expect(container.querySelector("[role='img']")).toBeNull();
	});

	it("reserves its row without content until the sidecar is ready", async () => {
		useModelStore.setState({ model: kimi });
		useSessionStore.setState({ status: "starting" });
		container = document.createElement("div") as unknown as HTMLElement;
		document.body.appendChild(container as never);
		root = createRoot(container as unknown as Element);
		await act(async () => {
			root.render(
				<I18nProvider>
					<ContextStrategyBar />
				</I18nProvider>,
			);
		});

		expect(container.textContent).toBe("");
		expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
		expect(getSettings).not.toHaveBeenCalled();
	});

	it("applies a strategy as the three settings that define it, and the row follows", async () => {
		await mount(kimi);
		await openPopover();

		await act(async () => radio("Preserve detail")?.click());

		expect(setSetting.mock.calls).toEqual([
			["compaction.methodOrder", ["shake", "handoff", "soft"]],
			["compaction.keepRecentTokens", 40_000],
			["compaction.experimentalContextManagement", false],
		]);
		expect(container.textContent).toContain("Preserve detail");
		expect(container.textContent).toContain("Shake");
		// The strategy matches the recommendation now: the nudge is gone.
		expect(container.querySelector("[role='img']")).toBeNull();
	});

	it("labels a setup that matches no strategy as custom instead of picking one", async () => {
		values = { "compaction.methodOrder": ["handoff"], "compaction.keepRecentTokens": 25_000 };
		await mount(kimi);

		expect(container.textContent).toContain("Custom");
		await openPopover();
		expect(radio("Custom")?.getAttribute("aria-checked")).toBe("true");
		// Custom is a description of the current state, not something to click into.
		expect(setSetting).not.toHaveBeenCalled();
	});

	it("writes a threshold change on its own, without touching the strategy", async () => {
		await mount(kimi);
		await openPopover();

		await act(async () => radio("80%")?.click());

		expect(setSetting.mock.calls).toEqual([["compaction.thresholdPercent", 80]]);
		// 80% of 262,144.
		expect(container.textContent).toContain("at 209.7k");
	});

	it("says so, rather than naming a method, when nothing can run for the model", async () => {
		values = { "compaction.methodOrder": ["remote"] };
		await mount({ ...kimi, input: ["text"] });
		await openPopover();

		expect(container.textContent).toContain("No runnable method");
		expect(document.body.textContent).toContain("nothing will compact automatically");
	});

	it("closes on Escape and unmounts after its exit animation", async () => {
		await mount(kimi);
		await openPopover();
		expect(document.querySelector("[role='dialog']")).not.toBeNull();

		await act(async () => {
			document.dispatchEvent(Object.assign(new Event("keydown", { bubbles: true }), { key: "Escape" }));
		});
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, OVERLAY_EXIT_MS + 20));
		});
		expect(document.querySelector("[role='dialog']")).toBeNull();
	});
});
