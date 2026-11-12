import { CheckCircle2, Circle, CircleDot, ListTodo, MinusCircle, XCircle } from "lucide-react";
import type { TodoTask } from "../../../shared/rpc-types";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { resultBodyText, resultDetails } from "./result";
import type { ToolRendererProps } from "./ToolCard";

/**
 * Task payload inside `details.phases`. A todo result saved before omp 18.19
 * can carry the since-removed `blocked` status with its blocker note; the
 * transcript shows it as it happened.
 */
type TodoDetailsStatus = TodoTask["status"] | "blocked";
type TodoDetailsTask = Omit<TodoTask, "status"> & { status: TodoDetailsStatus; blocker?: string };

interface TodoDetailsPhase {
	name: string;
	tasks: TodoDetailsTask[];
}

/** Task that transitioned to completed in this update (details.completedTasks). */
interface TodoCompletionTransition {
	phase: string;
	content: string;
}

const STATUS_META: Record<TodoDetailsStatus, { icon: typeof Circle; color: string }> = {
	pending: { icon: Circle, color: "var(--omp-dim)" },
	in_progress: { icon: CircleDot, color: "var(--omp-accent)" },
	completed: { icon: CheckCircle2, color: "var(--omp-success)" },
	blocked: { icon: XCircle, color: "var(--omp-warning)" },
	abandoned: { icon: MinusCircle, color: "var(--omp-dim)" },
};

function asPhases(value: unknown): TodoDetailsPhase[] {
	if (!Array.isArray(value)) return [];
	const phases: TodoDetailsPhase[] = [];
	for (const entry of value) {
		if (entry == null || typeof entry !== "object") continue;
		const record = entry as Record<string, unknown>;
		if (typeof record.name !== "string" || !Array.isArray(record.tasks)) continue;
		const tasks = record.tasks.filter(
			(task): task is TodoDetailsTask =>
				task != null && typeof task === "object" && typeof (task as TodoDetailsTask).content === "string",
		);
		phases.push({ name: record.name, tasks });
	}
	return phases;
}

function asCompletedTasks(value: unknown): TodoCompletionTransition[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(entry): entry is TodoCompletionTransition =>
			entry != null &&
			typeof entry === "object" &&
			typeof (entry as TodoCompletionTransition).phase === "string" &&
			typeof (entry as TodoCompletionTransition).content === "string",
	);
}

/** Single-op `{op,task?,phase?}` plus the legacy `{ops:[...]}` batch shape. */
interface TodoArgOp {
	op?: string;
	task?: string;
	phase?: string;
}

function normalizeTodoOps(args: Record<string, unknown>): TodoArgOp[] {
	if (Array.isArray(args.ops)) {
		return args.ops.filter((entry): entry is TodoArgOp => entry != null && typeof entry === "object");
	}
	return typeof args.op === "string" ? [args as TodoArgOp] : [];
}

/**
 * Phases the latest update touched, plus the active (in_progress) phase —
 * port of the TUI's computeTouchedPhases. `null` = no usable signal.
 */
function computeTouchedPhases(
	args: Record<string, unknown>,
	phases: TodoDetailsPhase[],
	completedTasks: TodoCompletionTransition[],
): Set<string> | null {
	const touched = new Set<string>();
	for (const phase of phases) {
		if (phase.tasks.some(task => task.status === "in_progress")) touched.add(phase.name);
	}
	for (const transition of completedTasks) touched.add(transition.phase);
	for (const op of normalizeTodoOps(args)) {
		if (op.op === "init") {
			for (const phase of phases) touched.add(phase.name);
			break;
		}
		if (typeof op.phase === "string" && op.phase) {
			const named = phases.find(phase => phase.name === op.phase);
			if (named) touched.add(named.name);
		}
		if (typeof op.task === "string" && op.task) {
			const located = phases.find(phase => phase.tasks.some(task => task.content === op.task));
			if (located) touched.add(located.name);
		}
	}
	return touched.size > 0 ? touched : null;
}

const ROMAN_PAIRS: Array<[number, string]> = [
	[1000, "M"],
	[900, "CM"],
	[500, "D"],
	[400, "CD"],
	[100, "C"],
	[90, "XC"],
	[50, "L"],
	[40, "XL"],
	[10, "X"],
	[9, "IX"],
	[5, "V"],
	[4, "IV"],
	[1, "I"],
];

/** One-based ASCII roman numeral for display (I, II, III, IV, …), as in the TUI. */
function phaseRomanNumeral(oneBasedIndex: number): string {
	if (oneBasedIndex <= 0) return "";
	let out = "";
	let rem = oneBasedIndex;
	for (const [value, sym] of ROMAN_PAIRS) {
		while (rem >= value) {
			out += sym;
			rem -= value;
		}
	}
	return out;
}

/**
 * Todo: phase→task tree with status icons, per-phase progress bars,
 * touched-phase emphasis, and just-completed task highlighting. Reads the
 * snapshot from `details.phases` (live partialResult first while streaming).
 */
