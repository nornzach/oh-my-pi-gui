/**
 * Multi-window management for the omp GUI.
 * Creates sandboxed BrowserWindows with persisted state via electron-store.
 */

import * as fs from "node:original-fs";
import { join } from "node:path";
import { app, BrowserWindow, Menu, shell } from "electron";
import Store from "electron-store";
import type { RunProgressState, SessionKind } from "../shared/ipc-types";
import { editableContextMenuTemplate } from "./editable-context-menu";
import { getMainLanguage, mainT } from "./i18n";
import {
	type ApplicationResourceIdentity,
	applicationResourcesChanged,
	shouldReloadRenderer,
} from "./renderer-recovery";
import { writeRuntimeLog } from "./runtime-log";

interface WindowState {
	x?: number;
	y?: number;
	width: number;
	height: number;
	isMaximized?: boolean;
}

interface StoreSchema {
	windowState: WindowState;
	[key: string]: unknown;
}

const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

export interface WindowRecord {
	win: BrowserWindow;
	/** Stable id for routing/logging; equals win.webContents.id. */
	id: number;
	cwd: string;
	/**
	 * Session to switch to once the renderer is up (set when a window is opened
	 * for a specific session). The renderer pulls this on boot and performs the
	 * switch itself (switch_session + hydrate), which avoids the race where the
	 * main process switches before/after the renderer's boot hydration.
	 */
	pendingSessionPath?: string;
}

/**
 * Spawn a window with its own sidecar (index.ts's pool-backed helper). Empty
 * `cwd` falls back to resolveInitialCwd (lastProject → launch cwd), never a
 * bare process.cwd() which is "/" for Finder-launched apps. `kind` is the
 * target session file's stamped kind (OPEN_NEW_WINDOW resolves it from the
 * session index); omitted = agent.
 */
export type SpawnWindow = (cwd?: string, pendingSessionPath?: string, kind?: SessionKind) => BrowserWindow | null;

export class WindowManager {
	#records = new Map<number, WindowRecord>();
	#store: Store<StoreSchema>;
	#resourceArchivePath = app.isPackaged ? join(process.resourcesPath, "app.asar") : null;
	#launchResourceIdentity = this.#readResourceIdentity();
	#resourceRestartScheduled = false;
	/** Fired when a window closes; index.ts uses it to release the window's sidecar. */
	onWindowClosed: ((record: WindowRecord) => void) | null = null;

	constructor() {
		this.#store = new Store<StoreSchema>({ name: "window-state" });
	}

