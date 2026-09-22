/**
 * Projects: per-folder usage breakdown with share bars.
 */

import { useEffect, useMemo } from "react";
import { useStatsList } from "../../hooks/use-stats";
import { compact, formatUsd } from "../../lib/chart";
import { useT } from "../../lib/i18n";
import type { StatsRange } from "./StatsDashboard";
import { RouteFrame, SectionTitle, type StatColumn, StatTable } from "./shared";

interface FolderRow {
	folder: string;
	totalRequests: number;
	failedRequests: number;
	errorRate: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	totalCost: number;
	avgDuration: number | null;
	avgTokensPerSecond: number | null;
}

function ShareBar({ fraction }: { fraction: number }) {
	return (
		<span className="flex w-24 items-center gap-1.5">
			<span
				className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--omp-bg-tertiary)" /* surface-ok: progress bar track */
			>
				<span
					className="block h-full rounded-full bg-(--omp-accent)"
					style={{ width: `${Math.min(100, fraction * 100)}%` }}
				/>
			</span>
			<span className="w-8 text-right text-omp-xs tabular-nums text-(--omp-dim)">
				{(fraction * 100).toFixed(0)}%
			</span>
		</span>
	);
}

export function ProjectsRoute({ range, refreshKey }: { range: StatsRange; refreshKey: number }) {
	const t = useT();
	const params = useMemo(() => ({ range }), [range]);
	const { data, isLoading, error, refetch } = useStatsList<FolderRow>("/api/stats/folders", params);

	useEffect(() => {
		if (refreshKey > 0) refetch();
	}, [refreshKey, refetch]);

	const rows = useMemo(() => {
		const list = data ?? [];
		return [...list].sort((a, b) => b.totalCost - a.totalCost);
	}, [data]);

	const totalCost = rows.reduce((sum, row) => sum + row.totalCost, 0);

	const columns: StatColumn<FolderRow>[] = useMemo(
		() => [
			{
				key: "folder",
				label: t("stats.col.project"),
				render: row => (
					<span className="font-mono text-(--omp-text)">{row.folder || t("stats.projects.unknown")}</span>
				),
			},
			{ key: "requests", label: t("stats.col.requests"), align: "right", render: row => compact(row.totalRequests) },
			{
				key: "tokens",
				label: t("stats.col.tokens"),
				align: "right",
				render: row =>
					compact(
						row.totalInputTokens + row.totalOutputTokens + row.totalCacheReadTokens + row.totalCacheWriteTokens,
					),
			},
			{ key: "cost", label: t("stats.col.cost"), align: "right", render: row => formatUsd(row.totalCost) },
			{
				key: "share",
				label: t("stats.projects.col.share"),
				render: row => <ShareBar fraction={totalCost > 0 ? row.totalCost / totalCost : 0} />,
			},
			{
				key: "speed",
				label: t("stats.col.tps"),
				align: "right",
				render: row => (row.avgTokensPerSecond !== null ? Math.round(row.avgTokensPerSecond) : "—"),
			},
		],
		[totalCost, t],
	);

	return (
		<RouteFrame hasData={data !== null} empty={rows.length === 0} error={error} loading={isLoading} onRetry={refetch}>
			<SectionTitle>{t("stats.projects.sectionTitle", { count: rows.length })}</SectionTitle>
			<StatTable columns={columns} keyFor={row => row.folder} rows={rows} />
		</RouteFrame>
	);
}
