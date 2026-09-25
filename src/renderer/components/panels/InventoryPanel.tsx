import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Inventory window: tabs over the session's installed plugins,
 * configured marketplaces, prompt templates, and memory backend report.
 * Each tab lazy-loads its RPC on first view and caches until refreshed.
 *
 * The Plugins tab is interactive: rows toggle via set_plugin_enabled
 * (optimistic — revert + error toast on failure, re-fetch on success), and
 * clicking a row opens the detail drawer (features + settings editor, see
 * inventory/PluginDetailDrawer). The Marketplaces tab manages sources and
 * catalog installs via marketplace_action (see inventory/MarketplacesSection).
 * Templates and memory stay read-only (no set_* RPC exists for them).
 *
 * Controlled window — the parent owns open state and wires the trigger:
 *   const [inventoryOpen, setInventoryOpen] = useState(false);
 *   <InventoryPanel open={inventoryOpen} onClose={() => setInventoryOpen(false)} />
 */

import { ChevronDown, ChevronRight, FileText, PackageOpen, RefreshCw, Search, Store } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	RpcMarketplacesResult,
	RpcMemoryReport,
	RpcPluginInfo,
	RpcPluginsResult,
	RpcPromptTemplateInfo,
	RpcPromptTemplatesResult,
	RpcResponse,
} from "../../../shared/rpc-types";
import { useActiveTabRouteReady } from "../../hooks/use-active-tab-route";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import {
	capturePluginActivationOrigin,
	handlePluginActivation,
	isPluginActivationOriginActive,
} from "../../lib/plugin-activation";
import { useSessionStore } from "../../stores/session";
import { useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { Badge, Button, Modal, Spinner, type TabItem, Tabs } from "../common";
import { AddMarketplaceForm, MarketplaceCard } from "./inventory/MarketplacesSection";
import { PluginDetailDrawer } from "./inventory/PluginDetailDrawer";
import { filterMarketplaces, filterPlugins, filterTemplates } from "./inventory-utils";

type TFn = (key: string, params?: Record<string, string | number>) => string;

export type TabId = "plugins" | "marketplaces" | "templates" | "memory";

interface RpcResource<T> {
	data: T | null;
	error: string | null;
	loading: boolean;
	ready: boolean;
	routeKey: string;
	/** True once a fetch has succeeded; cached until the next manual refresh. */
	loaded: boolean;
	reload: () => Promise<void>;
}

/** Fetch-on-demand wrapper around a read-only rpc command with stale-on-error caching. */
function useRpcResource<T>(fetcher: () => Promise<RpcResponse>): RpcResource<T> {
	const t = useT();
	const sidecarReady = useSessionStore(s => s.status) === "ready";
	const cwd = useSessionStore(s => s.cwd);
	const activeTabId = useTabsStore(s => s.activeTabId);
	const routeReady = useActiveTabRouteReady();
	const routeKey = `${activeTabId ?? "none"}:${cwd}`;
	const fetcherRef = useRef(fetcher);
	fetcherRef.current = fetcher;
	const requestRef = useRef(0);
	const routeRef = useRef(routeKey);
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [loaded, setLoaded] = useState(false);

	const reload = useCallback(async () => {
		if (!sidecarReady || !routeReady) {
			setError(t("invPanel.notConnected"));
			return;
		}
		const request = ++requestRef.current;
		const requestRoute = routeKey;
		setLoading(true);
		setError(null);
		try {
			const res = await fetcherRef.current();
			if (request !== requestRef.current || requestRoute !== routeRef.current) return;
			if (res.success) {
				setData(res.data as T);
				setLoaded(true);
			} else {
				setError(res.error);
			}
		} catch (cause) {
			if (request === requestRef.current && requestRoute === routeRef.current) setError(String(cause));
		} finally {
			if (request === requestRef.current && requestRoute === routeRef.current) setLoading(false);
		}
	}, [sidecarReady, routeReady, routeKey, t]);

	useEffect(() => {
		routeRef.current = routeKey;
		requestRef.current += 1;
		setData(null);
		setError(null);
		setLoading(false);
		setLoaded(false);
	}, [routeKey]);

	return { data, error, loading, loaded, ready: sidecarReady && routeReady, routeKey, reload };
}

/**
 * Load a tab's resource the first time it becomes visible. Failures leave
 * `loaded` false, so revisiting the tab retries once; successes stay cached.
 */
function useAutoLoad(
	resource: Pick<RpcResource<unknown>, "loaded" | "loading" | "ready" | "reload" | "routeKey">,
	visible: boolean,
): void {
	const attemptedRef = useRef(false);
	const routeRef = useRef(resource.routeKey);
	const { loaded, loading, ready, reload, routeKey } = resource;
	useEffect(() => {
		if (routeRef.current !== routeKey) {
			routeRef.current = routeKey;
			attemptedRef.current = false;
		}
		if (!visible || !ready) {
			attemptedRef.current = false;
			return;
		}
		if (attemptedRef.current || loaded || loading) return;
		attemptedRef.current = true;
		// This hook lives in a child tab while the route-reset effect lives in
		// the parent resource hook. Passive effects mount child-first, so an
		// immediate request can be invalidated by the parent's initial reset and
		// leave the page blank until Refresh is clicked. Start after the current
		// effect flush so route refs are authoritative before the request begins.
		let cancelled = false;
		queueMicrotask(() => {
			if (!cancelled) void reload();
		});
		return () => {
			cancelled = true;
		};
	}, [visible, loaded, loading, ready, reload, routeKey]);
}

// ============================================================================
// Shared chrome
// ============================================================================

function TabPanel({ visible, children }: { visible: boolean; children: ReactNode }) {
	return <div className={cx("flex flex-col gap-3 p-4", !visible && "hidden")}>{children}</div>;
}

function SearchBox({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
}) {
	return (
		<div className="flex min-w-[160px] flex-1 items-center gap-2 rounded-md border border-(--omp-border-muted) bg-(--omp-input-bg) px-2.5 py-1.5">
			<Search className="shrink-0 text-(--omp-dim)" size={13} />
			<input
				aria-label={placeholder}
				className="min-w-0 flex-1 bg-transparent text-xs text-(--omp-text) placeholder:text-(--omp-dim) focus:outline-none"
				onChange={event => onChange(event.target.value)}
				placeholder={placeholder}
				value={value}
			/>
		</div>
	);
}

function RefreshButton({
	loading,
	onRefresh,
	label,
	ready = true,
	disabledReason,
}: {
	loading: boolean;
	onRefresh: () => void;
	label: string;
	ready?: boolean;
	disabledReason?: string;
}) {
	return (
		<Button
			disabled={!ready}
			size="sm"
			variant="ghost"
			icon={<RefreshCw size={12} />}
			loading={loading}
			onClick={onRefresh}
			title={disabledReason}
		>
			{label}
		</Button>
	);
}

function ListToolbar({
	query,
	onQuery,
	placeholder,
	shown,
	total,
	loading,
	onRefresh,
	t,
	showSearch = true,
	ready,
	disabledReason,
}: {
	query: string;
	onQuery: (value: string) => void;
	placeholder: string;
	shown: number;
	total: number;
	loading: boolean;
	onRefresh: () => void;
	t: TFn;
	showSearch?: boolean;
	ready: boolean;
	disabledReason: string;
}) {
	return (
		<div className="flex items-center gap-2">
			{showSearch ? (
				<SearchBox value={query} onChange={onQuery} placeholder={placeholder} />
			) : (
				<div className="flex-1" />
			)}
			<span className="text-omp-xs whitespace-nowrap tabular-nums text-(--omp-dim)">
				{t("invPanel.count", { shown, total })}
			</span>
			<RefreshButton
				disabledReason={!ready ? disabledReason : undefined}
				loading={loading}
				onRefresh={onRefresh}
				label={t("invPanel.refresh")}
				ready={ready}
			/>
		</div>
	);
}

function Row({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-center gap-3 rounded-lg border border-[var(--omp-border-muted)] px-3 py-2.5">
			{children}
		</div>
	);
}

function EmptyNote({
	children,
	description,
	action,
	icon: Icon = PackageOpen,
}: {
	children: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	icon?: typeof PackageOpen;
}) {
	return (
		<div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-(--omp-border-muted) px-6 py-8 text-center">
			<div className="mb-3 flex size-9 items-center justify-center rounded-lg border border-(--omp-border-muted) text-(--omp-dim)">
				<Icon aria-hidden="true" size={16} strokeWidth={1.7} />
			</div>
			<div className="text-omp-md font-medium text-(--omp-text)">{children}</div>
			{description && (
				<div className="mt-1 max-w-sm text-omp-sm leading-relaxed text-(--omp-dim)">{description}</div>
			)}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}

/** Loading / error+Retry / content gate. Keeps stale data visible behind a refresh error banner. */
function ResourceGate<T>({ resource, children }: { resource: RpcResource<T>; children: (data: T) => ReactNode }) {
	const t = useT();
	if (!resource.data) {
		if (resource.loading) {
			return (
				<div className="flex items-center justify-center py-10">
					<Spinner label={t("common.loading")} />
				</div>
			);
		}
		if (resource.error) {
			return (
				<div className="flex flex-col items-center gap-2.5 py-8">
					<div className="max-w-full rounded-md bg-[var(--omp-tool-error-bg)] px-3 py-2 text-omp-md break-words text-[var(--omp-error)]">
						{resource.error}
					</div>
					<Button
						disabled={!resource.ready}
						size="sm"
						variant="ghost"
						icon={<RefreshCw size={12} />}
						onClick={() => void resource.reload()}
						title={!resource.ready ? t("invPanel.notConnected") : t("invPanel.retry")}
					>
						{t("invPanel.retry")}
					</Button>
				</div>
			);
		}
		return null;
	}
	return (
		<>
			{resource.error && (
				<div className="rounded-md bg-[var(--omp-tool-error-bg)] px-3 py-2 text-omp-md break-words text-[var(--omp-error)]">
					{resource.error}
				</div>
			)}
			{children(resource.data)}
		</>
	);
}

// ============================================================================
// Plugins tab
// ============================================================================

/** Enable/disable switch (Settings-window styling); spinner while its mutation is in flight. */
function PluginToggle({
	enabled,
	busy,
	disabled,
	onToggle,
}: {
	enabled: boolean;
	/** This row's mutation is in flight. */
	busy: boolean;
	/** Another row's mutation is in flight (one at a time). */
	disabled: boolean;
	onToggle: () => void;
}) {
	const t = useT();
	const label = enabled ? t("invPanel.enabled") : t("invPanel.disabled");
	if (busy) {
		return (
			<span className="flex h-4.5 w-8 shrink-0 items-center justify-center" title={label}>
				<Spinner size="sm" />
			</span>
		);
	}
	return (
		<button
			aria-checked={enabled}
			aria-label={label}
			className={cx(
				"relative h-4.5 w-8 shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
				enabled ? "bg-(--omp-accent)" : "border border-(--omp-border-muted)",
			)}
			disabled={disabled}
			onClick={onToggle}
			role="switch"
			title={label}
			type="button"
		>
			<span
				className={cx(
					"absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-white shadow transition-all duration-150",
					enabled ? "left-4" : "left-0.5",
				)}
			/>
		</button>
	);
}

function PluginRow({
	plugin,
	t,
	enabled,
	busy,
	disabled,
	onToggle,
	onOpenDetail,
}: {
	plugin: RpcPluginInfo;
	t: TFn;
	/** Enable state with the optimistic overlay applied. */
	enabled: boolean;
	busy: boolean;
	disabled: boolean;
	onToggle: () => void;
	/** Open the detail drawer (features + settings editor). */
	onOpenDetail: () => void;
}) {
	return (
		<div
			className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--omp-border-muted)] px-3 py-2.5 transition-colors hover:border-(--omp-border-strong) hover:bg-[var(--omp-bg-tertiary)]"
			onClick={onOpenDetail}
			onKeyDown={event => {
				// Only the row itself — keydown bubbling from the toggle button must
				// not also open the drawer.
				if (event.target !== event.currentTarget) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpenDetail();
				}
			}}
			role="button"
			tabIndex={0}
			title={t("pluginDetail.openHint")}
		>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="text-omp-lg font-medium text-[var(--omp-text)]">{plugin.name}</span>
					{plugin.marketplace === "npm" ? (
						<Badge variant="info">npm</Badge>
					) : (
						<Badge variant="default">{plugin.marketplace}</Badge>
					)}
					{plugin.scope && <Badge variant="muted">{t(`invPanel.scope.${plugin.scope}`)}</Badge>}
					{plugin.shadowedBy && (
						<Badge variant="warning" dot>
							{t("invPanel.shadowedBy", { scope: t(`invPanel.scope.${plugin.shadowedBy}`) })}
						</Badge>
					)}
				</div>
				<div className="flex items-center gap-3 text-omp-sm text-[var(--omp-dim)]">
					{plugin.version && <span className="tabular-nums">v{plugin.version}</span>}
					{plugin.id && plugin.id !== plugin.name && <span className="truncate font-mono">{plugin.id}</span>}
				</div>
			</div>
			{/* The toggle keeps its own click target — the row click opens the drawer. */}
			<span onClick={event => event.stopPropagation()}>
				<PluginToggle busy={busy} disabled={disabled} enabled={enabled} onToggle={onToggle} />
			</span>
			<ChevronRight className="shrink-0 text-(--omp-dim)" size={13} />
		</div>
	);
}

