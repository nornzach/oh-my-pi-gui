import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { RpcContextReportResult, RpcResponse } from "../../../shared/rpc-types";
import { OVERLAY_EXIT_MS } from "../../hooks/use-overlay-presence";
import { I18nProvider } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";

const reportWithoutWindow: RpcContextReportResult = {
	contextWindow: 0,
	model: "mimo-v2.6-pro",
	breakdown: {
		anchored: false,
		contextWindow: 0,
		usedTokens: 16_000,
		systemPromptTokens: 1_000,
		systemContextTokens: 200,
		systemToolsTokens: 6_400,
		skillsTokens: 300,
		messagesTokens: 8_100,
	},
};

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

const report: RpcContextReportResult = {
	contextWindow: 1_000_000,
	model: "test-model",
	breakdown: {
		anchored: true,
		contextWindow: 1_000_000,
		usedTokens: 161_900,
		systemPromptTokens: 1_000,
		systemContextTokens: 200,
		systemToolsTokens: 6_400,
		skillsTokens: 300,
		messagesTokens: 154_000,
	},
};

const getContextReport: Mock<() => Promise<RpcResponse>> = vi.fn(async () => ({
	type: "response",
	command: "get_context_report",
	success: true,
	data: report,
}));
(window as unknown as { omp: { rpc: { getContextReport: typeof getContextReport } } }).omp = {
	rpc: { getContextReport },
};

const { createRoot } = await import("react-dom/client");
const { ContextUsagePopover } = await import("./ContextUsagePopover");

let container: HTMLElement;
let root: Root;

async function mount(): Promise<void> {
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<ContextUsagePopover />
			</I18nProvider>,
		);
	});
}

/** Past the exit-animation hold, when a closed overlay is finally unmounted. */
async function settleExit(): Promise<void> {
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, OVERLAY_EXIT_MS + 20));
	});
}

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	getContextReport.mockReset();
	useSessionStore.getState().reset();
});

