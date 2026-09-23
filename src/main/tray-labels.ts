/**
 * Pure tray vocabulary: every string the native menu shows, plus the signature
 * that decides whether the menu has to be rebuilt. Lives outside `tray.ts`
 * because that module needs electron — the label mapping and the churn guard
 * are the parts worth testing.
 */

import type { TrayState } from "../shared/ipc-types";

export type TrayStatus = TrayState["status"];
export type TrayLang = "zh" | "en";
export type TrayApprovalMode = TrayState["approvalMode"];

/** Tray-label strings, translated in main (the renderer reports the language). */
export const TRAY_LABELS = {
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
	statusIdle: { zh: "空闲", en: "Idle" },
	statusStreaming: { zh: "运行中", en: "Running" },
	statusWaiting: { zh: "等待确认", en: "Needs input" },
	statusError: { zh: "出错", en: "Error" },
} as const;

export type TrayLabelKey = keyof typeof TRAY_LABELS;

export function t(lang: TrayLang, key: TrayLabelKey): string {
	return TRAY_LABELS[key][lang];
}

/** Which run state to show; the aggregate across windows, never per-window. */
export function statusLabel(lang: TrayLang, status: TrayStatus): string {
	if (status === "error") return t(lang, "statusError");
	if (status === "streaming") return t(lang, "statusStreaming");
	if (status === "waiting") return t(lang, "statusWaiting");
	return t(lang, "statusIdle");
}

/** Collapse per-window statuses to one: any error > streaming > waiting > idle. */
export function aggregateTrayStatus(states: Iterable<TrayState>): TrayStatus {
	// Precedence is app-global, so a single early return on the first window's
	// streaming would hide a later window's error.
	let streaming = false;
	let waiting = false;
	for (const { status } of states) {
		if (status === "error") return "error";
		if (status === "streaming") streaming = true;
		if (status === "waiting") waiting = true;
	}
	return streaming ? "streaming" : waiting ? "waiting" : "idle";
}

export function approvalLabel(lang: TrayLang, mode: TrayApprovalMode): string {
	if (mode === "yolo") return t(lang, "approvalYolo");
	if (mode === "write") return t(lang, "approvalWrite");
	return t(lang, "approvalAsk");
}

export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

/** Hover text: the icon itself stays a static template mark by design. */
export function trayTooltip(state: TrayState | null): string {
	if (!state) return "omp";
	return `omp — ${state.projectName} · ${statusLabel(state.language === "en" ? "en" : "zh", state.status)}`;
}

/**
 * Everything a rebuilt menu can differ in, as one string. Session lists refresh
 * every few hundred milliseconds while agents stream; a push whose visible
 * labels are unchanged must not swap the native menu out. Context share is
 * bucketed to what the menu actually prints (whole percent, rendered token
 * string) so token-level streaming stays out.
 */
export function menuSignature(state: TrayState): string {
	const percent = state.contextPercent === null ? "—" : String(Math.round(state.contextPercent));
	const tokens = state.contextTokens === null ? "—" : formatTokens(state.contextTokens);
	const workspaces = state.workspaces.map(ws => `${ws.cwd}\u0000${ws.name}\u0000${ws.current}`).join("\u0001");
	return [
		state.language,
		state.status,
		state.projectName,
		state.modelId ?? "—",
		state.thinkingLevel,
		state.fastMode,
		state.approvalMode,
		percent,
		tokens,
		workspaces,
	].join("\u0002");
}
