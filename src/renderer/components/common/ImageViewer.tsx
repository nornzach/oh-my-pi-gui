/**
 * Images in the conversation open full-window on click. The viewer starts
 * with the whole image in view; a click on it zooms in (to actual size, or
 * twice the fitted size for a small image) and back. Ctrl/⌘+wheel, a
 * trackpad pinch, + / − and 0 zoom too, a zoomed image pans by scrolling or
 * dragging, and Escape, the close button or a click beside the image closes.
 */

import { Maximize, Minus, Plus, X } from "lucide-react";
import {
	type ComponentPropsWithoutRef,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { DIALOG_OVERLAY_Z, isTopmostDialog, registerDialogLayer } from "./dialog-layer";

const MAX_SCALE = 8;
/** Room the fitted image leaves around itself, in CSS pixels. */
const FIT_MARGIN = 48;
/** Pointer travel that turns a press on the image into a drag instead of a click. */
const DRAG_SLOP = 4;

/** An `<img>` that opens the image viewer on click, Enter or Space. */
export function ZoomableImage({ className, onClick, onKeyDown, ...props }: ComponentPropsWithoutRef<"img">) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const src = typeof props.src === "string" ? props.src : undefined;
	const show = (event: ReactMouseEvent<HTMLImageElement> | ReactKeyboardEvent<HTMLImageElement>) => {
		// The image may sit inside a clickable row or bubble: the click is the viewer's.
		event.stopPropagation();
		event.preventDefault();
		setOpen(true);
	};
	return (
		<>
			<img
				{...props}
				aria-haspopup="dialog"
				className={cx(className, src && "cursor-zoom-in")}
				onClick={event => {
					onClick?.(event);
					if (src && !event.defaultPrevented) show(event);
				}}
				onKeyDown={event => {
					onKeyDown?.(event);
					if (src && !event.defaultPrevented && (event.key === "Enter" || event.key === " ")) show(event);
				}}
				role={src ? "button" : undefined}
				tabIndex={src ? 0 : undefined}
				title={props.title ?? (src ? t("imageViewer.open") : undefined)}
			/>
			{open && src && <ImageViewer alt={props.alt ?? ""} onClose={() => setOpen(false)} src={src} />}
		</>
	);
}

interface Size {
	width: number;
	height: number;
}

function fitScale(natural: Size | null, view: Size): number {
	if (!natural || natural.width === 0 || natural.height === 0) return 1;
	return Math.min(
		1,
		Math.max(1, view.width - FIT_MARGIN * 2) / natural.width,
		Math.max(1, view.height - FIT_MARGIN * 2) / natural.height,
	);
}

