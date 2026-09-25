import { useTabRpc } from "../../../lib/tab-rpc";
/**
 * Plugin detail drawer: a drill-in overlay covering the inventory window body
 * with the selected plugin's configuration.
 *
 * - Enabled switch: same set_plugin_enabled RPC the list-row toggle uses.
 * - Features: checkbox list staged locally, saved via set_plugin_features.
 * - Settings: schema-driven single form (not stepped) reusing the Settings
 *   window's editors — EnumerableSelect for enums, ArrayChipEditor for string
 *   arrays, RecordKvEditor for flat records, boolean row switches, and a
 *   validated JSON textarea for complex/unknown shapes. Field-level
 *   validation errors from the server (set_plugin_setting `{ok:false,
 *   error}`) render under their field and KEEP the user's input.
 * - Masked keys (/key|token|secret|password/i) are write-only: the stored
 *   value is never echoed into an input — empty input means "keep".
 *
 * Every mutation refetches get_plugin_detail afterward — reload may change
 * derived values, so no optimistic derivation of the saved state.
 */

import { ArrowLeft, Check, RefreshCw, RotateCcw, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RpcPluginDetail, RpcPluginInfo } from "../../../../shared/rpc-types";
import { useT } from "../../../lib/i18n";
import {
	capturePluginActivationOrigin,
	handlePluginActivation,
	isPluginActivationOriginActive,
} from "../../../lib/plugin-activation";
import { useSessionStore } from "../../../stores/session";
import { toast } from "../../../stores/toast";
import { Badge, Button, Input, Spinner, TextArea } from "../../common";
import { ArrayChipEditor } from "../../settings/editors/ArrayChipEditor";
import { EnumerableSelect } from "../../settings/editors/EnumerableSelect";
import { RecordKvEditor } from "../../settings/editors/RecordKvEditor";
import { Toggle } from "../../settings/editors/Toggle";
import { CopyableError } from "./ErrorNote";
import {
	type AssembleError,
	assembleFieldValue,
	draftForField,
	isFieldDirty,
	isFlatRecord,
	isFlatStringArray,
	parsePluginSettingsSchema,
	type SettingField,
} from "./plugin-settings";
import { mutationError } from "./rpc-result";

type ResetState = "idle" | "confirming" | "busy";

// ============================================================================
// Settings field row
// ============================================================================

