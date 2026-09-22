/**
 * Destructive-action confirmation: the only place a user says "yes, really"
 * before something irreversible (hard file delete, discarded worktree). The
 * safe action is autofocused, so Enter never confirms by accident.
 */

import type { ReactNode } from "react";
import { useT } from "../../lib/i18n";
import { Button } from "./Button";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
	open: boolean;
	title: string;
	message: ReactNode;
	/** Extra consequence line, rendered in the warning colour. */
	warning?: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	busy?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export function ConfirmDialog({
	open,
	title,
	message,
	warning,
	confirmLabel,
	cancelLabel,
	busy = false,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const t = useT();
	return (
		<Modal bodyClassName="p-4" onClose={onCancel} open={open} size="sm" title={title}>
			<div className="text-omp-md leading-relaxed break-words whitespace-pre-wrap text-(--omp-muted)">{message}</div>
			{warning && <div className="mt-2 text-omp-sm leading-snug text-(--omp-warning)">{warning}</div>}
			<div className="mt-4 flex items-center justify-end gap-2">
				<Button autoFocus onClick={onCancel} size="sm" variant="ghost">
					{cancelLabel ?? t("common.cancel")}
				</Button>
				<Button disabled={busy} onClick={onConfirm} size="sm" variant="danger">
					{confirmLabel ?? t("common.delete")}
				</Button>
			</div>
		</Modal>
	);
}
