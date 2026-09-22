import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Model comparison window: sortable/filterable matrix of every available model
 * across providers — auth status, context window, cost per 1M tokens, provider
 * quota, role assignments, and the current session model.
 *
 * Row click sets the session model (set_model); the per-row role picker assigns
 * the model to a role (set_model_role). Current model + role assignments are
 * highlighted; provider quota from get_usage renders inline per provider.
 *
 * Catalog note: the model and provider columns come from the per-tab model
 * store, not a private copy. A `model_catalog_update` push and an opening read
 * race, and only the store's generation guard can tell which won; roles and
 * usage are separate feeds and stay local.
 *
 * Wire note: `get_available_models` serializes full catalog `Model` objects —
 * `cost {input,output,cacheRead,cacheWrite}` ($/1M tokens),
 * `contextWindow` (number|null), `maxTokens` (number|null), `reasoning` — even
 * though these extended fields may be absent on older sidecars. Values are
 * read defensively below and degrade to "—" when unavailable.
 */

import { ArrowDown, ArrowUp, ArrowUpDown, Check, RefreshCw, Search } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type {
	ModelInfo,
	ModelRoleEntry,
	ModelRoleMetadata,
	ModelRolesResult,
	ProviderInfo,
	UsageLimit,
	UsageReport,
	UsageResult,
} from "../../../shared/rpc-types";
import { cx, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useModelStore } from "../../stores/model";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { Badge, Button, Modal, ProgressBar, Spinner } from "../common";

// ============================================================================
// Derived row + helpers
// ============================================================================

const ROLE_COLORS: Record<string, string> = {
	success: "var(--omp-success)",
	warning: "var(--omp-warning)",
	accent: "var(--omp-accent)",
	error: "var(--omp-error)",
	info: "var(--omp-link)",
	default: "var(--omp-muted)",
};

export interface Row {
	key: string;
	provider: string;
	providerName: string;
	id: string;
	name: string | null;
	/** False when get_providers failed or the provider isn't listed — auth shown as "?". */
	authKnown: boolean;
	authenticated: boolean;
	authKind: ProviderInfo["authKind"];
	disabled: boolean;
	contextWindow: number | null;
	costIn: number | null;
	costOut: number | null;
	roles: ModelRoleEntry[];
	quota: { limit: UsageLimit; fraction: number } | null;
}

function limitFraction(limit: UsageLimit): number | null {
	if (limit.usedFraction !== undefined) return limit.usedFraction;
	if (limit.used !== undefined && limit.limit !== undefined && limit.limit > 0) return limit.used / limit.limit;
	if (limit.remainingFraction !== undefined) return 1 - limit.remainingFraction;
	return null;
}

/** The most-consumed limit in a provider report — the one that gates usage first. */
function tightestLimit(report: UsageReport): { limit: UsageLimit; fraction: number } | null {
	let best: { limit: UsageLimit; fraction: number } | null = null;
	for (const limit of report.limits) {
		const fraction = limitFraction(limit);
		if (fraction === null) continue;
		if (!best || fraction > best.fraction) best = { limit, fraction };
	}
	return best;
}

/** "$3" / "$0.15" / "$75" — trims insignificant zeros. */
export function formatCost(perMillion: number): string {
	const raw =
		perMillion >= 100 ? perMillion.toFixed(0) : perMillion >= 1 ? perMillion.toFixed(2) : perMillion.toFixed(3);
	const trimmed = raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
	return `$${trimmed}`;
}

function cmpNumber(a: number | null, b: number | null, dir: 1 | -1): number {
	if (a === null && b === null) return 0;
	if (a === null) return 1; // nulls always last, regardless of direction
	if (b === null) return -1;
	return (a - b) * dir;
}

/**
 * Joins the catalog snapshot with the role and usage feeds into table rows.
 * `roles`/`usage` may be null when their call failed — rows still render with
 * degraded role/quota cells rather than dropping models. A provider that is
 * absent from `providers` (or an empty list from a catalog generation that
 * carried none) renders auth as "?", never as "no auth".
 */