function SettingFieldRow({
	field,
	value,
	draft,
	hasDraft,
	hasStoredValue,
	error,
	saving,
	replacing,
	resetState,
	onDraft,
	onReplace,
	onCancelReplace,
	onResetAsk,
	onResetConfirm,
	onResetCancel,
}: {
	field: SettingField;
	/** Effective value shown by the editor (declared default when unset). */
	value: unknown;
	/** Whether the plugin has an explicit persisted override for this key. */
	hasStoredValue: boolean;
	/** Staged draft (unknown kind per editor). */
	draft: unknown;
	hasDraft: boolean;
	/** Server validation or client assembly error, rendered under the field. */
	error: string | undefined;
	saving: boolean;
	/** Masked complex field is in "replace" mode (empty JSON textarea). */
	replacing: boolean;
	resetState: ResetState;
	onDraft: (value: unknown) => void;
	onReplace: () => void;
	onCancelReplace: () => void;
	onResetAsk: () => void;
	onResetConfirm: () => void;
	onResetCancel: () => void;
}) {
	const t = useT();
	const hasValue = hasStoredValue;
	// Static enum options, memoized so EnumerableSelect's fetcher cache holds.
	const fetchEnumOptions = useCallback(
		() => Promise.resolve((field.options ?? []).map(option => ({ value: option }))),
		[field.options],
	);

	const resetControls = hasValue ? (
		resetState === "idle" ? (
			<button
				aria-label={t("pluginDetail.reset")}
				className="omp-pressable shrink-0 rounded p-1 text-(--omp-dim) hover:bg-(--omp-tool-error-bg) hover:text-(--omp-error)"
				onClick={onResetAsk}
				title={t("pluginDetail.reset")}
				type="button"
			>
				<RotateCcw size={11} />
			</button>
		) : (
			<span className="flex shrink-0 items-center gap-0.5">
				<button
					aria-label={t("pluginDetail.resetConfirm")}
					className="omp-pressable flex h-5 w-5 items-center justify-center rounded border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent text-(--omp-error) disabled:opacity-40"
					disabled={resetState === "busy"}
					onClick={onResetConfirm}
					title={t("pluginDetail.resetConfirm")}
					type="button"
				>
					{resetState === "busy" ? <Spinner size="sm" /> : <Check size={11} />}
				</button>
				<button
					aria-label={t("common.cancel")}
					className="omp-pressable flex h-5 w-5 items-center justify-center rounded text-(--omp-dim) hover:bg-(--omp-bg-tertiary) disabled:opacity-40"
					disabled={resetState === "busy"}
					onClick={onResetCancel}
					title={t("common.cancel")}
					type="button"
				>
					<X size={11} />
				</button>
			</span>
		)
	) : null;

	const header = (
		<div className="flex items-center gap-2">
			<span className="text-xs font-medium text-(--omp-text)" title={field.key}>
				{field.key}
			</span>
			{field.secret && <Badge variant="warning">{t("pluginDetail.secretBadge")}</Badge>}
			{resetControls}
		</div>
	);

	// Boolean: full-row switch, staged into the form like every other kind.
	if (field.kind === "boolean") {
		return (
			<div>
				<div className="flex items-start gap-1">
					<div className="min-w-0 flex-1">
						<Toggle
							badge={field.secret ? <Badge variant="warning">{t("pluginDetail.secretBadge")}</Badge> : undefined}
							checked={hasDraft ? draft === true : value === true}
							description={field.description}
							disabled={saving}
							label={field.key}
							onChange={next => onDraft(next)}
						/>
					</div>
					{resetControls && <div className="mt-2 mr-2 shrink-0">{resetControls}</div>}
				</div>
				{error && <span className="mt-1 block px-2 text-omp-sm text-(--omp-error)">{error}</span>}
			</div>
		);
	}

	let control: ReactNode;
	if (field.secret) {
		// Write-only: never echo the stored value; empty input means "keep".
		if (field.kind === "stringArray" || field.kind === "record" || field.kind === "json") {
			control = replacing ? (
				<div className="mt-2">
					<TextArea
						autoGrow
						disabled={saving}
						mono
						onChange={event => onDraft(event.target.value)}
						placeholder={t("pluginDetail.replaceHint")}
						rows={3}
						spellCheck={false}
						value={typeof draft === "string" ? draft : ""}
					/>
					<div className="mt-1 flex justify-end">
						<Button onClick={onCancelReplace} size="sm" type="button" variant="ghost">
							{t("common.cancel")}
						</Button>
					</div>
				</div>
			) : (
				<div className="mt-2 flex items-center justify-between rounded-md border border-(--omp-border-muted) px-2.5 py-2">
					<span className="text-xs text-(--omp-muted)">••••••••</span>
					<Button disabled={saving} onClick={onReplace} size="sm" type="button" variant="ghost">
						{t("pluginDetail.replace")}
					</Button>
				</div>
			);
		} else {
			control = (
				<Input
					autoComplete="off"
					disabled={saving}
					mono
					onChange={event => onDraft(event.target.value)}
					placeholder={hasValue ? t("pluginDetail.maskedKeep") : t("pluginDetail.maskedUnset")}
					type="password"
					value={typeof draft === "string" ? draft : ""}
				/>
			);
		}
	} else if (field.kind === "enum") {
		control =
			field.options !== undefined && field.options.length > 0 ? (
				<EnumerableSelect
					disabled={saving}
					fetchOptions={fetchEnumOptions}
					onCommit={next => onDraft(next)}
					value={typeof draft === "string" ? draft : typeof value === "string" ? value : ""}
				/>
			) : (
				<Input
					disabled={saving}
					onChange={event => onDraft(event.target.value)}
					value={typeof draft === "string" ? draft : draftForField(field, value)}
				/>
			);
	} else if (field.kind === "number") {
		control = (
			<Input
				disabled={saving}
				onChange={event => onDraft(event.target.value)}
				type="number"
				value={typeof draft === "string" ? draft : draftForField(field, value)}
			/>
		);
	} else if (field.kind === "string") {
		control = (
			<Input
				disabled={saving}
				onChange={event => onDraft(event.target.value)}
				value={typeof draft === "string" ? draft : draftForField(field, value)}
			/>
		);
	} else if (field.kind === "stringArray") {
		const values = hasDraft && isFlatStringArray(draft) ? draft : isFlatStringArray(value) ? value : [];
		control = <ArrayChipEditor disabled={saving} onCommit={next => onDraft(next)} values={values} />;
	} else if (field.kind === "record") {
		const record = hasDraft && isFlatRecord(draft) ? draft : isFlatRecord(value) ? value : {};
		control = <RecordKvEditor disabled={saving} onCommit={next => onDraft(next)} value={record} />;
	} else {
		control = (
			<TextArea
				autoGrow
				className="mt-0"
				disabled={saving}
				mono
				onChange={event => onDraft(event.target.value)}
				rows={3}
				spellCheck={false}
				value={typeof draft === "string" ? draft : draftForField(field, value)}
			/>
		);
	}

	return (
		<div className="rounded-md px-2 py-2 transition-colors hover:bg-(--omp-bg-tertiary)">
			{header}
			{field.description && (
				<span className="mt-0.5 block text-omp-sm leading-snug text-(--omp-muted)">{field.description}</span>
			)}
			<div className="mt-2">{control}</div>
			{error && <span className="mt-1 block text-omp-sm break-words text-(--omp-error)">{error}</span>}
		</div>
	);
}

