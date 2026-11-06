import { useEffect, useState } from "react";
import type { RpcContextReportResult } from "../../../shared/rpc-types";
import { useAutoCompactAt } from "../../hooks/use-compaction-config";
import { contextSegments, contextUsageView } from "../../lib/context-usage";
import { describeError } from "../../lib/errors";
import { formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useUiStore } from "../../stores/ui";
import { Modal, Spinner } from "../common";
import { ContextBreakdown } from "../layout/ContextBreakdown";

/**
 * Native /context: one stacked bar over the provider-anchored breakdown
 * returned by get_context_report, with a legend of each category's tokens and
 * share. With a known window the auto-compact buffer and free space complete
 * it — the TUI grid's invariant. Without one the legend shows the composition
 * of the used context and drops every percentage, since there is nothing to
 * divide by.
 */
export function ContextReportDialog() {
	const t = useT();
	const open = useUiStore(state => state.contextReportOpen);
	const close = useUiStore(state => state.closeContextReport);
	return (
		<Modal onClose={close} open={open} size="md" title={t("contextReport.title")}>
			<ContextReportBody />
		</Modal>
	);
}

/** Mounted only while the dialog is open, so the report and settings are read on demand. */
function ContextReportBody() {
	const tabRpc = useTabRpc();
	const t = useT();
	const [report, setReport] = useState<RpcContextReportResult | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const autoCompactAt = useAutoCompactAt(contextUsageView(report, report?.breakdown).contextWindow);

	useEffect(() => {
		let cancelled = false;
		void tabRpc
			.getContextReport()
			.then(response => {
				if (cancelled) return;
				if (response.success) setReport(response.data as RpcContextReportResult);
				else setError(describeError(response.error));
			})
			.catch(cause => {
				if (!cancelled) setError(describeError(cause));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [tabRpc.getContextReport]);

	if (loading) {
		return (
			<div className="flex items-center justify-center gap-2 py-8 text-sm text-(--omp-dim)">
				<Spinner size="sm" /> {t("contextReport.loading")}
			</div>
		);
	}
	if (error) {
		return (
			<div className="py-4 text-sm text-(--omp-error)">
				{t("contextReport.error")}: {error}
			</div>
		);
	}
	if (!report) return <div className="py-4 text-sm text-(--omp-dim)">{t("contextReport.unavailable")}</div>;

	const breakdown = report.breakdown;
	const view = contextUsageView(report, breakdown);
	const { capacityKnown, contextWindow, usedTokens } = view;

	return (
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
									percent: Math.round((usedTokens / contextWindow) * 100),
								})
							: t("contextReport.usedWithoutWindow", { used: formatTokens(usedTokens) })
						: capacityKnown
							? formatTokens(contextWindow)
							: t("contextReport.windowUnknown")}
				</div>
			</div>
			{breakdown ? (
				<>
					<ContextBreakdown barHeight={8} segments={contextSegments(breakdown, view, autoCompactAt)} view={view} />
					<div className="text-xs text-(--omp-dim)">
						{breakdown.anchored ? t("contextReport.anchored") : t("contextReport.estimated")}
					</div>
				</>
			) : null}
		</div>
	);
}
