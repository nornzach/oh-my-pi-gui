import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage, SessionStats } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { TokenMeterPopover } from "./TokenMeterPopover";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;

const stats: SessionStats = {
	sessionId: "s1",
	userMessages: 1,
	assistantMessages: 1,
	toolCalls: 0,
	toolResults: 0,
	totalMessages: 2,
	tokens: { input: 256_000, output: 16_000, reasoning: 55_000, cacheRead: 2_700_000, cacheWrite: 0, total: 3_000_000 },
	premiumRequests: 0,
	cost: 0.089,
	contextUsage: { tokens: 3_000_000, contextWindow: 4_000_000, percent: 75 },
};

const messages: AgentMessage[] = [
	{
		role: "assistant",
		content: [],
		timestamp: 1,
		usage: { input: 10, output: 200, cacheRead: 0, cacheWrite: 0, cost: { total: 0.0063 } },
		duration: 2000,
		ttft: 1800,
	} as AgentMessage,
];

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(onClose: () => void, anchorRef?: { current: HTMLElement | null }): Promise<void> {
	host = document.createElement("div");
	document.body.appendChild(host as never);
	root = createRoot(host as unknown as Element);
	await act(async () => {
		root?.render(
			<I18nProvider>
				<TokenMeterPopover
					anchor={{ x: 8, y: 40 }}
					anchorRef={anchorRef}
					isStreaming={false}
					messages={messages}
					onClose={onClose}
					stats={stats}
				/>
			</I18nProvider>,
		);
	});
}

afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	host?.remove();
	root = null;
	host = null;
	document.body.innerHTML = "";
});

describe("TokenMeterPopover", () => {
	it("prints the session token grid and cost economics from committed stats", async () => {
		await mount(() => {});
		const body = document.body.textContent ?? "";

		expect(body).toContain("Token Meter");
		expect(body).toContain("Cache hit");
		expect(body).toContain("91.3%");
		expect(body).toContain("TTFT");
		expect(body).toContain("1.8s");
		expect(body).toContain("0.089");
		expect(body).toContain("0.0063");
		expect(body).toContain("/1M");
		expect(body).toContain("100 t/s");
	});

	it("closes on Escape and claims the keystroke so the running turn is not aborted", async () => {
		const onClose = vi.fn();
		await mount(onClose);

		await act(async () => {
			document.dispatchEvent(new Event("keydown", { bubbles: true }) as never);
		});
		expect(onClose).not.toHaveBeenCalled();

		const escapeKey = new Event("keydown", { bubbles: true, cancelable: true });
		Object.defineProperty(escapeKey, "key", { value: "Escape" });
		await act(async () => {
			document.dispatchEvent(escapeKey);
		});
		expect(onClose).toHaveBeenCalledTimes(1);
		// App.tsx aborts the active turn on an Escape nobody prevented.
		expect(escapeKey.defaultPrevented).toBe(true);
	});

	it("closes on an outside pointerdown, but not on the panel or the readout that opened it", async () => {
		const onClose = vi.fn();
		const anchor = document.createElement("button");
		document.body.appendChild(anchor as never);
		await mount(onClose, { current: anchor as unknown as HTMLElement });
		const panel = document.querySelector('[role="dialog"]');

		await act(async () => {
			panel?.dispatchEvent(new Event("pointerdown", { bubbles: true }) as never);
		});
		expect(onClose).not.toHaveBeenCalled();

		// The readout toggles the panel on click; dismissing on its pointerdown
		// would reopen it in the same gesture.
		await act(async () => {
			anchor.dispatchEvent(new Event("pointerdown", { bubbles: true }) as never);
		});
		expect(onClose).not.toHaveBeenCalled();

		await act(async () => {
			document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }) as never);
		});
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
