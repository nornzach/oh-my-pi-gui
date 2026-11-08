import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
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

test("the server is told this process owns it, which is how it exits after a force-kill", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-stats-owner-"));
	const binary = path.join(directory, "stats-owner.ts");
	// The sidecar reads this variable, so the name and value are a contract with it.
	await fs.writeFile(
		binary,
		`#!/usr/bin/env bun
const named = Number(process.env.PI_STATS_OWNER_PID) === process.ppid;
process.stdout.write("Dashboard available at: http://127.0.0.1:" + (named ? 55124 : 55125) + "\\n");
await Bun.sleep(5000);
`,
	);
	await fs.chmod(binary, 0o755);
	const server = new StatsServerManager(binary);
	try {
		server.start();
		await expect.poll(() => server.port, { timeout: 5000 }).toBe(55124);
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

test("fetch sends POST for /api/sync, which 405s a plain GET", async () => {
	const methods: string[] = [];
	const server = http.createServer((req, res) => {
		methods.push(`${req.method} ${req.url}`);
		if (req.url === "/api/sync" && req.method !== "POST") {
			res.writeHead(405).end(JSON.stringify({ error: "POST required" }));
			return;
		}
		res.writeHead(200, { "content-type": "application/json" }).end("{}");
	});
	const listening = Promise.withResolvers<void>();
	server.listen(0, "127.0.0.1", () => listening.resolve());
	await listening.promise;
	try {
		const client = new StatsClient((server.address() as AddressInfo).port);
		await expect(client.fetch("/api/sync")).resolves.toEqual({});
		await client.fetch("/api/stats/models");
		expect(methods).toEqual(["POST /api/sync", "GET /api/stats/models"]);
	} finally {
		server.close();
	}
});
