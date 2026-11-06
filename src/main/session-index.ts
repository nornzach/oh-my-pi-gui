/**
 * Watches ~/.omp/agent/sessions/ for .jsonl session files.
 * Parses title, session header, first message, and tail status.
 *
 * Change handling is per file: a watcher event drops that path's cache entries
 * and notifies, so a streaming agent appending to one session costs one stat —
 * never a re-fingerprint of the whole tree. Correctness does not depend on the
 * events, though: every read goes through `list()`, which scans and re-parses
 * whatever its cache does not already hold, so a missed event self-heals on the
 * next refresh instead of needing a background poll.
 */
import { mkdirSync } from "node:fs";
import { open, readdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import type { SessionInfo, SessionKind } from "../shared/ipc-types";
import { agentDir } from "./agent-paths";
import { StampedLru } from "./session-cache";

const TITLE_SLOT_BYTES = 256;
const TAIL_BYTES = 32 * 1024;
const HEAD_BYTES = 32 * 1024;
/** Longest session header line read; imported sessions can carry kilobytes of metadata. */
const MAX_HEADER_BYTES = 1024 * 1024;
const MAX_PARSE_CACHE_ENTRIES = 4096;
/** Per-file cap for full-content search reads; larger sessions match on this prefix. */
const SEARCH_READ_BYTES = 8 * 1024 * 1024;
/**
 * Total bytes of cached search text. Counted, not entry-counted: one entry can be
 * the full read cap, so an entry-count ceiling alone would allow ~8 MB × entries
 * of resident strings.
 */
const SEARCH_CACHE_BYTES = 64 * 1024 * 1024;
/** Files read concurrently during a content search (bounds FD pressure). */
const SEARCH_BATCH = 16;

type SessionStatus = SessionInfo["status"];

export class SessionIndex {
	#watcher: FSWatcher | null = null;
	#parseCache = new StampedLru<SessionInfo>(MAX_PARSE_CACHE_ENTRIES);
	#textCache = new StampedLru<string>(SEARCH_CACHE_BYTES, text => text.length);
	#sessionsDir: string;
	#cwd: string;

	onChange: (() => void) | null = null;

	constructor(sessionsDir: string | undefined, cwd: string) {
		this.#sessionsDir = sessionsDir ?? join(agentDir(), "sessions");
		this.#cwd = resolve(cwd);
	}

	/** Sessions root watched by this index (plan files live in per-session artifact dirs beneath it). */
	get sessionsDir(): string {
		return this.#sessionsDir;
	}

	start(): void {
		// Session files sit one level down (<project>/<session>.jsonl). Each session
		// also owns an artifact folder beside its file that subagents and tools fill
		// with thousands of files; watching those kept a file handle open per file
		// (7k+ on a long-lived install) and woke the list on every artifact write.
		const root = resolve(this.#sessionsDir);
		// A fresh install has no sessions folder until the first agent writes one.
		// chokidar then watches the parent and counts `depth` from there, so the
		// session files two levels down would never be seen until a restart.
		try {
			mkdirSync(root, { recursive: true });
		} catch {
			// Unwritable home: watch what exists; `list()` still scans on every read.
		}
		this.#watcher = watch(this.#sessionsDir, {
			persistent: true,
			ignoreInitial: false,
			depth: 1,
			ignored: (path, stats) => {
				const parts = relative(root, path).split(sep);
				if (parts.length < 2) return false;
				return parts.length > 2 || !path.endsWith(".jsonl") || stats?.isDirectory() === true;
			},
			awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
		});

		// add/change/unlink all mean the same thing here: this one file's cached
		// view is dead. The event carries the path, so nothing else is touched.
		this.#watcher.on("add", path => this.#invalidate(path));
		this.#watcher.on("change", path => this.#invalidate(path));
		this.#watcher.on("unlink", path => this.#invalidate(path));
	}

	stop(): void {
		this.#watcher?.close();
		this.#watcher = null;
		this.#parseCache.clear();
		this.#textCache.clear();
	}

	/**
	 * @param scope "local" filters to sessions whose cwd matches `cwd`.
	 * @param cwd The calling window's cwd for "local" filtering. Defaults to the
	 *   index's own cwd (single-window behavior); multi-window callers pass their
	 *   own so each window sees only its project's sessions.
	 */
	async list(scope: "local" | "global", cwd?: string): Promise<SessionInfo[]> {
		const entries = await this.#scanDir();
		const parsed = await Promise.all(
			entries.map(async entry => {
				const info = await this.#parseSessionFile(entry.path);
				// A transcript inside a session's artifact directory belongs to that
				// session even when its header omitted parentSession or named it by
				// an id. The on-disk parent is what the sidebar nests under, and it
				// is still there after a restart.
				if (!info || !entry.parentFile) return info;
				return { ...info, parentSessionPath: entry.parentFile, subagent: true };
			}),
		);
		const localCwd = cwd !== undefined ? resolve(cwd) : this.#cwd;
		const infos = parsed.filter((info): info is SessionInfo => {
			if (!info) return false;
			// Nothing said yet: a fresh session, or the one a tab starts after its
			// session is deleted. The agent may write its file early (a thinking
			// level entry), but it gets no row until it has a message, just like a
			// new tab. Only judged when the tail read covered the whole file.
			if (info.messageCount === 0 && !info.title && info.size <= TAIL_BYTES) return false;
			return scope === "global" || (info.cwd != null && resolve(info.cwd) === localCwd);
		});

		// Sort by modified descending
		infos.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

		// Dedupe by session id: the agent migrates sessions between legacy and
		// current cwd-directory encodings (e.g. `-AiProject-x` → `home-x-<hash>`),
		// and during that window the same session id can exist as a file in both
		// directories. After the modified-desc sort, the first occurrence of each
		// id is the newest copy — keep it and drop the stale duplicates so one
		// session never renders as two sidebar rows.
		// A fork copies its parent's artifact folder, subagent transcripts
		// included, and the copies get fresh mtimes. Of two copies of a
		// transcript the older one is the original, so the subagents stay under
		// the session that ran them.
		const transcripts = new Set(entries.flatMap(entry => (entry.parentFile ? [entry.path] : [])));
		const kept = new Map<string, SessionInfo>();
		for (const info of infos) {
			if (!info.id) continue;
			const first = kept.get(info.id);
			if (!first || (transcripts.has(first.path) && transcripts.has(info.path))) kept.set(info.id, info);
		}
		return infos.filter(info => kept.get(info.id) === info);
	}

	/**
	 * Session kind for one file: the LRU-cached parse when fresh, a cold parse
	 * otherwise. Unreadable files degrade to "agent" — the kind guards re-check
	 * with the file's real parse before refusing anything.
	 */
	async kindFor(sessionPath: string): Promise<SessionKind> {
		try {
			const info = await this.#parseSessionFile(sessionPath);
			return info?.kind === "chat" ? "chat" : "agent";
		} catch {
			return "agent";
		}
	}

	async deleteSession(sessionPath: string): Promise<void> {
		const target = resolve(sessionPath);
		const root = `${resolve(this.#sessionsDir)}${sep}`;
		if (!target.startsWith(root) || !target.endsWith(".jsonl")) throw new Error("Invalid session path");
		await rm(target, { force: true });
		this.#parseCache.delete(target);
		this.#textCache.delete(target);
		this.#notifyChange();
	}

	/**
	 * Full-content search: paths of the given session files whose raw JSONL
	 * text contains every query token (case-insensitive). Deliberately a raw
	 * grep — no JSON parsing — because tokens are matched individually, so
	 * JSON escaping rarely breaks them. Lowercased file text is cached by
	 * mtime:size so debounced keystrokes only re-read files that changed.
	 */
	async searchContent(query: string, candidatePaths: string[]): Promise<string[]> {
		const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (tokens.length === 0 || candidatePaths.length === 0) return [];
		const matches: string[] = [];
		for (let i = 0; i < candidatePaths.length; i += SEARCH_BATCH) {
			const batch = await Promise.all(
				candidatePaths.slice(i, i + SEARCH_BATCH).map(async path => {
					const text = await this.#searchText(path);
					if (text === null) return null;
					for (const token of tokens) {
						if (!text.includes(token)) return null;
					}
					return path;
				}),
			);
			for (const hit of batch) {
				if (hit !== null) matches.push(hit);
			}
		}
		return matches;
	}

	/** Lowercased session-file text (capped at SEARCH_READ_BYTES), LRU-cached by mtime:size. */
	async #searchText(filePath: string): Promise<string | null> {
		try {
			const fileStat = await stat(filePath);
			const signature = `${fileStat.mtimeMs}:${fileStat.size}`;
			const cached = this.#textCache.get(filePath, signature);
			if (cached !== null) return cached;
			const fh = await open(filePath, "r");
			try {
				const length = Math.min(fileStat.size, SEARCH_READ_BYTES);
				const buffer = Buffer.alloc(length);
				await fh.read(buffer, 0, length, 0);
				const text = buffer.toString("utf-8").toLowerCase();
				this.#textCache.set(filePath, signature, text);
				return text;
			} finally {
				await fh.close();
			}
		} catch {
			return null;
		}
	}

	async #scanDir(): Promise<{ path: string; parentFile?: string }[]> {
		try {
			const projectDirs = (await readdir(this.#sessionsDir, { withFileTypes: true })).filter(entry =>
				entry.isDirectory(),
			);
			const projectFiles = await Promise.all(
				projectDirs.map(async projectDir => {
					const projectPath = join(this.#sessionsDir, projectDir.name);
					const entries = await readdir(projectPath, { withFileTypes: true });
					return entries
						.filter(entry => entry.isFile() && entry.name.endsWith(".jsonl"))
						.map(entry => ({ path: join(projectPath, entry.name) }));
				}),
			);
			const sessions = projectFiles.flat();
			// Subagent transcripts sit beside the session file (`<name>.jsonl` →
			// `<name>/<agentId>.jsonl`, and the same again for a nested spawn).
			// They are real sessions with their own first message, which is why a
			// flat listing showed them as peers of the main session. Read them
			// here; the watcher still ignores the artifact tree (thousands of
			// tool files) and a parent append refreshes the list.
			const children = await Promise.all(sessions.map(session => this.#subagentFiles(session.path)));
			return [...sessions, ...children.flat()];
		} catch {
			return [];
		}
	}

	/** Subagent session files under `sessionFile`'s artifact directory, each pointing at its parent file. */
	async #subagentFiles(sessionFile: string, depth = 0): Promise<{ path: string; parentFile: string }[]> {
		if (depth >= 8 || !sessionFile.endsWith(".jsonl")) return [];
		const dir = sessionFile.slice(0, -".jsonl".length);
		let dirents: { name: string; isFile: () => boolean; isDirectory: () => boolean }[];
		try {
			dirents = await readdir(dir, { withFileTypes: true });
		} catch {
			return [];
		}
		const directories = new Set(dirents.filter(entry => entry.isDirectory()).map(entry => entry.name));
		const found: { path: string; parentFile: string }[] = [];
		for (const entry of dirents) {
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
			// Advisors and backup copies share the directory and are not sessions.
			if (entry.name.startsWith("__advisor") || entry.name.includes(".bak")) continue;
			const path = join(dir, entry.name);
			found.push({ path, parentFile: sessionFile });
			const stem = entry.name.slice(0, -".jsonl".length);
			if (directories.has(stem)) found.push(...(await this.#subagentFiles(path, depth + 1)));
		}
		return found;
	}

	/**
	 * One session file changed, appeared, or vanished: forget exactly that file's
	 * cached view and notify. Nothing else is stat'ed — the previous handler
	 * re-fingerprinted every session in the tree on each event, so an agent
	 * streaming into one file walked the whole directory repeatedly.
	 */
	#invalidate(path: string): void {
		if (!path.endsWith(".jsonl")) return;
		this.#parseCache.delete(path);
		this.#textCache.delete(path);
		this.#notifyChange();
	}

	async #parseSessionFile(filePath: string): Promise<SessionInfo | null> {
		try {
			const fileStat = await stat(filePath);
			const signature = `${fileStat.mtimeMs}:${fileStat.size}`;
			const cached = this.#parseCache.get(filePath, signature);
			if (cached) return cached;

			const info = await this.#doParse(filePath, fileStat);
			if (!info) return null;
			this.#parseCache.set(filePath, signature, info);
			return info;
		} catch {
			return null;
		}
	}

	async #doParse(
		filePath: string,
		fileStat: { size: number; mtimeMs: number; birthtimeMs: number },
	): Promise<SessionInfo | null> {
		const size = fileStat.size;
		if (size === 0) return null;

		const fh = await open(filePath, "r");
		try {
			// Read enough of the head to parse the title, header, and first user message.
			const headBuf = Buffer.alloc(Math.min(HEAD_BYTES, size));
			await fh.read(headBuf, 0, headBuf.length, 0);
			const titleBuf = headBuf.subarray(0, Math.min(TITLE_SLOT_BYTES, headBuf.length));
			const title = this.#parseTitleSlot(titleBuf);

			// Read header line (second line, after first newline)
			const headerStart = headBuf.indexOf(0x0a);
			let header: {
				id?: string;
				title?: string;
				timestamp?: string;
				cwd?: string;
				parentSession?: string;
				continuationOf?: string;
				kind?: "chat";
			} | null = null;

			if (headerStart !== -1) {
				// The header is the second line. It usually fits in the head already read;
				// a longer one (imported sessions carry kilobytes of metadata) is read on
				// until its newline. Cutting it at a fixed 4KB lost the session's folder,
				// and the sidebar filed it under a group with no name.
				let headerEnd = headBuf.indexOf(0x0a, headerStart + 1);
				let headerBytes = headBuf;
				if (headerEnd === -1 && size > headBuf.length) {
					headerBytes = Buffer.alloc(Math.min(MAX_HEADER_BYTES, size));
					await fh.read(headerBytes, 0, headerBytes.length, 0);
					headerEnd = headerBytes.indexOf(0x0a, headerStart + 1);
				}
				const headerLine = headerBytes
					.subarray(headerStart + 1, headerEnd === -1 ? headerBytes.length : headerEnd)
					.toString("utf-8");
				try {
					header = JSON.parse(headerLine);
				} catch {
					// Header parse failure is non-fatal
				}
			}

			// Read tail 32KB for status derivation
			const tailStart = Math.max(0, size - TAIL_BYTES);
			const tailBuf = Buffer.alloc(size - tailStart);
			await fh.read(tailBuf, 0, tailBuf.length, tailStart);
			const { status, messageCount } = this.#parseTail(tailBuf.toString("utf-8"));
			const firstMessage = this.#parseFirstMessage(headBuf.toString("utf-8"));

			const id = header?.id ?? filePath.split("/").pop()?.replace(".jsonl", "") ?? "unknown";

			const info: SessionInfo = {
				path: filePath,
				id,
				// `||` not `??`: an empty title slot (auto-title never ran) is
				// missing data, so fall back to the header line's title.
				title: title || header?.title || null,
				cwd: header?.cwd ?? "",
				created: header?.timestamp ?? new Date(fileStat.birthtimeMs).toISOString(),
				modified: new Date(fileStat.mtimeMs).toISOString(),
				messageCount,
				size,
				status,
				kind: header?.kind,
				parentSessionPath: header?.parentSession,
				continuationOf: header?.continuationOf,
				firstMessage,
			};

			return info;
		} finally {
			await fh.close();
		}
	}

	#parseTitleSlot(buf: Buffer): string | null {
		try {
			const firstLine = buf.toString("utf-8").split("\n", 1)[0]?.trimEnd();
			if (!firstLine) return null;
			const parsed = JSON.parse(firstLine) as { type?: string; title?: string };
			return parsed.type === "title" && parsed.title ? parsed.title : null;
		} catch {
			return null;
		}
	}

	#parseFirstMessage(head: string): string {
		for (const line of head.split("\n")) {
			try {
				const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
				if (entry.type !== "message" || entry.message?.role !== "user") continue;
				const content = entry.message.content;
				if (typeof content === "string") return content.slice(0, 200);
				if (Array.isArray(content)) {
					const textPart = (content as Array<{ type?: string; text?: string }>).find(part => part.type === "text");
					if (textPart?.text) return textPart.text.slice(0, 200);
				}
			} catch {
				// The final head chunk may contain a partial JSON line.
			}
		}
		return "";
	}

	#parseTail(tail: string): { status: SessionStatus; messageCount: number } {
		const lines = tail.split("\n").filter(line => line.trim().length > 0);
		let messageCount = 0;
		let status: SessionStatus = "unknown";
		let lastEntry: Record<string, unknown> | null = null;

		for (const line of lines) {
			try {
				const entry = JSON.parse(line) as Record<string, unknown>;
				lastEntry = entry;
				if (entry.type === "message") messageCount++;
			} catch {
				// Tail reads can begin or end in the middle of a JSON line.
			}
		}

		if (lastEntry) {
			const lastType = lastEntry.type;
			if (lastType === "agent_end" || lastType === "turn_end") {
				status = "complete";
			} else if (lastType === "error") {
				status = "error";
			} else if (lastType === "aborted") {
				status = "aborted";
			} else if (lastType === "interrupted") {
				status = "interrupted";
			} else if (lastType === "message_start" || lastType === "tool_execution_start") {
				status = "pending";
			} else if (lastType === "message") {
				const message = lastEntry.message as { role?: string } | undefined;
				status = message?.role === "assistant" ? "complete" : "pending";
			}
		}

		return { status, messageCount };
	}

	#notifyChange(): void {
		this.onChange?.();
	}
}
