import { Bell } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TaskNotice } from "../../../shared/scheduler-types";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { cx, formatTimeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useSchedulerStore } from "../../stores/scheduler";

const PANEL_WIDTH = 360;
const VIEWPORT_EDGE = 12;

const TONE_DOT: Record<TaskNotice["tone"], string> = {
	done: "bg-(--omp-success)",
	review: "bg-(--omp-accent)",
	failed: "bg-(--omp-error)",
};

/** Unread notices; the list keeps read ones too, newest first. */
export function useUnreadNoticeCount(): number {
	return useSchedulerStore(state => state.notices.reduce((count, notice) => count + (notice.read ? 0 : 1), 0));
}

/**
 * The title bar's notification list: scheduled runs that finished (as each
 * task's notify setting chooses), newest first. A red count marks the unread
 * ones; opening a notice lands on its run and marks it read.
 */
export function NotificationBell({ className }: { className: string }) {
	const t = useT();
	const notices = useSchedulerStore(state => state.notices);
	const unread = useUnreadNoticeCount();
	const [open, setOpen] = useState(false);
	const [style, setStyle] = useState<CSSProperties | null>(null);
	const { mounted, closing } = useOverlayPresence(open);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const place = useCallback(() => {
		const rect = buttonRef.current?.getBoundingClientRect();
		if (!rect) return;
		const viewportWidth = Number.isFinite(window.innerWidth) && window.innerWidth > 0 ? window.innerWidth : 1024;
		const width = Math.min(PANEL_WIDTH, viewportWidth - VIEWPORT_EDGE * 2);
		const left = Math.max(VIEWPORT_EDGE, Math.min(rect.right - width, viewportWidth - width - VIEWPORT_EDGE));
		setStyle({ left, top: rect.bottom + 6, width });
	}, []);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// Claim it: the app-wide Escape handler would otherwise abort the running turn.
			event.preventDefault();
			setOpen(false);
		};
		window.addEventListener("resize", place);
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("resize", place);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open, place]);

	const label = unread > 0 ? t("notices.unread", { count: unread }) : t("notices.title");

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				aria-label={label}
				aria-expanded={open}
				aria-haspopup="dialog"
				title={label}
				data-notification-bell=""
				onClick={() => {
					place();
					setOpen(value => !value);
				}}
				className={cx(className, "relative", open && "bg-[var(--omp-selected-bg)] text-[var(--omp-text)]")}
			>
				<Bell aria-hidden="true" size={16} />
				{unread > 0 && (
					<span
						aria-hidden="true"
						data-notification-count=""
						className="absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-(--omp-error) px-1 text-[9px] leading-none font-semibold text-white tabular-nums"
					>
						{unread > 9 ? "9+" : unread}
					</span>
				)}
			</button>
			{mounted &&
				style &&
				createPortal(
					<div
						ref={panelRef}
						role="dialog"
						aria-label={t("notices.title")}
						aria-hidden={closing || undefined}
						inert={closing}
						style={style}
						className={cx(
							"fixed z-[80] flex max-h-[min(480px,70vh)] flex-col overflow-hidden rounded-2xl border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] shadow-[var(--omp-shadow-lg)]",
							closing ? "omp-scale-out pointer-events-none" : "omp-pop-in",
						)}
					>
						<div className="flex items-center justify-between gap-3 border-b border-[var(--omp-border-muted)] px-4 py-2.5">
							<span className="text-omp-md font-semibold text-[var(--omp-text)]">{t("notices.title")}</span>
							<button
								type="button"
								disabled={unread === 0}
								onClick={() => useSchedulerStore.getState().markAllNoticesRead()}
								className="omp-pressable rounded-md px-1.5 py-0.5 text-omp-sm text-[var(--omp-link)] hover:bg-[var(--omp-selected-bg)] disabled:pointer-events-none disabled:text-[var(--omp-dim)]"
							>
								{t("notices.markAllRead")}
							</button>
						</div>
						{notices.length === 0 ? (
							<p className="px-4 py-6 text-center text-omp-sm text-[var(--omp-dim)]">{t("notices.empty")}</p>
						) : (
							<ul className="min-h-0 overflow-y-auto py-1">
								{notices.map(notice => (
									<li key={notice.id}>
										<button
											type="button"
											data-notice={notice.read ? "read" : "unread"}
											onClick={() => {
												setOpen(false);
												useSchedulerStore.getState().openNotice(notice);
											}}
											className="omp-pressable flex w-full items-start gap-2.5 px-4 py-2 text-left hover:bg-[var(--omp-selected-bg)]"
										>
											<span
												aria-hidden="true"
												className={cx("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[notice.tone])}
											/>
											<span className="min-w-0 flex-1">
												<span
													className={cx(
														"block truncate text-omp-md",
														notice.read
															? "text-[var(--omp-text-secondary)]"
															: "font-semibold text-[var(--omp-text)]",
													)}
												>
													{notice.title}
												</span>
												{notice.body && (
													<span className="line-clamp-2 text-omp-sm text-[var(--omp-dim)]">
														{notice.body}
													</span>
												)}
												<span className="text-omp-xs text-[var(--omp-dim)]">
													{formatTimeAgo(new Date(notice.createdAt).toISOString())}
												</span>
											</span>
											{!notice.read && (
												<span
													role="img"
													aria-label={t("notices.unreadOne")}
													className="mt-2 size-1.5 shrink-0 rounded-full bg-(--omp-error)"
												/>
											)}
										</button>
									</li>
								))}
							</ul>
						)}
					</div>,
					document.body,
				)}
		</>
	);
}
