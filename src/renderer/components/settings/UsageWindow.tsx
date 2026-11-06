import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Usage window: provider quota reports (limit bars with reset countdowns)
 * plus local session token/cost tallies.
 *
 * The two halves refresh on different clocks on purpose. Quotas are live calls
 * to each provider's usage endpoint, so they are read when the window opens,
 * when its tab changes, and on the explicit refresh. The session tallies are
 * local journal arithmetic, so they follow every settled turn the same way the
 * titlebar chips do.
 */

import {
	ArrowDownToLine,
	ArrowUpFromLine,
	Coins,
	Database,
	History,
	RefreshCw,
	Sigma,
	Sparkles,
	Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { quotaPercentText } from "../../../shared/quotas";
import type {
	RpcResetCreditAccount,
	RpcResetCreditRedeemResult,
	SessionStats,
	UsageLimit,
	UsageReport,
	UsageSessionStats,
} from "../../../shared/rpc-types";
import { describeError } from "../../lib/errors";
import { formatClock, formatCost, formatDuration, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useNowTick } from "../../lib/now-tick";
import { nextQuotaReset, QUOTA_RESET_GRACE_MS } from "../../lib/quota-rows";
import { useMessagesStore } from "../../stores/messages";
import { useModelStore } from "../../stores/model";
import { publishQuotaReports } from "../../stores/quotas";
import { type SessionStore, useSessionStore } from "../../stores/session";
import { sessionRuntimeStore, useRuntimeTabId } from "../../stores/session-runtime-context";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Badge, Button, ConfirmDialog, Modal, ProgressBar, Spinner } from "../common";

/**
 * Whether the row's value text adds anything to its bar. A plain percentage
 * ("87.0% / 100%", "81% used") repeats the bar's own label; counts
 * ("212 / 300 requests") and values the bar cannot draw do not.
 */
export function limitHasDetail(limit: UsageLimit): boolean {
	const hasUnit = Boolean(limit.unit && limit.unit !== "unknown");
	if (!hasUnit) return limit.usedFraction === undefined;
	return !(limit.unit === "percent" && limit.limit === 100 && limit.used !== undefined);
}

const STATUS_KEYS: Record<string, string> = {
	exhausted: "usage.status.exhausted",
	warning: "usage.status.warning",
};

function resetCountdown(
	resetsAt: number | undefined,
	t: (k: string, p?: Record<string, string | number>) => string,
	now: number,
): string | null {
	if (!resetsAt) return null;
	const ms = resetsAt - now;
	if (ms <= 0) return t("usage.resetting");
	return t("usage.resetsIn", { time: formatDuration(ms) });
}

export function limitValueText(
	limit: UsageLimit,
	t: (k: string, p?: Record<string, string | number>) => string,
): string {
	const hasUnit = Boolean(limit.unit && limit.unit !== "unknown");
	if (!hasUnit && limit.usedFraction !== undefined) {
		return t("usage.valueUsed", { value: `${Number((limit.usedFraction * 100).toFixed(1))}%` });
	}
	const unit = limit.unit === "percent" ? "%" : hasUnit ? ` ${limit.unit}` : "";
	if (limit.used !== undefined && limit.limit !== undefined) {
		return `${limit.used.toFixed(limit.unit === "percent" ? 1 : 0)}${unit} / ${limit.limit.toFixed(0)}${unit}`;
	}
	if (limit.used !== undefined) return t("usage.valueUsed", { value: `${limit.used.toFixed(1)}${unit}` });
	if (limit.usedFraction !== undefined) return `${(limit.usedFraction * 100).toFixed(1)}%`;
	return t("usage.valueUnknown");
}

