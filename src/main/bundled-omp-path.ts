import { existsSync } from "node:fs";
import { join } from "node:path";

/** Filename of the bundled omp sidecar on this platform. */
export function bundledOmpFilename(): string {
	return process.platform === "win32" ? "omp.exe" : "omp";
}

/** Resolve a bundled sidecar path, accepting a Windows .exe suffix when needed. */
export function resolveOmpCandidate(...parts: string[]): string | null {
	const candidate = join(...parts);
	if (existsSync(candidate)) return candidate;
	if (process.platform === "win32" && !candidate.toLowerCase().endsWith(".exe")) {
		const withExe = `${candidate}.exe`;
		if (existsSync(withExe)) return withExe;
	}
	return null;
}
