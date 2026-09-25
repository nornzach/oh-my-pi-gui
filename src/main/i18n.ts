import { app } from "electron";
import Store from "electron-store";

export type MainLanguage = "en" | "zh";

type MainTextKey =
	| "dialog.openProject"
	| "menu.about"
	| "menu.addToDictionary"
	| "menu.closeTab"
	| "menu.closeWindow"
	| "menu.commandCenter"
	| "menu.capabilities"
	| "menu.importSession"
	| "menu.branchPicker"
	| "menu.sessionTree"
	| "menu.modelPicker"
	| "menu.usage"
	| "menu.workspaceChanges"
	| "menu.restartCore"
	| "menu.contextReport"
	| "menu.debugConsole"
	| "menu.documentation"
	| "menu.edit"
	| "menu.exportHtml"
	| "menu.file"
	| "menu.handoff"
	| "menu.help"
	| "menu.hotkeys"
	| "menu.jobs"
	| "menu.agentHub"
	| "menu.extensions"
	| "menu.inventory"
	| "menu.modes"
	| "menu.modelRoles"
	| "menu.newChatTab"
	| "menu.newSession"
	| "menu.newTab"
	| "menu.newWindow"
	| "menu.openProject"
	| "menu.prCenter"
	| "menu.providers"
	| "menu.session"
	| "menu.sessionInfo"
	| "menu.shareSession"
	| "menu.settings"
	| "menu.stats"
	| "menu.togglePanel"
	| "menu.toggleSidebar"
	| "menu.tools"
	| "menu.view"
	| "menu.window"
	| "menu.workspaceDirs"
	| "quit.keepWorking"
	| "quit.quitAnyway"
	| "quit.workingBody"
	| "quit.workingTitle"
	| "restart.body"
	| "restart.later"
	| "restart.now"
	| "restart.title"
	| "updates.downloadFailed"
	| "updates.hashMismatch"
	| "updates.installerMissing"
	| "updates.noResult"
	| "updates.openInstallerFailed"
	| "updates.unsupportedArchitecture";

