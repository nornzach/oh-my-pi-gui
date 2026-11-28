import * as fs from "node:fs";
import type { IpcTabWorktree, SessionKind } from "../shared/ipc-types";

export const TAB_LAYOUT_VERSION = 1;
/** A persisted title is display data only — bound it so prefs cannot grow. */
export const MAX_PERSISTED_TITLE = 120;

export interface PersistedTabDescriptor {
	cwd: string;
	folderTabId?: string;
	sessionPath?: string;
	kind: SessionKind;
	worktree?: IpcTabWorktree;
	/** Untargeted startup tab, disposable once another real tab exists. */
	placeholder?: boolean;
	/**
	 * Last title the live session reported. A restored tab stays unspawned
	 * until it is shown, so this is the only title the chip can render in the
	 * meantime; the live session overwrites it on wake.
	 */
	title?: string;
}

/** Two tabs shown side by side whenever either is selected (gui#30). */
export interface PersistedTabGroup {
	axis: "columns" | "rows";
	firstIndex: number;
	secondIndex: number;
	ratio: number;
}

export interface PersistedTabLayout {
	version: typeof TAB_LAYOUT_VERSION;
	folderId?: string;
	tabs: PersistedTabDescriptor[];
	activeIndex: number;
	groups?: PersistedTabGroup[];
	/** The single on-screen split saved before gui#30; read once into `groups`. */
	split?: PersistedTabGroup;
}

export interface TabLayoutPathChecks {
	directoryExists(path: string): boolean;
	fileExists(path: string): boolean;
	/** Conservative content probe used only to migrate pre-placeholder layouts. */
	sessionHasContent?(path: string): boolean;
}

