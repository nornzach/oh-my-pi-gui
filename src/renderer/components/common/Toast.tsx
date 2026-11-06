/**
 * Toasts sit below the top navigation and any banners there (whose buttons they
 * would otherwise cover), clear of composer send/stop controls.
 * Auto-dismisses via a single pruning interval; slide-in per toast.
 *
 * A built-in browser page is a native view drawn over the whole window, so
 * toasts step left of the browser viewport when there is room; otherwise the
 * panel treats them as an overlay (`.omp-toast`) and shows a still instead.
 */

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../lib/i18n";
import { type ToastVariant, useToastStore } from "../../stores/toast";

const VARIANT_STYLES: Record<ToastVariant, { border: string; icon: string; Icon: typeof Info }> = {
	info: { border: "border-l-(--omp-link)", icon: "text-(--omp-link)", Icon: Info },
	success: { border: "border-l-(--omp-success)", icon: "text-(--omp-success)", Icon: CheckCircle2 },
	warning: { border: "border-l-(--omp-warning)", icon: "text-(--omp-warning)", Icon: AlertTriangle },
	error: { border: "border-l-(--omp-error)", icon: "text-(--omp-error)", Icon: XCircle },
};

/** Default column: `top-28 right-4 w-80`. */
const STACK_TOP = 112;
const STACK_GAP = 16;
const STACK_WIDTH = 320;
const BANNERS = "[data-toast-clearance]";

/** `right` offset that keeps the stack clear of the browser viewport, or null for the default column. */
function stackRightOffset(): number | null {
	const viewport = document.querySelector(".omp-browser-viewport")?.getBoundingClientRect();
	if (!viewport || viewport.width === 0 || viewport.height === 0) return null;
	const defaultLeft = window.innerWidth - STACK_GAP - STACK_WIDTH;
	if (viewport.right <= defaultLeft || viewport.bottom <= STACK_TOP) return null;
	if (viewport.left < STACK_WIDTH + STACK_GAP * 2) return null;
	return window.innerWidth - viewport.left + STACK_GAP;
}

/** The default column's top, or just below the banners once they reach past it. */
function stackTop(): number {
	const banners = document.querySelector(BANNERS)?.getBoundingClientRect();
	if (!banners || banners.height === 0) return STACK_TOP;
	return Math.max(STACK_TOP, banners.bottom + STACK_GAP / 2);
}

export function ToastStack() {
	const t = useT();
	const toasts = useToastStore(state => state.toasts);
	const dismiss = useToastStore(state => state.dismiss);
	const pruneExpired = useToastStore(state => state.pruneExpired);

	useEffect(() => {
		if (toasts.length === 0) return;
		const timer = setInterval(pruneExpired, 500);
		return () => clearInterval(timer);
	}, [toasts.length, pruneExpired]);

	const [right, setRight] = useState<number | null>(null);
	const [top, setTop] = useState(STACK_TOP);
	const visible = toasts.length > 0;
	useLayoutEffect(() => {
		if (!visible) return;
		const place = (): void => {
			setRight(stackRightOffset());
			setTop(stackTop());
		};
		place();
		window.addEventListener("resize", place);
		// A banner can appear, or expand, while a toast is up.
		const banners = document.querySelector(BANNERS);
		const observer = banners && typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
		if (banners) observer?.observe(banners);
		return () => {
			window.removeEventListener("resize", place);
			observer?.disconnect();
		};
	}, [visible]);

	if (!visible) return null;

	return createPortal(
		<div
			aria-live="polite"
			className="pointer-events-none fixed right-4 z-[70] flex w-80 flex-col gap-2"
			style={right === null ? { top } : { top, right }}
		>
			{toasts.map(entry => {
				const style = VARIANT_STYLES[entry.variant];
				const Icon = style.Icon;
				return (
					<div
						className={`omp-toast flex items-start gap-2.5 rounded-xl border border-(--omp-border-muted) border-l-2 bg-(--omp-toast-bg) px-3 py-2.5 shadow-(--omp-shadow-lg) ${style.border} ${entry.exitingAt != null ? "pointer-events-none omp-toast-out" : "pointer-events-auto omp-toast-in"}`}
						key={entry.id}
						role={entry.variant === "error" ? "alert" : "status"}
					>
						<Icon className={`mt-px shrink-0 ${style.icon}`} size={14} />
						<div className="min-w-0 flex-1">
							{entry.title && (
								<div className="mb-0.5 text-omp-sm font-semibold text-(--omp-text)">{entry.title}</div>
							)}
							<div className="text-omp-sm leading-snug break-words text-(--omp-muted)">{entry.message}</div>
						</div>
						{entry.count > 1 && (
							<span
								className="shrink-0 rounded-full border border-(--omp-border-muted) px-1.5 py-0.5 text-omp-xs font-semibold tabular-nums text-(--omp-muted)"
								title={t("toast.repeated", { count: entry.count })}
							>
								×{entry.count}
							</span>
						)}
						<button
							aria-label={t("common.close")}
							className="shrink-0 rounded p-0.5 text-(--omp-dim) transition-colors hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
							onClick={() => dismiss(entry.id)}
							type="button"
						>
							<X size={12} />
						</button>
					</div>
				);
			})}
		</div>,
		document.body,
	);
}
