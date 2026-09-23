/**
 * Native application menu for the omp GUI.
 */
import { app, Menu, type MenuItemConstructorOptions, shell } from "electron";
import { nativeAccelerator } from "../shared/hotkeys";
import { IPC_EVENTS, type MenuAction } from "../shared/ipc-types";
import { getMainLanguage, mainT } from "./i18n";
import type { SpawnWindow, WindowManager } from "./window";

function sendMenuAction(windowManager: WindowManager, spawnWindow: SpawnWindow, action: MenuAction): void {
	const win = windowManager.getTargetWindow();
	if (win) {
		win.webContents.send(IPC_EVENTS.MENU_ACTION, { action });
		return;
	}
	// No windows open (macOS keep-running): spawn one and deliver once its
	// renderer is up, instead of dropping the action silently.
	const created = spawnWindow();
	created?.once("ready-to-show", () => {
		if (!created.isDestroyed()) created.webContents.send(IPC_EVENTS.MENU_ACTION, { action });
	});
}

export function createMenu(windowManager: WindowManager, spawnWindow: SpawnWindow): void {
	const language = getMainLanguage();
	// Chord rule: a shortcut the renderer keymap owns must NOT also be a menu
	// accelerator. Electron resolves menu accelerators before the keydown reaches
	// the webContents, so the duplicate would fire while the user's remap of the
	// same action stayed dead. Menu-only chords live in shared/hotkeys.ts, which
	// the keymap reads as reserved.
	const template: MenuItemConstructorOptions[] = [
		...(process.platform === "darwin"
			? [
					{
						label: app.name,
						submenu: [
							{ role: "about" as const },
							{
								label: mainT("menu.settings", language),
								// No accelerator: ⌘, (and its ⌃, twin) belong to the renderer
								// keymap so users can remap them.
								click: () => sendMenuAction(windowManager, spawnWindow, "open-settings"),
							},
							{ type: "separator" as const },
							{ role: "services" as const },
							{ type: "separator" as const },
							{ role: "hide" as const },
							{ role: "hideOthers" as const },
							{ role: "unhide" as const },
							{ type: "separator" as const },
							{ role: "quit" as const },
						],
					},
				]
			: []),
		{
			label: mainT("menu.file", language),
			submenu: [
				{
					label: mainT("menu.openProject", language),
					// No accelerator: ⌘⇧O is owned by the globalShortcut window
					// toggle (index.ts). Registering it here too makes macOS fire
					// both (dialog + hide) and Windows swallow the menu shortcut
					// entirely. The menu item stays clickable.
					click: () => sendMenuAction(windowManager, spawnWindow, "open-project"),
				},
				{ type: "separator" },
				{
					label: mainT("menu.newSession", language),
					accelerator: nativeAccelerator("session.new"),
					click: () => sendMenuAction(windowManager, spawnWindow, "new-session"),
				},
				{
					// No accelerator: ⌘T/⇧⌘T live in the renderer keymap so users can
					// remap them. A menu accelerator would fire first and make the
					// remappable chords dead (precedent: ⌘⇧O above).
					label: mainT("menu.newTab", language),
					click: () => sendMenuAction(windowManager, spawnWindow, "new-tab"),
				},
				{
					label: mainT("menu.newChatTab", language),
					click: () => sendMenuAction(windowManager, spawnWindow, "new-chat-tab"),
				},
				{
					label: mainT("menu.newWindow", language),
					accelerator: nativeAccelerator("window.new"),
					click: () => {
						// Open a parallel window in the target window's project (its
						// sidecar keeps running untouched in the current window). With no
						// project to inherit, spawn without a cwd: that is the request for
						// the GUI-owned workspace, whereas the process cwd is "/" for an
						// app launched from Finder.
						const win = windowManager.getTargetWindow();
						spawnWindow(win ? windowManager.recordFor(win)?.cwd : undefined);
					},
				},
				...(process.platform === "darwin"
					? []
					: [
							{ type: "separator" as const },
							{
								label: mainT("menu.settings", language),
								// No accelerator: the renderer keymap owns ⌘, so users can remap it.
								click: () => sendMenuAction(windowManager, spawnWindow, "open-settings"),
							},
						]),
			],
		},
		{
			label: mainT("menu.edit", language),
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: mainT("menu.view", language),
			submenu: [
				{
					label: mainT("menu.toggleSidebar", language),
					// No accelerator: ⌘B/⌃B belong to the renderer keymap.
					click: () => sendMenuAction(windowManager, spawnWindow, "toggle-sidebar"),
				},
				{
					label: mainT("menu.togglePanel", language),
					// No accelerator: ⌘J/⌃J belong to the renderer keymap.
					click: () => sendMenuAction(windowManager, spawnWindow, "toggle-panel"),
				},
				{ type: "separator" },
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			// The macOS habit this serves: ⌘W closes a TAB, ⇧⌘W closes the window.
			// `{ role: "close" }` in File was window-level, so the first ⌘W killed
			// the whole window — every tab and sidecar in it.
			label: mainT("menu.window", language),
			submenu: [
				{
					label: mainT("menu.closeTab", language),
					// No accelerator: ⌘W belongs to the renderer keymap so users can
					// remap it; a menu accelerator would fire first (precedent: ⌘T).
					click: () => sendMenuAction(windowManager, spawnWindow, "close-tab"),
				},
				{
					label: mainT("menu.closeWindow", language),
					accelerator: nativeAccelerator("window.close"),
					click: () => windowManager.getTargetWindow()?.close(),
				},
				{ type: "separator" },
				{ role: "minimize" },
				...(process.platform === "darwin"
					? [{ role: "zoom" as const }, { type: "separator" as const }, { role: "front" as const }]
					: []),
			],
		},
		{
			label: mainT("menu.session", language),
			submenu: [
				{
					label: mainT("menu.exportHtml", language),
					accelerator: nativeAccelerator("session.exportHtml"),
					click: () => sendMenuAction(windowManager, spawnWindow, "export-html"),
				},
				{
					label: mainT("menu.handoff", language),
					click: () => sendMenuAction(windowManager, spawnWindow, "handoff"),
				},
			],
		},
		{
			label: mainT("menu.help", language),
			submenu: [
				{
					label: mainT("menu.about", language),
					click: () => app.showAboutPanel(),
				},
				{
					label: mainT("menu.documentation", language),
					click: () => void shell.openExternal("https://github.com/nornzach/oh-my-pi-gui"),
				},
			],
		},
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
