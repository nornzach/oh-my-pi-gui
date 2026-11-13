/**
 * Tasks: every task with its schedule and recent outcomes on the left, the
 * selected task's settings, history and controls on the right.
 */

import { Archive, CalendarClock, ChevronRight, Pause, Pencil, Play, RotateCcw, Trash2, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ScheduledTask, SchedulerInsights, TaskRevision, TaskRun } from "../../../shared/scheduler-types";
import { cx, formatClock, formatCost, formatDuration, formatPercent, shortenPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useSchedulerStore } from "../../stores/scheduler";
import { Badge, Button, ConfirmDialog } from "../common";
import { Collapse } from "../common/Collapse";
import { DayChart } from "./InsightsView";
import { RunDetail, RunRow } from "./RunDetail";
import {
	depthLabel,
	groupHistory,
	runDotClass,
	runOutcome,
	scheduleLabel,
	TASK_STATE_VARIANT,
	timeLimitLabel,
	untilLabel,
} from "./task-format";

/** How many of the task's newest runs its page lists. */
const HISTORY_RUNS = 60;

/** The last dozen outcomes, oldest to newest, as small bars. */
function RecentStrip({ runs }: { runs: TaskRun[] }) {
	const recent = runs.slice(0, 12).reverse();
	return (
		<span aria-hidden className="flex items-center gap-[2px]">
			{recent.map(run => (
				<span className={cx("h-2.5 w-1 rounded-[1px]", runDotClass(run))} key={run.id} />
			))}
		</span>
	);
}

function TaskRow({
	task,
	runs,
	active,
	onSelect,
}: {
	task: ScheduledTask;
	runs: TaskRun[];
	active: boolean;
	onSelect: () => void;
}) {
	const t = useT();
	const live = runs.find(run => run.state === "running" || run.state === "queued");
	return (
		<button
			className={cx(
				"flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors duration-150",
				active ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-selected-bg)",
				task.state !== "active" && "opacity-75",
			)}
			onClick={onSelect}
			type="button"
		>
			<span className="flex items-center gap-2">
				<span
					className={cx(
						"shrink-0",
						live
							? "omp-signal-light omp-signal-light--active text-(--omp-link)"
							: cx(
									"size-2 rounded-full",
									task.state === "active"
										? "bg-(--omp-success)"
										: task.state === "disabled"
											? "bg-(--omp-error)"
											: "bg-(--omp-border-strong)",
								),
					)}
				/>
				<span className="min-w-0 flex-1 truncate text-omp-md font-medium text-(--omp-text)">{task.title}</span>
				<span className={cx("shrink-0 text-omp-xs tabular-nums", live ? "text-(--omp-link)" : "text-(--omp-dim)")}>
					{live
						? t("tasks.list.runningNow")
						: task.nextFireAt !== null
							? untilLabel(t, task.nextFireAt)
							: t(`tasks.state.${task.state}`)}
				</span>
			</span>
			<span className="flex items-center gap-2 pl-4 text-omp-xs text-(--omp-dim)">
				<span className="min-w-0 flex-1 truncate">{scheduleLabel(t, task.schedule)}</span>
				<RecentStrip runs={runs} />
			</span>
		</button>
	);
}

