import { app } from "electron";
import Store from "electron-store";

export type MainLanguage = "en" | "zh";

type MainTextKey =
	| "dialog.openProject"
	| "menu.about"
	| "menu.addToDictionary"
	| "menu.documentation"
	| "menu.edit"
	| "menu.exportHtml"
	| "menu.file"
	| "menu.handoff"
	| "menu.help"
	| "menu.newChatTab"
	| "menu.newSession"
	| "menu.newTab"
	| "menu.newWindow"
	| "menu.openProject"
	| "menu.session"
	| "menu.settings"
	| "menu.togglePanel"
	| "menu.toggleSidebar"
	| "menu.view"
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
	"menu.documentation": { en: "Documentation", zh: "文档" },
	"menu.edit": { en: "Edit", zh: "编辑" },
	"menu.exportHtml": { en: "Export HTML", zh: "导出 HTML" },
	"menu.file": { en: "File", zh: "文件" },
	"menu.handoff": { en: "Handoff", zh: "交接（Handoff）" },
	"menu.help": { en: "Help", zh: "帮助" },
	"menu.newChatTab": { en: "New Chat Tab", zh: "新建聊天标签页" },
	"menu.newSession": { en: "New Session", zh: "新建会话" },
	"menu.newTab": { en: "New Tab", zh: "新建标签页" },
	"menu.newWindow": { en: "New Window", zh: "新建窗口" },
	"menu.openProject": { en: "Open Project…", zh: "打开项目…" },
	"menu.session": { en: "Session", zh: "会话" },
	"menu.settings": { en: "Settings…", zh: "设置…" },
	"menu.togglePanel": { en: "Toggle Panel", zh: "显示或隐藏面板" },
	"menu.toggleSidebar": { en: "Toggle Sidebar", zh: "显示或隐藏侧边栏" },
	"menu.view": { en: "View", zh: "视图" },
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

export function mainT(key: MainTextKey, language = getMainLanguage()): string {
	return TEXT[key][language];
}
