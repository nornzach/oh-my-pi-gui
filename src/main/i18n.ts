import { app } from "electron";
import Store from "electron-store";
import { isLanguage, type Language, languageFromLocale } from "../shared/languages";
import { RU_MAIN_TEXT } from "./native-ru";
import { TH_MAIN_TEXT } from "./native-th";

export type MainLanguage = Language;

export type MainTextKey =
	| "browser.back"
	| "browser.copyImage"
	| "browser.copyImageAddress"
	| "browser.copyLink"
	| "browser.forward"
	| "browser.inspect"
	| "browser.openLinkExternally"
	| "browser.openLinkInNewPage"
	| "browser.reload"
	| "crash.body"
	| "crash.close"
	| "crash.title"
	| "dialog.openProject"
	| "menu.about"
	| "menu.addToDictionary"
	| "menu.agentHub"
	| "menu.branchPicker"
	| "menu.capabilities"
	| "menu.closeTab"
	| "menu.closeWindow"
	| "menu.commandCenter"
	| "menu.contextReport"
	| "menu.debugConsole"
	| "menu.documentation"
	| "menu.edit"
	| "menu.exportHtml"
	| "menu.extensions"
	| "menu.file"
	| "menu.find"
	| "menu.findNext"
	| "menu.findPrevious"
	| "menu.handoff"
	| "menu.help"
	| "menu.hotkeys"
	| "menu.importSession"
	| "menu.inventory"
	| "menu.jobs"
	| "menu.memory"
	| "menu.modelPicker"
	| "menu.modelRoles"
	| "menu.modes"
	| "menu.newChatTab"
	| "menu.newSession"
	| "menu.newTab"
	| "menu.newWindow"
	| "menu.openProject"
	| "menu.prCenter"
	| "menu.providers"
	| "menu.reportIssue"
	| "menu.restartCore"
	| "menu.scheduledTasks"
	| "menu.session"
	| "menu.sessionInfo"
	| "menu.sessionTree"
	| "menu.settings"
	| "menu.shareSession"
	| "menu.stats"
	| "menu.togglePanel"
	| "menu.toggleSidebar"
	| "menu.tools"
	| "menu.usage"
	| "menu.view"
	| "menu.window"
	| "menu.workspaceChanges"
	| "menu.workspaceDirs"
	| "quit.keepWorking"
	| "quit.quitAnyway"
	| "quit.runningTasks"
	| "quit.workingBody"
	| "quit.workingTitle"
	| "restart.body"
	| "restart.later"
	| "restart.now"
	| "restart.title"
	| "tasks.notify.auth"
	| "tasks.notify.authBody"
	| "tasks.notify.blocked"
	| "tasks.notify.disabled"
	| "tasks.notify.disabledConfig"
	| "tasks.notify.disabledFailures"
	| "tasks.notify.done"
	| "tasks.notify.failed"
	| "tasks.notify.missed"
	| "tasks.notify.missedBody"
	| "tasks.notify.errorBody"
	| "tasks.notify.review"
	| "tasks.notify.verifyFailed"
	| "updates.downloadFailed"
	| "updates.hashMismatch"
	| "updates.installerMissing"
	| "updates.noResult"
	| "updates.openInstallerFailed"
	| "updates.unsupportedArchitecture";