function PluginsTab({
	resource,
	visible,
	onOpenDetail,
	onBrowseMarketplaces,
	externalQuery,
}: {
	resource: RpcResource<RpcPluginsResult>;
	visible: boolean;
	onOpenDetail: (plugin: RpcPluginInfo) => void;
	onBrowseMarketplaces: () => void;
	externalQuery?: string;
}) {
	const tabRpc = useTabRpc();
	const t = useT();
	const [localQuery, setLocalQuery] = useState("");
	const query = externalQuery ?? localQuery;
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({});
	useAutoLoad(resource, visible);
	const plugins = useMemo(() => filterPlugins(resource.data?.plugins ?? [], query), [resource.data, query]);
	const total = resource.data?.plugins.length ?? 0;

	/** Optimistic toggle: overlay → set_plugin_enabled → re-fetch on success, revert + toast on error. */
	const handleToggle = async (plugin: RpcPluginInfo): Promise<void> => {
		if (!resource.ready) return;
		const origin = capturePluginActivationOrigin();
		if (!origin) {
			toast({ variant: "warning", message: t("pluginActivation.routePending") });
			return;
		}
		const key = plugin.id ?? `npm:${plugin.name}`;
		const next = !(overrides[key] ?? plugin.enabled);
		setBusyKey(key);
		setOverrides(prev => ({ ...prev, [key]: next }));
		const clearOverride = (): void =>
			setOverrides(prev => {
				if (!(key in prev)) return prev;
				const rest = { ...prev };
				delete rest[key];
				return rest;
			});
		try {
			const res = await tabRpc.setPluginEnabled(plugin.id ?? plugin.name, next, plugin.scope);
			if (!res.success) {
				clearOverride();
				if (isPluginActivationOriginActive(origin)) {
					toast({ variant: "error", title: t("invPanel.pluginToggleFailed"), message: res.error });
				}
				return;
			}
			const data = res.data as { activation?: string } | undefined;
			await handlePluginActivation(
				data?.activation,
				{ pluginId: plugin.id ?? plugin.name, expected: next ? "enabled" : "disabled" },
				origin,
			);
			if (isPluginActivationOriginActive(origin)) await resource.reload();
			clearOverride();
		} catch (cause) {
			clearOverride();
			if (isPluginActivationOriginActive(origin)) {
				toast({ variant: "error", title: t("invPanel.pluginToggleFailed"), message: String(cause) });
			}
		} finally {
			setBusyKey(null);
		}
	};

	return (
		<TabPanel visible={visible}>
			<ListToolbar
				query={query}
				onQuery={setLocalQuery}
				placeholder={t("invPanel.search.plugins")}
				shown={plugins.length}
				total={total}
				loading={resource.loading}
				onRefresh={() => void resource.reload()}
				ready={resource.ready}
				disabledReason={t("invPanel.notConnected")}
				t={t}
				showSearch={externalQuery === undefined}
			/>
			<ResourceGate resource={resource}>
				{() =>
					plugins.length === 0 ? (
						total === 0 ? (
							<EmptyNote
								action={
									<Button onClick={onBrowseMarketplaces} size="sm" variant="ghost">
										{t("invPanel.plugins.browseMarketplaces")}
									</Button>
								}
								description={t("invPanel.plugins.emptyHint")}
							>
								{t("invPanel.plugins.empty")}
							</EmptyNote>
						) : (
							<EmptyNote icon={Search}>{t("invPanel.noMatch")}</EmptyNote>
						)
					) : (
						<div className="flex flex-col gap-2">
							{plugins.map(p => {
								const key = p.id ?? `npm:${p.name}`;
								return (
									<PluginRow
										busy={busyKey === key}
										disabled={busyKey !== null || !resource.ready}
										enabled={overrides[key] ?? p.enabled}
										key={key}
										onOpenDetail={() => onOpenDetail(p)}
										onToggle={() => void handleToggle(p)}
										plugin={p}
										t={t}
									/>
								);
							})}
						</div>
					)
				}
			</ResourceGate>
		</TabPanel>
	);
}

