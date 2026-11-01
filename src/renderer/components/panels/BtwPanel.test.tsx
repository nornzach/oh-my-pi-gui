/**
 * Side-questions drawer against the wire protocol: `get_btw_history` fills the
 * topic list, selecting a topic shows its whole thread, the composer sends a
 * follow-up with the selected record id (or a new topic without one), and a
 * running answer offers Stop. Same linkedom harness as the other panels.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BtwHistoryRecord, RpcCommand, RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider, translate } from "../../lib/i18n";
import { useBtwStore } from "../../stores/btw";
import { BtwPanel } from "./BtwPanel";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");

const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

const elementPrototype = HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof elementPrototype.scrollIntoView !== "function") elementPrototype.scrollIntoView = () => {};
if (typeof elementPrototype.focus !== "function") elementPrototype.focus = () => {};

interface TestElement {
	textContent: string | null;
	value?: string;
	disabled?: boolean;
	dispatchEvent: (event: unknown) => void;
	getAttribute: (name: string) => string | null;
	remove: () => void;
}

function record(overrides: Partial<BtwHistoryRecord> = {}): BtwHistoryRecord {
	return {
		id: "topic-1",
		leafId: "leaf-1",
		question: "why?",
		answer: "",
		status: "running",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function ok(command: string, data?: unknown): RpcResponse {
	return { type: "response", command, success: true, data };
}

const command = vi.fn(async (cmd: RpcCommand): Promise<RpcResponse> => {
	if (cmd.type === "get_btw_history") return ok("get_btw_history", { records: [] });
	if (cmd.type === "btw") {
		return ok("btw", {
			record: record({
				id: cmd.recordId ?? "new-topic",
				question: cmd.question,
				answer: "ok",
				status: "complete",
			}),
		});
	}
	if (cmd.type === "btw_cancel") return ok("btw_cancel", { cancelled: true });
	if (cmd.type === "btw_branch") return ok("btw_branch", { cancelled: false });
	if (cmd.type === "btw_inject") return ok("btw_inject", { sent: true });
	return { type: "response", command: cmd.type, success: false, error: "unsupported" };
});

Object.assign(window as unknown as Record<string, unknown>, { omp: { rpc: { command } } });

let container: TestElement | null = null;
let root: Root | null = null;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

async function dispatch(target: TestElement, event: InstanceType<typeof Event>): Promise<void> {
	Object.defineProperty(event, "eventPhase", { value: 0, writable: true, configurable: true });
	await act(async () => {
		target.dispatchEvent(event);
	});
}

async function click(element: TestElement | undefined): Promise<void> {
	if (!element) throw new Error("click: element not found");
	await dispatch(element, new Event("click", { bubbles: true, cancelable: true }));
	await flush();
}

/** Set a controlled input's value and drive its React onChange contract. */
async function typeInto(element: TestElement, value: string): Promise<void> {
	const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
	if (descriptor?.set) {
		descriptor.set.call(element, value);
	} else {
		element.value = value;
	}
	const props = Object.getOwnPropertyNames(element).find(key => key.startsWith("__reactProps$"));
	const handler = props
		? (element as unknown as Record<string, { onChange?: (event: object) => void }>)[props]?.onChange
		: undefined;
	if (handler) {
		await act(async () => handler({ target: element, currentTarget: element }));
		return;
	}
	await dispatch(element, new Event("input", { bubbles: true, cancelable: true }));
}

function buttonWithText(text: string): TestElement | undefined {
	return (Array.from(document.querySelectorAll("button")) as unknown as TestElement[]).find(button =>
		button.textContent?.includes(text),
	);
}

function topicRows(): TestElement[] {
	return Array.from(document.querySelectorAll("button[aria-pressed]")) as unknown as TestElement[];
}

function textarea(): TestElement {
	const element = document.querySelector("textarea") as unknown as TestElement | null;
	if (!element) throw new Error("textarea not found");
	return element;
}

async function mount(): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root?.render(
			<I18nProvider>
				<BtwPanel />
			</I18nProvider>,
		);
	});
	await flush();
}

beforeEach(() => {
	command.mockClear();
});

afterEach(async () => {
	await act(async () => {
		root?.unmount();
	});
	container?.remove();
	container = null;
	root = null;
	useBtwStore.getState().reset();
});

