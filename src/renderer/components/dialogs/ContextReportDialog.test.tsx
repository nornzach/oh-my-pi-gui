/**
 * Context report dialog contract: the breakdown Core computes locally must stay
 * readable even when the host publishes no context window for the model.
 * Same linkedom harness as the other dialog tests (no jsdom in this repo).
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcContextReportResult, RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { useUiStore } from "../../stores/ui";

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

const breakdown = {
	anchored: false,
	contextWindow: 0,
	messagesTokens: 8_100,
	skillsTokens: 300,
	systemContextTokens: 200,
	systemPromptTokens: 1_000,
	systemToolsTokens: 6_400,
	usedTokens: 16_000,
};

const getContextReport = vi.fn<() => Promise<RpcResponse>>();
(window as unknown as { omp: { rpc: { getContextReport: typeof getContextReport } } }).omp = {
	rpc: { getContextReport },
};

const { createRoot } = await import("react-dom/client");
const { ContextReportDialog } = await import("./ContextReportDialog");

let container: InstanceType<typeof HTMLElement>;
let root: Root;

async function mount(): Promise<void> {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root.render(
			<I18nProvider>
				<ContextReportDialog />
			</I18nProvider>,
		);
	});
}

async function openWith(data: RpcContextReportResult): Promise<void> {
	getContextReport.mockResolvedValue({ command: "get_context_report", data, success: true, type: "response" });
	useUiStore.getState().openContextReport();
	await mount();
	await act(async () => {
		await Promise.resolve();
	});
}

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	getContextReport.mockReset();
	useUiStore.getState().closeContextReport();
});

describe("ContextReportDialog", () => {
	it("lists the measured categories when Core has no window for the model", async () => {
		await openWith({ breakdown, contextWindow: 0, model: "mimo-v2.6-pro" });
		const text = document.body.textContent ?? "";
		// The old empty state claimed no model was selected; the session has one.
		expect(text).not.toContain("no model is selected");
		expect(text).toContain("Messages");
		expect(text).toContain("16.0k tokens used");
		// Shares of a window that does not exist would be invented numbers.
		expect(text).not.toContain("%");
		expect(text).not.toContain("Free");
	});

	it("sizes categories against the window when Core knows it", async () => {
		await openWith({
			breakdown: { ...breakdown, contextWindow: 32_000 },
			contextWindow: 32_000,
			model: "known-model",
		});
		const text = document.body.textContent ?? "";
		expect(text).toContain("16.0k / 32.0k tokens (50% used)");
		expect(text).toContain("Free");
	});
});
