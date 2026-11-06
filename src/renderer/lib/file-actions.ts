/**
 * What a file link does. Inside the app a file opens in the Files panel
 * preview (at its line, when the reference names one); outside it opens with
 * the system's default app or is revealed in the file manager.
 */
import type { IpcResolvedPath } from "../../shared/ipc-types";
import { toast } from "../stores/toast";
import { useUiStore } from "../stores/ui";
import { describeError } from "./errors";
import { translate } from "./i18n";
import type { FileTarget } from "./link-targets";

async function reportFailure(run: () => Promise<{ ok: boolean; error?: string } | undefined>, path: string) {
	try {
		const result = await run();
		if (!result?.ok) {
			toast({ variant: "error", title: translate("tools.path.openFailed"), message: result?.error || path });
		}
	} catch (cause) {
		toast({
			variant: "error",
			title: translate("tools.path.openFailed"),
			message: describeError(cause),
		});
	}
}

/** Open `path` with the system's default app (a folder opens in the file manager). */
export function openPathExternally(path: string): Promise<void> {
	return reportFailure(() => window.omp.system.openPath(path), path);
}

/** Show `path` selected in the system file manager. */
export function revealPath(path: string): Promise<void> {
	return reportFailure(() => window.omp.system.revealPath(path), path);
}

/** Open `path` in the Files panel preview, scrolled to `line` when given. */
export function previewFile(path: string, line?: number): void {
	useUiStore.getState().openFilePreview(path, line);
}

/**
 * A click on a file link: preview in the app, or with ⌘/Ctrl (and for folders)
 * open with the default app.
 */
export function activateFileLink(target: FileTarget, resolved: IpcResolvedPath | null | undefined, modifier: boolean) {
	const path = resolved?.absolutePath ?? target.path;
	if (modifier || resolved?.kind === "directory") {
		void openPathExternally(path);
		return;
	}
	previewFile(path, target.line);
}
