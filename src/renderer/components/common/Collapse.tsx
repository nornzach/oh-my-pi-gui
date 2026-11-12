/**
 * Height-animated disclosure body. Replaces `{open && <div>…</div>}`, which
 * snaps: the body stays mounted through its exit and both directions animate
 * `grid-template-rows` between 0fr and 1fr, so no height is ever measured.
 */

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { cx } from "../../lib/format";

/** Longer than the open transition (--omp-motion-slow), so it only covers a missed transitionend. */
const SETTLE_FALLBACK_MS = 600;

export interface CollapseProps {
	open: boolean;
	children: ReactNode;
	className?: string;
}

export function Collapse({ open, children, className }: CollapseProps) {
	const { mounted, closing } = useOverlayPresence(open);
	// Bodies that start open render open: only a toggle animates, never a mount.
	const [shown, setShown] = useState(open);
	// Clipping is only needed while the height moves; once settled open it is
	// lifted so focus rings and in-body popovers are not cut off.
	const [settled, setSettled] = useState(open);

	const ref = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		if (!open) {
			setShown(false);
			setSettled(false);
			return;
		}
		// Flush style on the collapsed frame so the 0fr -> 1fr change has a start.
		void ref.current?.offsetHeight;
		setShown(true);
		// transitionend never comes when nothing moved (a body opened while
		// hidden, or one with no height), which would leave it clipped.
		const fallback = window.setTimeout(() => setSettled(true), SETTLE_FALLBACK_MS);
		return () => window.clearTimeout(fallback);
	}, [open]);

	if (!mounted) return null;
	return (
		<div
			ref={ref}
			aria-hidden={closing || undefined}
			className={cx("omp-collapse", className)}
			data-open={shown}
			data-settled={settled && shown}
			inert={closing || undefined}
			onTransitionEnd={event => {
				if (event.target === event.currentTarget && open) setSettled(true);
			}}
		>
			<div className="omp-collapse-inner">{children}</div>
		</div>
	);
}