export function buildModelRows(input: {
	models: ModelInfo[];
	providers: ProviderInfo[];
	roles: ModelRoleEntry[] | null;
	usage: UsageReport[] | null;
}): Row[] {
	const providerById = new Map(input.providers.map(provider => [provider.id, provider]));
	const usageByProvider = new Map((input.usage ?? []).map(report => [report.provider, report]));
	return input.models.map(model => {
		const key = `${model.provider}/${model.id}`;
		const provider = providerById.get(model.provider);
		const report = usageByProvider.get(model.provider);
		return {
			key,
			provider: model.provider,
			providerName: provider?.name ?? model.provider,
			id: model.id,
			name: typeof model.name === "string" && model.name.length > 0 && model.name !== model.id ? model.name : null,
			authKnown: provider !== undefined,
			authenticated: provider?.authenticated ?? false,
			authKind: provider?.authKind,
			disabled: provider?.disabled ?? false,
			contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : null,
			costIn: typeof model.cost?.input === "number" ? model.cost.input : null,
			costOut: typeof model.cost?.output === "number" ? model.cost.output : null,
			roles: input.roles?.filter(role => role.model === key) ?? [],
			quota: report ? tightestLimit(report) : null,
		};
	});
}

type SortKey = "provider" | "model" | "context" | "cost" | "quota" | "roles";

const COMPARATORS: Record<SortKey, (a: Row, b: Row, dir: 1 | -1) => number> = {
	provider: (a, b, dir) => a.provider.localeCompare(b.provider) * dir || a.id.localeCompare(b.id),
	model: (a, b, dir) => a.id.localeCompare(b.id) * dir || a.provider.localeCompare(b.provider),
	context: (a, b, dir) => cmpNumber(a.contextWindow, b.contextWindow, dir),
	cost: (a, b, dir) => cmpNumber(a.costIn, b.costIn, dir) || cmpNumber(a.costOut, b.costOut, dir),
	quota: (a, b, dir) => cmpNumber(a.quota?.fraction ?? null, b.quota?.fraction ?? null, dir),
	roles: (a, b, dir) => cmpNumber(a.roles.length, b.roles.length, dir),
};

type TFn = (key: string, params?: Record<string, string | number>) => string;

// ============================================================================
// Presentational pieces
// ============================================================================

function SortHeader({
	label,
	sortKey,
	sort,
	onSort,
	className,
}: {
	label: string;
	sortKey: SortKey;
	sort: { key: SortKey; dir: 1 | -1 };
	onSort: (key: SortKey) => void;
	className?: string;
}) {
	const active = sort.key === sortKey;
	return (
		<th className={cx("px-3 py-2 font-semibold whitespace-nowrap", className)}>
			<button
				className={cx(
					"inline-flex items-center gap-1 text-omp-xs tracking-wider uppercase transition-colors",
					active ? "text-(--omp-text)" : "text-(--omp-muted) hover:text-(--omp-text)",
				)}
				onClick={() => onSort(sortKey)}
				type="button"
			>
				{label}
				{active ? (
					sort.dir === 1 ? (
						<ArrowUp size={10} />
					) : (
						<ArrowDown size={10} />
					)
				) : (
					<ArrowUpDown className="opacity-40" size={10} />
				)}
			</button>
		</th>
	);
}

function AuthBadge({ row, t }: { row: Row; t: TFn }) {
	if (!row.authKnown) return <Badge variant="muted">?</Badge>;
	if (!row.authenticated) return <Badge variant="muted">{t("providers.badge.noAuth")}</Badge>;
	if (row.authKind === "oauth")
		return (
			<Badge variant="success" dot>
				{t("providers.badge.oauth")}
			</Badge>
		);
	if (row.authKind === "env") return <Badge variant="info">{t("providers.badge.env")}</Badge>;
	return (
		<Badge variant="success" dot>
			{t("providers.badge.apikey")}
		</Badge>
	);
}

function RoleTag({ role, metadata }: { role: ModelRoleEntry; metadata?: ModelRoleMetadata }) {
	const color = ROLE_COLORS[metadata?.color ?? role.color ?? "default"] ?? ROLE_COLORS.default;
	return (
		<span
			className="rounded px-1.5 py-px text-omp-xxs font-bold tracking-wider whitespace-nowrap"
			style={{ backgroundColor: `${color}20`, color }}
			title={metadata?.name ?? role.name}
		>
			{metadata?.tag ?? role.tag}
		</span>
	);
}