describe("ContextUsagePopover", () => {
	it("keeps the measured reading visible when Core has no capacity for the model", async () => {
		// A host whose model list omits window metadata leaves Core with a locally
		// measured token count and no denominator. Collapsing the control to a bare
		// em dash hides the one number that is known and reads as a broken feature.
		getContextReport.mockResolvedValueOnce({
			type: "response",
			command: "get_context_report",
			success: true,
			data: reportWithoutWindow,
		} satisfies RpcResponse);
		useSessionStore.setState({
			contextUsage: { contextWindow: 0, percent: 0, tokens: 16_000 },
			sessionId: "unknown-window",
			status: "ready",
		});
		await mount();

		const trigger = container.querySelector("button") as unknown as HTMLButtonElement;
		expect(trigger.textContent).toBe("16.0k");
		expect(trigger.getAttribute("aria-label")).toBe("Context window unknown");
		expect(container.textContent).not.toContain("0%");

		await act(async () => trigger.click());
		expect(getContextReport).toHaveBeenCalledTimes(1);
		const dialog = document.querySelector("#omp-context-usage-popover");
		expect(dialog?.textContent).toContain("Context window");
		expect(dialog?.textContent).toContain("Conversation messages~8.1k");
		// Shares of a window that does not exist would be invented numbers.
		expect(dialog?.textContent).not.toContain("%");
		// A bar filled with the used tokens alone reads as "full", so the
		// capacity-relative gauge is withheld rather than repurposed.
		expect(dialog?.querySelector('[role="progressbar"], [role="img"]')).toBeNull();
		expect(dialog?.textContent).toContain("Context window unknown");
	});

	it("keeps context usage to one control and reveals the native three-category breakdown", async () => {
		useSessionStore.setState({
			contextUsage: { contextWindow: 1_000_000, percent: 16.19, tokens: 161_900 },
			sessionId: "session-1",
			status: "ready",
		});
		await mount();

		const trigger = container.querySelector("button") as unknown as HTMLButtonElement;
		expect(trigger.getAttribute("aria-label")).toBe("Show context usage, 16% used");
		expect(trigger.textContent).toContain("161.9k/1.0M");
		expect(document.querySelector("#omp-context-usage-popover")).toBeNull();

		await act(async () => trigger.click());
		expect(getContextReport).toHaveBeenCalledTimes(1);
		// A pinned popover must not pose as a modal: App.tsx suppresses every
		// non-overlay-safe chord (⌘N, ⌘W, ⇧Tab) while [role=dialog] is in the tree.
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		const dialog = document.querySelector("#omp-context-usage-popover");
		expect(dialog?.textContent).toContain("Context used 16%");
		expect(dialog?.textContent).toContain("~161.9k / 1.0M");
		expect(dialog?.textContent).toContain("Context remaining838.1k");
		expect(dialog?.textContent).toContain("System context~1.5k");
		expect(dialog?.textContent).toContain("Tools~6.4k");
		expect(dialog?.textContent).toContain("Conversation messages~154.0k");
		expect(dialog?.querySelector('[role="progressbar"]')).not.toBeNull();
	});

	it("renders nothing until the session reports context usage", async () => {
		await mount();
		expect(container.childElementCount).toBe(0);
		expect(getContextReport).not.toHaveBeenCalled();
	});

	it("reveals the same breakdown on hover without pinning a modal", async () => {
		useSessionStore.setState({
			contextUsage: { contextWindow: 100_000, percent: 10, tokens: 10_000 },
			sessionId: "session-hover",
			status: "ready",
		});
		await mount();

		await act(async () => {
			container.querySelector("button")?.dispatchEvent(new Event("mouseover", { bubbles: true }));
		});
		expect(document.querySelector("#omp-context-usage-popover")).not.toBeNull();
		expect(getContextReport).toHaveBeenCalledTimes(1);
	});

	it("closes a pinned popover from its trigger, Escape, and an outside pointer", async () => {
		useSessionStore.setState({
			contextUsage: { contextWindow: 1_000_000, percent: 16.19, tokens: 161_900 },
			sessionId: "session-close",
			status: "ready",
		});
		await mount();
		const trigger = container.querySelector("button") as unknown as HTMLButtonElement;

		await act(async () => trigger.click());
		expect(document.querySelector("#omp-context-usage-popover")).not.toBeNull();
		await act(async () => trigger.click());
		// The exit animation holds the element mounted for one more phase, so
		// "closed" is the honest assertion here: released ARIA state, the popover
		// hidden from assistive tech, and no unmount until the animation ends.
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(document.querySelector("#omp-context-usage-popover")?.getAttribute("aria-hidden")).toBe("true");
		await settleExit();
		expect(document.querySelector("#omp-context-usage-popover")).toBeNull();

		await act(async () => trigger.click());
		const escapeEvent = new Event("keydown", { bubbles: true, cancelable: true });
		Object.defineProperty(escapeEvent, "key", { value: "Escape" });
		await act(async () => document.dispatchEvent(escapeEvent));
		expect(document.querySelector("#omp-context-usage-popover")?.getAttribute("aria-hidden")).toBe("true");
		await settleExit();
		expect(document.querySelector("#omp-context-usage-popover")).toBeNull();
		// App.tsx aborts the active turn on an unclaimed Escape, so the popover has
		// to claim the keypress it consumed.
		expect(escapeEvent.defaultPrevented).toBe(true);

		await act(async () => trigger.click());
		await act(async () => document.dispatchEvent(new Event("pointerdown", { bubbles: true })));
		expect(document.querySelector("#omp-context-usage-popover")?.getAttribute("aria-hidden")).toBe("true");
		await settleExit();
		expect(document.querySelector("#omp-context-usage-popover")).toBeNull();
	});

	it("keeps the current total visible when the detailed report is unavailable", async () => {
		getContextReport.mockRejectedValueOnce(new Error("sidecar unavailable"));
		useSessionStore.setState({
			contextUsage: { contextWindow: 272_000, percent: 64, tokens: 173_700 },
			sessionId: "session-fallback",
			status: "ready",
		});
		await mount();

		await act(async () => (container.querySelector("button") as unknown as HTMLButtonElement).click());
		const dialog = document.querySelector("#omp-context-usage-popover");
		expect(dialog?.textContent).toContain("Context used 64%");
		expect(dialog?.textContent).toContain("~173.7k / 272.0k");
		expect(dialog?.textContent).toContain("The detailed breakdown is temporarily unavailable.");
	});
});
