/**
 * Custom GUI themes (gui#38): `.json` files in ~/.omp/gui/themes, beside the
 * ~/.omp/work and ~/.omp/logs folders the GUI already keeps. The agent's own
 * ~/.omp/agent/themes holds TUI themes in another format, so GUI themes keep
 * a folder of their own. Main only reads and parses the files; the renderer
 * checks every color and fills the rest from a built-in theme. Edits reach
 * every window without a restart.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type FSWatcher, watch } from "chokidar";
import type { IpcCustomThemeFile, IpcCustomThemes } from "../shared/ipc-types";
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
			.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
			.map(entry => entry.name)
			.sort((a, b) => a.localeCompare(b))
			.slice(0, MAX_FILES);
	} catch {
		return { dir, files: [] };
	}
	const files = await Promise.all(names.map(name => readThemeFile(dir, name)));
	return { dir, files };
}

async function readThemeFile(dir: string, fileName: string): Promise<IpcCustomThemeFile> {
	const id = fileName.slice(0, -".json".length);
	try {
		const filePath = path.join(dir, fileName);
		const { size } = await fs.stat(filePath);
		if (size > MAX_FILE_BYTES) return { id, fileName, error: "File is larger than 256 KB" };
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
