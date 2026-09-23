import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { useUpdaterStore } from "../../stores/updater";
import { UpdateBanner } from "./UpdateBanner";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
Object.assign(globals, { document, window, Event, HTMLElement, Element, Node, IS_REACT_ACT_ENVIRONMENT: true });
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

interface TestElement {
	textContent: string | null;
	click: () => void;
	remove: () => void;
	querySelectorAll: (selector: string) => TestElement[];
}

const check = vi.fn(() => Promise.resolve({ state: "checking" } as const));
const download = vi.fn(() => Promise.resolve({ state: "idle" } as const));
const apply = vi.fn(() => Promise.resolve());
Object.assign(window, { omp: { updater: { check, download, apply } } });

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

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	useUpdaterStore.setState({ status: { state: "idle" }, dismissed: {} });
	check.mockClear();
	download.mockClear();
	apply.mockClear();
});

describe("UpdateBanner", () => {
	it("offers the architecture installer instead of Squirrel installation in manual mode", async () => {
		useUpdaterStore.setState({
			status: { state: "available", version: "0.8.5", mode: "manual" },
			dismissed: {},
		});
		await mount(<UpdateBanner />);

		expect(container.textContent).toContain("Download installer");
		expect(container.textContent).not.toContain("Restart & install");
	});

	it("keeps Finder replacement guidance visible and reopens the verified installer", async () => {
		useUpdaterStore.setState({
			status: { state: "downloaded", version: "0.8.5", mode: "manual" },
			dismissed: {},
		});
		await mount(<UpdateBanner />);

		expect(container.textContent).toContain("drag omp into Applications");
		expect(container.textContent).toContain("Privacy & Security");
		const openButton = container
			.querySelectorAll("button")
			.find(button => button.textContent?.includes("Open installer"));
		expect(openButton).toBeDefined();
		await act(async () => {
			openButton?.click();
		});
		expect(apply).toHaveBeenCalledOnce();
	});

	it("retains restart-and-install for certificate-backed automatic updates", async () => {
		useUpdaterStore.setState({
			status: { state: "downloaded", version: "0.8.5", mode: "automatic" },
			dismissed: {},
		});
		await mount(<UpdateBanner />);

		expect(container.textContent).toContain("Restart & install");
		expect(container.textContent).not.toContain("Open installer");
	});

	it("keeps user-initiated verification failures visible with a retry action", async () => {
		useUpdaterStore.setState({
			status: { state: "error", message: "Installer failed SHA-512 verification.", showInBanner: true },
			dismissed: {},
		});
		await mount(<UpdateBanner />);

		expect(container.textContent).toContain("Installer failed SHA-512 verification.");
		const retryButton = container
			.querySelectorAll("button")
			.find(button => button.textContent?.includes("Check again"));
		await act(async () => {
			retryButton?.click();
		});
		expect(check).toHaveBeenCalledOnce();
	});

	it("lets a user close a failure banner, and keeps the closed notice closed", async () => {
		useUpdaterStore.setState({
			status: { state: "error", message: "GitHub release feed unreachable.", showInBanner: true },
			dismissed: {},
		});
		await mount(<UpdateBanner />);

		const [dismissButton] = container.querySelectorAll('[aria-label="Dismiss this update notice"]');
		expect(dismissButton).toBeDefined();
		await act(async () => {
			dismissButton?.click();
		});
		expect(container.textContent).toBe("");

		// The four-hourly poll replays the same failure: still hidden.
		await act(async () => {
			useUpdaterStore.getState().setStatus({
				state: "error",
				message: "GitHub release feed unreachable.",
				showInBanner: true,
			});
		});
		expect(container.textContent).toBe("");
	});

	it("stays away while the notice a previous launch dismissed is still current", async () => {
		useUpdaterStore.setState({
			status: { state: "error", message: "GitHub release feed unreachable.", showInBanner: true },
			dismissed: { error: true },
		});
		await mount(<UpdateBanner />);

		expect(container.textContent).toBe("");
	});

	it("keeps passive polling failures out of the banner", async () => {
		useUpdaterStore.setState({
			status: { state: "error", message: "Offline", showInBanner: false },
			dismissed: {},
		});
		await mount(<UpdateBanner />);

		expect(container.textContent).toBe("");
	});
});
