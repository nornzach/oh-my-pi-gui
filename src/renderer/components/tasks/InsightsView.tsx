/**
 * Insights: how the tasks have been doing over a period — success and
 * verification rates, review outcomes, cost, a per-day outcome chart, cost
 * by task, and the latest failures. Computed in main from the run ledger.
 */

import { BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";
import type { InsightsDay, SchedulerInsights } from "../../../shared/scheduler-types";
import { describeProviderError } from "../../lib/errors";
import { cx, formatClock, formatCost, formatDuration, formatPercent } from "../../lib/format";
import { getFormattingLocale, useT } from "../../lib/i18n";
import { useSchedulerStore } from "../../stores/scheduler";
import { Spinner } from "../common";
import { EmptyState } from "./TasksView";
import { trimLeadingEmptyDays } from "./task-format";

const PERIODS = [7, 30, 90] as const;

const SERIES: { key: keyof Omit<InsightsDay, "day">; className: string }[] = [
	{ key: "succeeded", className: "bg-(--omp-success)" },
	{ key: "quiet", className: "bg-[color-mix(in_srgb,var(--omp-success)_45%,transparent)]" },
	{ key: "failed", className: "bg-(--omp-error)" },
	{ key: "skipped", className: "bg-(--omp-border-strong)" },
];

/**
 * One figure. Its label, value and detail rows are a subgrid of the KPI row,
 * so values stay level when a longer label (ru, zh) wraps in one card.
 */
function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
	return (
		<div className="omp-fade-up row-span-3 grid grid-rows-subgrid gap-0 rounded-xl border border-(--omp-border-muted) px-4 py-3">
			<p className="text-omp-sm text-(--omp-dim)">{label}</p>
			<p className="mt-1 self-end text-omp-xl font-semibold tabular-nums text-(--omp-text)">{value}</p>
			<p className="mt-0.5 text-omp-xs text-(--omp-dim) tabular-nums">{detail}</p>
		</div>
	);
}

/** A ledger day (`YYYY-MM-DD`) as "Oct 25" in the app's language. */
function dayLabel(day: string): string {
	return new Date(`${day}T00:00`).toLocaleDateString(getFormattingLocale(), {
		month: "short",
		day: "numeric",
	});
}

/**
 * Runs per day, stacked by outcome. Days before the first run are dropped
 * (see trimLeadingEmptyDays). `compact` is the task page's sparkline: the
 * whole period at a fixed day width, so tasks compare side by side, with no
 * scale, date axis or legend; each day's counts stay in its hover text.
 */
