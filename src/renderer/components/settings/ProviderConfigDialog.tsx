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
 *   action: openProviderConfig(editProvider?: CustomProviderView | null): void
 *           — no arg opens the list (Add provider from there); a view opens
 *           the form pre-filled for editing that provider.
 */

import { ChevronDown, ChevronRight, Eye, EyeOff, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	CustomProviderApi,
	CustomProviderDiscoveryType,
	CustomProviderInput,
	CustomProviderView,
} from "../../../shared/ipc-types";
import { CUSTOM_PROVIDER_APIS } from "../../../shared/ipc-types";
import { useT } from "../../lib/i18n";
import { useModelStore } from "../../stores/model";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Input, Modal, Spinner } from "../common";
import { FieldError, FieldLabel } from "./providers/FormFields";
import { ModelEditor, type ModelRow } from "./providers/ModelEditor";
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

const SELECT_CLASS =
	"w-full rounded-md border border-(--omp-border-muted) bg-(--omp-input-bg) px-2.5 py-1.5 text-xs text-(--omp-text) focus:border-(--omp-border-accent) focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

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
}

function ProviderForm({ editing, existing, directEdit, onBack, onSaved, onCancel }: ProviderFormProps) {
	const t = useT();
	const refreshProviders = useModelStore(state => state.refreshProviders);
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
	const [advancedOpen, setAdvancedOpen] = useState(() => Object.keys(editing?.headers ?? {}).length > 0);
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
		if (Object.keys(errs).length > 0) return;

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
					const { key, ...modelInput } = row;
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
			setSubmitError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSubmitting(false);
		}
	};

	const close = directEdit ? onCancel : onBack;

	return (
		<div className="flex max-h-[70vh] flex-col">
			<div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
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
						value={auth ?? ""}
						disabled={readonly || submitting}
						onChange={event =>
							setAuth((event.target.value || undefined) as "apiKey" | "none" | "oauth" | undefined)
						}
					>
						<option value="">{t("providerCfg.form.authApiKeyDefault")}</option>
						<option value="apiKey">{t("providerCfg.form.authApiKey")}</option>
						<option value="none">{t("common.none")}</option>
						<option value="oauth">OAuth</option>
					</select>
					<span className="mt-1 block text-omp-sm text-(--omp-dim)">{t("providerCfg.form.authHint")}</span>
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
					<span className="ml-6 block text-omp-sm text-(--omp-dim)">{t("providerCfg.form.authHeaderHint")}</span>
				)}

				<div>
					<FieldLabel>{t("providerCfg.form.discovery")}</FieldLabel>
					<div className="flex gap-2">
						<select
							className={SELECT_CLASS}
							style={{ flex: "2" }}
							value={discoveryType ?? ""}
							disabled={readonly || submitting}
							onChange={event =>
								setDiscoveryType((event.target.value || undefined) as CustomProviderDiscoveryType | undefined)
							}
						>
							<option value="">{t("providerCfg.form.discoveryNone")}</option>
							<option value="ollama">Ollama</option>
							<option value="llama.cpp">llama.cpp</option>
							<option value="lm-studio">LM Studio</option>
							<option value="openai-models-list">{t("providerCfg.form.discoveryOpenAiList")}</option>
							<option value="proxy">{t("providerCfg.form.discoveryProxy")}</option>
							<option value="litellm">LiteLLM</option>
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
					<span className="mt-1 block text-omp-sm text-(--omp-dim)">{t("providerCfg.form.discoveryHint")}</span>
				</div>

				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={disableStrictTools}
						onChange={e => setDisableStrictTools(e.target.checked)}
						disabled={readonly || submitting}
						className="h-4 w-4 rounded border-(--omp-input-border)"
					/>
					<span className="text-omp-sm text-(--omp-text)">{t("providerCfg.form.disableStrictTools")}</span>
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
						onChange={event => setTransport((event.target.value || undefined) as "pi-native" | undefined)}
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
					<span className="mt-1 block text-omp-sm text-(--omp-dim)">{t("providerCfg.form.extraBodyHint")}</span>
					<FieldError message={errors.extraBody} />
				</div>

				<div>
					<FieldLabel>{t("providerCfg.form.models")}</FieldLabel>
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
						className="flex items-center gap-1 text-omp-sm font-medium text-(--omp-muted) transition-colors hover:text-(--omp-text)"
						onClick={() => setAdvancedOpen(prev => !prev)}
					>
						{advancedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
						{t("providerCfg.form.advanced")}
					</button>
					{advancedOpen && (
						<div className="mt-2 flex flex-col gap-2">
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
					)}
				</div>

				{submitError && (
					<div className="rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent px-3 py-2 text-omp-md text-(--omp-error)">
						{t("providerCfg.toast.saveFailed")}: {submitError}
					</div>
				)}
			</div>

			<div className="flex shrink-0 items-center justify-end gap-2 border-t border-(--omp-border-muted) px-4 py-3">
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
	/** When set, opens directly in edit mode for this provider. */
	editProvider?: CustomProviderView | null;
}

export function ProviderConfigDialog({ open, onClose, editProvider = null }: ProviderConfigDialogProps) {
	const t = useT();
	const refreshProviders = useModelStore(state => state.refreshProviders);
	const [view, setView] = useState<View>({ kind: "list" });
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
			setListError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!open) return;
		setView(editProvider ? { kind: "form", editing: editProvider } : { kind: "list" });
		void load();
	}, [open, editProvider, load]);

	const handleClose = () => {
		setPendingDelete(null);
		onClose();
	};
	const handleCancel = () => {
		handleClose();
		useUiStore.getState().closeProviders();
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
			await load();
		} catch (cause) {
			toast({
				variant: "error",
				title: t("providerCfg.toast.deleteFailed"),
				message: cause instanceof Error ? cause.message : String(cause),
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
						editing={view.editing}
						existing={providers ?? []}
						directEdit={editProvider !== null}
						onBack={() => setView({ kind: "list" })}
						onSaved={() => {
							void load();
							onClose();
						}}
						onCancel={handleCancel}
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
										<span className="mt-1 text-omp-sm font-semibold uppercase tracking-wider text-(--omp-muted)">
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