const TEXT: Record<MainTextKey, Record<MainLanguage, string>> = {
	"dialog.openProject": { en: "Open project", zh: "打开项目" },
	"menu.about": { en: "About omp", zh: "关于 omp" },
	"menu.addToDictionary": { en: "Add to dictionary", zh: "添加到词典" },
	"menu.closeTab": { en: "Close Tab", zh: "关闭标签页" },
	"menu.closeWindow": { en: "Close Window", zh: "关闭窗口" },
	"menu.commandCenter": { en: "Command Center", zh: "命令中心" },
	"menu.capabilities": { en: "Capabilities", zh: "能力" },
	"menu.importSession": { en: "Import Session", zh: "导入会话" },
	"menu.branchPicker": { en: "Branch from Message", zh: "从消息分支" },
	"menu.sessionTree": { en: "Session Tree", zh: "会话树" },
	"menu.modelPicker": { en: "Select Model", zh: "选择模型" },
	"menu.usage": { en: "Usage", zh: "用量" },
	"menu.workspaceChanges": { en: "Git Changes", zh: "Git 变更" },
	"menu.restartCore": { en: "Restart OMP Core", zh: "重启 OMP Core" },
	"menu.contextReport": { en: "Context Report", zh: "上下文报告" },
	"menu.debugConsole": { en: "Debug Console", zh: "调试控制台" },
	"menu.documentation": { en: "Documentation", zh: "文档" },
	"menu.edit": { en: "Edit", zh: "编辑" },
	"menu.exportHtml": { en: "Export HTML", zh: "导出 HTML" },
	"menu.file": { en: "File", zh: "文件" },
	"menu.handoff": { en: "Handoff", zh: "交接（Handoff）" },
	"menu.help": { en: "Help", zh: "帮助" },
	"menu.hotkeys": { en: "Keyboard Shortcuts", zh: "键盘快捷键" },
	"menu.jobs": { en: "Jobs", zh: "任务" },
	"menu.agentHub": { en: "Agent Hub", zh: "代理中心" },
	"menu.extensions": { en: "Extensions", zh: "扩展" },
	"menu.inventory": { en: "Plugins & Resources", zh: "插件与资源" },
	"menu.modes": { en: "Modes", zh: "模式" },
	"menu.modelRoles": { en: "Model Roles", zh: "模型角色" },
	"menu.newChatTab": { en: "New Chat Tab", zh: "新建聊天标签页" },
	"menu.newSession": { en: "New Session", zh: "新建会话" },
	"menu.newTab": { en: "New Tab", zh: "新建标签页" },
	"menu.newWindow": { en: "New Window", zh: "新建窗口" },
	"menu.openProject": { en: "Open Project…", zh: "打开项目…" },
	"menu.prCenter": { en: "PR Center", zh: "PR 中心" },
	"menu.providers": { en: "Providers & Login", zh: "提供商与登录" },
	"menu.session": { en: "Session", zh: "会话" },
	"menu.sessionInfo": { en: "Session Info", zh: "会话信息" },
	"menu.shareSession": { en: "Share Session", zh: "分享会话" },
	"menu.settings": { en: "Settings…", zh: "设置…" },
	"menu.stats": { en: "Session Stats", zh: "会话统计" },
	"menu.togglePanel": { en: "Toggle Panel", zh: "显示或隐藏面板" },
	"menu.toggleSidebar": { en: "Toggle Sidebar", zh: "显示或隐藏侧边栏" },
	"menu.tools": { en: "Tools", zh: "工具" },
	"menu.view": { en: "View", zh: "视图" },
	"menu.window": { en: "Window", zh: "窗口" },
	"menu.workspaceDirs": { en: "Workspace Directories", zh: "工作区目录" },
	"quit.keepWorking": { en: "Keep working", zh: "继续工作" },
	"quit.quitAnyway": { en: "Quit anyway", zh: "仍要退出" },
	"quit.workingBody": {
		en: "{working} of {total} sessions are still working in {windows} window(s). Quitting stops them and their agents.",
		zh: "仍有 {working}/{total} 个会话正在 {windows} 个窗口中工作。退出会中止它们及其代理。",
	},
	"quit.workingTitle": { en: "Sessions are still running", zh: "仍有会话在运行" },
	"restart.body": {
		en: "omp's installed files were replaced while it was running, so this window can no longer load them reliably. {working} of {total} sessions are still working.",
		zh: "omp 运行期间安装文件已被替换，窗口无法可靠地加载它们。仍有 {working}/{total} 个会话正在工作。",
	},
	"restart.later": { en: "Later", zh: "稍后再说" },
	"restart.now": { en: "Restart now", zh: "立即重启" },
	"restart.title": { en: "Restart to finish updating", zh: "重启以完成更新" },
	"updates.downloadFailed": {
		en: "The installer download failed.",
		zh: "安装程序下载失败。",
	},
	"updates.hashMismatch": {
		en: "The downloaded installer failed SHA-512 verification and was removed.",
		zh: "下载的安装程序未通过 SHA-512 校验，已被删除。",
	},
	"updates.installerMissing": {
		en: "This release does not include the required installer for this Mac.",
		zh: "此版本不包含当前 Mac 所需的安装程序。",
	},
	"updates.noResult": {
		en: "Update check completed without a result.",
		zh: "更新检查已完成，但未返回结果。",
	},
	"updates.openInstallerFailed": {
		en: "The installer was downloaded, but macOS could not open it.",
		zh: "安装程序已下载，但 macOS 无法打开。",
	},
	"updates.unsupportedArchitecture": {
		en: "This Mac architecture does not have a supported installer.",
		zh: "当前 Mac 架构没有受支持的安装程序。",
	},
};

const prefs = new Store<{ language?: MainLanguage }>({ name: "prefs" });

export function getMainLanguage(): MainLanguage {
	const stored = prefs.get("language");
	if (stored === "en" || stored === "zh") return stored;
	return app.getLocale().toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function mainT(
	key: MainTextKey,
	language = getMainLanguage(),
	params?: Record<string, string | number>,
): string {
	if (!params) return TEXT[key][language];
	return TEXT[key][language].replace(/\{(\w+)\}/g, (match, name: string) =>
		name in params ? String(params[name]) : match,
	);
}
