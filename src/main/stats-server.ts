/**
 * The GUI's built-in stats dashboard server, spawned from the SAME bundled
 * omp binary as the agent sidecar (`omp stats --no-open`).
 *
 * Internal to the GUI's closed loop: spawned on app start, killed on quit,
 * localhost-only. No external `omp stats` process is required and none is
 * consulted — if an external process already owns the port, this reports the
 * conflict rather than silently using it.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { stripVTControlCharacters } from "node:util";
import { MAX_RESTART_ATTEMPTS, RestartBudget, type Revive } from "./stats-restart-policy";

// Bind a private ephemeral port; separate GUI instances must not share an index or listener.
const DEFAULT_PORT = 0;

export class StatsServerManager extends EventEmitter {
	#child: ChildProcess | null = null;
	#budget = new RestartBudget();
	#restartTimer: NodeJS.Timeout | null = null;
	#disposed = false;
	#port = DEFAULT_PORT;
	readonly #binaryPath: string;

	constructor(binaryPath: string) {
		super();
		this.#binaryPath = binaryPath;
	}

	get port(): number {
		return this.#port;
	}

	start(): void {
		if (this.#disposed) return;
		this.#spawn();
	}

	/**
	 * Bring the server up because something now wants to read it. Without this,
	 * a manager that spent its restart budget stays at port 0 for the rest of the
	 * session and every dashboard read answers "not ready" forever.
	 */
	ensureRunning(): Revive {
		if (this.#disposed) return "exhausted";
		if (this.#child || this.#restartTimer) return "already-pending";
		const verdict = this.#budget.revive(Date.now());
		if (verdict === "scheduled") this.#spawn();
		return verdict;
	}

	#spawn(): void {
		// The bundled omp registers this flag as --no-open (kebab-case, per
		// `omp stats --help`), not the camelCase --noOpen the oclif property
		// name suggests — the latter is rejected as an unknown option.
		const args = ["stats", "--host", "127.0.0.1", "--port", String(DEFAULT_PORT), "--no-open"];
		console.log(`[stats-server] spawning: ${this.#binaryPath} ${args.join(" ")}`);
		let child: ChildProcess;
		try {
			child = spawn(this.#binaryPath, args, {
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, PI_NOTIFICATIONS: "off" },
			});
		} catch (err) {
			// spawn() throws synchronously (e.g. EBADF/ENOENT) — treat like a
			// failed child so it retries gracefully instead of crashing the main
			// process with an uncaught-exception dialog.
			this.#attemptRestart(err instanceof Error ? err.message : String(err));
			return;
		}
		this.#child = child;

		let stdout = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout = (stdout + chunk.toString("utf-8")).slice(-4096);
			const text = stripVTControlCharacters(stdout);
			const match = /http:\/\/(?:localhost|127\.0\.0\.1):([0-9]+)(?=[\s/])/.exec(text);
			if (match && Number(match[1]) > 0) {
				this.#port = Number(match[1]);
				this.#budget.noteReady();
				console.log(`[stats-server] ready on http://localhost:${this.#port}`);
				this.emit("ready", this.#port);
				stdout = "";
			}
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf-8").trim();
			if (text) console.error(`[stats-server stderr] ${text}`);
		});
		child.on("exit", (code, signal) => {
			if (this.#child !== child) return;
			this.#child = null;
			if (this.#disposed) return;
			if (code === 0) {
				this.emit("exit", code);
				return;
			}
			this.#attemptRestart(`exit code ${code}${signal ? ` (${signal})` : ""}`);
		});
		child.on("error", err => {
			if (this.#child !== child) return;
			this.#child = null;
			if (this.#disposed) return;
			this.#attemptRestart(err.message);
		});
	}

	#attemptRestart(reason: string): void {
		this.#port = 0;
		this.emit("exit", null);
		const delay = this.#budget.nextDelay();
		if (delay === null) {
			console.error(`[stats-server] failed after ${MAX_RESTART_ATTEMPTS} attempts: ${reason}`);
			return;
		}
		console.warn(`[stats-server] restart in ${delay}ms: ${reason}`);
		this.#restartTimer = setTimeout(() => {
			this.#restartTimer = null;
			if (!this.#disposed) this.#spawn();
		}, delay);
	}

	kill(): void {
		this.#disposed = true;
		if (this.#restartTimer) {
			clearTimeout(this.#restartTimer);
			this.#restartTimer = null;
		}
		const child = this.#child;
		this.#child = null;
		child?.kill("SIGTERM");
	}
}
