/**
 * Registers all IPC handlers and wires sidecar events to renderer windows.
 */
import { type Dirent, existsSync, promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, clipboard, dialog, ipcMain, Notification, shell } from "electron";
import Store from "electron-store";
import type {
	CustomProviderInput,
	FsTreeEntry,
	IpcBenchmarkRunOptions,
	IpcBenchmarkRunResult,
	IpcCloseTabPayload,
	IpcExtensionUiRespondPayload,
	IpcFsListPayload,
	IpcFsReadImagePayload,
	IpcFsReadImageResult,
	IpcFsReadPayload,
	IpcFsReadPlanPayload,
	IpcFsReadPlanResult,
	IpcGetSessionOwnerPayload,
	IpcHostToolResultPayload,
	IpcHostToolUpdatePayload,
	IpcHostUriResultPayload,
	IpcNotifyPayload,
	IpcOpenPathResult,
	IpcPrefsGetPayload,
	IpcPrefsSetPayload,
	IpcRpcCommandForTabPayload,
	IpcRpcCommandPayload,
	IpcSessionOpenNewWindowPayload,
	IpcSessionsDeletePayload,
	IpcSessionsListPayload,
	IpcSessionsRenamePayload,
	IpcSessionsSearchPayload,
	IpcSetActiveTabPayload,
	IpcSidecarRestartPayload,
	IpcSpawnTabPayload,
	IpcStatsFetchPayload,
} from "../shared/ipc-types";
import { IPC_COMMANDS, IPC_EVENTS, type RunProgressState, type TrayState } from "../shared/ipc-types";
import type { RpcCommand, RpcSessionState } from "../shared/rpc-types";
import { BenchmarkRunner } from "./benchmark-runner";
import { ensureDefaultWorkspace } from "./default-workspace";
import { openInExternalEditor } from "./editor";
import { mainT } from "./i18n";
import type { LogWatcher } from "./log-watcher";
import { createMenu } from "./menu";
import { deleteModelsProvider, listModelsProviders, modelsPath, upsertModelsProvider } from "./models-config";
import { runtimeLogPath, writeRuntimeLog } from "./runtime-log";
import type { SessionIndex } from "./session-index";
import { resolveEditorCommand } from "./shell-env";
import type { SidecarManager } from "./sidecar";
import type { SidecarPool } from "./sidecar-pool";
import type { StatsClient } from "./stats-client";
import { spawnTabForWindow } from "./tab-spawn";
import { setTrayState } from "./tray";
import type { SpawnWindow, WindowManager } from "./window";

export interface IpcDeps {
	sidecarPool: SidecarPool;
	sessionIndex: SessionIndex;
	statsClient: StatsClient;
	logWatcher: LogWatcher;
	windowManager: WindowManager;
	benchmarkBinaryPath: string | null;
	benchmarkEnv: () => Promise<NodeJS.ProcessEnv>;
	/** Spawn a window with its own sidecar (index.ts's pool-backed helper). */
	spawnWindow: SpawnWindow;
}

/**
 * Resolve the sidecar that owns the calling window. Routing derives from
 * `event.sender` (Electron guarantees it is the caller's webContents), never
 * from a client-supplied id. Null when the window has no sidecar bound yet.
 */
function sidecarFor(deps: IpcDeps, event: Electron.IpcMainInvokeEvent): SidecarManager | null {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win) return null;
	return deps.sidecarPool.sidecarForWindow(win);
}

/**
 * The calling window's working directory — the bound sidecar's cwd when one
 * exists, else the cwd the window was created with (before its sidecar binds).
 */
function cwdFor(deps: IpcDeps, event: Electron.IpcMainInvokeEvent): string | null {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win) return null;
	return deps.sidecarPool.sidecarForWindow(win)?.cwd ?? deps.windowManager.recordFor(win)?.cwd ?? null;
}

interface PrefsSchema {
	[key: string]: unknown;
}

// ============================================================================
// Workspace filesystem (fs:list / fs:read) — node:fs based, no sidecar session
// required, cross-platform. Rooted at the sidecar's cwd.
// ============================================================================

const FS_LIST_DEFAULT_DEPTH = 8;
const FS_LIST_MAX_DEPTH = 16;
const FS_LIST_DEFAULT_MAX_FILES = 2000;
const FS_LIST_MAX_FILES_CAP = 20_000;
const FS_READ_DEFAULT_MAX_BYTES = 200_000;
const FS_READ_MAX_BYTES_CAP = 2_000_000;

/** Always-skipped names, applied like root .gitignore patterns. */
const FS_IGNORED_DEFAULTS = [
	"node_modules",
	".git",
	".hg",
	".svn",
	"dist",
	"out",
	".next",
	"target",
	"build",
	".turbo",
	"coverage",
	"__pycache__",
	".venv",
	"venv",
	".cache",
	".codegraph",
	"bazel-*",
];

interface IgnoreRule {
	negated: boolean;
	dirOnly: boolean;
	regex: RegExp;
}

const REGEX_SPECIALS = "\\^$.|+()[]{}";

/**
 * Compile one gitignore pattern line into a rule. Minimal but faithful to the
 * common semantics: `!` negation, trailing `/` dir-only, any slash anchors the
 * pattern to the root, `*`/`?` match within a segment, `**` crosses segments.
 */
function compileIgnoreRule(rawLine: string): IgnoreRule | null {
	let line = rawLine.trimEnd();
	if (!line || line.startsWith("#")) return null;
	let negated = false;
	if (line.startsWith("!")) {
		negated = true;
		line = line.slice(1);
	} else if (line.startsWith("\\!") || line.startsWith("\\#")) {
		line = line.slice(1);
	}
	let dirOnly = false;
	if (line.endsWith("/")) {
		dirOnly = true;
		line = line.slice(0, -1);
	}
	if (!line) return null;
	const anchored = line.includes("/");
	if (line.startsWith("/")) line = line.slice(1);
	let body = "";
	let i = 0;
	while (i < line.length) {
		const char = line[i];
		if (char === "*") {
			if (line[i + 1] === "*") {
				if (line[i + 2] === "/") {
					body += "(?:[^/]+/)*";
					i += 3;
				} else {
					body += ".*";
					i += 2;
				}
			} else {
				body += "[^/]*";
				i += 1;
			}
		} else if (char === "?") {
			body += "[^/]";
			i += 1;
		} else if (REGEX_SPECIALS.includes(char)) {
			body += `\\${char}`;
			i += 1;
		} else {
			body += char;
			i += 1;
		}
	}
	// A matching directory also ignores everything beneath it.
	const source = anchored ? `^${body}(?:/.*)?$` : `(?:^|/)${body}(?:/.*)?$`;
	return { negated, dirOnly, regex: new RegExp(source) };
}