const TEXT: Record<MainTextKey, Record<Exclude<MainLanguage, "ru" | "th">, string>> = {
	"browser.back": { en: "Back", zh: "后退" },
	"browser.copyImage": { en: "Copy Image", zh: "复制图片" },
	"browser.copyImageAddress": { en: "Copy Image Address", zh: "复制图片地址" },
	"browser.copyLink": { en: "Copy Link Address", zh: "复制链接地址" },
	"browser.forward": { en: "Forward", zh: "前进" },
	"browser.inspect": { en: "Inspect Element", zh: "检查元素" },
	"browser.openLinkExternally": { en: "Open Link in Default Browser", zh: "在默认浏览器中打开链接" },
	"browser.openLinkInNewPage": { en: "Open Link in New Page", zh: "在新页面中打开链接" },
	"browser.reload": { en: "Reload", zh: "重新加载" },
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
	"menu.find": { en: "Find…", zh: "查找…" },
	"menu.findNext": { en: "Find Next", zh: "查找下一个" },
	"menu.findPrevious": { en: "Find Previous", zh: "查找上一个" },
	"menu.exportHtml": { en: "Export HTML", zh: "导出 HTML" },
	"menu.file": { en: "File", zh: "文件" },
	"menu.handoff": { en: "Handoff", zh: "交接（Handoff）" },
	"menu.help": { en: "Help", zh: "帮助" },
	"menu.hotkeys": { en: "Keyboard Shortcuts", zh: "键盘快捷键" },
	"menu.jobs": { en: "Jobs", zh: "任务" },
	"menu.agentHub": { en: "Agent Hub", zh: "代理中心" },
	"menu.memory": { en: "Memory", zh: "记忆" },
	"menu.extensions": { en: "Extensions", zh: "扩展" },
	"menu.inventory": { en: "Plugins & Resources", zh: "插件与资源" },
	"menu.modes": { en: "Modes", zh: "模式" },
	"menu.modelRoles": { en: "Model Roles", zh: "模型角色" },
	"crash.body": {
		en: "This window's renderer has crashed repeatedly and cannot recover on its own. The failure was written to the runtime log ({logPath}) — restarting may help, and reporting the log via Help → Report an Issue helps us fix it.",
		zh: "窗口渲染进程反复崩溃且无法自行恢复。故障已写入运行日志({logPath})——重启可能有用,也可以通过「帮助 → 反馈问题」把日志提交给我们。",
	},
	"crash.close": { en: "Close", zh: "关闭" },
	"crash.title": { en: "omp window crashed", zh: "omp 窗口崩溃" },
	"menu.newChatTab": { en: "New Chat Tab", zh: "新建聊天标签页" },
	"menu.newSession": { en: "New Session", zh: "新建会话" },
	"menu.newTab": { en: "New Tab", zh: "新建标签页" },
	"menu.newWindow": { en: "New Window", zh: "新建窗口" },
	"menu.openProject": { en: "Open Project…", zh: "打开项目…" },
	"menu.prCenter": { en: "PR Center", zh: "PR 中心" },
	"menu.providers": { en: "Providers & Login", zh: "提供商与登录" },
	"menu.reportIssue": { en: "Report an Issue…", zh: "反馈问题…" },
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
	"menu.scheduledTasks": { en: "Scheduled Tasks", zh: "定时任务" },
	"quit.runningTasks": {
		en: "{count} scheduled task run(s) are still working. Quitting cancels them.",
		zh: "仍有 {count} 个定时任务正在运行。退出会取消它们。",
	},
	"tasks.notify.done": { en: "{title} finished", zh: "{title} 已完成" },
	"tasks.notify.review": { en: "{title} needs review", zh: "{title} 需要审查" },
	"tasks.notify.failed": { en: "{title} failed", zh: "{title} 失败了" },
	"tasks.notify.verifyFailed": { en: "{title}: check failed", zh: "{title}：检查未通过" },
	"tasks.notify.blocked": { en: "{title} could not start", zh: "{title} 无法启动" },
	"tasks.notify.missed": { en: "{title} missed a run", zh: "{title} 错过了一次运行" },
	"tasks.notify.errorBody": {
		en: "Open the task to see what went wrong.",
		zh: "打开任务查看出错原因。",
	},
	"tasks.notify.missedBody": {
		en: "omp was closed or the computer was asleep when it was due.",
		zh: "到点时 omp 未运行或电脑处于睡眠状态。",
	},
	"tasks.notify.disabled": { en: "{title} was switched off", zh: "{title} 已停用" },
	"tasks.notify.disabledFailures": {
		en: "It failed three times in a row. Fix it, then turn it back on.",
		zh: "它连续失败了三次。修复后再重新启用。",
	},
	"tasks.notify.disabledConfig": {
		en: "It could not start three times in a row. Check its folder and model.",
		zh: "它连续三次无法启动。请检查文件夹和模型。",
	},
	"tasks.notify.auth": { en: "{title} needs you to sign in", zh: "{title} 需要重新登录" },
	"tasks.notify.authBody": {
		en: "The provider rejected the credentials. Sign in again, then run the task.",
		zh: "服务商拒绝了凭据。请重新登录后再运行该任务。",
	},
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
	if (isLanguage(stored)) return stored;
	return languageFromLocale(app.getLocale());
}

/** ru/th live in native-*.ts tables; en/zh are columns of TEXT. */
function textFor(language: MainLanguage, key: MainTextKey): string {
	switch (language) {
		case "ru":
			return RU_MAIN_TEXT[key];
		case "th":
			return TH_MAIN_TEXT[key];
		default:
			return TEXT[key][language];
	}
}

export function mainT(
	key: MainTextKey,
	language = getMainLanguage(),
	params?: Record<string, string | number>,
): string {
	const text = textFor(language, key);
	if (!params) return text;
	return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