// ============================================================================
// Marketplaces tab
// ============================================================================

function MarketplacesTab({
	resource,
	visible,
	externalQuery,
}: {
	resource: RpcResource<RpcMarketplacesResult>;
	visible: boolean;
	externalQuery?: string;
}) {
	const t = useT();
	const [localQuery, setLocalQuery] = useState("");
	const query = externalQuery ?? localQuery;
	useAutoLoad(resource, visible);
	const marketplaces = useMemo(
		() => filterMarketplaces(resource.data?.marketplaces ?? [], query),
		[resource.data, query],
	);
	const total = resource.data?.marketplaces.length ?? 0;
	return (
		<TabPanel visible={visible}>
			<ListToolbar
				query={query}
				onQuery={setLocalQuery}
				placeholder={t("invPanel.search.marketplaces")}
				shown={marketplaces.length}
				total={total}
				loading={resource.loading}
				onRefresh={() => void resource.reload()}
				ready={resource.ready}
				disabledReason={t("invPanel.notConnected")}
				t={t}
				showSearch={externalQuery === undefined}
			/>
			<ResourceGate resource={resource}>
				{() => (
					<>
						<AddMarketplaceForm onAdded={resource.reload} ready={resource.ready} />
						{marketplaces.length === 0 ? (
							total === 0 ? (
								<EmptyNote description={t("invPanel.marketplaces.emptyHint")} icon={Store}>
									{t("invPanel.marketplaces.empty")}
								</EmptyNote>
							) : (
								<EmptyNote icon={Search}>{t("invPanel.noMatch")}</EmptyNote>
							)
						) : (
							<div className="flex flex-col gap-2">
								{marketplaces.map(m => (
									<MarketplaceCard
										key={m.name}
										marketplace={m}
										ready={resource.ready}
										reload={resource.reload}
									/>
								))}
							</div>
						)}
					</>
				)}
			</ResourceGate>
		</TabPanel>
	);
}

