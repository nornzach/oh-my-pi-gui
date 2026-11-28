import { useEffect, useRef } from "react";
import { useT } from "../../lib/i18n";
import { onEscape } from "../../lib/keymap";
import { Button } from "./Button";
import type { ConfirmDialogProps } from "./ConfirmDialog";

export function InlineConfirm({
	title,
	message,
	warning,
	confirmLabel,
	busy,
	onConfirm,
	onCancel,
}: Omit<ConfirmDialogProps, "open" | "cancelLabel">) {
	const t = useT();
	const root = useRef<HTMLDivElement>(null);
	const state = useRef({ busy, onCancel });
	state.current = { busy, onCancel };
	useEffect(() => {
		const previous = document.activeElement;
		root.current?.querySelector("button")?.focus();
		const outside = (event: PointerEvent) => {
			if (!state.current.busy && !root.current?.contains(event.target as Node)) state.current.onCancel();
		};
		document.addEventListener("pointerdown", outside);
		return () => {
			document.removeEventListener("pointerdown", outside);
			if (document.activeElement === document.body && previous instanceof HTMLElement && previous.isConnected)
				previous.focus();
		};
	}, []);
	return (
		<div
			ref={root}
			role="group"
			aria-label={title}
			data-owns-escape=""
			onKeyDown={event => {
				if (
					onEscape(event, () => {
						if (!busy) onCancel();
					})
				)
					event.stopPropagation();
			}}
			className="min-w-0 rounded-lg border border-(--omp-border-muted) bg-(--omp-selected-bg) px-2.5 py-2 text-omp-sm"
		>
			<p className="break-words text-(--omp-text-secondary)">{message}</p>
			{warning && <p className="mt-1 text-(--omp-warning)">{warning}</p>}
			<div className="mt-1 flex flex-wrap justify-end gap-1">
				<Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
					{t("common.cancel")}
				</Button>
				<Button size="sm" variant="danger" disabled={busy} onClick={onConfirm}>
					{confirmLabel ?? t("common.delete")}
				</Button>
			</div>
		</div>
	);
}
