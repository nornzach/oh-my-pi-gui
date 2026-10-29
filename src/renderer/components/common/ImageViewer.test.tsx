/**
 * An image in the conversation opens the viewer on click: the same image,
 * fitted first, zoomed by a click on it and back, and closed by Escape or a
 * click beside it. A click on the chat image never reaches the row it sits in.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { ZoomableImage } from "./ImageViewer";

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
(globalThis as Record<string, unknown>).requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

const SRC = "data:image/png;base64,iVBORw0KGgo=";
let root: Root;
let container: HTMLElement;

async function mount(onRowClick: () => void) {
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	await act(async () => {
		root.render(
			<I18nProvider>
				<div onClick={onRowClick}>
					<ZoomableImage alt="chart" src={SRC} />
				</div>
			</I18nProvider>,
		);
	});
}

const viewer = () => document.body.querySelector("[data-image-viewer]");
const zoomLevel = () => viewer()?.querySelector("[data-zoom-level]")?.textContent;

async function click(target: Element | null | undefined) {
	await act(async () => {
		target?.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
	});
}

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("ZoomableImage", () => {
	it("opens the image in the viewer, zooms it on click, and closes on Escape", async () => {
		const onRowClick = vi.fn();
		await mount(onRowClick);
		expect(viewer()).toBeNull();

		await click(container.querySelector("img"));
		expect(onRowClick).not.toHaveBeenCalled();
		expect(viewer()?.querySelector("img")?.getAttribute("src")).toBe(SRC);
		expect(zoomLevel()).toBe("100%");

		await click(viewer()?.querySelector("img"));
		expect(zoomLevel()).toBe("200%");
		await click(viewer()?.querySelector("img"));
		expect(zoomLevel()).toBe("100%");

		const escapeKey = new Event("keydown", { bubbles: true, cancelable: true });
		Object.defineProperty(escapeKey, "key", { value: "Escape" });
		await act(async () => {
			document.dispatchEvent(escapeKey);
		});
		expect(viewer()).toBeNull();
	});

	it("closes on a click beside the image but not on the image or its toolbar", async () => {
		await mount(() => {});
		await click(container.querySelector("img"));
		await click(viewer()?.querySelector("button[aria-label^='Zoom in']"));
		expect(viewer()).not.toBeNull();

		await click(viewer()?.querySelector("img")?.parentElement);
		expect(viewer()).toBeNull();
	});
});
