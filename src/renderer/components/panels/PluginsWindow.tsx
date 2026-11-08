/**
 * Plugins page, opened from the sidebar: browse every configured catalog as
 * cards with a logo and description, install with one click, and open a plugin
 * to see what it adds. Catalog management itself stays in Settings.
 *
 * Plugins can run code, so the first install from each catalog asks once. The
 * rest of the install path is the same marketplace_action the Settings list uses.
 */

import { Puzzle, RefreshCw, Search, Settings2, ShieldAlert, X } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useUiStore } from "../../stores/ui";
import { Button, ConfirmDialog, Modal, Spinner, Tabs } from "../common";
import { CopyableError } from "./inventory/ErrorNote";
import {
	type CatalogFilter,
	type CatalogPlugin,
	catalogCategories,
	filterCatalog,
	type PluginAction,
} from "./plugins/catalog-model";
import { PluginCard } from "./plugins/PluginCard";
import { usePluginCategoryLabel } from "./plugins/PluginCategoryLabel";
import { PluginDetail } from "./plugins/PluginDetail";
import { PluginErrorNote } from "./plugins/PluginErrorNote";
import { usePluginCatalog } from "./plugins/use-plugin-catalog";
import { PanelEmpty } from "./workspace-ui";

/** Catalogs bring dozens of categories, most with a plugin or two; the rest sit behind "More". */
const TOP_CATEGORIES = 12;

