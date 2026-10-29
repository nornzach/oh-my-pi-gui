import { create } from "zustand";
import type {
	RunProgress,
	SchedulerOpenTarget,
	SchedulerSnapshot,
	TaskConfig,
	TaskDraft,
	TaskSaveResult,
} from "../../shared/scheduler-types";
import { translate } from "../lib/i18n";
import { toast } from "./toast";

/**
 * Scheduled tasks in this window (plan/23 §6): the main-process snapshot,
 * live progress of running runs, and the Tasks window's navigation. Main
 * owns every record; this store only mirrors pushes and forwards the user's
 * actions.
 */

export type TasksView = "tasks" | "runs" | "review" | "insights";

export type TaskEditorState =
	| { mode: "create"; initial: TaskDraft }
	| { mode: "edit"; taskId: string; initial: TaskDraft };

interface SchedulerStore {
	snapshot: SchedulerSnapshot | null;
	progress: Record<string, RunProgress>;
	open: boolean;
	view: TasksView;
	selectedTaskId: string | null;
	selectedRunId: string | null;
	editor: TaskEditorState | null;

	/** Subscribe to main's pushes; returns the unsubscribe. Called once per window. */
	connect: () => () => void;
	openTasks: (target?: SchedulerOpenTarget) => void;
	close: () => void;
	setView: (view: TasksView) => void;
	selectTask: (taskId: string | null) => void;
	selectRun: (runId: string | null) => void;
	openEditor: (editor: TaskEditorState) => void;
	closeEditor: () => void;
	save: (draft: TaskDraft, taskId?: string) => Promise<TaskSaveResult>;
	runNow: (taskId: string) => Promise<void>;
	setEnabled: (taskId: string, enabled: boolean) => Promise<void>;
	archive: (taskId: string) => Promise<void>;
	remove: (taskId: string) => Promise<void>;
	cancelRun: (runId: string) => Promise<void>;
	review: (runId: string, decision: "accepted" | "rejected", note?: string) => Promise<boolean>;
	setPaused: (paused: boolean) => Promise<void>;
}

const failed = (error: unknown) =>
	toast({
		variant: "error",
		title: translate("tasks.error.title"),
		message: error instanceof Error ? error.message : String(error),
	});

function configOf(draft: TaskDraft): TaskConfig {
	return {
		title: draft.title,
		prompt: draft.prompt,
		cwd: draft.cwd,
		schedule: draft.schedule,
		model: draft.model,
		tools: draft.tools,
		timeoutMs: draft.timeoutMs,
		verify: draft.verify,
		notify: draft.notify,
	};
}

export const useSchedulerStore = create<SchedulerStore>()((set, get) => ({
	snapshot: null,
	progress: {},
	open: false,
	view: "tasks",
	selectedTaskId: null,
	selectedRunId: null,
	editor: null,

	connect: () => {
		const api = window.omp.scheduler;
		void api.snapshot().then(
			snapshot => set({ snapshot }),
			() => {},
		);
		const unsubscribers = [
			api.onSnapshot(snapshot =>
				set(state => {
					// Progress only lives while a run does; drop entries for runs that ended.
					const running = new Set(snapshot.runs.filter(run => run.state === "running").map(run => run.id));
					const progress: Record<string, RunProgress> = {};
					for (const [runId, value] of Object.entries(state.progress))
						if (running.has(runId)) progress[runId] = value;
					return { snapshot, progress };
				}),
			),
			api.onProgress((runId, progress) => set(state => ({ progress: { ...state.progress, [runId]: progress } }))),
			api.onOpen(target => get().openTasks(target)),
		];
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	},

	openTasks: target => {
		const view = target?.view ?? (target?.runId ? "runs" : get().view);
		set({
			open: true,
			view,
			selectedTaskId: target?.taskId ?? get().selectedTaskId,
			selectedRunId: target?.runId ?? (view === "runs" || view === "review" ? get().selectedRunId : null),
		});
	},
	close: () => set({ open: false, editor: null }),
	setView: view => set({ view, selectedRunId: null }),
	selectTask: taskId => set({ selectedTaskId: taskId }),
	selectRun: runId => set({ selectedRunId: runId }),
	openEditor: editor => set({ editor }),
	closeEditor: () => set({ editor: null }),

	save: async (draft, taskId) => {
		const api = window.omp.scheduler;
		const result = taskId ? await api.update(taskId, configOf(draft)) : await api.create(draft);
		// A new task opens in the Tasks view, wherever it was created from.
		if (result.ok)
			set(taskId ? { selectedTaskId: result.task.id } : { selectedTaskId: result.task.id, view: "tasks" });
		return result;
	},
	runNow: async taskId => {
		try {
			const run = await window.omp.scheduler.runNow(taskId);
			if (run) toast({ variant: "info", message: translate("tasks.toast.started") });
		} catch (error) {
			failed(error);
		}
	},
	setEnabled: async (taskId, enabled) => {
		try {
			const result = await window.omp.scheduler.setEnabled(taskId, enabled);
			if (!result.ok) {
				toast({
					variant: "warning",
					message: result.problems.map(problem => translate(`tasks.problem.${problem}`)).join(" "),
				});
			}
		} catch (error) {
			failed(error);
		}
	},
	archive: async taskId => {
		try {
			await window.omp.scheduler.archive(taskId, true);
		} catch (error) {
			failed(error);
		}
	},
	remove: async taskId => {
		try {
			await window.omp.scheduler.remove(taskId);
			if (get().selectedTaskId === taskId) set({ selectedTaskId: null });
		} catch (error) {
			failed(error);
		}
	},
	cancelRun: async runId => {
		try {
			await window.omp.scheduler.cancelRun(runId);
		} catch (error) {
			failed(error);
		}
	},
	review: async (runId, decision, note) => {
		try {
			return (await window.omp.scheduler.review(runId, decision, note)) !== null;
		} catch (error) {
			failed(error);
			return false;
		}
	},
	setPaused: async paused => {
		try {
			await window.omp.scheduler.setPaused(paused);
		} catch (error) {
			failed(error);
		}
	},
}));
