/**
 * Todo dock card: the live todo list rendered in the center dock above the
 * composer (previously the workspace drawer's todo tab). Phases as
 * collapsible sections, status badges, inline edit on double-click, drag
 * reorder via @dnd-kit, persisted through the set_todos RPC. Renders nothing
 * when the session has no todos and no reminder pending.
 */

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
	AlertCircle,
	AlertTriangle,
	Check,
	CheckCircle2,
	ChevronRight,
	Circle,
	GripVertical,
	ListTodo,
	Pencil,
	X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { TodoPhase, TodoTask } from "../../../../shared/rpc-types";
import { useT } from "../../../lib/i18n";
import { isImeKeyEvent } from "../../../lib/ime";
import { onEscape } from "../../../lib/keymap";
import { type TabRpc, useTabRpc } from "../../../lib/tab-rpc";
import { toast } from "../../../stores/toast";
import { type UiTodoPhase, type UiTodoTask, useTodoStore } from "../../../stores/todo";
import { DockCard } from "./DockCard";
import { buildTodoDockSummary } from "./dock-summary";
import { useWorkspaceDockFocus } from "./WorkspaceDockFocus";

const STATUS_LABEL_KEY: Record<TodoTask["status"], string> = {
	pending: "todoPanel.status.pending",
	in_progress: "todoPanel.status.inProgress",
	completed: "todoPanel.status.completed",
	blocked: "todoPanel.status.blocked",
	abandoned: "todoPanel.status.abandoned",
};

const STATUS_CYCLE: TodoTask["status"][] = ["pending", "in_progress", "completed", "blocked", "abandoned"];

function TodoStatusIcon({ status }: { status: TodoTask["status"] }) {
	if (status === "in_progress") {
		return <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--omp-link)]" />;
	}
	if (status === "completed") {
		return <CheckCircle2 aria-hidden="true" className="text-[var(--omp-muted)]" size={15} />;
	}
	if (status === "blocked" || status === "abandoned") {
		return <AlertCircle aria-hidden="true" className="text-[var(--omp-error)]" size={15} />;
	}
	return <Circle aria-hidden="true" className="text-[var(--omp-dim)]" size={15} strokeDasharray="2.5 2.5" />;
}

async function pushTodos(phases: UiTodoPhase[], t: (key: string) => string, rpc: TabRpc): Promise<void> {
	const payload: TodoPhase[] = phases.map(phase => ({
		name: phase.name,
		tasks: phase.tasks.map(task => ({ content: task.content, status: task.status })),
	}));
	const response = await rpc.setTodos(payload);
	if (!response.success) {
		toast({ variant: "error", title: t("todoPanel.updateFailed"), message: response.error });
	}
}

interface SortableTaskRowProps {
	task: UiTodoTask;
	phaseId: string;
	onPatch: (phaseId: string, taskId: string, patch: Partial<UiTodoTask>) => void;
}