/** Last matching rule wins, per gitignore semantics. */
function isIgnored(rules: IgnoreRule[], relPath: string, isDir: boolean): boolean {
	let ignored = false;
	for (const rule of rules) {
		if (rule.dirOnly && !isDir) continue;
		if (rule.regex.test(relPath)) ignored = !rule.negated;
	}
	return ignored;
}

async function loadIgnoreRules(rootAbs: string): Promise<IgnoreRule[]> {
	const rules: IgnoreRule[] = [];
	for (const pattern of FS_IGNORED_DEFAULTS) {
		const rule = compileIgnoreRule(pattern);
		if (rule) rules.push(rule);
	}
	try {
		const content = await fsp.readFile(path.join(rootAbs, ".gitignore"), "utf8");
		for (const line of content.split(/\r?\n/)) {
			const rule = compileIgnoreRule(line);
			if (rule) rules.push(rule);
		}
	} catch {
		// No readable root .gitignore — defaults only.
	}
	return rules;
}

/** Resolve `rel` against `root`, refusing escapes outside the workspace. */
function resolveWithin(root: string, rel: string): string | null {
	const resolved = path.resolve(root, rel);
	const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
	if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;
	return resolved;
}

/** `abs` when it exists and is a regular file, else null. */
async function statFile(abs: string): Promise<string | null> {
	try {
		return (await fsp.stat(abs)).isFile() ? abs : null;
	} catch {
		return null;
	}
}

/**
 * Newest top-level `*plan.md` (case-insensitive) in `dirAbs`, mirroring the
 * agent-side `listPlanFiles` fallback (the agent names its own
 * `local://<slug>-plan.md`, so the configured path alone often misses it).
 */
async function newestPlanFile(dirAbs: string): Promise<string | null> {
	let dirents: Dirent[];
	try {
		dirents = await fsp.readdir(dirAbs, { withFileTypes: true });
	} catch {
		return null;
	}
	let best: { abs: string; mtimeMs: number } | null = null;
	for (const dirent of dirents) {
		if (!dirent.isFile() || !/plan\.md$/i.test(dirent.name)) continue;
		const abs = path.join(dirAbs, dirent.name);
		try {
			const { mtimeMs } = await fsp.stat(abs);
			if (!best || mtimeMs > best.mtimeMs) best = { abs, mtimeMs };
		} catch {
			// Vanished between readdir and stat — skip.
		}
	}
	return best?.abs ?? null;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(value)));
}

interface WalkState {
	rules: IgnoreRule[];
	maxDepth: number;
	maxFiles: number;
	fileCount: number;
	truncated: boolean;
}

/** Recursive readdir → sorted tree (dirs first, then files, each alphabetical). */
async function walkWorkspace(
	dirAbs: string,
	relPrefix: string,
	depth: number,
	state: WalkState,
): Promise<FsTreeEntry[]> {
	let dirents: Dirent[];
	try {
		dirents = await fsp.readdir(dirAbs, { withFileTypes: true });
	} catch {
		return []; // Unreadable directory (permissions) — skip, don't fail the walk.
	}
	const dirs: FsTreeEntry[] = [];
	const files: FsTreeEntry[] = [];
	const sorted = dirents.filter(dirent => !dirent.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name));
	for (const dirent of sorted) {
		if (state.truncated) break;
		const isDir = dirent.isDirectory();
		if (!isDir && !dirent.isFile()) continue;
		const rel = relPrefix ? `${relPrefix}/${dirent.name}` : dirent.name;
		if (isIgnored(state.rules, rel, isDir)) continue;
		if (isDir) {
			const children =
				depth < state.maxDepth ? await walkWorkspace(path.join(dirAbs, dirent.name), rel, depth + 1, state) : [];
			dirs.push({ name: dirent.name, path: rel, kind: "dir", children });
		} else {
			if (state.fileCount >= state.maxFiles) {
				state.truncated = true;
				break;
			}
			state.fileCount += 1;
			files.push({ name: dirent.name, path: rel, kind: "file" });
		}
	}
	return [...dirs, ...files];
}

// Dedupe state for SYSTEM_NOTIFY across multiple windows (see the handler).
let lastNotifyKey = "";
let lastNotifyAt = 0;

// Per-window tray/progress snapshots, aggregated for the app-global tray/dock.
const trayStates = new Map<number, TrayState>();
const progressStates = new Map<number, RunProgressState>();

/** Collapse per-window tray statuses to one: any error > streaming > waiting > idle. */
function aggregateTrayStatus(states: TrayState[]): TrayState["status"] {
	if (states.some(s => s.status === "error")) return "error";
	if (states.some(s => s.status === "streaming")) return "streaming";
	if (states.some(s => s.status === "waiting")) return "waiting";
	return "idle";
}

/** Collapse per-window run-progress to one: any working > waiting > idle. */
function aggregateProgress(states: RunProgressState[]): RunProgressState {
	if (states.some(s => s === "working")) return "working";
	if (states.some(s => s === "waiting")) return "waiting";
	return "idle";
}

