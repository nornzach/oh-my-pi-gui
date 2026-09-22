/**
 * System tray with status icon and a rich quick-access menu: live config info
 * (model / thinking / fast / approval), usage + token consumption, workspace
 * jumping, quick-start and quick-config actions, and a language toggle. The
 * renderer pushes a TrayState snapshot on every relevant change, so the menu
 * is always fresh the moment it opens; actions route back to the renderer via
 * MENU_ACTION (it owns the RPC + i18n + UI stores).
 */

import { app, Menu, nativeImage, Tray } from "electron";
import { IPC_EVENTS, type MenuAction, type MenuActionPayload, type TrayState } from "../shared/ipc-types";
import type { SpawnWindow, WindowManager } from "./window";

type TrayStatus = "idle" | "streaming" | "waiting" | "error";
type TrayLang = "zh" | "en";

let tray: Tray | null = null;
let currentStatus: TrayStatus = "idle";
let windowManagerRef: WindowManager | null = null;
let spawnWindowRef: SpawnWindow | null = null;
let trayState: TrayState | null = null;

/** Tray-label strings, translated in main (the renderer reports the language). */
const L: Record<string, { zh: string; en: string }> = {
	showHide: { zh: "显示 / 隐藏", en: "Show / Hide" },
	quit: { zh: "退出", en: "Quit" },
	newSession: { zh: "新建会话", en: "New Session" },
	openProject: { zh: "打开项目…", en: "Open Project…" },
	handoff: { zh: "交接(Handoff)", en: "Handoff" },
	usageStats: { zh: "Usage 统计…", en: "Usage Stats…" },
	workspaces: { zh: "工作区跳转", en: "Switch Workspace" },
	addWorkspace: { zh: "添加工作区…", en: "Add Workspace…" },
	quickStart: { zh: "快速开始", en: "Quick Start" },
	quickConfig: { zh: "快速配置", en: "Quick Config" },
	fastMode: { zh: "快速模式", en: "Fast Mode" },
	thinking: { zh: "思考强度", en: "Thinking" },
	approval: { zh: "工具审批", en: "Tool Approval" },
	language: { zh: "语言", en: "Language" },
	approvalYolo: { zh: "完全访问", en: "Full access" },
	approvalWrite: { zh: "自动编辑", en: "Auto-edit" },
	approvalAsk: { zh: "每次询问", en: "Ask every time" },
	context: { zh: "上下文", en: "Context" },
	tokens: { zh: "tokens", en: "tokens" },
	noModel: { zh: "未选模型", en: "No model" },
};

function t(lang: TrayLang, key: keyof typeof L): string {
	return L[key][lang];
}

function buildIcon(_status: TrayStatus): Electron.NativeImage {
	// macOS status items are template images: the system applies the correct
	// foreground color for light/dark and selected menu-bar states. Render at
	// 2× so the small π mark remains crisp on Retina displays. The run status
	// stays available in the tray menu; changing it no longer turns the app mark
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

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

function buildContextMenu(windowManager: WindowManager, state: TrayState | null): Electron.Menu {
	const lang: TrayLang = state?.language === "en" ? "en" : "zh";
	const template: Electron.MenuItemConstructorOptions[] = [];

	// Header: app + current project.
	const project = state?.projectName || "omp";
	template.push({ label: `● omp — ${project}`, enabled: false }, { type: "separator" });

	// Config info (read-only): model · thinking · fast · approval.
	if (state) {
		const model = state.modelId || t(lang, "noModel");
		template.push({ label: `${model} · ${t(lang, "thinking")} ${state.thinkingLevel}`, enabled: false });
		const approvalLabel =
			state.approvalMode === "yolo"
				? t(lang, "approvalYolo")
				: state.approvalMode === "write"
					? t(lang, "approvalWrite")
					: t(lang, "approvalAsk");
		const fastLabel = `${t(lang, "fastMode")}: ${state.fastMode ? "✓" : "—"}`;
		template.push({ label: `${fastLabel} · ${t(lang, "approval")}: ${approvalLabel}`, enabled: false });
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
					label:
						mode === "yolo"
							? t(lang, "approvalYolo")
							: mode === "write"
								? t(lang, "approvalWrite")
								: t(lang, "approvalAsk"),
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

	// Show / Hide + Quit.
	template.push(
		{
			label: t(lang, "showHide"),
			click: () => {
				const win = windowManager.getMainWindow();
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

function rebuildMenu(): void {
	if (!tray || !windowManagerRef) return;
	tray.setContextMenu(buildContextMenu(windowManagerRef, trayState));
}

export function createTray(windowManager: WindowManager, spawnWindow: SpawnWindow): Tray {
	windowManagerRef = windowManager;
	spawnWindowRef = spawnWindow;
	tray = new Tray(buildIcon("idle"));
	tray.setToolTip("omp");
	tray.setContextMenu(buildContextMenu(windowManager, null));

	tray.on("click", () => {
		const win = windowManager.getMainWindow();
		if (win) {
			win.show();
			win.focus();
		} else {
			spawnWindowRef?.();
		}
	});

	return tray;
}

/** Renderer pushes a fresh snapshot; cache it and rebuild the menu + icon. */
export function setTrayState(state: TrayState): void {
	trayState = state;
	if (state.status !== currentStatus) {
		currentStatus = state.status;
		tray?.setImage(buildIcon(state.status));
	}
	rebuildMenu();
}

export function setTrayStatus(status: TrayStatus): void {
	if (!tray || currentStatus === status) return;
	currentStatus = status;
	tray.setImage(buildIcon(status));
}

export function destroyTray(): void {
	tray?.destroy();
	tray = null;
	windowManagerRef = null;
	trayState = null;
}
