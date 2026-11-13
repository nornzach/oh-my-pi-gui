/**
 * Pure tray vocabulary: every string the native menu shows, plus the signature
 * that decides whether the menu has to be rebuilt. Lives outside `tray.ts`
 * because that module needs electron — the label mapping and the churn guard
 * are the parts worth testing.
 */

import type { TrayQuota, TrayQuotaLimit, TrayState } from "../shared/ipc-types";
import { type Language, languageDetails } from "../shared/languages";
import { quotaPercentText } from "../shared/quotas";
import { truncateMiddle } from "../shared/text";
import { RU_TRAY_TEXT } from "./native-ru";
import { TH_TRAY_TEXT } from "./native-th";

export type TrayStatus = TrayState["status"];
export type TrayLang = Language;
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
	approvalAskCached: { zh: "询问并记住", en: "Ask and remember" },
	context: { zh: "上下文", en: "Context" },
	tokens: { zh: "tokens", en: "tokens" },
	noModel: { zh: "未选模型", en: "No model" },
	statusIdle: { zh: "空闲", en: "Idle" },
	statusStreaming: { zh: "运行中", en: "Running" },
	statusWaiting: { zh: "等待确认", en: "Needs input" },
	statusError: { zh: "出错", en: "Error" },
	quotaUsed: { zh: "已用 {percent}", en: "{percent} used" },
	quotaReached: { zh: "已用完", en: "limit reached" },
	quotaResets: { zh: "{time} 重置", en: "resets {time}" },
	quotaUpdated: { zh: "更新于 {time}", en: "Updated {time}" },
	moreQuotas: { zh: "更多配额（{count}）", en: "More quotas ({count})" },
} as const;

export type TrayLabelKey = keyof typeof TRAY_LABELS;

export function t(lang: TrayLang, key: TrayLabelKey): string {
	switch (lang) {
		case "ru":
			return RU_TRAY_TEXT[key];
		case "th":
			return TH_TRAY_TEXT[key];
		default:
			return TRAY_LABELS[key][lang];
	}
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
	if (mode === "always-ask-cached") return t(lang, "approvalAskCached");
	return t(lang, "approvalAsk");
}

function fill(template: string, values: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * A moment as a clock reading, so a menu opened hours after it was built still
 * reads right: the time today, a weekday within the week, a date beyond.
 */
export function formatMenuTime(lang: TrayLang, at: number, now: number): string {
	const locale = languageDetails(lang).locale;
	const date = new Date(at);
	const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
	if (date.toDateString() === new Date(now).toDateString()) return time;
	if (Math.abs(at - now) < 6 * DAY_MS) return `${date.toLocaleDateString(locale, { weekday: "short" })} ${time}`;
	return `${date.toLocaleDateString(locale, { month: "short", day: "numeric" })} ${time}`;
}

/** Longest account name a menu row shows before its middle is cut, so one address does not widen the menu. */
const ACCOUNT_CHARS = 24;

/** A quota row: the provider (and account), then each window's used share, shortest window first. */
export function quotaRowLabel(quota: TrayQuota): string {
	const name = quota.account ? `${quota.name} · ${truncateMiddle(quota.account, ACCOUNT_CHARS)}` : quota.name;
	return `${name} — ${quota.windows.map(window => `${window.window} ${quotaPercentText(window.fraction)}`).join(", ")}`;
}

/** Quota rows the menu shows directly; the rest go under "More quotas". */
export const QUOTA_ROWS_SHOWN = 5;

export function moreQuotasLabel(lang: TrayLang, count: number): string {
	return fill(t(lang, "moreQuotas"), { count: String(count) });
}

/** A submenu line for one limit: its used share, whether it is used up, and when it resets. */
export function quotaLimitLabel(lang: TrayLang, limit: TrayQuotaLimit, now: number): string {
	const parts = [fill(t(lang, "quotaUsed"), { percent: quotaPercentText(limit.fraction) })];
	if (limit.exhausted) parts.push(t(lang, "quotaReached"));
	if (limit.resetsAt && limit.resetsAt > now)
		parts.push(fill(t(lang, "quotaResets"), { time: formatMenuTime(lang, limit.resetsAt, now) }));
	return `${limit.label} — ${parts.join(" · ")}`;
}

export function quotaUpdatedLabel(lang: TrayLang, at: number, now: number): string {
	return fill(t(lang, "quotaUpdated"), { time: formatMenuTime(lang, at, now) });
}

/** Quota figures as the menu prints them: whole percents, reset minutes, the reading's minute. */
function quotaSignature(state: TrayState): string {
	const rows = state.quotas.map(quota =>
		[
			quotaRowLabel(quota),
			...quota.windows.flatMap(window =>
				window.limits.map(
					limit =>
						`${limit.label}\u0000${quotaPercentText(limit.fraction)}\u0000${limit.exhausted}\u0000${Math.floor((limit.resetsAt ?? 0) / 60_000)}`,
				),
			),
		].join("\u0003"),
	);
	return [...rows, Math.floor(state.quotasAt / 60_000)].join("\u0004");
}

export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

/** Hover text: the icon itself stays a static template mark by design. */
export function trayTooltip(state: TrayState | null): string {
	if (!state) return "omp";
	return `omp — ${state.projectName} · ${statusLabel(state.language, state.status)}`;
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
		quotaSignature(state),
	].join("\u0002");
}
