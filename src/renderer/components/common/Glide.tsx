/**
 * A selection mark that travels: one element that sits under the selected item
 * of its parent and slides to the next one when the selection changes, instead
 * of one highlight fading out while another fades in.
 *
 * Render it as a child of the positioned container that holds the items. It
 * finds the selected item with `selector`, measures it, and exposes the box as
 * custom properties the `.omp-glide` rules turn into a transform. The container
 * gets `data-glide-ready` once a box is known, which is the cue for the items'
 * own selected styling to step aside; until then (first paint, a selected item
 * that is not rendered, an environment without layout) the items look exactly
 * as they do without this component.
 */

import { useEffect, useLayoutEffect, useRef } from "react";

export type GlideVariant = "pill" | "thumb" | "underline";

export interface GlideProps {
	/** Identity of the selection. The mark slides only when this changes. */
	activeKey: string | null;
	/** Matches the selected item inside the container. */
	selector: string;
	variant: GlideVariant;
}

export function Glide({ activeKey, selector, variant }: GlideProps) {
	const markRef = useRef<HTMLSpanElement>(null);
	const lastKey = useRef<string | null>(null);
	const placeRef = useRef<(slide: boolean) => void>(() => {});

	placeRef.current = (slide: boolean) => {
		const mark = markRef.current;
		const container = mark?.parentElement;
		if (!mark || !container) return;
		const target = activeKey === null ? null : container.querySelector<HTMLElement>(selector);
		const box = target?.getBoundingClientRect();
		if (!target || !box || box.width === 0 || box.height === 0) {
			container.removeAttribute("data-glide-ready");
			mark.hidden = true;
			return;
		}
		const origin = container.getBoundingClientRect();
		const wasHidden = mark.hidden || !container.hasAttribute("data-glide-ready");
		// A mark that was not on screen has nowhere to slide from: it appears in place.
		const animate = slide && !wasHidden;
		if (!animate) mark.style.transitionDuration = "0s";
		mark.hidden = false;
		mark.style.setProperty("--glide-x", `${box.left - origin.left - container.clientLeft + container.scrollLeft}px`);
		mark.style.setProperty("--glide-y", `${box.top - origin.top - container.clientTop + container.scrollTop}px`);
		mark.style.setProperty("--glide-w", `${box.width}px`);
		mark.style.setProperty("--glide-h", `${box.height}px`);
		if (!animate) {
			// Commit the jump before transitions come back on.
			mark.getBoundingClientRect();
			mark.style.transitionDuration = "";
		}
		container.setAttribute("data-glide-ready", "");
	};

	// Every render: an item can move without the selection changing (a list
	// reorders, a group collapses), and then the mark follows without sliding.
	useLayoutEffect(() => {
		const moved = lastKey.current !== null && lastKey.current !== activeKey;
		lastKey.current = activeKey;
		placeRef.current(moved);
	});

	// The container resizing (window, panel, font size) moves every item at once.
	useEffect(() => {
		const container = markRef.current?.parentElement;
		if (!container || typeof ResizeObserver === "undefined") return;
		let first = true;
		const observer = new ResizeObserver(() => {
			// The observer reports once on observe(); that would cancel a slide in flight.
			if (first) first = false;
			else placeRef.current(false);
		});
		observer.observe(container);
		return () => {
			observer.disconnect();
			container.removeAttribute("data-glide-ready");
		};
	}, []);

	return <span aria-hidden className={`omp-glide omp-glide--${variant}`} hidden ref={markRef} />;
}
