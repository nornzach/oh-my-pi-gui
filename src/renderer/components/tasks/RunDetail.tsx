/**
 * One run, as a report: what it found, what it changed, whether its check
 * passed, what it was refused, and where its session and branch are.
 */

import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	FileText,
	GitBranch,
	Info,
	ListChecks,
	MessageSquare,
	Square,
	XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { RunReport, TaskRun } from "../../../shared/scheduler-types";
import { describeProviderError } from "../../lib/errors";
import { basename, cx, formatClock, formatCost, formatDuration, formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { InlineMarkdown } from "../../lib/inline-markdown";
import { MarkdownRenderer } from "../../lib/markdown";
import { useSchedulerStore } from "../../stores/scheduler";
import { useTabsStore } from "../../stores/tabs";
import { Badge, Button, Spinner } from "../common";
import { TechnicalDetails } from "../common/TechnicalDetails";
import { runDotClass, runDuration, runOutcome, summaryLine } from "./task-format";

export function RunOutcomeBadge({ run }: { run: TaskRun }) {
	const t = useT();
	const { key, variant } = runOutcome(run);
	return (
		<Badge dot pulse={run.state === "running"} variant={variant}>
			{t(key)}
		</Badge>
	);
}

/** A compact run line for lists. */
export function RunRow({
	run,
	title,
	active,
	onSelect,
}: {
	run: TaskRun;
	/** The task's name, in lists that mix tasks; the run's summary then gets its own line. */
	title?: string;
	active: boolean;
	onSelect: () => void;
}) {
	const t = useT();
	const progress = useSchedulerStore(state => state.progress[run.id]);
	const duration = runDuration(run);
	const when = run.startedAt ?? run.scheduledFor ?? run.createdAt;
	// What the run found or why it failed; without either the trigger is the headline.
	const finding = run.report?.summary
		? summaryLine(run.report.summary)
		: run.error
			? describeProviderError(run.error.message)
			: undefined;
	const headline = title ?? finding;
	const fileCount = Math.max(run.changedFiles.length, run.report?.changes.length ?? 0);
	return (
		<button
			className={cx(
				"omp-fade-in relative flex w-full flex-col gap-0.5 rounded-lg py-2 pr-2.5 pl-3.5 text-left transition-colors duration-150",
				active ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-selected-bg)",
			)}
			onClick={onSelect}
			type="button"
		>
			{/* The outcome at a glance down a long history: green done, red failed, amber review. */}
			<span aria-hidden className={cx("absolute inset-y-2 left-1 w-0.5 rounded-full", runDotClass(run))} />
			<span className="truncate text-omp-md font-medium text-(--omp-text)">
				{headline ? <InlineMarkdown text={headline} /> : t(`tasks.run.trigger.${run.trigger}`)}
			</span>
			{title !== undefined && finding && (
				<span className="truncate text-omp-sm text-(--omp-muted)">
					<InlineMarkdown text={finding} />
				</span>
			)}
			<span className="mt-0.5 flex items-center gap-2 text-omp-xs text-(--omp-dim) tabular-nums">
				{/* One truncating line, so a narrow list clips the meta rather than scrolling sideways. */}
				<span className="min-w-0 flex-1 truncate">
					{[
						formatClock(when),
						duration !== null && run.state !== "running" ? formatDuration(duration) : null,
						run.state === "running" && progress
							? [
									progress.round > 1 ? t("tasks.run.round", { round: progress.round }) : null,
									t("tasks.run.progress", { turns: progress.turns }),
									progress.lastTool,
								]
									.filter(Boolean)
									.join(" · ")
							: null,
						run.trigger !== "schedule" && headline !== undefined ? t(`tasks.run.trigger.${run.trigger}`) : null,
						fileCount > 0 ? t("tasks.run.files", { count: fileCount }) : null,
					]
						.filter(Boolean)
						.join(" · ")}
				</span>
				<span className="shrink-0">
					<RunOutcomeBadge run={run} />
				</span>
			</span>
		</button>
	);
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
	return (
		<section className="omp-fade-up">
			<h3 className="mb-2 flex items-center gap-1.5 text-omp-sm font-semibold tracking-wide text-(--omp-muted) uppercase">
				{icon}
				{title}
			</h3>
			{children}
		</section>
	);
}

const SEVERITY_ICON = {
	info: <Info size={13} className="mt-0.5 shrink-0 text-(--omp-link)" />,
	warn: <AlertTriangle size={13} className="mt-0.5 shrink-0 text-(--omp-warning)" />,
	error: <XCircle size={13} className="mt-0.5 shrink-0 text-(--omp-error)" />,
};