describe("BtwPanel", () => {
	it("lists topics newest first and shows the selected thread", async () => {
		const newer = record({
			id: "newer",
			question: "newer question",
			answer: "newer answer",
			status: "complete",
			createdAt: 2,
		});
		const older = record({
			id: "older",
			question: "older question",
			answer: "older answer",
			status: "complete",
			createdAt: 1,
			followUps: [{ question: "older follow-up", answer: "more", status: "complete", createdAt: 3, updatedAt: 3 }],
		});
		command.mockImplementationOnce(async () => ok("get_btw_history", { records: [newer, older] }));

		await mount();

		expect(document.body.textContent).toContain("newer question");
		expect(document.body.textContent).toContain("older question");
		expect(document.body.textContent).toContain("newer answer");

		const rows = topicRows();
		expect(rows).toHaveLength(2);
		expect(rows[0]?.getAttribute("aria-pressed")).toBe("true");

		await click(rows[1]);
		expect(document.body.textContent).toContain("older answer");
		expect(document.body.textContent).toContain("older follow-up");
	});

	it("sends a follow-up with the selected record id and a new question without one", async () => {
		const topic = record({ id: "topic-1", question: "why?", answer: "because", status: "complete" });
		command.mockImplementationOnce(async () => ok("get_btw_history", { records: [topic] }));

		await mount();
		await typeInto(textarea(), "more context");
		await click(buttonWithText(translate("btw.followUp")));

		expect(command).toHaveBeenCalledWith({ type: "btw", question: "more context", recordId: "topic-1" }, 120_000);

		await click(buttonWithText(translate("btw.newQuestion")));
		await typeInto(textarea(), "fresh question");
		await click(buttonWithText(translate("btw.ask")));

		expect(command).toHaveBeenCalledWith({ type: "btw", question: "fresh question" }, 120_000);
	});

	it("offers Stop while the selected answer runs and cancels that topic", async () => {
		command.mockImplementationOnce(async () => ok("get_btw_history", { records: [record()] }));

		await mount();
		await click(buttonWithText(translate("btw.cancel")));

		expect(command.mock.calls.map(([cmd]) => cmd)).toContainEqual({ type: "btw_cancel", recordId: "topic-1" });
	});

	it("branches a completed side conversation into the main chat", async () => {
		await mount();
		await typeInto(textarea(), "branch me");
		await click(buttonWithText(translate("btw.ask")));
		await act(async () => {
			useBtwStore.getState().applyFrame({
				type: "btw_record",
				record: record({ id: "new-topic", question: "branch me", answer: "ok", status: "complete" }),
			});
		});

		const branch = buttonWithText(translate("btw.branch"));
		expect(branch).toBeDefined();
		expect(branch?.disabled).toBe(false);

		await click(branch);
		expect(command.mock.calls.map(([cmd]) => cmd)).toContainEqual({ type: "btw_branch" });
	});

	it("appends streamed deltas to the selected running answer", async () => {
		command.mockImplementationOnce(async () => ok("get_btw_history", { records: [record()] }));

		await mount();
		await act(async () => {
			useBtwStore.getState().applyFrame({ type: "btw_delta", recordId: "topic-1", delta: "streaming text" });
		});

		expect(document.body.textContent).toContain("streaming text");
	});

	it("sets a drafted steering prompt apart and sends it to the main session", async () => {
		const answer = "Try this: <inject>Fix the failing build first.</inject> Then rerun.";
		command.mockImplementationOnce(async () =>
			ok("get_btw_history", { records: [record({ answer, status: "complete", inject: "ready" })] }),
		);

		await mount();
		const block = document.querySelector("[data-btw-inject]") as unknown as TestElement | null;
		expect(block?.textContent).toContain("Fix the failing build first.");
		expect(document.body.textContent).not.toContain("<inject>");

		await click(buttonWithText(translate("btw.injectSend")));
		expect(command.mock.calls.map(([cmd]) => cmd)).toContainEqual({ type: "btw_inject", recordId: "topic-1" });

		await act(async () => {
			useBtwStore.getState().applyFrame({
				type: "btw_record",
				record: record({ answer, status: "complete", inject: "sent" }),
			});
		});
		expect(document.body.textContent).toContain(translate("btw.injectSent"));
		expect(buttonWithText(translate("btw.injectSend"))).toBeUndefined();
	});

	it("leaves an answer asked without the setting as plain text", async () => {
		const answer = "Mentioning <inject>this</inject> in prose.";
		command.mockImplementationOnce(async () =>
			ok("get_btw_history", { records: [record({ answer, status: "complete" })] }),
		);

		await mount();
		expect(document.querySelector("[data-btw-inject]")).toBeNull();
		expect(buttonWithText(translate("btw.injectSend"))).toBeUndefined();
	});

	it("shows the empty state when the session has no topics", async () => {
		await mount();

		expect(document.body.textContent).toContain(translate("btw.empty"));
		expect(document.body.textContent).toContain(translate("btw.emptyHint"));
	});
});
