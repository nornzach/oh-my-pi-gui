/**
 * Tasks: every task with its schedule and recent outcomes on the left, the
 * selected task's settings, history and controls on the right.
 */

import { Archive, CalendarClock, Pause, Pencil, Play, RotateCcw, Trash2, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ScheduledTask, TaskRevision, TaskRun } from "../../../shared/scheduler-types";
import { cx, formatClock, shortenPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useSchedulerStore } from "../../stores/scheduler";
import { Badge, Button, ConfirmDialog } from "../common";
import { RunDetail, RunRow } from "./RunDetail";
import { depthLabel, runDotClass, scheduleLabel, TASK_STATE_VARIANT, timeLimitLabel, untilLabel } from "./task-format";

function RecentStrip({ runs }: { runs: TaskRun[] }) {
	const recent = runs.slice(0, 12).reverse();
	return (
		<span aria-hidden className="flex items-center gap-0.5">
			{recent.map(run => (
				<span className={cx("size-1.5 rounded-[2px]", runDotClass(run))} key={run.id} />
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
						"size-2 shrink-0 rounded-full",
						live
							? "omp-pulse-dot bg-(--omp-link)"
							: task.state === "active"
								? "bg-(--omp-success)"
								: task.state === "disabled"
									? "bg-(--omp-error)"
									: "bg-(--omp-border-strong)",
					)}
				/>
				<span className="min-w-0 flex-1 truncate text-omp-md font-medium text-(--omp-text)">{task.title}</span>
				<RecentStrip runs={runs} />
			</span>
			<span className="flex items-center gap-1.5 pl-4 text-omp-xs text-(--omp-dim)">
				<span className="min-w-0 truncate">{scheduleLabel(t, task.schedule)}</span>
				<span className="ml-auto shrink-0 tabular-nums">
					{live
						? t("tasks.list.runningNow")
						: task.nextFireAt !== null
							? untilLabel(t, task.nextFireAt)
							: t(`tasks.state.${task.state}`)}
				</span>
			</span>
		</button>
	);
}

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex gap-4 py-2">
			<dt className="w-28 shrink-0 text-omp-md text-(--omp-dim)">{label}</dt>
			<dd className="min-w-0 flex-1 text-omp-md break-words text-(--omp-text)">{children}</dd>
		</div>
	);
}

function TaskDetail({ task, runs }: { task: ScheduledTask; runs: TaskRun[] }) {
	const t = useT();
	const store = useSchedulerStore.getState();
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [revisions, setRevisions] = useState<TaskRevision[]>([]);
	const [openRun, setOpenRun] = useState<string | null>(null);
	const live = runs.some(run => run.state === "running" || run.state === "queued");
	const shownRun = runs.find(run => run.id === openRun) ?? null;

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: selecting another task closes the open run.
	useEffect(() => setOpenRun(null), [task.id]);

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
		<div className="omp-fade-in flex flex-col gap-6" key={task.id}>
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
						<Button icon={<Pause size={12} />} onClick={() => void store.setEnabled(task.id, false)} size="sm">
							{t("tasks.detail.pause")}
						</Button>
					)}
					{(task.state === "paused" || task.state === "disabled") && (
						<Button icon={<Play size={12} />} onClick={() => void store.setEnabled(task.id, true)} size="sm">
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

			<section className="rounded-xl border border-(--omp-border-muted) px-4 py-1">
				<dl className="divide-y divide-(--omp-border-muted)">
					<Setting label={t("tasks.form.prompt")}>
						<p className="line-clamp-6 whitespace-pre-wrap text-(--omp-muted)">{task.prompt}</p>
					</Setting>
					<Setting label={t("tasks.form.folder")}>
						<span className="font-mono text-omp-sm">{shortenPath(task.cwd)}</span>
					</Setting>
					<Setting label={t("tasks.form.depth")}>{depthLabel(t, task.depth)}</Setting>
					<Setting label={t("tasks.form.access")}>{t(`tasks.access.${task.tools}`)}</Setting>
					<Setting label={t("tasks.form.model")}>{task.model ?? t("tasks.form.modelDefault")}</Setting>
					<Setting label={t("tasks.detail.timeLimit")}>{timeLimitLabel(t, task.timeoutMs)}</Setting>
					{task.verify && (
						<Setting label={t("tasks.detail.check")}>
							<span className="font-mono text-omp-sm">{task.verify.command}</span>
						</Setting>
					)}
					<Setting label={t("tasks.form.notify")}>{t(`tasks.notify.${task.notify}`)}</Setting>
					<Setting label={t("tasks.detail.origin")}>
						{t(task.origin.createdBy === "agent" ? "tasks.detail.originAgent" : "tasks.detail.originUser")}
						<span className="text-(--omp-dim)">
							{" · "}
							{t("tasks.detail.revision", { revision: task.revision })}
						</span>
					</Setting>
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
						{runs.slice(0, 30).map(run => (
							<RunRow active={false} key={run.id} onSelect={() => setOpenRun(run.id)} run={run} />
						))}
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
