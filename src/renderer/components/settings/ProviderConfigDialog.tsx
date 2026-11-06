/**
 * ProviderConfigDialog: add / edit / delete third-party model providers stored
 * in the agent's models.yml, via the window.omp.models IPC surface.
 *
 * List mode shows every configured provider (custom ones get Edit/Delete,
 * built-ins are read-only). Form mode validates and upserts; the agent
 * live-reloads models.yml, so a saved provider is usable from the model
 * picker immediately.
 *
 * Parent wiring (parent owns stores/ui.ts + command-registry.ts):
 *   mount:  <ProviderConfigDialog open={ui.providerConfigOpen} editProvider={ui.providerConfigEdit} onClose={ui.closeProviderConfig} />
 *   action: openProviderConfig(editProvider?: CustomProviderView | "new" | null): void
 *           — no arg opens the list (Add provider from there); "new" opens the
 *           add form; a view opens the form pre-filled for editing that
 *           provider. Opened straight into a form, Cancel and save close the
 *           dialog and leave the caller (the Providers window) where it was.
 */

import { ChevronDown, ChevronRight, CloudDownload, Eye, EyeOff, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { customProviderNeedsApiKey } from "../../../shared/custom-provider";
import type {
	CustomProviderApi,
	CustomProviderDiscoveryType,
	CustomProviderInput,
	CustomProviderView,
} from "../../../shared/ipc-types";
import { CUSTOM_PROVIDER_APIS } from "../../../shared/ipc-types";
import type { DiscoveredModel } from "../../../shared/rpc-types";
import { ipcErrorMessage } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useModelStore } from "../../stores/model";
import { toast } from "../../stores/toast";
import { Button, Input, Modal, Spinner } from "../common";
import { FieldError, FieldLabel } from "./providers/FormFields";
import { ModelEditor, type ModelRow } from "./providers/ModelEditor";
import { ModelFetchPanel, mergeFetchedModels } from "./providers/ModelFetchPanel";
import { ProviderConfigRow } from "./providers/ProviderConfigRow";

/** Protocols accepted by models.yml (re-export from shared types). */
export const PROVIDER_PROTOCOLS = CUSTOM_PROVIDER_APIS;

/** New providers only contact a model-list endpoint when the user opts in. */
export function defaultProviderDiscovery(): undefined {
	return undefined;
}

