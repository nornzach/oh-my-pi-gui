/**
 * InputArea interaction contracts: queue shorthand routing and nested
 * run-settings portals. The latter protects option clicks from the parent
 * menu's outside-dismiss listener.
 */
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider, translate } from "../../lib/i18n";
import { useComposerStore } from "../../stores/composer";
import { useMessagesStore } from "../../stores/messages";
import { useModelStore } from "../../stores/model";
import { useQueueStore } from "../../stores/queue";
import { useSessionStore } from "../../stores/session";
import { useSettingsStore } from "../../stores/settings";
import { useTabsStore } from "../../stores/tabs";
import { useUiStore } from "../../stores/ui";
import { InputArea } from "./InputArea";

const { document, window, Event, CustomEvent, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.CustomEvent = CustomEvent;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

const elementPrototype = HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof elementPrototype.focus !== "function") elementPrototype.focus = () => {};
if (typeof elementPrototype.scrollIntoView !== "function") elementPrototype.scrollIntoView = () => {};
elementPrototype.getBoundingClientRect = () => ({
	bottom: 0,
	height: 0,
	left: 0,
	right: 0,
	top: 0,
	width: 0,
	x: 0,
	y: 0,
	toJSON: () => ({}),
});
Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });

interface TestElement {
	textContent: string | null;
	remove(): void;
	dispatchEvent(event: object): boolean;
	getAttribute(name: string): string | null;
}

const ok = (data?: unknown) => ({ type: "response" as const, command: "x", success: true as const, data });

let container: TestElement;
let root: Root;
let followUp: Mock;
let steer: Mock;
let prompt: Mock;
let setThinkingLevel: Mock;
let setSetting: Mock;
let setPlanMode: Mock;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

/** Set a controlled input's value and drive its React onChange contract. */
async function typeInto(element: TestElement, value: string): Promise<void> {
	const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
	if (descriptor?.set) descriptor.set.call(element, value);
	else (element as unknown as { value: string }).value = value;
	const record = element as unknown as Record<string, unknown>;
	const propsKey = Object.getOwnPropertyNames(record).find(key => key.startsWith("__reactProps$"));
	const props = propsKey ? (record[propsKey] as { onChange?: (event: object) => void } | undefined) : undefined;
	if (!props?.onChange) throw new Error("textarea onChange not found");
	await act(async () => props.onChange?.({ target: element, currentTarget: element }));
}

/** Drive the textarea's React onKeyDown with an Enter press. */
async function pressEnter(element: TestElement): Promise<void> {
	const record = element as unknown as Record<string, unknown>;
	const propsKey = Object.getOwnPropertyNames(record).find(key => key.startsWith("__reactProps$"));
	const props = propsKey
		? (record[propsKey] as { onKeyDown?: (event: Record<string, unknown>) => void } | undefined)
		: undefined;
	if (!props?.onKeyDown) throw new Error("textarea onKeyDown not found");
	await act(async () =>
		props.onKeyDown?.({
			key: "Enter",
			shiftKey: false,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			nativeEvent: { isComposing: false },
			keyCode: 13,
			preventDefault: () => {},
		}),
	);
}

async function click(element: TestElement): Promise<void> {
	await act(async () => {
		element.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
	});
}

async function pointerDown(element: TestElement): Promise<void> {
	await act(async () => {
		element.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
	});
}

function buttonWithText(text: string): TestElement | undefined {
	const buttons = Array.from(document.querySelectorAll("button")) as unknown as TestElement[];
	return buttons.find(button => button.textContent?.trim().startsWith(text));
}

