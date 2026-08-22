/**
 * SchemaSettingRow: one schema-driven setting row with inline editors.
 * Handles booleans (toggle), enums (dropdown), strings (input/dropdown),
 * numbers (input), arrays/records (JSON/structured editors).
 */

import { Check, Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingEntry } from "../../../shared/rpc-types";
import { useLang, useT } from "../../lib/i18n";
import { applyThemeByName, getPersistedThemeSelection, THEMES, type ThemeName } from "../../lib/themes";
import { toast } from "../../stores/toast";
import { Button, Input, TextArea } from "../common";
import { ArrayChipEditor } from "./editors/ArrayChipEditor";
import { type EnumerableOption, EnumerableSelect } from "./editors/EnumerableSelect";
import { ProviderLimitsEditor } from "./editors/ProviderLimitsEditor";
import { RecordKvEditor } from "./editors/RecordKvEditor";
import { Toggle } from "./editors/Toggle";
import { ModelValueSelect, settingRefKind } from "./ModelValueSelect";
import { ZH_SCHEMA_OPTION_TEXT } from "./schema-option-zh";
import { ZH_SETTINGS } from "./schema-zh";

let themePreviewActive = false;
function previewAgentTheme(name: string | null): void {
	if (name !== null && name !== "" && name in THEMES) {
		themePreviewActive = true;
		applyThemeByName(name as ThemeName, { persist: false });
		return;
	}
	if (!themePreviewActive) return;
	themePreviewActive = false;
	void getPersistedThemeSelection().then(selection => {
		if (!themePreviewActive) applyThemeByName(selection, { persist: false });
	});
}

async function themeOptions(): Promise<EnumerableOption[]> {
	const res = await window.omp.rpc.getThemes();
	if (!res.success) throw new Error(res.error);
	const data = res.data as { themes?: { name: string; path?: string }[] } | undefined;
	return (data?.themes ?? []).map(theme => ({ value: theme.name, detail: theme.path ? "custom" : "builtin" }));
}

const COMMON_SHELLS = [
	"/bin/zsh",
	"/bin/bash",
	"/bin/sh",
	"/bin/fish",
	"/usr/bin/zsh",
	"/usr/bin/bash",
	"/usr/local/bin/zsh",
	"/usr/local/bin/bash",
	"/opt/homebrew/bin/zsh",
	"/opt/homebrew/bin/bash",
	"/opt/homebrew/bin/fish",
];

function shellOptions(): Promise<EnumerableOption[]> {
	return Promise.resolve(COMMON_SHELLS.map(path => ({ value: path })));
}

function SettingStatus({ dirty, saving, saved }: { dirty: boolean; saving: boolean; saved: boolean }) {
	const t = useT();
	if (saving) return <span className="shrink-0 text-omp-xs text-(--omp-muted)">{t("common.saving")}</span>;
	if (dirty) {
		return (
			<span className="flex shrink-0 items-center gap-1 text-omp-xs text-(--omp-warning)">
				<span className="size-1.5 rounded-full bg-(--omp-warning)" />
				{t("common.unsaved")}
			</span>
		);
	}
	if (saved) {
		return (
			<span className="flex shrink-0 items-center gap-0.5 text-omp-xs text-(--omp-success)">
				<Check size={10} />
				{t("common.saved")}
			</span>
		);
	}
	return null;
}

function draftFor(entry: SettingEntry, value: unknown): string {
	if (entry.type === "array" || entry.type === "record") {
		return JSON.stringify(value ?? (entry.type === "array" ? [] : {}), null, 2);
	}
	return value === undefined || value === null ? "" : String(value);
}

const SELECT_CLASS =
	"w-full rounded-md border border-(--omp-border-muted) bg-(--omp-input-bg) px-2.5 py-1.5 text-xs text-(--omp-text) transition-colors duration-100 focus:border-(--omp-border-accent) focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

