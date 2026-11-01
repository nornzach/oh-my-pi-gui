import { CornerDownRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { RpcAsyncJobItem, RpcJobsResult, RpcJobTreeRow } from "../../../shared/rpc-types";
import { AnsiText } from "../../lib/ansi";
import { cx, formatClock, formatDuration } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { PREVIEW_SCROLL_LG } from "../../lib/preview";
import { useTabRpc } from "../../lib/tab-rpc";
import { useUiStore } from "../../stores/ui";
import { Badge, Modal, Spinner } from "../common";
import { JobWidgetCard } from "./JobWidgetCard";

type JobStatusVariant = "success" | "default" | "error" | "warning";

const STATUS_VARIANT: Record<RpcAsyncJobItem["status"], JobStatusVariant> = {
	running: "success",
	completed: "default",
	failed: "error",
	cancelled: "warning",
};

/**
 * Native /jobs: async background jobs owned by the session — running first,
 * then recent, exactly the snapshot ordering the agent sends. Rows render
 * the job object's own fields (id, type, status, elapsed time, label). When
 * the sidecar sends the job tree, subagent jobs nest under the task that runs
 * them, in the agent's display order.
 */
export function JobsDialog() {
	const t = useT();
	const rpc = useTabRpc();
	const [updatedAt, setUpdatedAt] = useState<number | null>(null);
	const [now, setNow] = useState(Date.now);
	const open = useUiStore(state => state.jobsOpen);
	const close = useUiStore(state => state.closeJobs);
	const [jobs, setJobs] = useState<RpcAsyncJobItem[]>([]);
	const [tree, setTree] = useState<RpcJobTreeRow[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		let pending = false;
		setJobs([]);
		setTree(null);
		setUpdatedAt(null);
		setError(null);
		setLoading(true);
		const refresh = async () => {
			if (pending || document.visibilityState === "hidden") return;
			pending = true;
			try {
				const response = await rpc.getJobs();
				if (cancelled) return;
				if (!response.success) throw new Error(response.error);
				const result = response.data as RpcJobsResult;
				setJobs(result.jobs);
				setTree(result.tree ?? null);
				setUpdatedAt(Date.now());
				setError(null);
			} catch (cause) {
				if (!cancelled) setError(String(cause));
			} finally {
				pending = false;
				if (!cancelled) setLoading(false);
			}
		};
		void refresh();
		const poll = window.setInterval(() => void refresh(), 2000);
		const clock = window.setInterval(() => setNow(Date.now()), 1000);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			cancelled = true;
			window.clearInterval(poll);
			window.clearInterval(clock);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, [open, rpc]);

	const isRunning = (job: RpcAsyncJobItem) => job.status === "running" || job.cancellationPending === true;
	const running = jobs.filter(isRunning);
	const recent = jobs.filter(job => !isRunning(job));
	const treeJobs = tree?.flatMap(row => (row.job ? [row.job] : [])) ?? [];
	const total = tree ? treeJobs.length : jobs.length;

	const indent = (depth: number) => (depth > 0 ? { paddingLeft: `${0.75 + (depth - 1) * 1.25}rem` } : undefined);
	const nestMark = (depth: number) =>
		depth > 0 ? <CornerDownRight aria-hidden className="shrink-0 text-(--omp-dim)" size={12} /> : null;

	const renderJob = (job: RpcAsyncJobItem, depth = 0, agentId?: string) => (
		<div className="px-3 py-2" key={job.id} style={indent(depth)}>
			<div className="flex items-center gap-2">
				{nestMark(depth)}
				<span className="font-mono text-xs text-(--omp-dim)">[{job.id}]</span>
				<span className="text-xs font-medium text-(--omp-text)">{t(`jobs.type.${job.type}`)}</span>
				<Badge dot pulse={job.status === "running"} variant={STATUS_VARIANT[job.status]}>
					{t(job.cancellationPending ? "jobs.cancelling" : `jobs.status.${job.status}`)}
				</Badge>
				{agentId && agentId !== job.id ? (
					<span className="truncate font-mono text-xs text-(--omp-dim)">{agentId}</span>
				) : null}
				<span className="ml-auto shrink-0 text-xs tabular-nums text-(--omp-dim)">
					{job.status === "running" || job.cancellationPending || job.endedAt !== undefined
						? formatDuration(Math.max(0, (job.endedAt ?? now) - job.startTime))
						: t("jobs.durationUnavailable")}
				</span>
			</div>
			{job.intent ? (
				<div data-job-intent="" className="mt-0.5 break-words text-omp-sm text-(--omp-text)">
					{job.intent}
				</div>
			) : null}
			{job.caption ? (
				<div data-job-caption="" className="mt-0.5 break-words text-xs text-(--omp-text-secondary) italic">
					{job.caption}
				</div>
			) : null}
			<div
				className={cx("mt-0.5 break-words whitespace-pre-wrap text-xs text-(--omp-dim)", job.intent && "font-mono")}
				title={job.command && job.command !== job.label ? job.command : undefined}
			>
				{job.label}
			</div>
			{job.widget ? <JobWidgetCard widget={job.widget} /> : null}
			{(job.resultPreview || job.errorPreview) && (
				<details className="mt-2 text-omp-sm">
					<summary className="cursor-pointer">{t("jobs.result")}</summary>
					<pre className={`${PREVIEW_SCROLL_LG} whitespace-pre-wrap break-words`}>
						<AnsiText text={job.errorPreview ?? job.resultPreview ?? ""} />
					</pre>
					{job.previewTruncated && <p>{t("diffPanel.previewLimited")}</p>}
				</details>
			)}
		</div>
	);

	return (
		<Modal onClose={close} open={open} size="lg" title={t("jobs.title")}>
			{updatedAt && (
				<p className="mb-2 text-omp-xs text-(--omp-dim)">{t("jobs.updated", { time: formatClock(updatedAt) })}</p>
			)}
			{error && (
				<p role="alert" className="text-omp-sm text-(--omp-error)">
					{t("jobs.error")}: {error}
				</p>
			)}
			{loading ? (
				<div className="flex items-center justify-center gap-2 py-8 text-sm text-(--omp-dim)">
					<Spinner size="sm" /> {t("jobs.loading")}
				</div>
			) : total === 0 && !error ? (
				<div className="space-y-2 py-4">
					<div className="text-sm text-(--omp-text)">{t("jobs.empty")}</div>
					<div className="text-xs text-(--omp-dim)">{t("jobs.emptyHint")}</div>
				</div>
			) : tree ? (
				<section>
					<div className="mb-1.5 flex items-center gap-2">
						<span className="text-xs font-semibold text-(--omp-text)">{t("jobs.tree")}</span>
						<Badge variant="muted">{t("jobs.runningCount", { count: treeJobs.filter(isRunning).length })}</Badge>
					</div>
					<div className="divide-y divide-(--omp-border-muted) rounded-lg border border-(--omp-border-muted)">
						{tree.map(row =>
							row.job ? (
								renderJob(row.job, row.depth, row.agentId)
							) : (
								<div
									className="flex items-center gap-2 px-3 py-2"
									key={`agent:${row.agentId}`}
									style={indent(row.depth)}
								>
									{nestMark(row.depth)}
									<Badge variant="muted">{t("jobs.subagent")}</Badge>
									<span className="truncate font-mono text-xs text-(--omp-text)">{row.agentId}</span>
								</div>
							),
						)}
					</div>
				</section>
			) : (
				<div className="space-y-4">
					{running.length > 0 ? (
						<section>
							<div className="mb-1.5 flex items-center gap-2">
								<span className="text-xs font-semibold text-(--omp-text)">{t("jobs.running")}</span>
								<Badge variant="muted">{running.length}</Badge>
							</div>
							<div className="divide-y divide-(--omp-border-muted) rounded-lg border border-(--omp-border-muted)">
								{running.map(job => renderJob(job))}
							</div>
						</section>
					) : null}
					{recent.length > 0 ? (
						<section>
							<div className="mb-1.5 flex items-center gap-2">
								<span className="text-xs font-semibold text-(--omp-text)">{t("jobs.recentLimited")}</span>
								<Badge variant="muted">{recent.length}</Badge>
							</div>
							<div className="divide-y divide-(--omp-border-muted) rounded-lg border border-(--omp-border-muted)">
								{recent.map(job => renderJob(job))}
							</div>
						</section>
					) : null}
				</div>
			)}
		</Modal>
	);
}