function setWindowWidth(width: number): void {
	Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

function findTextarea(): TestElement {
	const textarea = document.querySelector("textarea") as unknown as TestElement | null;
	if (!textarea) throw new Error("composer textarea not found");
	return textarea;
}

async function mount(): Promise<void> {
	followUp = vi.fn(async () => ok());
	steer = vi.fn(async () => ok());
	prompt = vi.fn(async () => ok());
	setThinkingLevel = vi.fn(async (level: string) => ok({ thinkingLevel: level, thinkingConfigured: level }));
	setSetting = vi.fn(async () => ok());
	setPlanMode = vi.fn(async (enabled: boolean) => ok({ enabled }));
	(window as unknown as Record<string, unknown>).omp = {
		fs: { list: vi.fn(async () => ({ entries: [] })) },
		events: { onCommandsUpdate: vi.fn(() => () => {}) },
		prefs: { set: vi.fn(async () => ({})), get: vi.fn(async () => []) },
		rpc: {
			getAvailableCommands: vi.fn(async () => ok({ commands: [] })),
			getQueue: vi.fn(async () => ok({ steering: [], followUp: [] })),
			followUp,
			steer,
			prompt,
			abort: vi.fn(async () => ok()),
			setThinkingLevel,
			setSetting,
			setPlanMode,
		},
	};
	useModelStore.setState({
		thinkingLevel: "high",
		thinkingConfigured: "high",
		availableThinkingLevels: ["low", "medium", "high", "xhigh", "max"],
	});
	useSessionStore.setState({
		status: "ready",
		isStreaming: true,
		queuedMessageCount: 0,
		cwd: "/tmp",
		sessionId: "s1",
		sessionName: null,
	});
	useTabsStore.setState({
		tabs: [
			{ kind: "agent", id: "t0", cwd: "/tmp", status: "ready", unreadDone: false },
			{ kind: "agent", id: "t1", cwd: "/other", status: "ready", unreadDone: false },
		],
		activeTabId: "t0",
		bundles: new Map(),
	});
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<InputArea />
			</I18nProvider>,
		);
	});
	await flush();
}

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	useSessionStore.getState().reset();
	useMessagesStore.getState().reset();
	useModelStore.getState().reset();
	useComposerStore.getState().reset();
	useQueueStore.getState().setFromFrame({ steering: [], followUp: [] });
	useSettingsStore.getState().reset();
	useTabsStore.getState().reset();
	useUiStore.getState().closeComposerEditor();
	setWindowWidth(1200);
	vi.restoreAllMocks();
});

describe("InputArea queue shorthand submit", () => {
	it("enables the platform spellcheck and autocorrect pipeline", async () => {
		await mount();
		const textarea = findTextarea();
		const propsKey = Object.getOwnPropertyNames(textarea).find(key => key.startsWith("__reactProps$"));
		const props = propsKey
			? ((textarea as unknown as Record<string, unknown>)[propsKey] as Record<string, unknown>)
			: undefined;
		expect(props?.spellCheck).toBe(true);
		expect(props?.autoCorrect).toBe("on");
		expect(props?.autoCapitalize).toBe("sentences");
	});

	it("routes `-> text` to followUp with the prefix stripped while streaming", async () => {
		await mount();
		await typeInto(findTextarea(), "-> ord alpha");
		await pressEnter(findTextarea());
		await flush();
		await flush();

		expect(followUp).toHaveBeenCalledTimes(1);
		expect(followUp).toHaveBeenCalledWith("ord alpha", []);
		expect(steer).not.toHaveBeenCalled();
		expect(prompt).not.toHaveBeenCalled();
	});

	it("routes `=> text` the same way while streaming", async () => {
		await mount();
		await typeInto(findTextarea(), "=> ship it");
		await pressEnter(findTextarea());
		await flush();
		await flush();

		expect(followUp).toHaveBeenCalledWith("ship it", []);
		expect(steer).not.toHaveBeenCalled();
	});

	it("splits an enumerated list into one followUp per item while streaming", async () => {
		await mount();
		await typeInto(findTextarea(), "->\n1. alpha\n2. beta");
		await pressEnter(findTextarea());
		await flush();
		await flush();

		expect(followUp).toHaveBeenCalledTimes(2);
		expect(followUp).toHaveBeenNthCalledWith(1, "alpha", []);
		expect(followUp).toHaveBeenNthCalledWith(2, "beta", undefined);
		expect(steer).not.toHaveBeenCalled();
	});

	it("starts immediately as a followUp-behavior prompt when idle", async () => {
		await mount();
		await act(async () => useSessionStore.setState({ isStreaming: false }));
		await typeInto(findTextarea(), "-> ord alpha");
		await pressEnter(findTextarea());
		await flush();
		await flush();

		expect(prompt).toHaveBeenCalledWith("ord alpha", [], "followUp");
		expect(followUp).not.toHaveBeenCalled();
		expect(steer).not.toHaveBeenCalled();
	});

	it("still steers a plain (non-shorthand) message while streaming", async () => {
		await mount();
		await typeInto(findTextarea(), "plain guidance");
		await pressEnter(findTextarea());
		await flush();
		await flush();

		expect(steer).toHaveBeenCalledWith("plain guidance", []);
		expect(followUp).not.toHaveBeenCalled();
	});

	it("does not dispatch a deferred prompt through a tab selected after Enter", async () => {
		await mount();
		await act(async () => useSessionStore.setState({ isStreaming: false }));
		await typeInto(findTextarea(), "stay in t0");
		vi.useFakeTimers();
		try {
			await pressEnter(findTextarea());
			useTabsStore.setState({ activeTabId: "t1" });
			await act(async () => {
				vi.runOnlyPendingTimers();
				await Promise.resolve();
			});
		} finally {
			vi.useRealTimers();
		}

		expect(prompt).not.toHaveBeenCalled();
	});

	it("does not dispatch or restore a deferred prompt after the tab replaces its session", async () => {
		await mount();
		await act(async () => useSessionStore.setState({ isStreaming: false }));
		await typeInto(findTextarea(), "old session message");
		vi.useFakeTimers();
		try {
			await pressEnter(findTextarea());
			await act(async () => useSessionStore.setState({ sessionId: "s2" }));
			await act(async () => {
				vi.runOnlyPendingTimers();
				await Promise.resolve();
			});
		} finally {
			vi.useRealTimers();
		}

		expect(prompt).not.toHaveBeenCalled();
		expect(useComposerStore.getState().draft).toBe("");
	});

	it("stops a multi-item queue before a later item can cross into another tab", async () => {
		await mount();
		const first = Promise.withResolvers<RpcResponse>();
		followUp.mockReturnValueOnce(first.promise);
		await typeInto(findTextarea(), "->\n1. alpha\n2. beta");
		await pressEnter(findTextarea());
		expect(followUp).toHaveBeenCalledTimes(1);

		useTabsStore.setState({ activeTabId: "t1" });
		first.resolve(ok());
		await flush();
		await flush();

		expect(followUp).toHaveBeenCalledTimes(1);
	});
});