// ============================================================================
// Drawer
// ============================================================================

export function PluginDetailDrawer({
	plugin,
	onClose,
	onChanged,
}: {
	/** The list row that was clicked (id/name/scope fallback for the RPCs). */
	plugin: RpcPluginInfo;
	onClose: () => void;
	/** Reload the plugins list (enabled state is visible there). */
	onChanged: () => Promise<void>;
}) {
	const tabRpc = useTabRpc();
	const t = useT();
	const sidecarReady = useSessionStore(state => state.status) === "ready";
	const pluginId = plugin.id ?? plugin.name;
	const [detail, setDetail] = useState<RpcPluginDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);

	const [enabledBusy, setEnabledBusy] = useState(false);

	const [featuresDraft, setFeaturesDraft] = useState<string[] | null>(null);
	const [featuresBusy, setFeaturesBusy] = useState(false);
	const [featuresError, setFeaturesError] = useState<string | null>(null);

	const [drafts, setDrafts] = useState<Readonly<Record<string, unknown>>>({});
	const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
	const [saving, setSaving] = useState(false);
	const [savedTick, setSavedTick] = useState(false);
	const [replacingKey, setReplacingKey] = useState<string | null>(null);
	const [resetKey, setResetKey] = useState<string | null>(null);
	const [resetBusy, setResetBusy] = useState(false);
	const savedTimer = useRef<number | undefined>(undefined);

	useEffect(
		() => () => {
			window.clearTimeout(savedTimer.current);
		},
		[],
	);

	const load = useCallback(async (): Promise<void> => {
		setLoadError(null);
		if (!sidecarReady) {
			setDetail(null);
			setLoadError(t("common.notConnected"));
			setLoading(false);
			return;
		}
		try {
			const res = await tabRpc.getPluginDetail(pluginId);
			if (res.success) {
				setDetail(res.data as RpcPluginDetail);
			} else {
				setLoadError(res.error);
			}
		} catch (cause) {
			setLoadError(String(cause));
		} finally {
			setLoading(false);
		}
	}, [pluginId, sidecarReady, t, tabRpc.getPluginDetail]);

	useEffect(() => {
		void load();
	}, [load]);

	// Escape closes the drawer, not the whole inventory modal: window-capture
	// runs before the Modal's document-capture handler, so stopping the event
	// here keeps staged drafts alive. Skip when an enum dropdown is open — its
	// own document-bubble Escape closes the dropdown first (SettingsWindow
	// applies the same guard), so staged drafts are never discarded by a
	// dropdown-closing keystroke.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (document.querySelector('[role="listbox"]')) return;
			event.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onClose]);

	const fields = useMemo(
		() => (detail ? parsePluginSettingsSchema(detail.settingsSchema, detail.values, detail.configuredKeys) : []),
		[detail],
	);

	// ---- enabled (set_plugin_enabled — same RPC as the list-row toggle) ----
	const toggleEnabled = async (next: boolean): Promise<void> => {
		if (!sidecarReady) return;
		const origin = capturePluginActivationOrigin();
		if (!origin) {
			toast({ variant: "warning", message: t("pluginActivation.routePending") });
			return;
		}
		setEnabledBusy(true);
		try {
			const res = await tabRpc.setPluginEnabled(pluginId, next, plugin.scope);
			if (!res.success) {
				if (isPluginActivationOriginActive(origin)) {
					toast({ variant: "error", title: t("invPanel.pluginToggleFailed"), message: res.error });
				}
				return;
			}
			const data = res.data as { activation?: string } | undefined;
			await handlePluginActivation(data?.activation, { pluginId, expected: next ? "enabled" : "disabled" }, origin);
			if (!isPluginActivationOriginActive(origin)) return;
			await load();
			await onChanged();
		} catch (cause) {
			if (isPluginActivationOriginActive(origin)) {
				toast({ variant: "error", title: t("invPanel.pluginToggleFailed"), message: String(cause) });
			}
		} finally {
			setEnabledBusy(false);
		}
	};

	// ---- features ----
	const enabledFeatures = useMemo(() => detail?.features.filter(f => f.enabled).map(f => f.id) ?? [], [detail]);
	const currentFeatures = featuresDraft ?? enabledFeatures;
	const featuresDirty =
		featuresDraft !== null && [...featuresDraft].sort().join("\0") !== [...enabledFeatures].sort().join("\0");

	const toggleFeature = (id: string, on: boolean): void => {
		setFeaturesError(null);
		setFeaturesDraft(prev => {
			const base = prev ?? enabledFeatures;
			return on ? [...base, id] : base.filter(item => item !== id);
		});
	};

	const saveFeatures = async (): Promise<void> => {
		if (!sidecarReady) return;
		const origin = capturePluginActivationOrigin();
		if (!origin) {
			setFeaturesError(t("pluginActivation.routePending"));
			return;
		}
		if (featuresDraft === null || featuresBusy) return;
		setFeaturesBusy(true);
		setFeaturesError(null);
		try {
			const res = await tabRpc.setPluginFeatures(pluginId, featuresDraft);
			const failure = mutationError(res, t("pluginDetail.unknownError"));
			if (failure !== null) {
				if (isPluginActivationOriginActive(origin)) setFeaturesError(failure);
				return;
			}
			const data = res.data as { activation?: string } | undefined;
			await handlePluginActivation(data?.activation, { pluginId, expected: "enabled" }, origin);
			if (!isPluginActivationOriginActive(origin)) return;
			setFeaturesDraft(null);
			await load();
		} catch (cause) {
			if (isPluginActivationOriginActive(origin)) setFeaturesError(String(cause));
		} finally {
			setFeaturesBusy(false);
		}
	};

	// ---- settings ----
	const setDraft = (key: string, value: unknown): void => {
		setDrafts(prev => ({ ...prev, [key]: value }));
		setFieldErrors(prev => {
			if (!(key in prev)) return prev;
			const rest = { ...prev };
			delete rest[key];
			return rest;
		});
	};

	const clearDraft = (key: string): void => {
		setDrafts(prev => {
			if (!(key in prev)) return prev;
			const rest = { ...prev };
			delete rest[key];
			return rest;
		});
	};

	/** Keys Save will write: non-secret fields whose draft diverges; secret fields with a non-empty draft. */
	const dirtyKeys = useMemo(() => {
		if (!detail) return [];
		return fields
			.filter(field => {
				if (!(field.key in drafts)) return false;
				const draft = drafts[field.key];
				if (field.secret) {
					// Write-only — empty means keep; complex kinds write only from replace mode.
					if (field.kind === "stringArray" || field.kind === "record" || field.kind === "json") {
						return replacingKey === field.key && typeof draft === "string" && draft.trim() !== "";
					}
					return typeof draft === "string" && draft !== "";
				}
				return isFieldDirty(field, draft, detail.values[field.key] ?? field.default);
			})
			.map(field => field.key);
	}, [detail, fields, drafts, replacingKey]);

	const assembleErrorText = (error: AssembleError, detailMessage?: string): string => {
		switch (error) {
			case "number":
				return t("pluginDetail.errNumber");
			case "jsonArray":
				return t("pluginDetail.errJsonArray");
			case "jsonObject":
				return t("pluginDetail.errJsonObject");
			case "json":
				return t("pluginDetail.errJson", { message: detailMessage ?? "" });
		}
	};

	const saveSettings = async (): Promise<void> => {
		if (!sidecarReady || !detail || saving || dirtyKeys.length === 0) return;
		setSaving(true);
		const failures: Record<string, string> = {};
		const succeeded: string[] = [];
		for (const field of fields) {
			if (!dirtyKeys.includes(field.key)) continue;
			const assembled = assembleFieldValue(field, drafts[field.key]);
			if (!assembled.ok) {
				// Client-side assembly failure — keep the draft, flag the field.
				failures[field.key] = assembleErrorText(assembled.error, assembled.detail);
				continue;
			}
			try {
				const res = await tabRpc.setPluginSetting(pluginId, field.key, assembled.value);
				const failure = mutationError(res, t("pluginDetail.unknownError"));
				if (failure !== null) {
					// Server-side validation — keep the user's input in place.
					failures[field.key] = failure;
				} else {
					succeeded.push(field.key);
				}
			} catch (cause) {
				failures[field.key] = String(cause);
			}
		}
		if (succeeded.length > 0) {
			setDrafts(prev => {
				const next = { ...prev };
				for (const key of succeeded) delete next[key];
				return next;
			});
			if (replacingKey !== null && succeeded.includes(replacingKey)) setReplacingKey(null);
		}
		setFieldErrors(failures);
		setSaving(false);
		if (succeeded.length > 0 && Object.keys(failures).length === 0) {
			setSavedTick(true);
			window.clearTimeout(savedTimer.current);
			savedTimer.current = window.setTimeout(() => setSavedTick(false), 2000);
		}
		// Reload may change derived values — the refetch is the source of truth.
		await load();
	};

	const resetField = async (field: SettingField): Promise<void> => {
		if (!sidecarReady) return;
		setResetBusy(true);
		try {
			const res = await tabRpc.deletePluginSetting(pluginId, field.key);
			const failure = mutationError(res, t("pluginDetail.unknownError"));
			if (failure !== null) {
				setFieldErrors(prev => ({ ...prev, [field.key]: failure }));
				return;
			}
			clearDraft(field.key);
			if (replacingKey === field.key) setReplacingKey(null);
			await load();
		} catch (cause) {
			setFieldErrors(prev => ({ ...prev, [field.key]: String(cause) }));
		} finally {
			setResetBusy(false);
			setResetKey(null);
		}
	};

	const failedCount = Object.keys(fieldErrors).length;

	return (
		<div className="omp-slide-in-right absolute inset-0 z-10 flex flex-col bg-(--omp-modal-bg)">
			<div className="flex shrink-0 items-center gap-2 border-b border-(--omp-border-muted) px-4 py-2.5">
				<button
					aria-label={t("pluginDetail.back")}
					className="omp-pressable flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-omp-sm text-(--omp-muted) hover:bg-(--omp-selected-bg) hover:text-(--omp-text)"
					onClick={onClose}
					type="button"
				>
					<ArrowLeft size={13} />
					{t("pluginDetail.back")}
				</button>
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
					<span className="truncate text-omp-lg font-semibold text-(--omp-text)">{plugin.name}</span>
					{plugin.version && <span className="text-omp-xs tabular-nums text-(--omp-dim)">v{plugin.version}</span>}
					{plugin.marketplace === "npm" ? (
						<Badge variant="info">npm</Badge>
					) : (
						<Badge variant="default">{plugin.marketplace}</Badge>
					)}
					{plugin.scope && <Badge variant="muted">{t(`invPanel.scope.${plugin.scope}`)}</Badge>}
				</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
				{detail === null && loading ? (
					<div className="flex items-center justify-center py-10">
						<Spinner label={t("common.loading")} />
					</div>
				) : detail === null && loadError !== null ? (
					<div className="flex flex-col items-center gap-2.5 py-8">
						<CopyableError className="w-full" copyLabel={t("pluginDetail.copyError")} message={loadError} />
						<Button
							disabled={!sidecarReady}
							icon={<RefreshCw size={12} />}
							onClick={() => {
								setLoading(true);
								void load();
							}}
							size="sm"
							title={!sidecarReady ? t("common.notConnected") : undefined}
							variant="ghost"
						>
							{t("invPanel.retry")}
						</Button>
					</div>
				) : detail !== null ? (
					<>
						{/* A failed refresh keeps the last good detail on screen — say so, and
						    offer the re-read, instead of letting the panel look healthy. */}
						{loadError !== null && (
							<div className="flex items-start gap-2 rounded-lg border border-(--omp-error)/40 bg-(--omp-error-dim) px-3 py-2 text-omp-sm text-(--omp-error)">
								<div className="min-w-0 flex-1">
									<span className="font-semibold">{t("pluginDetail.stale")}</span> {loadError}
								</div>
								<Button
									disabled={!sidecarReady}
									icon={<RefreshCw size={12} />}
									onClick={() => {
										setLoading(true);
										void load();
									}}
									size="sm"
									title={!sidecarReady ? t("common.notConnected") : undefined}
									variant="ghost"
								>
									{t("invPanel.retry")}
								</Button>
							</div>
						)}
						<fieldset className="contents" disabled={!sidecarReady}>
							<section>
								<Toggle
									checked={detail.enabled}
									description={t("pluginDetail.enabledHint")}
									disabled={enabledBusy}
									label={t("pluginDetail.enabled")}
									onChange={next => void toggleEnabled(next)}
								/>
							</section>
							<section>
								<div className="mb-1.5 text-omp-sm font-semibold tracking-wide text-(--omp-dim) uppercase">
									{t("pluginDetail.features")}
								</div>
								{detail.features.length === 0 ? (
									<div className="rounded-md border border-(--omp-border-muted) px-3 py-3 text-omp-sm text-(--omp-dim)">
										{t("pluginDetail.featuresEmpty")}
									</div>
								) : (
									<>
										<div className="flex flex-col rounded-lg border border-(--omp-border-muted) bg-transparent">
											{detail.features.map(feature => (
												<label
													className="flex cursor-pointer items-start gap-2.5 border-b border-(--omp-border-muted) px-3 py-2 last:border-0 hover:bg-(--omp-selected-bg)"
													key={feature.id}
												>
													<input
														checked={currentFeatures.includes(feature.id)}
														className="mt-0.5"
														disabled={featuresBusy}
														onChange={event => toggleFeature(feature.id, event.target.checked)}
														type="checkbox"
													/>
													<span className="min-w-0 flex-1">
														<span className="block text-omp-md font-medium text-(--omp-text)">
															{feature.id}
														</span>
														{feature.description && (
															<span className="mt-0.5 block text-omp-sm leading-snug text-(--omp-dim)">
																{feature.description}
															</span>
														)}
													</span>
												</label>
											))}
										</div>
										{featuresError && (
											<CopyableError
												className="mt-2"
												copyLabel={t("pluginDetail.copyError")}
												message={featuresError}
											/>
										)}
										<div className="mt-2 flex justify-end">
											<Button
												disabled={!sidecarReady || !featuresDirty || featuresBusy}
												loading={featuresBusy}
												onClick={() => void saveFeatures()}
												size="sm"
											>
												{t("pluginDetail.saveFeatures")}
											</Button>
										</div>
									</>
								)}
							</section>
							<section>
								<div className="mb-1.5 text-omp-sm font-semibold tracking-wide text-(--omp-dim) uppercase">
									{t("pluginDetail.settings")}
								</div>
								{fields.length === 0 ? (
									<div className="rounded-md border border-(--omp-border-muted) px-3 py-3 text-omp-sm text-(--omp-dim)">
										{t("pluginDetail.settingsEmpty")}
									</div>
								) : (
									<>
										<div className="flex flex-col rounded-lg border border-(--omp-border-muted) bg-transparent">
											{fields.map(field => (
												<SettingFieldRow
													draft={drafts[field.key]}
													error={fieldErrors[field.key]}
													field={field}
													hasDraft={field.key in drafts}
													hasStoredValue={detail.configuredKeys.includes(field.key)}
													key={field.key}
													onCancelReplace={() => {
														setReplacingKey(null);
														clearDraft(field.key);
													}}
													onDraft={value => setDraft(field.key, value)}
													onReplace={() => {
														setReplacingKey(field.key);
														setDraft(field.key, "");
													}}
													onResetAsk={() => setResetKey(field.key)}
													onResetCancel={() => setResetKey(null)}
													onResetConfirm={() => void resetField(field)}
													replacing={replacingKey === field.key}
													resetState={
														resetKey === field.key ? (resetBusy ? "busy" : "confirming") : "idle"
													}
													saving={saving}
													value={
														// Unset non-secret settings show their declared default. Secret
														// values never cross the RPC boundary and are always write-only.
														field.secret ? undefined : (detail.values[field.key] ?? field.default)
													}
												/>
											))}
										</div>
										{failedCount > 0 && (
											<CopyableError
												className="mt-2"
												copyLabel={t("pluginDetail.copyError")}
												message={t("pluginDetail.someFailed", { count: failedCount })}
											/>
										)}
										<div className="mt-2 flex items-center justify-end gap-2">
											{savedTick && (
												<span className="flex items-center gap-1 text-omp-sm text-(--omp-success)">
													<Check size={11} />
													{t("pluginDetail.saved")}
												</span>
											)}
											<Button
												disabled={!sidecarReady || dirtyKeys.length === 0 || saving}
												loading={saving}
												onClick={() => void saveSettings()}
												size="sm"
											>
												{t("pluginDetail.saveSettings")}
											</Button>
										</div>
									</>
								)}
							</section>
						</fieldset>
					</>
				) : null}
			</div>
		</div>
	);
}