export function PluginsWindow() {
	const t = useT();
	const open = useUiStore(s => s.pluginsOpen);
	const close = useUiStore(s => s.closePlugins);
	const catalog = usePluginCatalog(open);
	const categoryLabel = usePluginCategoryLabel();

	const [query, setQuery] = useState("");
	const [view, setView] = useState<CatalogFilter["view"]>("all");
	const [category, setCategory] = useState<string | null>(null);
	const [catalogFilter, setCatalogFilter] = useState<string | null>(null);
	const [allCategories, setAllCategories] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [pendingInstall, setPendingInstall] = useState<CatalogPlugin | null>(null);

	// Opening the page starts at the list. Search and filters stay, as they're easy to clear and slow to redo.
	useLayoutEffect(() => {
		if (open) setSelectedId(null);
	}, [open]);

	const { plugins, marketplaces, busy, canAct, actionErrors, runAction, isCatalogTrusted, trustCatalog } = catalog;
	// A catalog removed in Settings while it was selected falls back to all of them.
	const activeCatalog = marketplaces.some(entry => entry.name === catalogFilter) ? catalogFilter : null;
	const inCatalog = useMemo(
		() => (activeCatalog === null ? plugins : plugins.filter(plugin => plugin.marketplace === activeCatalog)),
		[activeCatalog, plugins],
	);
	const categories = useMemo(() => catalogCategories(inCatalog), [inCatalog]);
	const shownCategories = allCategories ? categories : categories.slice(0, TOP_CATEGORIES);
	const visible = useMemo(
		() => filterCatalog(plugins, { query, view, category, catalog: activeCatalog }),
		[activeCatalog, plugins, query, view, category],
	);
	const installedCount = useMemo(() => inCatalog.filter(plugin => plugin.info.installed).length, [inCatalog]);
	const catalogCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const { marketplace } of plugins) counts.set(marketplace, (counts.get(marketplace) ?? 0) + 1);
		return counts;
	}, [plugins]);
	const selected = selectedId ? plugins.find(plugin => plugin.id === selectedId) : undefined;

	const requestAction = useCallback(
		(plugin: CatalogPlugin, action: PluginAction): void => {
			if (action === "install" && !isCatalogTrusted(plugin.marketplaceSource)) {
				setPendingInstall(plugin);
				return;
			}
			void runAction(plugin, action);
		},
		[isCatalogTrusted, runAction],
	);

	const confirmInstall = (): void => {
		const plugin = pendingInstall;
		if (!plugin) return;
		setPendingInstall(null);
		void trustCatalog(plugin.marketplaceSource);
		void runAction(plugin, "install");
	};

	const openInSettings = (tab: "marketplaces" | "plugins"): void => {
		close();
		useUiStore.getState().openSettings(`resources:${tab}`);
	};

	const clearFilters = (): void => {
		setQuery("");
		setCategory(null);
		setCatalogFilter(null);
		setView("all");
	};

	const seeding = catalog.seeding;
	const seedingLabel = seeding ? t("plugins.seeding", { done: seeding.done, total: seeding.total }) : "";
	// Installing can restart the agent, which would interrupt the catalog being added.
	const actionDisabled = busy !== null || !canAct || seeding !== null;
	const disabledReason = !canAct
		? t("invPanel.notConnected")
		: busy
			? t("plugins.oneAtATime")
			: seeding
				? t("plugins.seedingWait")
				: undefined;

	const body = (() => {
		if (catalog.status === "connecting") {
			return (
				<div className="flex flex-1 items-center justify-center">
					<Spinner label={t("plugins.connecting")} />
				</div>
			);
		}
		if (seeding && marketplaces.length === 0) {
			return (
				<div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
					<Spinner label={seedingLabel} />
					<p className="max-w-md text-omp-sm text-(--omp-dim)">{t("plugins.seedingHint")}</p>
				</div>
			);
		}
		if (catalog.status === "loading" && plugins.length === 0) {
			return (
				<div className="flex flex-1 items-center justify-center">
					<Spinner label={t("common.loading")} />
				</div>
			);
		}
		if (catalog.status === "error") {
			return (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
					<div className="w-full max-w-lg">{catalog.error && <PluginErrorNote error={catalog.error} />}</div>
					<Button icon={<RefreshCw size={12} />} onClick={() => void catalog.reload()} size="sm" variant="ghost">
						{t("invPanel.retry")}
					</Button>
				</div>
			);
		}
		if (marketplaces.length === 0) {
			return (
				<div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
					<PanelEmpty
						action={
							<div className="flex flex-wrap justify-center gap-2">
								<Button onClick={() => void catalog.addDefaultCatalogs()} size="sm">
									{t("plugins.addDefaults")}
								</Button>
								<Button onClick={() => openInSettings("marketplaces")} size="sm" variant="ghost">
									{t("plugins.manageCatalogs")}
								</Button>
							</div>
						}
						hint={t("plugins.noCatalogsHint")}
						icon={Puzzle}
						title={t("plugins.noCatalogs")}
					/>
				</div>
			);
		}
		return (
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
				{catalog.seedError && (
					<div className="mb-2">
						<CopyableError
							copyLabel={t("marketplace.copyError")}
							message={t("plugins.seedFailed", { message: catalog.seedError.message })}
						/>
					</div>
				)}
				{catalog.listFailures.map(failure => (
					<div className="mb-2" key={failure.marketplace}>
						<CopyableError
							copyLabel={t("marketplace.copyError")}
							message={t("plugins.catalogFailed", { catalog: failure.marketplace, message: failure.error })}
						/>
					</div>
				))}
				{visible.length === 0 ? (
					inCatalog.length > 0 && view === "installed" && !query && category === null ? (
						<PanelEmpty hint={t("plugins.noneInstalledHint")} icon={Puzzle} title={t("plugins.noneInstalled")} />
					) : (
						<PanelEmpty
							action={
								<Button onClick={clearFilters} size="sm" variant="ghost">
									{t("plugins.clearFilters")}
								</Button>
							}
							icon={Search}
							title={t("plugins.noMatches")}
						/>
					)
				) : (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
						{visible.map(plugin => (
							<PluginCard
								disabled={actionDisabled}
								disabledReason={disabledReason}
								error={actionErrors[plugin.id]}
								installing={busy?.id === plugin.id}
								key={plugin.id}
								onInstall={() => requestAction(plugin, "install")}
								onOpen={() => setSelectedId(plugin.id)}
								plugin={plugin}
								showCatalog={marketplaces.length > 1}
							/>
						))}
					</div>
				)}
			</div>
		);
	})();

	const showFilters = plugins.length > 0;

	return (
		<Modal bodyClassName="p-0" onClose={close} open={open} size="full" title={t("plugins.title")}>
			<div className="flex h-full min-h-0 flex-col">
				{/* The list stays mounted behind a plugin's page, so Back returns to the same scroll and filters. */}
				<div className={cx("flex min-h-0 flex-1 flex-col", selected && "hidden")}>
					<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-(--omp-border-muted) px-4 py-2.5">
						<div className="relative min-w-[12rem] flex-1">
							<Search
								className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-(--omp-dim)"
								size={13}
							/>
							<input
								aria-label={t("plugins.search")}
								className="w-full rounded-md border border-(--omp-input-border) bg-(--omp-input-bg) py-1.5 pr-7 pl-8 text-omp-sm text-(--omp-text) placeholder:text-(--omp-dim) focus:border-(--omp-input-focus-border) focus:outline-none"
								onChange={event => setQuery(event.target.value)}
								placeholder={t("plugins.search")}
								spellCheck={false}
								type="text"
								value={query}
							/>
							{query && (
								<button
									aria-label={t("plugins.clearSearch")}
									className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-(--omp-dim) hover:text-(--omp-text)"
									onClick={() => setQuery("")}
									type="button"
								>
									<X size={12} />
								</button>
							)}
						</div>
						{marketplaces.length > 1 && (
							<select
								aria-label={t("plugins.catalogFilter")}
								className="max-w-[16rem] truncate rounded-md border border-(--omp-input-border) bg-(--omp-input-bg) px-2 py-1.5 text-omp-sm text-(--omp-text) focus:border-(--omp-input-focus-border) focus:outline-none"
								onChange={event => {
									setCatalogFilter(event.target.value || null);
									setCategory(null);
								}}
								value={activeCatalog ?? ""}
							>
								<option value="">{t("plugins.catalogFilter.all")}</option>
								{marketplaces.map(entry => (
									<option key={entry.name} value={entry.name}>
										{entry.name} ({catalogCounts.get(entry.name) ?? 0})
									</option>
								))}
							</select>
						)}
						<Tabs
							activeId={view}
							ariaLabel={t("plugins.title")}
							compact
							onChange={id => setView(id as CatalogFilter["view"])}
							tabs={[
								{ id: "all", label: t("plugins.view.all"), badge: inCatalog.length },
								{ id: "installed", label: t("plugins.view.installed"), badge: installedCount },
							]}
						/>
						<Button
							icon={<Settings2 size={12} />}
							onClick={() => openInSettings("marketplaces")}
							size="sm"
							variant="ghost"
						>
							{t("plugins.manageCatalogs")}
						</Button>
						<Button
							aria-label={t("plugins.refresh")}
							disabled={
								!canAct || catalog.refreshing || busy !== null || seeding !== null || marketplaces.length === 0
							}
							onClick={() => void catalog.refresh()}
							size="sm"
							title={t("plugins.refresh")}
							variant="ghost"
						>
							<RefreshCw className={catalog.refreshing ? "animate-spin" : undefined} size={12} />
						</Button>
					</div>
					{showFilters && categories.length > 1 && (
						<div className="flex shrink-0 flex-wrap gap-1 border-b border-(--omp-border-muted) px-4 py-2">
							{[{ id: null, count: inCatalog.length }, ...shownCategories].map(entry => (
								<button
									aria-pressed={category === entry.id}
									className={cx(
										"omp-pressable rounded-full px-2.5 py-0.5 text-omp-xs transition-colors",
										category === entry.id
											? "bg-(--omp-selected-bg) text-(--omp-text)"
											: "text-(--omp-muted) hover:bg-(--omp-selected-bg)",
									)}
									key={entry.id ?? "all"}
									onClick={() => setCategory(entry.id)}
									type="button"
								>
									{entry.id === null ? t("plugins.category.all") : categoryLabel(entry.id)}
									<span className="ml-1 tabular-nums text-(--omp-dim)">{entry.count}</span>
								</button>
							))}
							{categories.length > TOP_CATEGORIES && (
								<button
									aria-expanded={allCategories}
									className="omp-pressable rounded-full px-2.5 py-0.5 text-omp-xs text-(--omp-dim) transition-colors hover:bg-(--omp-selected-bg) hover:text-(--omp-text)"
									onClick={() => setAllCategories(value => !value)}
									type="button"
								>
									{allCategories
										? t("plugins.categories.fewer")
										: t("plugins.categories.more", { count: categories.length - TOP_CATEGORIES })}
								</button>
							)}
						</div>
					)}
					{seeding && marketplaces.length > 0 && (
						<div className="shrink-0 border-b border-(--omp-border-muted) px-4 py-1.5 text-omp-xs text-(--omp-muted)">
							<Spinner label={seedingLabel} size="sm" />
						</div>
					)}
					{catalog.refreshError && (
						<div className="shrink-0 px-4 pt-2">
							<CopyableError copyLabel={t("marketplace.copyError")} message={catalog.refreshError} />
						</div>
					)}
					{body}
					<div className="flex shrink-0 items-center gap-1.5 border-t border-(--omp-border-muted) px-4 py-1.5 text-omp-xs text-(--omp-dim)">
						<ShieldAlert className="shrink-0" size={12} />
						<span>{t("plugins.trustNote")}</span>
					</div>
				</div>
				{selected && (
					<PluginDetail
						busyAction={busy?.id === selected.id ? busy.action : null}
						disabled={actionDisabled}
						disabledReason={disabledReason}
						error={actionErrors[selected.id]}
						key={selected.id}
						onAction={action => requestAction(selected, action)}
						onBack={() => setSelectedId(null)}
						onOpenSettings={() => openInSettings("plugins")}
						plugin={selected}
					/>
				)}
			</div>
			<ConfirmDialog
				confirmLabel={t("plugins.trust.confirm")}
				message={t("plugins.trust.message", { catalog: pendingInstall?.marketplace ?? "" })}
				onCancel={() => setPendingInstall(null)}
				onConfirm={confirmInstall}
				open={pendingInstall !== null}
				title={t("plugins.trust.title", { name: pendingInstall?.title ?? "" })}
				warning={t("plugins.trust.warning")}
			/>
		</Modal>
	);
}
