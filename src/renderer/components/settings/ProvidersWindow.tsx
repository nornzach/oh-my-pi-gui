import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Providers window: lists all configured providers with auth status,
 * login/logout for OAuth providers, model counts, and base URL overrides.
 * Login triggers the existing extension_ui open_url flow via rpc.login().
 */

import { Edit, ExternalLink, Globe, LogIn, LogOut, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomProviderView } from "../../../shared/ipc-types";
import type { ProviderDiscoveryState, ProviderInfo, ProvidersResult } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { useModelStore } from "../../stores/model";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Badge, Button, ConfirmDialog, Modal, Spinner } from "../common";

function AuthBadge({ provider, t }: { provider: ProviderInfo; t: (k: string) => string }) {
	if (!provider.authenticated) return <Badge variant="muted">{t("providers.badge.noAuth")}</Badge>;
	if (provider.authKind === "oauth")
		return (
			<Badge variant="success" dot>
				{t("providers.badge.oauth")}
			</Badge>
		);
	if (provider.authKind === "env") return <Badge variant="info">{t("providers.badge.env")}</Badge>;
	return (
		<Badge variant="success" dot>
			{t("providers.badge.apikey")}
		</Badge>
	);
}

type ProviderEditAction = { kind: "login" } | { kind: "config"; provider: CustomProviderView } | null;

/**
 * Resolve the provider's editable resource: registered credential flow first,
 * then a user-owned models.yml entry. Catalog-only providers are read-only.
 */
export function resolveProviderEditAction(
	provider: ProviderInfo,
	customConfigs: CustomProviderView[],
): ProviderEditAction {
	if (provider.loginAvailable) return { kind: "login" };
	const config = customConfigs.find(candidate => candidate.id === provider.id);
	return config && !config.builtin ? { kind: "config", provider: config } : null;
}

/** Only user-required discovery failures should become settings errors. */
export function providerDiscoveryErrors(states: readonly ProviderDiscoveryState[], fallbackMessage: string): string[] {
	return states
		.filter(state => state.status === "unavailable" && !state.optional)
		.map(state => `${state.provider}: ${state.error ?? fallbackMessage}`);
}
export function ProviderRow({
	provider,
	customConfigs,
	onLogin,
	onLogout,
	onEdit,
	busy,
	sidecarReady = true,
	t,
}: {
	provider: ProviderInfo;
	customConfigs: CustomProviderView[];
	onLogin: (id: string) => void;
	onLogout: (id: string) => void;
	onEdit: (id: string) => void;
	busy: boolean;
	sidecarReady?: boolean;
	t: (k: string, p?: Record<string, string | number>) => string;
}) {
	const editAction = resolveProviderEditAction(provider, customConfigs);
	const showEdit = editAction?.kind === "config" || (editAction?.kind === "login" && provider.authenticated);
	// A key written in models.yml is reinstalled by every catalog reload, so
	// signing out clears a credential the provider never used: the row would stay
	// authenticated and the button would look broken. Editing the entry is the
	// action that actually removes it.
	const showLogout =
		provider.authenticated && !customConfigs.some(config => config.id === provider.id && config.hasApiKey);
	return (
		<div className="flex items-center gap-3 rounded-lg border border-[var(--omp-border-muted)] px-3 py-2.5">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-center gap-2">
					<span className="text-omp-lg font-medium text-[var(--omp-text)]">{provider.name}</span>
					<AuthBadge provider={provider} t={t} />
					{provider.disabled && <Badge variant="warning">{t("providers.badge.disabled")}</Badge>}
				</div>
				<div className="flex items-center gap-3 text-omp-sm text-[var(--omp-dim)]">
					{provider.account && <span>{provider.account}</span>}
					{provider.modelCount > 0 && <span>{t("providers.models", { count: provider.modelCount })}</span>}
					{provider.baseUrl && (
						<span className="flex items-center gap-1">
							<Globe size={10} />
							{provider.baseUrl}
						</span>
					)}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{showEdit && editAction && (
					<Button
						size="sm"
						variant="ghost"
						icon={<Edit size={12} />}
						onClick={() => onEdit(provider.id)}
						aria-label={
							editAction.kind === "login"
								? t("providers.updateCredentials", { provider: provider.name })
								: t("providers.edit")
						}
						disabled={busy || (editAction.kind === "login" && !sidecarReady)}
						title={!sidecarReady && editAction.kind === "login" ? t("providers.notConnected") : undefined}
					/>
				)}
				{/* Login: any unauthenticated provider with a registered credential flow. */}
				{provider.loginAvailable && !provider.authenticated && (
					<Button
						size="sm"
						variant="primary"
						icon={<LogIn size={12} />}
						disabled={busy || !sidecarReady}
						onClick={() => onLogin(provider.id)}
						title={!sidecarReady ? t("providers.notConnected") : undefined}
					>
						{t("providers.login")}
					</Button>
				)}
				{showLogout && (
					<Button
						size="sm"
						variant="ghost"
						icon={<LogOut size={12} />}
						disabled={busy || !sidecarReady}
						onClick={() => onLogout(provider.id)}
						title={!sidecarReady ? t("providers.notConnected") : undefined}
					>
						{t("providers.logout")}
					</Button>
				)}
			</div>
		</div>
	);
}

