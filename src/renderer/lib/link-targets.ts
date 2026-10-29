/**
 * What a piece of reply or tool-output text points at: a web address or a file
 * reference. File references carry the line/column suffixes editors and
 * compilers print (`src/a.ts:12:5`, `src/a.ts#L12`, `src/a.ts(12,5)`), so a
 * click can land on the line.
 */

/** A file reference split into the path and its optional position. */
export interface FileTarget {
	path: string;
	line?: number;
	column?: number;
}

// `:12`, `:12:5`, `#L12`, `#L12-L20`, `(12,5)`; a path can end in only one.
const POSITION_SUFFIX = /(?::(\d+)(?::(\d+))?|#L(\d+)(?:-L?\d+)?|\((\d+)(?:,\s*(\d+))?\))$/;
const WEB_URL = /^https?:\/\/[^\s"'<>`]+$/i;
/** A bare `name.ext` file name; the extension has a letter so `1.2.3` is a version, not a file. */
const FILE_NAME = /^[\w@+-][\w.@+-]*\.(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,10}$/;
/** A bare dotfile such as `.gitignore` or `.env.local`. */
const DOTFILE = /^\.[A-Za-z_][\w.-]*$/;
/** Characters that mark globs, templates, shell syntax, or prose rather than one path. */
const NOT_A_PATH = /[\s*?<>|"'`{}$,;=]/;

// ── Where a bare web address ends ─────────────────────────────────────────
// GFM, like a "to the next space" scan, runs a bare address to the next
// whitespace, but CJK prose rarely puts a space after one:
// `运行于 http://127.0.0.1:18091，仅` linked `…18091，仅`, which the browser panel
// then refused as a blocked address. Every linkifier (markdown literal
// autolinks, terminal and tool output, the last-link command) ends an address
// by the same rules:
//
// - CJK and full-width punctuation ends it anywhere, as a space would, so the
//   ASCII punctuation before it (`.`, `**`, an unopened `)`) is trimmed too.
// - A CJK character ends it right after an ASCII letter or digit in the host
//   (`example.com仅`), and anywhere between the host and the path (`:18091仅`,
//   `:18091.仅`). CJK hosts (`中文.com`, `example.中国`) still link: their
//   characters follow `//`, `.`, `-` or each other.
// - In the path, query and fragment CJK characters stay (`/wiki/中文`): prose
//   glued to a path reads exactly like a Chinese path, so it links as GFM does.
// - An address right after an emphasis marker (`**http://…`) ends before a
//   run of two or more of that marker: the closing delimiter.

/** CJK and full-width punctuation: prose, never an unescaped part of an address. */
const ADDRESS_STOP = /[—‘’“”‥…、-〃〈-】〔-〟︐-︙︰-﹫！-／：-＠［-｀｛-･]/;
const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** Ends the host, as micromark's `unicodePunctuation` ends a GFM domain. */
const PUNCTUATION = /[\p{P}\p{S}]/u;
const EMPHASIS_MARKERS = "*_~";
/** Punctuation GFM trims off the end of an address. */
const TRAILING_PUNCTUATION = /[!*,.:;?_~]+$/;
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** Whether the UTF-16 unit `code` is punctuation that ends a bare address. */
export function isAddressStop(code: number | null): boolean {
	return code !== null && ADDRESS_STOP.test(String.fromCharCode(code));
}

/** Whether the UTF-16 unit `code` is a Han, kana, or Hangul character. */
export function isCjkScript(code: number | null): boolean {
	return code !== null && CJK_SCRIPT.test(String.fromCharCode(code));
}

/**
 * End of the bare address at the start of `text` (`http(s)://…` or `www.…`)
 * by the rules above; `before` is the character ahead of it. Trailing
 * punctuation is left for `trimAddress`.
 */
export function bareAddressEnd(text: string, before?: string): number {
	const closer = before && EMPHASIS_MARKERS.includes(before) ? before : undefined;
	let part: "host" | "afterHost" | "path" = "host";
	for (let index = /^https?:\/\//i.exec(text)?.[0].length ?? 0; index < text.length; index++) {
		const char = text[index] as string;
		const code = text.charCodeAt(index);
		if (isAddressStop(code) || (char === closer && text[index + 1] === closer)) return index;
		if (part !== "path" && isCjkScript(code) && (part === "afterHost" || /[A-Za-z0-9]/.test(text[index - 1] ?? ""))) {
			return index;
		}
		if (char === "/" || char === "?" || char === "#") part = "path";
		else if (part === "host" && !"-._".includes(char) && PUNCTUATION.test(char)) part = "afterHost";
	}
	return text.length;
}

function count(text: string, char: string): number {
	let total = 0;
	for (const each of text) if (each === char) total++;
	return total;
}

/** Trim prose off the end of an address: trailing punctuation, and closing brackets it never opened. */
export function trimAddress(url: string): string {
	let trimmed = url;
	for (;;) {
		const next = trimmed.replace(TRAILING_PUNCTUATION, "");
		const last = next.at(-1);
		const opener = last ? CLOSERS[last] : undefined;
		const result = opener && count(next, last as string) > count(next, opener) ? next.slice(0, -1) : next;
		if (result === trimmed) return trimmed;
		trimmed = result;
	}
}

/** Whether `text` is one whole web address, with no CJK prose glued on. */
export function isWebUrl(text: string): boolean {
	return WEB_URL.test(text) && bareAddressEnd(text) === text.length;
}

/** Split a trailing line/column suffix off a file reference. */
export function parseFileTarget(text: string): FileTarget {
	const match = text.match(POSITION_SUFFIX);
	if (!match || match.index === undefined || match.index === 0) return { path: text };
	const line = Number(match[1] ?? match[3] ?? match[4]);
	const columnText = match[2] ?? match[5];
	return {
		path: text.slice(0, match.index),
		...(line > 0 ? { line } : {}),
		...(columnText && Number(columnText) > 0 ? { column: Number(columnText) } : {}),
	};
}

/**
 * Whether inline code reads as a file reference worth checking on disk: one
 * token with a path separator, a `name.ext` file name, or a dotfile. Existence decides
 * the rest — `and/or` passes here and simply never resolves.
 */
export function looksLikeFilePath(text: string): boolean {
	if (text.length < 2 || text.length > 400) return false;
	if (text.includes("://") || text.startsWith("-") || text.startsWith("@")) return false;
	const { path } = parseFileTarget(text);
	if (!path || /^\.+$/.test(path) || NOT_A_PATH.test(path)) return false;
	if (/[\\/]/.test(path)) return /[^\\/.~]/.test(path);
	return FILE_NAME.test(path) || DOTFILE.test(path);
}