const diskPathChecks: TabLayoutPathChecks = {
	directoryExists(path) {
		try {
			return fs.statSync(path).isDirectory();
		} catch {
			return false;
		}
	},
	fileExists(path) {
		try {
			return fs.statSync(path).isFile();
		} catch {
			return false;
		}
	},
	sessionHasContent(path) {
		try {
			const file = fs.statSync(path);
			// Empty sessions are small. Treat a large transcript as contentful
			// without loading it into the main process during startup.
			if (file.size > 128 * 1024) return true;
			for (const line of fs.readFileSync(path, "utf8").split("\n")) {
				if (!line.trim()) continue;
				try {
					if ((JSON.parse(line) as { type?: unknown }).type === "message") return true;
				} catch {
					// A malformed line is not evidence that the transcript is empty.
					return true;
				}
			}
			return false;
		} catch {
			return true;
		}
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseKind(value: unknown): SessionKind | null {
	return value === "agent" || value === "chat" ? value : null;
}

function parseWorktree(value: unknown): IpcTabWorktree | undefined {
	if (!isRecord(value)) return undefined;
	const name = nonEmptyString(value.name);
	const branch = nonEmptyString(value.branch);
	const baseCwd = nonEmptyString(value.baseCwd);
	return name && branch && baseCwd ? { name, branch, baseCwd } : undefined;
}

/**
 * Validate the tab snapshot loaded from electron-store before it reaches a
 * sidecar. Missing workspaces are dropped; a deleted transcript becomes a
 * fresh tab at the same cwd instead of making the whole startup fail.
 */
export function sanitizePersistedTabLayout(
	value: unknown,
	paths: TabLayoutPathChecks = diskPathChecks,
): PersistedTabLayout | null {
	if (!isRecord(value) || value.version !== TAB_LAYOUT_VERSION || !Array.isArray(value.tabs)) return null;
	const requestedActiveIndex =
		typeof value.activeIndex === "number" && Number.isInteger(value.activeIndex) && value.activeIndex >= 0
			? value.activeIndex
			: 0;
	const retained: Array<{ descriptor: PersistedTabDescriptor; sourceIndex: number }> = [];
	const sessionPaths = new Set<string>();

	for (const [sourceIndex, candidate] of value.tabs.entries()) {
		if (!isRecord(candidate)) continue;
		const cwd = nonEmptyString(candidate.cwd);
		const kind = parseKind(candidate.kind);
		if (!cwd || !kind || !paths.directoryExists(cwd)) continue;

		const storedSessionPath = nonEmptyString(candidate.sessionPath);
		const sessionPath = storedSessionPath && paths.fileExists(storedSessionPath) ? storedSessionPath : undefined;
		if (sessionPath && sessionPaths.has(sessionPath)) continue;
		if (sessionPath) sessionPaths.add(sessionPath);

		const descriptor: PersistedTabDescriptor = { cwd, kind };
		if (sessionPath) descriptor.sessionPath = sessionPath;
		else if (
			!storedSessionPath &&
			typeof candidate.folderTabId === "string" &&
			/^[0-9a-f]{16}$/.test(candidate.folderTabId)
		)
			descriptor.folderTabId = candidate.folderTabId;
		const worktree = parseWorktree(candidate.worktree);
		if (worktree) descriptor.worktree = worktree;
		const legacyEmptyStartupChat =
			candidate.placeholder === undefined &&
			sourceIndex === 0 &&
			kind === "chat" &&
			(!sessionPath || paths.sessionHasContent?.(sessionPath) === false);
		if (candidate.placeholder === true || legacyEmptyStartupChat) descriptor.placeholder = true;
		const title = nonEmptyString(candidate.title);
		if (title) descriptor.title = title.slice(0, MAX_PERSISTED_TITLE);
		retained.push({ descriptor, sourceIndex });
	}

	// Startup placeholders are disposable. Never restore the legacy tool-free
	// chat after Work mode became the default full-agent surface.
	const effective = retained.filter(entry => entry.descriptor.placeholder !== true);
	if (effective.length === 0) return null;
	let activeIndex = effective.findIndex(entry => entry.sourceIndex === requestedActiveIndex);
	if (activeIndex < 0) activeIndex = effective.findIndex(entry => entry.sourceIndex > requestedActiveIndex);
	if (activeIndex < 0) activeIndex = effective.length - 1;
	const groups: PersistedTabGroup[] = [];
	const paired = new Set<number>();
	const legacySplit = !Array.isArray(value.groups) && isRecord(value.split);
	const candidates: unknown[] = Array.isArray(value.groups) ? value.groups : legacySplit ? [value.split] : [];
	for (const candidate of candidates) {
		if (!isRecord(candidate)) continue;
		const { axis, ratio } = candidate;
		const firstIndex = effective.findIndex(entry => entry.sourceIndex === candidate.firstIndex);
		const secondIndex = effective.findIndex(entry => entry.sourceIndex === candidate.secondIndex);
		if (
			(axis !== "columns" && axis !== "rows") ||
			firstIndex < 0 ||
			secondIndex < 0 ||
			firstIndex === secondIndex ||
			paired.has(firstIndex) ||
			paired.has(secondIndex) ||
			typeof ratio !== "number" ||
			!Number.isFinite(ratio)
		)
			continue;
		paired.add(firstIndex);
		paired.add(secondIndex);
		groups.push({ axis, firstIndex, secondIndex, ratio: Math.min(0.8, Math.max(0.2, ratio)) });
	}
	// The old single split was always on screen. When its persisted focus was
	// dropped (e.g. its cwd vanished) but both panes survived, refocus a pane
	// so the launch still opens on the split instead of a neighbor.
	const legacy = legacySplit ? groups[0] : undefined;
	if (legacy && activeIndex !== legacy.firstIndex && activeIndex !== legacy.secondIndex)
		activeIndex = legacy.firstIndex;

	return {
		version: TAB_LAYOUT_VERSION,
		...(typeof value.folderId === "string" && value.folderId.length <= 64 ? { folderId: value.folderId } : {}),
		tabs: effective.map(entry => entry.descriptor),
		activeIndex,
		...(groups.length > 0 ? { groups } : {}),
	};
}

/**
 * The whole session: one layout per window, in window order.
 *
 * Accepts the current array and the pre-multi-window shape (a bare layout
 * object), so an upgrade restores what the last version saved. Every tab is
 * kept: restored tabs start deferred, so an unopened one holds no process.
 */
export function sanitizePersistedTabLayouts(
	value: unknown,
	paths: TabLayoutPathChecks = diskPathChecks,
): PersistedTabLayout[] {
	const candidates = Array.isArray(value) ? value : [value];
	const layouts: PersistedTabLayout[] = [];
	for (const candidate of candidates) {
		const layout = sanitizePersistedTabLayout(candidate, paths);
		if (layout) layouts.push(layout);
	}
	return layouts;
}