const SortableTaskRow = memo(function SortableTaskRow({ task, phaseId, onPatch }: SortableTaskRowProps) {
	const t = useT();
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(task.content);
	const commit = () => {
		const content = draft.trim();
		setEditing(false);
		if (content && content !== task.content) onPatch(phaseId, task.id, { content });
		else setDraft(task.content);
	};

	return (
		<div
			className={`group flex min-h-8 items-center gap-2 rounded-lg py-1 pr-1 pl-0.5 text-omp-lg transition-colors ${
				isDragging ? "z-10 bg-(--omp-selected-bg) shadow-md shadow-black/30" : "hover:bg-(--omp-bg-tertiary)"
			}`}
			ref={setNodeRef}
			style={{
				transform: transform
					? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
					: undefined,
				transition,
			}}
		>
			<button
				aria-label={t("todoPanel.reorder")}
				className="cursor-grab text-(--omp-dim) opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
				{...attributes}
				{...listeners}
				type="button"
			>
				<GripVertical size={12} />
			</button>
			<button
				aria-label={t("todoPanel.statusAria", {
					status: t(STATUS_LABEL_KEY[task.status] ?? "todoPanel.status.pending"),
				})}
				className="omp-pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
				onClick={() =>
					onPatch(phaseId, task.id, {
						status: STATUS_CYCLE[(STATUS_CYCLE.indexOf(task.status) + 1) % STATUS_CYCLE.length],
					})
				}
				title={t("todoPanel.cycleHint")}
				type="button"
			>
				<TodoStatusIcon status={task.status} />
			</button>
			{editing ? (
				<span className="flex min-w-0 flex-1 items-center gap-1">
					<input
						autoFocus
						className="w-full min-w-0 rounded border border-(--omp-border-accent) bg-(--omp-input-bg) px-1.5 py-0.5 text-xs text-(--omp-text) focus:outline-none"
						onBlur={commit}
						onChange={event => setDraft(event.target.value)}
						onKeyDown={event => {
							if (isImeKeyEvent(event)) return;
							if (event.key === "Enter") commit();
							onEscape(event, () => {
								setDraft(task.content);
								setEditing(false);
							});
						}}
						value={draft}
					/>
					<button aria-label={t("common.save")} className="text-(--omp-success)" onClick={commit} type="button">
						<Check size={12} />
					</button>
					<button
						aria-label={t("common.cancel")}
						className="text-(--omp-muted)"
						onClick={() => {
							setDraft(task.content);
							setEditing(false);
						}}
						type="button"
					>
						<X size={12} />
					</button>
				</span>
			) : (
				<>
					<span
						className={`min-w-0 flex-1 truncate ${
							task.status === "abandoned"
								? "text-(--omp-dim) line-through"
								: task.status === "completed"
									? "text-(--omp-muted)"
									: "text-(--omp-text)"
						}`}
						onDoubleClick={() => {
							setDraft(task.content);
							setEditing(true);
						}}
						title={task.content}
					>
						{task.content}
					</span>
					<button
						aria-label={t("todoPanel.edit")}
						className="shrink-0 text-(--omp-dim) opacity-0 transition-opacity group-hover:opacity-100 hover:text-(--omp-text)"
						onClick={() => {
							setDraft(task.content);
							setEditing(true);
						}}
						type="button"
					>
						<Pencil size={11} />
					</button>
				</>
			)}
		</div>
	);
});

function PhaseSection({
	phase,
	fullPhase,
	hideHeader,
	collapsed,
	onToggle,
	onPatch,
}: {
	phase: UiTodoPhase;
	fullPhase?: UiTodoPhase;
	hideHeader: boolean;
	collapsed: boolean;
	onToggle: () => void;
	onPatch: (phaseId: string, taskId: string, patch: Partial<UiTodoTask>) => void;
}) {
	const t = useT();
	const countSource = fullPhase ?? phase;
	const done = countSource.tasks.filter(task => task.status === "completed").length;
	const total = countSource.tasks.length;

	return (
		<section className="mb-1.5">
			{!hideHeader && (
				<button
					aria-expanded={!collapsed}
					className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-(--omp-bg-tertiary)"
					onClick={onToggle}
					type="button"
				>
					<ChevronRight
						className="omp-disclosure-chevron shrink-0 text-(--omp-dim)"
						size={12}
						style={{ transform: collapsed ? undefined : "rotate(90deg)" }}
					/>
					<span className="min-w-0 flex-1 truncate text-omp-sm font-semibold tracking-wide text-(--omp-accent) uppercase">
						{phase.name}
					</span>
					<span className="shrink-0 text-omp-xs tabular-nums text-(--omp-dim)">
						{done}/{total}
					</span>
				</button>
			)}
			{(hideHeader || !collapsed) && (
				<SortableContext items={phase.tasks.map(task => task.id)} strategy={verticalListSortingStrategy}>
					<div className={hideHeader ? "px-0.5" : "ml-2 border-l border-(--omp-border-muted) pl-2"}>
						{phase.tasks.map(task => (
							<SortableTaskRow key={task.id} onPatch={onPatch} phaseId={phase.id} task={task} />
						))}
						{total === 0 && (
							<div className="py-1 text-omp-sm text-(--omp-dim) italic">{t("todoPanel.noTasks")}</div>
						)}
					</div>
				</SortableContext>
			)}
		</section>
	);
}