describe("InputArea run settings", () => {
	async function openRunSettings(): Promise<void> {
		const more = document.querySelector(
			"button[data-run-settings-overflow-trigger]",
		) as unknown as TestElement | null;
		if (!more) throw new Error("run settings trigger missing");
		await click(more);
	}

	async function mountCompact(): Promise<void> {
		setWindowWidth(600);
		await mount();
	}

	it("keeps all primary run controls inline when the composer has room", async () => {
		await mount();

		expect(document.querySelector("[data-run-settings-inline]")).not.toBeNull();
		expect(document.querySelector("[data-run-settings-overflow-trigger]")).toBeNull();
		expect(buttonWithText(translate("input.thinking.name.high"))).toBeDefined();
		expect(buttonWithText("Fast")).toBeDefined();
		expect(buttonWithText("Full access")).toBeDefined();
		expect(buttonWithText("Modes")).toBeDefined();
	});

	it("marks fast mode selected when enabled but unavailable to the active model", async () => {
		useModelStore.setState({ fastModeEnabled: true, fastModeActive: false });
		await mount();

		const fast = buttonWithText("Fast");
		if (!fast) throw new Error("fast mode trigger missing");
		const button = fast as unknown as HTMLElement;
		expect(button.getAttribute("aria-pressed")).toBe("true");
		expect(button.className).toContain("text-[var(--omp-accent)]");
	});

	it("lets a nested thinking portal dispatch before the parent menu dismisses", async () => {
		await mountCompact();
		await openRunSettings();

		const thinking = buttonWithText(translate("input.thinking.name.high"));
		if (!thinking) throw new Error("thinking trigger missing");
		await click(thinking);

		const max = buttonWithText(translate("input.thinking.name.max"));
		if (!max) throw new Error("max option missing");
		// Browser ordering is pointerdown → pointerup → click. The regression
		// closed the parent on the first event and unmounted this handler before
		// the final click.
		await pointerDown(max);
		await click(max);
		await flush();

		expect(setThinkingLevel).toHaveBeenCalledWith("max");
		expect(useModelStore.getState().thinkingConfigured).toBe("max");
	});

	it("lets the nested approval portal persist its selected mode", async () => {
		await mountCompact();
		await openRunSettings();
		const approval = buttonWithText("Full access");
		if (!approval) throw new Error("approval trigger missing");
		await click(approval);

		const ask = buttonWithText("Ask every time");
		if (!ask) throw new Error("approval option missing");
		await pointerDown(ask);
		await click(ask);

		expect(setSetting).toHaveBeenCalledWith("tools.approvalMode", "always-ask");
		expect(useSettingsStore.getState().approvalMode).toBe("always-ask");
	});

	it("lets the nested modes portal dispatch its selected action", async () => {
		await mountCompact();
		await openRunSettings();
		const modes = buttonWithText("Modes");
		if (!modes) throw new Error("modes trigger missing");
		await click(modes);

		const plan = buttonWithText("Plan");
		if (!plan) throw new Error("plan option missing");
		await pointerDown(plan);
		await click(plan);
		await flush();

		expect(setPlanMode).toHaveBeenCalledWith(true);
		expect(useSessionStore.getState().planModeEnabled).toBe(true);
	});
});
