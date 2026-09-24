/**
 * Login-shell environment resolution for GUI-spawned processes.
 *
 * A Finder-launched app inherits launchd's bare environment
 * (PATH=/usr/bin:/bin:/usr/sbin:/sbin, no rc-file exports). Anything the
 * terminal TUI gets from the user's shell rc is missing in the GUI:
 *   - PATH entries → MCP servers / CLI tools spawned by bare name die ENOENT
 *   - provider API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, …) → providers
 *     show as unauthenticated
 *   - $VISUAL/$EDITOR → the external-editor round trip is "unavailable"
 * v0.3.1 fixed this class for proxy vars; this module fixes it for the rest
 * of the shell environment.
 *
 * Strategy (VS Code-style): dump the login shell's env once with marker
 * delimiters (rc files may print arbitrary text), cache the result, merge
 * it UNDER the process env (an explicitly exported launch env always wins),
 * and degrade to a static PATH augmentation on any failure — resolution
 * must never block a spawn.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const PROBE_TIMEOUT_MS = 4_000;
const BEGIN = "__OMP_ENV_BEGIN__";
const END = "__OMP_ENV_END__";

/** Keys that must never be overlaid from the shell probe. */
const OVERLAY_DENYLIST = new Set([
	// Process identity / launch context owned by the app or launchd.
	"HOME",
	"LOGNAME",
	"OLDPWD",
	"PWD",
	"SHELL",
	"SHLVL",
	"TMPDIR",
	"USER",
	"_",
	// Proxy resolution has its own precedence chain (GUI pref → inherited
	// env → system PAC); rc-file proxy exports must not bypass it.
	"ALL_PROXY",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"PI_PROXY",
	"all_proxy",
	"http_proxy",
	"https_proxy",
	"no_proxy",
]);

export interface LoginShellEnv {
	/** Full parsed env from the login shell; empty when the probe failed. */
	env: Record<string, string>;
	/** PATH exactly as the login shell computes it; null when the probe failed. */
	path: string | null;
	/** $VISUAL || $EDITOR from the login shell; null when unset or probe failed. */
	editor: string | null;
}

const PROBE_FAILED: LoginShellEnv = { env: {}, path: null, editor: null };

let cached: LoginShellEnv | undefined;

/** Test seam: drop the cached probe so a stubbed SHELL/HOME takes effect. */
export function resetLoginShellEnvCache(): void {
	cached = undefined;
}

/** Probe `$SHELL -ilc 'env'` once and cache; on failure every field is empty. */
export function resolveLoginShellEnv(): Promise<LoginShellEnv> {
	if (cached) return Promise.resolve(cached);
	// Windows has no login-shell probe. Keep the inherited environment and add
	// the well-known per-user tool directories through fallbackBinDirs().
	if (process.platform === "win32") {
		cached = PROBE_FAILED;
		return Promise.resolve(PROBE_FAILED);
	}
	const { promise, resolve } = Promise.withResolvers<LoginShellEnv>();
	const finish = (env: LoginShellEnv) => {
		cached = env;
		resolve(env);
	};
	const shell = process.env.SHELL || "/bin/zsh";
	// `command` bypasses rc aliases; markers isolate rc chatter.
	const script = `command printf '%s\\n' '${BEGIN}'; command env; command printf '%s\\n' '${END}'`;
	execFile(shell, ["-ilc", script], { timeout: PROBE_TIMEOUT_MS }, (error, stdout) => {
		if (error) return finish(PROBE_FAILED);
		const begin = stdout.indexOf(BEGIN);
		const end = stdout.lastIndexOf(END);
		if (begin === -1 || end < begin) return finish(PROBE_FAILED);
		const env: Record<string, string> = {};
		for (const line of stdout.slice(begin + BEGIN.length, end).split("\n")) {
			const eq = line.indexOf("=");
			if (eq <= 0) continue;
			env[line.slice(0, eq)] = line.slice(eq + 1);
		}
		const path = env.PATH?.trim() ?? "";
		const editor = env.VISUAL?.trim() || env.EDITOR?.trim() || "";
		finish({
			env,
			path: path.length > 0 ? path : null,
			editor: editor.length > 0 ? editor : null,
		});
	});
	return promise;
}

/** Compare two `vX.Y.Z` directory names numerically (nvm version dirs). */
function compareVersionDirs(a: string, b: string): number {
	const pa = a.slice(1).split(".").map(Number);
	const pb = b.slice(1).split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/** Existing well-known user bin dirs, used when the shell probe fails. */
function fallbackBinDirs(): string[] {
	const home = homedir();
	if (process.platform === "win32") {
		const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
		const roaming = process.env.APPDATA || join(home, "AppData", "Roaming");
		return [
			join(home, ".bun", "bin"),
			join(home, ".cargo", "bin"),
			join(home, ".local", "bin"),
			join(local, "Programs", "bun"),
			join(roaming, "npm"),
			join(local, "Microsoft", "WindowsApps"),
		].filter(dir => existsSync(dir));
	}
	const candidates = [
		join(home, ".local", "bin"),
		join(home, ".bun", "bin"),
		join(home, "bin"),
		join(home, ".cargo", "bin"),
		join(home, ".volta", "bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
	];
	// nvm keeps no stable "current" symlink; take the newest installed node.
	try {
		const nvmDir = join(home, ".nvm", "versions", "node");
		const newest = readdirSync(nvmDir)
			.filter(entry => entry.startsWith("v"))
			.sort(compareVersionDirs)
			.at(-1);
		if (newest) candidates.push(join(nvmDir, newest, "bin"));
	} catch {
		// No nvm install — fine.
	}
	return candidates.filter(dir => existsSync(dir));
}

/**
 * Merge inherited PATH entries (explicit launch env wins order) with the
 * probed login-shell PATH, or the static fallback when probing failed.
 */
export async function spawnPath(): Promise<string> {
	const inherited = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
	const probed = await resolveLoginShellEnv();
	const extra = probed.path !== null ? probed.path.split(delimiter).filter(Boolean) : fallbackBinDirs();
	return [...new Set([...inherited, ...extra])].join(delimiter);
}

/**
 * Env overlay for sidecar spawns: every probed shell var the process lacks
 * (API keys, locale, tool config) plus the merged PATH. Keys the launch env
 * already defines win — an exported terminal env always beats rc files.
 */
export async function shellSpawnEnv(): Promise<Record<string, string>> {
	const probed = await resolveLoginShellEnv();
	const overlay: Record<string, string> = {};
	for (const [key, value] of Object.entries(probed.env)) {
		if (OVERLAY_DENYLIST.has(key) || key === "PATH" || key in process.env) continue;
		overlay[key] = value;
	}
	overlay.PATH = await spawnPath();
	return overlay;
}

/** Editor command from process env, falling back to the login shell's $VISUAL/$EDITOR. */
export async function resolveEditorCommand(): Promise<string | undefined> {
	const configured = process.env.VISUAL?.trim() || process.env.EDITOR?.trim();
	if (configured) return configured;
	if (process.platform === "win32") return "notepad";
	const probed = await resolveLoginShellEnv();
	return probed.editor ?? undefined;
}
