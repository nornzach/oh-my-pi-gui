/**
 * ConfigWarningsBanner contract: sidecar configuration warnings are visible
 * (nothing renders without them), several collapse to a count with the full
 * list one click away, and dismissal hides only the set it was clicked on —
 * a new warning brings the banner back.
 */
import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider, translate } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { ConfigWarningsBanner } from "./ConfigWarningsBanner";

const { document, window, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
Object.assign(globals, { document, window, HTMLElement, Element, Node, IS_REACT_ACT_ENVIRONMENT: true });
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

interface TestElement {
	textContent: string | null;
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

async function clickButton(label: string): Promise<void> {
	const button = container
		.querySelectorAll("button")
		.find(candidate => candidate.textContent?.includes(label) || label === "close");
	if (!button) throw new Error(`no button ${label}`);
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
});

describe("ConfigWarningsBanner", () => {
	it("renders nothing without warnings", async () => {
		await mount(<ConfigWarningsBanner />);
		expect(container.textContent).toBe("");
	});

	it("shows a single warning in full", async () => {
		useSessionStore.setState({ configWarnings: ["models.yml: unknown provider 'foo'"] });
		await mount(<ConfigWarningsBanner />);
		expect(container.textContent).toContain("Configuration warning");
		expect(container.textContent).toContain("models.yml: unknown provider 'foo'");
	});

	it("collapses several warnings to a count and expands the full list", async () => {
		useSessionStore.setState({ configWarnings: ["first problem", "second problem"] });
		await mount(<ConfigWarningsBanner />);
		expect(container.textContent).toContain("2 configuration warnings");
		expect(container.textContent).toContain("first problem");
		expect(container.textContent).not.toContain("second problem");
		await clickButton("Show all");
		expect(container.textContent).toContain("second problem");
	});

	it.each([
		[{ source: "setting" }, "proxy.dropped.setting"],
		[{ source: "system" }, "proxy.dropped.system"],
	] as const)("explains a skipped proxy: %j", async (dropped, key) => {
		useSessionStore.setState({ proxyWarnings: [dropped] });
		await mount(<ConfigWarningsBanner />);
		expect(translate(key)).not.toBe(key);
		expect(container.textContent).toContain(translate(key));
	});

	it("names the skipped variables and lists them ahead of the sidecar's warnings", async () => {
		useSessionStore.setState({
			proxyWarnings: [{ source: "environment", names: ["HTTPS_PROXY", "https_proxy"] }],
			configWarnings: ["models.yml: unknown provider 'foo'"],
		});
		await mount(<ConfigWarningsBanner />);
		expect(container.textContent).toContain("2 configuration warnings");
		expect(container.textContent).toContain("HTTPS_PROXY, https_proxy");
		expect(container.textContent).not.toContain("models.yml");
	});

	it("hides the dismissed set and returns when a new warning arrives", async () => {
		useSessionStore.setState({ configWarnings: ["only problem"] });
		await mount(<ConfigWarningsBanner />);
		await clickButton("close");
		expect(container.textContent).toBe("");
		await act(async () => {
			useSessionStore.setState({ configWarnings: ["only problem", "new problem"] });
		});
		expect(container.textContent).toContain("2 configuration warnings");
	});
});
