import { GUI_DISPLAY_BOOL_FIELDS, GUI_DISPLAY_LEGACY_PATHS } from "../../lib/display-preferences";
/**
 * SettingsWindow model: launch-profile field constants, tab id constants,
 * and nav-group metadata. Extracted verbatim from SettingsWindow.tsx.
 */

import type { SettingProvenance } from "../../../shared/rpc-types";
import type { TabItem } from "../common";
import { isSettingSupportedInGui } from "./settings-schema-utils";

export type LoadState = "loading" | "error" | "ready";

/** Launch-profile text fields that commit on blur (checkboxes/chips apply immediately). */
export type LaunchTextField = "systemPrompt" | "appendSystemPrompt" | "profile" | "sessionDir" | "config";
export const LAUNCH_TEXT_FIELDS: readonly LaunchTextField[] = [
	"systemPrompt",
	"appendSystemPrompt",
	"profile",
	"sessionDir",
	"config",
];
/** Prompt fields keep whitespace verbatim (the CLI takes the literal value); the rest trim. */
export const LAUNCH_VERBATIM_FIELDS: Record<string, true> = { systemPrompt: true, appendSystemPrompt: true };

export interface SettingsResponseData {
	values?: Record<string, unknown>;
	provenance?: Record<string, SettingProvenance>;
	advisorEnabled?: boolean;
	advisorActive?: boolean;
}

/** Settings without UI metadata (advanced): searchable flat list. */
export const CAPABILITIES_TAB_ID = "capabilities";
export const SKILLS_TAB_ID = "skills";
export const MCP_TAB_ID = "mcp";
export const RESOURCES_TAB_ID = "resources";
export const HOOKS_TAB_ID = "hooks";
export const COMMANDS_TAB_ID = "commands";
export const SECURITY_TAB_ID = "security";
export const SSH_TAB_ID = "ssh";
export const UPDATES_TAB_ID = "updates";
export const ADVANCED_TAB_ID = "advanced";
export const GUI_TAB_ID = "gui";

export const MANAGEMENT_TAB_IDS = new Set([
	SKILLS_TAB_ID,
	MCP_TAB_ID,
	RESOURCES_TAB_ID,
	HOOKS_TAB_ID,
	COMMANDS_TAB_ID,
	SECURITY_TAB_ID,
	SSH_TAB_ID,
	UPDATES_TAB_ID,
]);

export function isAgentSchemaTab(tab: string, schema: { tabs: { id: string }[] } | null): boolean {
	if (schema?.tabs.some(schemaTab => schemaTab.id === tab)) return true;
	return !MANAGEMENT_TAB_IDS.has(tab) && tab !== GUI_TAB_ID && tab !== CAPABILITIES_TAB_ID && tab !== ADVANCED_TAB_ID;
}

export const SEARCHABLE_MANAGEMENT_TAB_IDS = new Set([
	SKILLS_TAB_ID,
	MCP_TAB_ID,
	RESOURCES_TAB_ID,
	HOOKS_TAB_ID,
	COMMANDS_TAB_ID,
]);

export interface SettingsNavGroup {
	id: "experience" | "models" | "tasks" | "tools" | "extensions" | "security" | "memory" | "system";
	items: TabItem[];
}

/** Stable page ids preserve commands and deep links while navigation follows user intent. */
export function buildSettingsNavGroups(
	schema: {
		tabs: { id: string; label: string }[];
		entries: { path?: string; tab?: string; tuiOnly?: boolean }[];
	} | null,
): SettingsNavGroup[] {
	const groups: SettingsNavGroup[] = [
		{ id: "experience", items: [{ id: GUI_TAB_ID, label: "Interface" }] },
		{ id: "models", items: [] },
		{ id: "tasks", items: [] },
		{ id: "tools", items: [] },
		{
			id: "extensions",
			items: [
				{ id: CAPABILITIES_TAB_ID, label: "Overview" },
				{ id: SKILLS_TAB_ID, label: "Skills" },
				{ id: MCP_TAB_ID, label: "MCP" },
				{ id: RESOURCES_TAB_ID, label: "Plugins & resources" },
				{ id: HOOKS_TAB_ID, label: "Hooks" },
				{ id: COMMANDS_TAB_ID, label: "Commands" },
			],
		},
		{ id: "security", items: [{ id: SECURITY_TAB_ID, label: "Security Center" }] },
		{ id: "memory", items: [] },
		{
			id: "system",
			items: [
				{ id: SSH_TAB_ID, label: "SSH Hosts" },
				{ id: UPDATES_TAB_ID, label: "Updates" },
				{ id: ADVANCED_TAB_ID, label: "Agent advanced" },
			],
		},
	];
	const owners: Record<string, SettingsNavGroup["id"]> = {
		appearance: "experience",
		interaction: "experience",
		model: "models",
		providers: "models",
		context: "tasks",
		tasks: "tasks",
		files: "tools",
		shell: "tools",
		tools: "tools",
		memory: "memory",
	};
	for (const tab of schema?.tabs ?? []) {
		if (!schema?.entries.some(entry => entry.tab === tab.id && isSettingSupportedInGui(entry))) continue;
		groups.find(group => group.id === (owners[tab.id] ?? "system"))?.items.push(tab);
	}
	return groups.filter(group => group.items.length > 0);
}

/** Search metadata points to existing controls; it does not create a second settings store. */
export const GUI_SETTING_SEARCH_ITEMS = [
	...GUI_DISPLAY_BOOL_FIELDS.map((id, index) => ({
		id,
		labelKey: `settings.display.${id}` as const,
		aliases: `${GUI_DISPLAY_LEGACY_PATHS[index]} display 显示 偏好`,
	})),
	{
		id: "pasteMenuThreshold",
		labelKey: "settings.display.pasteMenuThreshold",
		aliases: "paste.largeMenuThreshold paste 粘贴 阈值",
	},
	{ id: "theme", labelKey: "settings.gui.theme", aliases: "theme dark light 主题 明暗" },
	{ id: "followAgentTheme", labelKey: "settings.gui.followAgentTheme", aliases: "theme override 主题 覆盖" },
	{
		id: "readability",
		labelKey: "settings.gui.readability",
		aliases: "compactDensity colorBlindMode compact density color blind 紧凑 密度 色盲",
	},
	{ id: "fontSize", labelKey: "settings.gui.fontSize", aliases: "fontSize font size 字号 字体" },
	{ id: "panelDefault", labelKey: "settings.gui.panelDefault", aliases: "panelTab sidebar panel 侧栏 面板" },
	{ id: "notifications", labelKey: "settings.gui.notifications", aliases: "notifications 通知" },
	{
		id: "thinkingExpanded",
		labelKey: "settings.gui.thinkingExpanded",
		aliases: "thinkingExpanded reasoning thinking 思考 推理",
	},
	{
		id: "transcriptDetail",
		labelKey: "settings.gui.transcriptDetail",
		aliases: "transcriptDetail tools detail transcript 对话 工具 过程",
	},
	{ id: "lineNumbers", labelKey: "codeblock.lineNumbers", aliases: "codeLineNumbers code lines 代码 行号" },
	{ id: "proxy", labelKey: "settings.gui.proxy", aliases: "proxyUrl proxy network 代理 网络", tabId: ADVANCED_TAB_ID },
	{
		id: "launch",
		tabId: ADVANCED_TAB_ID,
		labelKey: "settings.launch.title",
		aliases: "launchProfiles launch systemPrompt profile sessionDir 启动 参数 工作区",
	},
] as const;