// ============================================================================
// Prompt templates tab
// ============================================================================

function TemplateRow({ template }: { template: RpcPromptTemplateInfo }) {
	return (
		<Row>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="text-omp-lg font-medium text-[var(--omp-text)]">{template.name}</span>
					<Badge variant="default">{template.source}</Badge>
					{template.argumentHint && (
						<code className="rounded bg-[var(--omp-code-bg)] px-1.5 py-px font-mono text-omp-xs text-[var(--omp-muted)]">
							{template.argumentHint}
						</code>
					)}
				</div>
				{template.description && (
					<div className="text-omp-sm leading-[1.45] text-[var(--omp-dim)]">{template.description}</div>
				)}
			</div>
		</Row>
	);
}

function TemplatesTab({
	resource,
	visible,
	externalQuery,
}: {
	resource: RpcResource<RpcPromptTemplatesResult>;
	visible: boolean;
	externalQuery?: string;
}) {
	const t = useT();
	const [localQuery, setLocalQuery] = useState("");
	const query = externalQuery ?? localQuery;
	useAutoLoad(resource, visible);
	const templates = useMemo(() => filterTemplates(resource.data?.templates ?? [], query), [resource.data, query]);
	const total = resource.data?.templates.length ?? 0;
	return (
		<TabPanel visible={visible}>
			<ListToolbar
				query={query}
				onQuery={setLocalQuery}
				placeholder={t("invPanel.search.templates")}
				shown={templates.length}
				total={total}
				loading={resource.loading}
				onRefresh={() => void resource.reload()}
				ready={resource.ready}
				disabledReason={t("invPanel.notConnected")}
				t={t}
				showSearch={externalQuery === undefined}
			/>
			<ResourceGate resource={resource}>
				{() =>
					templates.length === 0 ? (
						total === 0 ? (
							<EmptyNote description={t("invPanel.templates.emptyHint")} icon={FileText}>
								{t("invPanel.templates.empty")}
							</EmptyNote>
						) : (
							<EmptyNote icon={Search}>{t("invPanel.noMatch")}</EmptyNote>
						)
					) : (
						<div className="flex flex-col gap-2">
							{templates.map(tpl => (
								<TemplateRow key={`${tpl.source}:${tpl.name}`} template={tpl} />
							))}
						</div>
					)
				}
			</ResourceGate>
		</TabPanel>
	);
}

