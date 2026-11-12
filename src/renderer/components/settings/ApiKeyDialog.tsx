/**
 * Sign a provider in with an API key typed or pasted here: no browser round
 * trip, and nothing to cancel afterwards. The key goes to the agent in one
 * call. It lives in component state only while the dialog is open (kept after a
 * refusal so it can be corrected) and is cleared on success and on close.
 */

import { Eye, EyeOff } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useT } from "../../lib/i18n";
import { Button, Input, Modal } from "../common";

export interface ApiKeyDialogProps {
	providerName: string;
	open: boolean;
	onClose: () => void;
	/** Resolves with the failure message, or null once the key is stored. */
	onSave: (apiKey: string) => Promise<string | null>;
}

export function ApiKeyDialog({ providerName, open, onClose, onSave }: ApiKeyDialogProps) {
	const t = useT();
	const [apiKey, setApiKey] = useState("");
	const [revealed, setRevealed] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fieldId = useId();
	const errorId = useId();

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!apiKey.trim() || saving) return;
		setSaving(true);
		setError(null);
		const failure = await onSave(apiKey);
		setSaving(false);
		if (failure !== null) {
			setError(failure);
			return;
		}
		setApiKey("");
		setRevealed(false);
		onClose();
	};

	const close = () => {
		if (saving) return;
		setApiKey("");
		setRevealed(false);
		setError(null);
		onClose();
	};

	return (
		<Modal onClose={close} open={open} size="sm" title={t("providers.apiKey.title", { provider: providerName })}>
			<form className="flex flex-col gap-4" onSubmit={submit}>
				<p className="text-omp-md text-(--omp-muted)">
					{t("providers.apiKey.description", { provider: providerName })}
				</p>
				<div>
					<label className="mb-1.5 block text-omp-md font-medium text-(--omp-text-secondary)" htmlFor={fieldId}>
						{t("providers.apiKey.label")}
					</label>
					{/* The toggle centres on the field alone, so it stays put at any font size. */}
					<div className="relative">
						<Input
							aria-describedby={error ? errorId : undefined}
							aria-invalid={error ? true : undefined}
							autoComplete="off"
							autoFocus
							className="pr-10 font-mono"
							id={fieldId}
							onChange={event => {
								setApiKey(event.target.value);
								setError(null);
							}}
							placeholder={t("providers.apiKey.placeholder")}
							spellCheck={false}
							type={revealed ? "text" : "password"}
							value={apiKey}
						/>
						<button
							aria-label={revealed ? t("providerCfg.form.apiKeyHide") : t("providerCfg.form.apiKeyShow")}
							className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-(--omp-dim) hover:text-(--omp-text)"
							onClick={() => setRevealed(value => !value)}
							type="button"
						>
							{revealed ? <EyeOff size={14} /> : <Eye size={14} />}
						</button>
					</div>
					{error && (
						<p className="mt-1.5 text-omp-md text-(--omp-error)" id={errorId} role="alert">
							{error}
						</p>
					)}
				</div>
				<div className="flex justify-end gap-2">
					<Button disabled={saving} onClick={close} size="sm" type="button" variant="ghost">
						{t("common.cancel")}
					</Button>
					<Button disabled={!apiKey.trim()} loading={saving} size="sm" type="submit" variant="primary">
						{t("providers.apiKey.save")}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