function SchemaSettingRow({
	entry,
	value,
	onCommitted,
}: {
	entry: SettingEntry;
	value: unknown;
	onCommitted: (path: string, value: unknown) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const t = useT();
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [revealed, setRevealed] = useState(false);
	const savedTimer = useRef<number | undefined>(undefined);

	useEffect(
		() => () => {
			window.clearTimeout(savedTimer.current);
		},
		[],
	);

	const { lang } = useLang();
	const zhEntry = lang === "zh" ? ZH_SETTINGS[entry.path] : undefined;
	const label = zhEntry?.label ?? entry.label ?? entry.path;
	const description = zhEntry?.description ?? entry.description;
	const baseDraft = draftFor(entry, value);
	const dirty = draft !== null && draft !== baseDraft;

	const commit = useCallback(
		async (next: unknown) => {
			setSaving(true);
			try {
				const res = await window.omp.rpc.setSetting(entry.path, next);
				if (res.success) {
					onCommitted(entry.path, next);
					setDraft(null);
					setError(null);
					if (entry.type !== "boolean") {
						setSaved(true);
						window.clearTimeout(savedTimer.current);
						savedTimer.current = window.setTimeout(() => setSaved(false), 2000);
					}
				} else {
					toast({ variant: "error", title: t("settings.saveFailed"), message: res.error });
				}
			} catch (err) {
				toast({ variant: "error", title: t("settings.saveFailed"), message: String(err) });
			} finally {
				setSaving(false);
			}
		},
		[entry.path, entry.type, onCommitted, t],
	);

	const commitText = useCallback(() => {
		if (draft === null || draft === baseDraft) {
			setDraft(null);
			setError(null);
			return;
		}
		if (entry.type === "number") {
			const trimmed = draft.trim();
			const num = Number(trimmed);
			if (trimmed.length === 0 || !Number.isFinite(num)) {
				setError(t("settings.editors.errNumber"));
				return;
			}
			void commit(num);
			return;
		}
		void commit(draft);
	}, [draft, baseDraft, entry.type, commit, t]);

	const commitJson = useCallback(() => {
		if (draft === null || draft === baseDraft) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(draft);
		} catch (err) {
			setError(t("settings.editors.errInvalidJson", { error: err instanceof Error ? err.message : String(err) }));
			return;
		}
		if (entry.type === "array" && !Array.isArray(parsed)) {
			setError(t("settings.editors.errJsonArray"));
			return;
		}
		if (entry.type === "record" && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) {
			setError(t("settings.editors.errJsonObject"));
			return;
		}
		void commit(parsed);
	}, [draft, baseDraft, entry.type, commit, t]);

	const onTextKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") event.currentTarget.blur();
		if (event.key === "Escape") {
			setDraft(null);
			setError(null);
			event.currentTarget.blur();
		}
	};

	const status = <SettingStatus dirty={dirty} saving={saving} saved={saved} />;
	// Values cached at session construction need a restart in every client.
	const restartBadge =
		entry.restartRequired === true ? (
			<span
				title={t("settings.restartRequired.hint")}
				className="shrink-0 rounded border border-[var(--omp-warning)]/40 px-1 py-px text-omp-xxs font-medium uppercase tracking-wide text-[var(--omp-warning)]"
			>
				{t("settings.restartRequired.badge")}
			</span>
		) : null;

	// Boolean settings render as one full-row switch and write immediately.
	// The switch position is the success feedback; transient "Saved" text would
	// compete with the control's hit target and obscure its actual state.
	if (entry.type === "boolean") {
		return (
			<Toggle
				badge={restartBadge}
				checked={value === true}
				description={description}
				disabled={saving}
				label={label}
				onChange={next => void commit(next)}
			/>
		);
	}

	// Array/record settings get a full-width JSON editor below the label.
	if (entry.type === "array" || entry.type === "record") {
		const masked = entry.secret === true && !revealed;
		// Structured editors for the common shapes; JSON stays the fallback.
		const stringArray =
			entry.type === "array" && Array.isArray(value) && (value as unknown[]).every(item => typeof item === "string");
		const nestedRecord = entry.path === "images.urls.options" || entry.path === "images.urls.credentials";
		const flatRecord =
			entry.type === "record" &&
			!nestedRecord &&
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			Object.values(value as Record<string, unknown>).every(
				item => item === null || ["string", "number", "boolean"].includes(typeof item),
			);
		const approvalOptions =
			entry.path === "tools.approval"
				? [
						{ value: "allow", label: t("settings.editors.approval.allow") },
						{ value: "prompt", label: t("settings.editors.approval.prompt") },
						{ value: "deny", label: t("settings.editors.approval.deny") },
					]
				: undefined;
		// Model-valued records (modelRoles) get a model dropdown per value cell.
		const modelValued = entry.path === "modelRoles";
		// Per-provider concurrency caps get the dedicated provider+number editor.
		const providerLimits =
			entry.path === "providers.maxInFlightRequests" &&
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value);
		return (
			<div className="rounded-md px-2 py-2 transition-colors hover:bg-(--omp-bg-tertiary)">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-(--omp-text)" title={entry.path}>
						{label}
					</span>

					{restartBadge}
					{status}
				</div>
				{description && (
					<span className="mt-0.5 block text-omp-sm leading-snug text-(--omp-muted)">{description}</span>
				)}
				{masked ? (
					<div className="mt-2 flex items-center justify-between rounded-md border border-(--omp-border-muted) px-2.5 py-2">
						<span className="text-xs text-(--omp-muted)">••••••••</span>
						<Button onClick={() => setRevealed(true)} size="sm" type="button" variant="ghost">
							<Eye size={12} className="mr-1 inline" />
							{t("common.reveal")}
						</Button>
					</div>
				) : stringArray ? (
					<div className="mt-2">
						<ArrayChipEditor
							disabled={saving}
							onCommit={next => void commit(next)}
							ordered={entry.ordered === true}
							options={entry.options?.map(option => ({
								value: option.value,
								label: lang === "zh" ? (ZH_SCHEMA_OPTION_TEXT[option.label] ?? option.label) : option.label,
							}))}
							values={value as string[]}
						/>
					</div>
				) : providerLimits ? (
					<div className="mt-2">
						<ProviderLimitsEditor
							disabled={saving}
							onCommit={next => void commit(next)}
							value={value as Record<string, unknown>}
						/>
					</div>
				) : flatRecord ? (
					<div className="mt-2">
						<RecordKvEditor
							disabled={saving}
							onCommit={next => void commit(next)}
							value={value as Record<string, unknown>}
							valueKind={modelValued ? "model" : undefined}
							valueOptions={approvalOptions}
						/>
					</div>
				) : (
					<>
						<TextArea
							autoGrow
							className="mt-2"
							disabled={saving}
							error={error ?? undefined}
							mono
							onChange={event => {
								setDraft(event.target.value);
								setError(null);
							}}
							rows={3}
							spellCheck={false}
							value={draft ?? baseDraft}
						/>
						<div className="mt-1.5 flex items-center justify-end gap-1.5">
							{entry.secret === true && (
								<Button onClick={() => setRevealed(false)} size="sm" type="button" variant="ghost">
									<EyeOff size={12} className="mr-1 inline" />
									{t("common.hide")}
								</Button>
							)}
							{dirty && (
								<Button
									onClick={() => {
										setDraft(null);
										setError(null);
									}}
									size="sm"
									type="button"
									variant="ghost"
								>
									{t("common.reset")}
								</Button>
							)}
							<Button
								disabled={!dirty || saving}
								loading={saving}
								onClick={commitJson}
								size="sm"
								type="button"
								variant="secondary"
							>
								{t("common.apply")}
							</Button>
						</div>
					</>
				)}
			</div>
		);
	}

	// enum / number / string share a label-left, control-right row.
	let control: React.ReactNode;
	if (entry.type === "enum") {
		const options = entry.options ?? [];
		const current = typeof value === "string" ? value : undefined;
		const hasCurrent = current !== undefined && options.some(option => option.value === current);
		if (options.length === 0) {
			control = (
				<Input
					disabled={saving}
					onBlur={commitText}
					onChange={event => setDraft(event.target.value)}
					onKeyDown={onTextKeyDown}
					value={draft ?? baseDraft}
				/>
			);
		} else {
			control = (
				<select
					className={SELECT_CLASS}
					disabled={saving}
					onChange={event => {
						if (event.target.value !== "") void commit(event.target.value);
					}}
					value={current ?? ""}
				>
					{current === undefined && <option value="">{t("common.unset")}</option>}
					{!hasCurrent && current !== undefined && <option value={current}>{current}</option>}
					{options.map(option => (
						<option
							key={option.value}
							title={
								lang === "zh" && option.description
									? (ZH_SCHEMA_OPTION_TEXT[option.description] ?? option.description)
									: option.description
							}
							value={option.value}
						>
							{lang === "zh" ? (ZH_SCHEMA_OPTION_TEXT[option.label] ?? option.label) : option.label}
						</option>
					))}
				</select>
			);
		}
	} else if (entry.type === "number") {
		control = (
			<Input
				disabled={saving}
				error={error ?? undefined}
				onBlur={commitText}
				onChange={event => {
					setDraft(event.target.value);
					setError(null);
				}}
				onKeyDown={onTextKeyDown}
				type="number"
				value={draft ?? baseDraft}
			/>
		);
	} else {
		const masked = entry.secret === true && !revealed;
		// Enumerable string settings get dropdowns (never hand-typed); then
		// model/provider references get searchable dropdowns; secrets stay text.
		const refKind = entry.secret === true ? null : settingRefKind(entry.path);
		const themeSetting = entry.secret !== true && /^theme\.(dark|light)$/.test(entry.path);
		const shellSetting = entry.secret !== true && entry.path === "shellPath";
		if (themeSetting) {
			control = (
				<EnumerableSelect
					allowCustom
					disabled={saving}
					fetchOptions={themeOptions}
					noun={t("settings.editors.themes")}
					onCommit={next => void commit(next)}
					onPreview={previewAgentTheme}
					value={typeof value === "string" ? value : ""}
				/>
			);
		} else if (shellSetting) {
			control = (
				<EnumerableSelect
					allowCustom
					disabled={saving}
					fetchOptions={shellOptions}
					noun={t("settings.editors.shells")}
					onCommit={next => void commit(next)}
					value={typeof value === "string" ? value : ""}
				/>
			);
		} else if (refKind !== null) {
			control = (
				<ModelValueSelect
					disabled={saving}
					kind={refKind}
					onCommit={next => void commit(next)}
					value={typeof value === "string" ? value : ""}
				/>
			);
		} else {
			control = (
				<div className="relative">
					<Input
						disabled={saving}
						onBlur={commitText}
						onChange={event => setDraft(event.target.value)}
						onKeyDown={onTextKeyDown}
						type={masked ? "password" : "text"}
						value={draft ?? baseDraft}
					/>
					{entry.secret === true && (
						<button
							aria-label={masked ? t("common.revealValue") : t("common.hideValue")}
							className="absolute top-1/2 right-2 -translate-y-1/2 text-(--omp-dim) hover:text-(--omp-text)"
							onClick={() => setRevealed(!revealed)}
							type="button"
						>
							{masked ? <Eye size={13} /> : <EyeOff size={13} />}
						</button>
					)}
				</div>
			);
		}
	}

	return (
		<div className="settings-field-row rounded-md px-2 py-2 transition-colors hover:bg-(--omp-bg-tertiary)">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-(--omp-text)" title={entry.path}>
						{label}
					</span>

					{restartBadge}
					{status}
				</div>
				{description && (
					<span className="mt-0.5 block text-omp-sm leading-snug text-(--omp-muted)">{description}</span>
				)}
			</div>
			<div className="settings-field-control">{control}</div>
		</div>
	);
}

export { SchemaSettingRow };