export function DayChart({ days: allDays, compact = false }: { days: InsightsDay[]; compact?: boolean }) {
	const t = useT();
	const days = compact ? allDays : trimLeadingEmptyDays(allDays);
	const max = Math.max(1, ...days.map(day => day.succeeded + day.quiet + day.failed + day.skipped));
	const labelEvery = days.length > 31 ? 14 : days.length > 10 ? 5 : 1;
	return (
		<div>
			{/* The scale: a hairline at the busiest day's height, labelled with its count. */}
			{!compact && (
				<div className="relative">
					<span className="absolute -top-4 right-0 text-omp-xxs text-(--omp-dim) tabular-nums">{max}</span>
					<div className="absolute inset-x-0 top-0 border-t border-dashed border-(--omp-border-muted)" />
				</div>
			)}
			<div
				className={cx("flex items-end", compact ? "h-10 gap-0.5" : "h-40 gap-[3px]")}
				role="img"
				aria-label={t("tasks.insights.chartLabel")}
			>
				{days.map((day, index) => {
					const total = day.succeeded + day.quiet + day.failed + day.skipped;
					return (
						<div
							className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
							key={day.day}
							title={t("tasks.insights.dayTooltip", {
								day: dayLabel(day.day),
								succeeded: day.succeeded,
								quiet: day.quiet,
								failed: day.failed,
								skipped: day.skipped,
							})}
						>
							<div
								className="omp-insights-bar mx-auto flex w-full max-w-9 flex-col-reverse overflow-hidden rounded-[3px] transition-[filter] duration-150 group-hover:brightness-110"
								style={{ height: `${(total / max) * 100}%`, animationDelay: `${Math.min(index, 30) * 12}ms` }}
							>
								{SERIES.map(series =>
									day[series.key] > 0 ? (
										<div
											className={series.className}
											key={series.key}
											style={{ height: `${(day[series.key] / total) * 100}%` }}
										/>
									) : null,
								)}
							</div>
							{total === 0 && <div className="mx-auto h-px w-full max-w-9 bg-(--omp-border-muted)" />}
						</div>
					);
				})}
			</div>
			{!compact && (
				<>
					<div className="mt-1.5 flex gap-[3px] text-omp-xxs text-(--omp-dim) tabular-nums">
						{days.map((day, index) => (
							<span className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap" key={day.day}>
								{index % labelEvery === 0 ? dayLabel(day.day) : ""}
							</span>
						))}
					</div>
					<div className="mt-3 flex flex-wrap gap-4">
						{SERIES.map(series => (
							<span className="flex items-center gap-1.5 text-omp-sm text-(--omp-muted)" key={series.key}>
								<span className={cx("size-2 rounded-[2px]", series.className)} />
								{t(`tasks.insights.series.${series.key}`)}
							</span>
						))}
					</div>
				</>
			)}
		</div>
	);
}

