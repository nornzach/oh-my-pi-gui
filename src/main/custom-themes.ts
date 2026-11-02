/**
 * Custom GUI themes (gui#38): `.json` files in ~/.omp/gui/themes, beside the
 * ~/.omp/work and ~/.omp/logs folders the GUI already keeps. The agent's own
 * ~/.omp/agent/themes holds TUI themes in another format, so GUI themes keep
 * a folder of their own. Main reads and parses the files, and writes the
 * ones made in the theme editor; the renderer checks every color and fills
 * the rest from a built-in theme. Edits reach every window without a
 * restart.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type FSWatcher, watch } from "chokidar";
import type { IpcCustomThemeFile, IpcCustomThemes, IpcSaveCustomThemeRequest } from "../shared/ipc-types";
import { agentDir } from "./agent-paths";

const SETTLE_MS = 250;
/** A theme is a short token map; anything larger is not one. */
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES = 100;

export function customThemesDir(): string {
	return path.join(agentDir(), "..", "gui", "themes");
}

export async function readCustomThemes(dir: string = customThemesDir()): Promise<IpcCustomThemes> {
	let names: string[];
	try {
		names = (await fs.readdir(dir, { withFileTypes: true }))
			// A symlink (dotfile managers link themes in) is read through; one to a
			// folder is reported, not dropped.
			.filter(entry => (entry.isFile() || entry.isSymbolicLink()) && entry.name.toLowerCase().endsWith(".json"))
			.map(entry => entry.name)
			.sort((a, b) => a.localeCompare(b))
			.slice(0, MAX_FILES);
	} catch {
		return { dir, files: [] };
	}
	// A theme is known by its file name without `.json`. A name that leaves
	// nothing (`.json`) or repeats another's (`a.json` and `a.JSON`) keeps its
	// whole file name, so every file has its own id.
	const ids = new Set<string>();
	const files = await Promise.all(
		names.map(name => {
			const stem = name.slice(0, -".json".length);
			const id = stem && !ids.has(stem) ? stem : name;
			ids.add(id);
			return readThemeFile(dir, name, id);
		}),
	);
	return { dir, files };
}

async function readThemeFile(dir: string, fileName: string, id: string): Promise<IpcCustomThemeFile> {
	try {
		const filePath = path.join(dir, fileName);
		const stats = await fs.stat(filePath);
		if (!stats.isFile()) return { id, fileName, error: "Not a file" };
		if (stats.size > MAX_FILE_BYTES) return { id, fileName, error: "File is larger than 256 KB" };
		const text = await fs.readFile(filePath, "utf8");
		try {
			return { id, fileName, data: JSON.parse(text) as unknown };
		} catch (err) {
			return { id, fileName, error: err instanceof Error ? err.message : String(err) };
		}
	} catch (err) {
		return { id, fileName, error: err instanceof Error ? err.message : String(err) };
	}
}

/** A file the GUI may write or remove: a plain `.json` name inside the folder, never a path. */
function themeFilePath(dir: string, fileName: string): string {
	if (path.basename(fileName) !== fileName || fileName.includes("\0") || !/^[^.].*\.json$/i.test(fileName)) {
		throw new Error(`Not a theme file name: ${fileName}`);
	}
	return path.join(dir, fileName);
}

/** A file name from a theme's name: lowercase ASCII words joined by dashes, or "theme". */
export function themeFileStem(name: string): string {
	const stem = name
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, 48)
		.replace(/^-+|-+$/g, "");
	return stem || "theme";
}

/**
 * Writes a theme made in the editor and returns its file name. A new theme
 * gets a file named after it, numbered when the name is taken; an edited one
 * replaces its own file.
 */
export async function saveCustomTheme(dir: string, request: IpcSaveCustomThemeRequest): Promise<string> {
	const { theme } = request;
	if (typeof theme !== "object" || theme === null || Array.isArray(theme)) throw new Error("A theme is a JSON object");
	const text = `${JSON.stringify(theme, null, 2)}\n`;
	if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error("Theme is larger than 256 KB");
	await fs.mkdir(dir, { recursive: true });
	if (request.fileName !== undefined) {
		await fs.writeFile(themeFilePath(dir, request.fileName), text, "utf8");
		return request.fileName;
	}
	const stem = themeFileStem(typeof theme.name === "string" ? theme.name : "");
	for (let n = 1; n <= MAX_FILES; n++) {
		const fileName = n === 1 ? `${stem}.json` : `${stem}-${n}.json`;
		try {
			await fs.writeFile(path.join(dir, fileName), text, { encoding: "utf8", flag: "wx" });
			return fileName;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
		}
	}
	throw new Error(`Too many themes named ${stem}`);
}

/** Removes a theme file through `trash`, so a deleted theme can be brought back. */
export async function deleteCustomTheme(
	dir: string,
	fileName: string,
	trash: (filePath: string) => Promise<void>,
): Promise<void> {
	await trash(themeFilePath(dir, fileName));
}

/** Re-reads the folder after a burst of edits settles and hands the result on. */
export class CustomThemesWatcher {
	readonly #dir: string;
	#watcher: FSWatcher | null = null;
	#timer: NodeJS.Timeout | null = null;
	#stopped = false;

	onChange: ((themes: IpcCustomThemes) => void) | null = null;

	constructor(dir: string = customThemesDir()) {
		this.#dir = dir;
	}

	get dir(): string {
		return this.#dir;
	}

	async start(): Promise<void> {
		// Chokidar sees a missing folder appear but not the files added to it
		// afterwards, so the folder is made first: themes dropped into a new
		// folder then show without a restart.
		await fs.mkdir(this.#dir, { recursive: true }).catch(() => {});
		if (this.#stopped) return;
		const watcher = watch(this.#dir, { ignoreInitial: true, depth: 0 });
		this.#watcher = watcher;
		// A folder that turns unreadable must not take main down; the next change re-reads it.
		watcher.on("error", () => {});
		watcher.on("all", () => {
			if (this.#timer) clearTimeout(this.#timer);
			this.#timer = setTimeout(() => {
				this.#timer = null;
				void readCustomThemes(this.#dir).then(themes => this.onChange?.(themes));
			}, SETTLE_MS);
		});
		const ready = Promise.withResolvers<void>();
		watcher.once("ready", () => ready.resolve());
		await ready.promise;
	}

	stop(): void {
		this.#stopped = true;
		void this.#watcher?.close();
		this.#watcher = null;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
	}
}
