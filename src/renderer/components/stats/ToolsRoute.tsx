/**
 * Tools: ranked usage table with error rate and attributed cost, plus a
 * top-tools call-volume bar chart.
 */

import { useEffect, useMemo } from "react";
import { Bar } from "react-chartjs-2";
import { baseChartOptions, CHART_COLORS, compact, formatUsd } from "../../lib/chart";
import "../../lib/chart";
import { useStats } from "../../hooks/use-stats";
import { useT } from "../../lib/i18n";
import { Badge } from "../common";
import type { StatsRange } from "./StatsDashboard";
import { ChartBox, RouteFrame, SectionTitle, type StatColumn, StatTable } from "./shared";

interface ToolRow {
	tool: string;
	calls: number;
	errors: number;
	argsChars: number;
	resultChars: number;
	totalTokensShare: number;
	outputTokensShare: number;
	costShare: number;
	lastUsed: number;
}

interface ToolsData {
	byTool: ToolRow[];
	byToolModel: unknown[];
	series: { timestamp: number; tool: string; calls: number; errors: number }[];
}

export function ToolsRoute({ range, refreshKey }: { range: StatsRange; refreshKey: number }) {
	const t = useT();
	const params = useMemo(() => ({ range }), [range]);
	const { data, isLoading, error, refetch } = useStats<ToolsData>("/api/stats/tools", params);

	useEffect(() => {
		if (refreshKey > 0) refetch();
	}, [refreshKey, refetch]);

	const stats = data;

	const columns: StatColumn<ToolRow>[] = useMemo(
		() => [
			{
				key: "tool",
				label: t("stats.tools.col.tool"),
				render: row => <span className="font-mono font-medium text-(--omp-text)">{row.tool}</span>,
			},
			{ key: "calls", label: t("stats.tools.col.calls"), align: "right", render: row => compact(row.calls) },
			{
				key: "errors",
				label: t("stats.col.errors"),
				align: "right",
				render: row =>
					row.errors > 0 ? (
						<Badge variant="error">{compact(row.errors)}</Badge>
					) : (
						<span className="text-(--omp-dim)">0</span>
					),
			},
			{ key: "args", label: t("stats.tools.col.args"), align: "right", render: row => compact(row.argsChars) },
			{ key: "result", label: t("stats.tools.col.result"), align: "right", render: row => compact(row.resultChars) },
			{
				key: "tokens",
				label: t("stats.tools.col.tokensShare"),
				align: "right",
				render: row => compact(row.totalTokensShare),
			},
			{
				key: "cost",
				label: t("stats.tools.col.costShare"),
				align: "right",
				render: row => formatUsd(row.costShare),
			},
			{
				key: "last",
				label: t("stats.tools.col.last"),
				align: "right",
				render: row =>
					row.lastUsed > 0
						? new Date(row.lastUsed).toLocaleString(undefined, {
								month: "short",
								day: "numeric",
								hour: "2-digit",
								minute: "2-digit",
							})
						: t("stats.tools.never"),
			},
		],
		[t],
	);

	const byTool = useMemo(() => [...(stats?.byTool ?? [])].sort((a, b) => b.calls - a.calls), [stats]);
	const barChart = useMemo(() => {
		const top = byTool.slice(0, 12);
		return {
			labels: top.map(row => row.tool),
			datasets: [
				{
					label: t("stats.tools.col.calls"),
					data: top.map(row => row.calls),
					backgroundColor: top.map((_, index) => `${CHART_COLORS[index % CHART_COLORS.length]}99`),
					borderColor: top.map((_, index) => CHART_COLORS[index % CHART_COLORS.length]),
					borderWidth: 1,
				},
			],
		};
	}, [byTool, t]);

	const barOptions = useMemo(() => {
		const base = baseChartOptions();
		return {
			...base,
			indexAxis: "y" as const,
			plugins: { ...base.plugins, legend: { display: false } },
			scales: {
				x: { ...base.scales.x },
				y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, font: { size: 9, family: "monospace" } } },
			},
		};
	}, []);

	return (
		<RouteFrame
			hasData={data !== null}
			empty={byTool.length === 0}
			error={error}
			loading={isLoading}
			onRetry={refetch}
		>
			<SectionTitle>{t("stats.tools.callVolume")}</SectionTitle>
			<ChartBox height={Math.max(180, byTool.slice(0, 12).length * 26)}>
				<Bar data={barChart} options={barOptions} />
			</ChartBox>
			<SectionTitle>{t("stats.tools.allTools")}</SectionTitle>
			<StatTable columns={columns} keyFor={row => row.tool} rows={byTool} />
		</RouteFrame>
	);
}
