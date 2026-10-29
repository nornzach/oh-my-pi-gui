/**
 * Main process entry point for the omp GUI.
 * App lifecycle: ready → window, sidecar, session index, IPC, tray, menu, deep links, updater.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow, desktopCapturer, globalShortcut, nativeImage, session, webContents } from "electron";
import Store from "electron-store";
import { nativeAccelerator } from "../shared/hotkeys";
import type { SessionKind } from "../shared/ipc-types";
import { installQuitGuard, requestQuit } from "./app-quit";
import { BrowserHost } from "./browser-host";
import { bundledOmpFilename, resolveOmpCandidate } from "./bundled-omp-path";
import { type ConversationIndex, openConversationIndex } from "./conversation-index";
import { setupDeepLinks, startupFolder } from "./deep-link";
import { ensureDefaultWorkspace } from "./default-workspace";
import { applyGpuFallbackIfNeeded, handleGpuProcessGone } from "./gpu-fallback";
import { firstUsableCwd } from "./initial-cwd";
import { registerIpcHandlers } from "./ipc";
import { LogWatcher } from "./log-watcher";
import { MemoryWatcher } from "./memory-watcher";
import { createMenu } from "./menu";
import { writeRuntimeLog } from "./runtime-log";
import { SchedulerHost } from "./scheduler/host";
import { SessionIndex } from "./session-index";
import { shellSpawnEnv } from "./shell-env";
import { SidecarManager, type SidecarOptions } from "./sidecar";
import { SidecarPool } from "./sidecar-pool";
import { StatsClient } from "./stats-client";
import { StatsServerManager } from "./stats-server";
import { type PersistedTabLayout, sanitizePersistedTabLayouts } from "./tab-layout";
import { createTray, destroyTray } from "./tray";
import { setupUpdater } from "./updater";
import { WindowManager } from "./window";
import { resolveWindowSpawnTarget } from "./window-spawn-target";

// Honor Electron's explicit profile before acquiring its instance lock.
const userDataDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (userDataDirectory) {
	const directory = resolve(userDataDirectory);
	mkdirSync(directory, { recursive: true });
	app.setPath("userData", directory);
}

// Software-rendering escape hatch (must precede whenReady): a crashed GPU
// process leaves every window black — the marker relaunches without it.
applyGpuFallbackIfNeeded();

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
}

// App identity: the dev run shows "Electron" + the default atom icon in the
// dock otherwise. Packaged builds get both from the bundle via electron-builder.
app.setName("omp");
{
	const dockIcon = join(app.getAppPath(), "resources", "icon.png");
	if (process.platform === "darwin" && existsSync(dockIcon)) {
		app.dock?.setIcon(nativeImage.createFromPath(dockIcon));
	}
}

/**
 * Locate the GUI's built-in omp binary — the ONLY sidecar the GUI runs in the
 * closed loop. Packaged apps ship it at `process.resourcesPath/omp`; in dev it
 * lives at `packages/gui/resources/omp` (built by `bun --cwd=packages/gui run
 * build:omp`). No system-installed omp is consulted and there is no external
 * fallback: when it is missing the GUI surfaces an error telling the user to
 * build it. The workspace source sidecar is available only as an explicit dev
 * override (`OMP_SIDECAR=source`), never automatically.
 */
function resolveBundledOmp(): string | null {
	const override = process.env.OMP_BUNDLED_OMP;
	if (override && existsSync(override)) return override;
	const name = bundledOmpFilename();
	if (process.resourcesPath) {
		const packaged =
			resolveOmpCandidate(process.resourcesPath, name) ?? resolveOmpCandidate(process.resourcesPath, "omp");
		if (packaged) return packaged;
	}
	for (const start of [app.getAppPath(), process.cwd()]) {
		let dir = start;
		for (let i = 0; i < 8; i++) {
			const direct = resolveOmpCandidate(dir, "resources", name) ?? resolveOmpCandidate(dir, "resources", "omp");
			if (direct) return direct;
			const nested =
				resolveOmpCandidate(dir, "packages", "gui", "resources", name) ??
				resolveOmpCandidate(dir, "packages", "gui", "resources", "omp");
			if (nested) return nested;
			const parent = join(dir, "..");
			if (parent === dir) break;
			dir = parent;
		}
	}
	return null;
}

