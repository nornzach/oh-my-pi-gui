/**
 * Shown when switching to a session whose saved model can no longer be
 * restored (provider removed, signed out, model retired). Upstream refuses to
 * silently continue such a transcript on another model, so the user decides:
 * reopen it bound to the current model, or stay where they are.
 */

import { useEffect, useState } from "react";
import type { ModelInfo } from "../../../shared/rpc-types";
import { switchSessionNow } from "../../hooks/use-session-switch";
import { useT } from "../../lib/i18n";
import { useModelStore } from "../../stores/model";
import { useSessionStore } from "../../stores/session";
import { useTabsStore } from "../../stores/tabs";
import { useUiStore } from "../../stores/ui";
import { Button, Modal } from "../common";

export function ModelRestoreDialog() {
	const t = useT();
	const prompt = useUiStore(s => s.modelRestorePrompt);
	const close = useUiStore(s => s.closeModelRestore);
	const current = useModelStore(s => s.model);
	const models = useModelStore(s => s.availableModels);
	const refresh = useModelStore(s => s.refreshAvailableModels);
	const tabId = useTabsStore(s => s.activeTabId);
	const sessionId = useSessionStore(s => s.sessionId);
	const [busy, setBusy] = useState(false);
	const valid = prompt?.originTabId === tabId && prompt.originSessionId === sessionId;
	useEffect(() => {
		if (!prompt || busy) return;
		if (!valid) close();
		else if (!current) void refresh().catch(() => {});
	}, [close, prompt, valid, current, refresh, busy]);

	const currentLabel = current ? (current.name ?? `${current.provider}/${current.id}`) : null;

	const openWith = async (model: ModelInfo) => {
		if (!prompt || !valid || busy) return;
		setBusy(true);
		try {
			const switched = await switchSessionNow(prompt.session, { provider: model.provider, modelId: model.id });
			if (switched && useUiStore.getState().modelRestorePrompt === prompt) {
				useUiStore.getState().closeSessionPicker();
				close();
			}
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal
			bodyClassName="p-4"
			onClose={() => {
				if (!busy) close();
			}}
			open={valid}
			size="sm"
			title={t("modelRestore.title")}
		>
			<div className="space-y-2 text-omp-md leading-relaxed break-words text-(--omp-muted)">
				<p>{t("modelRestore.message", { model: prompt?.missingModel ?? "" })}</p>
				<p className="text-omp-sm">
					{currentLabel
						? t("modelRestore.offer", { model: currentLabel })
						: !models.length
							? t("modelRestore.noCurrent")
							: null}
				</p>
			</div>
			<div className="mt-4 flex items-center justify-end gap-2">
				<Button autoFocus disabled={busy} onClick={close} size="sm" variant="ghost">
					{t("common.cancel")}
				</Button>
				{current && currentLabel ? (
					<Button disabled={busy} loading={busy} onClick={() => void openWith(current)} size="sm">
						{t("modelRestore.openWith", { model: currentLabel })}
					</Button>
				) : models.length ? (
					<select
						className="min-w-0 max-w-full rounded-md border border-(--omp-border) bg-(--omp-bg-elevated) px-2 py-1.5 text-omp-sm"
						aria-label={t("modelRestore.choose")}
						value=""
						disabled={busy}
						onChange={event => {
							const picked = models.find(model => `${model.provider}/${model.id}` === event.target.value);
							if (picked) void openWith(picked);
						}}
					>
						<option disabled value="">
							{t("modelRestore.choose")}
						</option>
						{models.map(model => (
							<option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
								{model.provider}/{model.id}
							</option>
						))}
					</select>
				) : null}
			</div>
		</Modal>
	);
}