	createWindow(opts: { cwd?: string; pendingSessionPath?: string } = {}): BrowserWindow {
		const cwd = opts.cwd ?? process.cwd();
		const saved = this.#store.get("windowState", {
			width: DEFAULT_WIDTH,
			height: DEFAULT_HEIGHT,
		});

		// Cascade parallel windows: all windows share one persisted geometry, so
		// offset each additional window by a fixed step or N windows stack exactly
		// on top of each other and the user can't tell more than one opened.
		const cascade = this.getAllWindows().length;
		const offset = cascade * 28;

		const win = new BrowserWindow({
			x: saved.x !== undefined ? saved.x + offset : undefined,
			y: saved.y !== undefined ? saved.y + offset : undefined,
			width: saved.width,
			height: saved.height,
			minWidth: MIN_WIDTH,
			minHeight: MIN_HEIGHT,
			show: false,
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				spellcheck: true,
				preload: join(__dirname, "../preload/index.cjs"),
			},
		});

		win.webContents.on("context-menu", (_event, params) => {
			const template = editableContextMenuTemplate(params, mainT("menu.addToDictionary", getMainLanguage()), {
				replaceMisspelling: suggestion => win.webContents.replaceMisspelling(suggestion),
				addToDictionary: word => win.webContents.session.addWordToSpellCheckerDictionary(word),
			});
			if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: win });
		});

		if (saved.isMaximized) {
			win.maximize();
		}

		const record: WindowRecord = { win, id: win.webContents.id, cwd, pendingSessionPath: opts.pendingSessionPath };
		this.#records.set(record.id, record);
		this.#observeRuntimeFailures(record);

		this.#loadRenderer(win);

		win.once("ready-to-show", () => {
			win.show();
		});

		// Open external links in browser. Scheme-checked: renderer surfaces
		// (OSC 8 anchors, target=_blank) must not be able to launch arbitrary
		// protocols via middle-click / new-window activation.
		win.webContents.setWindowOpenHandler(({ url }) => {
			if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
			return { action: "deny" };
		});

		// Persist state on close
		win.on("close", () => {
			this.#persistState(win);
		});

		win.on("closed", () => {
			this.#records.delete(record.id);
			this.onWindowClosed?.(record);
		});

		return win;
	}

	#observeRuntimeFailures(record: WindowRecord): void {
		const { win } = record;
		const context = () => ({ windowId: record.id, cwd: record.cwd });
		let lastRendererRecoveryAt = 0;

		win.webContents.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
			if (isMainFrame) this.#restartForChangedResources(record, "main-frame-navigation");
		});

		win.webContents.on(
			"did-fail-load",
			(_event, errorCode, errorDescription, validatedURL, isMainFrame, frameProcessId, frameRoutingId) => {
				if (errorCode === -3) return;
				if (this.#restartForChangedResources(record, "renderer-load-failure")) return;
				if (!isMainFrame) return;
				writeRuntimeLog(
					{
						source: "renderer-load",
						message: `Renderer failed to load: ${errorDescription}`,
						url: validatedURL,
						details: { errorCode, frameProcessId, frameRoutingId },
					},
					context(),
				);
			},
		);

		win.webContents.on("preload-error", (_event, preloadPath, error) => {
			writeRuntimeLog(
				{
					source: "preload",
					message: error.message,
					stack: error.stack,
					url: preloadPath,
				},
				context(),
			);
		});

		win.webContents.on("render-process-gone", (_event, details) => {
			const now = Date.now();
			const shouldReload = shouldReloadRenderer(details.reason, lastRendererRecoveryAt, now);
			const resourcesChanged = this.#resourcesChangedSinceLaunch();
			if (shouldReload && !resourcesChanged) lastRendererRecoveryAt = now;
			writeRuntimeLog(
				{
					source: "renderer-process",
					message: `Renderer process exited: ${details.reason}`,
					url: win.webContents.getURL(),
					details: {
						reason: details.reason,
						exitCode: details.exitCode,
						automaticReload: shouldReload && !resourcesChanged,
						resourcesChanged,
					},
				},
				context(),
			);
			if (shouldReload && resourcesChanged) {
				this.#restartForChangedResources(record, "renderer-process-gone");
			} else if (shouldReload) {
				queueMicrotask(() => {
					if (!win.isDestroyed() && !win.webContents.isDestroyed()) this.#loadRenderer(win);
				});
			}
		});

		win.on("unresponsive", () => {
			writeRuntimeLog(
				{
					source: "renderer-unresponsive",
					message: "Renderer stopped responding",
					url: win.webContents.getURL(),
				},
				context(),
			);
		});

		win.webContents.on("console-message", details => {
			if (details.level !== "error") return;
			writeRuntimeLog(
				{
					source: "renderer-console",
					message: details.message,
					url: details.sourceId,
					line: details.lineNumber,
				},
				context(),
			);
			this.#restartForChangedResources(record, "renderer-console-error");
		});
	}

	#loadRenderer(win: BrowserWindow): void {
		if (process.env.ELECTRON_RENDERER_URL) {
			void win.loadURL(process.env.ELECTRON_RENDERER_URL);
		} else {
			void win.loadFile(join(__dirname, "../renderer/index.html"));
		}
	}

	#readResourceIdentity(): ApplicationResourceIdentity | null {
		if (this.#resourceArchivePath === null) return null;
		try {
			const stats = fs.statSync(this.#resourceArchivePath);
			return {
				device: stats.dev,
				inode: stats.ino,
				size: stats.size,
				modifiedAt: stats.mtimeMs,
			};
		} catch {
			return null;
		}
	}

	#resourcesChangedSinceLaunch(): boolean {
		return applicationResourcesChanged(this.#launchResourceIdentity, this.#readResourceIdentity());
	}

	#restartForChangedResources(record: WindowRecord, trigger: string): boolean {
		const currentIdentity = this.#readResourceIdentity();
		if (!applicationResourcesChanged(this.#launchResourceIdentity, currentIdentity)) return false;
		if (this.#resourceRestartScheduled) return true;
		this.#resourceRestartScheduled = true;
		writeRuntimeLog(
			{
				source: "application-resources",
				message:
					"Packaged application resources changed while omp was running; restarting before renderer recovery",
				url: record.win.webContents.getURL(),
				details: {
					trigger,
					launchInode: this.#launchResourceIdentity?.inode ?? -1,
					currentInode: currentIdentity?.inode ?? -1,
					launchSize: this.#launchResourceIdentity?.size ?? -1,
					currentSize: currentIdentity?.size ?? -1,
				},
			},
			{ windowId: record.id, cwd: record.cwd },
		);
		queueMicrotask(() => {
			app.relaunch();
			app.quit();
		});
		return true;
	}

	recordFor(win: BrowserWindow): WindowRecord | undefined {
		return this.#records.get(win.webContents.id);
	}

	/**
	 * Show+focus a window by its webContents id (the F-OWN focus pattern:
	 * opening an already-attached session foregrounds its owner window
	 * instead of spawning a duplicate). False when unknown or destroyed.
	 */
	focusWindowById(id: number): boolean {
		const record = this.#records.get(id);
		if (!record || record.win.isDestroyed()) return false;
		if (record.win.isMinimized()) record.win.restore();
		record.win.show();
		record.win.focus();
		return true;
	}

	/** Update a window's project dir (called when its sidecar switches project). */
	setRecordCwd(win: BrowserWindow, cwd: string): void {
		const record = this.#records.get(win.webContents.id);
		if (record) record.cwd = cwd;
	}

	/** Read-and-clear the session a fresh window should switch to (one-shot). */
	consumePendingSession(win: BrowserWindow): string | undefined {
		const record = this.#records.get(win.webContents.id);
		const path = record?.pendingSessionPath;
		if (record) record.pendingSessionPath = undefined;
		return path;
	}

	getMainWindow(): BrowserWindow | null {
		for (const record of this.#records.values()) {
			if (!record.win.isDestroyed()) return record.win;
		}
		return null;
	}

	/**
	 * Window that should receive user-initiated actions (menu/tray): the
	 * focused window when it's one of ours, else the first live window.
	 */
	getTargetWindow(): BrowserWindow | null {
		const focused = BrowserWindow.getFocusedWindow();
		if (focused && !focused.isDestroyed() && this.#records.has(focused.webContents.id)) return focused;
		return this.getMainWindow();
	}

	getAllWindows(): BrowserWindow[] {
		return [...this.#records.values()].map(r => r.win).filter(w => !w.isDestroyed());
	}

	/**
	 * Run-progress indicator (agent `terminal.showProgress` setting): dock
	 * badge (● working, ! waiting — macOS only) plus a progress bar on every
	 * window. macOS has no true indeterminate progress mode, so fixed
	 * fractions act as state markers; "idle" clears both (-1 / empty badge).
	 */
	setRunProgress(state: RunProgressState): void {
		app.dock?.setBadge(state === "working" ? "●" : state === "waiting" ? "!" : "");
		const progress = state === "working" ? 0.5 : state === "waiting" ? 0.75 : -1;
		for (const win of this.getAllWindows()) {
			win.setProgressBar(progress);
		}
	}

	#persistState(win: BrowserWindow): void {
		if (win.isDestroyed()) return;
		const bounds = win.getBounds();
		this.#store.set("windowState", {
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
			isMaximized: win.isMaximized(),
		});
	}
}
