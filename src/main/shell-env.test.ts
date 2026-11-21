import * as fs from "node:fs/promises";
import * as os from "node:os";
import { homedir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	resetLoginShellEnvCache,
	resolveEditorCommand,
	resolveLoginShellEnv,
	shellSpawnEnv,
	spawnPath,
} from "./shell-env";
import { SidecarManager } from "./sidecar";

/**
 * shell-env contract: GUI-spawned processes must see the user's login-shell
 * environment (PATH for bare-name MCP/CLI tools, rc-exported provider API
 * keys, $VISUAL/$EDITOR), never block a spawn on probe failure, never let
 * rc noise corrupt extraction, and never override an explicitly exported
 * launch env. The probe caches at module scope; resetLoginShellEnvCache
 * re-arms it so each test controls SHELL/HOME. Env is poked directly
 * (save/restore in afterEach) instead of vi.stubEnv so the file passes
 * under both vitest and `bun test`, whose vi-compat lacks stubEnv.
 */

const savedEnv = new Map<string, string | undefined>();

function setEnv(key: string, value: string): void {
	if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
	process.env[key] = value;
}

function deleteEnv(key: string): void {
	if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
	delete process.env[key];
}

async function writeFakeShell(dir: string, body: string): Promise<string> {
	const fakeShell = path.join(dir, "fake-shell");
	await fs.writeFile(fakeShell, `#!/bin/sh\n${body}\n`);
	await fs.chmod(fakeShell, 0o755);
	return fakeShell;
}

/** Fake login shell: optional rc noise around a marker-wrapped `env` dump. */
function envDumpBody(entries: Record<string, string>, noisy: boolean): string {
	const dump = Object.entries(entries)
		.map(([key, value]) => `printf '%s=%s\\n' '${key}' '${value}'`)
		.join("\n");
	return [
		...(noisy ? ['printf "rc-banner-noise\\n"'] : []),
		"printf '%s\\n' '__OMP_ENV_BEGIN__'",
		dump,
		"printf '%s\\n' '__OMP_ENV_END__'",
		...(noisy ? ['printf "trailing-noise\\n"'] : []),
	].join("\n");
}

beforeEach(() => {
	resetLoginShellEnvCache();
});

afterEach(() => {
	for (const [key, value] of savedEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	savedEnv.clear();
});

describe("resolveLoginShellEnv", () => {
	it("extracts the env dump between markers even when the rc file prints noise", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-shell-env-"));
		try {
			const fakeShell = await writeFakeShell(
				tempDir,
				envDumpBody({ PATH: "/probed/bin:/usr/bin", VISUAL: "probed-editor", PROBED_ONLY_KEY: "k1" }, true),
			);
			setEnv("SHELL", fakeShell);
			const result = await resolveLoginShellEnv();
			expect(result.path).toBe("/probed/bin:/usr/bin");
			expect(result.editor).toBe("probed-editor");
			expect(result.env.PROBED_ONLY_KEY).toBe("k1");
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("degrades to empty fields when the shell probe fails", async () => {
		setEnv("SHELL", path.join(os.tmpdir(), "omp-no-such-shell"));
		await expect(resolveLoginShellEnv()).resolves.toEqual({ env: {}, path: null, editor: null });
	});
});

describe("spawnPath", () => {
	it("puts inherited PATH entries first and appends the probed shell PATH", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-shell-env-"));
		try {
			const fakeShell = await writeFakeShell(tempDir, envDumpBody({ PATH: "/probed/bin" }, false));
			setEnv("SHELL", fakeShell);
			setEnv("PATH", "/inherited/bin:/usr/bin");
			const result = await spawnPath();
			expect(result.startsWith("/inherited/bin:/usr/bin")).toBe(true);
			expect(result.split(":")).toContain("/probed/bin");
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("falls back to existing well-known user bin dirs when the probe fails", async () => {
		// homedir() differs across runners: node honors the stubbed $HOME while
		// Bun's compat resolves the real home. Stub first, then anchor the
		// assertion on the same homedir() the module calls, and mkdir -p
		// whichever it returns (a no-op when the dir already exists).
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-shell-env-home-"));
		setEnv("SHELL", path.join(os.tmpdir(), "omp-no-such-shell"));
		setEnv("HOME", tempDir);
		setEnv("PATH", "/usr/bin");
		const homeBin = path.join(homedir(), ".local", "bin");
		await fs.mkdir(homeBin, { recursive: true });
		try {
			const entries = (await spawnPath()).split(":");
			expect(entries).toContain(homeBin);
			expect(entries[0]).toBe("/usr/bin");
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});

describe("shellSpawnEnv", () => {
	it("overlays shell-only keys (rc-exported API keys) but never keys the launch env defines", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-shell-env-"));
		try {
			const fakeShell = await writeFakeShell(
				tempDir,
				envDumpBody(
					{
						PATH: "/probed/bin",
						SHELL_ONLY_API_KEY: "from-rc",
						LAUNCH_WINS_KEY: "from-rc",
						HTTPS_PROXY: "rc-proxy-must-not-leak",
						NO_PROXY: "git.corp.example,.internal",
						PWD: "/rc/pwd/must/not/leak",
					},
					false,
				),
			);
			setEnv("SHELL", fakeShell);
			deleteEnv("SHELL_ONLY_API_KEY");
			deleteEnv("NO_PROXY");
			setEnv("LAUNCH_WINS_KEY", "from-launch");
			const overlay = await shellSpawnEnv();
			expect(overlay.SHELL_ONLY_API_KEY).toBe("from-rc");
			expect(overlay.LAUNCH_WINS_KEY).toBeUndefined();
			expect(overlay.HTTPS_PROXY).toBeUndefined();
			// A bypass list narrows a proxy instead of choosing one, so the user's
			// rc entry survives the precedence chain that keeps rc proxies out.
			expect(overlay.NO_PROXY).toBe("git.corp.example,.internal");
			expect(overlay.PWD).toBeUndefined();
			expect(overlay.PATH.split(":")).toContain("/probed/bin");
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});

describe("resolveEditorCommand", () => {
	it("prefers process-env $VISUAL over the login-shell editor", async () => {
		setEnv("VISUAL", "explicit-editor");
		await expect(resolveEditorCommand()).resolves.toBe("explicit-editor");
	});
});

describe("SidecarManager spawn env", () => {
	it("injects the shellEnv overlay into the spawned process", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-env-"));
		const envPath = path.join(tempDir, "env.json");
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nimport * as fs from "node:fs/promises";\nawait fs.writeFile(${JSON.stringify(envPath)}, JSON.stringify({ PATH: process.env.PATH, KEY: process.env.PROBED_SHELL_KEY ?? null }));\nprocess.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] }) + "\\n");\nprocess.stdin.resume();\n`,
		);
		await fs.chmod(binaryPath, 0o755);

		const sidecar = new SidecarManager({
			binaryPath,
			cwd: tempDir,
			shellEnv: () => Promise.resolve({ PATH: `/shell-probed:${process.env.PATH}`, PROBED_SHELL_KEY: "present" }),
		});
		const ready = Promise.withResolvers<void>();
		sidecar.on("status", ({ status }) => {
			if (status === "ready") ready.resolve();
		});
		try {
			sidecar.start();
			await ready.promise;
			const env = JSON.parse(await fs.readFile(envPath, "utf8")) as { PATH: string; KEY: string | null };
			expect(env.PATH.startsWith("/shell-probed:")).toBe(true);
			expect(env.KEY).toBe("present");
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
