/**
 * System tray with a rich quick-access menu: live config info (model / thinking
 * / fast / approval), usage + token consumption, workspace jumping, quick-start
 * and quick-config actions, and a language toggle. The renderer pushes a
 * TrayState snapshot on every relevant change; main installs a new native menu
 * only when a visible label actually changes, and never while one is open.
 * Actions route back to the renderer via MENU_ACTION (it owns the RPC + i18n +
 * UI stores).
 */

import { app, Menu, nativeImage, Tray } from "electron";
import { IPC_EVENTS, type MenuAction, type MenuActionPayload, type TrayState } from "../shared/ipc-types";
import { approvalLabel, formatTokens, menuSignature, type TrayLang, t, trayTooltip } from "./tray-labels";
import type { SpawnWindow, WindowManager } from "./window";

let tray: Tray | null = null;
let windowManagerRef: WindowManager | null = null;
let spawnWindowRef: SpawnWindow | null = null;
let trayState: TrayState | null = null;
/** Label set the currently installed native menu renders, and whether it is open. */
let installedSignature: string | null = null;
let menuIsOpen = false;
let tooltip = "omp";

function buildIcon(): Electron.NativeImage {
	// macOS status items are template images: the system applies the correct
	// foreground color for light/dark and selected menu-bar states. Render at
	// 2× so the small π mark remains crisp on Retina displays. The run status is
	// text (tooltip + menu header); painting it here would turn the app mark
	// into a large, visually noisy traffic-light dot.
	const logicalSize = 18;
	const scaleFactor = 2;
	const pixelSize = logicalSize * scaleFactor;
	const canvas = Buffer.alloc(pixelSize * pixelSize * 4, 0);
	const fillRoundedRect = (left: number, top: number, right: number, bottom: number, radius: number) => {
		for (let y = top; y < bottom; y++) {
			for (let x = left; x < right; x++) {
				const nearestX = Math.max(left + radius, Math.min(x + 0.5, right - radius));
				const nearestY = Math.max(top + radius, Math.min(y + 0.5, bottom - radius));
				const dx = x + 0.5 - nearestX;
				const dy = y + 0.5 - nearestY;
				if (dx * dx + dy * dy > radius * radius) continue;
				const index = (y * pixelSize + x) * 4;
				canvas[index + 3] = 255;
			}
		}
	};

	// A compact filled π: one cap, two stems and a short inward foot.
	fillRoundedRect(4, 6, 32, 12, 3);
	fillRoundedRect(9, 9, 15, 31, 3);
	fillRoundedRect(21, 9, 28, 27, 3);
	fillRoundedRect(16, 23, 28, 30, 3);

	const image = nativeImage.createFromBuffer(canvas, {
		width: pixelSize,
		height: pixelSize,
		scaleFactor,
	});
	image.setTemplateImage(true);
	return image;
}

function send(windowManager: WindowManager, action: MenuAction, payload?: MenuActionPayload): void {
	const win = windowManager.getTargetWindow();
	if (win) {
		win.show();
		win.focus();
		win.webContents.send(IPC_EVENTS.MENU_ACTION, { action, ...payload });
		return;
	}
	// All windows closed (macOS keep-running): create one and deliver the
	// action once the renderer is up instead of dropping it.
	const created = spawnWindowRef?.();
	if (!created) return;
	created.once("ready-to-show", () => {
		if (!created.isDestroyed()) {
			created.webContents.send(IPC_EVENTS.MENU_ACTION, { action, ...payload });
		}
	});
}