export function ImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
	const t = useT();
	const overlayRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const [natural, setNatural] = useState<Size | null>(null);
	const [view, setView] = useState<Size>(() => ({ width: window.innerWidth, height: window.innerHeight }));
	/** Null while the image is fitted to the window; zooming never goes below the fit. */
	const [zoom, setZoom] = useState<number | null>(null);
	const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
	/** Where to keep under the pointer after a zoom: image fractions and viewport offsets. */
	const anchor = useRef<{ fx: number; fy: number; vx: number; vy: number } | null>(null);

	const fit = fitScale(natural, view);
	const scale = zoom ?? fit;
	const zoomed = zoom !== null;

	const zoomTo = (next: number | null, at?: { clientX: number; clientY: number }) => {
		const scroller = scrollRef.current;
		const image = scroller?.querySelector("img");
		if (scroller && image && at) {
			const box = image.getBoundingClientRect();
			const frame = scroller.getBoundingClientRect();
			if (box.width > 0 && box.height > 0) {
				anchor.current = {
					fx: (at.clientX - box.left) / box.width,
					fy: (at.clientY - box.top) / box.height,
					vx: at.clientX - frame.left,
					vy: at.clientY - frame.top,
				};
			}
		}
		setZoom(next === null || next <= fit ? null : Math.min(MAX_SCALE, next));
	};

	// Runs after every render; only a zoom leaves an anchor to honour.
	useLayoutEffect(() => {
		const scroller = scrollRef.current;
		const image = scroller?.querySelector("img");
		const point = anchor.current;
		anchor.current = null;
		if (!scroller || !image || !point) return;
		// Keep the point that was under the pointer under it after the size change.
		const box = image.getBoundingClientRect();
		const frame = scroller.getBoundingClientRect();
		scroller.scrollLeft += box.left - frame.left + point.fx * box.width - point.vx;
		scroller.scrollTop += box.top - frame.top + point.fy * box.height - point.vy;
	});

	useEffect(() => {
		const overlay = overlayRef.current;
		const unregister = registerDialogLayer(overlay);
		const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		closeRef.current?.focus();
		const onResize = () => setView({ width: window.innerWidth, height: window.innerHeight });
		const onKey = (event: KeyboardEvent) => {
			if (isImeKeyEvent(event) || !isTopmostDialog(overlay)) return;
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopImmediatePropagation();
				onCloseRef.current();
			}
		};
		window.addEventListener("resize", onResize);
		document.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("resize", onResize);
			document.removeEventListener("keydown", onKey, true);
			unregister();
			restore?.focus();
		};
	}, []);

	useEffect(() => {
		const scroller = scrollRef.current;
		if (!scroller) return;
		// Ctrl/⌘+wheel and trackpad pinches zoom; a plain wheel scrolls the zoomed image.
		const onWheel = (event: WheelEvent) => {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			zoomTo(scale * Math.exp(-event.deltaY * 0.01), event);
		};
		scroller.addEventListener("wheel", onWheel, { passive: false });
		return () => scroller.removeEventListener("wheel", onWheel);
	});

	const onKeyDown = (event: ReactKeyboardEvent) => {
		if (event.key === "+" || event.key === "=") zoomTo(scale * 1.25);
		else if (event.key === "-" || event.key === "_") zoomTo(scale / 1.25);
		else if (event.key === "0") zoomTo(null);
		else return;
		event.preventDefault();
	};

	const onPointerDown = (event: ReactPointerEvent<HTMLImageElement>) => {
		const scroller = scrollRef.current;
		if (event.button !== 0 || !scroller) return;
		drag.current = {
			x: event.clientX,
			y: event.clientY,
			left: scroller.scrollLeft,
			top: scroller.scrollTop,
			moved: false,
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLImageElement>) => {
		const state = drag.current;
		const scroller = scrollRef.current;
		if (!state || !scroller) return;
		const dx = event.clientX - state.x;
		const dy = event.clientY - state.y;
		if (!state.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
		state.moved = true;
		scroller.scrollLeft = state.left - dx;
		scroller.scrollTop = state.top - dy;
	};

	const onImageClick = (event: ReactMouseEvent<HTMLImageElement>) => {
		const dragged = drag.current?.moved === true;
		drag.current = null;
		if (dragged) return;
		zoomTo(zoomed ? null : Math.max(1, fit * 2), event);
	};

	const iconButton =
		"rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40";

	return createPortal(
		<div
			aria-label={alt || t("imageViewer.title")}
			aria-modal="true"
			className={`omp-fade-in fixed inset-0 ${DIALOG_OVERLAY_Z} bg-black/85`}
			data-image-viewer
			onKeyDown={onKeyDown}
			ref={overlayRef}
			role="dialog"
			tabIndex={-1}
		>
			<div
				className="flex size-full overflow-auto"
				onClick={event => {
					if (event.target === event.currentTarget) onClose();
				}}
				ref={scrollRef}
				role="presentation"
			>
				<img
					alt={alt}
					className={cx(
						"m-auto block max-w-none shrink-0 select-none",
						zoomed ? "cursor-zoom-out active:cursor-grabbing" : "cursor-zoom-in",
					)}
					draggable={false}
					onClick={onImageClick}
					onLoad={event =>
						setNatural({
							width: event.currentTarget.naturalWidth,
							height: event.currentTarget.naturalHeight,
						})
					}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					src={src}
					style={
						natural
							? { width: natural.width * scale, height: natural.height * scale }
							: { maxWidth: `calc(100vw - ${FIT_MARGIN * 2}px)`, maxHeight: `calc(100vh - ${FIT_MARGIN * 2}px)` }
					}
				/>
			</div>
			<div className="absolute top-3 right-3 flex items-center gap-1 rounded-xl bg-black/60 p-1 text-omp-sm text-white/80">
				<button
					aria-label={t("imageViewer.zoomOut")}
					className={iconButton}
					disabled={!zoomed}
					onClick={() => zoomTo(scale / 1.25)}
					title={t("imageViewer.zoomOut")}
					type="button"
				>
					<Minus size={15} />
				</button>
				<span className="min-w-12 text-center tabular-nums" data-zoom-level>
					{Math.round(scale * 100)}%
				</span>
				<button
					aria-label={t("imageViewer.zoomIn")}
					className={iconButton}
					disabled={scale >= MAX_SCALE}
					onClick={() => zoomTo(scale * 1.25)}
					title={t("imageViewer.zoomIn")}
					type="button"
				>
					<Plus size={15} />
				</button>
				<button
					aria-label={t("imageViewer.fit")}
					className={iconButton}
					disabled={!zoomed}
					onClick={() => zoomTo(null)}
					title={t("imageViewer.fit")}
					type="button"
				>
					<Maximize size={15} />
				</button>
				<button
					aria-label={t("common.close")}
					className={iconButton}
					onClick={onClose}
					ref={closeRef}
					title={t("common.close")}
					type="button"
				>
					<X size={15} />
				</button>
			</div>
		</div>,
		document.body,
	);
}