function LimitRow({
	limit,
	t,
	now,
}: {
	limit: UsageLimit;
	t: (k: string, p?: Record<string, string | number>) => string;
	now: number;
}) {
	const fraction = limit.usedFraction ?? (limit.used !== undefined && limit.limit ? limit.used / limit.limit : 0);
	return (
		<div className="flex flex-col gap-1 py-1.5">
			<div className="flex items-center justify-between gap-2">
				<span className="text-omp-md font-medium text-[var(--omp-text)]">{limit.label}</span>
				<div className="flex items-center gap-2">
					{limit.status && limit.status !== "ok" && (
						<Badge variant={limit.status === "exhausted" ? "error" : "warning"}>
							{STATUS_KEYS[limit.status] ? t(STATUS_KEYS[limit.status]) : limit.status}
						</Badge>
					)}
					{limitHasDetail(limit) && (
						<span className="font-mono text-omp-sm tabular-nums text-[var(--omp-muted)]">
							{limitValueText(limit, t)}
						</span>
					)}
				</div>
			</div>
			<ProgressBar value={fraction} height={5} valueText={quotaPercentText(fraction)} />
			{resetCountdown(limit.resetsAt, t, now) && (
				<span className="text-omp-xs text-[var(--omp-dim)]">{resetCountdown(limit.resetsAt, t, now)}</span>
			)}
			{limit.notes && limit.notes.length > 0 && (
				<div className="flex flex-col gap-0.5">
					{limit.notes.map(note => (
						<span key={note} className="text-omp-xs text-[var(--omp-dim)]">
							{note}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

function ProviderReportCard({
	report,
	providerName,
	t,
	now,
}: {
	report: UsageReport;
	providerName: string;
	t: (k: string, p?: Record<string, string | number>) => string;
	now: number;
}) {
	return (
		<div className="rounded-lg border border-[var(--omp-border-muted)] p-3">
			<div className="mb-2 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="text-omp-lg font-semibold text-[var(--omp-text)]">{providerName}</span>
					{report.account && <span className="text-omp-sm text-[var(--omp-muted)]">{report.account}</span>}
				</div>
				{report.resetCreditsAvailable !== undefined && report.resetCreditsAvailable > 0 && (
					<Badge variant="info">
						{t("usage.resetsAvailable", {
							count: report.resetCreditsAvailable,
							plural: report.resetCreditsAvailable === 1 ? "" : "s",
						})}
					</Badge>
				)}
			</div>
			{report.notes && report.notes.length > 0 && (
				<div className="mb-2 flex flex-col gap-0.5">
					{report.notes.map(note => (
						<span key={note} className="text-omp-xs text-[var(--omp-dim)]">
							{note}
						</span>
					))}
				</div>
			)}
			<div className="divide-y divide-[var(--omp-border-muted)]">
				{(Array.isArray(report.limits) ? report.limits : []).map(limit => (
					<LimitRow key={limit.id} limit={limit} t={t} now={now} />
				))}
			</div>
		</div>
	);
}

/** One redeemable-reset account row in the usage window's reset picker. */
function ResetCreditRow({
	account,
	t,
	now,
	busy,
	onRedeem,
}: {
	account: RpcResetCreditAccount;
	t: (k: string, p?: Record<string, string | number>) => string;
	now: number;
	busy: boolean;
	onRedeem: () => void;
}) {
	const expiresMs = account.expiresAt ? Date.parse(account.expiresAt) - now : Number.NaN;
	const expires = Number.isFinite(expiresMs) && expiresMs > 0 ? formatDuration(expiresMs) : null;
	const redeemable = account.redeemableCount > 0;
	return (
		<div className="flex items-center justify-between gap-2 py-1.5">
			<div className="flex min-w-0 flex-col">
				<span className="truncate text-omp-md font-medium text-[var(--omp-text)]">
					{account.providerLabel} · {account.label}
					{account.active && <Badge variant="muted">{t("usage.resetActive")}</Badge>}
				</span>
				<span className="text-omp-xs text-[var(--omp-dim)]">
					{account.unavailableReason ??
						account.error ??
						t("usage.resetCounts", { redeemable: account.redeemableCount, available: account.availableCount })}
					{expires ? ` · ${t("usage.resetExpires", { time: expires })}` : ""}
				</span>
			</div>
			<Button size="sm" variant="secondary" disabled={!redeemable || busy} loading={busy} onClick={onRedeem}>
				{t("usage.redeem")}
			</Button>
		</div>
	);
}

/** Project the local journal stats onto the tallies block. `history` covers the
 * whole journal (pre-compaction and sibling branches included), which is what
 * the usage window has always reported; without it the live-context figures are
 * the closest available. */
function sessionTallies(stats: SessionStats): UsageSessionStats {
	const history = stats.history;
	if (!history) {
		return {
			input: stats.tokens.input,
			output: stats.tokens.output,
			cacheRead: stats.tokens.cacheRead,
			cacheWrite: stats.tokens.cacheWrite,
			totalTokens: stats.tokens.total,
			orchestrationTokens: 0,
			premiumRequests: stats.premiumRequests,
			cost: stats.cost,
		};
	}
	return {
		input: history.input,
		output: history.output,
		cacheRead: history.cacheRead,
		cacheWrite: history.cacheWrite,
		totalTokens: history.totalTokens,
		orchestrationTokens: history.orchestrationInput + history.orchestrationOutput + history.orchestrationCacheRead,
		premiumRequests: history.premiumRequests,
		cost: history.cost,
	};
}

export function UsageWindow() {
	const tabRpc = useTabRpc();
	const tabId = useRuntimeTabId();
	const open = useUiStore(s => s.usageOpen);
	const close = useUiStore(s => s.closeUsage);
	const t = useT();
	const sidecarReady = useSessionStore(s => s.status) === "ready";
	const sessionId = useSessionStore(s => s.sessionId);
	const isStreaming = useSessionStore(s => s.isStreaming);
	const isCompacting = useSessionStore(s => s.isCompacting);
	const statsPulse = useSessionStore(s => s.statsPulse);
	const messageCount = useMessagesStore(s => s.messages.length);

	const [reports, setReports] = useState<UsageReport[] | null>(null);
	const [session, setSession] = useState<UsageSessionStats | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [resets, setResets] = useState<RpcResetCreditAccount[] | null>(null);
	const [resetsOpen, setResetsOpen] = useState(false);
	const [resetsLoading, setResetsLoading] = useState(false);
	const [redeemingKey, setRedeemingKey] = useState<string | null>(null);
	const [pendingRedeem, setPendingRedeem] = useState<RpcResetCreditAccount | null>(null);
	const now = useNowTick(open);
	const catalogProviders = useModelStore(s => s.providers);
	const refreshProviders = useModelStore(s => s.refreshProviders);
	// Reports name providers by id ("openai-codex"); the rest of the app shows names.
	const providerName = (id: string) => catalogProviders.find(provider => provider.id === id)?.name ?? id;

	/** The tab/session a quota read was issued for. A late response from a tab
	 * that is no longer frontmost must not overwrite the new tab's numbers. */
	const quotaOwnerRef = useRef<string | null>(null);

	const loadQuotas = useCallback(async () => {
		setLoading(true);
		setError(null);
		if (!sidecarReady) {
			setError(t("usage.notConnected"));
			setLoading(false);
			return;
		}
		const owner = `${tabId}/${sessionId}`;
		quotaOwnerRef.current = owner;
		const originSession = sessionRuntimeStore<SessionStore>(tabId, "session") ?? useSessionStore;
		try {
			const res = await tabRpc.getUsage();
			if (quotaOwnerRef.current !== owner || originSession.getState().sessionId !== sessionId) return;
			if (res.success) {
				const next = (res.data as { reports?: UsageReport[] })?.reports ?? [];
				setReports(next);
				publishQuotaReports(next);
			} else setError(describeError(res.error));
		} catch (cause) {
			if (quotaOwnerRef.current === owner) setError(describeError(cause));
		} finally {
			if (quotaOwnerRef.current === owner) setLoading(false);
		}
	}, [sidecarReady, t, tabId, sessionId, tabRpc.getUsage]);

	/** Banked usage resets across provider accounts (TUI /usage reset selector). */
	const loadResets = useCallback(async () => {
		if (!sidecarReady) return;
		setResetsLoading(true);
		try {
			const res = await tabRpc.command({ type: "list_reset_credits" });
			if (res.success) {
				setResets((res.data as { accounts?: RpcResetCreditAccount[] } | undefined)?.accounts ?? []);
			} else {
				toast({ variant: "error", title: t("usage.redeemReset"), message: res.error });
			}
		} catch (cause) {
			toast({ variant: "error", title: t("usage.redeemReset"), message: String(cause) });
		} finally {
			setResetsLoading(false);
		}
	}, [sidecarReady, tabRpc, t]);

	/** Spend one banked reset on an account, then re-read quotas and credits. */
	const redeemReset = useCallback(
		async (account: RpcResetCreditAccount) => {
			setPendingRedeem(null);
			setRedeemingKey(`${account.provider}:${account.target.credentialId}`);
			try {
				const res = await tabRpc.command({
					type: "redeem_reset_credit",
					target: account.target,
					label: account.label,
				});
				if (!res.success) {
					toast({ variant: "error", title: t("usage.redeemReset"), message: res.error });
					return;
				}
				const outcome = res.data as RpcResetCreditRedeemResult | undefined;
				toast({
					variant: outcome?.ok ? "success" : "warning",
					title: t("usage.redeemReset"),
					message: outcome?.message ?? "",
				});
				void loadQuotas();
				void loadResets();
			} catch (cause) {
				toast({ variant: "error", title: t("usage.redeemReset"), message: String(cause) });
			} finally {
				setRedeemingKey(null);
			}
		},
		[tabRpc, t, loadQuotas, loadResets],
	);

	// Quota reports carry resetCreditsAvailable; the picker opens only when some
	// provider actually banks resets, so the extra provider calls stay lazy.
	const resetsAvailable = (reports ?? []).some(report => (report.resetCreditsAvailable ?? 0) > 0);

	// The window is global UI state, so it survives tab switches. Anything from
	// the previous tab has to leave before the new tab's read lands.
	const shownOwnerRef = useRef<string | null>(null);
	useEffect(() => {
		const owner = `${tabId}/${sessionId}`;
		if (shownOwnerRef.current === owner) return;
		shownOwnerRef.current = owner;
		setReports(null);
		setSession(null);
		setError(null);
	}, [tabId, sessionId]);

	// Opening the window and moving to another tab behind it are the two moments
	// that need a fresh quota read; the refresh button covers the rest. `loadQuotas`
	// identity already tracks the tab, its session, and the sidecar being ready.
	useEffect(() => {
		if (!open) return;
		void loadQuotas();
	}, [open, loadQuotas]);

	// Without this a passed window kept its old bar and "resetting…" until the
	// user pressed Refresh. One re-read just after the earliest upcoming reset.
	const nextResetAt = useMemo(() => nextQuotaReset(reports, Date.now()), [reports]);
	useEffect(() => {
		if (!open || nextResetAt === undefined) return;
		const timer = setTimeout(() => void loadQuotas(), Math.max(0, nextResetAt - Date.now()) + QUOTA_RESET_GRACE_MS);
		return () => clearTimeout(timer);
	}, [open, nextResetAt, loadQuotas]);

	// Provider names come from the catalog, which may not be loaded yet if the
	// Providers window was never opened; a cache-aware read fills it.
	const catalogEmpty = catalogProviders.length === 0;
	useEffect(() => {
		if (open && sidecarReady && catalogEmpty) void refreshProviders().catch(() => {});
	}, [open, sidecarReady, catalogEmpty, refreshProviders]);
	const fetchedAt = (reports ?? []).reduce((latest, report) => Math.max(latest, report.fetchedAt ?? 0), 0);

	// A settled transcript append and a fresh sidecar snapshot both move the
	// session figures. Mid-run appends come several times a turn, so only the
	// pulse may re-queue a command there — the serial queue stays free for the
	// agent's own traffic.
	const statsTrigger = isStreaming ? `streaming:${statsPulse}` : `idle:${messageCount}:${statsPulse}`;

	// biome-ignore lint/correctness/useExhaustiveDependencies: statsTrigger paces the refetch; the transcript append and snapshot pulse move the figures even with a stable session id.
	useEffect(() => {
		if (!open || !sidecarReady || isCompacting) return;
		let cancelled = false;
		void tabRpc
			.getSessionStats()
			.then(res => {
				if (!cancelled && res.success) setSession(sessionTallies(res.data as SessionStats));
			})
			.catch(() => {
				/* the last good reading stays; the next pulse retries */
			});
		return () => {
			cancelled = true;
		};
	}, [open, sidecarReady, isCompacting, statsTrigger, tabRpc.getSessionStats]);

	const sessionRows = session
		? [
				{ icon: ArrowDownToLine, label: t("usage.inputTokens"), value: formatTokens(session.input) },
				{ icon: ArrowUpFromLine, label: t("usage.outputTokens"), value: formatTokens(session.output) },
				{ icon: Database, label: t("usage.cacheRead"), value: formatTokens(session.cacheRead) },
				{ icon: Database, label: t("usage.cacheWrite"), value: formatTokens(session.cacheWrite) },
				{ icon: Sigma, label: t("usage.totalTokens"), value: formatTokens(session.totalTokens) },
				...(session.orchestrationTokens > 0
					? [{ icon: Workflow, label: t("usage.orchestration"), value: formatTokens(session.orchestrationTokens) }]
					: []),
				// Premium requests only exist on multiplier-billed providers (Copilot);
				// a permanent "0" everywhere else reads as a broken counter.
				...(session.premiumRequests > 0
					? [{ icon: Sparkles, label: t("usage.premiumRequests"), value: String(session.premiumRequests) }]
					: []),
				{
					icon: Coins,
					label: t("usage.cost"),
					value: formatCost(session.cost, session.cost === 0 || session.cost >= 1 ? 2 : 4),
				},
			]
		: [];

	return (
		<>
			<Modal open={open} onClose={close} title={t("usage.title")} size="lg">
				<div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
					<div className="flex items-center justify-between">
						<span className="text-omp-sm font-semibold text-[var(--omp-muted)]">
							{t("usage.providerQuotas")}
							{fetchedAt > 0 && (
								<span className="ml-2 font-normal text-[var(--omp-dim)]">
									{t("usage.asOf", { time: formatClock(fetchedAt) })}
								</span>
							)}
						</span>
						<div className="flex items-center gap-1">
							{resetsAvailable && (
								<Button
									size="sm"
									variant={resetsOpen ? "secondary" : "ghost"}
									icon={<History size={12} />}
									onClick={() => {
										const next = !resetsOpen;
										setResetsOpen(next);
										if (next && resets === null) void loadResets();
									}}
									disabled={!sidecarReady}
								>
									{t("usage.redeemReset")}
								</Button>
							)}
							<Button
								size="sm"
								variant="ghost"
								icon={<RefreshCw size={12} />}
								onClick={() => void loadQuotas()}
								disabled={!sidecarReady}
								loading={loading}
								title={!sidecarReady ? t("usage.notConnected") : t("usage.refresh")}
							>
								{t("usage.refresh")}
							</Button>
						</div>
					</div>

					{resetsOpen && resetsAvailable && (
						<div className="rounded-lg border border-[var(--omp-border-muted)] px-3 py-1.5">
							{resetsLoading && resets === null ? (
								<div className="flex items-center justify-center py-3">
									<Spinner />
								</div>
							) : (resets ?? []).length === 0 ? (
								<span className="block py-2 text-center text-omp-md text-[var(--omp-dim)]">
									{t("usage.noResets")}
								</span>
							) : (
								<div className="divide-y divide-[var(--omp-border-muted)]">
									{(resets ?? []).map(account => {
										const key = `${account.provider}:${account.target.credentialId}`;
										return (
											<ResetCreditRow
												key={key}
												account={account}
												t={t}
												now={now}
												busy={redeemingKey === key}
												onRedeem={() => setPendingRedeem(account)}
											/>
										);
									})}
								</div>
							)}
						</div>
					)}

					{error && (
						<div className="rounded-md bg-[var(--omp-tool-error-bg)] px-3 py-2 text-omp-md text-[var(--omp-error)]">
							{error}
						</div>
					)}
					{loading && reports === null && (
						<div className="flex items-center justify-center py-8">
							<Spinner />
						</div>
					)}

					{reports && reports.length === 0 && !loading && (
						<div className="rounded-md border border-[var(--omp-border-muted)] px-3 py-4 text-center text-omp-md text-[var(--omp-dim)]">
							{t("usage.noApi")}
						</div>
					)}

					{reports && reports.length > 0 && (
						<div className="flex flex-col gap-3">
							{reports.map(report => (
								<ProviderReportCard
									key={`${report.provider}-${report.account ?? ""}`}
									report={report}
									providerName={providerName(report.provider)}
									t={t}
									now={now}
								/>
							))}
						</div>
					)}

					{session && (
						<>
							<span className="text-omp-sm font-semibold text-[var(--omp-muted)]">
								{t("usage.sessionTallies")}
							</span>
							<div className="grid grid-cols-2 gap-2">
								{sessionRows.map(({ icon: Icon, label, value }) => (
									<div
										key={label}
										className="flex items-center gap-2 rounded-md border border-[var(--omp-border-muted)] px-3 py-2"
									>
										<Icon size={13} className="text-[var(--omp-dim)]" />
										<span className="flex-1 text-omp-md text-[var(--omp-muted)]">{label}</span>
										<span className="font-mono text-omp-md font-medium tabular-nums text-[var(--omp-text)]">
											{value}
										</span>
									</div>
								))}
							</div>
						</>
					)}
				</div>
			</Modal>
			<ConfirmDialog
				open={pendingRedeem !== null}
				title={t("usage.redeemReset")}
				message={
					pendingRedeem
						? t("usage.redeemConfirm", { account: `${pendingRedeem.providerLabel} · ${pendingRedeem.label}` })
						: ""
				}
				confirmLabel={t("usage.redeem")}
				onCancel={() => setPendingRedeem(null)}
				onConfirm={() => {
					if (pendingRedeem) void redeemReset(pendingRedeem);
				}}
			/>
		</>
	);
}
