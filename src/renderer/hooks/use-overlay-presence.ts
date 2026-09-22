import { useEffect, useState } from "react";

/**
 * Duration of every overlay exit animation. The closing classes animate at
 * `--omp-motion-fast`; unmount waits exactly that long so the last painted
 * frame of the exit is the frame the element disappears on.
 */
export const OVERLAY_EXIT_MS = 150;

/** True when the OS asks for reduced motion; exit phases are skipped then. */
export function prefersReducedMotion(): boolean {
	if (typeof window.matchMedia !== "function") return false;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface OverlayPresence {
	/** Render gate: true while the overlay is open or still playing its exit animation. */
	mounted: boolean;
	/** Exit phase: the overlay is already logically closed and only animating out. */
	closing: boolean;
}

type Phase = "closed" | "open" | "closing";

/**
 * Keep a conditionally rendered overlay mounted for its exit animation.
 *
 * Every dismissal route flips `open` in the same commit that used to remove the
 * element, so the closing keyframe never painted and the surface vanished
 * instantly. Deriving the exit from `open` — rather than from one close callsite —
 * means hover-out, Escape, outside press and selection all animate the same way.
 *
 * Both transitions happen during render, never in an effect: a dialog that only
 * appears in the commit *after* `open` flips misses its own post-commit work —
 * its panel is still null when the Escape listener and focus trap are installed,
 * so the overlay opens and then refuses to close.
 *
 * `closing` NEVER gates interactivity: the overlay is logically closed the moment
 * `open` flips, so callers keep their `open` checks for handlers and ARIA state and
 * hide the exiting element from assistive tech instead of leaving it actionable.
 */
export function useOverlayPresence(open: boolean): OverlayPresence {
	const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
	if (open && phase !== "open") setPhase("open");
	else if (!open && phase === "open") setPhase(prefersReducedMotion() ? "closed" : "closing");

	useEffect(() => {
		if (phase !== "closing") return;
		const timer = setTimeout(() => setPhase("closed"), OVERLAY_EXIT_MS);
		return () => clearTimeout(timer);
	}, [phase]);

	return { closing: phase === "closing", mounted: phase !== "closed" };
}