/**
 * Dev-only explicit override (`OMP_SIDECAR=source`): run the workspace
 * coding-agent source CLI instead of the bundled binary. Used to exercise
 * in-repo changes without rebuilding the binary. Returns null otherwise.
 */
function resolveSourceCli(): string | null {
	if (process.env.OMP_SIDECAR !== "source") return null;
	const explicit = process.env.OMP_SIDECAR_CLI;
	if (explicit && existsSync(explicit)) return explicit;
	for (const start of [app.getAppPath(), process.cwd()]) {
		let dir = start;
		for (let i = 0; i < 8; i++) {
			const cli = join(dir, "packages", "coding-agent", "src", "cli.ts");
			if (existsSync(cli)) return cli;
			const parent = join(dir, "..");
			if (parent === dir) break;
			dir = parent;
		}
	}
	return null;
}

interface MainPrefs {
	lastProject?: string;
	proxyUrl?: string;
	/** One layout per live window, in window order. */
	tabLayouts?: PersistedTabLayout[];
	/** Pre-multi-window shape, migrated on the first persist. */
	tabLayout?: PersistedTabLayout;
	[key: string]: unknown;
}

let mainPrefsStore: Store<MainPrefs> | null = null;

function prefsStore(): Store<MainPrefs> {
	mainPrefsStore ??= new Store<MainPrefs>({ name: "prefs" });
	return mainPrefsStore;
}

function resolveInitialCwd(): string {
	const explicitCwd = startupFolder();
	if (explicitCwd) return explicitCwd;
	return firstUsableCwd([prefsStore().get("lastProject"), process.cwd()]) ?? homedir();
}

// ──────────────────────────────────────────────────────────────────────────
// Sidecar proxy env
// ──────────────────────────────────────────────────────────────────────────
// The agent reads proxy config from env vars only (PI_PROXY_* → PI_PROXY →
// HTTPS_PROXY → ALL_PROXY). A Finder-launched app has no shell env, so a
// proxy-only network (codex's chatgpt.com backend behind a firewall) would
// silently hang every provider request. Resolution order per spawn:
// explicit GUI pref → inherited env (terminal launch) → macOS system proxy.

/** Expand one proxy URL into the full env-var set the agent and Bun honor. */
function proxyEnvVars(proxyUrl: string): Record<string, string> {
	return {
		PI_PROXY: proxyUrl,
		HTTPS_PROXY: proxyUrl,
		HTTP_PROXY: proxyUrl,
		ALL_PROXY: proxyUrl,
		https_proxy: proxyUrl,
		http_proxy: proxyUrl,
		all_proxy: proxyUrl,
	};
}

/** Accept "127.0.0.1:7890" shorthand; keep explicit schemes as-is. */
function normalizeProxyUrl(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.includes("://")) return trimmed;
	return `http://${trimmed}`;
}

/** First entry of a Chromium PAC result → URL ("PROXY h:p" / "SOCKS5 h:p" / "DIRECT"). */
function parsePacResult(pac: string): string | undefined {
	const first = pac.split(";")[0]?.trim() ?? "";
	const [kind, endpoint] = first.split(/\s+/, 2);
	if (!endpoint) return undefined;
	if (kind === "PROXY") return `http://${endpoint}`;
	if (kind === "HTTPS") return `https://${endpoint}`;
	if (kind === "SOCKS" || kind === "SOCKS5") return `socks5://${endpoint}`;
	return undefined;
}

/** Representative URL for system-proxy resolution (codex's OAuth backend). */
const SYSTEM_PROXY_PROBE_URL = "https://chatgpt.com";

async function resolveProxyEnvForSpawn(): Promise<Record<string, string>> {
	const pref = prefsStore().get("proxyUrl");
	if (typeof pref === "string" && pref.trim()) return proxyEnvVars(normalizeProxyUrl(pref));
	if (
		process.env.PI_PROXY ||
		process.env.HTTPS_PROXY ||
		process.env.https_proxy ||
		process.env.ALL_PROXY ||
		process.env.all_proxy
	) {
		return {};
	}
	try {
		const pac = await session.defaultSession.resolveProxy(SYSTEM_PROXY_PROBE_URL);
		const systemProxy = parsePacResult(pac);
		return systemProxy ? proxyEnvVars(systemProxy) : {};
	} catch {
		return {};
	}
}

/** A tab's own startup and transcript load go first; the warm spare boots after. */
const WARM_SPARE_DELAY_MS = 3_000;