function ReportBody({ report }: { report: RunReport }) {
	const t = useT();
	return (
		<div className="flex flex-col gap-5">
			<Section icon={<FileText size={12} />} title={t("tasks.run.summary")}>
				<div className="text-omp-lg leading-relaxed text-(--omp-text)">
					<MarkdownRenderer content={report.summary} />
				</div>
				{report.status !== "done" && report.status !== "nothing_to_report" && (
					<p className="mt-2 text-omp-md text-(--omp-warning)">{t(`tasks.run.reportStatus.${report.status}`)}</p>
				)}
			</Section>
			{report.findings.length > 0 && (
				<Section icon={<ListChecks size={12} />} title={t("tasks.run.findings", { count: report.findings.length })}>
					<ul className="flex flex-col gap-2">
						{report.findings.map((finding, index) => (
							<li
								className="flex gap-2 rounded-lg border border-(--omp-border-muted) px-3 py-2"
								key={`${index}-${finding.title}`}
							>
								{SEVERITY_ICON[finding.severity ?? "info"]}
								<div className="min-w-0">
									<p className="text-omp-md font-medium text-(--omp-text)">
										<InlineMarkdown text={finding.title} />
									</p>
									{finding.detail && (
										<div className="mt-0.5 text-omp-md leading-relaxed text-(--omp-muted)">
											<MarkdownRenderer content={finding.detail} />
										</div>
									)}
								</div>
							</li>
						))}
					</ul>
				</Section>
			)}
			{report.next && (
				<Section icon={<ArrowRight size={12} />} title={t("tasks.run.next")}>
					<div className="text-omp-md leading-relaxed text-(--omp-muted)">
						<MarkdownRenderer content={report.next} />
					</div>
				</Section>
			)}
		</div>
	);
}

/** One item of the run's meta line; its label is the hover text. */
function Meta({ label, children }: { label: string; children: ReactNode }) {
	return (
		<span
			className="flex items-center gap-1.5 before:text-(--omp-border-strong) before:content-['·'] first:before:content-none"
			title={label}
		>
			{children}
		</span>
	);
}

