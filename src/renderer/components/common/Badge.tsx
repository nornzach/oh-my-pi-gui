/**
 * Small status pill with semantic color variants and optional dot indicator.
 */

import type { ReactNode } from "react";

export type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "muted";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
	default: "border-(--omp-border-muted) bg-transparent text-(--omp-text)",
	success: "border-[color-mix(in_srgb,var(--omp-success)_35%,transparent)] bg-transparent text-(--omp-success)",
	warning: "border-[color-mix(in_srgb,var(--omp-warning)_35%,transparent)] bg-transparent text-(--omp-warning)",
	error: "border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent text-(--omp-error)",
	info: "border-[color-mix(in_srgb,var(--omp-link)_35%,transparent)] bg-transparent text-(--omp-link)",
	muted: "border-transparent bg-transparent text-(--omp-dim)",
};

const DOT_CLASSES: Record<BadgeVariant, string> = {
	default: "bg-(--omp-muted)",
	success: "bg-(--omp-success)",
	warning: "bg-(--omp-warning)",
	error: "bg-(--omp-error)",
	info: "bg-(--omp-link)",
	muted: "bg-(--omp-dim)",
};

/** A pulsing dot is the live signal, which takes its color from `currentColor`. */
const PULSE_TEXT_CLASSES: Record<BadgeVariant, string> = {
	default: "text-(--omp-muted)",
	success: "text-(--omp-success)",
	warning: "text-(--omp-warning)",
	error: "text-(--omp-error)",
	info: "text-(--omp-link)",
	muted: "text-(--omp-dim)",
};

export interface BadgeProps {
	variant?: BadgeVariant;
	/** Show a small colored dot before the label. */
	dot?: boolean;
	/** Pulse the dot (e.g. live/running states). */
	pulse?: boolean;
	className?: string;
	children: ReactNode;
}

export function Badge({ variant = "default", dot, pulse, className, children }: BadgeProps) {
	return (
		<span
			className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-px text-omp-xs font-medium leading-4 tracking-wide whitespace-nowrap ${VARIANT_CLASSES[variant]} ${className ?? ""}`.trim()}
		>
			{dot && (
				<span aria-hidden className="relative flex size-1.5">
					<span
						className={
							pulse
								? `omp-signal-light omp-signal-light--active ${PULSE_TEXT_CLASSES[variant]}`
								: `relative inline-flex size-1.5 rounded-full ${DOT_CLASSES[variant]}`
						}
					/>
				</span>
			)}
			{children}
		</span>
	);
}