export function ProvidersWindow({ pollMs = 2_500 }: { pollMs?: number }) {
	const tabRpc = useTabRpc();
	const t = useT();
	const open = useUiStore(s => s.providersOpen);
	const close = useUiStore(s => s.closeProviders);
	const openProviderConfig = useUiStore(s => s.openProviderConfig);
	const providerConfigOpen = useUiStore(s => s.providerConfigOpen);
	const sidecarReady = useSessionStore(s => s.status) === "ready";
	const providers = useModelStore(s => s.providers);
	const discoveryStates = useModelStore(s => s.discoveryStates);
	const refreshPending = useModelStore(s => s.catalogRefreshPending);
	const refreshProviders = useModelStore(s => s.refreshProviders);
	const [customConfigs, setCustomConfigs] = useState<CustomProviderView[]>([]);
	const [configError, setConfigError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [busyProvider, setBusyProvider] = useState<string | null>(null);
	const [pendingLogout, setPendingLogout] = useState<{ id: string; name: string } | null>(null);
	const requestVersion = useRef(0);

	// The provider list is catalog state, not window state: a `get_providers` read
	// and a tab-routed `model_catalog_update` push describe the same catalog
	// generation, so only the store's guard may decide which one wins. What stays
	// here is what no read carries — the editable models.yml entries — plus this
	// window's own transient flags.
	const load = useCallback(
		async (forceRefresh = false): Promise<ProvidersResult | undefined> => {
			const version = ++requestVersion.current;
			setLoading(true);
			setError(null);
			if (!sidecarReady) {
				setError(t("providers.notConnected"));
				setLoading(false);
				return undefined;
			}
			try {
				const [providerResult, configsResult] = await Promise.allSettled([
					refreshProviders(forceRefresh),
					window.omp.models.listProviders(),
				]);
				if (version !== requestVersion.current) return undefined;
				if (configsResult.status === "fulfilled") {
					setCustomConfigs(configsResult.value);
					setConfigError(null);
				} else {
					setConfigError(t("providers.configFailed", { details: String(configsResult.reason) }));
				}
				if (providerResult.status === "rejected") {
					const cause = providerResult.reason;
					setError(cause instanceof Error ? cause.message : String(cause));
				}
				return providerResult.status === "fulfilled" ? providerResult.value : undefined;
			} finally {
				if (version === requestVersion.current) setLoading(false);
			}
		},
		[refreshProviders, sidecarReady, t],
	);

	// A read can be superseded by a tab switch; the store guard replaces the list,
	// so the flags this window owns have to be released the same way.
	// biome-ignore lint/correctness/useExhaustiveDependencies: tabRpc is the only signal that the task these responses belong to changed.
	useEffect(() => {
		requestVersion.current++;
		setLoading(false);
		setError(null);
	}, [tabRpc]);

	useEffect(() => {
		// ProviderConfigDialog is an independent overlay. Reload when it closes so
		// the still-open provider window reflects add/edit/delete immediately.
		if (open && !providerConfigOpen) void load();
	}, [open, providerConfigOpen, load]);

	useEffect(() => {
		// `refreshPending` means the sidecar gave up waiting on discovery for this
		// read. Nothing pushes the answer into a settings window, so keep asking —
		// each poll is a cheap cache-aware read that reports the flag back.
		if (!open || !refreshPending) return;
		const timer = setInterval(() => {
			void load();
		}, pollMs);
		return () => clearInterval(timer);
	}, [open, refreshPending, load, pollMs]);

	const handleLogin = async (providerId: string) => {
		const name = providers.find(p => p.id === providerId)?.name ?? providerId;
		setBusyProvider(providerId);
		try {
			const res = await tabRpc.login(providerId);
			if (!res.success) {
				toast({ variant: "error", title: t("providers.loginFailed"), message: res.error });
				return;
			}
			await load(true);
			toast({ variant: "success", message: t("providers.loginSuccess", { provider: name }) });
		} catch (cause) {
			toast({ variant: "error", title: t("providers.loginFailed"), message: String(cause) });
		} finally {
			setBusyProvider(null);
		}
	};

	const handleLogout = async (providerId: string) => {
		setPendingLogout(null);
		const name = providers.find(p => p.id === providerId)?.name ?? providerId;
		setBusyProvider(providerId);
		try {
			const res = await tabRpc.logout(providerId);
			if (!res.success) {
				toast({ variant: "error", title: t("providers.logoutFailed"), message: res.error });
				return;
			}
			// Non-forced is answered from a cache row that is still fresh, which is
			// how a signed-out provider used to keep showing as authenticated.
			const fresh = await load(true);
			toast({ variant: "success", message: t("providers.logoutSuccess", { provider: name }) });
			if (fresh?.providers.some(provider => provider.id === providerId && provider.authenticated)) {
				toast({ variant: "warning", message: t("providers.logoutKept", { provider: name }) });
			}
		} catch (cause) {
			toast({ variant: "error", title: t("providers.logoutFailed"), message: String(cause) });
		} finally {
			setBusyProvider(null);
		}
	};

	const requestLogout = (providerId: string) => {
		// Signing out destroys a credential that only an interactive re-login can
		// restore, so the row asks first — the same distance deleting the whole
		// provider already has.
		const provider = providers.find(candidate => candidate.id === providerId);
		setPendingLogout({ id: providerId, name: provider?.name ?? providerId });
	};

	const handleEdit = async (providerId: string) => {
		setBusyProvider(providerId);
		try {
			const provider = providers.find(p => p.id === providerId);
			if (!provider) return;
			const action = resolveProviderEditAction(provider, customConfigs);
			if (!action) return;
			if (action.kind === "config") {
				openProviderConfig(action.provider);
				return;
			}
			await handleLogin(providerId);
		} catch (cause) {
			toast({ variant: "error", title: t("providers.editFailed"), message: String(cause) });
		} finally {
			setBusyProvider(null);
		}
	};

	const authenticated = providers.filter(p => p.authenticated);
	const unauthenticated = providers.filter(p => !p.authenticated);
	const discoveryErrors = providerDiscoveryErrors(discoveryStates, t("providers.discoveryUnavailable"));
	const unlistedConfigs = customConfigs.filter(
		config => !config.builtin && !providers.some(provider => provider.id === config.id),
	);

	return (
		<>
			<Modal open={open} onClose={close} title={t("providers.title")} size="lg">
				<div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
					<div className="flex items-center justify-between">
						<span className="text-omp-sm font-semibold uppercase tracking-wider text-[var(--omp-muted)]">
							{t("providers.authenticated")}
						</span>
						<div className="flex items-center gap-1.5">
							<Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => openProviderConfig()}>
								{t("providerCfg.list.add")}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								icon={<ExternalLink size={12} />}
								onClick={() => {
									void window.omp.models.openConfig().catch(cause => {
										toast({ variant: "error", title: t("providers.editConfig"), message: String(cause) });
									});
								}}
							>
								{t("providers.editConfig")}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								icon={<RefreshCw size={12} />}
								onClick={() => void load(true)}
								disabled={!sidecarReady}
								loading={loading}
								title={!sidecarReady ? t("providers.notConnected") : t("providers.refresh")}
							>
								{t("providers.refresh")}
							</Button>
						</div>
					</div>

					{configError && (
						<div
							role="alert"
							className="rounded-md bg-[var(--omp-tool-error-bg)] px-3 py-2 text-omp-md text-[var(--omp-error)]"
						>
							{configError}
						</div>
					)}
					{/* Whether rows are on screen decides the claim: stale catalog, or nothing loaded. */}
					{error && (
						<div
							role="alert"
							className="rounded-md bg-[var(--omp-tool-error-bg)] px-3 py-2 text-omp-md text-[var(--omp-error)]"
						>
							<span className="font-semibold">
								{providers.length > 0 ? t("providers.stale") : t("providers.loadFailed")}
							</span>{" "}
							{error}
						</div>
					)}
					{discoveryErrors.length > 0 && (
						<div className="rounded-md bg-[var(--omp-tool-error-bg)] px-3 py-2 text-omp-md text-[var(--omp-error)]">
							{t("providers.discoveryFailed", { details: discoveryErrors.join("; ") })}
						</div>
					)}
					{refreshPending && (
						<div
							className="flex items-center gap-2 rounded-md bg-[var(--omp-bg-tertiary)] px-3 py-2 text-omp-md text-[var(--omp-muted)]" // surface-ok: transient discovery status banner
						>
							<Spinner size="sm" />
							{t("providers.refreshPending")}
						</div>
					)}
					{loading && providers.length === 0 && (
						<div className="flex items-center justify-center py-8">
							<Spinner />
						</div>
					)}

					{!loading && !error && authenticated.length === 0 && (
						<div className="rounded-md border border-[var(--omp-border-muted)] px-3 py-4 text-center text-omp-md text-[var(--omp-dim)]">
							{t("providers.noAuth")}
						</div>
					)}

					{authenticated.length > 0 && (
						<div className="flex flex-col gap-2">
							{authenticated.map(p => (
								<ProviderRow
									key={p.id}
									provider={p}
									customConfigs={customConfigs}
									onLogin={handleLogin}
									onLogout={requestLogout}
									onEdit={handleEdit}
									busy={busyProvider === p.id}
									sidecarReady={sidecarReady}
									t={t}
								/>
							))}
						</div>
					)}

					{unauthenticated.length > 0 && (
						<>
							<span className="text-omp-sm font-semibold uppercase tracking-wider text-[var(--omp-muted)]">
								{t("providers.available")}
							</span>
							<div className="flex flex-col gap-2">
								{unauthenticated.map(p => (
									<ProviderRow
										key={p.id}
										provider={p}
										customConfigs={customConfigs}
										onLogin={handleLogin}
										onLogout={requestLogout}
										onEdit={handleEdit}
										busy={busyProvider === p.id}
										sidecarReady={sidecarReady}
										t={t}
									/>
								))}
							</div>
						</>
					)}

					<div className="rounded-md border border-[var(--omp-border-muted)] px-3 py-2.5">
						<div className="mb-1 text-omp-sm font-semibold text-[var(--omp-text)]">
							{t("providers.customTitle")}
						</div>
						<div className="text-omp-xs leading-[1.5] text-[var(--omp-muted)]">
							{t("providers.customHelp", {
								file: "~/.omp/agent/models.yml",
								baseUrl: "baseUrl",
								apiKey: "apiKey",
								models: "models",
							})}
						</div>
						<div className="mt-1 text-omp-xs leading-[1.5] text-[var(--omp-dim)]">
							{t("providers.customRouteHint")}
						</div>
						{/* A provider the session lists no models for is absent from the rows above,
						which reads as "the add did nothing". Name it and say why. */}
						{!loading && providers.length > 0 && unlistedConfigs.length > 0 && (
							<div className="mt-2 text-omp-xs leading-[1.5] text-[var(--omp-warning)]">
								{t("providers.customWithoutModels", {
									ids: unlistedConfigs.map(config => config.id).join(", "),
								})}
							</div>
						)}
					</div>
				</div>
			</Modal>
			<ConfirmDialog
				open={pendingLogout !== null}
				title={t("providers.logoutTitle", { provider: pendingLogout?.name ?? "" })}
				message={t("providers.logoutBody", { provider: pendingLogout?.name ?? "" })}
				warning={t("providers.logoutWarning")}
				confirmLabel={t("providers.logoutConfirm")}
				busy={pendingLogout !== null && busyProvider === pendingLogout.id}
				onCancel={() => setPendingLogout(null)}
				onConfirm={() => {
					if (pendingLogout) void handleLogout(pendingLogout.id);
				}}
			/>
		</>
	);
}
