/**
 * Registers omp:// protocol and handles deep links.
 * Supports omp://session/<id> and omp://new.
 */
import { isAbsolute, resolve } from "node:path";
import { app } from "electron";
import { type DeepLinkPayload, IPC_EVENTS } from "../shared/ipc-types";
import { parseLaunchArgv } from "./launch-argv";
import type { SpawnWindow, WindowManager } from "./window";

const PROTOCOL = "omp";

/**
 * macOS delivers the launch URL while the app is still starting, and `setupDeepLinks`
 * only runs once the first window exists — so a listener registered there would miss
 * the link that opened the app. Recorded here at import time, replayed on setup.
 */
const beforeSetup: string[] = [];
let handler: ((url: string) => void) | undefined;

app.on("open-url", (event, url) => {
	event.preventDefault();
	if (handler) handler(url);
	else beforeSetup.push(url);
});

/** Same replay story for `open -a omp ~/code/x`, which arrives as an open-file. */
const filesBeforeSetup: string[] = [];
let fileHandler: ((path: string) => void) | undefined;

app.on("open-file", (event, path) => {
	event.preventDefault();
	if (fileHandler) fileHandler(path);
	else filesBeforeSetup.push(path);
});

export function setupDeepLinks(windowManager: WindowManager, spawnWindow: SpawnWindow): void {
	// Register as default protocol handler (Windows/Linux)
	if (process.defaultApp && process.argv.length >= 2) {
		app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]]);
	} else {
		app.setAsDefaultProtocolClient(PROTOCOL);
	}

	handler = url => handleDeepLink(url, windowManager, spawnWindow);
	for (const url of beforeSetup.splice(0)) handler(url);
	fileHandler = path => handleOpenPath(path, windowManager, spawnWindow);
	for (const path of filesBeforeSetup.splice(0)) fileHandler(path);

	// Windows/Linux (and `open -n` on macOS): the refused second instance hands
	// over its argv. Only omp:// URLs used to be read, so a workspace path was
	// dropped and the launch did nothing at all.
	app.on("second-instance", (_event, argv) => {
		// In dev, argv[0] is Electron and argv[1] the app directory — both real
		// directories that would otherwise be mistaken for the requested one.
		const request = parseLaunchArgv(argv.slice(process.defaultApp ? 2 : 1), PROTOCOL);
		if (request.kind === "url") handleDeepLink(request.url, windowManager, spawnWindow);
		else if (request.kind === "path") handleOpenPath(request.path, windowManager, spawnWindow);
		else windowManager.getTargetWindow()?.focus();
	});
}

/**
 * Bring the window already showing this workspace forward, or open it in a new
 * one. Relative paths resolve against the launcher's cwd, which is never the
 * workspace the user pointed at, so they are refused rather than guessed.
 */
export function handleOpenPath(path: string, windowManager: WindowManager, spawnWindow: SpawnWindow): void {
	if (!isAbsolute(path)) return;
	const target = resolve(path);
	for (const win of windowManager.getAllWindows()) {
		if (windowManager.recordFor(win)?.cwd !== target) continue;
		if (win.isMinimized()) win.restore();
		win.show();
		win.focus();
		return;
	}
	spawnWindow(target);
}

function handleDeepLink(url: string, windowManager: WindowManager, spawnWindow: SpawnWindow): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return;
	}

	const win = windowManager.getMainWindow() ?? spawnWindow();
	if (!win) return;
	win.show();
	win.focus();

	// new URL puts the first segment of a scheme:// URL into hostname, not
	// pathname: omp://new → host "new", omp://session/<id> → host "session" +
	// path "/<id>". (Hostname case is preserved for non-special schemes.)
	let payload: DeepLinkPayload | null = null;
	const host = parsed.hostname.toLowerCase();
	if (host === "new") {
		payload = { action: "new-session" };
	} else if (host === "session") {
		const sessionId = parsed.pathname.replace(/^\/+|\/+$/g, "");
		if (sessionId) {
			payload = { action: "switch-session", sessionId };
		}
	}
	if (!payload) return;

	// Cold start: the renderer only subscribes after load — hold the link until
	// then, otherwise it is silently dropped.
	const link = payload;
	if (win.webContents.isLoading()) {
		win.webContents.once("did-finish-load", () => {
			if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.DEEP_LINK, link);
		});
	} else {
		win.webContents.send(IPC_EVENTS.DEEP_LINK, link);
	}
}
