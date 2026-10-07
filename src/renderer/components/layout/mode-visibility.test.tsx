/**
 * Contract tests for mode-state visibility: the compact composer Modes entry
 * surfaces the active-mode count and keeps each control reachable in its menu.
 * State comes from the session store (including loop/vibe hydration and loop updates).
 */

import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { useUiStore } from "../../stores/ui";
import { ComposerModes } from "./ComposerModes";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");

const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

interface TestElement {
	textContent: string | null;
	remove: () => void;
	querySelector: (selector: string) => TestElement | null;
	querySelectorAll: (selector: string) => TestElement[];
	appendChild: (child: TestElement) => void;
	title: string;
	className: string;
	click: () => void;
	getAttribute: (name: string) => string | null;
}

function success(data: unknown): RpcResponse {
	return { type: "response", command: "test", success: true, data };
}

interface MockOmp {
	rpc: {
		getSettings: Mock<(keys: string[]) => Promise<RpcResponse>>;
	};
	events: {
		onConfigUpdate: Mock<() => () => void>;
	};
}

/** ComposerModes needs no RPC on render; the mock preserves the window bridge contract. */
function installMockOmp(preset?: string): MockOmp {
	const omp: MockOmp = {
		rpc: {
			getSettings: vi.fn(async () => success({ values: preset ? { "statusLine.preset": preset } : {} })),
		},
		events: {
			onConfigUpdate: vi.fn(() => () => {}),
		},
	};
	(window as unknown as { omp: MockOmp }).omp = omp;
	return omp;
}

let container: TestElement;
let root: Root;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

async function mount(element: ReactElement): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(<I18nProvider>{element}</I18nProvider>);
	});
	await flush();
}

afterEach(async () => {
	if (root) {
		await act(async () => {
			root.unmount();
		});
	}
	container?.remove();
	useSessionStore.getState().reset();
	useUiStore.setState({ modesOpen: false, modesTab: "vibe" });
});

function buttonByTitle(title: string): TestElement | null {
	const match = Array.from(document.body.querySelectorAll("button")).find(button => button.title === title);
	// linkedom's element type and the minimal test facade are structurally equivalent at runtime.
	return (match ?? null) as unknown as TestElement | null;
}

describe("ComposerModes menu", () => {
	it("collapses active modes into one highlighted trigger and preserves their detail in the menu", async () => {
		installMockOmp();
		useSessionStore.setState({
			planModeEnabled: true,
			goal: { objective: "Ship the activity dock" },
			goalState: { status: "active" },
			loopMode: {
				enabled: true,
				state: "running",
				prompt: "keep going",
				limit: { kind: "iterations", initial: 10, remaining: 7 },
			},
			vibeModeEnabled: true,
		});
		await mount(<ComposerModes />);

		const trigger = buttonByTitle("Active modes: Plan · Goal · Loop · Vibe");
		expect(trigger).not.toBeNull();
		expect(trigger?.className).toContain("bg-[var(--omp-accent-dim)]");
		expect(trigger?.textContent).toContain("4");

		await act(async () => {
			trigger?.click();
		});
		await flush();

		for (const title of [
			"Plan mode — agent drafts a plan before acting",
			"Goal mode — Ship the activity dock",
			"Loop mode — 7 of 10 iterations left",
			"Route this session through persistent fast workers.",
		]) {
			const row = buttonByTitle(title);
			expect(row).not.toBeNull();
			expect(row?.getAttribute("aria-pressed")).toBe("true");
		}
	});

	it("keeps inactive controls inside the menu instead of occupying the primary toolbar", async () => {
		installMockOmp();
		await mount(<ComposerModes />);

		const trigger = buttonByTitle("Session modes and coding toggles");
		expect(trigger).not.toBeNull();
		expect(trigger?.className).not.toContain("bg-[var(--omp-accent-dim)]");
		expect(container.textContent).toBe("Modes");

		await act(async () => {
			trigger?.click();
		});
		await flush();

		for (const title of ["Plan mode — agent drafts a plan before acting", "Loop mode — open the loop panel"]) {
			const row = buttonByTitle(title);
			expect(row).not.toBeNull();
			expect(row?.getAttribute("aria-pressed")).toBe("false");
		}
	});

	it("opens the Modes window on the selected menu tab", async () => {
		installMockOmp();
		await mount(<ComposerModes />);

		await act(async () => {
			buttonByTitle("Session modes and coding toggles")?.click();
		});
		await flush();
		await act(async () => {
			buttonByTitle("Loop mode — open the loop panel")?.click();
		});
		expect(useUiStore.getState().modesOpen).toBe(true);
		expect(useUiStore.getState().modesTab).toBe("loop");
	});
});
