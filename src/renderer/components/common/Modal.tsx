/**
 * Overlay + centered panel. Backdrop click and Escape close; focus is trapped
 * while open and restored to the previously focused element on close.
 */

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { isTopmostDialog, registerDialogLayer } from "./dialog-layer";

export type ModalSize = "sm" | "md" | "lg" | "full" | "picker";

/** Overlay alignment: centered (default) or top-anchored (command-palette style). */
export type ModalPlacement = "center" | "top";

const SIZE_CLASSES: Record<ModalSize, string> = {
	sm: "omp-dialog-size-sm",
	md: "omp-dialog-size-md",
	lg: "omp-dialog-size-lg",
	full: "omp-dialog-size-full",
	picker: "omp-dialog-size-picker",
};

const FOCUSABLE =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
	open: boolean;
	onClose: () => void;
	title?: ReactNode;
	size?: ModalSize;
	/** Hide the title bar entirely (chromeless dialogs like the command palette). */
	chromeless?: boolean;
	/** Overlay alignment: centered (default) or top-anchored palette style. */
	placement?: ModalPlacement;
	/** Accessible name for the dialog (required when chromeless — no visible title). */
	ariaLabel?: string;
	/** Extra classes for the panel. */
	panelClassName?: string;
	/**
	 * Body container classes. Defaults to `px-5 py-4` so the body aligns with the
	 * title bar (also px-5). Pass "p-0" for dialogs that manage their own inner
	 * layout (Settings, chromeless pickers, tree/hub windows).
	 */
	bodyClassName?: string;
	children: ReactNode;
}

export function Modal({
	open,
	onClose,
	title,
	size = "md",
	chromeless,
	placement = "center",
	ariaLabel,
	panelClassName,
	bodyClassName = "px-5 py-4",
	children,
}: ModalProps) {
	const t = useT();
	const titleId = useId();
	const panelRef = useRef<HTMLDivElement>(null);
	const restoreRef = useRef<HTMLElement | null>(null);
	const onCloseRef = useRef(onClose);
	// Exit phase lives in the shared overlay-presence hook: `mounted` — not `open` —
	// gates the portal, the phase starts in the SAME commit's effect while the panel
	// is still in the DOM, and reduced motion skips straight to unmount.
	const { mounted, closing } = useOverlayPresence(open);
	onCloseRef.current = onClose;

	// What actually animates out. A dialog whose payload clears on close rebuilds
	// its children from `null`, so the fading panel would collapse to an empty box;
	// holding the tree from the last open commit lets callers drop their own
	// `if (!payload) return null` gate and pass `open` instead.
	const shownRef = useRef<{ ariaLabel?: string; body: ReactNode; title: ReactNode } | null>(null);
	if (open) shownRef.current = { ariaLabel, body: children, title };
	const shown = shownRef.current;

	// Focus + keyboard + layer scope all live with `open`: the layer releases
	// the moment close begins, handing Escape to the dialog beneath even while
	// this one plays its 240ms exit animation.
	useEffect(() => {
		if (!open) return;
		const unregisterLayer = registerDialogLayer(panelRef.current);
		restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const panel = panelRef.current;
		const active = document.activeElement;
		// Preserve a caller-autofocused control inside the new dialog, but never
		// leave focus on its trigger or on a dialog now covered by this one.
		if (!(active instanceof HTMLElement && panel?.contains(active))) {
			const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
			(first ?? panel)?.focus();
		}

		const onKeyDown = (event: KeyboardEvent) => {
			// A live IME composition owns Escape (candidate dismissal). Chromium can
			// retain the legacy 229 code after composition ends; an explicitly resolved
			// Escape with isComposing=false must still close the dialog.
			if (isImeKeyEvent(event)) return;
			// Include fullscreen/custom dialogs that do not use Modal in the layer
			// decision; a modal hidden beneath Settings must remain untouched.
			if (!isTopmostDialog(panel)) return;
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopImmediatePropagation();
				event.stopPropagation();
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab" || !panel) return;
			const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
			if (items.length === 0) {
				event.preventDefault();
				panel.focus();
				return;
			}
			const firstEl = items[0];
			const lastEl = items[items.length - 1];
			if (event.shiftKey && document.activeElement === firstEl) {
				event.preventDefault();
				lastEl.focus();
			} else if (!event.shiftKey && document.activeElement === lastEl) {
				event.preventDefault();
				firstEl.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			const wasTopmost = isTopmostDialog(panel);
			unregisterLayer();
			if (wasTopmost) restoreRef.current?.focus();
		};
	}, [open]);

	// Render on the opening commit so the focus/layer effect sees a real panel.
	// `mounted` only extends the closing phase for the exit animation.
	if (!mounted || !shown) return null;

	return createPortal(
		<div
			className={`omp-dialog-overlay ${closing ? "omp-fade-out" : "omp-fade-in"} fixed inset-0 z-50 flex justify-center bg-(--omp-overlay-bg) p-4 backdrop-blur-[6px] ${placement === "top" ? "items-start pt-[12dvh]" : "items-center"}`}
			inert={closing}
			onMouseDown={event => {
				if (closing) return;
				if (event.target === event.currentTarget) onClose();
			}}
			role="presentation"
		>
			<div
				aria-label={shown.ariaLabel ?? (typeof shown.title === "string" ? shown.title : undefined)}
				aria-labelledby={!chromeless && shown.title ? titleId : undefined}
				aria-modal={!closing}
				className={`omp-dialog-panel ${closing ? "omp-scale-out" : "omp-scale-in"} flex flex-col overflow-hidden rounded-2xl border border-(--omp-modal-border) bg-(--omp-modal-bg) shadow-(--omp-shadow-lg) ${SIZE_CLASSES[size]} ${panelClassName ?? ""}`.trim()}
				onKeyDown={event => {
					if (event.key === "Escape") event.stopPropagation();
				}}
				ref={panelRef}
				// An exiting panel drops out of the dialog role: isTopmostDialog's
				// DOM fallback must not treat the animating portal as a covering
				// layer, or Escape cannot reach the dialog beneath.
				role={closing ? "presentation" : "dialog"}
				tabIndex={-1}
			>
				{!chromeless && (
					<div className="flex shrink-0 items-center justify-between gap-3 border-b border-(--omp-border-muted) px-5 py-3.5">
						<div
							id={titleId}
							className="min-w-0 truncate text-omp-xl font-semibold tracking-[-0.01em] text-(--omp-text)"
						>
							{shown.title}
						</div>
						<button
							aria-label={t("common.close")}
							className="rounded-lg p-1.5 text-(--omp-muted) transition-colors hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text) focus-visible:outline-2 focus-visible:outline-(--omp-accent)"
							onClick={onClose}
							type="button"
						>
							<X size={15} />
						</button>
					</div>
				)}
				<div className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName}`.trim()}>{shown.body}</div>
			</div>
		</div>,
		document.body,
	);
}
