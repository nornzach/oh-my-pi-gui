/**
 * Input area utilities: file handling, fuzzy matching, and command filtering.
 */

import type { FsTreeEntry } from "../../../shared/ipc-types";
import type { ComposerImage } from "../../stores/composer";

const MENTION_FS_DEPTH = 8;
const MENTION_FS_MAX_ENTRIES = 2000;
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Cap on completion menu items. */
export const MAX_MENU_ITEMS = 8;
/** Cap on fuzzy file results shown above the scheme entries in the @ menu. */
export const MAX_MENTION_FILE_ITEMS = 20;
/** Internal URL schemes always offered in the @ menu, below file results. */
export const MENTION_SCHEMES = ["skill://", "memory://", "artifact://", "issue://", "pr://", "local://plan.md"];

/**
 * Slash-command query at buffer end. TUI parity (`autocomplete.ts` uses
 * `[^\s/]*`): the name token accepts any non-space, non-slash chars — digits
 * (`p4-case-rename`) and `:` (namespaced names like `skill:p4-case-rename`)
 * included. Anything narrower silently disables the menu.
 */
export const SLASH_NAME_RE = /(^|\s)\/([^\s/]*)$/;
/** `/cmd <args>` with the slash at buffer start; same token charset. */
export const SLASH_ARG_RE = /^\/([^\s/]+)\s(.+)$/;

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

export function isInlineImage(file: File): boolean {
	return INLINE_IMAGE_TYPES.has(file.type);
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

/**
 * Composer mention for a dropped file: workspace-relative when the file sits
 * under `cwd`, absolute otherwise. Quote paths that the agent's mention
 * parser would split or trim.
 */
export function droppedFileMention(filePath: string, cwd: string): string {
	const normalized = filePath.replace(/\\/g, "/");
	const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	const relative = root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : filePath;
	if (!/[\s@"']|^[\x60([{<]|[)\]}>.,;:!?\x60]$/.test(relative) && /[./\\]/.test(relative)) return `@${relative}`;
	const quote = relative.includes('"') ? "'" : '"';
	return `@${quote}${relative}${quote}`;
}

/** Serialize file mentions alongside user text without repeating manually typed mentions. */
export function appendMentions(draft: string, mentions: string[]): string {
	if (mentions.length === 0) return draft;
	const existing = new Set(Array.from(draft.matchAll(/(?:^|\s)(@(?:"[^"]+"|'[^']+'|[^\s@]+))/g), match => match[1]));
	const additions = mentions.filter(mention => !existing.has(mention));
	if (additions.length === 0) return draft;
	const separator = draft && !/\s$/.test(draft) ? " " : "";
	return `${draft}${separator}${additions.join(" ")}`;
}