export function InsightsView() {
	const t = useT();
	const snapshot = useSchedulerStore(state => state.snapshot);
	const openTasks = useSchedulerStore(state => state.openTasks);
	const [period, setPeriod] = useState<(typeof PERIODS)[number]>(30);
	const [insights, setInsights] = useState<SchedulerInsights | null>(null);
	const runCount = snapshot?.runs.length ?? 0;

	// biome-ignore lint/correctness/useExhaustiveDependencies: the newest run's id and state pace the refetch, so a landing run updates the figures.
	useEffect(() => {
		let live = true;
		window.omp.scheduler.insights(period).then(
			result => live && setInsights(result),
			() => {},
		);
		return () => {
			live = false;
		};
	}, [period, runCount, snapshot?.runs[0]?.id, snapshot?.runs[0]?.state]);

	if (!insights) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner />
			</div>
		);
	}
	if (insights.runs === 0 && runCount === 0) {
		return (
			<EmptyState
				body={t("tasks.insights.emptyBody")}
				icon={<BarChart3 size={20} />}
				title={t("tasks.insights.emptyTitle")}
			/>
		);
	}
	const rate = (value: number | null) => (value === null ? "—" : formatPercent(value * 100, 0));
	const maxCost = Math.max(0.0001, ...insights.costByTask.map(entry => entry.costUsd));
	const charted = trimLeadingEmptyDays(insights.perDay);

	return (
		<div className="h-full overflow-y-auto px-6 py-5">
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				<div className="flex items-center justify-between">
					<h2 className="text-omp-lg font-semibold text-(--omp-text)">
						{t("tasks.insights.title", { days: period })}
					</h2>
					<div className="inline-flex rounded-lg border border-(--omp-border-muted) p-0.5">
						{PERIODS.map(days => (
							<button
								className={cx(
									"rounded-md px-3 py-1 text-omp-md font-medium tabular-nums transition-colors duration-150",
									period === days
										? "bg-(--omp-selected-bg) text-(--omp-text)"
										: "text-(--omp-muted) hover:text-(--omp-text)",
								)}
								key={days}
								onClick={() => setPeriod(days)}
								type="button"
							>
								{t("tasks.insights.days", { count: days })}
							</button>
						))}
					</div>
				</div>
				<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
					<Kpi
						label={t("tasks.insights.runs")}
						value={String(insights.runs)}
						detail={t("tasks.insights.failedCount", { count: insights.failed })}
					/>
					<Kpi label={t("tasks.insights.successRate")} value={rate(insights.successRate)} />
					<Kpi label={t("tasks.insights.verifyRate")} value={rate(insights.verificationPassRate)} />
					<Kpi label={t("tasks.insights.acceptRate")} value={rate(insights.reviewAcceptRate)} />
					<Kpi label={t("tasks.insights.cost")} value={formatCost(insights.costUsd, 2)} />
					<Kpi
						label={t("tasks.insights.medianDuration")}
						value={insights.medianDurationMs === null ? "—" : formatDuration(insights.medianDurationMs)}
					/>
				</div>
				<section className="rounded-xl border border-(--omp-border-muted) px-4 py-4">
					<h3 className="mb-3 flex items-baseline gap-2 text-omp-sm font-semibold tracking-wide text-(--omp-muted) uppercase">
						{t("tasks.insights.perDay")}
						{charted.length < insights.perDay.length && (
							<span className="font-normal tracking-normal text-(--omp-dim) normal-case">
								{t("tasks.insights.since", { day: dayLabel(charted[0].day) })}
							</span>
						)}
					</h3>
					<DayChart days={insights.perDay} />
				</section>
				<div className="grid gap-4 lg:grid-cols-2">
					<section className="rounded-xl border border-(--omp-border-muted) px-4 py-4">
						<h3 className="mb-3 text-omp-sm font-semibold tracking-wide text-(--omp-muted) uppercase">
							{t("tasks.insights.costByTask")}
						</h3>
						{insights.costByTask.length === 0 ? (
							<p className="text-omp-md text-(--omp-dim)">{t("tasks.insights.noCost")}</p>
						) : (
							<ul className="flex flex-col gap-2.5">
								{insights.costByTask.map(entry => (
									<li key={entry.taskId}>
										<div className="flex items-baseline justify-between gap-3 text-omp-md">
											<button
												className="min-w-0 truncate text-left text-(--omp-text) hover:underline"
												onClick={() => openTasks({ view: "tasks", taskId: entry.taskId })}
												type="button"
											>
												{entry.title}
											</button>
											<span className="shrink-0 tabular-nums text-(--omp-muted)">
												{formatCost(entry.costUsd, 2)} ·{" "}
												{t("tasks.insights.runsCount", { count: entry.runs })}
											</span>
										</div>
										<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-(--omp-border-muted)">
											<div
												className="omp-insights-meter h-full rounded-full bg-(--omp-accent)"
												style={{ width: `${(entry.costUsd / maxCost) * 100}%` }}
											/>
										</div>
									</li>
								))}
							</ul>
						)}
					</section>
					<section className="rounded-xl border border-(--omp-border-muted) px-4 py-4">
						<h3 className="mb-3 text-omp-sm font-semibold tracking-wide text-(--omp-muted) uppercase">
							{t("tasks.insights.recentFailures")}
						</h3>
						{insights.recentFailures.length === 0 ? (
							<p className="text-omp-md text-(--omp-dim)">{t("tasks.insights.noFailures")}</p>
						) : (
							<ul className="flex flex-col gap-1">
								{insights.recentFailures.map(run => (
									<li key={run.id}>
										<button
											className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-(--omp-selected-bg)"
											onClick={() => openTasks({ view: "runs", runId: run.id, taskId: run.taskId })}
											type="button"
										>
											<span className="shrink-0 text-omp-sm tabular-nums text-(--omp-dim)">
												{formatClock(run.startedAt ?? run.createdAt)}
											</span>
											<span className="min-w-0 flex-1 truncate text-omp-md text-(--omp-text)">
												{snapshot?.tasks.find(task => task.id === run.taskId)?.title ?? run.taskId}
											</span>
											<span
												className="max-w-[45%] shrink-0 truncate text-omp-sm text-(--omp-error)"
												title={run.error?.message}
											>
												{run.error
													? describeProviderError(run.error.message)
													: t(`tasks.run.state.${run.state}`)}
											</span>
										</button>
									</li>
								))}
							</ul>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}
