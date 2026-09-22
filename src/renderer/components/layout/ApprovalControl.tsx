/**
 * Composer approval-mode control (Codex-style "full access" chip): shows the
 * current tool-approval mode and switches it at RUNTIME via the shared settings
 * store (`setApprovalMode` → `set_setting("tools.approvalMode", …)`), which the
 * agent reads fresh on every approval decision — applies immediately, no
 * sidecar restart. The dropdown renders in a portal so the composer's
 * overflow-hidden never clips it.
 */

import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { type ApprovalMode, useSettingsStore } from "../../stores/settings";

const MODES: ApprovalMode[] = ["yolo", "write", "always-ask"];

export function ApprovalControl() {
	const t = useT();
	const mode = useSettingsStore(s => s.approvalMode);
	const setApprovalMode = useSettingsStore(s => s.setApprovalMode);
	const [open, setOpen] = useState(false);
	const { mounted, closing } = useOverlayPresence(open);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

	// Position the portal menu above the trigger whenever it opens.
	useLayoutEffect(() => {
		if (!open || !triggerRef.current) return;
		const rect = triggerRef.current.getBoundingClientRect();
		setPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6 });
	}, [open]);

	// Close on outside pointer press, and consume Escape (focus restored to
	// the trigger) so it cannot fall through to the global abort handler.
	useEffect(() => {
		if (!open) return;
		const onDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (isImeKeyEvent(event)) return;
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
			triggerRef.current?.focus();
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [open]);

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen(value => !value)}
				title={t("input.approval.title", { mode: t(`input.approval.${mode}`) })}
				className={cx(
					"omp-pressable flex h-8 items-center gap-1.5 rounded-lg px-2 text-omp-md font-medium hover:bg-[var(--omp-selected-bg)]",
					mode === "yolo" ? "text-[var(--omp-accent)]" : "text-[var(--omp-muted)]",
				)}
			>
				<ShieldCheck size={14} />
				<span className="omp-composer-control-label hidden sm:inline">{t(`input.approval.${mode}`)}</span>
				<ChevronDown size={12} className="shrink-0 text-[var(--omp-dim)]" />
			</button>

			{mounted && pos
				? createPortal(
						<div
							ref={menuRef}
							style={{ left: pos.left, bottom: pos.bottom }}
							aria-hidden={closing || undefined}
							inert={closing}
							className={cx(
								"fixed z-[100] w-56 overflow-hidden rounded-xl border border-[var(--omp-border)] bg-[var(--omp-panel-bg)] p-1 shadow-[var(--omp-shadow-md)]",
								closing ? "omp-scale-out pointer-events-none" : "omp-pop-in",
							)}
						>
							{MODES.map(option => {
								const active = option === mode;
								return (
									<button
										key={option}
										type="button"
										onClick={() => {
											setOpen(false);
											setApprovalMode(option);
										}}
										className="omp-pressable flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--omp-selected-bg)]"
									>
										<span className="mt-0.5 w-4 shrink-0 text-[var(--omp-accent)]">
											{active ? <Check size={14} /> : null}
										</span>
										<span className="min-w-0 flex-1">
											<span
												className={cx(
													"block text-omp-md font-medium",
													active ? "text-[var(--omp-text)]" : "text-[var(--omp-muted)]",
												)}
											>
												{t(`input.approval.${option}`)}
											</span>
											<span className="block text-omp-sm leading-snug text-[var(--omp-dim)]">
												{t(`input.approval.${option}.desc`)}
											</span>
										</span>
									</button>
								);
							})}
						</div>,
						document.body,
					)
				: null}
		</>
	);
}
