import { type ChildProcess, spawn } from "node:child_process";
import type { IpcBenchmarkRunOptions, IpcBenchmarkRunResult, IpcBenchmarkSummary } from "../shared/ipc-types";

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const BENCHMARK_TIMEOUT_MS = 15 * 60 * 1000;

function boundedInteger(name: string, value: number, min: number, max: number): number {
	if (!Number.isSafeInteger(value) || value < min || value > max) {
		throw new Error(`${name} must be between ${min} and ${max}`);
	}
	return value;
}

export function benchmarkArgs(options: IpcBenchmarkRunOptions): string[] {
	if (options.models.length < 1 || options.models.length > 8) throw new Error("Select between 1 and 8 models");
	if (!(["mix", "chat", "prefill", "generation"] as const).includes(options.profile)) {
		throw new Error("Invalid benchmark profile");
	}
	const models = [
		...new Set(
			options.models.map(model => {
				const value = model.trim();
				if (!value || value.length > 200 || value.startsWith("-")) throw new Error("Invalid model selector");
				return value;
			}),
		),
	];
	const args = [
		"bench",
		...models,
		"--profile",
		options.profile,
		"--runs",
		String(boundedInteger("runs", options.runs, 1, 20)),
		"--par",
		String(boundedInteger("parallel", options.parallel, 1, 8)),
		"--json",
	];
	if (options.maxTokens !== undefined) {
		args.push("--max-tokens", String(boundedInteger("maxTokens", options.maxTokens, 1, 8192)));
	}
	return args;
}

export function parseBenchmarkSummary(stdout: string): IpcBenchmarkSummary {
	const value = JSON.parse(stdout) as Partial<IpcBenchmarkSummary>;
	if (!Number.isSafeInteger(value.runs) || !Array.isArray(value.models) || typeof value.failures !== "number") {
		throw new Error("Benchmark returned malformed JSON");
	}
	return value as IpcBenchmarkSummary;
}

export class BenchmarkRunner {
	#child: ChildProcess | null = null;
	#terminationReason: string | null = null;

	get running(): boolean {
		return this.#child !== null;
	}

	abort(): boolean {
		return this.#terminate("Benchmark cancelled");
	}

	#terminate(reason: string): boolean {
		const child = this.#child;
		if (!child) return false;
		this.#terminationReason = reason;
		child.kill("SIGTERM");
		const killTimer = setTimeout(() => {
			if (this.#child === child) child.kill("SIGKILL");
		}, 2_000);
		killTimer.unref();
		return true;
	}

	async run(
		binaryPath: string,
		cwd: string,
		options: IpcBenchmarkRunOptions,
		env: NodeJS.ProcessEnv,
	): Promise<IpcBenchmarkRunResult> {
		if (this.#child) return { success: false, error: "A benchmark is already running" };
		let args: string[];
		try {
			args = benchmarkArgs(options);
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : String(error) };
		}
		this.#terminationReason = null;
		const child = spawn(binaryPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
		this.#child = child;
		let stdout = "";
		let stderr = "";
		let outputBytes = 0;
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const { promise, resolve } = Promise.withResolvers<IpcBenchmarkRunResult>();
		const finish = (result: IpcBenchmarkRunResult) => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			this.#child = null;
			resolve(result);
		};
		const append = (target: "stdout" | "stderr", chunk: Buffer) => {
			outputBytes += chunk.byteLength;
			if (outputBytes > MAX_OUTPUT_BYTES) {
				this.#terminate("Benchmark output exceeded 8 MiB");
				return;
			}
			if (target === "stdout") stdout += chunk.toString("utf8");
			else stderr += chunk.toString("utf8");
		};
		child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
		child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
		child.once("error", error => finish({ success: false, error: error.message, stderr: stderr || undefined }));
		child.once("close", exitCode => {
			if (this.#terminationReason) {
				finish({ success: false, error: this.#terminationReason, stderr: stderr || undefined });
				return;
			}
			try {
				finish({
					success: true,
					summary: parseBenchmarkSummary(stdout),
					exitCode,
					stderr: stderr.trim() || undefined,
				});
			} catch (error) {
				finish({
					success: false,
					error: error instanceof Error ? error.message : String(error),
					stderr: stderr.trim() || undefined,
				});
			}
		});
		timeout = setTimeout(() => {
			this.#terminate("Benchmark timed out after 15 minutes");
		}, BENCHMARK_TIMEOUT_MS);
		timeout.unref();
		return promise;
	}
}