export function RunDetail({ run, taskTitle, actions }: { run: TaskRun; taskTitle?: string; actions?: ReactNode }) {
	const t = useT();
	const progress = useSchedulerStore(state => state.progress[run.id]);
	const cancelRun = useSchedulerStore(state => state.cancelRun);
	const duration = runDuration(run);
	const when = run.startedAt ?? run.scheduledFor ?? run.createdAt;
	const live = run.state === "running" || run.state === "queued";
	const changes = run.report?.changes ?? [];
	const changedPaths = [...new Set([...run.changedFiles, ...changes.map(change => change.path)])];
	const noteFor = (path: string) => changes.find(change => change.path === path)?.note;

	const openSession = () => {
		if (!run.sessionPath) return;
		void useTabsStore.getState().openTab({
			sessionPath: run.sessionPath,
			cwd: run.worktree && !run.worktree.removed ? run.worktree.path : undefined,
		});
		useSchedulerStore.getState().close();
	};
	const openWorktree = () => {
		const worktree = run.worktree;
		if (!worktree || worktree.removed) return;
		void useTabsStore.getState().openTab({
			cwd: worktree.path,
			worktree: { name: basename(worktree.path), branch: worktree.branch, baseCwd: worktree.baseCwd },
		});
		useSchedulerStore.getState().close();
	};

	return (
		<div className="flex max-w-4xl flex-col gap-6" key={run.id}>
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="truncate text-omp-xl font-semibold text-(--omp-text)">
						{taskTitle ?? formatClock(when)}
					</h2>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-omp-sm text-(--omp-muted) tabular-nums">
						<RunOutcomeBadge run={run} />
						<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
							{taskTitle && <Meta label={t("tasks.run.fact.when")}>{formatClock(when)}</Meta>}
							<Meta label={t("tasks.run.fact.trigger")}>{t(`tasks.run.trigger.${run.trigger}`)}</Meta>
							{duration !== null && <Meta label={t("tasks.run.fact.duration")}>{formatDuration(duration)}</Meta>}
							{run.usage && (
								<Meta label={t("tasks.run.fact.cost")}>
									{formatCost(run.usage.costUsd, 3)} ·{" "}
									{formatTokens(run.usage.inputTokens + run.usage.outputTokens)}
								</Meta>
							)}
							{run.rounds !== undefined && (
								<Meta label={t("tasks.run.fact.rounds")}>{t("tasks.run.rounds", { count: run.rounds })}</Meta>
							)}
							{run.model && (
								<Meta label={t("tasks.run.fact.model")}>
									<span className="font-mono text-omp-xs">{run.model}</span>
								</Meta>
							)}
						</span>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					{actions}
					{live && (
						<Button
							icon={<Square size={11} />}
							onClick={() => void cancelRun(run.id)}
							size="sm"
							variant="secondary"
						>
							{t("tasks.run.cancel")}
						</Button>
					)}
					{run.worktree && !run.worktree.removed && (
						<Button icon={<GitBranch size={12} />} onClick={openWorktree} size="sm" variant="secondary">
							{t("tasks.run.openWorktree")}
						</Button>
					)}
					{run.sessionPath && (
						<Button icon={<MessageSquare size={12} />} onClick={openSession} size="sm" variant="secondary">
							{t("tasks.run.openSession")}
						</Button>
					)}
				</div>
			</header>

			{live && (
				<div className="omp-fade-in flex items-center gap-3 rounded-xl border border-(--omp-border-muted) px-4 py-3">
					<Spinner size="sm" />
					<div className="min-w-0 flex-1">
						<p className="text-omp-md text-(--omp-text)">
							{run.state === "queued" ? t("tasks.run.queued") : t("tasks.run.running")}
						</p>
						{progress && (
							<p className="truncate text-omp-sm text-(--omp-dim)">
								{progress.round > 1 && `${t("tasks.run.round", { round: progress.round })} · `}
								{t("tasks.run.progress", { turns: progress.turns })}
								{progress.lastTool && ` · ${progress.lastTool}`}
							</p>
						)}
					</div>
					<div className="h-0.5 w-24 shrink-0 overflow-hidden rounded-full bg-(--omp-border-muted)">
						<div className="omp-indeterminate-progress h-full rounded-full bg-(--omp-accent)" />
					</div>
				</div>
			)}

			{run.error && (
				<div className="omp-fade-up flex gap-2 rounded-xl border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] px-4 py-3">
					<XCircle size={14} className="mt-0.5 shrink-0 text-(--omp-error)" />
					<div className="min-w-0">
						<p className="text-omp-md font-medium text-(--omp-error)">
							{t(`tasks.run.errorKind.${run.error.kind}`)}
						</p>
						<p className="mt-0.5 text-omp-md break-words whitespace-pre-wrap text-(--omp-muted)">
							{describeProviderError(run.error.message)}
						</p>
						<TechnicalDetails
							className="mt-1.5"
							raw={run.error.message}
							shown={describeProviderError(run.error.message)}
						/>
					</div>
				</div>
			)}

			{run.report ? (
				<ReportBody report={run.report} />
			) : (
				!live &&
				!run.error && (
					<p className="text-omp-md text-(--omp-dim)">
						{t(
							`tasks.run.noReport.${run.state === "missed" || run.state.startsWith("skipped") ? "skipped" : "default"}`,
						)}
					</p>
				)
			)}

			{changedPaths.length > 0 && (
				<Section icon={<GitBranch size={12} />} title={t("tasks.run.changes", { count: changedPaths.length })}>
					{run.worktree && (
						<p className="mb-2 text-omp-sm text-(--omp-dim)">
							{t("tasks.run.branch", { branch: run.worktree.branch })}
							{run.worktree.removed && ` · ${t("tasks.run.worktreeRemoved")}`}
						</p>
					)}
					<ul className="flex flex-col divide-y divide-(--omp-border-muted) rounded-xl border border-(--omp-border-muted)">
						{changedPaths.map(path => (
							<li className="px-3 py-1.5" key={path}>
								<p className="truncate font-mono text-omp-sm text-(--omp-text)">{path}</p>
								{noteFor(path) && <p className="text-omp-sm text-(--omp-dim)">{noteFor(path)}</p>}
							</li>
						))}
					</ul>
				</Section>
			)}

			{run.verification.state !== "none" && (
				<Section
					icon={
						run.verification.state === "passed" ? (
							<CheckCircle2 size={12} className="text-(--omp-success)" />
						) : (
							<XCircle size={12} className="text-(--omp-error)" />
						)
					}
					title={t("tasks.run.verification")}
				>
					<p
						className={cx(
							"text-omp-md",
							run.verification.state === "passed" ? "text-(--omp-success)" : "text-(--omp-error)",
						)}
					>
						{t(`tasks.run.verify.${run.verification.state}`, { code: run.verification.exitCode ?? "—" })}
					</p>
					{run.verification.outputTail && (
						<pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-(--omp-border-muted) px-3 py-2 font-mono text-omp-sm leading-relaxed whitespace-pre-wrap text-(--omp-muted)">
							{run.verification.outputTail}
						</pre>
					)}
				</Section>
			)}

			{run.blocked.length > 0 && (
				<Section
					icon={<AlertTriangle size={12} className="text-(--omp-warning)" />}
					title={t("tasks.run.blocked", { count: run.blocked.length })}
				>
					<p className="mb-2 text-omp-sm text-(--omp-dim)">{t("tasks.run.blockedHint")}</p>
					<ul className="flex flex-col gap-1">
						{run.blocked.map((item, index) => (
							<li className="truncate text-omp-md text-(--omp-muted)" key={`${index}-${item.tool}`}>
								<span className="font-mono text-(--omp-text)">{item.tool}</span>
								{item.target && <span className="ml-2 font-mono text-omp-sm">{item.target}</span>}
							</li>
						))}
					</ul>
				</Section>
			)}

			{run.review.state === "rejected" && run.review.note && (
				<Section icon={<MessageSquare size={12} />} title={t("tasks.run.rejectionNote")}>
					<p className="text-omp-md text-(--omp-muted)">{run.review.note}</p>
				</Section>
			)}
		</div>
	);
}