// Module-level instances (alive for app lifetime)
let windowManager: WindowManager;
let sidecarPool: SidecarPool;
let browserHost: BrowserHost | null = null;
let statsServer: StatsServerManager | null = null;
let sessionIndex: SessionIndex;
let statsClient: StatsClient;
let logWatcher: LogWatcher;
let memoryWatcher: MemoryWatcher | undefined;
let conversationIndex: ConversationIndex | null = null;
let schedulerHost: SchedulerHost | null = null;

function errorMessage(value: unknown): { message: string; stack?: string } {
	if (value instanceof Error) return { message: value.message, stack: value.stack };
	if (typeof value === "string") return { message: value };
	try {
		return { message: JSON.stringify(value) ?? String(value) };
	} catch {
		return { message: String(value) };
	}
}

function installMainRuntimeLogging(): void {
	process.on("uncaughtExceptionMonitor", (error, origin) => {
		writeRuntimeLog({ source: "main-uncaught", ...errorMessage(error), details: { origin } });
	});
	process.on("unhandledRejection", reason => {
		writeRuntimeLog({ source: "main-unhandled-rejection", ...errorMessage(reason) });
	});
	app.on("child-process-gone", (_event, details) => {
		writeRuntimeLog({
			source: "child-process",
			message: `${details.type} process exited: ${details.reason}`,
			details: {
				type: details.type,
				reason: details.reason,
				exitCode: details.exitCode,
				serviceName: details.serviceName ?? null,
				name: details.name ?? null,
			},
		});
		handleGpuProcessGone(details);
	});
}

/**
 * The saved session: one tab layout per window. Reads tolerate both the current
 * array and the pre-multi-window single layout written by older builds.
 */
function readSavedTabLayouts(): PersistedTabLayout[] {
	const store = prefsStore();
	const layouts = sanitizePersistedTabLayouts(store.get("tabLayouts"));
	if (layouts.length > 0) return layouts;
	return sanitizePersistedTabLayouts(store.get("tabLayout"));
}

/**
 * Rewrite the saved session from the live windows. Runs on every tab change and
 * every window close, so a window the user closed for good never comes back and
 * a secondary window's tabs are no longer dropped on the floor.
 */
function persistTabLayouts(): void {
	const layouts: PersistedTabLayout[] = [];
	for (const win of windowManager.getAllWindows()) {
		const layout = sidecarPool.tabLayoutForWindow(win);
		if (layout) layouts.push(layout);
	}
	// No live window means the app is quitting (or idle in the dock), not that
	// the session was abandoned — writing an empty set would wipe the restore.
	if (layouts.length === 0) return;
	const store = prefsStore();
	store.set("tabLayouts", layouts);
	store.delete("tabLayout");
}

/** Reopen one saved window: its tabs in order, at the layout's active cwd. */
function spawnWindowWithLayout(layout: PersistedTabLayout): BrowserWindow | null {
	const activeCwd = layout.tabs[layout.activeIndex]?.cwd ?? layout.tabs[0]?.cwd;
	if (!activeCwd) return null;
	const win = windowManager.createWindow({ cwd: activeCwd });
	if (sidecarPool.restoreLayout(win, layout) > 0) return win;
	win.close();
	return null;
}

/** Spawn a window with its own sidecar (the pool's 1:1 owner). Null on spawn failure.
 *  With no target, create a fresh global chat; explicit workspace/session
 *  requests retain their selected/fallback cwd and requested session kind. */
function spawnWindow(cwd?: string, pendingSessionPath?: string, kind?: SessionKind): BrowserWindow | null {
	const restoreSavedLayout = cwd === undefined && pendingSessionPath === undefined && kind === undefined;
	if (restoreSavedLayout) {
		const [saved] = readSavedTabLayouts();
		if (saved) {
			const restored = spawnWindowWithLayout(saved);
			if (restored) return restored;
		}
	}
	const target = resolveWindowSpawnTarget(
		cwd,
		pendingSessionPath,
		kind,
		resolveInitialCwd(),
		ensureDefaultWorkspace(),
	);
	const win = windowManager.createWindow({ cwd: target.cwd, pendingSessionPath });
	const sidecar = sidecarPool.acquire(
		target.cwd,
		win,
		undefined,
		undefined,
		target.kind,
		undefined,
		target.fresh,
		target.placeholder,
	);
	if (!sidecar) {
		win.close();
		return null;
	}
	return win;
}

