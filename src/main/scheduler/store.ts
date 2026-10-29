/**
 * scheduler.db: tasks, their frozen revisions, the run ledger and scheduler
 * meta (heartbeat, global pause). Records are stored as JSON next to the few
 * columns queries filter on, so the shapes in scheduler-types.ts stay the one
 * source of truth.
 */

import { DatabaseSync } from "node:sqlite";
import type { RunState, ScheduledTask, TaskConfig, TaskRun } from "../../shared/scheduler-types";
import { storedDepth } from "../../shared/task-depth";

const SCHEMA_VERSION = "1";

/** A task as stored: everything except the computed `nextFireAt`. */
export type StoredTask = Omit<ScheduledTask, "nextFireAt">;

/** Runs that have not reached a final state. */
export const LIVE_RUN_STATES: readonly RunState[] = ["queued", "running"];

export class SchedulerStore {
	readonly #db: DatabaseSync;

	constructor(dbPath: string) {
		this.#db = new DatabaseSync(dbPath);
		this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
		this.#db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
		const version = this.getMeta("schema");
		if (version !== null && version !== SCHEMA_VERSION) {
			throw new Error(`scheduler.db schema ${version} is newer than this build understands (${SCHEMA_VERSION})`);
		}
		this.#db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
	id TEXT PRIMARY KEY,
	state TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_revisions (
	task_id TEXT NOT NULL,
	revision INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	data TEXT NOT NULL,
	PRIMARY KEY (task_id, revision)
);
CREATE TABLE IF NOT EXISTS runs (
	id TEXT PRIMARY KEY,
	task_id TEXT NOT NULL,
	state TEXT NOT NULL,
	review_state TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_by_task ON runs (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS runs_by_time ON runs (created_at DESC);`);
		this.setMeta("schema", SCHEMA_VERSION);
	}

	close(): void {
		this.#db.close();
	}

	getMeta(key: string): string | null {
		const row = this.#db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
		return row?.value ?? null;
	}

	setMeta(key: string, value: string): void {
		this.#db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
	}

	// ---------------------------------------------------------------- tasks

	listTasks(): StoredTask[] {
		const rows = this.#db.prepare("SELECT data FROM tasks ORDER BY created_at ASC").all() as { data: string }[];
		return rows.map(row => withDefaults(JSON.parse(row.data) as StoredTask));
	}

	getTask(id: string): StoredTask | null {
		const row = this.#db.prepare("SELECT data FROM tasks WHERE id = ?").get(id) as { data: string } | undefined;
		return row ? withDefaults(JSON.parse(row.data) as StoredTask) : null;
	}

	/** Insert or replace; a new revision number also freezes that revision's config. */
	saveTask(task: StoredTask): void {
		const exists = this.#db
			.prepare("SELECT 1 AS present FROM task_revisions WHERE task_id = ? AND revision = ?")
			.get(task.id, task.revision);
		this.#db
			.prepare("INSERT OR REPLACE INTO tasks (id, state, created_at, data) VALUES (?, ?, ?, ?)")
			.run(task.id, task.state, task.createdAt, JSON.stringify(task));
		if (!exists) {
			this.#db
				.prepare("INSERT INTO task_revisions (task_id, revision, created_at, data) VALUES (?, ?, ?, ?)")
				.run(task.id, task.revision, task.updatedAt, JSON.stringify(configOf(task)));
		}
	}

	getRevision(taskId: string, revision: number): TaskConfig | null {
		const row = this.#db
			.prepare("SELECT data FROM task_revisions WHERE task_id = ? AND revision = ?")
			.get(taskId, revision) as { data: string } | undefined;
		return row ? withDefaults(JSON.parse(row.data) as TaskConfig) : null;
	}

	listRevisions(taskId: string): { revision: number; createdAt: number; config: TaskConfig }[] {
		const rows = this.#db
			.prepare("SELECT revision, created_at, data FROM task_revisions WHERE task_id = ? ORDER BY revision DESC")
			.all(taskId) as { revision: number; created_at: number; data: string }[];
		return rows.map(row => ({
			revision: row.revision,
			createdAt: row.created_at,
			config: withDefaults(JSON.parse(row.data) as TaskConfig),
		}));
	}

	/** Remove a task with its revisions and runs. */
	deleteTask(id: string): void {
		this.#db.prepare("DELETE FROM runs WHERE task_id = ?").run(id);
		this.#db.prepare("DELETE FROM task_revisions WHERE task_id = ?").run(id);
		this.#db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
	}

	// ----------------------------------------------------------------- runs

	saveRun(run: TaskRun): void {
		const stored: TaskRun = { ...run, progress: undefined };
		this.#db
			.prepare(
				"INSERT OR REPLACE INTO runs (id, task_id, state, review_state, created_at, data) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(run.id, run.taskId, run.state, run.review.state, run.createdAt, JSON.stringify(stored));
	}

	getRun(id: string): TaskRun | null {
		const row = this.#db.prepare("SELECT data FROM runs WHERE id = ?").get(id) as { data: string } | undefined;
		return row ? (JSON.parse(row.data) as TaskRun) : null;
	}

	deleteRun(id: string): void {
		this.#db.prepare("DELETE FROM runs WHERE id = ?").run(id);
	}

	/** Newest first. */
	listRuns(options: { taskId?: string; since?: number; limit?: number } = {}): TaskRun[] {
		const where: string[] = [];
		const params: (string | number)[] = [];
		if (options.taskId) {
			where.push("task_id = ?");
			params.push(options.taskId);
		}
		if (options.since !== undefined) {
			where.push("created_at >= ?");
			params.push(options.since);
		}
		const sql = `SELECT data FROM runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
		params.push(options.limit ?? 500);
		const rows = this.#db.prepare(sql).all(...params) as { data: string }[];
		return rows.map(row => JSON.parse(row.data) as TaskRun);
	}

	/** The latest slot the ledger holds for a task, whatever became of it. */
	lastScheduledFor(taskId: string): number | null {
		const row = this.#db
			.prepare("SELECT MAX(json_extract(data, '$.scheduledFor')) AS at FROM runs WHERE task_id = ?")
			.get(taskId) as { at: number | null } | undefined;
		return row?.at ?? null;
	}

	listRunsInStates(states: readonly string[]): TaskRun[] {
		if (states.length === 0) return [];
		const marks = states.map(() => "?").join(", ");
		const rows = this.#db
			.prepare(`SELECT data FROM runs WHERE state IN (${marks}) ORDER BY created_at ASC`)
			.all(...states) as { data: string }[];
		return rows.map(row => JSON.parse(row.data) as TaskRun);
	}

	listPendingReview(): TaskRun[] {
		const rows = this.#db
			.prepare("SELECT data FROM runs WHERE review_state = 'pending' ORDER BY created_at ASC")
			.all() as { data: string }[];
		return rows.map(row => JSON.parse(row.data) as TaskRun);
	}

	countPendingReview(): number {
		const row = this.#db.prepare("SELECT COUNT(*) AS count FROM runs WHERE review_state = 'pending'").get() as {
			count: number;
		};
		return row.count;
	}

	/** Runs created before `before`, oldest first: the retention sweep's candidates. */
	listRunsBefore(before: number): TaskRun[] {
		const rows = this.#db
			.prepare("SELECT data FROM runs WHERE created_at < ? ORDER BY created_at ASC")
			.all(before) as { data: string }[];
		return rows.map(row => JSON.parse(row.data) as TaskRun);
	}

	/** Every session file a run wrote, for keeping run sessions out of the sidebar. */
	runSessionPaths(): Set<string> {
		const paths = new Set<string>();
		const rows = this.#db.prepare("SELECT data FROM runs").all() as { data: string }[];
		for (const row of rows) {
			const run = JSON.parse(row.data) as TaskRun;
			if (run.sessionPath) paths.add(run.sessionPath);
		}
		return paths;
	}
}

/** Fill in settings added after a record was saved. */
function withDefaults<T extends TaskConfig>(record: T): T {
	return { ...record, depth: storedDepth(record.depth) };
}

export function configOf(task: TaskConfig): TaskConfig {
	return {
		title: task.title,
		prompt: task.prompt,
		cwd: task.cwd,
		schedule: task.schedule,
		model: task.model,
		tools: task.tools,
		depth: task.depth,
		timeoutMs: task.timeoutMs,
		verify: task.verify,
		notify: task.notify,
	};
}
