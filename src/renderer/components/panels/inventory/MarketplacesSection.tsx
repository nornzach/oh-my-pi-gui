import { useTabRpc } from "../../../lib/tab-rpc";
/**
 * Interactive Marketplaces tab body: add-marketplace form plus per-marketplace
 * cards with catalog refresh, inline-confirmed removal, and a lazy-expanded
 * available-plugins list with install/upgrade/uninstall row actions.
 *
 * Every mutation rides marketplace_action and refetches only after any required
 * origin-tab restart settles. No optimistic derivation of plugin counts or
 * install state, and no dependency on available_commands_update ordering.
 */

import { Check, ChevronDown, ChevronRight, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import type { RpcMarketplaceInfo, RpcMarketplacePluginInfo } from "../../../../shared/rpc-types";
import { useT } from "../../../lib/i18n";
import { isImeKeyEvent } from "../../../lib/ime";
import {
	capturePluginActivationOrigin,
	handlePluginActivation,
	isPluginActivationOriginActive,
} from "../../../lib/plugin-activation";
import { Badge, Button, Spinner } from "../../common";
import { shortenSource } from "../inventory-utils";
import { CopyableError } from "./ErrorNote";
import {
	availablePluginActions,
	classifyMarketplaceSource,
	extractCacheTimestamp,
	type MarketplacePluginAction,
} from "./marketplace-source";
import { listAvailablePlugins, mutationError } from "./rpc-result";

// ============================================================================
// Add marketplace form
// ============================================================================

export function AddMarketplaceForm({ onAdded }: { onAdded: () => Promise<void> }) {
	const tabRpc = useTabRpc();
	const t = useT();
	const [source, setSource] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (): Promise<void> => {
		const trimmed = source.trim();
		// Client-side parity with the agent's classifySource: a bare name is
		// rejected inline before the RPC fires (same rule order, same verdict).
		if (classifyMarketplaceSource(trimmed) === null) {
			setError(t("marketplace.sourceInvalid"));
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const res = await tabRpc.marketplaceAction({ action: "add", source: trimmed });
			const failure = mutationError(res, t("marketplace.unknownError"));
			if (failure !== null) {
				setError(failure);
				return;
			}
			setSource("");
			await onAdded();
		} catch (cause) {
			setError(String(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-(--omp-border-muted) bg-transparent px-3 py-2.5">
			<span className="text-omp-md font-medium text-(--omp-text)">{t("marketplace.addTitle")}</span>
			<div className="flex items-start gap-2">
				<input
					aria-label={t("marketplace.addTitle")}
					className="min-w-0 flex-1 rounded-md border border-(--omp-input-border) bg-(--omp-input-bg) px-2.5 py-1.5 font-mono text-omp-sm text-(--omp-text) placeholder:text-(--omp-dim) focus:border-(--omp-input-focus-border) focus:outline-none disabled:opacity-50"
					disabled={busy}
					onChange={event => {
						setSource(event.target.value);
						setError(null);
					}}
					onKeyDown={event => {
						if (isImeKeyEvent(event)) return;
						if (event.key === "Enter") void submit();
					}}
					placeholder={t("marketplace.sourcePlaceholder")}
					spellCheck={false}
					type="text"
					value={source}
				/>
				<Button
					disabled={source.trim() === ""}
					icon={<Plus size={12} />}
					loading={busy}
					onClick={() => void submit()}
					size="sm"
				>
					{t("marketplace.add")}
				</Button>
			</div>
			<span className="text-omp-xs leading-snug text-(--omp-dim)">{t("marketplace.sourceHint")}</span>
			{error && <CopyableError copyLabel={t("marketplace.copyError")} message={error} />}
		</div>
	);
}

// ============================================================================
// Available plugin row
// ============================================================================

function AvailablePluginRow({
	plugin,
	busyAction,
	anyBusy,
	confirmingInstall,
	onAction,
	onConfirmInstall,
	onCancelInstall,
}: {
	plugin: RpcMarketplacePluginInfo;
	/** This row's in-flight action (its button shows the spinner). */
	busyAction: MarketplacePluginAction | null;
	/** Another row's action is in flight — one mutation per marketplace at a time. */
	anyBusy: boolean;
	/** Install clicked but not yet confirmed — the Install button swaps to confirm/cancel. */
	confirmingInstall: boolean;
	onAction: (pluginName: string, action: MarketplacePluginAction) => void;
	onConfirmInstall: (pluginName: string) => void;
	onCancelInstall: () => void;
}) {
	const t = useT();
	const repository = plugin.repository;
	const homepage = plugin.homepage;
	return (
		<div className="flex items-center gap-3 rounded-md border border-(--omp-border-muted) bg-transparent px-2.5 py-2">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="text-omp-md font-medium text-(--omp-text)">{plugin.name}</span>
					{plugin.version && <span className="text-omp-xs tabular-nums text-(--omp-dim)">v{plugin.version}</span>}
					{plugin.installed && <Badge variant="success">{t("marketplace.installed")}</Badge>}
				</div>
				{plugin.description && (
					<span className="text-omp-sm leading-snug text-(--omp-dim)">{plugin.description}</span>
				)}
				{confirmingInstall && (
					<span className="text-omp-xs text-(--omp-muted)">{t("marketplace.installConfirmHint")}</span>
				)}
				{(plugin.author ||
					plugin.license ||
					plugin.category ||
					repository ||
					homepage ||
					(plugin.tags?.length ?? 0) > 0) && (
					<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-omp-xs text-(--omp-dim)">
						{plugin.author && <span>{plugin.author}</span>}
						{plugin.license && <span>{plugin.license}</span>}
						{plugin.category && <span>{plugin.category}</span>}
						{plugin.tags?.map(tag => (
							<span key={tag}>#{tag}</span>
						))}
						{repository && (
							<button
								className="underline decoration-(--omp-border-muted) underline-offset-2 hover:text-(--omp-text)"
								onClick={() => void window.omp.system.openExternal(repository)}
								title={repository}
								type="button"
							>
								{t("marketplace.repository")}
							</button>
						)}
						{homepage && (
							<button
								className="underline decoration-(--omp-border-muted) underline-offset-2 hover:text-(--omp-text)"
								onClick={() => void window.omp.system.openExternal(homepage)}
								title={homepage}
								type="button"
							>
								{t("marketplace.homepage")}
							</button>
						)}
					</div>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{confirmingInstall ? (
					<span className="flex shrink-0 items-center gap-0.5">
						<button
							aria-label={t("marketplace.installConfirm")}
							className="omp-pressable flex h-6 w-6 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent text-(--omp-error) disabled:opacity-40"
							disabled={anyBusy}
							onClick={() => onConfirmInstall(plugin.name)}
							title={t("marketplace.installConfirm")}
							type="button"
						>
							<Check size={12} />
						</button>
						<button
							aria-label={t("common.cancel")}
							className="omp-pressable flex h-6 w-6 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-bg-tertiary) disabled:opacity-40"
							disabled={anyBusy}
							onClick={onCancelInstall}
							title={t("common.cancel")}
							type="button"
						>
							<X size={12} />
						</button>
					</span>
				) : (
					availablePluginActions(plugin.installed).map(action => (
						<Button
							className={action === "uninstall" ? "text-(--omp-error)" : undefined}
							disabled={anyBusy}
							key={action}
							loading={busyAction === action}
							onClick={() => onAction(plugin.name, action)}
							size="sm"
							variant={action === "install" ? "secondary" : "ghost"}
						>
							{t(`marketplace.${action}`)}
						</Button>
					))
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Marketplace card
// ============================================================================

export function MarketplaceCard({
	marketplace,
	reload,
}: {
	marketplace: RpcMarketplaceInfo;
	/** Refetch get_marketplaces (card data: name, source, plugin count, cache note). */
	reload: () => Promise<void>;
}) {
	const tabRpc = useTabRpc();
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const [available, setAvailable] = useState<RpcMarketplacePluginInfo[] | null>(null);
	const [listLoading, setListLoading] = useState(false);
	const [listError, setListError] = useState<string | null>(null);
	const [busyAction, setBusyAction] = useState<"update" | "remove" | null>(null);
	const [confirmingRemove, setConfirmingRemove] = useState(false);
	const [cardError, setCardError] = useState<string | null>(null);
	const [pluginBusy, setPluginBusy] = useState<{ name: string; action: MarketplacePluginAction } | null>(null);
	const [pluginErrors, setPluginErrors] = useState<Readonly<Record<string, string>>>({});
	const [confirmInstall, setConfirmInstall] = useState<string | null>(null);

	/** list_available — lazy on first expand, then cached in component state. */
	const fetchAvailable = useCallback(async (): Promise<void> => {
		setListLoading(true);
		setListError(null);
		try {
			const res = await tabRpc.marketplaceAction({
				action: "list_available",
				marketplace: marketplace.name,
			});
			const result = listAvailablePlugins(res, t("marketplace.unknownError"));
			if (result.ok) {
				setAvailable(result.plugins);
			} else {
				setListError(result.error);
			}
		} catch (cause) {
			setListError(String(cause));
		} finally {
			setListLoading(false);
		}
	}, [marketplace.name, t, tabRpc.marketplaceAction]);

	const toggleExpanded = (): void => {
		const next = !expanded;
		setExpanded(next);
		if (next && available === null && !listLoading) void fetchAvailable();
	};

	/** Catalog refresh — long-running (clone/fetch), spinner for the duration. */
	const refreshCatalog = async (): Promise<void> => {
		setBusyAction("update");
		setCardError(null);
		try {
			const res = await tabRpc.marketplaceAction({ action: "update", marketplace: marketplace.name });
			const failure = mutationError(res, t("marketplace.unknownError"));
			if (failure !== null) {
				setCardError(failure);
				return;
			}
			// The catalog changed — refresh both the card (count/cache note) and,
			// when expanded, the available list (versions may have moved).
			if (expanded) await fetchAvailable();
			await reload();
		} catch (cause) {
			setCardError(String(cause));
		} finally {
			setBusyAction(null);
		}
	};

	const removeMarketplace = async (): Promise<void> => {
		setBusyAction("remove");
		setCardError(null);
		try {
			const res = await tabRpc.marketplaceAction({ action: "remove", marketplace: marketplace.name });
			const failure = mutationError(res, t("marketplace.unknownError"));
			if (failure !== null) {
				setCardError(failure);
				setConfirmingRemove(false);
				return;
			}
			await reload();
		} catch (cause) {
			setCardError(String(cause));
			setConfirmingRemove(false);
		} finally {
			setBusyAction(null);
		}
	};

	const runPluginAction = (pluginName: string, action: MarketplacePluginAction): void => {
		// The catalog wire carries no omp manifest, so the GUI cannot know
		// pre-install whether a plugin ships executable entry points — confirm
		// every install (metadata is visible on the row).
		if (action === "install") {
			setConfirmInstall(pluginName);
			return;
		}
		void executePluginAction(pluginName, action);
	};

	const executePluginAction = async (pluginName: string, action: MarketplacePluginAction): Promise<void> => {
		const origin = capturePluginActivationOrigin();
		if (!origin) {
			setPluginErrors(prev => ({ ...prev, [pluginName]: t("pluginActivation.routePending") }));
			return;
		}
		setConfirmInstall(prev => (prev === pluginName ? null : prev));
		setPluginBusy({ name: pluginName, action });
		setPluginErrors(prev => {
			if (!(pluginName in prev)) return prev;
			const rest = { ...prev };
			delete rest[pluginName];
			return rest;
		});
		try {
			const res = await tabRpc.marketplaceAction({
				action,
				marketplace: marketplace.name,
				plugin: pluginName,
			});
			const failure = mutationError(res, t("marketplace.unknownError"));
			if (failure !== null) {
				if (isPluginActivationOriginActive(origin)) {
					setPluginErrors(prev => ({ ...prev, [pluginName]: failure }));
				}
				return;
			}
			const data = res.data as { activation?: string } | undefined;
			await handlePluginActivation(
				data?.activation,
				{
					pluginId: `${pluginName}@${marketplace.name}`,
					expected: action === "uninstall" ? "disabled" : "enabled",
				},
				origin,
			);
			if (!isPluginActivationOriginActive(origin)) return;
			await fetchAvailable();
			await reload();
		} catch (cause) {
			if (isPluginActivationOriginActive(origin)) {
				setPluginErrors(prev => ({ ...prev, [pluginName]: String(cause) }));
			}
		} finally {
			setPluginBusy(null);
		}
	};

	const cacheTimestamp = extractCacheTimestamp(marketplace);
	const cacheNote =
		cacheTimestamp !== null
			? t("marketplace.lastUpdated", { time: new Date(cacheTimestamp).toLocaleString() })
			: t("marketplace.cacheNote");

	return (
		<div className="overflow-hidden rounded-lg border border-(--omp-border-muted) bg-transparent">
			<div className="flex items-center gap-2 px-3 py-2.5">
				<button
					aria-expanded={expanded}
					aria-label={t("marketplace.browse")}
					className="omp-pressable shrink-0 rounded p-0.5 text-(--omp-dim) hover:text-(--omp-text)"
					onClick={toggleExpanded}
					title={t("marketplace.browse")}
					type="button"
				>
					{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
				</button>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-omp-lg font-medium text-(--omp-text)">{marketplace.name}</span>
						{marketplace.pluginCount !== undefined ? (
							<Badge variant="default">
								{t("invPanel.marketplaces.pluginCount", { count: marketplace.pluginCount })}
							</Badge>
						) : (
							<Badge variant="muted">{t("invPanel.marketplaces.notFetched")}</Badge>
						)}
						{/* Catalogs are cache-backed — the note is always visible; the
						    timestamp rides along when the wire carries one. */}
						<span className="text-omp-xs text-(--omp-dim)">{cacheNote}</span>
					</div>
					<div className="flex items-center gap-3 text-omp-sm text-(--omp-dim)">
						<span className="truncate font-mono" title={marketplace.source}>
							{shortenSource(marketplace.source)}
						</span>
					</div>
				</div>
				<button
					aria-label={t("marketplace.refresh")}
					className="omp-pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-selected-bg) hover:text-(--omp-accent) disabled:opacity-40"
					disabled={busyAction !== null}
					onClick={() => void refreshCatalog()}
					title={t("marketplace.refresh")}
					type="button"
				>
					{busyAction === "update" ? <Spinner size="sm" /> : <RefreshCw size={12} />}
				</button>
				{confirmingRemove ? (
					<span className="flex shrink-0 items-center gap-0.5">
						<button
							aria-label={t("marketplace.removeConfirm")}
							className="omp-pressable flex h-6 w-6 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent text-(--omp-error) disabled:opacity-40"
							disabled={busyAction !== null}
							onClick={() => void removeMarketplace()}
							title={t("marketplace.removeConfirm")}
							type="button"
						>
							{busyAction === "remove" ? <Spinner size="sm" /> : <Check size={12} />}
						</button>
						<button
							aria-label={t("common.cancel")}
							className="omp-pressable flex h-6 w-6 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-selected-bg) disabled:opacity-40"
							disabled={busyAction !== null}
							onClick={() => setConfirmingRemove(false)}
							title={t("common.cancel")}
							type="button"
						>
							<X size={12} />
						</button>
					</span>
				) : (
					<button
						aria-label={t("marketplace.remove")}
						className="omp-pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-tool-error-bg) hover:text-(--omp-error) disabled:opacity-40"
						disabled={busyAction !== null}
						onClick={() => setConfirmingRemove(true)}
						title={t("marketplace.remove")}
						type="button"
					>
						<Trash2 size={12} />
					</button>
				)}
			</div>
			{cardError && (
				<CopyableError className="mx-3 mb-2" copyLabel={t("marketplace.copyError")} message={cardError} />
			)}
			{expanded && (
				<div className="flex flex-col gap-2 border-t border-(--omp-border-muted) px-3 py-2.5">
					{available === null && listLoading ? (
						<div className="flex items-center justify-center py-4">
							<Spinner label={t("common.loading")} />
						</div>
					) : available === null && listError !== null ? (
						<>
							<CopyableError copyLabel={t("marketplace.copyError")} message={listError} />
							<div>
								<Button
									icon={<RefreshCw size={12} />}
									onClick={() => void fetchAvailable()}
									size="sm"
									variant="ghost"
								>
									{t("invPanel.retry")}
								</Button>
							</div>
						</>
					) : available !== null && available.length === 0 ? (
						<div className="py-2 text-center text-omp-sm text-(--omp-dim)">{t("marketplace.availableEmpty")}</div>
					) : (
						<>
							{(available ?? []).map(plugin => (
								<div className="flex flex-col gap-1.5" key={plugin.name}>
									<AvailablePluginRow
										anyBusy={pluginBusy !== null}
										busyAction={pluginBusy?.name === plugin.name ? pluginBusy.action : null}
										confirmingInstall={confirmInstall === plugin.name}
										onAction={runPluginAction}
										onCancelInstall={() => setConfirmInstall(null)}
										onConfirmInstall={name => void executePluginAction(name, "install")}
										plugin={plugin}
									/>
									{pluginErrors[plugin.name] && (
										<CopyableError
											copyLabel={t("marketplace.copyError")}
											message={pluginErrors[plugin.name]}
										/>
									)}
								</div>
							))}
							{listLoading && (
								<div className="flex items-center gap-2 text-omp-xs text-(--omp-dim)">
									<Spinner size="sm" />
									{t("common.loading")}
								</div>
							)}
							{listError && <CopyableError copyLabel={t("marketplace.copyError")} message={listError} />}
						</>
					)}
				</div>
			)}
		</div>
	);
}
