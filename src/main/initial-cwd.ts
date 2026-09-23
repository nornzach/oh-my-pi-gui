/**
 * Which directory a window or tab starts in when nothing named one. Pure so the
 * rule is testable without Electron; the caller supplies the candidates in
 * priority order.
 */
import { isExistingDirectory } from "./launch-argv";

/**
 * The first candidate that is a real directory. The volume root is never an
 * answer: launched from Finder a process cwd *is* "/", and a session started
 * there runs outside every project and writes wherever nobody intended.
 */
export function firstUsableCwd(
	candidates: readonly (string | null | undefined)[],
	directoryExists: (path: string) => boolean = isExistingDirectory,
): string | undefined {
	for (const candidate of candidates) {
		if (!candidate || candidate === "/") continue;
		if (directoryExists(candidate)) return candidate;
	}
	return undefined;
}
