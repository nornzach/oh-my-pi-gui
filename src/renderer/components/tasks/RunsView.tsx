/**
 * Runs: every recorded run across tasks, newest first, filterable by what
 * needs attention; Review: only the runs waiting for a decision, with the
 * accept/reject controls that feed the next run.
 */

import { CheckCircle2, History, Inbox, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { TaskRun } from "../../../shared/scheduler-types";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useSchedulerStore } from "../../stores/scheduler";
import { Button, TextArea } from "../common";
import { RunDetail, RunRow } from "./RunDetail";
import { EmptyState } from "./TasksView";

type RunFilter = "all" | "attention" | "running";

function attention(run: TaskRun): boolean {
	return (
		run.review.state === "pending" ||
		run.state === "failed" ||
		run.state === "timed_out" ||
		run.state === "blocked_config" ||
		run.state === "unknown" ||
		run.verification.state === "failed" ||
		run.verification.state === "error"
	);
}

function useTitles(): Map<string, string> {
	const tasks = useSchedulerStore(state => state.snapshot?.tasks);
	return useMemo(() => new Map((tasks ?? []).map(task => [task.id, task.title])), [tasks]);
}

function SplitPane({
	runs,
	selectedId,
	onSelect,
	header,
	detail,
	footer,
}: {
	runs: TaskRun[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	header?: React.ReactNode;
	detail: React.ReactNode;
	/** Pinned under the detail, outside its scroll area. */
	footer?: React.ReactNode;
}) {
	const titles = useTitles();
	return (
		<div className="flex h-full min-h-0">
			<aside className="flex w-80 shrink-0 flex-col border-r border-(--omp-border-muted)">
				{header}
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					{runs.map(run => (
						<RunRow
							active={run.id === selectedId}
							key={run.id}
							onSelect={() => onSelect(run.id)}
							run={run}
							title={titles.get(run.taskId) ?? run.taskId}
						/>
					))}
				</div>
			</aside>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{detail}</div>
				{footer}
			</div>
		</div>
	);
}

export function RunsView() {
	const t = useT();
	const runs = useSchedulerStore(state => state.snapshot?.runs ?? []);
	const selectedRunId = useSchedulerStore(state => state.selectedRunId);
	const selectRun = useSchedulerStore(state => state.selectRun);
	const titles = useTitles();
	const [filter, setFilter] = useState<RunFilter>("all");
	const matches = (run: TaskRun, id: RunFilter) =>
		id === "all" ? true : id === "running" ? run.state === "running" || run.state === "queued" : attention(run);
	const shown = runs.filter(run => matches(run, filter));
	const counts = {
		attention: runs.filter(run => matches(run, "attention")).length,
		running: runs.filter(run => matches(run, "running")).length,
	};
	const selected = shown.find(run => run.id === selectedRunId) ?? shown[0] ?? null;

	if (runs.length === 0) {
		return (
			<EmptyState body={t("tasks.runs.emptyBody")} icon={<History size={20} />} title={t("tasks.runs.emptyTitle")} />
		);
	}

	return (
		<SplitPane
			detail={
				selected ? (
					<RunDetail run={selected} taskTitle={titles.get(selected.taskId)} />
				) : (
					<p className="text-omp-md text-(--omp-dim)">{t("tasks.runs.noMatch")}</p>
				)
			}
			header={
				<div className="flex shrink-0 gap-1 border-b border-(--omp-border-muted) px-2 py-2">
					{(["all", "attention", "running"] as const).map(id => (
						<button
							className={cx(
								"flex items-center gap-1.5 rounded-md px-2.5 py-1 text-omp-sm font-medium transition-colors duration-150",
								filter === id
									? "bg-(--omp-selected-bg) text-(--omp-text)"
									: "text-(--omp-muted) hover:text-(--omp-text)",
							)}
							key={id}
							onClick={() => setFilter(id)}
							type="button"
						>
							{t(`tasks.runs.filter.${id}`)}
							{id !== "all" && counts[id] > 0 && (
								<span
									className={cx(
										"tabular-nums",
										id === "attention" ? "text-(--omp-warning)" : "text-(--omp-link)",
									)}
								>
									{counts[id]}
								</span>
							)}
						</button>
					))}
				</div>
			}
			onSelect={selectRun}
			runs={shown}
			selectedId={selected?.id ?? null}
		/>
	);
}

function ReviewActions({ run }: { run: TaskRun }) {
	const t = useT();
	const review = useSchedulerStore(state => state.review);
	const [rejecting, setRejecting] = useState(false);
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState<"accepted" | "rejected" | null>(null);
	const decide = async (decision: "accepted" | "rejected") => {
		setBusy(decision);
		try {
			await review(run.id, decision, decision === "rejected" ? note.trim() || undefined : undefined);
		} finally {
			setBusy(null);
		}
	};
	const editsFiles = run.worktree !== undefined;

	return (
		<div className="omp-fade-in shrink-0 border-t border-(--omp-border-muted) px-6 py-3">
			{rejecting ? (
				<div className="flex flex-col gap-2">
					<TextArea
						autoFocus
						hint={t("tasks.review.rejectHint")}
						label={t("tasks.review.rejectLabel")}
						onChange={event => setNote(event.target.value)}
						rows={2}
						value={note}
					/>
					<div className="flex justify-end gap-2">
						<Button onClick={() => setRejecting(false)} size="sm" variant="ghost">
							{t("common.cancel")}
						</Button>
						<Button
							icon={<XCircle size={12} />}
							loading={busy === "rejected"}
							onClick={() => void decide("rejected")}
							size="sm"
							variant="danger"
						>
							{t("tasks.review.reject")}
						</Button>
					</div>
				</div>
			) : (
				<div className="flex flex-wrap items-center justify-between gap-3">
					<p className="text-omp-sm text-(--omp-dim)">
						{t(editsFiles ? "tasks.review.hintWorktree" : "tasks.review.hint")}
					</p>
					<div className="flex gap-2">
						<Button onClick={() => setRejecting(true)} size="sm" variant="ghost">
							{t("tasks.review.reject")}
						</Button>
						<Button
							icon={<CheckCircle2 size={12} />}
							loading={busy === "accepted"}
							onClick={() => void decide("accepted")}
							size="sm"
							variant="primary"
						>
							{t("tasks.review.accept")}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

export function ReviewView() {
	const t = useT();
	const runs = useSchedulerStore(state => state.snapshot?.runs ?? []);
	const selectedRunId = useSchedulerStore(state => state.selectedRunId);
	const selectRun = useSchedulerStore(state => state.selectRun);
	const titles = useTitles();
	const pending = runs.filter(run => run.review.state === "pending");
	const selected = pending.find(run => run.id === selectedRunId) ?? pending[0] ?? null;

	if (pending.length === 0) {
		return (
			<EmptyState
				body={t("tasks.review.emptyBody")}
				icon={<Inbox size={20} />}
				title={t("tasks.review.emptyTitle")}
			/>
		);
	}

	return (
		<SplitPane
			detail={selected && <RunDetail key={selected.id} run={selected} taskTitle={titles.get(selected.taskId)} />}
			footer={selected && <ReviewActions key={selected.id} run={selected} />}
			onSelect={selectRun}
			runs={pending}
			selectedId={selected?.id ?? null}
		/>
	);
}