export function TodoDockCard() {
	const rpc = useTabRpc();
	const t = useT();
	const { managed, focusedCard, focusCard, clearFocus } = useWorkspaceDockFocus();
	const focused = focusedCard === "todo";
	const showFull = !managed || focused;
	const phases = useTodoStore(state => state.phases) ?? [];
	const reminderVisible = useTodoStore(state => state.reminderVisible) ?? false;
	const reminderTodos = useTodoStore(state => state.reminderTodos) ?? [];
	const clearReminder = useTodoStore(state => state.clearReminder);
	const setPhases = useTodoStore(state => state.setPhases);

	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const applyPhases = useCallback(
		(next: UiTodoPhase[]) => {
			setPhases(next);
			void pushTodos(next, t, rpc);
		},
		[setPhases, t, rpc],
	);

	const patchTask = useCallback(
		(phaseId: string, taskId: string, patch: Partial<UiTodoTask>) => {
			const next = phases.map(phase =>
				phase.id !== phaseId
					? phase
					: {
							...phase,
							tasks: phase.tasks.map(task => (task.id === taskId ? { ...task, ...patch } : task)),
						},
			);
			applyPhases(next);
		},
		[phases, applyPhases],
	);

	const onDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			if (!over || active.id === over.id) return;
			const phase = phases.find(p => p.tasks.some(task => task.id === active.id));
			if (!phase) return;
			const from = phase.tasks.findIndex(task => task.id === active.id);
			const to = phase.tasks.findIndex(task => task.id === over.id);
			if (from < 0 || to < 0) return;
			applyPhases(phases.map(p => (p.id === phase.id ? { ...p, tasks: arrayMove(p.tasks, from, to) } : p)));
		},
		[phases, applyPhases],
	);

	const togglePhase = useCallback((id: string) => {
		setCollapsed(prev => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const taskCounts = useMemo(() => {
		const tasks = phases.flatMap(phase => phase.tasks);
		return {
			running: tasks.filter(task => task.status === "in_progress").length,
			pending: tasks.filter(task => task.status === "pending" || task.status === "blocked").length,
			completed: tasks.filter(task => task.status === "completed").length,
		};
	}, [phases]);
	const taskSummary =
		taskCounts.running > 0 && taskCounts.pending > 0
			? t("dock.todo.runningAndPending", taskCounts)
			: taskCounts.running > 0
				? t("dock.todo.running", taskCounts)
				: taskCounts.pending > 0
					? t("dock.todo.pending", taskCounts)
					: t("dock.todo.completed", taskCounts);
	const summary = useMemo(() => buildTodoDockSummary(phases), [phases]);
	const displayedPhases = showFull ? phases : summary.phases;

	useEffect(() => {
		if (focused && phases.length === 0 && !reminderVisible) clearFocus();
	}, [clearFocus, focused, phases.length, reminderVisible]);

	if (phases.length === 0 && !reminderVisible) return null;

	return (
		<DockCard
			badge={
				<span className="min-w-0 truncate text-omp-lg tabular-nums text-[var(--omp-muted)]">{taskSummary}</span>
			}
			icon={ListTodo}
			id="todo"
			title={t("dock.todo")}
		>
			<div className="px-2 py-1.5">
				{reminderVisible && (
					<div className="mb-1.5 flex items-start gap-2 rounded-md border border-[color-mix(in_srgb,var(--omp-warning)_40%,transparent)] bg-transparent px-2.5 py-2">
						<AlertTriangle className="mt-px shrink-0 text-(--omp-warning)" size={13} />
						<div className="min-w-0 flex-1 text-omp-sm leading-snug text-(--omp-warning)">
							<span className="font-semibold">{t("todoPanel.reminder")}</span>
							<span className="text-(--omp-muted)">
								{` — ${t("todoPanel.reminderCount", { count: reminderTodos.length })}`}
							</span>
						</div>
						<button
							aria-label={t("todoPanel.dismissReminder")}
							className="shrink-0 text-(--omp-warning) opacity-70 transition-opacity hover:opacity-100"
							onClick={clearReminder}
							type="button"
						>
							<X size={12} />
						</button>
					</div>
				)}
				<DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} sensors={sensors}>
					{displayedPhases.map(phase => (
						<PhaseSection
							collapsed={collapsed.has(phase.id)}
							fullPhase={phases.find(candidate => candidate.id === phase.id)}
							hideHeader={displayedPhases.length === 1}
							key={phase.id}
							onPatch={patchTask}
							onToggle={() => togglePhase(phase.id)}
							phase={phase}
						/>
					))}
				</DndContext>
				{managed && !focused && summary.hiddenCount > 0 && (
					<button
						className="omp-pressable mt-1 flex w-full items-center justify-center rounded-md border border-dashed border-[var(--omp-border-muted)] px-2 py-1.5 text-omp-xs font-medium text-[var(--omp-link)] hover:border-[var(--omp-border-strong)]"
						onClick={() => focusCard("todo")}
						type="button"
					>
						{t("dock.viewAllTodos", { hidden: summary.hiddenCount, total: summary.totalCount })}
					</button>
				)}
			</div>
		</DockCard>
	);
}
