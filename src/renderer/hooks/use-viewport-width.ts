import { useSyncExternalStore } from "react";

const DEFAULT_WIDTH = 1440;

function viewportWidth(): number {
	return Number.isFinite(window.innerWidth) && window.innerWidth > 0 ? window.innerWidth : DEFAULT_WIDTH;
}

function subscribe(callback: () => void): () => void {
	window.addEventListener("resize", callback);
	return () => window.removeEventListener("resize", callback);
}

export function useViewportWidth(): number {
	return useSyncExternalStore(subscribe, viewportWidth, () => DEFAULT_WIDTH);
}