/** Manual model rows are optional when the provider can discover them upstream. */
export function providerRequiresManualModels(discoveryType: CustomProviderDiscoveryType | undefined): boolean {
	return discoveryType === undefined;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// Same box as common/Input, so selects and text fields line up in one column.
const SELECT_CLASS =
	"w-full rounded-lg border border-(--omp-input-border) bg-(--omp-input-bg) px-3 py-[9px] text-omp-lg leading-[1.45] text-(--omp-text) shadow-(--omp-shadow-sm) transition-[border-color,box-shadow] duration-150 hover:border-(--omp-border-strong) focus:border-(--omp-input-focus-border) focus:shadow-[0_0_0_3px_var(--omp-input-glow)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/** Model-list protocols a server can speak, for fetching once and for keeping the list updated. */
function DiscoveryTypeOptions() {
	const t = useT();
	return (
		<>
			<option value="openai-models-list">{t("providerCfg.form.discoveryOpenAiList")}</option>
			<option value="ollama">Ollama</option>
			<option value="llama.cpp">llama.cpp</option>
			<option value="lm-studio">LM Studio</option>
			<option value="proxy">{t("providerCfg.form.discoveryProxy")}</option>
			<option value="litellm">LiteLLM</option>
		</>
	);
}

// ============================================================================
// Small field helpers (label/error markup matches common/Input's FieldShell)
// ============================================================================

// ============================================================================
// Form
// ============================================================================

interface HeaderRow {
	key: number;
	name: string;
	value: string;
}

function dropKey(errors: Record<string, string>, key: string): Record<string, string> {
	if (!(key in errors)) return errors;
	const next = { ...errors };
	delete next[key];
	return next;
}

function isValidHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

// ============================================================================
// ModelEditor: expandable per-model detail editor
// ============================================================================

// ============================================================================
// ProviderForm
// ============================================================================

interface ProviderFormProps {
	/** null = adding a new provider. */
	editing: CustomProviderView | null;
	/** Already-configured providers (for id collision checks when adding). */
	existing: CustomProviderView[];
	/** Opened straight into the form via the editProvider prop (cancel closes instead of going back). */
	directEdit: boolean;
	onBack: () => void;
	onSaved: () => void;
	onCancel: () => void;
	/** Ask to delete the provider being edited (the Providers window reaches entries only through Edit). */
	onDelete?: () => void;
}

function ProviderForm({ editing, existing, directEdit, onBack, onSaved, onCancel, onDelete }: ProviderFormProps) {
	const t = useT();
	const refreshProviders = useModelStore(state => state.refreshProviders);
	const rpc = useTabRpc();
	const nextKey = useRef(1);
	const readonly = editing?.builtin ?? false;

	const [id, setId] = useState(editing?.id ?? "");
	const [api, setApi] = useState<CustomProviderApi>(
		(editing?.api as CustomProviderApi | undefined) ?? PROVIDER_PROTOCOLS[0],
	);
	const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? "");
	const [apiKey, setApiKey] = useState("");
	const [clearKey, setClearKey] = useState(false);
	const [showKey, setShowKey] = useState(false);
	const [auth, setAuth] = useState<"apiKey" | "none" | "oauth" | undefined>(editing?.auth);
	const [authHeader, setAuthHeader] = useState(editing?.authHeader ?? false);
	const [discoveryType, setDiscoveryType] = useState<CustomProviderDiscoveryType | undefined>(() =>
		editing ? editing.discovery?.type : defaultProviderDiscovery(),
	);
	const [discoveryTimeout, setDiscoveryTimeout] = useState<number | undefined>(editing?.discovery?.timeoutMs);
	const [fetchType, setFetchType] = useState<CustomProviderDiscoveryType>(
		editing?.discovery?.type ?? "openai-models-list",
	);
	const [fetching, setFetching] = useState(false);
	const [fetched, setFetched] = useState<DiscoveredModel[] | null>(null);
	const [fetchError, setFetchError] = useState<string | null>(null);
	const [disableStrictTools, setDisableStrictTools] = useState(editing?.disableStrictTools ?? false);
	const [transport, setTransport] = useState<"pi-native" | undefined>(editing?.transport);
	const [extraBody, setExtraBody] = useState(() =>
		editing?.extraBody ? JSON.stringify(editing.extraBody, null, 2) : "",
	);
	const [models, setModels] = useState<ModelRow[]>(() =>
		editing?.models.length
			? editing.models.map(m => ({ key: nextKey.current++, ...m }))
			: [{ key: nextKey.current++, id: "", name: "" }],
	);
	const [headers, setHeaders] = useState<HeaderRow[]>(() =>
		Object.entries(editing?.headers ?? {}).map(([name, value]) => ({
			key: nextKey.current++,
			name,
			value: String(value),
		})),
	);
	// Collapsed unless the entry already uses one of the advanced settings.
	const [advancedOpen, setAdvancedOpen] = useState(
		() =>
			Object.keys(editing?.headers ?? {}).length > 0 ||
			editing?.authHeader === true ||
			editing?.discovery !== undefined ||
			editing?.disableStrictTools === true ||
			editing?.transport !== undefined ||
			editing?.extraBody !== undefined,
	);
	const formRef = useRef<HTMLDivElement>(null);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const updateModel = (key: number, patch: Partial<Omit<ModelRow, "key">>) => {
		setModels(prev => prev.map(row => (row.key === key ? { ...row, ...patch } : row)));
		setErrors(prev => dropKey(prev, "models"));
	};
	const addModel = () => setModels(prev => [...prev, { key: nextKey.current++, id: "", name: "" }]);
	const removeModel = (key: number) =>
		setModels(prev => (prev.length > 1 ? prev.filter(row => row.key !== key) : prev));

	const fetchModels = async () => {
		const url = baseUrl.trim();
		if (!isValidHttpUrl(url)) {
			setErrors(prev => ({
				...prev,
				baseUrl: url ? t("providerCfg.form.baseUrlInvalid") : t("providerCfg.form.baseUrlRequired"),
			}));
			return;
		}
		const headerEntries = headers.filter(row => row.name.trim().length > 0);
		setFetching(true);
		setFetchError(null);
		setFetched(null);
		try {
			const response = await rpc.discoverProviderModels({
				// A saved key only ever goes with the provider it was saved for.
				...(editing && !clearKey ? { provider: editing.id } : {}),
				api,
				baseUrl: url,
				...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
				...(authHeader ? { authHeader: true } : {}),
				...(headerEntries.length > 0
					? { headers: Object.fromEntries(headerEntries.map(row => [row.name.trim(), row.value])) }
					: {}),
				discoveryType: fetchType,
				...(discoveryTimeout ? { timeoutMs: discoveryTimeout } : {}),
			});
			if (!response.success) throw new Error(response.error);
			const found = (response.data as { models: DiscoveredModel[] }).models;
			if (found.length === 0) setFetchError(t("providerCfg.fetch.empty"));
			else setFetched(found.toSorted((a, b) => a.id.localeCompare(b.id)));
		} catch (cause) {
			setFetchError(t("providerCfg.fetch.failed", { error: ipcErrorMessage(cause) }));
		} finally {
			setFetching(false);
		}
	};
	const addFetchedModels = (picked: DiscoveredModel[]) => {
		setModels(prev => mergeFetchedModels(prev, picked, () => nextKey.current++));
		setErrors(prev => dropKey(prev, "models"));
		setFetched(null);
	};

	const updateHeader = (key: number, patch: Partial<Omit<HeaderRow, "key">>) => {
		setHeaders(prev => prev.map(row => (row.key === key ? { ...row, ...patch } : row)));
		setErrors(prev => dropKey(prev, "headers"));
	};
	const addHeader = () => setHeaders(prev => [...prev, { key: nextKey.current++, name: "", value: "" }]);
	const removeHeader = (key: number) => setHeaders(prev => prev.filter(row => row.key !== key));

	const validate = (): Record<string, string> => {
		const errs: Record<string, string> = {};
		if (!editing) {
			const candidate = id.trim();
			if (!candidate) errs.id = t("providerCfg.form.idRequired");
			else if (!ID_PATTERN.test(candidate)) errs.id = t("providerCfg.form.idSlug");
			else if (existing.some(p => p.id === candidate)) errs.id = t("providerCfg.form.idExists");
		}
		const url = baseUrl.trim();
		if (!url) errs.baseUrl = t("providerCfg.form.baseUrlRequired");
		else if (!isValidHttpUrl(url)) errs.baseUrl = t("providerCfg.form.baseUrlInvalid");

		const filled = models.filter(row => row.id.trim().length > 0);
		const keySaved = editing?.hasApiKey === true && !clearKey;
		if (
			customProviderNeedsApiKey({
				auth,
				hasApiKey: apiKey.trim().length > 0 || keySaved,
				modelCount: filled.length,
			})
		) {
			errs.apiKey = t("providerCfg.form.apiKeyRequired");
		}
		if (filled.length === 0 && providerRequiresManualModels(discoveryType)) {
			errs.models = t("providerCfg.form.modelsRequired");
		} else if (models.some(row => row.id.trim().length === 0 && (row.name?.trim().length ?? 0) > 0)) {
			errs.models = t("providerCfg.form.modelIdRequired");
		} else {
			const seen = new Set<string>();
			for (const row of filled) {
				const modelId = row.id.trim();
				if (seen.has(modelId)) {
					errs.models = t("providerCfg.form.modelDuplicate", { id: modelId });
					break;
				}
				seen.add(modelId);
			}
		}

		// Cost validation: if any field filled, all four required and finite ≥ 0
		for (const row of filled) {
			const cost = row.cost;
			if (cost) {
				const fields = [cost.input, cost.output, cost.cacheRead, cost.cacheWrite];
				const anyFilled = fields.some(v => v !== undefined);
				if (anyFilled) {
					const allFilled = fields.every(v => v !== undefined && Number.isFinite(v) && v >= 0);
					if (!allFilled) {
						errs.models = t("providerCfg.form.costAllRequired");
						break;
					}
				}
			}
		}

		const headerSeen = new Set<string>();
		for (const row of headers) {
			const name = row.name.trim();
			if (!name) continue;
			if (headerSeen.has(name)) {
				errs.headers = t("providerCfg.form.headerDuplicate", { name });
				break;
			}
			headerSeen.add(name);
		}
		return errs;
	};

	const handleSubmit = async () => {
		const errs = validate();
		setErrors(errs);
		if (Object.keys(errs).length > 0) {
			// The save button sits below a long form: a message rendered above the
			// fold reads as "the button did nothing".
			if (errs.headers || errs.extraBody) setAdvancedOpen(true);
			requestAnimationFrame(() => {
				formRef.current?.querySelector("[data-field-error]")?.scrollIntoView({ block: "center" });
			});
			return;
		}

		const headerEntries = headers.filter(row => row.name.trim().length > 0);
		let parsedExtraBody: Record<string, unknown> | undefined;
		if (extraBody.trim().length > 0) {
			try {
				parsedExtraBody = JSON.parse(extraBody);
			} catch {
				setErrors({ extraBody: t("providerCfg.form.extraBodyInvalid") });
				return;
			}
		}

		const input: CustomProviderInput = {
			id: editing ? editing.id : id.trim(),
			api,
			baseUrl: baseUrl.trim(),
			...(apiKey.trim().length > 0 ? { apiKey: apiKey.trim() } : {}),
			...(clearKey ? { clearApiKey: true } : {}),
			...(auth ? { auth } : {}),
			...(authHeader ? { authHeader: true } : {}),
			...(headerEntries.length > 0
				? { headers: Object.fromEntries(headerEntries.map(row => [row.name.trim(), row.value])) }
				: {}),
			...(discoveryType
				? {
						discovery: {
							type: discoveryType,
							...(discoveryTimeout ? { timeoutMs: discoveryTimeout } : {}),
						},
					}
				: {}),
			...(disableStrictTools ? { disableStrictTools: true } : {}),
			...(transport ? { transport } : {}),
			...(parsedExtraBody ? { extraBody: parsedExtraBody } : {}),
			models: models
				.filter(row => row.id.trim().length > 0)
				.map(row => {
					const { key: _key, ...modelInput } = row;
					return {
						...modelInput,
						id: modelInput.id.trim(),
						...(modelInput.name && modelInput.name.trim().length > 0 ? { name: modelInput.name.trim() } : {}),
					};
				}),
		};

		setSubmitting(true);
		setSubmitError(null);
		try {
			await window.omp.models.upsertProvider(input);
			try {
				const catalog = await refreshProviders(true);
				const discoveryError = catalog.discoveryStates.find(
					state => state.provider === input.id && state.status === "unavailable",
				);
				if (discoveryError) {
					toast({
						variant: "warning",
						title: t("providerCfg.toast.refreshFailed"),
						message: discoveryError.error ?? t("providers.discoveryUnavailable"),
					});
				}
			} catch (cause) {
				toast({
					variant: "warning",
					title: t("providerCfg.toast.refreshFailed"),
					message: cause instanceof Error ? cause.message : String(cause),
				});
			}
			toast({ variant: "success", message: t("providerCfg.toast.saved", { id: input.id }) });
			onSaved();
		} catch (cause) {
			setSubmitError(ipcErrorMessage(cause));
		} finally {
			setSubmitting(false);
		}
	};

	const close = directEdit ? onCancel : onBack;

	return (
		<div className="flex max-h-[70vh] flex-col">
			<div ref={formRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
				{readonly && (
					<div className="rounded-md border border-(--omp-border-muted) bg-transparent px-3 py-2 text-omp-md text-(--omp-muted)">
						{t("providerCfg.form.builtinReadonly")}
					</div>
				)}

				<Input
					label={t("providerCfg.form.id")}
					mono
					value={id}
					onChange={event => {
						setId(event.target.value);
						setErrors(prev => dropKey(prev, "id"));
					}}
					placeholder={t("providerCfg.form.idPlaceholder")}
					hint={editing ? undefined : t("providerCfg.form.idHint")}
					error={errors.id}
					disabled={editing !== null || submitting}
					autoFocus={!editing}
				/>

				<div>
					<FieldLabel>{t("providerCfg.form.api")}</FieldLabel>
					<select
						className={SELECT_CLASS}
						value={api}
						disabled={readonly || submitting}
						onChange={event => setApi(event.target.value as CustomProviderApi)}
					>
						{PROVIDER_PROTOCOLS.map(protocol => (
							<option key={protocol} value={protocol}>
								{protocol}
							</option>
						))}
					</select>
				</div>

				<Input
					label={t("providerCfg.form.baseUrl")}
					mono
					value={baseUrl}
					onChange={event => {
						setBaseUrl(event.target.value);
						setErrors(prev => dropKey(prev, "baseUrl"));
					}}
					placeholder={t("providerCfg.form.baseUrlPlaceholder")}
					error={errors.baseUrl}
					disabled={readonly || submitting}
				/>

				<div>
					<FieldLabel>{t("providerCfg.form.apiKey")}</FieldLabel>
					<div className="relative">
						<Input
							type={showKey ? "text" : "password"}
							mono
							value={apiKey}
							onChange={event => {
								setApiKey(event.target.value);
								setClearKey(false);
								setErrors(prev => dropKey(prev, "apiKey"));
							}}
							placeholder={
								clearKey
									? t("providerCfg.form.apiKeyRemoving")
									: (editing?.apiKeyPreview ?? t("providerCfg.form.apiKeyPlaceholder"))
							}
							disabled={readonly || submitting || clearKey}
							className="pr-8"
							autoComplete="off"
						/>
						<button
							type="button"
							aria-label={showKey ? t("providerCfg.form.apiKeyHide") : t("providerCfg.form.apiKeyShow")}
							className="absolute right-2 top-1/2 -translate-y-1/2 text-(--omp-dim) transition-colors hover:text-(--omp-text) disabled:opacity-50"
							onClick={() => setShowKey(prev => !prev)}
							disabled={readonly || submitting || clearKey}
						>
							{showKey ? <EyeOff size={13} /> : <Eye size={13} />}
						</button>
					</div>
					<span className={`mt-1 block text-omp-sm ${clearKey ? "text-(--omp-warning)" : "text-(--omp-dim)"}`}>
						{clearKey
							? t("providerCfg.form.apiKeyRemovingHint")
							: editing?.hasApiKey
								? t("providerCfg.form.apiKeyKeep")
								: t("providerCfg.form.apiKeyOptional")}
					</span>
					<FieldError message={errors.apiKey} />
					{/* The field is masked, so a blank submit cannot mean "delete" —
						without this action the only way to revoke a key is to delete the
						whole provider (baseUrl, headers and models included). */}
					{editing?.hasApiKey && !readonly && !clearKey && (
						<button
							type="button"
							onClick={() => setClearKey(true)}
							disabled={submitting}
							className="text-omp-sm font-medium text-(--omp-error) transition-opacity hover:opacity-80 disabled:opacity-50"
						>
							{t("providerCfg.form.apiKeyRemove")}
						</button>
					)}
					{clearKey && (
						<button
							type="button"
							onClick={() => setClearKey(false)}
							disabled={submitting}
							className="text-omp-sm font-medium text-(--omp-accent) transition-opacity hover:opacity-80 disabled:opacity-50"
						>
							{t("providerCfg.form.apiKeyKeepIt")}
						</button>
					)}
				</div>

				<div>
					<FieldLabel>{t("providerCfg.form.auth")}</FieldLabel>
					<select
						className={SELECT_CLASS}
						// An explicit `auth: apiKey` is the default spelled out: one choice, not two.
						value={auth === "apiKey" ? "" : (auth ?? "")}
						disabled={readonly || submitting}
						onChange={event => {
							setAuth((event.target.value || undefined) as "none" | "oauth" | undefined);
							setErrors(prev => dropKey(prev, "apiKey"));
						}}
					>
						<option value="">{t("providerCfg.form.authApiKey")}</option>
						<option value="none">{t("providerCfg.form.authNone")}</option>
						<option value="oauth">OAuth</option>
					</select>
					<span className="mt-1 block text-omp-sm text-(--omp-dim)">{t("providerCfg.form.authHint")}</span>
				</div>

				<div>
					<div className="flex items-end justify-between gap-2">
						<FieldLabel>{t("providerCfg.form.models")}</FieldLabel>
						{!readonly && (
							<div className="mb-1 flex shrink-0 items-center gap-1.5">
								<select
									aria-label={t("providerCfg.fetch.server")}
									className="h-7 max-w-52 rounded-md border border-(--omp-input-border) bg-(--omp-input-bg) px-1.5 text-omp-sm text-(--omp-text) outline-none focus:border-(--omp-input-focus-border) disabled:opacity-50"
									disabled={fetching || submitting}
									onChange={event => setFetchType(event.target.value as CustomProviderDiscoveryType)}
									value={fetchType}
								>
									<DiscoveryTypeOptions />
								</select>
								<Button
									disabled={submitting}
									icon={<CloudDownload size={12} />}
									loading={fetching}
									onClick={() => void fetchModels()}
									size="sm"
									variant="ghost"
								>
									{t("providerCfg.fetch.action")}
								</Button>
							</div>
						)}
					</div>
					{!readonly && !fetched && !fetchError && !models.some(row => row.id.trim()) && (
						<span className="mb-1.5 block text-omp-sm text-(--omp-dim)">{t("providerCfg.fetch.hint")}</span>
					)}
					{fetchError && (
						<p className="mb-1.5 text-omp-sm text-(--omp-error)" role="alert">
							{fetchError}
						</p>
					)}
					{fetched && (
						<ModelFetchPanel
							existingIds={new Set(models.map(row => row.id.trim()))}
							models={fetched}
							onAdd={addFetchedModels}
							onClose={() => setFetched(null)}
						/>
					)}
					<div className="flex flex-col gap-2">
						{models.map(row => (
							<ModelEditor
								key={row.key}
								model={row}
								readonly={readonly}
								disabled={submitting}
								onUpdate={updateModel}
								onRemove={removeModel}
								canRemove={models.length > 1}
							/>
						))}
					</div>
					{!readonly && (
						<Button
							size="sm"
							variant="ghost"
							className="mt-1.5"
							icon={<Plus size={12} />}
							onClick={addModel}
							disabled={submitting}
						>
							{t("providerCfg.form.modelAdd")}
						</Button>
					)}
					<FieldError message={errors.models} />
					{discoveryType && (
						<span className="mt-1 block text-omp-sm text-(--omp-dim)">
							{t("providerCfg.form.modelsDiscoveryOptional")}
						</span>
					)}
				</div>

				<div>
					<button
						type="button"
						aria-expanded={advancedOpen}
						className="flex items-center gap-1 text-omp-sm font-medium text-(--omp-muted) transition-colors hover:text-(--omp-text)"
						onClick={() => setAdvancedOpen(prev => !prev)}
					>
						{advancedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
						{t("providerCfg.form.advanced")}
					</button>
					{!advancedOpen && (
						<span className="mt-0.5 block text-omp-sm text-(--omp-dim)">
							{t("providerCfg.form.advancedHint")}
						</span>
					)}
					{advancedOpen && (
						<div className="mt-2 flex flex-col gap-3">
							<div>
								<FieldLabel>{t("providerCfg.form.discovery")}</FieldLabel>
								<div className="flex gap-2">
									<select
										className={SELECT_CLASS}
										style={{ flex: "2" }}
										value={discoveryType ?? ""}
										disabled={readonly || submitting}
										onChange={event => {
											const type = (event.target.value || undefined) as
												| CustomProviderDiscoveryType
												| undefined;
											setDiscoveryType(type);
											if (type) setFetchType(type);
										}}
									>
										<option value="">{t("providerCfg.form.discoveryNone")}</option>
										<DiscoveryTypeOptions />
									</select>
									<Input
										type="number"
										value={discoveryTimeout ?? ""}
										onChange={e =>
											setDiscoveryTimeout(e.target.value ? Number.parseInt(e.target.value, 10) : undefined)
										}
										placeholder={t("providerCfg.form.discoveryTimeout")}
										disabled={readonly || submitting || !discoveryType}
										style={{ flex: "1" }}
									/>
								</div>
								<span className="mt-1 block text-omp-sm text-(--omp-dim)">
									{t("providerCfg.form.discoveryHint")}
								</span>
							</div>

							<label className="flex items-center gap-2">
								<input
									type="checkbox"
									checked={authHeader}
									onChange={e => setAuthHeader(e.target.checked)}
									disabled={readonly || submitting}
									className="h-4 w-4 rounded border-(--omp-input-border)"
								/>
								<span className="text-omp-sm text-(--omp-text)">{t("providerCfg.form.authHeader")}</span>
							</label>
							{authHeader && (
								<span className="ml-6 block text-omp-sm text-(--omp-dim)">
									{t("providerCfg.form.authHeaderHint")}
								</span>
							)}

							<label className="flex items-center gap-2">
								<input
									type="checkbox"
									checked={disableStrictTools}
									onChange={e => setDisableStrictTools(e.target.checked)}
									disabled={readonly || submitting}
									className="h-4 w-4 rounded border-(--omp-input-border)"
								/>
								<span className="text-omp-sm text-(--omp-text)">
									{t("providerCfg.form.disableStrictTools")}
								</span>
							</label>
							{disableStrictTools && (
								<span className="ml-6 block text-omp-sm text-(--omp-dim)">
									{t("providerCfg.form.disableStrictToolsHint")}
								</span>
							)}

							<div>
								<FieldLabel>{t("providerCfg.form.transport")}</FieldLabel>
								<select
									className={SELECT_CLASS}
									value={transport ?? ""}
									disabled={readonly || submitting}
									onChange={event =>
										setTransport((event.target.value || undefined) as "pi-native" | undefined)
									}
								>
									<option value="">{t("common.defaultParenthesized")}</option>
									<option value="pi-native">pi-native</option>
								</select>
							</div>

							<div>
								<FieldLabel>{t("providerCfg.form.extraBody")}</FieldLabel>
								<textarea
									value={extraBody}
									onChange={e => {
										setExtraBody(e.target.value);
										setErrors(prev => dropKey(prev, "extraBody"));
									}}
									placeholder={t("providerCfg.form.extraBodyPlaceholder")}
									disabled={readonly || submitting}
									rows={3}
									className="w-full rounded-md border border-(--omp-input-border) bg-(--omp-input-bg) px-2.5 py-1.5 font-mono text-omp-sm text-(--omp-text) outline-none transition-colors placeholder:text-(--omp-dim) hover:border-(--omp-border-strong) focus:border-(--omp-input-focus-border) disabled:cursor-not-allowed disabled:opacity-60"
								/>
								<span className="mt-1 block text-omp-sm text-(--omp-dim)">
									{t("providerCfg.form.extraBodyHint")}
								</span>
								<FieldError message={errors.extraBody} />
							</div>

							<div>
								<FieldLabel>{t("providerCfg.form.headers")}</FieldLabel>
								<div className="flex flex-col gap-2">
									{headers.map(row => (
										<div key={row.key} className="flex items-start gap-2">
											<div className="min-w-0 flex-1">
												<Input
													mono
													value={row.name}
													onChange={event => updateHeader(row.key, { name: event.target.value })}
													placeholder={t("providerCfg.form.headerName")}
													disabled={readonly || submitting}
													aria-label={t("providerCfg.form.headerName")}
												/>
											</div>
											<div className="min-w-0 flex-1">
												<Input
													mono
													value={row.value}
													onChange={event => updateHeader(row.key, { value: event.target.value })}
													placeholder={t("providerCfg.form.headerValue")}
													disabled={readonly || submitting}
													aria-label={t("providerCfg.form.headerValue")}
												/>
											</div>
											<Button
												size="sm"
												variant="ghost"
												className="mt-1"
												icon={<Trash2 size={12} />}
												aria-label={t("providerCfg.form.headerRemove")}
												disabled={readonly || submitting}
												onClick={() => removeHeader(row.key)}
											/>
										</div>
									))}
									{!readonly && (
										<div>
											<Button
												size="sm"
												variant="ghost"
												icon={<Plus size={12} />}
												onClick={addHeader}
												disabled={submitting}
											>
												{t("providerCfg.form.headerAdd")}
											</Button>
										</div>
									)}
									<FieldError message={errors.headers} />
								</div>
							</div>
						</div>
					)}
				</div>

				{submitError && (
					<div className="rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent px-3 py-2 text-omp-md text-(--omp-error)">
						{t("providerCfg.toast.saveFailed")}: {submitError}
					</div>
				)}
			</div>

			<div className="flex shrink-0 items-center justify-end gap-2 border-t border-(--omp-border-muted) px-4 py-3">
				{editing && !readonly && onDelete && (
					<Button
						variant="ghost"
						className="mr-auto text-(--omp-error)"
						icon={<Trash2 size={12} />}
						onClick={onDelete}
						disabled={submitting}
					>
						{t("providerCfg.list.delete")}
					</Button>
				)}
				<Button variant="ghost" onClick={close} disabled={submitting}>
					{t("providerCfg.form.cancel")}
				</Button>
				{!readonly && (
					<Button variant="primary" loading={submitting} onClick={() => void handleSubmit()}>
						{editing ? t("providerCfg.form.save") : t("providerCfg.form.add")}
					</Button>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// List row
// ============================================================================

// ============================================================================
// Dialog
// ============================================================================

type View = { kind: "list" } | { kind: "form"; editing: CustomProviderView | null };

export interface ProviderConfigDialogProps {
	open: boolean;
	onClose: () => void;
	/** When set, opens directly in the form: `"new"` to add, a view to edit. */
	editProvider?: CustomProviderView | "new" | null;
}

function viewFor(editProvider: CustomProviderView | "new" | null): View {
	if (editProvider === "new") return { kind: "form", editing: null };
	return editProvider ? { kind: "form", editing: editProvider } : { kind: "list" };
}

export function ProviderConfigDialog({ open, onClose, editProvider = null }: ProviderConfigDialogProps) {
	const t = useT();
	const refreshProviders = useModelStore(state => state.refreshProviders);
	const activeModel = useModelStore(state => state.model);
	const [view, setView] = useState<View>(() => viewFor(editProvider));
	// Decided while rendering, not in an effect: a form mounted on the last request's
	// view keeps that provider's fields under this one's title, and saves them over it.
	const request = open ? editProvider : undefined;
	const [lastRequest, setLastRequest] = useState(request);
	if (request !== lastRequest) {
		setLastRequest(request);
		if (request !== undefined) setView(viewFor(request));
	}
	const [providers, setProviders] = useState<CustomProviderView[] | null>(null);
	const [listError, setListError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<CustomProviderView | null>(null);
	const [deleting, setDeleting] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		setListError(null);
		try {
			setProviders(await window.omp.models.listProviders());
		} catch (cause) {
			setListError(ipcErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open) void load();
	}, [open, load]);

	const handleClose = () => {
		setPendingDelete(null);
		onClose();
	};

	const confirmDelete = async () => {
		if (!pendingDelete) return;
		setDeleting(true);
		try {
			await window.omp.models.deleteProvider(pendingDelete.id);
			try {
				await refreshProviders(true);
			} catch (cause) {
				toast({
					variant: "warning",
					title: t("providerCfg.toast.refreshFailed"),
					message: cause instanceof Error ? cause.message : String(cause),
				});
			}
			toast({ variant: "success", message: t("providerCfg.toast.deleted", { id: pendingDelete.id }) });
			setPendingDelete(null);
			// Deleted from its own edit form: the form has nothing left to show.
			if (view.kind === "form") {
				if (editProvider !== null) onClose();
				else setView({ kind: "list" });
			}
			await load();
		} catch (cause) {
			toast({
				variant: "error",
				title: t("providerCfg.toast.deleteFailed"),
				message: ipcErrorMessage(cause),
			});
		} finally {
			setDeleting(false);
		}
	};

	const title =
		view.kind === "form"
			? view.editing
				? t("providerCfg.title.edit", { id: view.editing.id })
				: t("providerCfg.title.add")
			: t("providerCfg.title.list");

	const custom = providers?.filter(p => !p.builtin) ?? [];
	const builtin = providers?.filter(p => p.builtin) ?? [];

	return (
		<>
			<Modal bodyClassName="p-0" open={open} onClose={handleClose} title={title} size="lg">
				{view.kind === "form" ? (
					<ProviderForm
						key={view.editing?.id ?? "new"}
						editing={view.editing}
						existing={providers ?? []}
						directEdit={editProvider !== null}
						onBack={() => setView({ kind: "list" })}
						onSaved={() => {
							void load();
							onClose();
						}}
						onCancel={handleClose}
						onDelete={view.editing ? () => setPendingDelete(view.editing) : undefined}
					/>
				) : (
					<div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto p-4">
						<div className="flex items-center justify-between gap-2">
							<span className="min-w-0 flex-1 text-omp-sm text-(--omp-dim)">{t("providerCfg.subtitle")}</span>
							<div className="flex shrink-0 items-center gap-1.5">
								<Button
									size="sm"
									variant="ghost"
									icon={<RefreshCw size={12} />}
									aria-label={t("providerCfg.list.refresh")}
									onClick={() => void load()}
									loading={loading}
								/>
								<Button
									size="sm"
									variant="primary"
									icon={<Plus size={12} />}
									onClick={() => setView({ kind: "form", editing: null })}
								>
									{t("providerCfg.list.add")}
								</Button>
							</div>
						</div>

						{listError && (
							<div className="flex items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent px-3 py-2 text-omp-md text-(--omp-error)">
								<span className="min-w-0 flex-1">
									{t("providerCfg.list.loadFailed")}: {listError}
								</span>
								<Button size="sm" variant="ghost" onClick={() => void load()}>
									{t("providerCfg.list.retry")}
								</Button>
							</div>
						)}

						{loading && !providers && (
							<div className="flex items-center justify-center py-8">
								<Spinner />
							</div>
						)}

						{providers && (
							<>
								{custom.length === 0 ? (
									<div className="rounded-md border border-(--omp-border-muted) px-3 py-4 text-center text-omp-md text-(--omp-dim)">
										{t("providerCfg.list.empty")}
									</div>
								) : (
									<div className="flex flex-col gap-2">
										{custom.map(provider => (
											<ProviderConfigRow
												key={provider.id}
												provider={provider}
												onEdit={p => setView({ kind: "form", editing: p })}
												onDelete={setPendingDelete}
												t={t}
											/>
										))}
									</div>
								)}

								{builtin.length > 0 && (
									<>
										<span className="mt-1 text-omp-sm font-semibold text-(--omp-muted)">
											{t("providerCfg.list.builtinSection")}
										</span>
										<div className="flex flex-col gap-2">
											{builtin.map(provider => (
												<ProviderConfigRow key={provider.id} provider={provider} t={t} />
											))}
										</div>
										<span className="text-omp-sm text-(--omp-dim)">{t("providerCfg.list.builtinNote")}</span>
									</>
								)}
							</>
						)}
					</div>
				)}
			</Modal>

			<Modal
				open={pendingDelete !== null}
				onClose={() => setPendingDelete(null)}
				size="sm"
				title={t("providerCfg.delete.title")}
			>
				<p className="text-omp-lg leading-relaxed text-(--omp-muted)">
					{t("providerCfg.delete.body", { id: pendingDelete?.id ?? "" })}
				</p>
				{/* Deleting the provider the session runs on leaves the composer on a
					model that no longer exists; say so before, not after the next send. */}
				{pendingDelete && activeModel?.provider === pendingDelete.id && (
					<p role="alert" className="mt-3 text-omp-md leading-relaxed text-(--omp-warning)">
						{t("providerCfg.delete.inUse", { model: activeModel.name ?? activeModel.id })}
					</p>
				)}
				<div className="mt-5 flex justify-end gap-2">
					<Button disabled={deleting} onClick={() => setPendingDelete(null)} variant="ghost">
						{t("providerCfg.delete.cancel")}
					</Button>
					<Button loading={deleting} onClick={() => void confirmDelete()} variant="danger">
						{t("providerCfg.delete.confirm")}
					</Button>
				</div>
			</Modal>
		</>
	);
}
