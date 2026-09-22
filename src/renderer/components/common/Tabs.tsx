/**
 * Horizontal tab bar with an animated active indicator and roving
 * arrow-key keyboard navigation.
 */

import { type KeyboardEvent, useRef } from "react";

export interface TabItem {
	id: string;
	label: string;
	/** Optional badge count or marker rendered after the label. */
	badge?: string | number;
	disabled?: boolean;
}

export interface TabsProps {
	tabs: TabItem[];
	activeId: string;
	onChange: (id: string) => void;
	/** Compact reduces padding/size for panel headers. */
	compact?: boolean;
	className?: string;
	ariaLabel?: string;
}

export function Tabs({ tabs, activeId, onChange, compact, className, ariaLabel }: TabsProps) {
	const listRef = useRef<HTMLDivElement>(null);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") {
			return;
		}
		const enabled = tabs.filter(tab => !tab.disabled);
		if (enabled.length === 0) return;
		event.preventDefault();
		const current = enabled.findIndex(tab => tab.id === activeId);
		let next: number;
		if (event.key === "Home") next = 0;
		else if (event.key === "End") next = enabled.length - 1;
		else if (event.key === "ArrowRight") next = (current + 1) % enabled.length;
		else next = (current - 1 + enabled.length) % enabled.length;
		onChange(enabled[next].id);
		requestAnimationFrame(() => {
			listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(enabled[next].id)}"]`)?.focus();
		});
	};

	return (
		<div
			aria-label={ariaLabel}
			className={`flex items-center gap-0.5 border-b border-(--omp-border-muted) ${className ?? ""}`.trim()}
			onKeyDown={onKeyDown}
			ref={listRef}
			role="tablist"
		>
			{tabs.map(tab => {
				const active = tab.id === activeId;
				return (
					<button
						aria-selected={active}
						className={`relative -mb-px shrink-0 border-b-2 font-medium whitespace-nowrap transition-colors duration-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--omp-border-accent) disabled:cursor-not-allowed disabled:opacity-70 ${
							compact ? "px-2 py-1 text-omp-sm" : "px-3 py-1.5 text-xs"
						} ${
							active
								? "border-(--omp-accent) text-(--omp-text)"
								: "border-transparent text-(--omp-muted) hover:text-(--omp-text)"
						}`.trim()}
						data-tab-id={tab.id}
						disabled={tab.disabled}
						key={tab.id}
						onClick={() => onChange(tab.id)}
						role="tab"
						tabIndex={active ? 0 : -1}
						type="button"
					>
						{tab.label}
						{tab.badge !== undefined && (
							<span className="ml-1.5 rounded-full border border-(--omp-border-muted) bg-transparent px-1.5 py-px text-omp-xxs tabular-nums text-(--omp-muted)">
								{tab.badge}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
