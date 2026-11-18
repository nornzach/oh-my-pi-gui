/**
 * The quit latch: everything that ends the process goes through `requestQuit()`,
 * and `before-quit` refuses unless the run is already approved. Without this,
 * ⌘Q SIGTERMs every in-flight agent run with no word to the user.
 */
import { app, BrowserWindow, dialog, type MessageBoxOptions, type MessageBoxSyncOptions } from "electron";
import { hasUnsavedFileDrafts } from "./file-draft-guard";
import { getMainLanguage, mainT } from "./i18n";
import { assessQuitRisk, type QuitRisk, quitNeedsConfirmation, type WindowTabFact } from "./quit-guard";

let approved = false;
let asking = false;
let cleanedUp = false;
let inventory: () => WindowTabFact[] = () => [];
let runningTasks: () => number = () => 0;

/** True after the user (or a restart prompt) approved the quit. */
export function isQuitting(): boolean {
	return approved;
}

/** Confirm before closing a window, or every window when quitting the app. */
export function confirmDiscardFileDrafts(owner?: BrowserWindow): boolean {
	if (!hasUnsavedFileDrafts(owner?.webContents.id)) return true;
	const language = getMainLanguage();
	const options: MessageBoxSyncOptions = {
		type: "warning",
		buttons: [mainT("quit.discardFiles", language), mainT("quit.keepWorking", language)],
		defaultId: 1,
		cancelId: 1,
		message: mainT("quit.unsavedFiles", language),
		detail: mainT("quit.unsavedFilesBody", language),
	};
	return (owner ? dialog.showMessageBoxSync(owner, options) : dialog.showMessageBoxSync(options)) === 0;
}

export function requestQuit(beforeQuit?: () => void): void {
	if (!confirmDiscardFileDrafts()) return;
	approved = true;
	beforeQuit?.();
	app.quit();
}

/** What a quit right now would cost. The resource-change restart quotes it. */
export function quitRisk(): QuitRisk {
	return assessQuitRisk(inventory(), runningTasks());
}

/**
 * Register the `before-quit` gate. `tabInventory` reports what the sidecars are
 * doing, `teardown` runs exactly once per approved quit.
 */
export function installQuitGuard(
	tabInventory: () => WindowTabFact[],
	teardown: () => void,
	scheduledRuns: () => number = () => 0,
): void {
	inventory = tabInventory;
	runningTasks = scheduledRuns;
	app.on("before-quit", event => {
		if (approved) {
			if (cleanedUp) return;
			cleanedUp = true;
			teardown();
			return;
		}
		event.preventDefault();
		// ⌘Q pressed again while the dialog is open: the app must not queue a
		// second modal, and it must not quit.
		if (asking) return;
		const risk = quitRisk();
		if (!quitNeedsConfirmation(risk)) {
			requestQuit();
			return;
		}
		asking = true;
		const language = getMainLanguage();
		const owner = BrowserWindow.getFocusedWindow();
		const options: MessageBoxOptions = {
			type: "warning",
			buttons: [mainT("quit.quitAnyway", language), mainT("quit.keepWorking", language)],
			defaultId: 1,
			cancelId: 1,
			message: mainT("quit.workingTitle", language),
			detail: [
				risk.workingTabs > 0
					? mainT("quit.workingBody", language, {
							working: risk.workingTabs,
							total: risk.totalTabs,
							windows: risk.workingWindows,
						})
					: null,
				risk.runningTasks > 0 ? mainT("quit.runningTasks", language, { count: risk.runningTasks }) : null,
			]
				.filter(line => line !== null)
				.join("\n\n"),
		};
		void (owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options))
			.then(result => {
				asking = false;
				if (result.response === 0) requestQuit();
			})
			.catch(() => {
				asking = false;
			});
	});
}
