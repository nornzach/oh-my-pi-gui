import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Rename session dialog: single text input prefilled with the current
 * session name; submits via rpc.setSessionName and mirrors the result into
 * the session store (the sidecar does not push a name update by itself).
 */

import { useEffect, useRef, useState } from "react";
import { useT } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Input, Modal } from "../common";

export function RenameSessionDialog() {
	const tabRpc = useTabRpc();
	const t = useT();
	const open = useUiStore(state => state.renameDialogOpen);
	const close = useUiStore(state => state.closeRenameDialog);
	const sessionName = useSessionStore(state => state.sessionName);
	const sidecarReady = useSessionStore(state => state.status) === "ready";

	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) return;
		setName(sessionName ?? "");
		setSaving(false);
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	}, [open, sessionName]);

	const submit = async () => {
		const trimmed = name.trim();
		if (!sidecarReady || !trimmed || saving) return;
		setSaving(true);
		try {
			const response = await tabRpc.setSessionName(trimmed);
			if (!response.success) {
				toast({ variant: "error", title: t("rename.failed"), message: response.error });
				return;
			}
			useSessionStore.setState({ sessionName: trimmed });
			close();
		} catch (error) {
			toast({ variant: "error", title: t("rename.failed"), message: String(error) });
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal open={open} onClose={close} title={t("rename.title")} size="sm">
			<form
				className="flex flex-col gap-3"
				onSubmit={event => {
					event.preventDefault();
					void submit();
				}}
			>
				<Input
					ref={inputRef}
					label={t("rename.label")}
					placeholder={t("rename.placeholder")}
					value={name}
					onChange={event => setName(event.target.value)}
					maxLength={120}
					autoFocus
				/>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={close}>
						{t("common.cancel")}
					</Button>
					<Button
						type="submit"
						variant="primary"
						loading={saving}
						disabled={name.trim().length === 0 || !sidecarReady}
						title={!sidecarReady ? t("sidecar.notResponding") : undefined}
					>
						{t("rename.submit")}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
