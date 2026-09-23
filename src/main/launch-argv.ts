/**
 * What a launch asked for, decoded from the arguments a refused second
 * instance handed over. Pure so the rule is testable without Electron.
 */
import * as fs from "node:fs";

export type LaunchRequest = { kind: "url"; url: string } | { kind: "path"; path: string } | { kind: "focus" };

export function isExistingDirectory(path: string): boolean {
	try {
		return fs.statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * A deep link wins over everything; otherwise the first argument naming a real
 * directory is the workspace to open, and anything left means "just raise the
 * app". Flags are skipped so Electron's own switches never look like a path.
 */
export function parseLaunchArgv(
	argv: readonly string[],
	protocol: string,
	directoryExists: (path: string) => boolean = isExistingDirectory,
): LaunchRequest {
	for (const arg of argv) {
		if (arg.startsWith(`${protocol}://`)) return { kind: "url", url: arg };
	}
	for (const arg of argv) {
		if (arg.startsWith("-")) continue;
		if (directoryExists(arg)) return { kind: "path", path: arg };
	}
	return { kind: "focus" };
}
