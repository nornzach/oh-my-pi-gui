/**
 * External-editor round trip for the composer editor dialog (ported from the
 * agent's utils/external-editor.ts): write the draft to a temp file, spawn
 * $VISUAL / $EDITOR (notepad on Windows), read the file back on a clean exit.
 */

import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { ConfigEditor } from "../shared/config-editor";
import { resolveEditorCommand, spawnPath } from "./shell-env";

const launch = promisify(execFile);
const TEXTEDIT_BUNDLE = "com.apple.TextEdit";
const SUBLIME_BUNDLES = ["com.sublimetext.4", "com.sublimetext.3"];
const MAC_CONFIG_EDITORS = {
	auto: [...SUBLIME_BUNDLES, TEXTEDIT_BUNDLE],
	sublime: SUBLIME_BUNDLES,
	textedit: [TEXTEDIT_BUNDLE],
};

async function launchMacEditor(bundleId: string, file: string): Promise<void> {
	await launch("/usr/bin/open", ["-b", bundleId, file]);
}

export async function openMacConfigEditor(
	file: string,
	editor: Exclude<ConfigEditor, "system">,
	open = launchMacEditor,
): Promise<boolean> {
	for (const app of MAC_CONFIG_EDITORS[editor]) {
		try {
			await open(app, file);
			return true;
		} catch {
			// Launch Services reports a missing app as a failed launch. Try the next editor.
		}
	}
	return false;
}

export interface EditorRoundTripResult {
	/** Edited text (exit 0), null when the editor exits non-zero (draft unchanged). */
	text: string | null;
}

export async function openInExternalEditor(content: string): Promise<EditorRoundTripResult> {
	// Resolution order: process $VISUAL/$EDITOR → login-shell $VISUAL/$EDITOR →
	// notepad (win32). The shell probe covers Finder-launched apps, whose rc-file
	// editor settings never reach the GUI process env.
	const editorCmd = await resolveEditorCommand();
	if (!editorCmd) {
		throw new Error("Set $VISUAL or $EDITOR to use an external editor");
	}
	const tmpFile = path.join(os.tmpdir(), `omp-editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`);
	try {
		await fs.writeFile(tmpFile, content, "utf8");
		const [editor, ...editorArgs] = editorCmd.split(" ");
		const child = spawn(editor, [...editorArgs, tmpFile], {
			stdio: ["ignore", "ignore", "ignore"],
			shell: process.platform === "win32",
			// Bare editor names (code, zed, subl) resolve via the login-shell PATH.
			env: { ...process.env, PATH: await spawnPath() },
		});
		const { promise, reject, resolve } = Promise.withResolvers<number>();
		child.once("exit", (code, signal) => resolve(code ?? (signal ? -1 : 0)));
		child.once("error", error => reject(error));
		const exitCode = await promise;
		if (exitCode !== 0) return { text: null };
		// Read-back contract: strip exactly one trailing newline.
		const text = await fs.readFile(tmpFile, "utf8");
		return { text: text.replace(/\n$/, "") };
	} finally {
		try {
			await fs.rm(tmpFile, { force: true });
		} catch {
			// ignore cleanup errors
		}
	}
}