export function registerIpcHandlers(deps: IpcDeps): void {
	const benchmarkRunners = new Map<number, BenchmarkRunner>();
	const { sidecarPool, sessionIndex, statsClient, logWatcher, windowManager } = deps;
	const prefsStore = new Store<PrefsSchema>({ name: "prefs" });

	// Drop a closed window's tray/progress snapshot so the aggregate reflects
	// only live windows (and re-render the tray with the new aggregate).
	windowManager.onWindowClosed = record => {
		trayStates.delete(record.id);
		progressStates.delete(record.id);
		benchmarkRunners.get(record.id)?.abort();
		benchmarkRunners.delete(record.id);
	};

	// Sidecar → owning-window event forwarding (events/status/extensionUi/
	// hostUriRequest/subagentFrame/commandsUpdate/configUpdate) is wired by
	// SidecarPool at acquire time. hostToolCall needs the main-process executor,
	// so the pool routes it through this callback (set once at startup). The
	// boolean tells the pool whether the tool was answered inline; only
	// renderer-forwarded calls get request-id → origin tracking (F-UI-ORIGIN).
	sidecarPool.hostToolExecutor = (sidecar, request, win) => {
		const result = executeGuiHostTool(request.toolName, request.arguments);
		if (result !== undefined) {
			sidecar.sendSideChannel({ type: "host_tool_result", id: request.id, result });
			return true;
		}
		// Unknown host tools → forward to the owning renderer.
		if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.HOST_TOOL_CALL, { request });
		return false;
	};

	// Session index changes
	sessionIndex.onChange = () => {
		broadcast(windowManager, IPC_EVENTS.SESSIONS_CHANGED, undefined);
	};

	// Log lines (batched by LogWatcher)
	logWatcher.onLines = lines => {
		broadcast(windowManager, IPC_EVENTS.LOG_LINE, lines);
	};

	// ========================================================================
	// IPC Command Handlers
	// ========================================================================
	ipcMain.on(IPC_COMMANDS.RUNTIME_ERROR_REPORT, (event, report: unknown) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		writeRuntimeLog(report, {
			windowId: win?.webContents.id,
			cwd: win ? windowManager.recordFor(win)?.cwd : undefined,
		});
	});

	ipcMain.handle(IPC_COMMANDS.RUNTIME_LOG_PATH, () => runtimeLogPath());

	// RPC command passthrough — always returns a response, never throws.
	// Throwing here causes "Error occurred in handler" console spam AND
	// Tray/dock are app-global OS surfaces; with N parallel windows each pushing
	// its own state, aggregate per-window instead of last-write-wins (which made
	// the indicator flap with push order) or focus-gating (which let it go
	// stale). Status aggregates across windows: any error > streaming > waiting
	// > idle; the displayed blob is the most recently pushed one, with its
	// status replaced by the aggregate.
	ipcMain.on(IPC_EVENTS.TRAY_STATE_PUSH, (event, state: TrayState) => {
		const winId = BrowserWindow.fromWebContents(event.sender)?.webContents.id;
		if (winId === undefined) return;
		trayStates.set(winId, state);
		const aggregate = aggregateTrayStatus([...trayStates.values()]);
		setTrayState({ ...state, status: aggregate });
	});

	// Run-progress (terminal.showProgress): aggregate per-window the same way —
	// any window working → working, else any waiting → waiting, else idle.
	ipcMain.on(IPC_EVENTS.PROGRESS_SET, (event, state: RunProgressState) => {
		const winId = BrowserWindow.fromWebContents(event.sender)?.webContents.id;
		if (winId === undefined) return;
		progressStates.set(winId, state);
		windowManager.setRunProgress(aggregateProgress([...progressStates.values()]));
	});

	ipcMain.handle(IPC_COMMANDS.RPC_COMMAND, async (event, payload: IpcRpcCommandPayload) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		const sidecar = win ? sidecarPool.sidecarForWindow(win) : null;
		const client = sidecar?.rpcClient;
		if (!client || !sidecar) {
			return { id: payload.command.id, type: "response", success: false, error: "Sidecar not connected" };
		}
		if (sidecar.status !== "ready") {
			return {
				id: payload.command.id,
				type: "response",
				success: false,
				error: `Sidecar not ready (${sidecar.status})`,
			};
		}
		const { id: _id, ...cmd } = payload.command;
		// F-OWN: pin the issuing tab NOW — the ownership note below must register
		// against the tab that sent the command even if the user switches tabs
		// while it is in flight.
		const issuerTabId = win ? sidecarPool.activeTabForWindow(win) : null;
		// F-OWN refuse-or-focus backstop: a switch_session onto a file a
		// DIFFERENT tab owns would double-attach it (the owner itself re-attaches
		// freely). Refuse BEFORE dispatch — the sidecar would attach for real
		// and silently diverge the owner's file. The renderer pre-check routes
		// to the owner; this catches the race.
		if (cmd.type === "switch_session") {
			const blocker = sidecarPool.foreignSessionOwner(issuerTabId, cmd.sessionPath);
			if (blocker) {
				return {
					id: _id,
					type: "response",
					command: "switch_session",
					success: false,
					error: "Session is already open in another tab",
					code: "session_owned_elsewhere",
					data: { ownerTabId: blocker.tabId, ownerWinId: blocker.winId },
				};
			}
		}
		try {
			const response = await client.command({ ...cmd, id: _id } as RpcCommand, payload.timeoutMs);
			// F-OWN registration points carried by this passthrough: a successful
			// switch_session attaches the issuer to that file; get_state is how
			// the renderer's attach/hydrate reports the file (session_info_update
			// itself carries only the session id, never the path).
			if (issuerTabId && response.success) {
				if (cmd.type === "switch_session") {
					const cancelled = (response.data as { cancelled?: boolean } | undefined)?.cancelled ?? false;
					if (!cancelled) sidecarPool.noteSessionFile(issuerTabId, cmd.sessionPath);
				} else if (cmd.type === "get_state") {
					const state = response.data as RpcSessionState | undefined;
					sidecarPool.noteSessionFile(issuerTabId, state?.sessionFile ?? null);
					// switch_session re-roots the agent with no main-observable
					// event; get_state (run by every hydrate) carries the live
					// cwd. Adopt it so the tab chip tracks the session, and sync
					// the window record (menu "New Window" reads cwd from it) —
					// the same tail as a project switch, minus the respawn.
					if (state?.cwd && win && sidecarPool.adoptSessionCwd(issuerTabId, state.cwd)) {
						windowManager.setRecordCwd(win, state.cwd);
					}
				}
			}
			return response;
		} catch (err) {
			return { id: _id, type: "response", success: false, error: err instanceof Error ? err.message : String(err) };
		}
	});

	// RPC addressed at a SPECIFIC tab's sidecar — background-tab flows (the
	// worktree close prompt) must not route through the window's active tab.
	// No F-OWN bookkeeping here: the callers query/remove worktrees, never
	// switch sessions.
	ipcMain.handle(IPC_COMMANDS.RPC_COMMAND_FOR_TAB, async (event, payload: IpcRpcCommandForTabPayload) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) return { id: payload?.command?.id, type: "response", success: false, error: "No window" };
		const sidecar = sidecarPool.sidecarForTab(win, payload.tabId);
		if (!sidecar) {
			return { id: payload.command.id, type: "response", success: false, error: "Unknown tab" };
		}
		if (sidecar.status !== "ready") {
			return {
				id: payload.command.id,
				type: "response",
				success: false,
				error: `Sidecar not ready (${sidecar.status})`,
			};
		}
		const client = sidecar.rpcClient;
		if (!client) return { id: payload.command.id, type: "response", success: false, error: "No RPC client" };
		const { id: _id, ...cmd } = payload.command;
		try {
			return await client.command({ ...cmd, id: _id } as RpcCommand, payload.timeoutMs);
		} catch (err) {
			return { id: _id, type: "response", success: false, error: err instanceof Error ? err.message : String(err) };
		}
	});

	// Extension UI respond — F-UI-ORIGIN: route to the sidecar that RAISED the
	// request (tracked by request id), not the window's active tab; the user
	// may have switched tabs while the dialog was open. Unknown ids (raised
	// before tracking, or after a restart) fall back to the active sidecar.
	ipcMain.handle(IPC_COMMANDS.EXTENSION_UI_RESPOND, (event, payload: IpcExtensionUiRespondPayload) => {
		const { response } = payload;
		if (typeof response?.id === "string" && sidecarPool.routeSideChannel(response.id, response, true)) return;
		sidecarFor(deps, event)?.sendSideChannel(response);
	});

	// Host tool result — same origin routing as extension UI (verified: the
	// raise path is per-sidecar, but a naive sidecarFor response route would
	// misroute to the active tab after a switch).
	ipcMain.handle(IPC_COMMANDS.HOST_TOOL_RESULT, (event, payload: IpcHostToolResultPayload) => {
		const { result } = payload;
		if (typeof result?.id === "string" && sidecarPool.routeSideChannel(result.id, result, true)) return;
		sidecarFor(deps, event)?.sendSideChannel(result);
	});

	// Host tool update — origin routing without unregistering: the result
	// frame follows and still needs the route.
	ipcMain.handle(IPC_COMMANDS.HOST_TOOL_UPDATE, (event, payload: IpcHostToolUpdatePayload) => {
		const { update } = payload;
		if (typeof update?.id === "string" && sidecarPool.routeSideChannel(update.id, update, false)) return;
		sidecarFor(deps, event)?.sendSideChannel(update);
	});

	// Host URI result — same origin routing as extension UI.
	ipcMain.handle(IPC_COMMANDS.HOST_URI_RESULT, (event, payload: IpcHostUriResultPayload) => {
		const { result } = payload;
		if (typeof result?.id === "string" && sidecarPool.routeSideChannel(result.id, result, true)) return;
		sidecarFor(deps, event)?.sendSideChannel(result);
	});

	// Sessions
	ipcMain.handle(IPC_COMMANDS.SESSIONS_LIST, async (event, payload: IpcSessionsListPayload) => {
		const scope = payload.scope === "local" ? "local" : "global";
		return sessionIndex.list(scope, cwdFor(deps, event) ?? undefined);
	});

	ipcMain.handle(IPC_COMMANDS.SESSIONS_DELETE, async (_event, payload: IpcSessionsDeletePayload) => {
		if (typeof payload.sessionPath !== "string" || !payload.sessionPath.endsWith(".jsonl")) {
			throw new Error("Invalid session path");
		}
		const owner = sidecarPool.sessionOwner(payload.sessionPath);
		if (owner) {
			const response = await sidecarPool.commandForIdleSession(payload.sessionPath, { type: "drop_session" });
			if (!response) throw new Error("Session is currently running");
			if (!response.success) throw new Error(response.error);
			const cancelled = (response.data as { cancelled?: boolean } | undefined)?.cancelled ?? false;
			if (cancelled) throw new Error("Session deletion was cancelled");
			return;
		}
		return sessionIndex.deleteSession(payload.sessionPath);
	});

	ipcMain.handle(IPC_COMMANDS.SESSIONS_RENAME, async (event, payload: IpcSessionsRenamePayload) => {
		if (typeof payload.sessionPath !== "string" || !payload.sessionPath.endsWith(".jsonl")) {
			throw new Error("Invalid session path");
		}
		const name = typeof payload.name === "string" ? payload.name.trim() : "";
		if (!name) throw new Error("Session name cannot be empty");
		const command: RpcCommand = { type: "set_session_name", name, sessionPath: payload.sessionPath };
		const owner = sidecarPool.sessionOwner(payload.sessionPath);
		let response = owner ? await sidecarPool.commandForIdleSession(payload.sessionPath, command) : null;
		if (!owner) {
			const caller = sidecarFor(deps, event);
			if (caller?.status === "ready" && caller.rpcClient) response = await caller.rpcClient.command(command);
		}
		if (!response) throw new Error(owner ? "Session is currently running" : "Sidecar not connected");
		if (!response.success) throw new Error(response.error);
	});

	// Open a session (or a fresh project window) in a NEW parallel window with
	// its own sidecar. The calling window's sidecar is left running untouched —
	// this is the explicit parallel action. Returns false at the pool cap.
	// F-OWN: when the session is already attached to a tab, focus the owner
	// window (win.show()+win.focus() — the codebase's focus pattern, see
	// deep-link.ts/tray.ts) instead of spawning a second sidecar for the same
	// file; resolves true because the session ends up foregrounded either way.
	// The session switch is done by the NEW window's renderer on boot (it pulls
	// pendingSessionPath and runs switch_session + hydrate itself), which avoids
	// racing the renderer's boot hydration and surfaces failures in that window.
	ipcMain.handle(IPC_COMMANDS.SESSION_OPEN_NEW_WINDOW, async (event, payload: IpcSessionOpenNewWindowPayload) => {
		const sessionPath = typeof payload?.sessionPath === "string" ? payload.sessionPath : undefined;
		if (sessionPath) {
			const owner = deps.sidecarPool.sessionOwner(sessionPath);
			if (owner && deps.windowManager.focusWindowById(owner.winId)) return true;
		}
		if (deps.sidecarPool.atCap) return false;
		const callerCwd = cwdFor(deps, event) ?? process.cwd();
		const cwd = typeof payload?.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : callerCwd;
		// The new window's sidecar must spawn with the target file's kind, or the
		// boot-time switch_session hits the agent-side kind guard and the pool
		// entry would lie about its kind (I1).
		const kind = sessionPath ? await sessionIndex.kindFor(sessionPath) : undefined;
		return deps.spawnWindow(cwd, sessionPath, kind) !== null;
	});

	// Fresh window pulls the session it was opened to display (one-shot). The
	// renderer performs the actual switch_session + hydrate on boot, which
	// avoids racing the boot hydration and surfaces failures in that window.
	ipcMain.handle(IPC_COMMANDS.SESSION_CONSUME_PENDING, event => {
		const win = BrowserWindow.fromWebContents(event.sender);
		return win ? (deps.windowManager.consumePendingSession(win) ?? null) : null;
	});

	// ========================================================================
	// Session tabs — in-window parallel sessions. Each tab owns a pooled
	// sidecar bound to the CALLING window (no new BrowserWindow); the pool
	// moves full event forwarding to the window's active tab. Routing derives
	// from event.sender, so a renderer can only touch its own window's tabs.
	// ========================================================================

	// Spawn a background tab. Null at the pool cap; the renderer decides
	// whether to activate it (SET_ACTIVE_TAB) — spawn itself never switches.
	// F-OWN: a sessionPath already attached to a tab returns
	// { tabId: null, ownerTabId, ownerWinId, refusal: "owned" } — the renderer
	// switches to (or focuses) the owner instead of double-attaching the file.
	// F-KIND: an explicit payload kind that disagrees with the file's stamped
	// kind returns { tabId: null, refusal: "kind-mismatch" } (I3); an omitted
	// payload kind defers to the file. Decision logic lives in tab-spawn.ts so
	// both refusal contracts are unit-testable without an Electron runtime.
	ipcMain.handle(IPC_COMMANDS.SPAWN_TAB, (event, payload: IpcSpawnTabPayload) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) return null;
		return spawnTabForWindow(
			{
				sidecarPool: deps.sidecarPool,
				sessionIndex,
				fallbackCwd: () => cwdFor(deps, event) ?? process.cwd(),
				defaultWorkspace: ensureDefaultWorkspace,
			},
			win,
			payload,
		);
	});

	// Release a tab's sidecar. The window falls back to its initial no-tab
	// state when its last tab closes (welcome screen; handlers tolerate null).
	ipcMain.handle(IPC_COMMANDS.CLOSE_TAB, (event, payload: IpcCloseTabPayload) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win || typeof payload?.tabId !== "string") return false;
		if (!deps.sidecarPool.sidecarForTab(win, payload.tabId)) return false;
		return deps.sidecarPool.releaseTab(payload.tabId);
	});

	// Move full event forwarding to the window's active tab (listeners move,
	// never duplicate). The renderer calls this before hydrateSession().
	ipcMain.handle(IPC_COMMANDS.SET_ACTIVE_TAB, (event, payload: IpcSetActiveTabPayload) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win || typeof payload?.tabId !== "string") return false;
		return deps.sidecarPool.setActiveTab(win, payload.tabId);
	});

	// Boot reconciliation: the window's tabs in acquisition order (the initial
	// sidecar is tab 0 — main minted its tabId at acquire).
	ipcMain.handle(IPC_COMMANDS.GET_TABS, event => {
		const win = BrowserWindow.fromWebContents(event.sender);
		return win ? deps.sidecarPool.tabsForWindow(win) : [];
	});

	// F-OWN: which tab/window owns a session file, if any. The renderer
	// belt-guards (open tab / open-in-new-window rows) consult this before
	// attempting an attach.
	ipcMain.handle(IPC_COMMANDS.GET_SESSION_OWNER, (_event, payload: IpcGetSessionOwnerPayload) => {
		return typeof payload?.sessionPath === "string" ? deps.sidecarPool.sessionOwner(payload.sessionPath) : null;
	});

	// Full-content search over session files (raw JSONL grep in main, scoped to
	// the same candidate set the list view would show).
	ipcMain.handle(IPC_COMMANDS.SESSIONS_SEARCH, async (event, payload: IpcSessionsSearchPayload) => {
		const scope = payload.scope === "local" ? "local" : "global";
		const query = typeof payload.query === "string" ? payload.query : "";
		const candidates = await sessionIndex.list(scope, cwdFor(deps, event) ?? undefined);
		return sessionIndex.searchContent(
			query,
			candidates.map(info => info.path),
		);
	});

	// Stats
	ipcMain.handle(IPC_COMMANDS.STATS_FETCH, async (_event, payload: IpcStatsFetchPayload) => {
		if (typeof payload.path !== "string") {
			throw new Error("Invalid stats path");
		}
		try {
			return await statsClient.fetch(payload.path, payload.params);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { error: msg, unavailable: true };
		}
	});

	ipcMain.handle(
		IPC_COMMANDS.BENCH_RUN,
		async (event, options: IpcBenchmarkRunOptions): Promise<IpcBenchmarkRunResult> => {
			const binaryPath = deps.benchmarkBinaryPath;
			const cwd = cwdFor(deps, event);
			if (!binaryPath) return { success: false, error: "Bundled omp is unavailable" };
			if (!cwd) return { success: false, error: "No active workspace" };
			const senderId = event.sender.id;
			const runner = benchmarkRunners.get(senderId) ?? new BenchmarkRunner();
			benchmarkRunners.set(senderId, runner);
			try {
				return await runner.run(binaryPath, cwd, options, await deps.benchmarkEnv());
			} finally {
				if (!runner.running) benchmarkRunners.delete(senderId);
			}
		},
	);
	ipcMain.handle(IPC_COMMANDS.BENCH_ABORT, event => benchmarkRunners.get(event.sender.id)?.abort() ?? false);

	// System
	ipcMain.handle(IPC_COMMANDS.SYSTEM_OPEN_EXTERNAL, async (_event, url: string) => {
		if (typeof url === "string" && (url.startsWith("https://") || url.startsWith("http://"))) {
			await shell.openExternal(url);
		}
	});

	// Tool-card path links — open a file in the system editor. "~" expands,
	// relative paths resolve inside the calling window's workspace (escapes
	// refused), absolute paths pass through: the agent can legitimately touch
	// files outside the workspace. When no editor association exists, reveal
	// the file in the file manager instead of failing.
	ipcMain.handle(IPC_COMMANDS.SYSTEM_OPEN_PATH, async (event, target: string): Promise<IpcOpenPathResult> => {
		if (typeof target !== "string" || !target.trim()) return { ok: false, error: "Empty path" };
		let resolved = target.startsWith("~/") ? path.join(os.homedir(), target.slice(2)) : target;
		if (!path.isAbsolute(resolved)) {
			const rootAbs = cwdFor(deps, event);
			if (!rootAbs) return { ok: false, error: "No workspace" };
			const within = resolveWithin(rootAbs, resolved);
			if (!within) return { ok: false, error: "Path escapes the workspace" };
			resolved = within;
		}
		// A stale tool card can reference a file that no longer exists (or never
		// did outside the workspace). Both openPath and showItemInFolder fail
		// silently on missing paths, so detect it here and let the link toast.
		try {
			await fsp.access(resolved);
		} catch {
			return { ok: false, error: "File not found" };
		}
		const openError = await shell.openPath(resolved);
		if (!openError) return { ok: true, resolvedPath: resolved };
		shell.showItemInFolder(resolved);
		return { ok: true, resolvedPath: resolved };
	});

	ipcMain.handle(
		IPC_COMMANDS.SYSTEM_SAVE_DIALOG,
		async (event, defaultPath?: string, filters?: { name: string; extensions: string[] }[]) => {
			const win = BrowserWindow.fromWebContents(event.sender);
			if (!win) return null;
			const result = await dialog.showSaveDialog(win, {
				defaultPath: defaultPath ?? "session.html",
				filters: filters ?? [{ name: "HTML", extensions: ["html"] }],
			});
			return result.canceled ? null : (result.filePath ?? null);
		},
	);

	ipcMain.handle(
		IPC_COMMANDS.SYSTEM_OPEN_DIALOG,
		async (event, filters?: { name: string; extensions: string[] }[], options?: { directory?: boolean }) => {
			const win = BrowserWindow.fromWebContents(event.sender);
			if (!win) return null;
			const result = await dialog.showOpenDialog(win, {
				properties: options?.directory ? ["openDirectory", "createDirectory"] : ["openFile", "multiSelections"],
				filters: filters ?? [],
			});
			return result.canceled ? null : result.filePaths;
		},
	);

	ipcMain.handle(IPC_COMMANDS.SYSTEM_CLIPBOARD_READ, () => {
		return clipboard.readText();
	});

	ipcMain.handle(IPC_COMMANDS.SYSTEM_NOTIFY, (event, payload: IpcNotifyPayload) => {
		if (typeof payload.title === "string") {
			// Dedupe within a window (a turn can emit the same notification from
			// several renderers), but NOT across windows — two parallel sessions
			// finishing in different windows are distinct events the user wants.
			const winId = BrowserWindow.fromWebContents(event.sender)?.webContents.id ?? 0;
			const key = `${winId}${payload.title}${payload.body ?? ""}`;
			const now = Date.now();
			if (key === lastNotifyKey && now - lastNotifyAt < 1500) return;
			lastNotifyKey = key;
			lastNotifyAt = now;
			new Notification({ title: payload.title, body: payload.body ?? "" }).show();
		}
	});

	// Preferences
	ipcMain.handle(IPC_COMMANDS.PREFS_GET, (_event, payload: IpcPrefsGetPayload) => {
		if (payload.key) {
			return prefsStore.get(payload.key);
		}
		return prefsStore.store;
	});

	ipcMain.handle(IPC_COMMANDS.PREFS_SET, (_event, payload: IpcPrefsSetPayload) => {
		if (typeof payload.key !== "string") {
			throw new Error("Invalid preference key");
		}
		prefsStore.set(payload.key, payload.value);
		if (payload.key === "language" && (payload.value === "en" || payload.value === "zh")) {
			createMenu(windowManager, deps.spawnWindow);
		}
	});

	// Sidecar control
	ipcMain.handle(IPC_COMMANDS.SIDECAR_RESTART, (event, payload?: IpcSidecarRestartPayload) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) throw new Error("No window");
		const sidecar =
			typeof payload?.tabId === "string"
				? sidecarPool.sidecarForTab(win, payload.tabId)
				: sidecarPool.sidecarForWindow(win);
		if (!sidecar) throw new Error("Unknown tab");
		const sessionPath =
			typeof payload?.sessionPath === "string" && payload.sessionPath ? payload.sessionPath : undefined;
		sidecar.restart(undefined, sessionPath);
	});

	ipcMain.handle(IPC_COMMANDS.SIDECAR_SELECT_PROJECT, async event => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) return null;
		const sidecar = sidecarFor(deps, event);
		if (!sidecar) return null;
		const result = await dialog.showOpenDialog(win, {
			title: mainT("dialog.openProject"),
			defaultPath: sidecar.cwd,
			properties: ["openDirectory", "createDirectory"],
		});
		if (result.canceled || !result.filePaths[0]) return null;

		const cwd = result.filePaths[0];
		prefsStore.set("lastProject", cwd);
		// Per-window project switch: restart only this window's sidecar and keep
		// the window record in sync (menu "New Window" reads cwd from it).
		windowManager.setRecordCwd(win, cwd);
		sidecar.restart(cwd);
		return cwd;
	});

	// Switch to a KNOWN workspace directory (no native picker): used by the
	// workspace manager to jump to a recent project. Validates the directory
	// exists, then restarts the sidecar there (same tail as select-project).
	ipcMain.handle(IPC_COMMANDS.SIDECAR_SET_PROJECT, async (event, payload: { cwd?: string }) => {
		const cwd = payload?.cwd;
		if (typeof cwd !== "string" || cwd.length === 0) return false;
		const sidecar = sidecarFor(deps, event);
		if (!sidecar) return false;
		try {
			if (!(await fsp.stat(cwd)).isDirectory()) return false;
		} catch {
			return false;
		}
		prefsStore.set("lastProject", cwd);
		const win = BrowserWindow.fromWebContents(event.sender);
		if (win) windowManager.setRecordCwd(win, cwd);
		sidecar.restart(cwd);
		return true;
	});

	ipcMain.handle(IPC_COMMANDS.SIDECAR_DEFAULT_WORKSPACE, () => ensureDefaultWorkspace());

	ipcMain.handle(IPC_COMMANDS.MODELS_PROVIDERS_LIST, () => {
		return listModelsProviders();
	});

	ipcMain.handle(IPC_COMMANDS.MODELS_PROVIDER_UPSERT, (_event, input: CustomProviderInput) => {
		upsertModelsProvider(input);
	});

	ipcMain.handle(IPC_COMMANDS.MODELS_PROVIDER_DELETE, (_event, id: string) => {
		deleteModelsProvider(id);
	});

	// "Edit config" — open the agent's models.yml in the system editor. The
	// file is created with a minimal skeleton when missing so there is always
	// something to edit; when no editor association exists, reveal it in the
	// file manager instead.
	ipcMain.handle(IPC_COMMANDS.MODELS_CONFIG_OPEN, async () => {
		const file = modelsPath();
		if (!existsSync(file)) {
			await fsp.mkdir(path.dirname(file), { recursive: true });
			await fsp.writeFile(file, "# Custom model providers.\nproviders: {}\n", "utf8");
		}
		const openError = await shell.openPath(file);
		if (openError) shell.showItemInFolder(file);
		return { path: file, opened: !openError };
	});

	// Workspace filesystem — node:fs against the calling window's cwd; works
	// without a live sidecar session and never throws (renderer reads ok/error).
	ipcMain.handle(IPC_COMMANDS.FS_LIST, async (event, payload: IpcFsListPayload) => {
		const rootAbs = cwdFor(deps, event);
		if (!rootAbs) return { ok: false, entries: [], truncated: false, error: "No workspace" };
		const prefix = (typeof payload.path === "string" ? payload.path : "")
			.replace(/\\/g, "/")
			.replace(/^\.\//, "")
			.replace(/^\/+|\/+$/g, "");
		const dirAbs = resolveWithin(rootAbs, prefix);
		if (!dirAbs) {
			return { ok: false, entries: [], truncated: false, error: "Path escapes the workspace" };
		}
		const state: WalkState = {
			rules: await loadIgnoreRules(rootAbs),
			maxDepth: clampInt(payload.maxDepth, 1, FS_LIST_MAX_DEPTH, FS_LIST_DEFAULT_DEPTH),
			maxFiles: clampInt(payload.maxEntries, 1, FS_LIST_MAX_FILES_CAP, FS_LIST_DEFAULT_MAX_FILES),
			fileCount: 0,
			truncated: false,
		};
		try {
			const stat = await fsp.stat(dirAbs);
			if (!stat.isDirectory()) {
				return { ok: false, entries: [], truncated: false, error: "Not a directory" };
			}
			const entries = await walkWorkspace(dirAbs, prefix, 0, state);
			return { ok: true, entries, truncated: state.truncated };
		} catch (err) {
			return {
				ok: false,
				entries: [],
				truncated: state.truncated,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	});

	ipcMain.handle(IPC_COMMANDS.FS_READ, async (event, payload: IpcFsReadPayload) => {
		const fail = (error: string) => ({ ok: false, content: "", truncated: false, binary: false, size: 0, error });
		if (typeof payload.path !== "string" || payload.path.length === 0) {
			return fail("Invalid path");
		}
		const raw = payload.path.startsWith("~/") ? path.join(os.homedir(), payload.path.slice(2)) : payload.path;
		let abs: string;
		if (path.isAbsolute(raw)) abs = path.normalize(raw);
		else {
			const cwd = cwdFor(deps, event);
			if (!cwd) return fail("No workspace");
			const within = resolveWithin(cwd, raw);
			if (!within) return fail("Path escapes the workspace");
			abs = within;
		}
		const maxBytes = clampInt(payload.maxBytes, 1, FS_READ_MAX_BYTES_CAP, FS_READ_DEFAULT_MAX_BYTES);
		try {
			const stat = await fsp.stat(abs);
			if (!stat.isFile()) {
				return fail("Not a file");
			}
			const handle = await fsp.open(abs, "r");
			try {
				const length = Math.min(stat.size, maxBytes + 1);
				const buffer = Buffer.alloc(length);
				const { bytesRead } = await handle.read(buffer, 0, length, 0);
				const slice = buffer.subarray(0, bytesRead);
				if (slice.includes(0)) {
					return { ok: true, content: "", truncated: false, binary: true, size: stat.size };
				}
				return {
					ok: true,
					content: slice.subarray(0, Math.min(bytesRead, maxBytes)).toString("utf8"),
					truncated: stat.size > maxBytes,
					binary: false,
					size: stat.size,
				};
			} finally {
				await handle.close();
			}
		} catch (err) {
			return fail(err instanceof Error ? err.message : String(err));
		}
	});

	// Markdown-image read: model output references images by path (`![alt](…)`)
	// and the renderer turns them into data URLs for <img>. Relative paths stay
	// workspace-confined; absolute paths and `~` are readable because the bytes
	// never leave the local <img> (no exfil channel), but the file must sniff
	// as a real image type and fit under a size cap.
	const FS_IMAGE_MAX_BYTES = 25_000_000;

	function sniffImageMime(header: Buffer): string | null {
		if (header.length >= 8 && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
			return "image/png";
		}
		if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
		if (header.length >= 6 && header.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
		if (header.length >= 6 && header.subarray(0, 6).toString("ascii") === "GIF87a") return "image/gif";
		if (
			header.length >= 12 &&
			header.subarray(0, 4).toString("ascii") === "RIFF" &&
			header.subarray(8, 12).toString("ascii") === "WEBP"
		) {
			return "image/webp";
		}
		if (header.length >= 12 && header.subarray(4, 8).toString("ascii") === "ftyp") {
			const brand = header.subarray(8, 12).toString("ascii");
			if (brand === "avif" || brand === "avis") return "image/avif";
		}
		if (header.length >= 2 && header[0] === 0x42 && header[1] === 0x4d) return "image/bmp";
		if (header.length >= 4 && header[0] === 0x00 && header[1] === 0x00 && header[2] === 0x01 && header[3] === 0x00) {
			return "image/x-icon";
		}
		// SVG is text: only when it actually starts with an XML/SVG prolog. Loaded
		// through <img> it renders in secure static mode (no script execution).
		const text = header.toString("utf8").trimStart().slice(0, 512).toLowerCase();
		if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) return "image/svg+xml";
		return null;
	}

	ipcMain.handle(IPC_COMMANDS.FS_READ_IMAGE, async (event, payload: IpcFsReadImagePayload) => {
		const fail = (error: string): IpcFsReadImageResult => ({ ok: false, dataUrl: null, mime: null, size: 0, error });
		if (typeof payload?.path !== "string" || payload.path.length === 0) return fail("Invalid path");
		let abs: string;
		const raw = payload.path.startsWith("~/") ? path.join(os.homedir(), payload.path.slice(2)) : payload.path;
		if (path.isAbsolute(raw)) {
			abs = path.normalize(raw);
		} else {
			const cwd = cwdFor(deps, event);
			if (!cwd) return fail("No workspace");
			const within = resolveWithin(cwd, raw);
			if (!within) return fail("Path escapes the workspace");
			abs = within;
		}
		try {
			const stat = await fsp.stat(abs);
			if (!stat.isFile()) return fail("Not a file");
			if (stat.size > FS_IMAGE_MAX_BYTES) return fail("Image too large");
			const handle = await fsp.open(abs, "r");
			try {
				const header = Buffer.alloc(512);
				const { bytesRead } = await handle.read(header, 0, 512, 0);
				const mime = sniffImageMime(header.subarray(0, bytesRead));
				if (!mime) return fail("Not a supported image");
				const body = Buffer.alloc(stat.size);
				await handle.read(body, 0, stat.size, 0);
				return { ok: true, dataUrl: `data:${mime};base64,${body.toString("base64")}`, mime, size: stat.size };
			} finally {
				await handle.close();
			}
		} catch (err) {
			return fail(err instanceof Error ? err.message : String(err));
		}
	});

	// Plan-mode document read — deliberately OFF the RPC bus: reading via the
	// bash RPC injected the plan into the model context and appended
	// bashExecution entries to the transcript on every poll. Reads the
	// configured path, else the newest `*plan.md` in the session-local root.
	// Confined to the workspace and the sessions dir (plan artifacts live there).
	ipcMain.handle(
		IPC_COMMANDS.FS_READ_PLAN,
		async (event, payload: IpcFsReadPlanPayload): Promise<IpcFsReadPlanResult> => {
			const fail = (error: string): IpcFsReadPlanResult => ({ ok: false, path: null, content: null, error });
			if (typeof payload?.fsPath !== "string" || payload.fsPath.length === 0) {
				return fail("Invalid path");
			}
			const cwd = cwdFor(deps, event);
			if (!cwd) return fail("No workspace");
			const withinAllowedRoots = (value: string): string | null =>
				resolveWithin(cwd, value) ?? resolveWithin(sessionIndex.sessionsDir, value);
			const target = withinAllowedRoots(payload.fsPath);
			if (!target) return fail("Path escapes allowed roots");
			let localRoot: string | null = null;
			if (typeof payload.localRoot === "string" && payload.localRoot.length > 0) {
				localRoot = withinAllowedRoots(payload.localRoot);
				if (!localRoot) return fail("Path escapes allowed roots");
			}
			try {
				const picked = (await statFile(target)) ?? (localRoot ? await newestPlanFile(localRoot) : null);
				if (!picked) return { ok: true, path: null, content: null };
				return { ok: true, path: picked, content: await fsp.readFile(picked, "utf8") };
			} catch (err) {
				return fail(err instanceof Error ? err.message : String(err));
			}
		},
	);

	ipcMain.handle(IPC_COMMANDS.SIDECAR_STATUS_GET, event => {
		const sidecar = sidecarFor(deps, event);
		return { status: sidecar?.status ?? "starting", cwd: cwdFor(deps, event) ?? "" };
	});

	// External-editor round trip ($VISUAL/$EDITOR, temp file, exit-0 read-back)
	// for the composer editor dialog. Result shape carries availability +
	// cancellation so the renderer never has to catch.
	ipcMain.handle(IPC_COMMANDS.EDITOR_OPEN_EXTERNAL, async (_event, payload: { content?: string }) => {
		if (!(await resolveEditorCommand())) {
			return {
				ok: false,
				unavailable: true as const,
				text: null,
				error: "Set $VISUAL or $EDITOR to use an external editor",
			};
		}
		try {
			const { text } = await openInExternalEditor(typeof payload?.content === "string" ? payload.content : "");
			return { ok: true, unavailable: false as const, text };
		} catch (err) {
			return {
				ok: false,
				unavailable: false as const,
				text: null,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	});
}

function broadcast(windowManager: WindowManager, channel: string, data: unknown): void {
	for (const win of windowManager.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send(channel, data);
		}
	}
}

/** Execute GUI-registered host tools. Returns undefined for unknown tools. */
function executeGuiHostTool(name: string, args: Record<string, unknown>): string | undefined {
	switch (name) {
		case "gui_open_url": {
			const url = typeof args.url === "string" ? args.url : "";
			if (url.startsWith("https://") || url.startsWith("http://")) {
				void shell.openExternal(url);
				return "Opened in browser";
			}
			return `Invalid URL: ${url}`;
		}
		case "gui_notify": {
			const title = typeof args.title === "string" ? args.title : "Notification";
			const body = typeof args.body === "string" ? args.body : "";
			new Notification({ title, body }).show();
			return "Notification shown";
		}
		case "gui_clipboard_read": {
			return clipboard.readText();
		}
		default:
			return undefined;
	}
}