app.whenReady().then(() => {
	installMainRuntimeLogging();
	windowManager = new WindowManager();

	const initialCwd = resolveInitialCwd();
	const explicitStartupCwd = startupFolder();
	const bundledOmp = resolveBundledOmp();
	const sourceCli = resolveSourceCli();
	// Finder-launched omp has no terminal, and a sidecar that dies before
	// it can write its own log only speaks through stderr — land the tail
	// in gui-runtime.jsonl so it is readable after the fact.
	const reportSidecarFailure: SidecarOptions["reportFailure"] = report => {
		writeRuntimeLog(
			{
				source: "sidecar-restart",
				message: report.reason,
				details: { attempt: report.attempt, maxAttempts: report.maxAttempts, stderr: report.stderr },
			},
			{ cwd: report.cwd },
		);
	};
	sidecarPool = new SidecarPool((cwd, kind, fresh) => {
		const sc = new SidecarManager({
			binaryPath: bundledOmp ?? "",
			packaged: app.isPackaged,
			sourceCli: sourceCli ?? undefined,
			cwd,
			kind,
			fresh,
			proxyEnv: resolveProxyEnvForSpawn,
			shellEnv: shellSpawnEnv,
			reportFailure: reportSidecarFailure,
		});
		// Ready-health-check applies to every pooled sidecar, not just the first.
		sc.on("status", ({ status }) => {
			if (status !== "ready") return;
			const client = sc.rpcClient;
			if (!client) return;
			client
				.command({ type: "get_state" })
				.then(res => {
					if (!res.success) sc.markUnhealthy(`Health check failed: ${res.error ?? "unknown"}`);
				})
				.catch(err => {
					sc.markUnhealthy(`Health check timed out: ${err instanceof Error ? err.message : String(err)}`);
				});
		});
		return sc;
	});
	sidecarPool.onWindowTabsChanged = () => persistTabLayouts();
	// Keep one idle agent warm in the workspace being used, so the next tab
	// opened there switches onto its session instead of cold-starting (gui#29).
	sidecarPool.warmSpareDelayMs = WARM_SPARE_DELAY_MS;
	// Agent tabs browse in their own side panel: each sidecar that comes up
	// serves a relay for it, and its pages outlive sidecar restarts.
	const host = new BrowserHost();
	browserHost = host;
	sidecarPool.uiResponder = (sidecar, request) => schedulerHost?.answerToolPrompt(sidecar, request) ?? false;
	sidecarPool.sidecarLifecycle = {
		ready: tab => {
			if (tab.kind === "agent") void host.link(tab);
			schedulerHost?.tabReady(tab);
		},
		down: tabId => {
			host.unlink(tabId);
		},
		released: tabId => host.release(tabId),
	};
	// A closed window's tabs have to leave the saved session with it, or the next
	// launch resurrects a window the user deliberately shut.
	windowManager.subscribeWindowClosed(() => persistTabLayouts());
	sessionIndex = new SessionIndex(undefined, initialCwd);
	// Scheduled tasks run in their own sidecars, outside the tab pool: no window,
	// a fresh session, and argv the task's tool policy fixes (plan/23 §3).
	try {
		schedulerHost = new SchedulerHost({
			dbPath: join(app.getPath("userData"), "scheduler.db"),
			createRunSidecar: spec =>
				new SidecarManager({
					binaryPath: bundledOmp ?? "",
					packaged: app.isPackaged,
					sourceCli: sourceCli ?? undefined,
					cwd: spec.cwd,
					kind: "agent",
					fresh: true,
					runPolicy: { flags: spec.flags, deny: spec.deny },
					proxyEnv: resolveProxyEnvForSpawn,
					shellEnv: shellSpawnEnv,
					reportFailure: reportSidecarFailure,
				}),
			deleteSession: sessionPath => sessionIndex.deleteSession(sessionPath),
			windowManager,
			spawnWindow,
			log: (message, details) => writeRuntimeLog({ source: "scheduler", message, details }),
		});
	} catch (error) {
		// A damaged or newer scheduler.db leaves tasks off; the rest of the app runs.
		writeRuntimeLog({ source: "scheduler", ...errorMessage(error) });
		schedulerHost = null;
	}
	statsClient = new StatsClient();
	// Built-in stats dashboard: spawned from the SAME bundled binary. No
	// external `omp stats` process is required (closed loop).
	if (bundledOmp) {
		statsServer = new StatsServerManager(bundledOmp);
		statsServer.on("ready", (port: number) => {
			statsClient.port = port;
		});
		statsServer.on("exit", () => {
			statsClient.port = 0;
		});
		statsServer.start();
	}
	logWatcher = new LogWatcher();
	memoryWatcher = new MemoryWatcher();
	conversationIndex = openConversationIndex(
		join(app.getPath("userData"), "conversation-index.db"),
		sessionIndex.sessionsDir,
		error => writeRuntimeLog({ source: "conversation-index", ...errorMessage(error) }),
	);

	// Register all handlers and sidecar listeners before loading the renderer.
	registerIpcHandlers({
		sidecarPool,
		browserHost: host,
		sessionIndex,
		statsClient,
		statsRestart: () => statsServer?.ensureRunning() ?? "exhausted",
		logWatcher,
		memoryWatcher,
		conversationIndex,
		windowManager,
		benchmarkBinaryPath: bundledOmp,
		benchmarkEnv: async () => ({ ...process.env, ...(await shellSpawnEnv()), ...(await resolveProxyEnvForSpawn()) }),
		spawnWindow,
		initialCwd: resolveInitialCwd,
		schedulerHost,
	});
	schedulerHost?.start();

	// Global shortcut: Cmd+Shift+O — toggle focused window, else show the most
	// recent, else spawn one (multi-window decision tree).
	globalShortcut.register(nativeAccelerator("window.toggle"), () => {
		const focused = BrowserWindow.getFocusedWindow();
		if (focused && !focused.isDestroyed() && windowManager.recordFor(focused)) {
			if (focused.isVisible()) focused.hide();
			else {
				focused.show();
				focused.focus();
			}
			return;
		}
		const win = windowManager.getMainWindow();
		if (win) {
			win.show();
			win.focus();
			return;
		}
		spawnWindow();
	});
	sessionIndex.start();
	logWatcher.start();
	memoryWatcher.start();
	// /record: renderer getDisplayMedia resolves to the window that asked, so a
	// recording always captures the window the user is looking at (no picker).
	session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
		void desktopCapturer.getSources({ types: ["window"] }).then(
			sources => {
				const contents = request.frame ? webContents.fromFrame(request.frame) : null;
				const owner = contents ? BrowserWindow.fromWebContents(contents) : null;
				const source = sources.find(entry => entry.name === owner?.getTitle()) ?? sources[0];
				callback(source ? { video: source } : {});
			},
			() => callback({}),
		);
	});
	// Read sessions into the search index in the background; searches top it up.
	conversationIndex
		?.refresh()
		.catch(error => writeRuntimeLog({ source: "conversation-index", ...errorMessage(error) }));
	// Read before the first window restores: every tab change rewrites the store,
	// so a later read would only see the just-restored primary window.
	const savedLayouts = readSavedTabLayouts();
	spawnWindow(explicitStartupCwd);
	// A bare launch restores the saved session in full. The window above carries
	// layout[0]; these are the secondary windows whose tabs used to be dropped at
	// relaunch. An argv cwd is an explicit "open this", not a restore.
	if (!explicitStartupCwd) {
		for (const layout of savedLayouts.slice(1)) spawnWindowWithLayout(layout);
	}

	// Tray, menu, deep links, updater
	createTray(windowManager, spawnWindow);
	createMenu(windowManager, spawnWindow, host);
	setupDeepLinks(windowManager, spawnWindow);
	setupUpdater();

	// Probe stats server (non-blocking)
	statsClient.probe().catch(() => {});
});

// macOS: re-create window on dock click
app.on("activate", () => {
	if (windowManager && windowManager.getAllWindows().length === 0) {
		spawnWindow();
	}
});

// Quit on all windows closed (except macOS)
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		requestQuit();
	}
});

// Cleanup on quit, behind the "sessions are still working" confirmation: ⌘Q
// used to SIGTERM every live agent run without a word.
installQuitGuard(
	() => (sidecarPool ? sidecarPool.tabInventory() : []),
	() => {
		schedulerHost?.dispose();
		statsServer?.kill();
		sidecarPool?.disposeAll();
		browserHost?.disposeAll();
		sessionIndex?.stop();
		logWatcher?.stop();
		memoryWatcher?.stop();
		conversationIndex?.close();
		destroyTray();
	},
	() => schedulerHost?.scheduler.liveRunCount ?? 0,
);
