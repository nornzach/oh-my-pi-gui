/**
 * Main process entry point for the omp GUI.
 * App lifecycle: ready → window, sidecar, session index, IPC, tray, menu, deep links, updater.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, globalShortcut, nativeImage, session } from "electron";
import Store from "electron-store";
import type { SessionKind } from "../shared/ipc-types";
import { setupDeepLinks } from "./deep-link";
import { ensureDefaultWorkspace } from "./default-workspace";
import { registerIpcHandlers } from "./ipc";
import { LogWatcher } from "./log-watcher";
import { createMenu } from "./menu";
import { writeRuntimeLog } from "./runtime-log";
import { SessionIndex } from "./session-index";
import { shellSpawnEnv } from "./shell-env";
import { SidecarManager } from "./sidecar";
import { SidecarPool } from "./sidecar-pool";
import { StatsClient } from "./stats-client";
import { StatsServerManager } from "./stats-server";
import { type PersistedTabLayout, sanitizePersistedTabLayout } from "./tab-layout";
import { createTray, destroyTray } from "./tray";
import { setupUpdater } from "./updater";
import { WindowManager } from "./window";
import { resolveWindowSpawnTarget } from "./window-spawn-target";

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
	if (process.resourcesPath) {
		const packaged = join(process.resourcesPath, "omp");
		if (existsSync(packaged)) return packaged;
	}
	for (const start of [app.getAppPath(), process.cwd()]) {
		let dir = start;
		for (let i = 0; i < 8; i++) {
			const direct = join(dir, "resources", "omp");
			if (existsSync(direct)) return direct;
			const nested = join(dir, "packages", "gui", "resources", "omp");
			if (existsSync(nested)) return nested;
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
	tabLayout?: PersistedTabLayout;
	[key: string]: unknown;
}

let mainPrefsStore: Store<MainPrefs> | null = null;

function prefsStore(): Store<MainPrefs> {
	mainPrefsStore ??= new Store<MainPrefs>({ name: "prefs" });
	return mainPrefsStore;
}

function resolveExplicitStartupCwd(): string | undefined {
	const explicitCwd = process.argv[2];
	return explicitCwd && existsSync(explicitCwd) ? explicitCwd : undefined;
}

function resolveInitialCwd(): string {
	const explicitCwd = resolveExplicitStartupCwd();
	if (explicitCwd) return explicitCwd;

	const lastProject = prefsStore().get("lastProject");
	if (lastProject && existsSync(lastProject)) return lastProject;

	const launchCwd = process.cwd();
	return launchCwd !== "/" && existsSync(launchCwd) ? launchCwd : homedir();
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

// Module-level instances (alive for app lifetime)
let windowManager: WindowManager;
let sidecarPool: SidecarPool;
let statsServer: StatsServerManager | null = null;
let sessionIndex: SessionIndex;
let statsClient: StatsClient;
let logWatcher: LogWatcher;

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
	});
}

/** Spawn a window with its own sidecar (the pool's 1:1 owner). Null at cap.
 *  With no target, create a fresh global chat; explicit workspace/session
 *  requests retain their selected/fallback cwd and requested session kind. */
function spawnWindow(cwd?: string, pendingSessionPath?: string, kind?: SessionKind): BrowserWindow | null {
	const restoreSavedLayout = cwd === undefined && pendingSessionPath === undefined && kind === undefined;
	const savedLayout = restoreSavedLayout ? sanitizePersistedTabLayout(prefsStore().get("tabLayout")) : null;
	if (savedLayout) {
		const activeCwd = savedLayout.tabs[savedLayout.activeIndex]?.cwd ?? savedLayout.tabs[0]?.cwd;
		if (activeCwd) {
			const win = windowManager.createWindow({ cwd: activeCwd });
			if (sidecarPool.restoreLayout(win, savedLayout) > 0) return win;
			win.close();
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
	const explicitStartupCwd = resolveExplicitStartupCwd();
	const bundledOmp = resolveBundledOmp();
	const sourceCli = resolveSourceCli();
	sidecarPool = new SidecarPool((cwd, kind, fresh) => {
		const sc = new SidecarManager({
			binaryPath: bundledOmp ?? "",
			sourceCli: sourceCli ?? undefined,
			cwd,
			kind,
			fresh,
			proxyEnv: resolveProxyEnvForSpawn,
			shellEnv: shellSpawnEnv,
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
	}, 10);
	sidecarPool.onWindowTabsChanged = (win, layout) => {
		if (windowManager.getMainWindow() !== win) return;
		if (layout) prefsStore().set("tabLayout", layout);
		else prefsStore().delete("tabLayout");
	};
	sessionIndex = new SessionIndex(undefined, initialCwd);
	statsClient = new StatsClient();
	// Built-in stats dashboard: spawned from the SAME bundled binary. No
	// external `omp stats` process is required (closed loop).
	if (bundledOmp) {
		statsServer = new StatsServerManager(bundledOmp);
		statsServer.on("ready", (port: number) => {
			statsClient.port = port;
		});
		statsServer.start();
	}
	logWatcher = new LogWatcher();

	// Register all handlers and sidecar listeners before loading the renderer.
	registerIpcHandlers({
		sidecarPool,
		sessionIndex,
		statsClient,
		logWatcher,
		windowManager,
		benchmarkBinaryPath: bundledOmp,
		benchmarkEnv: async () => ({ ...process.env, ...(await shellSpawnEnv()), ...(await resolveProxyEnvForSpawn()) }),
		spawnWindow,
	});

	// Global shortcut: Cmd+Shift+O — toggle focused window, else show the most
	// recent, else spawn one (multi-window decision tree).
	globalShortcut.register("CommandOrControl+Shift+O", () => {
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
	spawnWindow(explicitStartupCwd);

	// Tray, menu, deep links, updater
	createTray(windowManager, spawnWindow);
	createMenu(windowManager, spawnWindow);
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
		app.quit();
	}
});

// Cleanup on quit
app.on("before-quit", () => {
	statsServer?.kill();
	sidecarPool?.disposeAll();
	sessionIndex?.stop();
	logWatcher?.stop();
	destroyTray();
});
