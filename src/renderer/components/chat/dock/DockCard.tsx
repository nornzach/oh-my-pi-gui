/**
 * DockCard: shared chrome for the center-dock live cards (todo/plan/agents)
 * mounted between the transcript and the composer. Collapse state lives in
 * the ui store so it survives card unmounts (tab switches, content-driven
 * hide/show); `focusDockCard(id)` deep links expand the card and flash a
 * ring — that is how command-palette entries (todo edit, plan-review) land
 * here now that the workspace drawer no longer carries these surfaces.
 */

import { ArrowLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cx } from "../../../lib/format";
import { useT } from "../../../lib/i18n";
import { type DockCardId, useUiStore } from "../../../stores/ui";
import { useWorkspaceDockFocus } from "./WorkspaceDockFocus";

interface DockCardProps {
	id: DockCardId;
	icon: LucideIcon;
	title: string;
	/** Summary chip rendered after the title (counts, status). */
	badge?: ReactNode;
	/** Right-side header controls (view toggles, refresh buttons). */
	actions?: ReactNode;
	/** Body content; WorkspaceDock owns vertical scrolling for every card. */
	children: ReactNode;
}

/** How long the accent ring lingers after a focusDockCard deep link. */
const FOCUS_FLASH_MS = 1200;

export function DockCard({ id, icon: Icon, title, badge, actions, children }: DockCardProps) {
	const t = useT();
	const collapsed = useUiStore(s => s.dockCollapsed[id] ?? false);
	const toggleDockCard = useUiStore(s => s.toggleDockCard);
	const { managed, focusedCard, clearFocus } = useWorkspaceDockFocus();
	const focused = managed && focusedCard === id;
	const hiddenForFocus = managed && focusedCard !== null && !focused;
	const expanded = focused || (!hiddenForFocus && !collapsed);
	const focusSeq = useUiStore(s => (s.dockFocus?.id === id ? s.dockFocus.seq : 0));
	const [flash, setFlash] = useState(false);
	const flashTimer = useRef<number | undefined>(undefined);
	const seenSeq = useRef(focusSeq);

	useEffect(() => {
		if (focusSeq === seenSeq.current) return;
		seenSeq.current = focusSeq;
		clearFocus();
		setFlash(true);
		clearTimeout(flashTimer.current);
		flashTimer.current = window.setTimeout(() => setFlash(false), FOCUS_FLASH_MS);
		return () => clearTimeout(flashTimer.current);
	}, [clearFocus, focusSeq]);

	const toggle = () => {
		if (hiddenForFocus) {
			clearFocus();
			if (collapsed) toggleDockCard(id);
			return;
		}
		if (focused) {
			clearFocus();
			if (!collapsed) toggleDockCard(id);
			return;
		}
		toggleDockCard(id);
	};

	return (
		<section
			aria-label={title}
			className={cx(
				"shrink-0 overflow-clip rounded-[18px] border bg-[color-mix(in_srgb,var(--omp-bg-secondary)_72%,transparent)] transition-shadow duration-300",
				flash
					? "border-[var(--omp-accent)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--omp-accent)_35%,transparent)]"
					: "border-[var(--omp-border)]",
				hiddenForFocus && "opacity-75",
			)}
			data-dock-focused={focused || undefined}
		>
			<div
				className="sticky top-0 z-10 flex min-h-10 items-center gap-2 bg-[var(--omp-bg-secondary)] px-3 py-2" // surface-ok: dock-card sticky navigation chrome
			>
				<button
					aria-expanded={expanded}
					aria-label={expanded ? t("dock.collapse") : t("dock.expand")}
					className="omp-pressable flex min-w-0 flex-1 items-center gap-2 rounded-md text-left"
					onClick={toggle}
					type="button"
				>
					<Icon className="shrink-0 text-[var(--omp-muted)]" size={15} />
					<span className="truncate text-omp-lg font-semibold text-[var(--omp-text)]">{title}</span>
					{badge}
					<span className="min-w-1 flex-1" />
					<ChevronRight
						className="omp-disclosure-chevron shrink-0 text-[var(--omp-dim)]"
						size={14}
						style={{ transform: expanded ? "rotate(90deg)" : undefined }}
					/>
				</button>
				{!hiddenForFocus && focused && (
					<button
						className="omp-pressable flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-omp-xs text-[var(--omp-muted)] hover:text-[var(--omp-text)]"
						onClick={clearFocus}
						type="button"
					>
						<ArrowLeft size={11} />
						{t("dock.backToSummary")}
					</button>
				)}
				{!hiddenForFocus && actions}
			</div>
			{expanded && <div className="border-t border-[var(--omp-border-muted)]">{children}</div>}
		</section>
	);
}
