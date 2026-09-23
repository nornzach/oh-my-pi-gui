/**
 * Gain: token savings from compaction — totals, per-source breakdown,
 * daily savings chart, and project filter.
 */

import { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import { baseChartOptions, chartTheme, compact } from "../../lib/chart";
import "../../lib/chart";
import { useStats } from "../../hooks/use-stats";
import { formatPercent } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { StatsRange } from "./StatsDashboard";
import { ChartBox, MetricCard, RouteFrame, SectionTitle } from "./shared";

interface SourceTotals {
	savedTokens: number;
	savedBytes: number;
	hits: number;
	outputBytes: number;
	originalBytes: number;
	reductionPercent: number | null;
}

interface GainPoint {
	date: string;
	snapcompact: number;
	total: number;
}

interface GainData {
	overall: SourceTotals;
	bySource: Record<string, SourceTotals>;
	timeSeries: GainPoint[];
	project: string | null;
	projects: string[];
}

export function GainRoute({ range, refreshKey }: { range: StatsRange; refreshKey: number }) {
	const t = useT();
	const [project, setProject] = useState<string>("");
	const params = useMemo<Record<string, string>>(() => {
		const next: Record<string, string> = { range };
		if (project) next.project = project;
		return next;
	}, [range, project]);
	const { data, isLoading, error, refetch } = useStats<GainData>("/api/stats/gain", params);

	useEffect(() => {
		if (refreshKey > 0) refetch();
	}, [refreshKey, refetch]);

	const stats = data;
	const overall = stats?.overall;
	const sourceEntries = Object.entries(stats?.bySource ?? {}).filter(([, totals]) => totals.hits > 0);
	const theme = chartTheme();

	const chart = useMemo(() => {
		const series = stats?.timeSeries ?? [];
		return {
			labels: series.map(point => point.date),
			datasets: [
				{
					label: t("stats.gain.tokensSaved"),
					data: series.map(point => point.total),
					backgroundColor: `${theme.accent}88`,
					borderColor: theme.accent,
					borderWidth: 1,
				},
			],
		};
	}, [stats, theme.accent, t]);

	const barOptions = useMemo(() => {
		const base = baseChartOptions();
		return {
			...base,
			plugins: { ...base.plugins, legend: { display: false } },
			scales: {
				...base.scales,
				y: {
					...base.scales.y,
					ticks: { ...base.scales.y.ticks, callback: (value: number | string) => compact(Number(value)) },
				},
			},
		};
	}, []);

	return (
		<RouteFrame
			hasData={data !== null}
			empty={!overall || overall.savedTokens === 0}
			error={error}
			loading={isLoading}
			onRetry={refetch}
		>
			{overall && (
				<>
					<div className="mb-3 flex items-center gap-2">
						<label
							className="text-omp-xs font-semibold tracking-widest text-(--omp-dim) uppercase"
							htmlFor="gain-project"
						>
							{t("stats.col.project")}
						</label>
						<select
							className="rounded-md border border-(--omp-border-muted) bg-(--omp-input-bg) px-2 py-1 text-omp-sm text-(--omp-text) focus:border-(--omp-border-accent) focus:outline-none"
							id="gain-project"
							onChange={event => setProject(event.target.value)}
							value={project}
						>
							<option value="">{t("stats.gain.allProjects")}</option>
							{(stats?.projects ?? []).map(name => (
								<option key={name} value={name}>
									{name}
								</option>
							))}
						</select>
					</div>
					<div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
						<MetricCard label={t("stats.gain.tokensSaved")} tone="success" value={compact(overall.savedTokens)} />
						<MetricCard label={t("stats.gain.compactions")} value={compact(overall.hits)} />
						<MetricCard label={t("stats.gain.reduction")} value={formatPercent(overall.reductionPercent, 0)} />
						<MetricCard label={t("stats.gain.bytesSaved")} value={compact(overall.savedBytes)} />
					</div>
					<SectionTitle>{t("stats.gain.daily")}</SectionTitle>
					<ChartBox height={260}>
						<Bar data={chart} options={barOptions} />
					</ChartBox>
					{sourceEntries.length > 0 && <SectionTitle>{t("stats.gain.bySource")}</SectionTitle>}
					{sourceEntries.map(([source, totals]) => (
						<div
							className="mb-1.5 flex items-center gap-3 rounded-md border border-(--omp-border-muted) bg-transparent px-3 py-2 text-omp-sm"
							key={source}
						>
							<span className="font-mono font-medium text-(--omp-text)">{source}</span>
							<span className="text-(--omp-muted)">
								{t("stats.gain.tokens", { count: compact(totals.savedTokens) })}
							</span>
							<span className="text-(--omp-dim)">{t("stats.gain.hits", { count: totals.hits })}</span>
							{totals.reductionPercent != null && Number.isFinite(totals.reductionPercent) && (
								<span className="ml-auto text-(--omp-success)">
									−{formatPercent(totals.reductionPercent, 0)}
								</span>
							)}
						</div>
					))}
				</>
			)}
		</RouteFrame>
	);
}
