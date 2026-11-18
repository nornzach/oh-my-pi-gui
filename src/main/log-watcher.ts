/**
 * Tails ~/.omp/logs/omp.*.log files.
 * Uses fs.watch + createReadStream from last offset, with a directory
 * watcher for new-file discovery. A slow 15s poll is the safety net for
 * platforms where fs.watch is unreliable or a watcher silently detaches
 * (file replaced). Lines are batched: delivered via onLines at most every
 * 150ms instead of one callback per line. Maintains a 1000-line ring buffer.
 *
 * Every process writes its own dated file, so the directory only grows. Files
 * untouched for a day are not watched (each watch holds a file handle, and a
 * long-lived install had hundreds); a write to one brings it back through the
 * directory watcher.
 */
import { createReadStream, type FSWatcher, type Stats, watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { LogBatch } from "../shared/ipc-types";
import { agentDir } from "./agent-paths";

const RING_BUFFER_SIZE = 1000;
const FLUSH_INTERVAL_MS = 150;
const FALLBACK_POLL_MS = 15_000;
/** A log file untouched this long belongs to a process that is gone. */
const IDLE_LOG_MS = 24 * 60 * 60 * 1000;

interface WatchedFile {
	path: string;
	offset: number;
	watcher: FSWatcher | null;
	reading: boolean;
	partial: string;
}

export class LogWatcher {
	#logsDir: string;
	#files = new Map<string, WatchedFile>();
	/** Log files left unwatched because nothing has written them for a day, with their size then. */
	#idle = new Map<string, number>();
	#buffer: string[] = [];
	#pending: string[] = [];
	#sequence = 0;
	#flushTimer: NodeJS.Timeout | null = null;
	#pollTimer: NodeJS.Timeout | null = null;
	#dirWatcher: FSWatcher | null = null;
	#running = false;

	onLines: ((lines: string[]) => void) | null = null;

	constructor(logsDir?: string) {
		this.#logsDir = logsDir ?? join(agentDir(), "..", "logs");
	}

	async start(): Promise<void> {
		if (this.#running) return;
		this.#running = true;
		await this.#discoverFiles();
		if (!this.#running) return;
		this.#watchDirectory();
		// Safety net only — fs.watch drives the hot path.
		this.#pollTimer = setInterval(() => this.#poll(), FALLBACK_POLL_MS);
	}

	stop(): void {
		this.#running = false;
		if (this.#pollTimer) {
			clearInterval(this.#pollTimer);
			this.#pollTimer = null;
		}
		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}
		this.#flush();
		this.#dirWatcher?.close();
		this.#dirWatcher = null;
		for (const file of this.#files.values()) {
			file.watcher?.close();
		}
		this.#files.clear();
		this.#idle.clear();
		this.#buffer = [];
	}

	getBuffer(): string[] {
		return [...this.#buffer];
	}

	getSnapshot(): LogBatch {
		return { lines: this.getBuffer(), nextSequence: this.#sequence };
	}

	async #discoverFiles(): Promise<void> {
		try {
			const entries = await readdir(this.#logsDir);
			for (const entry of entries) {
				if (entry.startsWith("omp.") && entry.endsWith(".log")) {
					const fullPath = join(this.#logsDir, entry);
					if (!this.#files.has(fullPath)) {
						await this.#watchFile(fullPath);
					}
				}
			}
		} catch {
			// Directory may not exist yet
		}
	}

	/** Watch the logs directory itself so new/rotated log files are picked up. */
	#watchDirectory(): void {
		try {
			const watcher = watch(this.#logsDir, (_eventType, filename) => {
				if (!filename?.startsWith("omp.") || !filename.endsWith(".log")) return;
				const fullPath = join(this.#logsDir, filename);
				if (!this.#files.has(fullPath)) {
					// Something just wrote it, so an idle file is live again from where it stopped.
					void this.#watchFile(fullPath);
				}
			});
			watcher.on("error", () => {
				watcher.close();
				if (this.#dirWatcher === watcher) this.#dirWatcher = null;
			});
			this.#dirWatcher = watcher;
		} catch {
			// Logs dir may not exist yet; the fallback poll keeps discovering.
		}
	}

	/** Promote an idle file from its last offset, even if two directory events arrive together. */
	async #watchFile(filePath: string): Promise<void> {
		let fileStat: Stats;
		try {
			fileStat = await stat(filePath);
		} catch {
			return;
		}

		if (!this.#running || this.#files.has(filePath)) return;
		const resumeAt = this.#idle.get(filePath);
		if (Date.now() - fileStat.mtimeMs > IDLE_LOG_MS && (resumeAt === undefined || resumeAt === fileStat.size)) {
			this.#idle.set(filePath, fileStat.size);
			return;
		}
		this.#idle.delete(filePath);
		const watched: WatchedFile = {
			path: filePath,
			// Start from the end (only new content), or where an idle file left off.
			offset: resumeAt !== undefined && resumeAt <= fileStat.size ? resumeAt : fileStat.size,
			watcher: null,
			reading: false,
			partial: "",
		};

		try {
			const watcher = watch(filePath, eventType => {
				if (eventType === "change") {
					this.#readNewContent(watched);
				}
			});
			watcher.on("error", () => {
				// fs.watch unreliable; the fallback poll covers this file
				watcher.close();
				watched.watcher = null;
			});
			watched.watcher = watcher;
		} catch {
			// Fall back to polling only
		}

		this.#files.set(filePath, watched);
		// A woken file was written before its watcher existed; read that write now.
		if (watched.offset < fileStat.size) void this.#readNewContent(watched);
	}

	/** Stop watching a file nothing has written for a day. */
	#retire(file: WatchedFile): void {
		file.watcher?.close();
		this.#files.delete(file.path);
		this.#idle.set(file.path, file.offset);
	}

	#poll(): void {
		if (!this.#running) return;
		this.#discoverFiles();
		for (const file of this.#files.values()) {
			this.#readNewContent(file);
		}
	}

	async #readNewContent(file: WatchedFile): Promise<void> {
		if (file.reading || !this.#running) return;
		file.reading = true;
		try {
			const fileStat = await stat(file.path);
			if (fileStat.size < file.offset) {
				file.offset = 0;
				file.partial = "";
			}
			if (fileStat.size === file.offset) {
				if (Date.now() - fileStat.mtimeMs > IDLE_LOG_MS) this.#retire(file);
				return;
			}
			const stream = createReadStream(file.path, { start: file.offset, end: fileStat.size - 1, encoding: "utf-8" });
			let text = file.partial;
			for await (const chunk of stream) text += chunk;
			if (!this.#running) return;
			const lines = text.split("\n");
			file.partial = lines.pop() ?? "";
			file.offset = fileStat.size;
			for (const line of lines) if (line.trim()) this.#pushLine(line);
		} catch {
			// A rotated or temporarily unreadable file is retried by the poll.
		} finally {
			file.reading = false;
		}
	}

	#pushLine(line: string): void {
		this.#sequence++;
		this.#buffer.push(line);
		if (this.#buffer.length > RING_BUFFER_SIZE) {
			this.#buffer.shift();
		}
		this.#pending.push(line);
		if (!this.#flushTimer) {
			this.#flushTimer = setTimeout(() => this.#flush(), FLUSH_INTERVAL_MS);
		}
	}

	#flush(): void {
		if (this.#flushTimer) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = null;
		}
		if (this.#pending.length === 0) return;
		const batch = this.#pending;
		this.#pending = [];
		this.onLines?.(batch);
	}
}