/** One setup value, label above, in the task page's settings grid. */
function Setting({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
	return (
		<div className={cx("min-w-0", wide && "col-span-2")}>
			<dt className="text-omp-xs text-(--omp-dim)">{label}</dt>
			<dd className="mt-0.5 text-omp-md break-words text-(--omp-text)">{children}</dd>
		</div>
	);
}

/** One figure in the task's 30-day summary. */
function Stat({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
	return (
		<div className="min-w-0">
			<p className="text-omp-xs text-(--omp-dim)">{label}</p>
			<p className="mt-0.5 truncate text-omp-lg font-semibold text-(--omp-text) tabular-nums">{value}</p>
			{detail && <p className="truncate text-omp-xs text-(--omp-dim) tabular-nums">{detail}</p>}
		</div>
	);
}

const STATS_DAYS = 30;

/**
 * How the task has been doing: the same figures Insights computes, for this
 * task only, plus its last run and a per-day sparkline.
 */
function TaskStats({ task, runs }: { task: ScheduledTask; runs: TaskRun[] }) {
	const t = useT();
	const [insights, setInsights] = useState<SchedulerInsights | null>(null);
	const latest = runs[0];

	// biome-ignore lint/correctness/useExhaustiveDependencies: the newest run's id and state pace the refetch, so a landing run updates the figures.
	useEffect(() => {
		let current = true;
		window.omp.scheduler.insights(STATS_DAYS, task.id).then(
			result => current && setInsights(result),
			() => {},
		);
		return () => {
			current = false;
		};
	}, [task.id, latest?.id, latest?.state]);

	if (!insights || (insights.runs === 0 && !latest)) return null;
	const latestOutcome = latest ? runOutcome(latest) : null;
	return (
		<section className="omp-fade-up rounded-xl border border-(--omp-border-muted) px-4 py-3">
			<h3 className="text-omp-sm font-semibold tracking-wide text-(--omp-muted) uppercase">
				{t("tasks.insights.title", { days: STATS_DAYS })}
			</h3>
			<dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
				<Stat
					label={t("tasks.detail.lastRun")}
					value={latest ? formatClock(latest.startedAt ?? latest.scheduledFor ?? latest.createdAt) : "—"}
					detail={
						latestOutcome && (
							<span className="flex items-center gap-1.5">
								<span className={cx("size-1.5 rounded-full", runDotClass(latest))} />
								{t(latestOutcome.key)}
							</span>
						)
					}
				/>
				<Stat
					label={t("tasks.insights.runs")}
					value={insights.runs}
					detail={insights.failed > 0 ? t("tasks.insights.failedCount", { count: insights.failed }) : undefined}
				/>
				<Stat
					label={t("tasks.insights.successRate")}
					value={insights.successRate === null ? "—" : formatPercent(insights.successRate * 100, 0)}
				/>
				<Stat
					label={t("tasks.insights.medianDuration")}
					value={insights.medianDurationMs === null ? "—" : formatDuration(insights.medianDurationMs)}
				/>
				<Stat label={t("tasks.insights.cost")} value={formatCost(insights.costUsd, 2)} />
			</dl>
			{insights.runs > 0 && (
				<div className="mt-3">
					<DayChart compact days={insights.perDay} />
				</div>
			)}
		</section>
	);
}

/** A streak of quiet runs as one row; it opens to the runs themselves. */
function QuietStreak({ runs, onSelect }: { runs: TaskRun[]; onSelect: (id: string) => void }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const newest = runs[0];
	const oldest = runs[runs.length - 1];
	const at = (run: TaskRun) => formatClock(run.startedAt ?? run.scheduledFor ?? run.createdAt);
	return (
		<div>
			<button
				aria-expanded={open}
				className="relative flex w-full items-center gap-2 rounded-lg py-2 pr-2.5 pl-3.5 text-left transition-colors duration-150 hover:bg-(--omp-selected-bg)"
				onClick={() => setOpen(value => !value)}
				type="button"
			>
				<span aria-hidden className="absolute inset-y-2 left-1 w-0.5 rounded-full bg-(--omp-border-strong)" />
				<ChevronRight
					className={cx("omp-disclosure-chevron shrink-0 text-(--omp-dim)", open && "rotate-90")}
					size={13}
				/>
				<span className="min-w-0 flex-1 truncate text-omp-md text-(--omp-muted)">
					{t("tasks.detail.quietStreak", { count: runs.length })}
				</span>
				<span className="shrink-0 text-omp-xs text-(--omp-dim) tabular-nums">
					{at(oldest)} – {at(newest)}
				</span>
			</button>
			<Collapse open={open}>
				<div className="flex flex-col gap-0.5 pl-4">
					{runs.map(run => (
						<RunRow active={false} key={run.id} onSelect={() => onSelect(run.id)} run={run} />
					))}
				</div>
			</Collapse>
		</div>
	);
}

function TaskDetail({ task, runs }: { task: ScheduledTask; runs: TaskRun[] }) {
	const t = useT();
	const store = useSchedulerStore.getState();
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [revisions, setRevisions] = useState<TaskRevision[]>([]);
	const [openRun, setOpenRun] = useState<string | null>(null);
	const [promptOpen, setPromptOpen] = useState(false);
	const live = runs.some(run => run.state === "running" || run.state === "queued");
	const shownRun = runs.find(run => run.id === openRun) ?? null;
	// Past three lines the instructions clamp, with a toggle for the rest.
	const longPrompt = task.prompt.length > 240 || task.prompt.split("\n").length > 3;

	// biome-ignore lint/correctness/useExhaustiveDependencies: a saved edit bumps the revision, which adds a row to the list.
	useEffect(() => {
		let current = true;
		window.omp.scheduler.revisions(task.id).then(
			list => current && setRevisions(list),
			() => {},
		);
		return () => {
			current = false;
		};
	}, [task.id, task.revision]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: selecting another task closes the open run and the instructions.
	useEffect(() => {
		setOpenRun(null);
		setPromptOpen(false);
	}, [task.id]);

	const edit = () =>
		store.openEditor({
			mode: "edit",
			taskId: task.id,
			initial: { ...task, origin: task.origin, startPaused: task.state === "paused" },
		});

	if (shownRun) {
		return (
			<div className="omp-fade-in">
				<button
					className="mb-4 text-omp-md text-(--omp-link) hover:underline"
					onClick={() => setOpenRun(null)}
					type="button"
				>
					← {task.title}
				</button>
				<RunDetail run={shownRun} />
			</div>
		);
	}

	return (
		<div className="omp-fade-in flex max-w-4xl flex-col gap-6" key={task.id}>
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="flex items-center gap-2 text-omp-xl font-semibold text-(--omp-text)">
						<span className="truncate">{task.title}</span>
						<Badge dot variant={TASK_STATE_VARIANT[task.state]}>
							{t(`tasks.state.${task.state}`)}
						</Badge>
					</h2>
					<p className="mt-1 text-omp-md text-(--omp-muted)">
						{scheduleLabel(t, task.schedule)}
						{task.nextFireAt !== null && (
							<span className="text-(--omp-dim)">
								{" · "}
								{t("tasks.detail.next", { when: formatClock(task.nextFireAt) })}
							</span>
						)}
					</p>
					{task.state === "disabled" && task.disabledReason && (
						<p className="mt-1 text-omp-md text-(--omp-error)">{t(`tasks.disabled.${task.disabledReason}`)}</p>
					)}
				</div>
				<div className="flex flex-wrap gap-2">
					{task.state !== "archived" && (
						<Button
							disabled={live}
							icon={<Zap size={12} />}
							onClick={() => void store.runNow(task.id)}
							size="sm"
							variant="primary"
						>
							{t("tasks.detail.runNow")}
						</Button>
					)}
					{task.state === "active" && (
						<Button icon={<Pause size={12} />} onClick={() => void store.setEnabled(task.id, false)} size="sm" variant="ghost">
							{t("tasks.detail.pause")}
						</Button>
					)}
					{(task.state === "paused" || task.state === "disabled") && (
						<Button icon={<Play size={12} />} onClick={() => void store.setEnabled(task.id, true)} size="sm" variant="ghost">
							{t("tasks.detail.resume")}
						</Button>
					)}
					{task.state !== "archived" && (
						<Button icon={<Pencil size={12} />} onClick={edit} size="sm" variant="ghost">
							{t("common.edit")}
						</Button>
					)}
					{task.state !== "archived" ? (
						<Button
							icon={<Archive size={12} />}
							onClick={() => void store.archive(task.id)}
							size="sm"
							variant="ghost"
						>
							{t("tasks.detail.archive")}
						</Button>
					) : (
						<>
							<Button
								icon={<RotateCcw size={12} />}
								onClick={() => void store.setEnabled(task.id, false)}
								size="sm"
							>
								{t("tasks.detail.restore")}
							</Button>
							<Button
								icon={<Trash2 size={12} />}
								onClick={() => setConfirmDelete(true)}
								size="sm"
								variant="danger"
							>
								{t("common.delete")}
							</Button>
						</>
					)}
				</div>
			</header>

			<TaskStats runs={runs} task={task} />

			<section className="rounded-xl border border-(--omp-border-muted) px-4 py-3">
				<h3 className="text-omp-sm font-semibold tracking-wide text-(--omp-muted) uppercase">
					{t("tasks.form.prompt")}
				</h3>
				<p
					className={cx(
						"mt-1.5 text-omp-md leading-relaxed whitespace-pre-wrap text-(--omp-text)",
						!promptOpen && "line-clamp-3",
					)}
				>
					{task.prompt}
				</p>
				{longPrompt && (
					<button
						className="mt-1 text-omp-sm text-(--omp-link) hover:underline"
						onClick={() => setPromptOpen(value => !value)}
						type="button"
					>
						{t(promptOpen ? "tasks.detail.showLess" : "tasks.detail.showAll")}
					</button>
				)}
				<dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-(--omp-border-muted) pt-3 lg:grid-cols-4">
					<Setting label={t("tasks.form.depth")}>{depthLabel(t, task.depth)}</Setting>
					<Setting label={t("tasks.form.access")}>{t(`tasks.access.${task.tools}`)}</Setting>
					<Setting label={t("tasks.detail.timeLimit")}>{timeLimitLabel(t, task.timeoutMs)}</Setting>
					<Setting label={t("tasks.form.notify")}>{t(`tasks.notify.${task.notify}`)}</Setting>
					<Setting label={t("tasks.form.model")}>
						{task.model ? (
							<span className="block truncate font-mono text-omp-sm" title={task.model}>
								{task.model}
							</span>
						) : (
							t("tasks.form.modelDefault")
						)}
					</Setting>
					<Setting label={t("tasks.detail.origin")}>
						{t(task.origin.createdBy === "agent" ? "tasks.detail.originAgent" : "tasks.detail.originUser")}
						<span className="text-(--omp-dim)">
							{" · "}
							{t("tasks.detail.revision", { revision: task.revision })}
						</span>
					</Setting>
					<Setting label={t("tasks.form.folder")} wide>
						<span className="block truncate font-mono text-omp-sm" title={task.cwd}>
							{shortenPath(task.cwd)}
						</span>
					</Setting>
					{task.verify && (
						<Setting label={t("tasks.detail.check")} wide>
							<span className="font-mono text-omp-sm">{task.verify.command}</span>
						</Setting>
					)}
				</dl>
			</section>

			<section>
				<h3 className="mb-2 text-omp-sm font-semibold tracking-wide text-(--omp-muted) uppercase">
					{t("tasks.detail.history")}
				</h3>
				{runs.length === 0 ? (
					<p className="text-omp-md text-(--omp-dim)">{t("tasks.detail.noRuns")}</p>
				) : (
					<div className="flex flex-col gap-0.5">
						{groupHistory(runs.slice(0, HISTORY_RUNS)).map(item =>
							item.kind === "run" ? (
								<RunRow
									active={false}
									key={item.run.id}
									onSelect={() => setOpenRun(item.run.id)}
									run={item.run}
								/>
							) : (
								<QuietStreak key={item.runs[0].id} onSelect={setOpenRun} runs={item.runs} />
							),
						)}
					</div>
				)}
			</section>

			{revisions.length > 1 && (
				<section>
					<h3 className="mb-2 text-omp-sm font-semibold tracking-wide text-(--omp-muted) uppercase">
						{t("tasks.detail.revisions")}
					</h3>
					<ul className="flex flex-col gap-1">
						{[...revisions].reverse().map(revision => (
							<li className="flex items-center gap-2 text-omp-md text-(--omp-muted)" key={revision.revision}>
								<span className="w-8 shrink-0 tabular-nums text-(--omp-dim)">r{revision.revision}</span>
								<span className="tabular-nums">{formatClock(revision.createdAt)}</span>
								<span className="min-w-0 truncate text-(--omp-dim)">
									· {scheduleLabel(t, revision.config.schedule)}
								</span>
							</li>
						))}
					</ul>
				</section>
			)}

			<ConfirmDialog
				message={t("tasks.detail.deleteMessage", { title: task.title })}
				onCancel={() => setConfirmDelete(false)}
				onConfirm={() => {
					setConfirmDelete(false);
					void store.remove(task.id);
				}}
				open={confirmDelete}
				title={t("tasks.detail.deleteTitle")}
				warning={t("tasks.detail.deleteWarning")}
			/>
		</div>
	);
}

export function EmptyState({
	icon,
	title,
	body,
	action,
}: {
	icon: React.ReactNode;
	title: string;
	body: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="omp-empty-canvas flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
			<span className="flex size-12 items-center justify-center rounded-2xl border border-(--omp-border-muted) text-(--omp-muted)">
				{icon}
			</span>
			<p className="text-omp-lg font-medium text-(--omp-text)">{title}</p>
			<p className="max-w-sm text-omp-md leading-relaxed text-(--omp-dim)">{body}</p>
			{action}
		</div>
	);
}

export function TasksView({ onNew }: { onNew: () => void }) {
	const t = useT();
	const snapshot = useSchedulerStore(state => state.snapshot);
	const selectedTaskId = useSchedulerStore(state => state.selectedTaskId);
	const selectTask = useSchedulerStore(state => state.selectTask);
	const [showArchived, setShowArchived] = useState(false);
	const tasks = snapshot?.tasks ?? [];
	const runsByTask = useMemo(() => {
		const map = new Map<string, TaskRun[]>();
		for (const run of snapshot?.runs ?? []) {
			const list = map.get(run.taskId) ?? [];
			list.push(run);
			map.set(run.taskId, list);
		}
		return map;
	}, [snapshot?.runs]);
	const visible = tasks.filter(task => showArchived || task.state !== "archived");
	const archivedCount = tasks.length - tasks.filter(task => task.state !== "archived").length;
	const selected = visible.find(task => task.id === selectedTaskId) ?? visible[0] ?? null;

	if (tasks.length === 0) {
		return (
			<EmptyState
				action={
					<Button icon={<CalendarClock size={13} />} onClick={onNew} variant="primary">
						{t("tasks.new")}
					</Button>
				}
				body={t("tasks.empty.body")}
				icon={<CalendarClock size={20} />}
				title={t("tasks.empty.title")}
			/>
		);
	}

	return (
		<div className="flex h-full min-h-0">
			<aside className="flex w-80 shrink-0 flex-col border-r border-(--omp-border-muted)">
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					{visible.map(task => (
						<TaskRow
							active={task.id === selected?.id}
							key={task.id}
							onSelect={() => selectTask(task.id)}
							runs={runsByTask.get(task.id) ?? []}
							task={task}
						/>
					))}
				</div>
				{archivedCount > 0 && (
					<label className="flex shrink-0 items-center gap-2 border-t border-(--omp-border-muted) px-4 py-2 text-omp-sm text-(--omp-muted)">
						<input
							checked={showArchived}
							className="size-3.5 accent-(--omp-accent)"
							onChange={event => setShowArchived(event.target.checked)}
							type="checkbox"
						/>
						{t("tasks.list.showArchived", { count: archivedCount })}
					</label>
				)}
			</aside>
			<div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
				{selected ? <TaskDetail runs={runsByTask.get(selected.id) ?? []} task={selected} /> : null}
			</div>
		</div>
	);
}
