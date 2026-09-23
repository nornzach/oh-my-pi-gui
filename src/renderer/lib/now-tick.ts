import { useEffect, useState } from "react";

type ClockListener = (now: number) => void;

const listeners = new Set<ClockListener>();
let interval: number | null = null;

function subscribe(listener: ClockListener): () => void {
	listeners.add(listener);
	interval ??= window.setInterval(() => {
		const now = Date.now();
		for (const fn of listeners) fn(now);
	}, 1000);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && interval) {
			window.clearInterval(interval);
			interval = null;
		}
	};
}

/**
 * Wall clock that advances once a second while `active`, then freezes.
 *
 * Every live elapsed-time row shares one interval: a turn with a dozen running
 * cards used to register a dozen timers, each forcing its own re-render, and
 * each had to be stopped by its row reaching a terminal status.
 */
export function useNowTick(active: boolean | undefined): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		return subscribe(setNow);
	}, [active]);
	return now;
}
