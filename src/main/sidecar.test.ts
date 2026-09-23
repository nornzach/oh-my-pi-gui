import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Store from "electron-store";
import { describe, expect, it, vi } from "vitest";
import type { CommandOutputFrame, PromptResultFrame, SidecarStatus, SidecarStatusPayload } from "../shared/rpc-types";
import { missingSidecarMessage, type SidecarFailureReport, SidecarManager } from "./sidecar";

async function waitForReady(sidecar: SidecarManager): Promise<void> {
	const ready = Promise.withResolvers<void>();
	const onStatus = ({ status }: { status: SidecarStatus }) => {
		if (status === "ready") ready.resolve();
	};
	sidecar.on("status", onStatus);
	try {
		await ready.promise;
	} finally {
		sidecar.off("status", onStatus);
	}
}

describe("SidecarManager", () => {
	it("passes the active session path on a manual restart", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-"));
		const logPath = path.join(tempDir, "argv.json");
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		const sessionPath = path.join(tempDir, "session.jsonl");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nimport * as fs from "node:fs/promises";\nawait fs.writeFile(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] }) + "\\n");\nprocess.stdin.resume();\n`,
		);
		await fs.chmod(binaryPath, 0o755);

		const sidecar = new SidecarManager({ binaryPath, cwd: tempDir });
		try {
			const firstReady = waitForReady(sidecar);
			sidecar.start();
			await firstReady;

			const restarted = waitForReady(sidecar);
			sidecar.restart(undefined, sessionPath);
			await restarted;

			const launch: unknown = JSON.parse(await fs.readFile(logPath, "utf8"));
			expect(launch).toEqual(["--mode", "rpc-ui", "--session", sessionPath]);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("spawns a chat sidecar with --chat in the code-controlled argv", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-chat-"));
		const logPath = path.join(tempDir, "argv.json");
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nimport * as fs from "node:fs/promises";\nawait fs.writeFile(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] }) + "\\n");\nprocess.stdin.resume();\n`,
		);
		await fs.chmod(binaryPath, 0o755);

		const sidecar = new SidecarManager({ binaryPath, cwd: tempDir, kind: "chat" });
		try {
			const ready = waitForReady(sidecar);
			sidecar.start();
			await ready;

			const launch: unknown = JSON.parse(await fs.readFile(logPath, "utf8"));
			expect(launch).toEqual(["--mode", "rpc-ui", "--chat"]);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("forces a freshly created tab to bypass the CLI auto-resume setting", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-fresh-"));
		const logPath = path.join(tempDir, "argv.json");
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nimport * as fs from "node:fs/promises";\nawait fs.writeFile(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] }) + "\\n");\nprocess.stdin.resume();\n`,
		);
		await fs.chmod(binaryPath, 0o755);

		const sidecar = new SidecarManager({ binaryPath, cwd: tempDir, fresh: true });
		try {
			const ready = waitForReady(sidecar);
			sidecar.start();
			await ready;

			const launch: unknown = JSON.parse(await fs.readFile(logPath, "utf8"));
			expect(launch).toEqual(["--mode", "rpc-ui", "--no-auto-resume"]);

			const restarted = waitForReady(sidecar);
			sidecar.restart();
			await restarted;
			const restartLaunch: unknown = JSON.parse(await fs.readFile(logPath, "utf8"));
			expect(restartLaunch).toEqual(["--mode", "rpc-ui"]);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("routes prompt results and text-mode command output as dedicated frames", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-output-"));
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nprocess.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] }) + "\\n");\nprocess.stdout.write(JSON.stringify({ type: "prompt_result", id: "local-command", agentInvoked: false }) + "\\n");\nprocess.stdout.write(JSON.stringify({ type: "command_output", text: "Enabled models" }) + "\\n");\nprocess.stdin.resume();\n`,
		);
		await fs.chmod(binaryPath, 0o755);

		const sidecar = new SidecarManager({ binaryPath, cwd: tempDir });
		const received = Promise.withResolvers<CommandOutputFrame>();
		sidecar.once("commandOutput", frame => received.resolve(frame as CommandOutputFrame));
		const promptResult = Promise.withResolvers<PromptResultFrame>();
		sidecar.once("promptResult", frame => promptResult.resolve(frame as PromptResultFrame));
		try {
			sidecar.start();
			expect(await Promise.all([promptResult.promise, received.promise])).toEqual([
				{ type: "prompt_result", id: "local-command", agentInvoked: false },
				{ type: "command_output", text: "Enabled models" },
			]);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("appends the workspace launch profile flags at spawn, denylist-proof", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-profile-"));
		const fakeHome = path.join(tempDir, "home");
		const workspaceCwd = path.join(tempDir, "workspace");
		await fs.mkdir(fakeHome, { recursive: true });
		await fs.mkdir(workspaceCwd, { recursive: true });
		const logPath = path.join(tempDir, "argv.json");
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nimport * as fs from "node:fs/promises";\nawait fs.writeFile(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] }) + "\\n");\nprocess.stdin.resume();\n`,
		);
		await fs.chmod(binaryPath, 0o755);

		// electron-store/conf resolves its prefs path from os.homedir() per
		// construction, so a redirected HOME lands the store inside tempDir.
		// Discover the exact path through the same stack rather than hardcoding
		// conf internals, then seed the workspace profile into it.
		const originalHome = process.env.HOME;
		process.env.HOME = fakeHome;
		const sidecar = new SidecarManager({ binaryPath, cwd: workspaceCwd });
		try {
			// Same options as the loader; a variable sidesteps the excess-property
			// check on electron-store's Options type (projectName reaches conf).
			const storeOptions = { name: "prefs", projectName: "omp-gui" };
			const probe = new Store(storeOptions);
			await fs.mkdir(path.dirname(probe.path), { recursive: true });
			await fs.writeFile(
				probe.path,
				JSON.stringify({
					launchProfiles: {
						[workspaceCwd]: {
							appendSystemPrompt: "GUI injected",
							noRules: true,
							addDirs: ["/data/extra"],
							tools: ["read", "bash"],
							// Smuggled keys that could reach code-controlled flags —
							// parseLaunchProfile drops them before the mapping.
							"--session": "hijack",
							session: "hijack",
						},
					},
				}),
			);

			const ready = waitForReady(sidecar);
			sidecar.start();
			await ready;

			const launch: unknown = JSON.parse(await fs.readFile(logPath, "utf8"));
			expect(launch).toEqual([
				"--mode",
				"rpc-ui",
				"--append-system-prompt",
				"GUI injected",
				"--no-rules",
				"--add-dir",
				"/data/extra",
				"--tools",
				"read,bash",
			]);
		} finally {
			process.env.HOME = originalHome;
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("adoptCwd re-roots the reported cwd and plain restarts spawn there", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-adopt-"));
		// realpath: the spawned process's process.cwd() resolves /var symlinks.
		const adoptedCwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-adopted-")));
		const logPath = path.join(tempDir, "spawn.json");
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nimport * as fs from "node:fs/promises";\nawait fs.writeFile(${JSON.stringify(logPath)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));\nprocess.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] }) + "\\n");\nprocess.stdin.resume();\n`,
		);
		await fs.chmod(binaryPath, 0o755);

		const sidecar = new SidecarManager({ binaryPath, cwd: tempDir });
		try {
			// Same-cwd adoption is a no-op; a new cwd moves the reported cwd.
			expect(sidecar.adoptCwd(tempDir)).toBe(false);
			expect(sidecar.adoptCwd(adoptedCwd)).toBe(true);
			expect(sidecar.cwd).toBe(adoptedCwd);

			// A plain restart (crash recovery, manual session resume) respawns in
			// the ADOPTED cwd — the session's workspace, not the stale spawn cwd.
			const ready = waitForReady(sidecar);
			sidecar.restart();
			await ready;

			const spawn = JSON.parse(await fs.readFile(logPath, "utf8")) as { cwd: string };
			expect(spawn.cwd).toBe(adoptedCwd);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
			await fs.rm(adoptedCwd, { recursive: true, force: true });
		}
	});

	it("keeps a boot-crashing sidecar in the restart loop instead of a false ready", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-boot-crash-"));
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		// Advertises protocol v2 and never answers `negotiate_protocol`, then dies:
		// teardown rejects the pending negotiation on a generation that is already
		// gone, which is what used to report "ready" and zero the restart counter.
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nprocess.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 2, supportedProtocolVersions: [2], maxFrameBytes: 1048576, maxReassembledFrameBytes: 67108864 }) + "\\n");\nsetTimeout(() => process.exit(3), 120);\n`,
		);
		await fs.chmod(binaryPath, 0o755);

		const statuses: SidecarStatusPayload[] = [];
		const sidecar = new SidecarManager({ binaryPath, cwd: tempDir });
		sidecar.on("status", payload => statuses.push(payload));
		try {
			sidecar.start();
			await expect
				.poll(() => statuses.some(payload => payload.status === "restarting"), { timeout: 9_000, interval: 50 })
				.toBe(true);
			// The rejected negotiation settles as a microtask after the status push.
			await delay(20);

			expect(statuses.at(-1)).toMatchObject({
				status: "restarting",
				restart: { attempt: 1, maxAttempts: 3 },
			});
			expect(statuses.filter(payload => payload.status === "ready")).toEqual([]);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	}, 15_000);

	it("drops a spawn whose env resolution was superseded by a restart", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-superseded-"));
		const pidPath = path.join(tempDir, "pids.txt");
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nimport * as fs from "node:fs/promises";\nawait fs.appendFile(${JSON.stringify(pidPath)}, String(process.pid) + "\\n");\nprocess.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] }) + "\\n");\nprocess.stdin.resume();\n`,
		);
		await fs.chmod(binaryPath, 0o755);

		const sidecar = new SidecarManager({
			binaryPath,
			cwd: tempDir,
			proxyEnv: async () => {
				await delay(200);
				return {};
			},
		});
		const readPids = async (): Promise<string[]> => {
			try {
				return (await fs.readFile(pidPath, "utf8")).trim().split("\n").filter(Boolean);
			} catch {
				return [];
			}
		};
		try {
			sidecar.start();
			// Inside the first env window: restart() has no child to kill yet, so
			// without the guard both pending resolutions would spawn.
			await delay(50);
			sidecar.restart();
			await expect.poll(readPids, { timeout: 9_000, interval: 50 }).toHaveLength(1);
			// Both resolutions are 50ms apart, so a superseded spawn that was going
			// to happen has long since written its pid by now.
			await delay(1_000);
			expect(await readPids()).toHaveLength(1);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	}, 15_000);

	it("surfaces a reinstall instruction, not a build instruction, when the packaged binary is missing", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-nobin-packaged-"));
		const statuses: SidecarStatusPayload[] = [];
		const sidecar = new SidecarManager({ binaryPath: "", cwd: tempDir, packaged: true });
		sidecar.on("status", payload => statuses.push(payload));
		try {
			sidecar.start();
			expect(statuses[0]).toMatchObject({ status: "error" });
			expect(statuses[0].message).toContain("Reinstall");
			// A packaged user has no source checkout — sending them to build:omp
			// is an instruction they cannot follow.
			expect(statuses[0].message).not.toContain("build:omp");
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("keeps the build instruction for a dev tree with no sidecar binary", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-nobin-dev-"));
		const statuses: SidecarStatusPayload[] = [];
		const sidecar = new SidecarManager({ binaryPath: "", cwd: tempDir });
		sidecar.on("status", payload => statuses.push(payload));
		try {
			sidecar.start();
			expect(statuses[0]).toMatchObject({ status: "error" });
			expect(statuses[0].message).toContain("build:omp");
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("names the missing packaged binary by path", () => {
		expect(missingSidecarMessage(true, "/Applications/omp.app/Contents/Resources")).toContain(
			path.join("/Applications/omp.app/Contents/Resources", "omp"),
		);
	});

	it("carries the crashed spawn's stderr into the restart reason and the crash report", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-stderr-"));
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nprocess.stderr.write("dyld: Library not loaded: pi_natives\\n  Referenced by: omp\\n");\nsetTimeout(() => process.exit(4), 120);\n`,
		);
		await fs.chmod(binaryPath, 0o755);

		const reportFailure = vi.fn();
		const statuses: SidecarStatusPayload[] = [];
		const sidecar = new SidecarManager({ binaryPath, cwd: tempDir, reportFailure });
		sidecar.on("status", payload => statuses.push(payload));
		try {
			sidecar.start();
			await expect
				.poll(() => statuses.some(payload => payload.status === "restarting"), { timeout: 9_000, interval: 50 })
				.toBe(true);

			const reason = statuses[statuses.length - 1].message ?? "";
			expect(reason).toContain("Exit code 4");
			expect(reason).toContain("dyld: Library not loaded: pi_natives");
			// Stack-ish continuation lines stay out of the one-line reason.
			expect(reason).not.toContain("Referenced by");

			const report = reportFailure.mock.calls[0]?.[0] as SidecarFailureReport;
			expect(report).toMatchObject({ attempt: 1, maxAttempts: 3, cwd: tempDir });
			expect(report.stderr).toEqual(["dyld: Library not loaded: pi_natives", "  Referenced by: omp"]);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	}, 15_000);
});
