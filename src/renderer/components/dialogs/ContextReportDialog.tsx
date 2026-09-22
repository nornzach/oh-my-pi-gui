import { useEffect, useState } from "react";
import type { RpcContextReportResult } from "../../../shared/rpc-types";
import { contextUsageView } from "../../lib/context-usage";
import { formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useUiStore } from "../../stores/ui";
import { Modal, ProgressBar, Spinner } from "../common";

interface CategoryRow {
	key: string;
	tokens: number;
	color: string;
}

/**
 * Native /context: per-category token bars over the provider-anchored
 * breakdown returned by get_context_report. With a known window the bars are
 * sized against it so their sum (plus Free) fills it — the TUI grid's
 * invariant. Without one they show the composition of the used context and
 * drop every percentage, since there is nothing to divide by.
 */
export function ContextReportDialog() {
	const tabRpc = useTabRpc();
	const t = useT();
	const open = useUiStore(state => state.contextReportOpen);
	const close = useUiStore(state => state.closeContextReport);
	const [report, setReport] = useState<RpcContextReportResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setReport(null);
		setError(null);
		setLoading(true);
		void tabRpc
			.getContextReport()
			.then(response => {
				if (cancelled) return;
				if (response.success) setReport(response.data as RpcContextReportResult);
				else setError(response.error);
			})
			.catch(cause => {
				if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open, tabRpc.getContextReport]);

	const breakdown = report?.breakdown;
	const { capacityKnown, contextWindow, usedTokens } = contextUsageView(report, breakdown);
	const categories: CategoryRow[] = [];
	if (breakdown) {
		const rows: CategoryRow[] = [
			{
				key: "systemPrompt",
				tokens: breakdown.systemPromptTokens,
				color: "var(--omp-accent)",
			},
			{
				key: "systemContext",
				tokens: breakdown.systemContextTokens,
				color: "var(--omp-dim)",
			},
			{
				key: "systemTools",
				tokens: breakdown.systemToolsTokens,
				color: "var(--omp-warning)",
			},
			{ key: "skills", tokens: breakdown.skillsTokens, color: "var(--omp-success)" },
			{ key: "messages", tokens: breakdown.messagesTokens, color: "var(--omp-link)" },
		];
		for (const row of rows) {
			if (row.tokens > 0) categories.push(row);
		}
		if (capacityKnown) {
			const free = contextWindow - usedTokens;
			if (free > 0) categories.push({ key: "free", tokens: free, color: "var(--omp-muted)" });
		}
	}
	const usedPercent = capacityKnown ? Math.round((usedTokens / contextWindow) * 100) : 0;
	// Without a capacity the bars describe what the used context is made of
	// rather than how full it is; one denominator keeps both readings honest.
	const barDenominator = Math.max(1, capacityKnown ? contextWindow : usedTokens);

	return (
		<Modal onClose={close} open={open} size="md" title={t("contextReport.title")}>
			{loading ? (
				<div className="flex items-center justify-center gap-2 py-8 text-sm text-(--omp-dim)">
					<Spinner size="sm" /> {t("contextReport.loading")}
				</div>
			) : error ? (
				<div className="py-4 text-sm text-(--omp-error)">
					{t("contextReport.error")}: {error}
				</div>
			) : !report ? (
				<div className="py-4 text-sm text-(--omp-dim)">{t("contextReport.unavailable")}</div>
			) : (
				<div className="space-y-4">
					<div className="flex items-baseline justify-between gap-3">
						<div className="min-w-0 truncate text-sm font-medium text-(--omp-text)">
							{report.model || t("contextReport.noModel")}
						</div>
						<div className="shrink-0 text-xs tabular-nums text-(--omp-dim)">
							{breakdown
								? capacityKnown
									? t("contextReport.usedOf", {
											used: formatTokens(usedTokens),
											window: formatTokens(contextWindow),
											percent: usedPercent,
										})
									: t("contextReport.usedWithoutWindow", { used: formatTokens(usedTokens) })
								: capacityKnown
									? formatTokens(contextWindow)
									: t("contextReport.windowUnknown")}
						</div>
					</div>
					{breakdown ? (
						<>
							<div className="space-y-2">
								{categories.map(row => {
									const fraction = row.tokens / barDenominator;
									return (
										<div className="flex items-center gap-3" key={row.key}>
											<span className="w-28 shrink-0 truncate text-xs text-(--omp-text)">
												{t(`contextReport.cat.${row.key}`)}
											</span>
											<ProgressBar
												className="flex-1"
												color={row.color}
												height={8}
												value={fraction}
												valueText={
													capacityKnown
														? `${formatTokens(row.tokens)} · ${Math.round(fraction * 100)}%`
														: formatTokens(row.tokens)
												}
											/>
										</div>
									);
								})}
							</div>
							<div className="text-xs text-(--omp-dim)">
								{breakdown.anchored ? t("contextReport.anchored") : t("contextReport.estimated")}
							</div>
						</>
					) : null}
				</div>
			)}
		</Modal>
	);
}
