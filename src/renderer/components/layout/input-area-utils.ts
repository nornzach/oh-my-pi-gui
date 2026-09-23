/**
 * Input area utilities: file handling, fuzzy matching, and command filtering.
 */

import type { FsTreeEntry } from "../../../shared/ipc-types";
import type { ComposerImage } from "../../stores/composer";

const MENTION_FS_DEPTH = 8;
const MENTION_FS_MAX_ENTRIES = 2000;

/** Cap on completion menu items. */
export const MAX_MENU_ITEMS = 8;
/** Cap on fuzzy file results shown above the scheme entries in the @ menu. */
export const MAX_MENTION_FILE_ITEMS = 20;
/** Internal URL schemes always offered in the @ menu, below file results. */
export const MENTION_SCHEMES = ["skill://", "memory://", "artifact://", "issue://", "pr://", "local://plan.md"];

/** Subsequence fuzzy score; null = no match. Earlier + denser wins. */
export function fuzzyScore(query: string, target: string): number | null {
	const q = query.toLowerCase();
	const t = target.toLowerCase();
	if (q.length === 0) return 0;
	let qi = 0;
	let score = 0;
	let last = -2;
	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) {
			score += ti === last + 1 ? 2 : 1;
			last = ti;
			qi++;
		}
	}
	return qi === q.length ? score : null;
}

/** Collect workspace-relative file paths from an fs:list tree (files only). */
function flattenFilePaths(entries: FsTreeEntry[], out: string[]): void {
	for (const entry of entries) {
		if (entry.kind === "file") out.push(entry.path);
		else if (entry.children) flattenFilePaths(entry.children, out);
	}
}

/** @mention file lists, cached per session cwd; inflight dedupes concurrent walks. */
const mentionFileInflight = new Map<string, Promise<string[]>>();
export const mentionFileCache = new Map<string, string[]>();
export function listMentionFiles(cwd: string, tabId?: string | null): Promise<string[]> {
	const cached = mentionFileCache.get(cwd);
	if (cached) return Promise.resolve(cached);
	const inflight = mentionFileInflight.get(cwd);
	if (inflight) return inflight;
	const task = window.omp.fs
		.list(undefined, MENTION_FS_DEPTH, MENTION_FS_MAX_ENTRIES, tabId ?? undefined)
		.then(result => {
			const paths: string[] = [];
			if (result.ok) flattenFilePaths(result.entries, paths);
			paths.sort();
			mentionFileCache.set(cwd, paths);
			return paths;
		})
		.catch(() => {
			// Best-effort: on IPC failure the @ menu falls back to scheme entries
			// only; nothing is cached so the next attempt retries the walk.
			return [] as string[];
		})
		.finally(() => {
			mentionFileInflight.delete(cwd);
		});
	mentionFileInflight.set(cwd, task);
	return task;
}

export function fileToImage(file: File): Promise<ComposerImage> {
	const { promise, resolve, reject } = Promise.withResolvers<ComposerImage>();
	const reader = new FileReader();
	reader.onload = () => {
		const dataUrl = String(reader.result);
		const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
		resolve({
			content: { type: "image", data: base64, mimeType: file.type || "image/png" },
			preview: dataUrl,
		});
	};
	reader.onerror = () => reject(reader.error);
	reader.readAsDataURL(file);
	return promise;
}
