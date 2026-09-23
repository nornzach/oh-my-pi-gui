import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { StatsClient } from "./stats-client";
import { StatsServerManager } from "./stats-server";

afterEach(() => vi.restoreAllMocks());

test("a live listener is never respawned by a demand-driven revive", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-stats-revive-"));
	const binary = path.join(directory, "stats-live.ts");
	await fs.writeFile(
		binary,
		`#!/usr/bin/env bun
process.stdout.write("Dashboard available at: http://127.0.0.1:55123\\n");
await Bun.sleep(5000);
`,
	);
	await fs.chmod(binary, 0o755);
	const server = new StatsServerManager(binary);
	try {
		server.start();
		await expect.poll(() => server.port, { timeout: 5000 }).toBe(55123);
		// Every open dashboard polls; a revive that ignored the live child would
		// stack listeners and hand the client a port nobody owns after the first exit.
		expect(server.ensureRunning()).toBe("already-pending");
		expect(server.port).toBe(55123);
	} finally {
		server.kill();
		await fs.rm(directory, { recursive: true, force: true });
	}
});

test("stats does not contact an unrelated default server before its own listener is ready", async () => {
	const fetch = vi.spyOn(globalThis, "fetch");
	const client = new StatsClient();
	expect(await client.probe()).toBe(false);
	await expect(client.fetch("/api/stats/requests")).rejects.toThrow("not ready");
	expect(fetch).not.toHaveBeenCalled();
});

test("split numeric loopback readiness selects the bundled listener and resets after exit", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-stats-ready-"));
	const binary = path.join(directory, "stats.ts");
	await fs.writeFile(
		binary,
		`#!/usr/bin/env bun
process.stdout.write("\\x1b[32mDashboard available at: http://127.0.0.1:54");
await Bun.sleep(30);
process.stdout.write("321\\x1b[39m\\n");
await Bun.sleep(100);
process.exit(1);
`,
	);
	await fs.chmod(binary, 0o755);
	const server = new StatsServerManager(binary);
	const ports: number[] = [];
	const exits: number[] = [];
	server.on("ready", port => ports.push(port));
	server.on("exit", () => exits.push(server.port));
	try {
		server.start();
		await expect.poll(() => ports, { timeout: 5000 }).toEqual([54321]);
		await expect.poll(() => exits, { timeout: 5000 }).toEqual([0]);
	} finally {
		server.kill();
		await fs.rm(directory, { recursive: true, force: true });
	}
});