function buildContextMenu(windowManager: WindowManager, state: TrayState | null): Electron.Menu {
	const lang: TrayLang = state?.language === "en" ? "en" : "zh";
	const template: Electron.MenuItemConstructorOptions[] = [];

	// Header: app + current project + the aggregate run status. This is where
	// status surfaces — the icon is a static template mark by design.
	template.push({ label: trayTooltip(state), enabled: false }, { type: "separator" });

	// Config info (read-only): model · thinking · fast · approval.
	if (state) {
		const model = state.modelId || t(lang, "noModel");
		template.push({ label: `${model} · ${t(lang, "thinking")} ${state.thinkingLevel}`, enabled: false });
		const fastLabel = `${t(lang, "fastMode")}: ${state.fastMode ? "✓" : "—"}`;
		template.push({
			label: `${fastLabel} · ${t(lang, "approval")}: ${approvalLabel(lang, state.approvalMode)}`,
			enabled: false,
		});
		// Usage / token consumption (read-only). The percent is absent — never 0 —
		// for a model whose context window Core does not know.
		if (state.contextPercent !== null || state.contextTokens !== null) {
			const share = state.contextPercent === null ? "—" : `${Math.round(state.contextPercent)}%`;
			const tokens =
				state.contextTokens !== null ? ` · ${formatTokens(state.contextTokens)} ${t(lang, "tokens")}` : "";
			template.push({
				label: `${t(lang, "context")}: ${share}${tokens}`,
				enabled: false,
			});
		}
		template.push({ type: "separator" });
	}

	// Usage stats window.
	template.push(
		{ label: t(lang, "usageStats"), click: () => send(windowManager, "open-usage") },
		{ type: "separator" },
	);

	// Workspace jumping.
	const workspaceItems: Electron.MenuItemConstructorOptions[] = (state?.workspaces ?? []).map(ws => ({
		label: `${ws.current ? "✓ " : ""}${ws.name}`,
		enabled: !ws.current,
		click: () => send(windowManager, "switch-project", { cwd: ws.cwd }),
	}));
	if (workspaceItems.length > 0) workspaceItems.push({ type: "separator" });
	workspaceItems.push({ label: t(lang, "addWorkspace"), click: () => send(windowManager, "open-project") });
	template.push({ label: t(lang, "workspaces"), submenu: workspaceItems });

	// Quick start.
	template.push({
		label: t(lang, "quickStart"),
		submenu: [
			{ label: t(lang, "newSession"), click: () => send(windowManager, "new-session") },
			{ label: t(lang, "openProject"), click: () => send(windowManager, "open-project") },
			{ label: t(lang, "handoff"), click: () => send(windowManager, "handoff") },
		],
	});

	// Quick config: fast toggle, thinking cycle, approval radios, language.
	template.push({
		label: t(lang, "quickConfig"),
		submenu: [
			{
				label: t(lang, "fastMode"),
				type: "checkbox",
				checked: state?.fastMode ?? false,
				click: () => send(windowManager, "toggle-fast"),
			},
			{
				label: `${t(lang, "thinking")}: ${state?.thinkingLevel ?? "off"}`,
				click: () => send(windowManager, "cycle-thinking"),
			},
			{
				label: t(lang, "approval"),
				submenu: (["yolo", "write", "always-ask"] as const).map(mode => ({
					label: approvalLabel(lang, mode),
					type: "radio" as const,
					checked: state?.approvalMode === mode,
					click: () => send(windowManager, "set-approval", { approvalMode: mode }),
				})),
			},
			{
				label: `${t(lang, "language")}: ${lang === "zh" ? "中文" : "English"}`,
				click: () => send(windowManager, "toggle-language"),
			},
		],
	});

	template.push({ type: "separator" });

	// Show / Hide + Quit. Targets the focused window, not the first-created one,
	// so the toggle acts on the window the user is looking at.
	template.push(
		{
			label: t(lang, "showHide"),
			click: () => {
				const win = windowManager.getTargetWindow();
				if (win?.isVisible()) win.hide();
				else if (win) win.show();
				else spawnWindowRef?.();
			},
		},
		{ type: "separator" },
		{ label: t(lang, "quit"), click: () => app.quit() },
	);

	return Menu.buildFromTemplate(template);
}

/**
 * Install a menu built from the current snapshot. The instance remembers whether
 * the user has it open: a push that lands mid-open is recorded but not installed
 * (replacing the menu underneath dismisses it), and flushes when it closes.
 */
function installMenu(): void {
	if (!tray || !windowManagerRef) return;
	const state = trayState;
	installedSignature = state ? menuSignature(state) : null;
	const menu = buildContextMenu(windowManagerRef, state);
	menu.on("menu-will-show", () => {
		menuIsOpen = true;
	});
	menu.on("menu-will-close", () => {
		menuIsOpen = false;
		if (trayState && menuSignature(trayState) !== installedSignature) installMenu();
	});
	tray.setContextMenu(menu);
}

export function createTray(windowManager: WindowManager, spawnWindow: SpawnWindow): Tray {
	windowManagerRef = windowManager;
	spawnWindowRef = spawnWindow;
	tray = new Tray(buildIcon());
	tray.setToolTip(trayTooltip(null));
	installMenu();

	tray.on("click", () => {
		const win = windowManager.getTargetWindow();
		if (win) {
			win.show();
			win.focus();
		} else {
			spawnWindowRef?.();
		}
	});

	return tray;
}

/**
 * Renderer pushed a fresh snapshot. Hover text tracks the status; the native
 * menu is rebuilt only when a label a user can read actually changed, so the
 * per-append session refresh stops swapping menus.
 */
export function setTrayState(state: TrayState): void {
	trayState = state;
	const nextTooltip = trayTooltip(state);
	if (nextTooltip !== tooltip && tray) {
		tooltip = nextTooltip;
		tray.setToolTip(nextTooltip);
	}
	if (menuIsOpen || menuSignature(state) === installedSignature) return;
	installMenu();
}

export function destroyTray(): void {
	tray?.destroy();
	tray = null;
	windowManagerRef = null;
	trayState = null;
	installedSignature = null;
	menuIsOpen = false;
	tooltip = "omp";
}