// ============================================================================
// Window
// ============================================================================

export interface ModelCompareProps {
	open: boolean;
	onClose: () => void;
}

export function ModelCompare({ open, onClose }: ModelCompareProps) {
	const tabRpc = useTabRpc();
	const t = useT();
	const sidecarReady = useSessionStore(s => s.status) === "ready";
	const current = useModelStore(s => s.model);
	const models = useModelStore(s => s.availableModels);
	const providers = useModelStore(s => s.providers);
	const refreshProviders = useModelStore(s => s.refreshProviders);

	const [roles, setRoles] = useState<ModelRoleEntry[] | null>(null);
	const [roleMeta, setRoleMeta] = useState<ModelRoleMetadata[] | null>(null);
	const [usage, setUsage] = useState<UsageReport[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [fatalError, setFatalError] = useState<string | null>(null);
	const [failedSections, setFailedSections] = useState<string[]>([]);
	const [query, setQuery] = useState("");
	const [providerFilter, setProviderFilter] = useState("all");
	const [authOnly, setAuthOnly] = useState(false);
	const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "provider", dir: 1 });
	const [busyKey, setBusyKey] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setFatalError(null);
		setFailedSections([]);
		if (!sidecarReady) {
			setFatalError(t("modelCompare.notConnected"));
			setLoading(false);
			return;
		}
		// One forced read for both catalog columns: models and providers must come
		// from the same generation, and a non-forced one is satisfied by a
		// still-fresh cache row after a credential or models.yml change.
		const [catalogR, rolesR, metaR, usageR] = await Promise.allSettled([
			refreshProviders(true),
			tabRpc.getModelRoles(),
			tabRpc.getModelRoleMetadata(),
			tabRpc.getUsage(),
		]);
		const failed: string[] = [];

		if (catalogR.status === "rejected") {
			setFatalError(
				catalogR.reason instanceof Error
					? catalogR.reason.message
					: String(catalogR.reason ?? t("modelCompare.unknownError")),
			);
		}

		if (rolesR.status === "fulfilled" && rolesR.value.success) {
			setRoles((rolesR.value.data as ModelRolesResult | undefined)?.roles ?? []);
		} else {
			setRoles(null);
			failed.push("roles");
		}

		if (metaR.status === "fulfilled" && metaR.value.success) {
			setRoleMeta((metaR.value.data as { roles?: ModelRoleMetadata[] } | undefined)?.roles ?? []);
		} else {
			setRoleMeta(null);
		}

		if (usageR.status === "fulfilled" && usageR.value.success) {
			setUsage((usageR.value.data as UsageResult | undefined)?.reports ?? []);
		} else {
			setUsage(null);
			failed.push("usage");
		}

		setFailedSections(failed);
		setLoading(false);
	}, [sidecarReady, t, refreshProviders, tabRpc.getModelRoles, tabRpc.getUsage, tabRpc.getModelRoleMetadata]);

	useEffect(() => {
		if (open) void load();
	}, [open, load]);

	const reloadRoles = useCallback(async () => {
		if (!sidecarReady) return;
		try {
			const res = await tabRpc.getModelRoles();
			if (res.success) setRoles((res.data as ModelRolesResult | undefined)?.roles ?? []);
		} catch {
			/* keep stale role list; the next full load retries */
		}
	}, [sidecarReady, tabRpc.getModelRoles]);

	const metaById = useMemo(() => new Map((roleMeta ?? []).map(m => [m.id, m])), [roleMeta]);

	const rows = useMemo<Row[]>(
		() => buildModelRows({ models, providers, roles, usage }),
		[models, providers, roles, usage],
	);

	const providerOptions = useMemo(() => {
		const nameById = new Map<string, string>();
		for (const row of rows) if (!nameById.has(row.provider)) nameById.set(row.provider, row.providerName);
		return [...nameById.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, name]) => ({ id, name }));
	}, [rows]);

	const visibleRows = useMemo(() => {
		const q = query.trim().toLowerCase();
		const filtered = rows.filter(row => {
			if (authOnly && row.authKnown && !row.authenticated) return false;
			if (providerFilter !== "all" && row.provider !== providerFilter) return false;
			if (
				q.length > 0 &&
				!(
					row.id.toLowerCase().includes(q) ||
					row.provider.toLowerCase().includes(q) ||
					row.providerName.toLowerCase().includes(q) ||
					row.name?.toLowerCase().includes(q)
				)
			) {
				return false;
			}
			return true;
		});
		const dir = sort.dir;
		return [...filtered].sort((a, b) => COMPARATORS[sort.key](a, b, dir));
	}, [rows, query, authOnly, providerFilter, sort]);

	const isCurrent = useCallback(
		(row: Row) => current !== null && current.provider === row.provider && current.id === row.id,
		[current],
	);

	const handleSort = useCallback((key: SortKey) => {
		setSort(prev => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
	}, []);

	const assignSession = useCallback(
		async (row: Row) => {
			if (busyKey !== null || isCurrent(row)) return;
			setBusyKey(row.key);
			try {
				const res = await tabRpc.setModel(row.provider, row.id);
				if (res.success) {
					toast({ variant: "success", message: t("modelCompare.setSuccess", { model: row.key }) });
				} else {
					toast({ variant: "error", title: t("modelCompare.setFailed"), message: res.error });
				}
			} catch (cause) {
				toast({ variant: "error", title: t("modelCompare.setFailed"), message: String(cause) });
			} finally {
				setBusyKey(null);
			}
		},
		[busyKey, isCurrent, t, tabRpc.setModel],
	);

	const assignRole = useCallback(
		async (row: Row, roleId: string) => {
			const currentRoleId = row.roles[0]?.id ?? "";
			if (roleId === currentRoleId || busyKey !== null) return;
			setBusyKey(row.key);
			try {
				const res = roleId
					? await tabRpc.setModelRole(roleId, row.key)
					: await tabRpc.setModelRole(currentRoleId, null);
				if (res.success) {
					toast({
						variant: "success",
						message: roleId
							? t("modelCompare.roleSet", { role: roleId, model: row.key })
							: t("modelCompare.roleCleared", { role: currentRoleId }),
					});
					await reloadRoles();
				} else {
					toast({ variant: "error", title: t("modelCompare.roleFailed"), message: res.error });
				}
			} catch (cause) {
				toast({ variant: "error", title: t("modelCompare.roleFailed"), message: String(cause) });
			} finally {
				setBusyKey(null);
			}
		},
		[busyKey, reloadRoles, t, tabRpc.setModelRole],
	);

	/** Roles offered in the per-row picker: non-hidden, plus any hidden role already on this row (so it can be cleared). */
	const assignableRoles = useCallback(
		(row: Row): ModelRoleEntry[] => {
			if (!roles) return [];
			return roles.filter(role => !metaById.get(role.id)?.hidden || row.roles.some(r => r.id === role.id));
		},
		[roles, metaById],
	);

	const roleNames = useCallback(
		(roleId: string): string => metaById.get(roleId)?.name ?? roles?.find(r => r.id === roleId)?.name ?? roleId,
		[metaById, roles],
	);

	let body: ReactNode;
	if (fatalError !== null) {
		body = (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
				<span className="text-xs text-(--omp-error)">
					{t("modelCompare.modelsFailed")}: {fatalError}
				</span>
				<Button icon={<RefreshCw size={12} />} onClick={() => void load()} size="sm" variant="secondary">
					{t("modelCompare.retry")}
				</Button>
			</div>
		);
	} else if (loading && models.length === 0) {
		body = (
			<div className="flex flex-1 items-center justify-center py-16">
				<Spinner />
			</div>
		);
	} else if (rows.length === 0) {
		body = (
			<div className="rounded-md border border-(--omp-border-muted) px-3 py-8 text-center text-omp-md text-(--omp-dim)">
				{t("modelCompare.emptyCatalog")}
			</div>
		);
	} else if (visibleRows.length === 0) {
		body = (
			<div className="rounded-md border border-(--omp-border-muted) px-3 py-8 text-center text-omp-md text-(--omp-dim)">
				{t("modelCompare.empty")}
			</div>
		);
	} else {
		body = (
			<div className="min-h-0 flex-1 overflow-auto rounded-lg border border-(--omp-border-muted)">
				<table className="w-full border-collapse text-left text-omp-md">
					<thead
						className={
							"sticky top-0 z-10 bg-(--omp-bg-secondary) shadow-[0_1px_0_var(--omp-border-muted)]" /* surface-ok: sticky thead must paint over scrolling rows */
						}
					>
						<tr>
							<SortHeader
								label={t("modelCompare.col.provider")}
								onSort={handleSort}
								sort={sort}
								sortKey="provider"
							/>
							<SortHeader label={t("modelCompare.col.model")} onSort={handleSort} sort={sort} sortKey="model" />
							<SortHeader
								className="text-right"
								label={t("modelCompare.col.context")}
								onSort={handleSort}
								sort={sort}
								sortKey="context"
							/>
							<SortHeader
								className="text-right"
								label={t("modelCompare.col.cost")}
								onSort={handleSort}
								sort={sort}
								sortKey="cost"
							/>
							<SortHeader label={t("modelCompare.col.quota")} onSort={handleSort} sort={sort} sortKey="quota" />
							<SortHeader label={t("modelCompare.col.roles")} onSort={handleSort} sort={sort} sortKey="roles" />
							<th className="px-3 py-2 text-right text-omp-xs font-semibold tracking-wider whitespace-nowrap text-(--omp-muted) uppercase">
								{t("modelCompare.col.actions")}
							</th>
						</tr>
					</thead>
					<tbody>
						{visibleRows.map(row => {
							const active = isCurrent(row);
							const busy = busyKey === row.key;
							return (
								<tr
									className={cx(
										"cursor-pointer border-b border-(--omp-border-muted) transition-colors last:border-b-0 hover:bg-(--omp-bg-tertiary)",
										active && "bg-(--omp-selected-bg)",
										!active && row.authKnown && !row.authenticated && "opacity-60",
									)}
									key={row.key}
									onClick={() => void assignSession(row)}
									title={t("modelCompare.useHint")}
								>
									<td
										className={cx(
											"border-l-2 px-3 py-2",
											active ? "border-(--omp-accent)" : "border-transparent",
										)}
									>
										<div className="flex items-center gap-2">
											<span className="font-medium whitespace-nowrap text-(--omp-text)">
												{row.providerName}
											</span>
											<AuthBadge row={row} t={t} />
											{row.disabled && <Badge variant="warning">{t("providers.badge.disabled")}</Badge>}
										</div>
									</td>
									<td className="max-w-[260px] px-3 py-2">
										<div className="flex min-w-0 flex-col">
											<div className="flex items-center gap-1.5">
												<span className="truncate font-mono text-omp-sm text-(--omp-text)">{row.id}</span>
												{active && (
													<Badge dot variant="info">
														{t("modelCompare.current")}
													</Badge>
												)}
											</div>
											{row.name && <span className="truncate text-omp-xs text-(--omp-dim)">{row.name}</span>}
										</div>
									</td>
									<td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
										{row.contextWindow !== null ? (
											<span className="text-(--omp-text)">{formatTokens(row.contextWindow)}</span>
										) : (
											<span className="text-(--omp-dim)">—</span>
										)}
									</td>
									<td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
										{row.costIn !== null && row.costOut !== null ? (
											row.costIn === 0 && row.costOut === 0 ? (
												<span className="text-(--omp-success)">{t("modelCompare.free")}</span>
											) : (
												<span className="text-(--omp-text)">
													{formatCost(row.costIn)}
													<span className="text-(--omp-dim)"> / </span>
													{formatCost(row.costOut)}
												</span>
											)
										) : (
											<span className="text-(--omp-dim)">—</span>
										)}
									</td>
									<td className="min-w-[110px] px-3 py-2">
										{row.quota ? (
											<span
												className="block"
												title={`${row.quota.limit.label}${row.quota.limit.windowLabel ? ` · ${row.quota.limit.windowLabel}` : ""}`}
											>
												<ProgressBar height={4} value={row.quota.fraction} />
											</span>
										) : (
											<span className="text-(--omp-dim)">—</span>
										)}
									</td>
									<td className="px-3 py-2">
										<div className="flex flex-wrap items-center gap-1">
											{row.roles.map(role => (
												<RoleTag key={role.id} metadata={metaById.get(role.id)} role={role} />
											))}
											{row.roles.length === 0 && <span className="text-(--omp-dim)">—</span>}
										</div>
									</td>
									<td className="px-3 py-2" onClick={event => event.stopPropagation()}>
										<div className="flex items-center justify-end gap-1.5">
											<select
												aria-label={t("modelCompare.assignRole")}
												className="h-6 max-w-[140px] rounded border border-(--omp-border-muted) bg-(--omp-input-bg) px-1.5 text-omp-xs text-(--omp-text) focus:border-(--omp-border-accent) focus:outline-none disabled:opacity-45"
												disabled={busy || roles === null}
												onChange={event => void assignRole(row, event.target.value)}
												value={row.roles[0]?.id ?? ""}
											>
												<option value="">{t("modelCompare.noRole")}</option>
												{assignableRoles(row).map(role => (
													<option key={role.id} value={role.id}>
														{roleNames(role.id)}
													</option>
												))}
											</select>
											{active ? (
												<span className="flex h-6 w-6 items-center justify-center text-(--omp-accent)">
													<Check size={14} />
												</span>
											) : (
												<Button
													disabled={busyKey !== null}
													icon={<Check size={12} />}
													loading={busy}
													onClick={() => void assignSession(row)}
													size="sm"
													variant="ghost"
												>
													{t("modelCompare.use")}
												</Button>
											)}
										</div>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		);
	}

	return (
		<Modal onClose={onClose} open={open} size="full" title={t("modelCompare.title")}>
			<div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					<div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-md border border-(--omp-border-muted) bg-(--omp-input-bg) px-2.5 py-1.5">
						<Search className="shrink-0 text-(--omp-dim)" size={13} />
						<input
							aria-label={t("modelCompare.search")}
							className="min-w-0 flex-1 bg-transparent text-xs text-(--omp-text) placeholder:text-(--omp-dim) focus:outline-none"
							onChange={event => setQuery(event.target.value)}
							placeholder={t("modelCompare.search")}
							value={query}
						/>
					</div>
					<select
						aria-label={t("modelCompare.allProviders")}
						className="h-7 rounded-md border border-(--omp-border-muted) bg-(--omp-input-bg) px-2 text-omp-sm text-(--omp-text) focus:border-(--omp-border-accent) focus:outline-none"
						onChange={event => setProviderFilter(event.target.value)}
						value={providerFilter}
					>
						<option value="all">{t("modelCompare.allProviders")}</option>
						{providerOptions.map(option => (
							<option key={option.id} value={option.id}>
								{option.name}
							</option>
						))}
					</select>
					<button
						aria-pressed={authOnly}
						className={cx(
							"flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-omp-sm font-medium whitespace-nowrap transition-colors",
							authOnly
								? "border-(--omp-accent) bg-(--omp-selected-bg) text-(--omp-text)"
								: "border-(--omp-border-muted) bg-transparent text-(--omp-muted) hover:text-(--omp-text)",
						)}
						onClick={() => setAuthOnly(prev => !prev)}
						type="button"
					>
						{authOnly && <Check size={11} />}
						{t("modelCompare.authOnly")}
					</button>
					<Button
						icon={<RefreshCw size={12} />}
						loading={loading}
						onClick={() => void load()}
						size="sm"
						variant="ghost"
					>
						{t("modelCompare.refresh")}
					</Button>
					{models !== null && (
						<span className="ml-auto text-omp-xs whitespace-nowrap text-(--omp-dim) tabular-nums">
							{t("modelCompare.count", { shown: visibleRows.length, total: rows.length })}
						</span>
					)}
				</div>

				{failedSections.length > 0 && (
					<div className="shrink-0 rounded-md border border-[color-mix(in_srgb,var(--omp-warning)_35%,transparent)] bg-transparent px-3 py-2 text-omp-sm text-(--omp-warning)">
						{t("modelCompare.partialWarning", { what: failedSections.join(", ") })}
					</div>
				)}

				{body}
			</div>
		</Modal>
	);
}