// ============================================================================
// Memory tab
// ============================================================================

function MemoryStatusCard({ report, t }: { report: RpcMemoryReport; t: TFn }) {
	const status = report.status;
	if (!status) return null;
	const counts: Array<[string, number]> = [];
	if (status.workingCount !== undefined) counts.push([t("invPanel.memory.working"), status.workingCount]);
	if (status.episodicCount !== undefined) counts.push([t("invPanel.memory.episodic"), status.episodicCount]);
	if (status.tripleCount !== undefined) counts.push([t("invPanel.memory.triples"), status.tripleCount]);
	const details: Array<[string, string]> = [];
	if (status.scope) details.push([t("invPanel.memory.scope"), status.scope]);
	if (status.retainBank) details.push([t("invPanel.memory.retainBank"), status.retainBank]);
	if (status.recallBanks && status.recallBanks.length > 0)
		details.push([t("invPanel.memory.recallBanks"), status.recallBanks.join(", ")]);
	if (status.database) details.push([t("invPanel.memory.database"), status.database]);
	if (status.lastMemory) details.push([t("invPanel.memory.lastMemory"), status.lastMemory]);
	if (status.lastRecall !== undefined)
		details.push([
			t("invPanel.memory.lastRecall"),
			status.lastRecall ? t("invPanel.memory.yes") : t("invPanel.memory.no"),
		]);
	if (status.message) details.push([t("invPanel.memory.message"), status.message]);
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-[var(--omp-border-muted)] px-3 py-2.5">
			<div className="flex flex-wrap items-center gap-1.5">
				<Badge variant={status.active ? "success" : "error"} dot>
					{status.active ? t("invPanel.memory.active") : t("invPanel.memory.inactive")}
				</Badge>
				<Badge variant={status.writable ? "success" : "muted"} dot={status.writable}>
					{t("invPanel.memory.writable")}: {t(status.writable ? "invPanel.memory.yes" : "invPanel.memory.no")}
				</Badge>
				<Badge variant={status.searchable ? "info" : "muted"} dot={status.searchable}>
					{t("invPanel.memory.searchable")}: {t(status.searchable ? "invPanel.memory.yes" : "invPanel.memory.no")}
				</Badge>
			</div>
			{counts.length > 0 && (
				<div className="flex flex-wrap gap-x-4 gap-y-1 text-omp-sm text-[var(--omp-dim)]">
					{counts.map(([label, value]) => (
						<span key={label}>
							{label}: <span className="tabular-nums text-[var(--omp-text)]">{value}</span>
						</span>
					))}
				</div>
			)}
			{details.length > 0 && (
				<div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-omp-sm">
					{details.map(([label, value]) => (
						<Fragment key={label}>
							<span className="text-[var(--omp-dim)]">{label}</span>
							<span className="break-words text-[var(--omp-text)]">{value}</span>
						</Fragment>
					))}
				</div>
			)}
			{status.error && <div className="text-omp-sm break-words text-[var(--omp-error)]">{status.error}</div>}
		</div>
	);
}

