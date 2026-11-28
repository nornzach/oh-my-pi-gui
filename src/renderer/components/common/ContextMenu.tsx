/**
 * Shared context menu: portal-rendered at cursor/trigger coordinates, with
 * full keyboard support (arrows navigate, Enter selects, Escape closes) and
 * outside-press dismissal. The one context menu for the whole app — sidebar,
 * tab strip, title bar, composer, panels and agent views all use it.
 */

import type { LucideIcon } from "lucide-react";
import { type DragEventHandler, type ReactElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "../../lib/format";
import { isImeKeyEvent } from "../../lib/ime";

export interface ContextMenuItem {
	/** Stable id for keyboard focus tracking. */
	id: string;
	label: string;
	description?: string;
	icon?: LucideIcon;
	/** Right-aligned hint text (e.g. a chord). */
	hint?: string;
	/** Danger styling (destructive actions like delete). */
	danger?: boolean;
	/** Disabled items render but never fire. */
	disabled?: boolean;
	disabledReason?: string;
	checked?: boolean;
	current?: boolean;
	onDragOver?: DragEventHandler<HTMLElement>;
	onDrop?: DragEventHandler<HTMLElement>;
	onSelect: () => void;
}

interface ContextMenuProps {
	items: ContextMenuItem[];
	editor?: ReactElement;
	/** Viewport coordinates for the menu's top-left corner (bottom-left with `placement="above"`). */
	x: number;
	y: number;
	/** `above` grows the menu upward from `y` — for triggers near the bottom edge, like the composer. */
	placement?: "below" | "above";
	label?: string;
	trigger?: HTMLElement | null;
	onClose: () => void;
}

export function ContextMenu({ items, editor, x, y, placement = "below", label, trigger, onClose }: ContextMenuProps) {
	const editing = !!editor;
	const menuRef = useRef<HTMLDivElement>(null);
	const [activeIndex, setActiveIndex] = useState(() => items.findIndex(item => !item.disabled));
	const [pos, setPos] = useState({ left: x, top: y });

	// Clamp inside the viewport once mounted (menu height is content-driven).
	useLayoutEffect(() => {
		const el = menuRef.current;
		if (!el) return;
		const left = Math.min(x, window.innerWidth - el.offsetWidth - 8);
		const top = placement === "above" ? y - el.offsetHeight : Math.min(y, window.innerHeight - el.offsetHeight - 8);
		setPos({ left: Math.max(8, left), top: Math.max(8, top) });
	}, [x, y, placement]);

	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		// Restore focus to the element that opened the menu — unmounting the
		// focused item otherwise drops focus to <body>. The restore runs ONLY
		// on unmount (onClose is read through a ref): re-running per render
		// would steal focus back to the trigger while the menu stays open.
		const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const onDown = (event: PointerEvent) => {
			// The trigger opens this menu from `click`, so its preceding pointerdown
			// has already finished before this effect is installed. Listening for the
			// next pointer press avoids treating the opening click itself as an
			// outside dismissal while still closing before a later outside click.
			const target = event.target as globalThis.Node | null;
			if (!menuRef.current?.contains(target) && !trigger?.contains(target)) onCloseRef.current();
		};
		const onKey = (event: KeyboardEvent) => {
			if (isImeKeyEvent(event)) return;
			// Tab leaves an open menu for background controls while it stays
			// visible — close instead, per menu-button behavior.
			if (!editing && event.key === "Tab") {
				event.preventDefault();
				onCloseRef.current();
			}
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey, true);
			if (restore?.isConnected) restore.focus();
		};
	}, [trigger, editing]);

	// Focus the active item whenever the menu opens or the index moves.
	useEffect(() => {
		if (editing) return;
		const active = menuRef.current?.querySelectorAll<HTMLButtonElement>("[data-menu-item]")[activeIndex];
		(active ?? menuRef.current)?.focus();
	}, [activeIndex, editing]);

	const step = (delta: number) => {
		setActiveIndex(current => {
			for (let i = 1; i <= items.length; i++) {
				const next = (current + delta * i + items.length) % items.length;
				if (!items[next]?.disabled) return next;
			}
			return current;
		});
	};

	return createPortal(
		<div
			ref={menuRef}
			role={editing ? "group" : "menu"}
			tabIndex={-1}
			aria-label={label}
			style={{ left: pos.left, top: pos.top }}
			onKeyDown={event => {
				if (editing) return;
				if (event.key === "Escape") {
					event.preventDefault();
					// The menu owns this keypress: without stopping it, a dialog behind
					// the menu takes the same Escape and closes with it.
					event.stopPropagation();
					onClose();
				} else if (event.key === "ArrowDown") {
					event.preventDefault();
					step(1);
				} else if (event.key === "ArrowUp") {
					event.preventDefault();
					step(-1);
				} else if (event.key === "Enter") {
					event.preventDefault();
					const item = items[activeIndex];
					if (item && !item.disabled) item.onSelect();
				}
			}}
			className="no-drag omp-pop-in fixed z-50 max-h-[min(70vh,32rem)] min-w-44 max-w-[min(28rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] py-1 shadow-xl"
		>
			{editor ??
				items.map((item, index) => (
					<button
						key={item.id}
						type="button"
						role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
						aria-checked={item.checked}
						aria-current={item.current ? "page" : undefined}
						onDragOver={event => {
							item.onDragOver?.(event);
							if (event.defaultPrevented) setActiveIndex(index);
						}}
						onDrop={item.onDrop}
						data-menu-item
						disabled={item.disabled}
						title={item.disabled ? item.disabledReason : item.label}
						onClick={() => {
							if (item.disabled) return;
							item.onSelect();
						}}
						onMouseEnter={() => setActiveIndex(index)}
						className={cx(
							"flex w-full items-center gap-2 px-3 py-2 text-left text-omp-md hover:bg-[var(--omp-selected-bg)]",
							item.danger ? "text-[var(--omp-error)]" : "text-[var(--omp-text)]",
							index === activeIndex && "bg-[var(--omp-selected-bg)]",
							item.disabled && "cursor-not-allowed opacity-70",
						)}
					>
						{item.icon && (
							<item.icon
								size={13}
								className={cx("shrink-0", item.danger ? "text-[var(--omp-error)]" : "text-[var(--omp-muted)]")}
							/>
						)}
						<span className="min-w-0 flex-1">
							<span className="block truncate">{item.label}</span>
							{item.description && (
								<span className="mt-0.5 block text-omp-xs font-normal text-[var(--omp-dim)]">
									{item.description}
								</span>
							)}
						</span>
						{item.hint && <span className="text-omp-xs text-[var(--omp-dim)]">{item.hint}</span>}
					</button>
				))}
		</div>,
		document.body,
	);
}

/** Cursor-anchored menu state for right-click surfaces. */
export interface ContextMenuAnchor {
	x: number;
	y: number;
}

export function anchorFromEvent(event: {
	clientX: number;
	clientY: number;
	preventDefault(): void;
}): ContextMenuAnchor {
	event.preventDefault();
	return { x: event.clientX, y: event.clientY };
}
