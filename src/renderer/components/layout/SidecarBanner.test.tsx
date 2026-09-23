/**
 * SidecarBanner contract: the crash loop is reported as progress (amber,
 * "attempt N/M" from main's structured restart field, never by parsing English),
 * an exhausted loop as an error, and the close button actually hides the banner
 * for the diagnostic it was clicked on.
 */
import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { useUiStore } from "../../stores/ui";
import { SidecarBanner } from "./SidecarBanner";

const { document, window, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
Object.assign(globals, { document, window, HTMLElement, Element, Node, IS_REACT_ACT_ENVIRONMENT: true });
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

const restart = vi.fn(() => Promise.resolve());
Object.assign(window, { omp: { sidecar: { restart } } });

interface TestElement {
	textContent: string | null;
	className: string;
	click: () => void;
	remove: () => void;
	querySelectorAll: (selector: string) => TestElement[];
}

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

function bannerDiv(): TestElement {
	return container.querySelectorAll("div")[0] as unknown as TestElement;
}

async function click(index: number): Promise<void> {
	const button = container.querySelectorAll("button")[index] as unknown as TestElement;
	await act(async () => {
		button.click();
	});
}

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	useSessionStore.getState().reset();
	useUiStore.setState({ sidecarError: null, sidecarRestart: null, sidecarDismissed: false });
	restart.mockClear();
});

describe("SidecarBanner", () => {
	it("reports an in-progress restart attempt instead of hiding it", async () => {
		useSessionStore.getState().setStatus("restarting", "/tmp/project");
		useUiStore.getState().setSidecarError("Exit code 3 — dyld: Library not loaded", {
			attempt: 2,
			maxAttempts: 3,
		});
		await mount(<SidecarBanner />);

		expect(container.textContent).toContain("Agent restarting");
		expect(container.textContent).toContain("Restart attempt 2/3");
		expect(container.textContent).toContain("Exit code 3 — dyld: Library not loaded");
		// Progress is not a failure: amber, and not the "Agent unavailable" error card.
		expect(bannerDiv().className).toContain("--omp-warning");
		expect(container.textContent).not.toContain("Agent unavailable");
	});

	it("marks an exhausted crash loop as a failure with the last reason", async () => {
		useSessionStore.getState().setStatus("error", "/tmp/project");
		useUiStore.getState().setSidecarError("Exit code 1 — omp: command not found", {
			attempt: 3,
			maxAttempts: 3,
		});
		await mount(<SidecarBanner />);

		expect(container.textContent).toContain("Agent unavailable");
		expect(container.textContent).toContain("Gave up after 3 restart attempts");
		expect(container.textContent).toContain("omp: command not found");
		expect(bannerDiv().className).toContain("--omp-error");
	});

	it("hides the banner on close even while the status itself is the error", async () => {
		useSessionStore.getState().setStatus("error", "/tmp/project");
		useUiStore.getState().setSidecarError("Exit code 1", null);
		await mount(<SidecarBanner />);
		expect(container.textContent).toContain("Agent unavailable");

		// Close is the second button (the first is Restart).
		await click(1);
		expect(container.textContent).toBe("");
	});

	it("shows the next diagnostic after a dismissal", async () => {
		useSessionStore.getState().setStatus("restarting", "/tmp/project");
		useUiStore.getState().setSidecarError("Exit code 3", { attempt: 1, maxAttempts: 3 });
		await mount(<SidecarBanner />);
		await click(1);
		expect(container.textContent).toBe("");

		await act(async () => {
			useUiStore.getState().setSidecarError("Exit code 4", { attempt: 2, maxAttempts: 3 });
		});
		expect(container.textContent).toContain("Restart attempt 2/3");
		expect(container.textContent).toContain("Exit code 4");
	});

	it("stays out of the way while the agent is healthy", async () => {
		useSessionStore.getState().setStatus("ready", "/tmp/project");
		await mount(<SidecarBanner />);
		expect(container.textContent).toBe("");
	});
});
