/**
 * Animated SVG spinner with optional label.
 */

import { useT } from "../../lib/i18n";

const SIZES = {
	sm: { box: 12, stroke: 2.5 },
	md: { box: 16, stroke: 2.5 },
	lg: { box: 26, stroke: 3 },
} as const;

export type SpinnerSize = keyof typeof SIZES;

export interface SpinnerProps {
	size?: SpinnerSize;
	/** Optional text rendered beside the spinner. */
	label?: string;
	className?: string;
}

export function Spinner({ size = "md", label, className }: SpinnerProps) {
	const t = useT();
	const { box, stroke } = SIZES[size];
	const svg = (
		<svg
			aria-hidden="true"
			className="animate-spin text-(--omp-accent)"
			fill="none"
			height={box}
			viewBox="0 0 24 24"
			width={box}
		>
			<circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.22" strokeWidth={stroke} />
			<path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeLinecap="round" strokeWidth={stroke} />
		</svg>
	);

	if (!label) {
		return (
			<span className={className ?? "inline-flex"} role="status" aria-label={t("common.loading")}>
				{svg}
			</span>
		);
	}

	return (
		<span
			className={`inline-flex items-center gap-2 text-omp-xs text-(--omp-muted) ${className ?? ""}`.trim()}
			role="status"
		>
			{svg}
			<span>{label}</span>
		</span>
	);
}
