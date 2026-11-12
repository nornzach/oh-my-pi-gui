import { createStore } from "zustand/vanilla";
import type { AgentMessage, TodoPhase, TodoTask } from "../../shared/rpc-types";
import { messageTimestampMs } from "../lib/message-identity";
import { createScopedStoreHook } from "./session-runtime-context";

export interface UiTodoTask extends TodoTask {
	id: string;
}

export interface UiTodoPhase extends Omit<TodoPhase, "tasks"> {
	id: string;
	tasks: UiTodoTask[];
}

/**
 * One archived todo state: appended whenever the phases actually change after
 * the session's first hydration, rendered as a transcript snapshot row. The
 * first setPhases after a reset is hydration (get_state pull), never a
 * change; later identical re-applies (every agent_end re-pulls state) are
 * deduped by semantic fingerprint so the archive only carries real edits.
 */
export interface TodoSnapshot {
	id: string;
	ts: number;
	phases: TodoPhase[];
}

/** Archive cap — the transcript keeps the newest snapshots, drops the oldest. */
const HISTORY_LIMIT = 30;

export interface TodoStore {
	phases: UiTodoPhase[];
	reminderVisible: boolean;
	reminderTodos: TodoTask[];
	/** Change archive since the session's first hydration (transcript rows). */
	history: TodoSnapshot[];
	/** False until the first post-reset setPhases — that one is hydration, not a change. */
	historyHydrated: boolean;
	setPhases: (phases: TodoPhase[]) => void;
	/** Restore the archive a reopened session's transcript implies; a live archive wins. */
	seedHistory: (history: TodoSnapshot[]) => void;
	autoClearCompleted: () => void;
	showReminder: (todos: TodoTask[]) => void;
	clearReminder: () => void;
	reset: () => void;
}

const initialState = {
	phases: [] as UiTodoPhase[],
	reminderVisible: false,
	reminderTodos: [] as TodoTask[],
	history: [] as TodoSnapshot[],
	historyHydrated: false,
};

function normalizePhases(phases: TodoPhase[]): UiTodoPhase[] {
	return phases.map((phase, phaseIndex) => {
		const existingPhaseId = "id" in phase && typeof phase.id === "string" ? phase.id : null;
		const phaseId = existingPhaseId ?? `phase:${phaseIndex}:${phase.name}`;
		return {
			...phase,
			id: phaseId,
			tasks: phase.tasks.map((task, taskIndex) => ({
				...task,
				id: "id" in task && typeof task.id === "string" ? task.id : `${phaseId}:task:${taskIndex}`,
			})),
		};
	});
}

/** Semantic identity of a phase list — ids are UI-assigned and must not count as change. */
function fingerprintPhases(
	phases: readonly { name: string; tasks: readonly { content: string; status: string }[] }[],
): string {
	return JSON.stringify(phases.map(phase => [phase.name, phase.tasks.map(task => [task.content, task.status])]));
}

/** Todo identity without progress — status-only changes update one transcript row. */
function fingerprintTodo(phases: readonly { name: string; tasks: readonly { content: string }[] }[]): string {
	return JSON.stringify(phases.map(phase => [phase.name, phase.tasks.map(task => task.content)]));
}

/**
 * A task status as the GUI tracks it. Saved sessions from before omp 18.19 can
 * still carry `blocked`, which the agent now restores as pending; reading it
 * the same way keeps those sessions' todo history instead of dropping it.
 */
function todoStatusOf(value: unknown): TodoTask["status"] | undefined {
	if (value === "blocked") return "pending";
	return value === "pending" || value === "in_progress" || value === "completed" || value === "abandoned"
		? value
		: undefined;
}

function todoTaskOf(value: unknown): TodoTask | undefined {
	if (typeof value !== "object" || value === null || !("content" in value) || typeof value.content !== "string")
		return undefined;
	const status = "status" in value ? todoStatusOf(value.status) : undefined;
	return status ? { ...value, content: value.content, status } : undefined;
}

function todoPhaseOf(value: unknown): TodoPhase | undefined {
	if (typeof value !== "object" || value === null || !("name" in value) || typeof value.name !== "string")
		return undefined;
	if (!("tasks" in value) || !Array.isArray(value.tasks)) return undefined;
	const tasks = value.tasks.map(todoTaskOf);
	return tasks.every(task => task !== undefined) ? { name: value.name, tasks } : undefined;
}

/** The phases a `todo` tool result carries, live or saved; undefined when it carries none. */
export function todoPhasesFromToolResult(result: unknown): TodoPhase[] | undefined {
	if (typeof result !== "object" || result === null || !("details" in result)) return undefined;
	const details = result.details;
	if (typeof details !== "object" || details === null || !("phases" in details)) return undefined;
	if (!Array.isArray(details.phases)) return undefined;
	const phases = details.phases.map(todoPhaseOf);
	return phases.every(phase => phase !== undefined) ? phases : undefined;
}

/**
 * The archive once `phases` replaced the previous state at `ts`: a status-only
 * change updates the last row in place, a changed todo list appends one.
 */
function archiveChange(history: readonly TodoSnapshot[], phases: readonly TodoPhase[], ts: number): TodoSnapshot[] {
	const archivedPhases = phases.map(phase => ({
		name: phase.name,
		tasks: phase.tasks.map(task => ({ content: task.content, status: task.status })),
	}));
	const previous = history.at(-1);
	const next =
		previous && fingerprintTodo(previous.phases) === fingerprintTodo(archivedPhases)
			? [...history.slice(0, -1), { ...previous, phases: archivedPhases }]
			: [...history, { id: `todo-snapshot-${ts}-${history.length}`, ts, phases: archivedPhases }];
	if (next.length > HISTORY_LIMIT) next.shift();
	return next;
}

/**
 * The archive a transcript implies: each successful `todo` result that changed
 * the plan, archived the way the live tab archived it. A reopened session gets
 * back the "Todos updated" rows its live tab showed.
 */
export function todoHistoryFromMessages(messages: readonly AgentMessage[]): TodoSnapshot[] {
	let history: TodoSnapshot[] = [];
	let current = fingerprintPhases([]);
	for (const message of messages) {
		if (message.role !== "toolResult" || message.toolName !== "todo" || message.isError) continue;
		const phases = todoPhasesFromToolResult(message);
		if (!phases || fingerprintPhases(phases) === current) continue;
		history = archiveChange(history, phases, messageTimestampMs(message));
		current = fingerprintPhases(phases);
	}
	return history;
}

export const createTodoStore = () =>
	createStore<TodoStore>()((set, get) => ({
		...initialState,
		setPhases: phases => {
			const state = get();
			const next = normalizePhases(phases);
			if (!state.historyHydrated || fingerprintPhases(next) === fingerprintPhases(state.phases)) {
				set({ phases: next, historyHydrated: true });
				return;
			}
			set({ phases: next, history: archiveChange(state.history, next, Date.now()), historyHydrated: true });
		},
		seedHistory: history => {
			if (get().history.length === 0 && history.length > 0) set({ history });
		},
		autoClearCompleted: () =>
			set({
				phases: [],
				reminderVisible: false,
				reminderTodos: [],
				historyHydrated: true,
			}),
		showReminder: todos => set({ reminderVisible: true, reminderTodos: todos }),
		clearReminder: () => set({ reminderVisible: false, reminderTodos: [] }),
		reset: () => set(initialState),
	}));

const defaultTodoStore = createTodoStore();
export const useTodoStore = createScopedStoreHook("todo", defaultTodoStore);
