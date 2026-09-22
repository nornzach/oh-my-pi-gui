/**
 * Shared context menu: portal-rendered at cursor/trigger coordinates, with
 * full keyboard support (arrows navigate, Enter selects, Escape closes) and
 * outside-press dismissal. Used by the sidebar mode selector, workspace
 * group menus, and session row menus — one implementation, three surfaces.
 */

import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
	onSelect: () => void;
}

interface ContextMenuProps {
	items: ContextMenuItem[];
	/** Viewport coordinates for the menu's top-left corner. */
	x: number;
	y: number;
	onClose: () => void;
}

export function ContextMenu({ items, x, y, onClose }: ContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [activeIndex, setActiveIndex] = useState(() => items.findIndex(item => !item.disabled));
	const [pos, setPos] = useState({ left: x, top: y });

	// Clamp inside the viewport once mounted (menu height is content-driven).
	useLayoutEffect(() => {
		const el = menuRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const left = Math.min(x, window.innerWidth - rect.width - 8);
		const top = Math.min(y, window.innerHeight - rect.height - 8);
		setPos({ left: Math.max(8, left), top: Math.max(8, top) });
	}, [x, y]);

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
			if (!menuRef.current?.contains(event.target as globalThis.Node | null)) onCloseRef.current();
		};
		const onKey = (event: KeyboardEvent) => {
			if (isImeKeyEvent(event)) return;
			// Tab leaves an open menu for background controls while it stays
			// visible — close instead, per menu-button behavior.
			if (event.key === "Tab") {
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
	}, []);

	// Focus the active item whenever the menu opens or the index moves.
	useEffect(() => {
		menuRef.current?.querySelectorAll<HTMLButtonElement>("[data-menu-item]")[activeIndex]?.focus();
	}, [activeIndex]);

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
			role="menu"
			style={{ left: pos.left, top: pos.top }}
			onKeyDown={event => {
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
			className="omp-pop-in fixed z-50 min-w-44 overflow-hidden rounded-xl border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] py-1 shadow-xl"
		>
			{items.map((item, index) => (
				<button
					key={item.id}
					type="button"
					role="menuitem"
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