function MemoryTab({ resource, visible }: { resource: RpcResource<RpcMemoryReport>; visible: boolean }) {
	const t = useT();
	const [statsOpen, setStatsOpen] = useState(false);
	useAutoLoad(resource, visible);
	const report = resource.data;
	return (
		<TabPanel visible={visible}>
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 truncate text-omp-md font-medium text-[var(--omp-text)]">
					{report?.backend ?? t("invPanel.tabs.memory")}
					{report?.entryCount !== undefined && (
						<span className="ml-2 text-omp-xs font-normal tabular-nums text-[var(--omp-dim)]">
							{t("invPanel.memory.entries", { count: report.entryCount })}
						</span>
					)}
				</span>
				<RefreshButton
					disabledReason={!resource.ready ? t("invPanel.notConnected") : undefined}
					loading={resource.loading}
					onRefresh={() => void resource.reload()}
					label={t("invPanel.refresh")}
					ready={resource.ready}
				/>
			</div>
			<ResourceGate resource={resource}>
				{data => (
					<>
						<MemoryStatusCard report={data} t={t} />
						{data.stats && (
							<div className="overflow-hidden rounded-lg border border-[var(--omp-border-muted)]">
								<button
									className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-omp-sm font-semibold text-[var(--omp-text)] transition-colors hover:bg-[var(--omp-bg-tertiary)]"
									onClick={() => setStatsOpen(open => !open)}
									type="button"
								>
									{statsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
									{t("invPanel.memory.stats")}
								</button>
								{statsOpen && (
									<pre className="max-h-64 overflow-auto border-t border-[var(--omp-border-muted)] bg-[var(--omp-code-bg)] px-3 py-2 font-mono text-omp-xs leading-relaxed break-words whitespace-pre-wrap text-[var(--omp-muted)]">
										{data.stats}
									</pre>
								)}
							</div>
						)}
						{data.diagnosis && (
							<div className="rounded-lg border border-[var(--omp-border-muted)] px-3 py-2.5">
								<div className="mb-1.5 text-omp-sm font-semibold text-[var(--omp-text)]">
									{t("invPanel.memory.diagnosis")}
								</div>
								<div className="text-omp-md text-[var(--omp-muted)]">
									<MarkdownRenderer content={data.diagnosis} />
								</div>
							</div>
						)}
						{!data.status && !data.stats && !data.diagnosis && <EmptyNote>{t("invPanel.memory.bare")}</EmptyNote>}
					</>
				)}
			</ResourceGate>
		</TabPanel>
	);
}

// ============================================================================
// Window
// ============================================================================

export interface InventoryPanelProps {
	open: boolean;
	onClose: () => void;
	/** Deep-link a specific tab on open (defaults to "plugins"). */
	initialTab?: TabId;
}

function InventoryContent({
	active,
	initialTab,
	embedded,
	query,
}: {
	active: boolean;
	initialTab: TabId;
	embedded: boolean;
	query?: string;
}) {
	const tabRpc = useTabRpc();
	const t = useT();
	const [tab, setTab] = useState<TabId>(initialTab);
	const [detailPlugin, setDetailPlugin] = useState<RpcPluginInfo | null>(null);
	const plugins = useRpcResource<RpcPluginsResult>(() => tabRpc.getPlugins());
	const marketplaces = useRpcResource<RpcMarketplacesResult>(() => tabRpc.getMarketplaces());
	const templates = useRpcResource<RpcPromptTemplatesResult>(() => tabRpc.getPromptTemplates());
	const memory = useRpcResource<RpcMemoryReport>(() => tabRpc.getMemoryReport());

	// Reopening deep-links to the requested tab and drops any open detail drawer.
	useEffect(() => {
		if (active) {
			setTab(initialTab);
			setDetailPlugin(null);
		}
	}, [active, initialTab]);

	const tabs = useMemo<TabItem[]>(
		() => [
			{ id: "plugins", label: t("invPanel.tabs.plugins"), badge: plugins.data?.plugins.length },
			{ id: "marketplaces", label: t("invPanel.tabs.marketplaces"), badge: marketplaces.data?.marketplaces.length },
			{ id: "templates", label: t("invPanel.tabs.templates"), badge: templates.data?.templates.length },
			{ id: "memory", label: t("invPanel.tabs.memory") },
		],
		[t, plugins.data, marketplaces.data, templates.data],
	);

	const footer =
		tab === "plugins"
			? t("invPanel.footer.plugins")
			: tab === "marketplaces"
				? t("marketplace.footerNote")
				: t("invPanel.readonlyNote");

	return (
		<div
			className={cx(
				"relative flex flex-col overflow-hidden",
				embedded ? "settings-embedded-panel" : "h-[72vh]",
				detailPlugin && "settings-plugin-detail-open",
			)}
		>
			<Tabs
				tabs={tabs}
				activeId={tab}
				onChange={id => setTab(id as TabId)}
				className="shrink-0 px-2"
				ariaLabel={t("invPanel.title")}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<PluginsTab
					externalQuery={query}
					onBrowseMarketplaces={() => setTab("marketplaces")}
					onOpenDetail={setDetailPlugin}
					resource={plugins}
					visible={active && tab === "plugins"}
				/>
				<MarketplacesTab externalQuery={query} resource={marketplaces} visible={active && tab === "marketplaces"} />
				<TemplatesTab externalQuery={query} resource={templates} visible={active && tab === "templates"} />
				<MemoryTab resource={memory} visible={active && tab === "memory"} />
			</div>
			<div className="shrink-0 border-t border-(--omp-border-muted) px-4 py-2 text-omp-xs leading-relaxed text-(--omp-dim)">
				{footer}
			</div>
			{/* Drill-in detail drawer — covers the window body until dismissed. */}
			{detailPlugin && (
				<PluginDetailDrawer
					key={detailPlugin.id ?? detailPlugin.name}
					onChanged={plugins.reload}
					onClose={() => setDetailPlugin(null)}
					plugin={detailPlugin}
				/>
			)}
		</div>
	);
}

export function InventorySettingsPage({ initialTab = "plugins", query }: { initialTab?: TabId; query: string }) {
	const t = useT();
	return (
		<div className="space-y-5">
			<header>
				<div className="flex items-center gap-2 text-(--omp-accent)">
					<PackageOpen aria-hidden="true" size={17} />
					<h2 className="text-[16px] font-semibold tracking-[-0.01em] text-(--omp-text)">
						{t("settings.resources.title")}
					</h2>
				</div>
				<p className="mt-1.5 max-w-2xl text-omp-sm leading-relaxed text-(--omp-muted)">
					{t("settings.resources.description")}
				</p>
			</header>
			<InventoryContent active embedded initialTab={initialTab} query={query} />
		</div>
	);
}

export function InventoryPanel({ open, onClose, initialTab = "plugins" }: InventoryPanelProps) {
	const t = useT();
	return (
		<Modal bodyClassName="p-0" open={open} onClose={onClose} title={t("invPanel.title")} size="lg">
			<InventoryContent active={open} embedded={false} initialTab={initialTab} />
		</Modal>
	);
}
