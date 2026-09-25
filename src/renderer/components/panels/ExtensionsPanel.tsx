import { type TabRpc as SessionRpc, useTabRpc as useSessionRpc } from "../../lib/tab-rpc";
/**
 * Shared management surfaces for hooks, MCP servers, and custom slash
 * commands. Settings hosts the first-class pages; the compact Extensions
 * window remains as a backwards-compatible wrapper over the same content.
 *
 * Each tab lazy-loads on first view, caches for the lifetime of the mounted
 * panel, and offers a manual Refresh. Search filters rows client-side.
 *
 * Rows are interactive where a mutation RPC exists: skills/hooks toggle via
 * set_skill_enabled / set_hook_enabled and MCP servers carry an action menu
 * (enable / disable / reconnect / remove via mcp_action, plus test connection
 * via mcp_test and re-authorize via mcp_reauth / mcp_reauth_cancel). New MCP
 * servers are added through the wizard dialog (mcp_add) from the tab toolbar.
 * The commands tab is read-only — the sidecar exposes no slash-command
 * management RPC. Toggles
 * are optimistic — the row reverts and an error toast fires on failure, and
 * a successful mutation re-fetches the tab. Hook toggles persist but only
 * bind at startup, so the footer flags them as next-session.
 *
 * Parent wiring (parent-owned files): mount once beside the other windows and
 * drive it from a ui-store flag + command-registry entry:
 *   <ExtensionsPanel open={extensionsOpen} onClose={closeExtensions} />
 */