export function TodoRenderer({ args, result, isError, isPartial, partialResult }: ToolRendererProps) {
	const t = useT();
	const details = resultDetails(result);
	const liveDetails = resultDetails(partialResult);
	const phases = asPhases(details?.phases ?? liveDetails?.phases).filter(phase => phase.tasks.length > 0);
	const completedTasks = asCompletedTasks(details?.completedTasks ?? liveDetails?.completedTasks);

	if (isError) {
		const errorText = resultBodyText(result).trim() || resultBodyText(partialResult).trim();
		return (
			<div className="flex items-start gap-1.5 text-omp-sm text-[var(--omp-error)]">
				<XCircle size={12} className="mt-0.5 shrink-0" />
				<span className="whitespace-pre-wrap">{errorText || t("todoPanel.updateFailed")}</span>
			</div>
		);
	}

	if (phases.length === 0) {
		// Provider text on the fallback path (todo summary or refusal note).
		const fallback = resultBodyText(result).trim() || resultBodyText(partialResult).trim();
		return <div className="text-omp-sm italic text-[var(--omp-dim)]">{fallback || t("tools.todo.empty")}</div>;
	}

	// Tasks that just transitioned to completed, keyed by phase — rendered in
	// success color (instead of dim) to mark the completion transition.
	const justCompletedByPhase = new Map<string, Set<string>>();
	for (const transition of completedTasks) {
		let keys = justCompletedByPhase.get(transition.phase);
		if (!keys) {
			keys = new Set<string>();
			justCompletedByPhase.set(transition.phase, keys);
		}
		keys.add(transition.content);
	}

	const multiPhase = phases.length > 1;
	const touched = multiPhase ? computeTouchedPhases(args, phases, completedTasks) : null;
	const totalTasks = phases.reduce((count, phase) => count + phase.tasks.length, 0);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-1.5 text-omp-sm text-[var(--omp-muted)]">
				<ListTodo size={12} className="text-[var(--omp-dim)]" />
				{t("tools.todo.phases", { count: phases.length, plural: phases.length === 1 ? "" : "s" })}
				<span className="text-[var(--omp-dim)]">·</span>
				{t("tools.todo.tasks", { count: totalTasks, plural: totalTasks === 1 ? "" : "s" })}
				{isPartial && <span className="text-[var(--omp-accent)]">{t("tools.todo.updating")}</span>}
			</div>
			{phases.map((phase, phaseIndex) => {
				const doneCount = phase.tasks.filter(task => task.status === "completed").length;
				const isTouched = touched?.has(phase.name) ?? false;
				const justCompleted = justCompletedByPhase.get(phase.name);
				return (
					<div key={`${phaseIndex}:${phase.name}`}>
						<div className="mb-1 flex items-center gap-2">
							<span
								className={cx(
									"text-omp-sm font-semibold",
									isTouched ? "text-[var(--omp-accent)]" : "text-[var(--omp-text)]",
								)}
							>
								{multiPhase ? `${phaseRomanNumeral(phaseIndex + 1)}. ` : ""}
								{phase.name}
							</span>
							<div
								className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--omp-bg-tertiary)]" // surface-ok: progress bar track
							>
								<div
									className="h-full rounded-full bg-[var(--omp-success)] transition-[width] duration-300"
									style={{ width: `${phase.tasks.length ? (doneCount / phase.tasks.length) * 100 : 0}%` }}
								/>
							</div>
							<span className="font-mono text-omp-xxs tabular-nums text-[var(--omp-dim)]">
								{doneCount}/{phase.tasks.length}
							</span>
						</div>
						<div className="flex flex-col gap-0.5">
							{phase.tasks.map((task, taskIndex) => {
								const meta = STATUS_META[task.status] ?? STATUS_META.pending;
								const Icon = meta.icon;
								const isNewlyCompleted =
									task.status === "completed" && (justCompleted?.has(task.content) ?? false);
								return (
									<div
										key={`${taskIndex}:${task.content}`}
										className="flex items-start gap-1.5 px-1 text-omp-sm"
									>
										<Icon size={12} className="mt-0.5 shrink-0" style={{ color: meta.color }} />
										<span
											className={cx(
												"min-w-0 flex-1 leading-[1.4]",
												task.status === "completed" &&
													(isNewlyCompleted
														? "text-[var(--omp-success)] line-through"
														: "text-[var(--omp-dim)] line-through"),
												task.status === "abandoned" && "text-[var(--omp-dim)] line-through opacity-60",
												task.status === "in_progress" && "text-[var(--omp-text)]",
												(task.status === "pending" || task.status === "blocked") &&
													"text-[var(--omp-muted)]",
											)}
										>
											{task.content}
										</span>
										{task.status === "blocked" && (
											<span className="shrink-0 text-omp-xxs font-medium text-[var(--omp-error)]">
												{task.blocker
													? `${t("todoPanel.status.blocked")}: ${task.blocker}`
													: t("todoPanel.status.blocked")}
											</span>
										)}
									</div>
								);
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
}
