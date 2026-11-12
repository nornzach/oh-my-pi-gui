/**
 * The omp π mark: an arched crossbar, a straight left leg and a right foot that
 * flicks outward, so it reads as a pi (the old inward curl read as a "J").
 * Single source of truth for the glyph geometry; colored via `color` (defaults
 * to currentColor) and sized via `size`. `tile` wraps it in the rounded tile
 * used as the sidebar badge. The app icon (resources/icon-source.svg) is the
 * same geometry on a 1024 grid.
 */
import { cx } from "../../lib/format";

/** Glyph strokes on a 32-unit grid, shared by the plain and tiled forms. */
const GLYPH_PATHS = ["M4.6 7.6 Q16 5.6 27.4 7.6", "M11.2 7.3 V25", "M20.8 7.3 V20.8 C20.8 23.6 22 25 24.3 25"] as const;

function Glyph({ size, stroke }: { size: number; stroke: string }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 32 32"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			className="shrink-0"
		>
			{GLYPH_PATHS.map(d => (
				<path key={d} d={d} stroke={stroke} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
			))}
		</svg>
	);
}

export interface PiLogoProps {
	/** Glyph size in px (the SVG viewport is square). */
	size?: number;
	/** Glyph color (any CSS color); defaults to currentColor. */
	color?: string;
	/** Wrap the glyph in the rounded tile (badge form). */
	tile?: boolean;
	className?: string;
}

export function PiLogo({ size = 16, color, tile, className }: PiLogoProps) {
	if (!tile) {
		return (
			<span className={cx("inline-flex", className)}>
				<Glyph size={size} stroke={color ?? "currentColor"} />
			</span>
		);
	}

	return (
		<span
			className={cx("inline-flex items-center justify-center rounded-md bg-[var(--omp-btn-primary-bg)]", className)}
			style={{ width: size, height: size }}
		>
			{/* Tile glyph is ~62% of the tile, drawn in the button-text color. */}
			<Glyph size={size * 0.62} stroke="var(--omp-btn-primary-text)" />
		</span>
	);
}