import { Braces, Network, Plus, RefreshCw, Search, Webhook } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	AvailableCommand,
	RpcHookInfo,
	RpcHooksResult,
	RpcMcpServerInfo,
	RpcMcpServersResult,
	RpcResponse,
} from "../../../shared/rpc-types";
import { useActiveTabRouteReady } from "../../hooks/use-active-tab-route";
import { cx, shortenPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { Badge, type BadgeVariant, Button, Modal, Spinner, type TabItem, Tabs } from "../common";
import { type McpTestView, summarizeMcpTestData } from "./mcp/McpFeedback";
import { type McpCardAction, type McpReauthPhase, McpServerCard } from "./mcp/McpServerCard";
import { McpServerWizard } from "./mcp/McpServerWizard";

export interface ExtensionsPanelProps {
	open: boolean;
	onClose: () => void;
	/** Deep-link a specific tab on open (defaults to "hooks"). */
	initialTab?: TabId;
}

export type TabId = "hooks" | "mcp" | "commands";

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface TabRpc<T> {
	data: T | null;
	error: string | null;
	loading: boolean;
	ready: boolean;
	/** Re-fetch; awaited by row mutations so fresh state replaces optimistic overlays. */
	refresh: () => Promise<void>;
}

const fetchHooks = (rpc: SessionRpc): Promise<RpcResponse> => rpc.getHooks();
const pickHooks = (data: unknown): RpcHookInfo[] => (data as RpcHooksResult | undefined)?.hooks ?? [];
const fetchMcpServers = (rpc: SessionRpc): Promise<RpcResponse> => rpc.getMcpServers();
const pickMcpServers = (data: unknown): RpcMcpServerInfo[] => (data as RpcMcpServersResult | undefined)?.servers ?? [];
const fetchCommands = (rpc: SessionRpc): Promise<RpcResponse> => rpc.getAvailableCommands();
const pickCommands = (data: unknown): AvailableCommand[] =>
	((data as { commands?: AvailableCommand[] } | undefined)?.commands ?? []).filter(isCustomCommand);

/**
 * Lazy per-tab RPC loader: fires on the tab's first activation, then caches.
 * Errors surface inline with a Retry button; `refresh` re-fetches on demand.
 */
function useTabRpc<T>(
	open: boolean,
	active: boolean,
	fetcher: (rpc: SessionRpc) => Promise<RpcResponse>,
	pick: (data: unknown) => T,
): TabRpc<T> {
	const client = useSessionRpc();
	const t = useT();
	const sidecarReady = useSessionStore(s => s.status) === "ready";
	const cwd = useSessionStore(s => s.cwd);
	const activeTabId = useTabsStore(s => s.activeTabId);
	const routeReady = useActiveTabRouteReady();
	const routeKey = `${activeTabId ?? "none"}:${cwd}`;
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const attemptedRef = useRef(false);
	const requestRef = useRef(0);
	const routeRef = useRef(routeKey);

	const load = useCallback(async () => {
		if (!sidecarReady || !routeReady) {
			setError(t("extPanel.notConnected"));
			return;
		}
		const request = ++requestRef.current;
		const requestRoute = routeKey;
		setLoading(true);
		setError(null);
		try {
			const res = await fetcher(client);
			if (request !== requestRef.current || requestRoute !== routeRef.current) return;
			if (res.success) setData(pick(res.data));
			else setError(res.error);
		} catch (cause) {
			if (request === requestRef.current && requestRoute === routeRef.current) setError(String(cause));
		} finally {
			if (request === requestRef.current && requestRoute === routeRef.current) setLoading(false);
		}
	}, [sidecarReady, routeReady, routeKey, fetcher, client, pick, t]);

	useEffect(() => {
		routeRef.current = routeKey;
		requestRef.current += 1;
		attemptedRef.current = false;
		setData(null);
		setError(null);
		setLoading(false);
	}, [routeKey]);

	useEffect(() => {
		if (!open || !active || !routeReady || attemptedRef.current) return;
		attemptedRef.current = true;
		void load();
	}, [open, active, load, routeReady]);

	const refresh = useCallback(async (): Promise<void> => {
		await load();
	}, [load]);

	return { data, error, loading, ready: sidecarReady && routeReady, refresh };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Case-insensitive substring filter over a row's searchable fields. */
export function filterList<T>(items: T[] | null, query: string, fields: (item: T) => string[]): T[] {
	if (!items) return [];
	const q = query.trim().toLowerCase();
	if (!q) return items;
	return items.filter(item => fields(item).some(field => field.toLowerCase().includes(q)));
}

export function hookPhase(event: string): string {
	const sep = event.indexOf(":");
	return sep === -1 ? event : event.slice(0, sep);
}

export function hookTool(event: string): string {
	const sep = event.indexOf(":");
	return sep === -1 ? "" : event.slice(sep + 1);
}

/** Bucket hooks by event tool, groups sorted A–Z, row order preserved within a group. */
export function groupHooksByTool(hooks: RpcHookInfo[]): Array<[string, RpcHookInfo[]]> {
	const byTool = new Map<string, RpcHookInfo[]>();
	for (const hook of hooks) {
		const tool = hookTool(hook.event) || "*";
		const bucket = byTool.get(tool);
		if (bucket) bucket.push(hook);
		else byTool.set(tool, [hook]);
	}
	return [...byTool.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** Sidecar-advertised commands that did not ship with the binary (any source but "builtin"). */
export function isCustomCommand(command: AvailableCommand): boolean {
	return command.source !== "builtin";
}

/** Sources with a localized label; anything else falls back to the raw source string. */
const KNOWN_COMMAND_SOURCES: Record<string, true> = {
	custom: true,
	extension: true,
	file: true,
	mcp_prompt: true,
	other: true,
	skill: true,
};

/** Bucket commands by their origin source, groups sorted A–Z, row order preserved within a group. */
export function groupCommandsBySource(commands: AvailableCommand[]): Array<[string, AvailableCommand[]]> {
	const bySource = new Map<string, AvailableCommand[]>();
	for (const command of commands) {
		const source = command.source ?? "other";
		const bucket = bySource.get(source);
		if (bucket) bucket.push(command);
		else bySource.set(source, [command]);
	}
	return [...bySource.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** MCP status/auth badge variant maps live beside the card in mcp/McpServerCard. */

/** Row-sized enable/disable switch (Settings-window styling); spinner while its mutation is in flight. */
function EnableToggle({
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
	const label = enabled ? t("extPanel.enabled") : t("extPanel.disabled");
	if (busy) {
		return (
			<span className="flex h-4 w-7 items-center justify-center" title={label}>
				<Spinner size="sm" />
			</span>
		);
	}
	return (
		<button
			aria-checked={enabled}
			aria-label={label}
			className={cx(
				"relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
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
					"absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-white shadow transition-all duration-150",
					enabled ? "left-3.5" : "left-0.5",
				)}
			/>
		</button>
	);
}

// ---------------------------------------------------------------------------
// Row mutations: optimistic enable overlay + one-at-a-time busy key
// ---------------------------------------------------------------------------

interface RowMutation {
	/** Key of the row whose mutation is in flight (null = idle). */
	busyKey: string | null;
	/** Row enable state with the optimistic overlay applied. */
	effective: (key: string, base: boolean) => boolean;
	/**
	 * Run one row mutation: apply the optimistic enable state (`next`, null =
	 * no overlay), call the RPC, re-fetch on success, revert + toast on error.
	 * Controls stay disabled while `busyKey` is set — one mutation at a time.
	 */
	run: (key: string, next: boolean | null, action: () => Promise<RpcResponse>, errorTitle: string) => Promise<void>;
}

function useRowMutation(refresh: () => Promise<void>, ready = true): RowMutation {
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({});

	const effective = useCallback((key: string, base: boolean): boolean => overrides[key] ?? base, [overrides]);

	const run = useCallback(
		async (key: string, next: boolean | null, action: () => Promise<RpcResponse>, errorTitle: string) => {
			if (!ready) return;
			setBusyKey(key);
			if (next !== null) setOverrides(prev => ({ ...prev, [key]: next }));
			const clearOverride = (): void =>
				setOverrides(prev => {
					if (!(key in prev)) return prev;
					const rest = { ...prev };
					delete rest[key];
					return rest;
				});
			try {
				const res = await action();
				if (!res.success) {
					clearOverride();
					toast({ variant: "error", title: errorTitle, message: res.error });
					return;
				}
				// Fresh server state replaces the optimistic overlay.
				await refresh();
				clearOverride();
			} catch (cause) {
				clearOverride();
				toast({ variant: "error", title: errorTitle, message: String(cause) });
			} finally {
				setBusyKey(null);
			}
		},
		[ready, refresh],
	);

	return { busyKey, effective, run };
}

// ---------------------------------------------------------------------------
// Shared tab frame: toolbar (search / count / refresh) + state handling
// ---------------------------------------------------------------------------

interface TabFrameProps {
	tabId: TabId;
	loading: boolean;
	loaded: boolean;
	error: string | null;
	ready: boolean;
	onRefresh: () => void;
	query: string;
	onQueryChange: (query: string) => void;
	total: number;
	visible: number;
	/** Extra toolbar buttons between the count and Refresh (e.g. MCP add-server). */
	actions?: ReactNode;
	/** Settings owns the global search field when this content is embedded there. */
	showSearch?: boolean;
	/** Embedded settings pages grow with their content and use the page scroll. */
	embedded?: boolean;
	children: ReactNode;
}

function TabFrame({
	tabId,
	loading,
	loaded,
	error,
	ready,
	onRefresh,
	query,
	onQueryChange,
	total,
	visible,
	actions,
	showSearch = true,
	embedded = false,
	children,
}: TabFrameProps) {
	const t = useT();
	const trimmed = query.trim();
	const countKey = trimmed ? `extPanel.countFiltered.${tabId}` : `extPanel.count.${tabId}`;
	const countText = loaded ? t(countKey, trimmed ? { shown: visible, total } : { count: total }) : null;

	let body: ReactNode = null;
	if (!loaded) {
		if (loading) {
			body = (
				<div className="m-auto">
					<Spinner label={t("common.loading")} />
				</div>
			);
		} else if (error) {
			body = (
				<div className="m-auto flex max-w-md flex-col items-center gap-2 rounded-lg border border-(--omp-border-muted) px-4 py-6 text-center">
					<span className="text-omp-md font-medium text-(--omp-error)">{t("extPanel.loadFailed")}</span>
					<span className="text-omp-sm break-all text-(--omp-dim)">{error}</span>
					<Button
						disabled={!ready}
						icon={<RefreshCw size={12} />}
						onClick={onRefresh}
						size="sm"
						title={!ready ? t("extPanel.notConnected") : t("extPanel.retry")}
						variant="secondary"
					>
						{t("extPanel.retry")}
					</Button>
				</div>
			);
		}
	} else if (total === 0) {
		body = (
			<div className="m-auto w-full rounded-md border border-(--omp-border-muted) px-3 py-4 text-center text-omp-md text-(--omp-dim)">
				{t(`extPanel.empty.${tabId}`)}
			</div>
		);
	} else if (visible === 0) {
		body = (
			<div className="m-auto w-full rounded-md border border-(--omp-border-muted) px-3 py-4 text-center text-omp-md text-(--omp-dim)">
				{t("extPanel.noMatch", { query: trimmed })}
			</div>
		);
	} else {
		body = children;
	}

	return (
		<div className={cx("flex min-h-0 flex-col gap-3 py-3", embedded ? "flex-none" : "flex-1 px-4")}>
			<div className="settings-management-toolbar flex shrink-0 items-center gap-2">
				{showSearch ? (
					<div className="flex min-w-[160px] flex-1 items-center gap-2 rounded-md border border-(--omp-border-muted) bg-(--omp-input-bg) px-2.5 py-1.5">
						<Search className="shrink-0 text-(--omp-dim)" size={13} />
						<input
							aria-label={t(`extPanel.search.${tabId}`)}
							className="min-w-0 flex-1 bg-transparent text-xs text-(--omp-text) placeholder:text-(--omp-dim) focus:outline-none"
							onChange={event => onQueryChange(event.target.value)}
							placeholder={t(`extPanel.search.${tabId}`)}
							value={query}
						/>
					</div>
				) : (
					<div className="flex-1" />
				)}
				{countText && <span className="shrink-0 text-omp-sm tabular-nums text-(--omp-dim)">{countText}</span>}
				{actions}
				<Button
					disabled={!ready}
					icon={<RefreshCw size={12} />}
					loading={loading}
					onClick={onRefresh}
					size="sm"
					title={!ready ? t("extPanel.notConnected") : t("extPanel.refresh")}
					variant="ghost"
				>
					{t("extPanel.refresh")}
				</Button>
			</div>
			{loaded && error && (
				<div className="shrink-0 rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent px-3 py-2 text-omp-md text-(--omp-error)">
					{error}
				</div>
			)}
			<div className={cx("flex min-h-0 flex-col", embedded ? "overflow-visible" : "flex-1 overflow-y-auto")}>
				{body}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Hooks tab
// ---------------------------------------------------------------------------

function HookRow({
	hook,
	enabled,
	busy,
	disabled,
	onToggle,
}: {
	hook: RpcHookInfo;
	/** Enable state with the optimistic overlay applied. */
	enabled: boolean;
	busy: boolean;
	disabled: boolean;
	onToggle: () => void;
}) {
	const phase = hookPhase(hook.event);
	const eventVariant: BadgeVariant = phase === "pre" ? "info" : phase === "post" ? "warning" : "default";
	return (
		<div className="flex flex-col gap-1 rounded-lg border border-(--omp-border-muted) bg-transparent px-3 py-2">
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-mono text-omp-md font-medium text-(--omp-text)">{hook.name}</span>
				<Badge variant={eventVariant}>{hook.event}</Badge>
				<Badge variant="default">{hook.source}</Badge>
				<span className="ml-auto">
					<EnableToggle busy={busy} disabled={disabled} enabled={enabled} onToggle={onToggle} />
				</span>
			</div>
			<span className="block truncate font-mono text-omp-xs text-(--omp-dim)" title={hook.path}>
				{shortenPath(hook.path)}
			</span>
		</div>
	);
}

function HooksTab({
	rpc,
	query,
	onQueryChange,
	showSearch,
	embedded,
}: {
	rpc: TabRpc<RpcHookInfo[]>;
	query: string;
	onQueryChange: (q: string) => void;
	showSearch?: boolean;
	embedded?: boolean;
}) {
	const tabRpc = useSessionRpc();
	const t = useT();
	const mutation = useRowMutation(rpc.refresh, rpc.ready);
	const { groups, visibleCount } = useMemo(() => {
		const visible = filterList(rpc.data, query, hook => [hook.name, hook.event, hook.source]);
		return { groups: groupHooksByTool(visible), visibleCount: visible.length };
	}, [rpc.data, query]);
	return (
		<TabFrame
			embedded={embedded}
			error={rpc.error}
			loaded={rpc.data !== null}
			loading={rpc.loading}
			ready={rpc.ready}
			onQueryChange={onQueryChange}
			onRefresh={rpc.refresh}
			query={query}
			showSearch={showSearch}
			tabId="hooks"
			total={rpc.data?.length ?? 0}
			visible={visibleCount}
		>
			<div className="flex flex-col gap-3">
				{groups.map(([tool, hooks]) => (
					<section className="flex flex-col gap-1.5" key={tool}>
						<header className="flex items-center gap-2 px-1">
							<span className="font-mono text-omp-xs font-semibold uppercase tracking-wider text-(--omp-muted)">
								{tool}
							</span>
							<span className="text-omp-xs tabular-nums text-(--omp-dim)">{hooks.length}</span>
						</header>
						{hooks.map(hook => {
							const enabled = mutation.effective(hook.id, hook.enabled);
							return (
								<HookRow
									busy={mutation.busyKey === hook.id}
									disabled={mutation.busyKey !== null || !rpc.ready}
									enabled={enabled}
									hook={hook}
									key={hook.id}
									onToggle={() =>
										void mutation.run(
											hook.id,
											!enabled,
											() => tabRpc.setHookEnabled(hook.id, !enabled),
											t("extPanel.hookToggleFailed"),
										)
									}
								/>
							);
						})}
					</section>
				))}
			</div>
		</TabFrame>
	);
}

// ---------------------------------------------------------------------------
// MCP tab
// ---------------------------------------------------------------------------

/**
 * MCP tab: server cards (mcp/McpServerCard) + the add-server wizard. Test and
 * re-auth state is tracked per server name in local maps — never derived from
 * the server list, and a successful mutation re-fetches the tab (no
 * optimistic auth/tool-count derivation).
 */
function McpTab({
	rpc,
	query,
	onQueryChange,
	showSearch,
	embedded,
}: {
	rpc: TabRpc<RpcMcpServerInfo[]>;
	query: string;
	onQueryChange: (q: string) => void;
	showSearch?: boolean;
	embedded?: boolean;
}) {
	const tabRpc = useSessionRpc();
	const t = useT();
	const mutation = useRowMutation(rpc.refresh, rpc.ready);
	const [menuFor, setMenuFor] = useState<string | null>(null);
	const [confirmRemoveFor, setConfirmRemoveFor] = useState<string | null>(null);
	const [wizardOpen, setWizardOpen] = useState(false);
	const [tests, setTests] = useState<Readonly<Record<string, { testing: boolean; view: McpTestView | null }>>>({});
	const [reauths, setReauths] = useState<Readonly<Record<string, McpReauthPhase>>>({});
	// Mirrors `reauths` so the async reauth body can tell an intentional cancel
	// (suppress its failure toast) from a genuine one after the await.
	const reauthPhaseRef = useRef<Record<string, McpReauthPhase>>({});
	// Prune stale per-server test/reauth entries whenever the server set
	// changes: a removed server's result must not leak onto a same-name
	// re-add after the next refetch (state is keyed by name, not identity).
	useEffect(() => {
		const names = new Set((rpc.data ?? []).map(s => s.name));
		let phaseDirty = false;
		for (const n of Object.keys(reauthPhaseRef.current)) {
			if (!names.has(n)) {
				delete reauthPhaseRef.current[n];
				phaseDirty = true;
			}
		}
		if (phaseDirty) setReauths({ ...reauthPhaseRef.current });
		setTests(prev => {
			const stale = Object.keys(prev).filter(n => !names.has(n));
			if (stale.length === 0) return prev;
			const rest = { ...prev };
			for (const n of stale) delete rest[n];
			return rest;
		});
	}, [rpc.data]);
	const closeMenu = useCallback(() => setMenuFor(null), []);
	const visible = useMemo(
		() =>
			filterList(rpc.data, query, server => [
				server.name,
				server.transport,
				server.status,
				server.scope ?? "",
				server.command ?? "",
				server.url ?? "",
			]),
		[rpc.data, query],
	);

	const setReauthPhase = (name: string, phase: McpReauthPhase | null): void => {
		if (phase === null) {
			const rest = { ...reauthPhaseRef.current };
			delete rest[name];
			reauthPhaseRef.current = rest;
			setReauths(rest);
		} else {
			reauthPhaseRef.current = { ...reauthPhaseRef.current, [name]: phase };
			setReauths(reauthPhaseRef.current);
		}
	};

	const runTest = async (server: RpcMcpServerInfo): Promise<void> => {
		if (!rpc.ready) return;
		setTests(prev => ({ ...prev, [server.name]: { testing: true, view: null } }));
		let view: McpTestView;
		try {
			const res = await tabRpc.mcpTest({ name: server.name });
			view = res.success ? summarizeMcpTestData(res.data) : { kind: "error", error: res.error };
		} catch (cause) {
			view = { kind: "error", error: cause instanceof Error ? cause.message : String(cause) };
		}
		setTests(prev => ({ ...prev, [server.name]: { testing: false, view } }));
	};

	const runReauth = async (server: RpcMcpServerInfo): Promise<void> => {
		if (!rpc.ready) return;
		setReauthPhase(server.name, "running");
		try {
			// Long-timeout call; the extension_ui open_url/input dialogs render the
			// OAuth flow while this is in flight.
			const res = await tabRpc.mcpReauth(server.name);
			const cancelling = reauthPhaseRef.current[server.name] === "cancelling";
			if (!res.success) {
				if (cancelling) return;
				if (res.code === "oauth_busy") {
					toast({ variant: "info", message: t("mcp.reauth.busy") });
				} else {
					toast({ variant: "error", title: t("mcp.reauth.failed"), message: res.error });
				}
				return;
			}
			const data = res.data as { ok?: boolean; error?: string } | undefined;
			if (data?.ok === false) {
				if (!cancelling) {
					toast({ variant: "error", title: t("mcp.reauth.failed"), message: data.error ?? "" });
				}
				return;
			}
			if (!cancelling) toast({ variant: "success", message: t("mcp.reauth.ok", { name: server.name }) });
			// Reload can change authState/toolCount — refetch rather than derive.
			await rpc.refresh();
		} catch (cause) {
			if (reauthPhaseRef.current[server.name] !== "cancelling") {
				toast({ variant: "error", title: t("mcp.reauth.failed"), message: String(cause) });
			}
		} finally {
			setReauthPhase(server.name, null);
		}
	};

	const runReauthCancel = async (server: RpcMcpServerInfo): Promise<void> => {
		if (!rpc.ready) return;
		setReauthPhase(server.name, "cancelling");
		const restore = (): void => {
			// Cancel failed: the flow is presumably still alive — re-arm the button.
			if (reauthPhaseRef.current[server.name] === "cancelling") setReauthPhase(server.name, "running");
		};
		try {
			const res = await tabRpc.mcpReauthCancel(server.name);
			// On success the pending mcpReauth settles and runReauth clears the phase.
			if (!res.success) {
				toast({ variant: "error", title: t("mcp.reauth.cancelFailed"), message: res.error });
				restore();
			}
		} catch (cause) {
			toast({ variant: "error", title: t("mcp.reauth.cancelFailed"), message: String(cause) });
			restore();
		}
	};

	const dismissTest = (name: string): void => {
		setTests(prev => {
			if (!(name in prev)) return prev;
			const rest = { ...prev };
			delete rest[name];
			return rest;
		});
	};

	const handleMenuAction = (server: RpcMcpServerInfo, action: McpCardAction): void => {
		if (!rpc.ready) return;
		setMenuFor(null);
		if (action === "remove") {
			// Destructive: confirm inline inside the card before dispatching.
			setConfirmRemoveFor(server.name);
			return;
		}
		if (action === "test") {
			void runTest(server);
			return;
		}
		if (action === "reauth") {
			void runReauth(server);
			return;
		}
		const next = action === "reconnect" ? null : action === "enable";
		void mutation.run(server.name, next, () => tabRpc.mcpAction(server.name, action), t("extPanel.mcpActionFailed"));
	};

	const handleConfirmRemove = (server: RpcMcpServerInfo): void => {
		if (!rpc.ready) return;
		setConfirmRemoveFor(null);
		// Drop any inline test/reauth state so nothing survives onto a re-add.
		setTests(prev => {
			if (!(server.name in prev)) return prev;
			const rest = { ...prev };
			delete rest[server.name];
			return rest;
		});
		delete reauthPhaseRef.current[server.name];
		void mutation.run(
			server.name,
			null,
			() => tabRpc.mcpAction(server.name, "remove", server.scope),
			t("extPanel.mcpActionFailed"),
		);
	};

	return (
		<>
			<TabFrame
				embedded={embedded}
				actions={
					<Button
						disabled={!rpc.ready}
						icon={<Plus size={12} />}
						onClick={() => setWizardOpen(true)}
						size="sm"
						title={!rpc.ready ? t("extPanel.notConnected") : undefined}
						variant="secondary"
					>
						{t("mcp.add")}
					</Button>
				}
				error={rpc.error}
				loaded={rpc.data !== null}
				loading={rpc.loading}
				ready={rpc.ready}
				onQueryChange={onQueryChange}
				onRefresh={rpc.refresh}
				query={query}
				showSearch={showSearch}
				tabId="mcp"
				total={rpc.data?.length ?? 0}
				visible={visible.length}
			>
				<div className="flex flex-col gap-2">
					{visible.map(server => (
						<McpServerCard
							busy={mutation.busyKey === server.name}
							confirmingRemove={confirmRemoveFor === server.name}
							disabled={mutation.busyKey !== null || !rpc.ready}
							disabledReason={!rpc.ready ? t("extPanel.notConnected") : undefined}
							enabled={mutation.effective(server.name, server.enabled)}
							key={server.name}
							menuOpen={menuFor === server.name}
							onCancelRemove={() => setConfirmRemoveFor(null)}
							onConfirmRemove={() => handleConfirmRemove(server)}
							onDismissTest={() => dismissTest(server.name)}
							onMenuAction={action => handleMenuAction(server, action)}
							onMenuClose={closeMenu}
							onMenuToggle={() => setMenuFor(prev => (prev === server.name ? null : server.name))}
							onReauthCancel={() => void runReauthCancel(server)}
							reauth={reauths[server.name] ?? null}
							server={server}
							testing={tests[server.name]?.testing ?? false}
							testView={tests[server.name]?.view ?? null}
						/>
					))}
				</div>
			</TabFrame>
			<McpServerWizard
				onAdded={() => {
					setWizardOpen(false);
					// Add triggers a reload — tool counts/auth come back with the refetch.
					void rpc.refresh();
				}}
				onClose={() => setWizardOpen(false)}
				open={wizardOpen}
			/>
		</>
	);
}

// ---------------------------------------------------------------------------
// Commands tab (read-only: no slash-command management RPC exists)
// ---------------------------------------------------------------------------

function CommandRow({ command }: { command: AvailableCommand }) {
	return (
		<div className="flex flex-col gap-1 rounded-lg border border-(--omp-border-muted) bg-transparent px-3 py-2">
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-mono text-omp-md font-medium text-(--omp-text)">/{command.name}</span>
				{command.aliases && command.aliases.length > 0 && (
					<span className="text-omp-xs text-(--omp-dim)">
						{command.aliases.map(alias => `/${alias}`).join(", ")}
					</span>
				)}
				{command.input?.hint && (
					<code className="rounded bg-(--omp-code-bg) px-1.5 py-px font-mono text-omp-xs text-(--omp-muted)">
						{command.input.hint}
					</code>
				)}
			</div>
			{command.description && (
				<p className="line-clamp-2 text-omp-sm leading-snug text-(--omp-muted)">{command.description}</p>
			)}
		</div>
	);
}

function CommandsTab({
	rpc,
	query,
	onQueryChange,
	showSearch,
	embedded,
}: {
	rpc: TabRpc<AvailableCommand[]>;
	query: string;
	onQueryChange: (q: string) => void;
	showSearch?: boolean;
	embedded?: boolean;
}) {
	const t = useT();
	const { groups, visibleCount } = useMemo(() => {
		const visible = filterList(rpc.data, query, command => [
			command.name,
			command.description,
			command.source ?? "",
			...(command.aliases ?? []),
		]);
		return { groups: groupCommandsBySource(visible), visibleCount: visible.length };
	}, [rpc.data, query]);
	return (
		<TabFrame
			embedded={embedded}
			error={rpc.error}
			loaded={rpc.data !== null}
			loading={rpc.loading}
			ready={rpc.ready}
			onQueryChange={onQueryChange}
			onRefresh={rpc.refresh}
			query={query}
			showSearch={showSearch}
			tabId="commands"
			total={rpc.data?.length ?? 0}
			visible={visibleCount}
		>
			<div className="flex flex-col gap-3">
				{groups.map(([source, commands]) => (
					<section className="flex flex-col gap-1.5" key={source}>
						<header className="flex items-center gap-2 px-1">
							<span className="font-mono text-omp-xs font-semibold uppercase tracking-wider text-(--omp-muted)">
								{KNOWN_COMMAND_SOURCES[source] ? t(`extPanel.commands.source.${source}`) : source}
							</span>
							<span className="text-omp-xs tabular-nums text-(--omp-dim)">{commands.length}</span>
						</header>
						{commands.map(command => (
							<CommandRow command={command} key={`${source}:${command.name}`} />
						))}
					</section>
				))}
			</div>
		</TabFrame>
	);
}

// ---------------------------------------------------------------------------
// Settings pages
// ---------------------------------------------------------------------------

export function ExtensionSettingsPage({ tabId, query }: { tabId: TabId; query: string }) {
	const t = useT();
	const hooks = useTabRpc(true, tabId === "hooks", fetchHooks, pickHooks);
	const mcp = useTabRpc(true, tabId === "mcp", fetchMcpServers, pickMcpServers);
	const commands = useTabRpc(true, tabId === "commands", fetchCommands, pickCommands);
	const onQueryChange = useCallback(() => {}, []);
	const icon =
		tabId === "mcp" ? (
			<Network aria-hidden="true" size={17} />
		) : tabId === "hooks" ? (
			<Webhook aria-hidden="true" size={17} />
		) : (
			<Braces aria-hidden="true" size={17} />
		);

	return (
		<div className="space-y-5">
			<header>
				<div className="flex items-center gap-2 text-(--omp-accent)">
					{icon}
					<h2 className="text-[16px] font-semibold tracking-[-0.01em] text-(--omp-text)">
						{t(`settings.extensions.${tabId}.title`)}
					</h2>
				</div>
				<p className="mt-1.5 max-w-2xl text-omp-sm leading-relaxed text-(--omp-muted)">
					{t(`settings.extensions.${tabId}.description`)}
				</p>
			</header>
			<div className="settings-embedded-panel flex flex-col">
				{tabId === "hooks" && (
					<HooksTab embedded onQueryChange={onQueryChange} query={query} rpc={hooks} showSearch={false} />
				)}
				{tabId === "mcp" && (
					<McpTab embedded onQueryChange={onQueryChange} query={query} rpc={mcp} showSearch={false} />
				)}
				{tabId === "commands" && (
					<CommandsTab embedded onQueryChange={onQueryChange} query={query} rpc={commands} showSearch={false} />
				)}
				<div className="shrink-0 border-t border-(--omp-border-muted) px-4 py-2 text-omp-xs leading-relaxed text-(--omp-dim)">
					{t(`extPanel.footer.${tabId}`)}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

export function ExtensionsPanel({ open, onClose, initialTab = "hooks" }: ExtensionsPanelProps) {
	const t = useT();
	const [tab, setTab] = useState<TabId>(initialTab);
	const [query, setQuery] = useState("");

	const hooks = useTabRpc(open, tab === "hooks", fetchHooks, pickHooks);
	const mcp = useTabRpc(open, tab === "mcp", fetchMcpServers, pickMcpServers);
	const commands = useTabRpc(open, tab === "commands", fetchCommands, pickCommands);

	// Reopening starts fresh on the requested tab with no stale filter.
	useEffect(() => {
		if (open) {
			setTab(initialTab);
			setQuery("");
		}
	}, [open, initialTab]);

	const tabs: TabItem[] = useMemo(
		() => [
			{ id: "hooks", label: t("extPanel.tabs.hooks"), badge: hooks.data?.length },
			{ id: "mcp", label: t("extPanel.tabs.mcp"), badge: mcp.data?.length },
			{ id: "commands", label: t("extPanel.tabs.commands"), badge: commands.data?.length },
		],
		[t, hooks.data, mcp.data, commands.data],
	);

	const handleTabChange = useCallback((id: string) => {
		setTab(id as TabId);
		setQuery("");
	}, []);

	return (
		<Modal bodyClassName="p-0" onClose={onClose} open={open} size="lg" title={t("extPanel.title")}>
			<div className="flex h-[70vh] min-h-0 flex-col">
				<Tabs
					activeId={tab}
					ariaLabel={t("extPanel.title")}
					className="shrink-0 px-4"
					onChange={handleTabChange}
					tabs={tabs}
				/>
				{tab === "hooks" && <HooksTab onQueryChange={setQuery} query={query} rpc={hooks} />}
				{tab === "mcp" && <McpTab onQueryChange={setQuery} query={query} rpc={mcp} />}
				{tab === "commands" && <CommandsTab onQueryChange={setQuery} query={query} rpc={commands} />}
				<div className="shrink-0 border-t border-(--omp-border-muted) px-4 py-2 text-omp-xs text-(--omp-dim)">
					{t(`extPanel.footer.${tab}`)}
				</div>
			</div>
		</Modal>
	);
}
