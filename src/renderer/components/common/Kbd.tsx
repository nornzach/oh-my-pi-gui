/**
 * Keyboard chips in their two app-wide shapes, so the same key never renders
 * differently from one surface to the next:
 * - `hint`: a quiet inline cue beside a field or title (esc, ⌘K, ⌘,).
 * - `keycap`: a key in a shortcut list, where the chord is the content.
 */

import type { ReactNode } from "react";
import { cx } from "../../lib/format";

const KBD_CLASS = {
	hint: "shrink-0 rounded border border-(--omp-border-muted) px-1.5 py-0.5 font-sans text-omp-xxs text-(--omp-dim)",
	keycap:
		"shrink-0 rounded-md border border-(--omp-border) bg-(--omp-bg-elevated) px-2 py-0.5 font-mono text-omp-sm text-(--omp-muted)",
} as const;

/** The chip's classes, for a control that must look like a key (a remappable keycap button). */
export function kbdClass(variant: keyof typeof KBD_CLASS = "hint"): string {
	return KBD_CLASS[variant];
}

export function Kbd({
	children,
	variant = "hint",
	className,
}: {
	children: ReactNode;
	variant?: keyof typeof KBD_CLASS;
	className?: string;
}) {
	return <kbd className={cx(KBD_CLASS[variant], className)}>{children}</kbd>;
}
