import { parseHTML } from "linkedom";
import type { ReactElement } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { useToolsStore } from "../../stores/tools";
import { useUiStore } from "../../stores/ui";
import { ToolCard } from "./ToolCard";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Element = Element;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;

function call(id: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name: "read", arguments: { path: `${id}.ts` } }],
		timestamp: 1_000,
	};
}

async function renderCards(ids: string[]): Promise<{ root: Root; container: HTMLElement }> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const cards: ReactElement[] = ids.map(id => (
		<ToolCard key={id} toolCallId={id} toolName="read" args={{ path: `${id}.ts` }} />
	));
	await act(async () => {
		root.render(<I18nProvider>{cards}</I18nProvider>);
	});
	return { root, container };
}

afterEach(() => {
	useToolsStore.getState().reset();
	useUiStore.setState({ toolsExpandAll: { expanded: false, seq: 0 } });
	vi.restoreAllMocks();
});

describe("ToolCard terminal states", () => {
	it("marks a call that never returned as interrupted instead of running", async () => {
		useToolsStore.getState().hydrateMessages([call("dead")]);
		useUiStore.getState().toggleToolsExpandAll();
		const { root, container } = await renderCards(["dead"]);

		expect(container.innerHTML).toContain('data-tool-status="aborted"');
		expect(container.innerHTML).not.toContain("animate-spin");
		expect(container.innerHTML).toContain("Interrupted");
		// The specialized read renderer would claim "No content" for a result
		// that never arrived.
		expect(container.innerHTML).not.toContain("No content");

		await act(async () => root.unmount());
	});

	it("shares a single clock between live cards and keeps none for finished ones", async () => {
		useToolsStore.getState().hydrateMessages([call("dead")]);
		useToolsStore.getState().applyEvents([
			{ type: "tool_execution_start", toolCallId: "live-a", toolName: "read", args: {} },
			{ type: "tool_execution_start", toolCallId: "live-b", toolName: "read", args: {} },
		]);
		const ticker = vi.spyOn(globalThis, "setInterval");

		const finished = await renderCards(["dead"]);
		expect(ticker).not.toHaveBeenCalled();
		await act(async () => finished.root.unmount());

		const oneLive = await renderCards(["live-a"]);
		expect(ticker).toHaveBeenCalledTimes(1);

		const twoLive = await renderCards(["live-a", "live-b"]);
		expect(twoLive.container.innerHTML.match(/animate-spin/g)).toHaveLength(2);
		expect(ticker).toHaveBeenCalledTimes(1);

		await act(async () => {
			oneLive.root.unmount();
			twoLive.root.unmount();
		});
		// Every subscriber released it, so the next live card starts a fresh one.
		const relive = await renderCards(["live-a"]);
		expect(ticker).toHaveBeenCalledTimes(2);
		await act(async () => relive.root.unmount());
		ticker.mockRestore();
	});
});
