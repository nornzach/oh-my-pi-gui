/**
 * A toast over a banner hides its buttons at the moment they matter most: Restart
 * after a crash, Show all on a warning. The stack has to start below the banners.
 */
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { useToastStore } from "../../stores/toast";
import { ToastStack } from "./Toast";

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

let root: Root | null = null;
const added: Array<{ remove(): void }> = [];

function addBanners(rect: { height: number; bottom: number }): void {
	const banners = document.createElement("div");
	banners.setAttribute("data-toast-clearance", "");
	(banners as unknown as { getBoundingClientRect(): typeof rect }).getBoundingClientRect = () => rect;
	document.body.appendChild(banners);
	added.push(banners);
}

async function stackTop(): Promise<string | null> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	added.push(host);
	useToastStore.getState().push({ message: "Saved" });
	root = createRoot(host as unknown as globalThis.Element);
	await act(async () => {
		root?.render(
			<I18nProvider>
				<ToastStack />
			</I18nProvider>,
		);
	});
	return document.querySelector('[aria-live="polite"]')?.getAttribute("style") ?? null;
}

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	for (const element of added.splice(0)) element.remove();
	useToastStore.setState({ toasts: [] });
});

describe("ToastStack placement", () => {
	it("keeps its usual place when no banner is showing", async () => {
		addBanners({ height: 0, bottom: 92 });
		expect(await stackTop()).toContain("top:112px");
	});

	it("moves below a banner that reaches past its usual place", async () => {
		addBanners({ height: 80, bottom: 172 });
		expect(await stackTop()).toContain("top:180px");
	});

	it("stays put when a window has no banners at all", async () => {
		expect(await stackTop()).toContain("top:112px");
	});
});
