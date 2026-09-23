/**
 * Providers: token-share pie chart, hourly burn histogram, and per-provider
 * aggregate table with usage-window insights.
 */

import { useEffect, useMemo } from "react";
import { Bar, Pie } from "react-chartjs-2";
import { baseChartOptions, CHART_COLORS, compact, formatUsd } from "../../lib/chart";
import "../../lib/chart";
import { useStats } from "../../hooks/use-stats";
import { useT } from "../../lib/i18n";
import type { StatsRange } from "./StatsDashboard";
import { ChartBox, RouteFrame, SectionTitle, type StatColumn, StatTable } from "./shared";

interface ProviderRow {
	provider: string;
	totalRequests: number;
	failedRequests: number;
	models: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	totalTokens: number;
	totalCost: number;
	avgTokensPerSecond: number | null;
}

interface HourlyPoint {
	provider: string;
	hour: number;
	totalTokens: number;
	outputTokens: number;
	requests: number;
}

interface WindowInsight {
	provider: string;
	windowKey: string;
	windowLabel: string;
	accounts: number;
	cycles: number;
	fractionConsumed: number;
	estTokensPerWindow: number | null;
	peakConcurrentFraction: number;
	idealAccounts: number;
	exhaustedEvents: number;
}

interface ProvidersData {
	providers: ProviderRow[];
	hourly: HourlyPoint[];
	series: unknown[];
	usageSeries: unknown[];
	windowInsights: WindowInsight[];
}

export function ProvidersRoute({ range, refreshKey }: { range: StatsRange; refreshKey: number }) {
	const t = useT();
	const params = useMemo(() => ({ range }), [range]);
	const { data, isLoading, error, refetch } = useStats<ProvidersData>("/api/stats/providers", params);

	useEffect(() => {
		if (refreshKey > 0) refetch();
	}, [refreshKey, refetch]);

	const stats = data;

	const columns: StatColumn<ProviderRow>[] = useMemo(
		() => [
			{
				key: "provider",
				label: t("stats.col.provider"),
				render: row => <span className="font-medium text-(--omp-text)">{row.provider}</span>,
			},
			{ key: "requests", label: t("stats.col.requests"), align: "right", render: row => compact(row.totalRequests) },
			{ key: "models", label: t("stats.models"), align: "right", render: row => row.models },
			{ key: "tokens", label: t("stats.col.tokens"), align: "right", render: row => compact(row.totalTokens) },
			{ key: "cost", label: t("stats.col.cost"), align: "right", render: row => formatUsd(row.totalCost) },
			{
				key: "speed",
				label: t("stats.col.tps"),
				align: "right",
				render: row => (row.avgTokensPerSecond !== null ? Math.round(row.avgTokensPerSecond) : "—"),
			},
		],
		[t],
	);

	const insightColumns: StatColumn<WindowInsight>[] = useMemo(
		() => [
			{
				key: "provider",
				label: t("stats.col.provider"),
				render: row => <span className="font-medium text-(--omp-text)">{row.provider}</span>,
			},
			{ key: "window", label: t("stats.providers.col.window"), render: row => row.windowLabel },
			{ key: "accounts", label: t("stats.providers.col.accounts"), align: "right", render: row => row.accounts },
			{ key: "cycles", label: t("stats.providers.col.resets"), align: "right", render: row => row.cycles },
			{
				key: "consumed",
				label: t("stats.providers.col.consumed"),
				align: "right",
				render: row => `${row.fractionConsumed.toFixed(2)}×`,
			},
			{
				key: "perWindow",
				label: t("stats.providers.col.perWindow"),
				align: "right",
				render: row => (row.estTokensPerWindow !== null ? compact(row.estTokensPerWindow) : "—"),
			},
			{ key: "ideal", label: t("stats.providers.col.ideal"), align: "right", render: row => row.idealAccounts },
			{
				key: "exhausted",
				label: t("stats.providers.col.exhausted"),
				align: "right",
				render: row =>
					row.exhaustedEvents > 0 ? <span className="text-(--omp-error)">{row.exhaustedEvents}</span> : "0",
			},
		],
		[t],
	);

	const providers = useMemo(
		() => [...(stats?.providers ?? [])].sort((a, b) => b.totalTokens - a.totalTokens),
		[stats],
	);
	const pie = useMemo(
		() => ({
			labels: providers.map(row => row.provider),
			datasets: [
				{
					data: providers.map(row => row.totalTokens),
					backgroundColor: providers.map((_, index) => `${CHART_COLORS[index % CHART_COLORS.length]}cc`),
					borderColor: "transparent",
					hoverOffset: 6,
				},
			],
		}),
		[providers],
	);

	const pieOptions = useMemo(() => {
		const base = baseChartOptions();
		return {
			maintainAspectRatio: false,
			responsive: true,
			plugins: {
				legend: { ...base.plugins.legend, position: "right" as const },
				tooltip: base.plugins.tooltip,
			},
		};
	}, []);

	const hourly = useMemo(() => {
		const hours = Array.from({ length: 24 }, (_, hour) => hour);
		const byProvider = new Map<string, number[]>();
		for (const point of stats?.hourly ?? []) {
			const series = byProvider.get(point.provider) ?? Array.from({ length: 24 }, () => 0);
			series[point.hour] += point.totalTokens;
			byProvider.set(point.provider, series);
		}
		const top = [...byProvider.entries()]
			.sort(([, a], [, b]) => b.reduce((sum, value) => sum + value, 0) - a.reduce((sum, value) => sum + value, 0))
			.slice(0, 4);
		return {
			labels: hours.map(hour => `${hour}`),
			datasets: top.map(([provider, series], index) => ({
				label: provider,
				data: series,
				backgroundColor: `${CHART_COLORS[index % CHART_COLORS.length]}88`,
				borderColor: CHART_COLORS[index % CHART_COLORS.length],
				borderWidth: 1,
			})),
		};
	}, [stats]);

	const hourlyOptions = useMemo(() => {
		const base = baseChartOptions();
		return {
			...base,
			scales: {
				...base.scales,
				x: { ...base.scales.x, stacked: true },
				y: {
					...base.scales.y,
					stacked: true,
					ticks: { ...base.scales.y.ticks, callback: (value: number | string) => compact(Number(value)) },
				},
			},
		};
	}, []);

	return (
		<RouteFrame
			hasData={data !== null}
			empty={providers.length === 0}
			error={error}
			loading={isLoading}
			onRetry={refetch}
		>
			<div className="grid gap-3 xl:grid-cols-2">
				<div>
					<SectionTitle>{t("stats.providers.tokenShare")}</SectionTitle>
					<ChartBox height={230}>
						<Pie data={pie} options={pieOptions} />
					</ChartBox>
				</div>
				<div>
					<SectionTitle>{t("stats.providers.peakBurn")}</SectionTitle>
					<ChartBox height={230}>
						<Bar data={hourly} options={hourlyOptions} />
					</ChartBox>
				</div>
			</div>
			<SectionTitle>{t("stats.providers")}</SectionTitle>
			<StatTable columns={columns} keyFor={row => row.provider} rows={providers} />
			{(stats?.windowInsights ?? []).length > 0 && (
				<>
					<SectionTitle>{t("stats.providers.windows")}</SectionTitle>
					<StatTable
						columns={insightColumns}
						keyFor={row => `${row.provider}/${row.windowKey}`}
						rows={stats?.windowInsights ?? []}
					/>
				</>
			)}
		</RouteFrame>
	);
}
