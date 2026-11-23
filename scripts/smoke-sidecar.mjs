// Verify RPC liveness after model discovery and a settings round-trip.
// Pass the packaged sidecar path, or omit it to probe the adjacent Core source.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// `URL.pathname` keeps a leading slash on Windows (`/E:/…`), which `spawn`
// rejects as a missing cwd — the probe would ENOENT on a healthy binary.
const CLI = fileURLToPath(new URL("../../coding-agent/src/cli.ts", import.meta.url));
const CWD = fileURLToPath(new URL("../../../", import.meta.url));
const WEDGE_MS = 6000;
const HARD_TIMEOUT_MS = Number(process.env.OMP_SIDECAR_SMOKE_TIMEOUT_MS ?? 40_000);

// Optional: pass an executable to probe the bundled binary instead of source.
//   bun run packages/gui/scripts/smoke-sidecar.mjs
//   bun run packages/gui/scripts/smoke-sidecar.mjs packages/gui/resources/omp
const exe = process.argv[2];
const spawnCmd = exe ? resolve(exe) : "bun";
const spawnArgs = exe ? ["--mode", "rpc-ui"] : [CLI, "--mode", "rpc-ui"];
console.log(`probing: ${spawnCmd} ${spawnArgs.join(" ")}`);

const child = spawn(spawnCmd, spawnArgs, {
	cwd: CWD,
	stdio: ["pipe", "pipe", "pipe"],
	env: { ...process.env, PI_RPC_EMIT_TITLE: "1", PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});

const pending = new Map();
const results = [];
let readyDone = false;
let finished = false;
let seq = 0;

const send = (type, extra = {}) => {
	const id = `probe-${++seq}`;
	const t0 = Date.now();
	const p = new Promise(res => pending.set(id, { res, t0 }));
	child.stdin.write(`${JSON.stringify({ id, type, ...extra })}\n`);
	return p;
};

const rl = createInterface({ input: child.stdout });
rl.on("line", line => {
	let f;
	try {
		f = JSON.parse(line);
	} catch {
		return;
	}
	if (f.type === "response" && f.id && pending.has(f.id)) {
		const { res, t0 } = pending.get(f.id);
		pending.delete(f.id);
		results.push({ id: f.id, ok: f.success, ms: Date.now() - t0 });
		res(f);
	}
});
child.stderr.on("data", d => {
	const t = d.toString().trim();
	if (t) process.stderr.write(`[sidecar] ${t.slice(0, 200)}\n`);
});

const hardKill = setTimeout(() => {
	console.log(`HARD_TIMEOUT — sidecar wedged past ${HARD_TIMEOUT_MS}ms`);
	child.kill("SIGKILL");
}, HARD_TIMEOUT_MS);
child.on("exit", code => {
	if (finished) return;
	console.log(`SIDECAR_EXIT code=${code} readyDone=${readyDone} — aborting`);
	clearTimeout(hardKill);
	process.exit(code || 3);
});

(async () => {
	const ready = await new Promise(res => {
		const onLine = line => {
			try {
				const f = JSON.parse(line);
				if (f.type === "ready") {
					readyDone = true;
					rl.off("line", onLine);
					res(f);
				}
			} catch {}
		};
		rl.on("line", onLine);
	});
	console.log(`READY protocolVersion=${ready.protocolVersion}`);

	const negotiated = await send("negotiate_protocol", { protocolVersion: 2 });

	const boot = await send("get_state");
	console.log(`get_state[boot]         ${results.at(-1).ok ? "ok " : "ERR"} ${results.at(-1).ms}ms`);

	await send("get_available_models");
	const models = results.at(-1);
	console.log(`get_available_models    ${models.ok ? "ok " : "ERR"} ${models.ms}ms`);

	await send("get_state");
	const follow = results.at(-1);
	console.log(`get_state[after-models] ${follow.ok ? "ok " : "ERR"} ${follow.ms}ms`);

	await send("set_thinking_level", { level: "off" });
	const mutate = results.at(-1);
	console.log(`set_thinking_level      ${mutate.ok ? "ok " : "ERR"} ${mutate.ms}ms`);

	const settingsBefore = await send("get_settings", { paths: ["colorBlindMode"] });
	const originalColorBlindMode = settingsBefore.data?.values?.colorBlindMode;
	const settingsReadable = settingsBefore.success && typeof originalColorBlindMode === "boolean";
	console.log(`get_settings            ${settingsReadable ? "ok " : "ERR"} ${results.at(-1).ms}ms`);

	let settingsPersisted = false;
	if (settingsReadable) {
		const toggledColorBlindMode = !originalColorBlindMode;
		const toggle = await send("set_setting", { path: "colorBlindMode", value: toggledColorBlindMode });
		const settingsAfter = await send("get_settings", { paths: ["colorBlindMode"] });
		const roundTripMs = results.at(-2).ms + results.at(-1).ms;
		const restored = await send("set_setting", { path: "colorBlindMode", value: originalColorBlindMode });
		settingsPersisted =
			toggle.success && settingsAfter.success && settingsAfter.data?.values?.colorBlindMode === toggledColorBlindMode &&
			restored.success;
		console.log(`set_setting round-trip  ${settingsPersisted ? "ok " : "ERR"} ${roundTripMs}ms`);
	}

	const postDiscovery = [follow, mutate];
	const wedged = postDiscovery.some(r => r.ms > WEDGE_MS);
	const modelsReturned = models.ms <= WEDGE_MS;
	const commandsSucceeded = negotiated.success && boot.success && models.ok && postDiscovery.every(result => result.ok);
	const pass = commandsSucceeded && !wedged && modelsReturned && settingsPersisted;
	console.log(
		`\nVERDICT ${pass ? "PASS" : "FAIL"}  postDiscoveryMax=${Math.max(...postDiscovery.map(r => r.ms))}ms  models=${models.ms}ms  commands=${results.length}`,
	);
	if (!modelsReturned) console.log("FAIL get_available_models hung past the bound — discovery await not bounded");
	if (wedged) console.log("FAIL a post-discovery command wedged — serial queue still bricked");

	process.exitCode = pass ? 0 : 1;
	finished = true;
	clearTimeout(hardKill);
	child.kill("SIGTERM");
	setTimeout(() => child.kill("SIGKILL"), 1500);
})();
