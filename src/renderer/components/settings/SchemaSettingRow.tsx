import { type TabRpc, useTabRpc } from "../../lib/tab-rpc";
/**
 * SchemaSettingRow: one schema-driven setting row with inline editors.
 * Handles booleans (toggle), enums (dropdown), strings (input/dropdown),
 * numbers (input), arrays/records (JSON/structured editors).
 */

import { AlertTriangle, Check, Eye, EyeOff, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingEntry, SettingProvenance } from "../../../shared/rpc-types";
import { describeError } from "../../lib/errors";
import { cx } from "../../lib/format";
import { useLang, useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import {
	applyThemeByName,
	getPersistedThemeSelection,
	getThemeSelectionVersion,
	THEMES,
	type ThemeName,
} from "../../lib/themes";
import { useRuntimeTabId } from "../../stores/session-runtime-context";
import { notePendingRestart, usePendingRestarts } from "../../stores/settings-restart";
import { toast } from "../../stores/toast";
import { Button, Input, TextArea } from "../common";
import { ArrayChipEditor } from "./editors/ArrayChipEditor";
import { type EnumerableOption, EnumerableSelect } from "./editors/EnumerableSelect";
import { ProviderLimitsEditor } from "./editors/ProviderLimitsEditor";
import { RecordKvEditor } from "./editors/RecordKvEditor";
import { Toggle } from "./editors/Toggle";
import { ModelValueSelect, settingRefKind } from "./ModelValueSelect";
import { schemaOptionText, settingTranslation } from "./schema-localization";

let themePreviewActive = false;
function previewAgentTheme(name: string | null): void {
	if (name !== null && name !== "" && name in THEMES) {
		themePreviewActive = true;
		applyThemeByName(name as ThemeName, { persist: false });
		return;
	}
	if (!themePreviewActive) return;
	themePreviewActive = false;
	const version = getThemeSelectionVersion();
	void getPersistedThemeSelection().then(selection => {
		if (!themePreviewActive && getThemeSelectionVersion() === version)
			applyThemeByName(selection, { persist: false });
	});
}

async function themeOptions(rpc: TabRpc): Promise<EnumerableOption[]> {
	const res = await rpc.getThemes();
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

/**
 * What a save did, as the row reports it: in effect now, waiting for the
 * session to restart, written but outranked by a higher config layer, or not
 * written at all. Only "applied" earns a transient "Saved"; the others keep a
 * notice on the row, since the value the user picked is not what runs yet.
 */
type SaveOutcome = "applied" | "restart" | "overridden" | "failed";

/** Config layers above global, highest precedence first. */
const OVERRIDE_LAYERS = ["runtime", "overlay", "project"] as const;

/** The highest layer above global that sets this setting: it wins over anything saved here. */
function overridingLayer(provenance: SettingProvenance | undefined): (typeof OVERRIDE_LAYERS)[number] | undefined {
	return OVERRIDE_LAYERS.find(layer => provenance?.layers.includes(layer));
}

function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function draftFor(entry: SettingEntry, value: unknown): string {
	if (entry.type === "array" || entry.type === "record") {
		return JSON.stringify(value ?? (entry.type === "array" ? [] : {}), null, 2);
	}
	return value === undefined || value === null ? "" : String(value);
}

const SELECT_CLASS =
	"w-full rounded-lg border border-(--omp-input-border) bg-(--omp-input-bg) px-2.5 py-1.5 text-omp-md leading-[1.45] text-(--omp-text) transition-colors duration-100 hover:border-(--omp-border-strong) focus:border-(--omp-input-focus-border) focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/** String settings holding a prompt: a one-line field is too narrow to read or write one. */
const PROMPT_SETTINGS = new Set(["chat.systemPrompt"]);

function SchemaSettingRow({
	entry,
	value,
	onCommitted,
}: {
	entry: SettingEntry;
	value: unknown;
	onCommitted: (path: string, value: unknown) => void;
}) {
	const tabRpc = useTabRpc();
	const [draft, setDraft] = useState<string | null>(null);
	const t = useT();
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [savedProvenance, setSavedProvenance] = useState<SettingProvenance>();
	const [revealed, setRevealed] = useState(false);
	// The last save was written globally but a higher layer kept the old value.
	const [overriddenSave, setOverriddenSave] = useState(false);
	const savedTimer = useRef<number | undefined>(undefined);
	const tabId = useRuntimeTabId();
	const restartPending = usePendingRestarts(tabId).some(pending => pending.path === entry.path);

	const generation = useRef(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a different session client or setting invalidates pending saves.
	useEffect(() => {
		generation.current++;
		setDraft(null);
		setError(null);
		setSaving(false);
		setSaved(false);
		setSavedProvenance(undefined);
		setOverriddenSave(false);
		return () => {
			generation.current++;
		};
	}, [tabRpc, entry.path]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: fresh schema provenance replaces a previous save acknowledgement.
	useEffect(() => {
		setSavedProvenance(undefined);
	}, [entry.provenance]);
	const fetchThemeOptions = useCallback(() => themeOptions(tabRpc), [tabRpc]);

	useEffect(
		() => () => {
			window.clearTimeout(savedTimer.current);
		},
		[],
	);

	const { lang } = useLang();
	const localizedEntry = settingTranslation(lang, entry.path);
	const label =
		entry.path === "tui.renderMermaid"
			? t("settings.gui.allowMermaid")
			: (localizedEntry?.label ?? entry.label ?? entry.path);
	const description =
		entry.path === "tui.renderMermaid"
			? t("settings.gui.allowMermaidDesc")
			: (localizedEntry?.description ?? entry.description);
	const baseDraft = draftFor(entry, value);
	const dirty = draft !== null && draft !== baseDraft;

	const commit = useCallback(
		async (next: unknown): Promise<SaveOutcome> => {
			const requestGeneration = ++generation.current;
			const previous = value;
			setSaving(true);
			try {
				const res = await tabRpc.setSetting(entry.path, next);
				if (generation.current !== requestGeneration) return "failed";
				if (!res.success) {
					setError(describeError(res.error));
					toast({ variant: "error", title: t("settings.saveFailed"), message: res.error });
					return "failed";
				}
				const data = res.data as { value?: unknown; provenance?: SettingProvenance } | undefined;
				let effective: unknown;
				if (data?.provenance) {
					effective = data.value;
					setSavedProvenance(data.provenance);
				} else {
					// Older cores returned the submitted value; read back the effective value.
					const readback = await tabRpc.getSettings([entry.path]);
					if (generation.current !== requestGeneration) return "failed";
					if (!readback.success) throw new Error(readback.error);
					const values = (readback.data as { values?: Record<string, unknown> } | undefined)?.values;
					if (!values) throw new Error(t("settings.savedUnverified"));
					effective = values[entry.path];
				}
				onCommitted(entry.path, effective);
				setDraft(null);
				setError(null);
				// The write landed in the global layer; a project, launch or runtime
				// layer that also sets this keeps the session on its own value.
				const outranked =
					next !== undefined &&
					!sameValue(effective, next) &&
					overridingLayer(data?.provenance ?? entry.provenance) !== undefined;
				setOverriddenSave(outranked);
				if (outranked) return "overridden";
				if (entry.restartRequired === true && !sameValue(effective, previous)) {
					if (tabId) notePendingRestart(tabId, { path: entry.path, label });
					return "restart";
				}
				if (entry.type !== "boolean") {
					setSaved(true);
					window.clearTimeout(savedTimer.current);
					savedTimer.current = window.setTimeout(() => setSaved(false), 2000);
				}
				return "applied";
			} catch (err) {
				if (generation.current !== requestGeneration) return "failed";
				setError(describeError(err));
				toast({ variant: "error", title: t("settings.saveFailed"), message: String(err) });
				return "failed";
			} finally {
				if (generation.current === requestGeneration) setSaving(false);
			}
		},
		[entry.path, entry.type, entry.restartRequired, entry.provenance, label, onCommitted, t, tabId, tabRpc, value],
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
		} catch {
			setError(t("settings.editors.errInvalidJson"));
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
		if (isImeKeyEvent(event)) return;
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
				className="shrink-0 rounded border border-[var(--omp-warning)]/40 px-1 py-px text-omp-xxs font-medium text-[var(--omp-warning)]"
			>
				{t("settings.restartRequired.badge")}
			</span>
		) : null;

	const renderControl = () => {
		// Boolean settings render as one full-row switch and write immediately.
		// The switch position is the success feedback; transient "Saved" text would
		// compete with the control's hit target and obscure its actual state.
		if (entry.type === "boolean") {
			return (
				<Toggle
					badge={restartBadge}
					className="omp-settings-row"
					checked={value === true}
					description={description}
					disabled={saving}
					label={label}
					// Only a save that is in effect now confirms with "Saved"; the
					// row's notice covers one that waits on a restart or is outranked.
					onChange={async next => (await commit(next)) === "applied"}
				/>
			);
		}

		// Array/record settings get a full-width JSON editor below the label.
		if (entry.type === "array" || entry.type === "record") {
			const masked = entry.secret === true && !revealed;
			// Structured editors for the common shapes; JSON stays the fallback.
			const stringArray =
				entry.type === "array" &&
				// Empty rule lists still contain objects; the current value cannot
				// determine their editor until the first rule exists.
				entry.path !== "bash.patterns" &&
				entry.path !== "bashInterceptor.patterns" &&
				Array.isArray(value) &&
				(value as unknown[]).every(item => typeof item === "string");
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
				<div className="omp-settings-row transition-colors">
					<div className="flex items-center gap-2">
						<span className="text-omp-md font-medium text-(--omp-text)" title={entry.path}>
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
							<span className="text-omp-md text-(--omp-muted)">••••••••</span>
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
									label: schemaOptionText(lang, option.label),
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
								compact
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

		// Prompts get a full-width multi-line editor below the label, applied explicitly.
		if (entry.type === "string" && PROMPT_SETTINGS.has(entry.path)) {
			return (
				<div className="omp-settings-row transition-colors">
					<div className="flex items-center gap-2">
						<span className="text-omp-md font-medium text-(--omp-text)" title={entry.path}>
							{label}
						</span>

						{restartBadge}
						{status}
					</div>
					{description && (
						<span className="mt-0.5 block text-omp-sm leading-snug text-(--omp-muted)">{description}</span>
					)}
					<TextArea
						compact
						autoGrow
						className="mt-2"
						disabled={saving}
						onChange={event => {
							setDraft(event.target.value);
							setError(null);
						}}
						rows={4}
						value={draft ?? baseDraft}
					/>
					<div className="mt-1.5 flex items-center justify-end gap-1.5">
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
							onClick={commitText}
							size="sm"
							type="button"
							variant="secondary"
						>
							{t("common.apply")}
						</Button>
					</div>
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
						compact
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
								title={option.description ? schemaOptionText(lang, option.description) : undefined}
								value={option.value}
							>
								{schemaOptionText(lang, option.label)}
							</option>
						))}
					</select>
				);
			}
		} else if (entry.type === "number") {
			control = (
				<Input
					compact
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
						fetchOptions={fetchThemeOptions}
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
							compact
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
			<div className="settings-field-row omp-settings-row transition-colors">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="text-omp-md font-medium text-(--omp-text)" title={entry.path}>
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
	};
	const provenance = savedProvenance ?? entry.provenance;
	const overrideLayer = overridingLayer(provenance);
	/** The value this session runs with, in the words the control uses. */
	const displayValue = (current: unknown): string => {
		if (entry.secret) return "••••••";
		if (typeof current === "boolean") return t(current ? "settings.effect.on" : "settings.effect.off");
		const option = entry.options?.find(candidate => candidate.value === current);
		if (option) return schemaOptionText(lang, option.label);
		const text = typeof current === "string" ? current : JSON.stringify(current);
		return text === undefined || text === ""
			? t("settings.source.default")
			: text.length > 60
				? `${text.slice(0, 57)}…`
				: text;
	};
	return (
		<div>
			{renderControl()}
			{entry.default === undefined && value !== undefined && (
				<div className="pb-2">
					<Button disabled={saving} onClick={() => void commit(undefined)} size="sm" variant="ghost">
						{t("settings.restoreUnset")}
					</Button>
				</div>
			)}
			{error && (
				<p role="alert" className="pb-2 text-omp-xs text-(--omp-error)">
					{error}
				</p>
			)}
			{restartPending && !overriddenSave && (
				<p className="mx-2 mb-2 flex items-center gap-1.5 text-omp-xs text-(--omp-warning)" role="status">
					<RotateCw aria-hidden size={11} />
					{t("settings.effect.restartPending")}
				</p>
			)}
			{/* Only a layer above global changes what this row can do: the
			    value it shows is that layer's, and edits here save underneath it. */}
			{/* Polite live region: a save that turned out outranked is announced
			    without stealing the summary's own disclosure-button role. */}
			<div aria-live="polite">
				{overrideLayer && provenance && (
					<details
						className={cx(
							"mb-2 rounded-md px-2 py-1.5 text-omp-xs",
							overriddenSave
								? "border border-[var(--omp-warning)]/40 bg-[var(--omp-warning)]/8 text-(--omp-text)"
								: "text-(--omp-muted)",
						)}
					>
						<summary className="cursor-pointer">
							<AlertTriangle aria-hidden className="mx-1 inline align-[-1px] text-(--omp-warning)" size={11} />
							{overriddenSave
								? t("settings.effect.overriddenAfterSave", {
										source: t(`settings.effect.source.${overrideLayer}`),
										value: displayValue(value),
									})
								: t("settings.effect.overridden", { source: t(`settings.effect.source.${overrideLayer}`) })}
						</summary>
						<div className="mt-1.5 space-y-1 pl-4 text-(--omp-dim)">
							<p>
								{t("settings.source.label")}:{" "}
								{provenance.layers.map(layer => t(`settings.source.${layer}`)).join(" → ")}
							</p>
							<p>{t("settings.source.saveGlobal")}</p>
							<code className="block break-words whitespace-pre-wrap">
								{entry.secret
									? "••••••"
									: (JSON.stringify(provenance.globalValue) ?? t("settings.source.default"))}
							</code>
							{provenance.globalPath && <p className="break-all">{provenance.globalPath}</p>}
						</div>
					</details>
				)}
			</div>
		</div>
	);
}

export { SchemaSettingRow };
