import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Store from "electron-store";
import { describe, expect, it, vi } from "vitest";
import type {
	CommandOutputFrame,
	PromptResultFrame,
	SessionSettledFrame,
	SidecarStatus,
	SidecarStatusPayload,
} from "../shared/rpc-types";
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

/**
 * A fake omp that logs each spawn's argv and every command, raises one
 * extension prompt at boot, and answers `switch_session` per `onSwitch`:
 * "ok", "cancel", or "model" (the saved model is gone until the switch names
 * one explicitly). `bootMs` delays its ready frame.
 */
async function writeSwitchingSidecar(dir: string, onSwitch: "ok" | "cancel" | "model", bootMs = 0) {
	const spawnLog = path.join(dir, "spawns.jsonl");
	const commandLog = path.join(dir, "commands.jsonl");
	const binaryPath = path.join(dir, "fake-sidecar.ts");
	await fs.writeFile(
		binaryPath,
		[
			"#!/usr/bin/env bun",
			'import * as fs from "node:fs";',
			'import { createInterface } from "node:readline";',
			`fs.appendFileSync(${JSON.stringify(spawnLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
			'const out = (frame: object) => process.stdout.write(JSON.stringify(frame) + "\\n");',
			`await Bun.sleep(${bootMs});`,
			'out({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] });',
			'out({ type: "extension_ui_request", id: "boot-prompt", method: "confirm", title: "Trust?", message: "ok?" });',
			'createInterface({ input: process.stdin }).on("line", line => {',
			`\tfs.appendFileSync(${JSON.stringify(commandLog)}, line + "\\n");`,
			"\tconst command = JSON.parse(line);",
			'\tconst reply = (fields: object) => out({ type: "response", id: command.id, command: command.type, ...fields });',
			'\tif (command.type === "get_state") return reply({ success: true, data: { model: { provider: "local", id: "default-model" } } });',
			'\tif (command.type !== "switch_session") return reply({ success: true, data: {} });',
			`\tconst mode = ${JSON.stringify(onSwitch)};`,
			'\tif (mode === "cancel") return reply({ success: true, data: { cancelled: true } });',
			'\tif (mode === "model" && !command.provider) return reply({ success: false, error: "Could not restore model gone/model-x" });',
			"\treply({ success: true, data: { cancelled: false } });",
			"});",
		].join("\n"),
	);
	await fs.chmod(binaryPath, 0o755);
	const readLines = async (file: string): Promise<unknown[]> => {
		try {
			return (await fs.readFile(file, "utf8"))
				.split("\n")
				.filter(Boolean)
				.map(line => JSON.parse(line) as unknown);
		} catch {
			return [];
		}
	};
	return {
		binaryPath,
		spawns: () => readLines(spawnLog),
		commands: async () => (await readLines(commandLog)) as Array<Record<string, unknown>>,
	};
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

	it("restarts fresh, without auto-resuming the folder's latest session, when asked", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-restart-fresh-"));
		const logPath = path.join(tempDir, "argv.json");
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
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

			// A tab restarted before its first message: its session has no file yet.
			const restarted = waitForReady(sidecar);
			sidecar.restart(undefined, undefined, { fresh: true });
			await restarted;

			const launch: unknown = JSON.parse(await fs.readFile(logPath, "utf8"));
			expect(launch).toEqual(["--mode", "rpc-ui", "--no-auto-resume"]);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("configures v2 sidecars with the GUI event filter", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-filter-"));
		const commandLog = path.join(tempDir, "commands.json");
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nimport * as fs from "node:fs";\nimport { createInterface } from "node:readline";\nconst commands: unknown[] = [];\nconst rl = createInterface({ input: process.stdin });\nprocess.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 2, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576, maxReassembledFrameBytes: 67108864 }) + "\\n");\nrl.on("line", line => {\n\tconst command = JSON.parse(line) as { id?: string; type: string; events?: string[] | null };\n\tcommands.push(command);\n\tfs.writeFileSync(${JSON.stringify(commandLog)}, JSON.stringify(commands));\n\tprocess.stdout.write(JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data: {} }) + "\\n");\n});\n`,
		);
		await fs.chmod(binaryPath, 0o755);

		const sidecar = new SidecarManager({ binaryPath, cwd: tempDir });
		try {
			const ready = waitForReady(sidecar);
			sidecar.start();
			await ready;
			await expect
				.poll(
					async () => {
						try {
							return JSON.parse(await fs.readFile(commandLog, "utf8")) as Array<{
								type: string;
								events?: string[] | null;
							}>;
						} catch {
							return [];
						}
					},
					{ timeout: 5_000, interval: 25 },
				)
				.toHaveLength(4);

			const commands = JSON.parse(await fs.readFile(commandLog, "utf8")) as Array<{
				type: string;
				events?: string[] | null;
				messageUpdates?: string;
			}>;
			expect(commands.map(command => command.type)).toEqual([
				"negotiate_protocol",
				"set_event_filter",
				"set_ask_dialog",
				"terminal_configure",
			]);
			expect(commands[1]?.events).toContain("message_update");
			// Without `form`, the agent's questions fall back to one dialog per field.
			expect(commands[2]).toMatchObject({ enabled: true, form: true });
			// Full snapshots per token stall the main process (gui#19).
			expect(commands[1]?.messageUpdates).toBe("delta");
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

	it("routes prompt results, settled state, and text-mode command output as dedicated frames", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-output-"));
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nprocess.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] }) + "\\n");\nprocess.stdout.write(JSON.stringify({ type: "prompt_result", id: "local-command", agentInvoked: false }) + "\\n");\nprocess.stdout.write(JSON.stringify({ type: "session_settled" }) + "\\n");\nprocess.stdout.write(JSON.stringify({ type: "command_output", text: "Enabled models" }) + "\\n");\nprocess.stdin.resume();\n`,
		);
		await fs.chmod(binaryPath, 0o755);

		const sidecar = new SidecarManager({ binaryPath, cwd: tempDir });
		const received = Promise.withResolvers<CommandOutputFrame>();
		sidecar.once("commandOutput", frame => received.resolve(frame as CommandOutputFrame));
		const promptResult = Promise.withResolvers<PromptResultFrame>();
		sidecar.once("promptResult", frame => promptResult.resolve(frame as PromptResultFrame));
		const settled = Promise.withResolvers<SessionSettledFrame>();
		sidecar.once("sessionSettled", frame => settled.resolve(frame as SessionSettledFrame));
		try {
			sidecar.start();
			expect(await Promise.all([promptResult.promise, settled.promise, received.promise])).toEqual([
				{ type: "prompt_result", id: "local-command", agentInvoked: false },
				{ type: "session_settled" },
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

	it("keeps proxies the agent can't use out of its process, whichever env layer they came from", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-proxy-"));
		const envPath = path.join(tempDir, "env.json");
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nawait Bun.write(${JSON.stringify(envPath)}, JSON.stringify(process.env));\nawait Bun.sleep(60_000);\n`,
		);
		await fs.chmod(binaryPath, 0o755);
		vi.stubEnv("HTTP_PROXY", "socks5://127.0.0.1:1085");

		const sidecar = new SidecarManager({
			binaryPath,
			cwd: tempDir,
			proxyEnv: async () => ({ HTTPS_PROXY: "http://127.0.0.1:7890", ALL_PROXY: "socks5h://127.0.0.1:1085" }),
			shellEnv: async () => ({ PI_PROXY_ANTHROPIC: "socks5://127.0.0.1:1085" }),
		});
		const readEnv = async (): Promise<Record<string, string> | null> => {
			try {
				return JSON.parse(await fs.readFile(envPath, "utf8"));
			} catch {
				return null;
			}
		};
		try {
			sidecar.start();
			await expect.poll(readEnv, { timeout: 9_000, interval: 50 }).not.toBeNull();
			const env = await readEnv();
			expect(env?.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
			expect(env?.HTTP_PROXY).toBeUndefined();
			expect(env?.ALL_PROXY).toBeUndefined();
			expect(env?.PI_PROXY_ANTHROPIC).toBeUndefined();
			expect(env?.PI_NOTIFICATIONS).toBe("off");
		} finally {
			vi.unstubAllEnvs();
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

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

	it("resumes on the default model when the saved session model cannot be restored at boot", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-model-"));
		const logPath = path.join(tempDir, "argv.json");
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		const sessionPath = path.join(tempDir, "session.jsonl");
		await fs.writeFile(
			binaryPath,
			[
				"#!/usr/bin/env bun",
				'import * as fs from "node:fs/promises";',
				"const argv = process.argv.slice(2);",
				'if (!argv.includes("--model")) {',
				'\tprocess.stderr.write("error: Could not restore model gone/model-x\\n      at createAgentSession (omp)\\n");',
				"\tprocess.exit(1);",
				"}",
				`await fs.writeFile(${JSON.stringify(logPath)}, JSON.stringify(argv));`,
				'process.stdout.write(JSON.stringify({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] }) + "\\n");',
				"process.stdin.resume();",
			].join("\n"),
		);
		await fs.chmod(binaryPath, 0o755);

		const reportFailure = vi.fn();
		const statuses: SidecarStatusPayload[] = [];
		const sidecar = new SidecarManager({ binaryPath, cwd: tempDir, reportFailure });
		sidecar.on("status", payload => statuses.push(payload));
		try {
			const firstReady = waitForReady(sidecar);
			sidecar.start();
			await firstReady;

			const restarted = waitForReady(sidecar);
			sidecar.restart(undefined, sessionPath);
			await restarted;

			const launch: unknown = JSON.parse(await fs.readFile(logPath, "utf8"));
			expect(launch).toEqual(["--mode", "rpc-ui", "--session", sessionPath, "--model", "@default"]);
			const ready = statuses.filter(payload => payload.status === "ready");
			expect(ready.at(-1)?.modelFallback).toBe("gone/model-x");
			// A recoverable boot failure is not a crash: no restart backoff, no crash report.
			expect(statuses.some(payload => payload.status === "restarting")).toBe(false);
			expect(reportFailure).not.toHaveBeenCalled();
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("falls back to the crash loop when the default-model respawn fails the same way", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-model-loop-"));
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nprocess.stderr.write("error: Could not restore model gone/model-x\\n");\nprocess.exit(1);\n`,
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
			expect(statuses.find(payload => payload.status === "restarting")?.message).toContain(
				"Could not restore model gone/model-x",
			);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	}, 15_000);

	it("carries the crashed spawn's stderr into the restart reason and the crash report", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-sidecar-stderr-"));
		const binaryPath = path.join(tempDir, "fake-sidecar.ts");
		await fs.writeFile(
			binaryPath,
			`#!/usr/bin/env bun\nprocess.stderr.write("\\x1b[31mdyld: Library not loaded: pi_natives\\x1b[39m\\n  Referenced by: omp\\n");\nsetTimeout(() => process.exit(4), 120);\n`,
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
			// The reason is shown as plain text; omp's color codes stay in the raw report.
			expect(reason).not.toContain("\x1b");

			const report = reportFailure.mock.calls[0]?.[0] as SidecarFailureReport;
			expect(report).toMatchObject({ attempt: 1, maxAttempts: 3, cwd: tempDir });
			expect(report.stderr).toEqual([
				"\x1b[31mdyld: Library not loaded: pi_natives\x1b[39m",
				"  Referenced by: omp",
			]);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	}, 15_000);
});

describe("SidecarManager warm spare", () => {
	it("switches the booted spare onto the session and replays the prompt it held, without respawning", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-spare-"));
		const fake = await writeSwitchingSidecar(tempDir, "ok");
		const sessionPath = path.join(tempDir, "session.jsonl");
		const sidecar = new SidecarManager({ binaryPath: fake.binaryPath, cwd: tempDir, fresh: true });
		const statuses: SidecarStatus[] = [];
		const prompts: string[] = [];
		sidecar.on("status", ({ status }: SidecarStatusPayload) => statuses.push(status));
		sidecar.on("extensionUi", (request: { id: string }) => prompts.push(request.id));
		try {
			const booted = waitForReady(sidecar);
			sidecar.prewarm();
			await booted;
			await delay(100);
			// No tab owns the spare yet: a prompt shown now would have no window.
			expect(prompts).toEqual([]);

			statuses.length = 0;
			const adopted = waitForReady(sidecar);
			sidecar.adopt(sessionPath);
			await adopted;

			expect(statuses).toEqual(["starting", "ready"]);
			expect(prompts).toEqual(["boot-prompt"]);
			expect(await fake.spawns()).toEqual([["--mode", "rpc-ui", "--no-auto-resume"]]);
			expect((await fake.commands()).map(command => command.type)).toEqual(["switch_session"]);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("binds the session once a spare adopted mid-boot is ready, without respawning", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-spare-boot-"));
		const fake = await writeSwitchingSidecar(tempDir, "ok", 400);
		const sessionPath = path.join(tempDir, "session.jsonl");
		const sidecar = new SidecarManager({ binaryPath: fake.binaryPath, cwd: tempDir, fresh: true });
		const statuses: SidecarStatus[] = [];
		const prompts: string[] = [];
		sidecar.on("status", ({ status }: SidecarStatusPayload) => statuses.push(status));
		sidecar.on("extensionUi", (request: { id: string }) => prompts.push(request.id));
		try {
			const ready = waitForReady(sidecar);
			sidecar.prewarm();
			sidecar.adopt(sessionPath);
			await ready;
			await delay(300);

			// The boot's own ready is not the tab's: the session is not open yet.
			expect(statuses.filter(status => status === "ready")).toHaveLength(1);
			expect(await fake.spawns()).toEqual([["--mode", "rpc-ui", "--no-auto-resume"]]);
			expect(await fake.commands()).toEqual([expect.objectContaining({ type: "switch_session", sessionPath })]);
			expect(prompts).toEqual(["boot-prompt"]);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("reopens on the spare's own model when the saved session model cannot be restored", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-spare-model-"));
		const fake = await writeSwitchingSidecar(tempDir, "model");
		const sessionPath = path.join(tempDir, "session.jsonl");
		const sidecar = new SidecarManager({ binaryPath: fake.binaryPath, cwd: tempDir, fresh: true });
		const statuses: SidecarStatusPayload[] = [];
		sidecar.on("status", (payload: SidecarStatusPayload) => statuses.push(payload));
		try {
			const booted = waitForReady(sidecar);
			sidecar.prewarm();
			await booted;
			const adopted = waitForReady(sidecar);
			sidecar.adopt(sessionPath);
			await adopted;

			// The renderer's "opened on the default model" notice keys off this.
			expect(statuses.at(-1)).toMatchObject({ status: "ready", modelFallback: "gone/model-x" });
			const switches = (await fake.commands()).filter(command => command.type === "switch_session");
			expect(switches.at(-1)).toMatchObject({ sessionPath, provider: "local", modelId: "default-model" });
			expect(await fake.spawns()).toHaveLength(1);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("falls back to a cold --session start when the agent declines the switch", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-spare-cancel-"));
		const fake = await writeSwitchingSidecar(tempDir, "cancel");
		const sessionPath = path.join(tempDir, "session.jsonl");
		const sidecar = new SidecarManager({ binaryPath: fake.binaryPath, cwd: tempDir, fresh: true });
		try {
			const booted = waitForReady(sidecar);
			sidecar.prewarm();
			await booted;
			const reopened = waitForReady(sidecar);
			sidecar.adopt(sessionPath);
			await reopened;

			expect(await fake.spawns()).toEqual([
				["--mode", "rpc-ui", "--no-auto-resume"],
				["--mode", "rpc-ui", "--session", sessionPath],
			]);
		} finally {
			sidecar.dispose();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
