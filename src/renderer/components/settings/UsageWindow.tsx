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

import { Coins, Database, RefreshCw, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionStats, UsageLimit, UsageReport, UsageSessionStats } from "../../../shared/rpc-types";
import { formatCost, formatDuration, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useNowTick } from "../../lib/now-tick";
import { useMessagesStore } from "../../stores/messages";
import { type SessionStore, useSessionStore } from "../../stores/session";
import { sessionRuntimeStore, useRuntimeTabId } from "../../stores/session-runtime-context";
import { useUiStore } from "../../stores/ui";
import { Badge, Button, Modal, ProgressBar, Spinner } from "../common";

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
						<Badge variant={limit.status === "exhausted" ? "error" : "warning"}>{limit.status}</Badge>
					)}
					<span className="font-mono text-omp-sm tabular-nums text-[var(--omp-muted)]">
						{limitValueText(limit, t)}
					</span>
				</div>
			</div>
			<ProgressBar value={fraction} height={5} valueText={`${Math.round(fraction * 100)}%`} />
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
	t,
	now,
}: {
	report: UsageReport;
	t: (k: string, p?: Record<string, string | number>) => string;
	now: number;
}) {
	return (
		<div className="rounded-lg border border-[var(--omp-border-muted)] p-3">
			<div className="mb-2 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="text-omp-lg font-semibold text-[var(--omp-text)]">{report.provider}</span>
					{report.account && <span className="text-omp-sm text-[var(--omp-muted)]">{report.account}</span>}
				</div>
				{report.resetCreditsAvailable !== undefined && report.resetCreditsAvailable > 0 && (
					<Badge variant="info">{t("usage.resetsAvailable", { count: report.resetCreditsAvailable })}</Badge>
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
	const now = useNowTick(open);

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
			if (res.success) setReports((res.data as { reports?: UsageReport[] })?.reports ?? []);
			else setError(res.error);
		} catch (cause) {
			if (quotaOwnerRef.current === owner) setError(String(cause));
		} finally {
			if (quotaOwnerRef.current === owner) setLoading(false);
		}
	}, [sidecarReady, t, tabId, sessionId, tabRpc.getUsage]);

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
				{ icon: Zap, label: t("usage.inputTokens"), value: formatTokens(session.input) },
				{ icon: Database, label: t("usage.outputTokens"), value: formatTokens(session.output) },
				{ icon: Database, label: t("usage.cacheRead"), value: formatTokens(session.cacheRead) },
				{ icon: Database, label: t("usage.cacheWrite"), value: formatTokens(session.cacheWrite) },
				{ icon: Coins, label: t("usage.totalTokens"), value: formatTokens(session.totalTokens) },
				...(session.orchestrationTokens > 0
					? [{ icon: Zap, label: t("usage.orchestration"), value: formatTokens(session.orchestrationTokens) }]
					: []),
				{ icon: Coins, label: t("usage.premiumRequests"), value: String(session.premiumRequests) },
				{ icon: Coins, label: t("usage.cost"), value: formatCost(session.cost, 6) },
			]
		: [];

	return (
		<Modal open={open} onClose={close} title={t("usage.title")} size="lg">
			<div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
				<div className="flex items-center justify-between">
					<span className="text-omp-sm font-semibold uppercase tracking-wider text-[var(--omp-muted)]">
						{t("usage.providerQuotas")}
					</span>
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
								t={t}
								now={now}
							/>
						))}
					</div>
				)}

				{session && (
					<>
						<span className="text-omp-sm font-semibold uppercase tracking-wider text-[var(--omp-muted)]">
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
	);
}
