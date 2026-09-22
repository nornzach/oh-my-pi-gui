/**
 * Dedicated editor for providers.maxInFlightRequests (TUI
 * ProviderLimitsSubmenu parity): one row per provider id with a positive
 * integer concurrency cap, plus a provider dropdown (fed by get_providers
 * through ModelValueSelect) to add rows. Clearing a row's field or clicking
 * remove makes that provider unlimited; picking a provider from the dropdown
 * adds it capped at 1. Commits the whole record on every change (the parent
 * writes via setSetting).
 */

import { X } from "lucide-react";
import { useState } from "react";
import { useT } from "../../../lib/i18n";
import { isImeKeyEvent } from "../../../lib/ime";
import { toast } from "../../../stores/toast";
import { ModelValueSelect } from "../ModelValueSelect";

const INPUT_CLASS =
	"rounded-md border border-(--omp-input-border) bg-(--omp-input-bg) px-2 py-1 font-mono text-omp-sm text-(--omp-text) outline-none transition-colors focus:border-(--omp-input-focus-border)";

export interface ProviderLimitsEditorProps {
	value: Record<string, unknown>;
	onCommit: (value: Record<string, unknown>) => void;
	disabled?: boolean;
}

function LimitInput({
	limit,
	disabled,
	onCommit,
}: {
	limit: number;
	disabled?: boolean;
	/** null removes the row (provider becomes unlimited). */
	onCommit: (limit: number | null) => void;
}) {
	const t = useT();
	const [draft, setDraft] = useState<string | null>(null);

	const commit = () => {
		if (draft === null) return;
		const trimmed = draft.trim();
		setDraft(null);
		if (trimmed === "") {
			onCommit(null);
			return;
		}
		const num = Number(trimmed);
		if (!Number.isFinite(num) || num <= 0) {
			toast({ variant: "warning", message: t("settings.editors.errPositive") });
			return;
		}
		const next = Math.max(1, Math.floor(num));
		if (next !== limit) onCommit(next);
	};

	return (
		<input
			className={`${INPUT_CLASS} w-20 text-right`}
			disabled={disabled}
			inputMode="numeric"
			onBlur={commit}
			onChange={event => setDraft(event.target.value)}
			onKeyDown={event => {
				if (isImeKeyEvent(event)) return;
				if (event.key === "Enter") event.currentTarget.blur();
				if (event.key === "Escape") {
					setDraft(null);
					event.currentTarget.blur();
				}
			}}
			placeholder={t("settings.editors.limitUnlimited")}
			spellCheck={false}
			value={draft ?? String(limit)}
		/>
	);
}

export function ProviderLimitsEditor({ value, onCommit, disabled }: ProviderLimitsEditorProps) {
	const t = useT();
	// Only finite positive numbers render as rows; anything else is dropped on
	// the next commit, mirroring the agent's normalize/validate helpers.
	const entries = Object.entries(value)
		.filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
		.sort(([a], [b]) => a.localeCompare(b));

	const setLimit = (provider: string, limit: number | null) => {
		const next: Record<string, unknown> = Object.fromEntries(entries);
		if (limit === null) {
			delete next[provider];
		} else {
			next[provider] = limit;
		}
		onCommit(next);
	};

	return (
		<div className="flex w-full flex-col gap-1">
			{entries.map(([provider, limit]) => (
				<div className="flex items-center gap-1.5" key={provider}>
					<span className="min-w-0 flex-1 truncate font-mono text-omp-sm text-(--omp-text)" title={provider}>
						{provider}
					</span>
					<LimitInput disabled={disabled} limit={limit} onCommit={next => setLimit(provider, next)} />
					{!disabled && (
						<button
							aria-label={t("settings.editors.kvRemove")}
							className="shrink-0 text-(--omp-dim) hover:text-(--omp-error)"
							onClick={() => setLimit(provider, null)}
							type="button"
						>
							<X size={13} />
						</button>
					)}
				</div>
			))}
			{!disabled && (
				<ModelValueSelect
					disabled={disabled}
					kind="provider"
					onCommit={provider => {
						if (provider !== "") setLimit(provider, 1);
					}}
					placeholder={t("settings.editors.limitAdd")}
					value=""
				/>
			)}
		</div>
	);
}
