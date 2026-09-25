import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Session info panel: native rendering of rpc.getSessionStats() — identity,
 * message/tool counts, token breakdown, premium requests, cost, and context
 * window usage. Replaces the forwarded "/session info" text command.
 */

import { useCallback, useEffect, useState } from "react";
import type { SessionStats } from "../../../shared/rpc-types";
import { contextUsageView } from "../../lib/context-usage";
import { basename, formatCost, formatPercent, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { useUiStore } from "../../stores/ui";
import { AsyncSection, Modal, ProgressBar } from "../common";

interface Row {
	label: string;
	value: string;
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
	return (
		<section>
			<h3 className="mb-1 text-omp-xxs font-semibold tracking-widest text-(--omp-dim) uppercase">{title}</h3>
			<div className="overflow-hidden rounded-md border border-(--omp-border-muted)">
				{rows.map(row => (
					<div
						className="flex items-center gap-2 border-b border-(--omp-border-muted) px-2.5 py-1.5 last:border-b-0"
						key={row.label}
					>
						<span className="flex-1 text-omp-sm text-(--omp-muted)">{row.label}</span>
						<span className="font-mono text-omp-sm font-medium tabular-nums text-(--omp-text)">{row.value}</span>
					</div>
				))}
			</div>
		</section>
	);
}

function formatCredit(value: number): string {
	return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function SessionInfoDialog() {
	const tabRpc = useTabRpc();
	const t = useT();
	const sidecarReady = useSessionStore(state => state.status) === "ready";
	const open = useUiStore(state => state.sessionInfoOpen);
	const close = useUiStore(state => state.closeSessionInfo);

	const [stats, setStats] = useState<SessionStats | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		if (!sidecarReady) {
			setStats(null);
			setError(t("common.notConnected"));
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const response = await tabRpc.getSessionStats();
			if (response.success) setStats(response.data as SessionStats);
			else setError(response.error);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, [sidecarReady, t, tabRpc.getSessionStats]);

	useEffect(() => {
		if (!open) return;
		setStats(null);
		void reload();
	}, [open, reload]);

	const contextView = stats?.contextUsage ? contextUsageView(stats.contextUsage) : null;

	return (
		<Modal open={open} onClose={close} title={t("sessionInfo.title")} size="md">
			<AsyncSection
				className="py-8"
				error={error}
				hasData={stats !== null}
				loading={loading}
				loadingLabel={t("sessionInfo.loading")}
				onRetry={() => void reload()}
			>
				{stats && (
					<div className="flex flex-col gap-4">
						{stats.history && (
							<Section
								title={t("sessionInfo.history")}
								rows={[
									{ label: t("sessionInfo.total"), value: formatTokens(stats.history.totalTokens) },
									{ label: t("sessionInfo.cost"), value: formatCost(stats.history.cost) },
									{ label: t("sessionInfo.premiumRequests"), value: String(stats.history.premiumRequests) },
									{
										label: t("sessionInfo.sampledAt"),
										value: new Date(stats.history.sampledAt).toLocaleTimeString(),
									},
								]}
							/>
						)}
						<p className="text-omp-xs text-(--omp-dim)">{t("sessionInfo.scope")}</p>
						<Section
							title={t("sessionInfo.section.session")}
							rows={[
								{ label: t("sessionInfo.sessionId"), value: stats.sessionId },
								...(stats.sessionFile
									? [{ label: t("sessionInfo.file"), value: basename(stats.sessionFile) }]
									: []),
							]}
						/>
						<Section
							title={t("sessionInfo.section.messages")}
							rows={[
								{ label: t("sessionInfo.totalMessages"), value: String(stats.totalMessages) },
								{ label: t("sessionInfo.userTurns"), value: String(stats.userMessages) },
								{ label: t("sessionInfo.assistantTurns"), value: String(stats.assistantMessages) },
							]}
						/>
						<Section
							title={t("sessionInfo.section.tools")}
							rows={[
								{ label: t("sessionInfo.toolCalls"), value: String(stats.toolCalls) },
								{ label: t("sessionInfo.toolResults"), value: String(stats.toolResults) },
							]}
						/>
						<Section
							title={t("sessionInfo.section.tokens")}
							rows={[
								{ label: t("sessionInfo.input"), value: formatTokens(stats.tokens.input) },
								{ label: t("sessionInfo.output"), value: formatTokens(stats.tokens.output) },
								{ label: t("sessionInfo.reasoning"), value: formatTokens(stats.tokens.reasoning) },
								{ label: t("sessionInfo.cacheRead"), value: formatTokens(stats.tokens.cacheRead) },
								{ label: t("sessionInfo.cacheWrite"), value: formatTokens(stats.tokens.cacheWrite) },
								{ label: t("sessionInfo.total"), value: formatTokens(stats.tokens.total) },
							]}
						/>
						<Section
							title={t("sessionInfo.section.usage")}
							rows={[
								{ label: t("sessionInfo.premiumRequests"), value: String(stats.premiumRequests) },
								{ label: t("sessionInfo.cost"), value: formatCost(stats.cost) },
								...(stats.credits
									? [
											{ label: t("sessionInfo.credits"), value: formatCredit(stats.credits.cost) },
											{
												label: t("sessionInfo.committedCredits"),
												value: formatCredit(stats.credits.committedCost),
											},
											{ label: t("sessionInfo.committedAcu"), value: formatCredit(stats.credits.acuCost) },
										]
									: []),
							]}
						/>
						{stats.routedModels && Object.keys(stats.routedModels).length > 0 && (
							<Section
								title={t("sessionInfo.section.routedModels")}
								rows={Object.entries(stats.routedModels)
									.sort(([aId, aCount], [bId, bCount]) => bCount - aCount || aId.localeCompare(bId))
									.map(([id, count]) => ({ label: id, value: String(count) }))}
							/>
						)}
						{stats.contextUsage && contextView && (
							<section>
								<h3 className="mb-1 text-omp-xxs font-semibold tracking-widest text-(--omp-dim) uppercase">
									{t("sessionInfo.contextWindow")}
								</h3>
								<div className="rounded-md border border-(--omp-border-muted) px-2.5 py-2">
									<ProgressBar
										value={contextView.capacityKnown ? contextView.percent / 100 : 0}
										valueText={
											contextView.capacityKnown
												? formatPercent(contextView.percent, 1)
												: t("contextUsage.windowUnknown")
										}
									/>
									<div className="mt-1.5 flex items-center justify-between text-omp-xs text-(--omp-muted)">
										<span>
											{contextView.capacityKnown
												? `${formatTokens(contextView.usedTokens)} / ${formatTokens(contextView.contextWindow)}`
												: formatTokens(contextView.usedTokens)}{" "}
											{t("sessionInfo.tokens")}
										</span>
										<span className="font-mono tabular-nums">
											{contextView.capacityKnown
												? formatPercent(contextView.percent, 1)
												: formatTokens(null)}
										</span>
									</div>
								</div>
							</section>
						)}
					</div>
				)}
			</AsyncSection>
		</Modal>
	);
}
