/**
 * One scheduled run against a scripted sidecar: what an unattended run does
 * when the agent asks for approval, how its report, errors and time limit
 * become the run's outcome, and what happens to a worktree afterwards.
 */

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stripDenylistedFlags } from "../../shared/launch-profile";
import type { RpcCommand, RpcResponse } from "../../shared/rpc-types";
import type { TaskConfig } from "../../shared/scheduler-types";
import { RUN_DENIED_FLAGS, RUN_DENIED_FLAGS_WITH_VALUE } from "./policy";
import { executeRun, type RunInput, type RunResult, type RunSidecarSpec, renderRunPrompt } from "./runner";

type Handler = (cmd: RpcCommand) => unknown;

/** A sidecar whose RPC answers come from `handlers` and whose frames the test emits. */
class FakeSidecar extends EventEmitter {
	status: "asleep" | "ready" | "error" = "asleep";
	sent: object[] = [];
	commands: RpcCommand[] = [];
	fired: RpcCommand[] = [];
	restartedTo: string | null = null;
	disposed = false;
	promptId = "";
	/** Tool calls the agent made, as the session's stats report them. */
	toolCalls = 0;
	constructor(
		readonly spec: RunSidecarSpec,
		readonly handlers: Partial<Record<string, Handler>>,
		readonly onPrompt: (sidecar: FakeSidecar, message: string) => void,
	) {
		super();
	}
	rpcClient = {
		command: async (cmd: RpcCommand): Promise<RpcResponse> => {
			this.commands.push(cmd);
			const handler = this.handlers[cmd.type];
			if (!handler) return { type: "response", command: cmd.type, success: true, data: {} };
			try {
				const data = handler(cmd);
				if (cmd.type === "get_session_stats")
					return {
						type: "response",
						command: cmd.type,
						success: true,
						data: { ...(data as object), toolCalls: this.toolCalls },
					};
				return { type: "response", command: cmd.type, success: true, data };
			} catch (error) {
				return { type: "response", command: cmd.type, success: false, error: (error as Error).message };
			}
		},
		fire: (cmd: RpcCommand): string => {
			this.fired.push(cmd);
			const id = `fire-${this.fired.length}`;
			if (cmd.type === "prompt") {
				this.promptId = id;
				queueMicrotask(() => this.onPrompt(this, cmd.message));
			}
			return id;
		},
	};
	start() {
		this.status = "ready";
		queueMicrotask(() => this.emit("status", { status: "ready", cwd: this.spec.cwd }));
	}
	restart(cwd?: string) {
		this.restartedTo = cwd ?? null;
		this.start();
	}
	dispose() {
		this.disposed = true;
	}
	sendSideChannel(frame: object) {
		this.sent.push(frame);
	}
	finishPrompt(extra: Record<string, unknown> = {}) {
		this.emit("frame", {
			type: "prompt_result",
			id: this.promptId,
			agentInvoked: true,
			status: "completed",
			...extra,
		});
	}
	callTool(name: string, args: Record<string, unknown>, id = "tool-1") {
		this.toolCalls++;
		this.emit("hostToolCall", {
			type: "host_tool_call",
			id,
			toolCallId: `call-${id}`,
			toolName: name,
			arguments: args,
		});
	}
}

const config = (overrides: Partial<TaskConfig> = {}): TaskConfig => ({
	title: "Check CI",
	prompt: "Look at the CI dashboard.",
	cwd: "/work/repo",
	schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
	model: null,
	tools: "read_only",
	depth: { kind: "goal" },
	timeoutMs: 60_000,
	verify: null,
	notify: "on_change",
	...overrides,
});

const goodReport = { status: "done", summary: "All green.", findings: [], changes: [], next: "" };

const baseHandlers: Partial<Record<string, Handler>> = {
	get_state: () => ({ sessionFile: "/sessions/run.jsonl", model: { provider: "mock", id: "m1" } }),
	get_session_stats: () => ({
		tokens: { input: 1200, output: 300 },
		cost: 0.02,
		sessionId: "s",
		sessionFile: "/sessions/run.jsonl",
	}),
	get_last_assistant_text: () => ({ text: "I looked around but did not report." }),
};

async function run(
	taskConfig: TaskConfig,
	onPrompt: (sidecar: FakeSidecar, message: string) => void,
	handlers: Partial<Record<string, Handler>> = {},
	signal = new AbortController().signal,
): Promise<{ result: RunResult; sidecar: FakeSidecar; spec: RunSidecarSpec }> {
	let created: FakeSidecar | null = null;
	const input: RunInput = {
		runId: "0000aaaabbbbcccc",
		config: taskConfig,
		previous: null,
		signal,
		onProgress: () => {},
	};
	const result = await executeRun(input, {
		createSidecar: spec => {
			created = new FakeSidecar(spec, { ...baseHandlers, ...handlers }, onPrompt);
			return created;
		},
		now: () => Date.now(),
		cwdExists: async path => path !== "/gone",
	});
	const sidecar = created as unknown as FakeSidecar;
	return { result, sidecar, spec: sidecar?.spec };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("unattended prompts", () => {
	it("denies approval prompts, records what was refused, and cancels every other question", async () => {
		const { result, sidecar } = await run(
			config({ tools: "workspace" }),
			fake => {
				fake.emit("extensionUi", {
					type: "extension_ui_request",
					id: "ui-1",
					method: "select",
					title: "Allow tool: bash\nrm -rf build\ncwd: /work",
					options: ["Approve", "Approve bash for this session", "Deny"],
				});
				fake.emit("extensionUi", {
					type: "extension_ui_request",
					id: "ui-2",
					method: "input",
					title: "Branch name?",
				});
				fake.emit("extensionUi", { type: "extension_ui_request", id: "ui-3", method: "notify", message: "fyi" });
				fake.emit("extensionUi", {
					type: "extension_ui_request",
					id: "ui-4",
					method: "select",
					title: 'Allow tool: task_report\n{"status":"blocked"}',
					options: ["Approve", "Deny"],
				});
				fake.callTool("task_report", { ...goodReport, status: "blocked", summary: "Could not clean the build." });
				fake.finishPrompt();
			},
			{
				worktree_create: () => ({
					path: "/wt/run",
					branch: "omp/gui/task-check-ci-bbbbcccc",
					baseCwd: "/work/repo",
				}),
				get_git_changes: () => ({ isRepo: true, files: [] }),
				bash: () => ({ output: "", exitCode: 0 }),
			},
		);

		expect(sidecar.sent).toContainEqual({ type: "extension_ui_response", id: "ui-1", value: "Deny" });
		expect(sidecar.sent).toContainEqual({ type: "extension_ui_response", id: "ui-2", cancelled: true });
		expect(sidecar.sent.some(frame => (frame as { id?: string }).id === "ui-3")).toBe(false);
		// omp gates host tools as exec; the run's own report must still get through.
		expect(sidecar.sent).toContainEqual({ type: "extension_ui_response", id: "ui-4", value: "Approve" });
		expect(result.blocked).toEqual([{ tool: "bash", target: "rm -rf build" }]);
		expect(result.report?.status).toBe("blocked");
		expect(result.state).toBe("succeeded");
	});
});

describe("reports", () => {
	it("records a valid report and answers an invalid one with an error the agent can fix", async () => {
		const { result, sidecar } = await run(config(), fake => {
			fake.callTool("task_report", { status: "great", summary: "" }, "bad");
			fake.callTool(
				"task_report",
				{ ...goodReport, findings: [{ title: "Flaky test", detail: "", severity: "warn" }] },
				"good",
			);
			fake.finishPrompt();
		});
		const replies = sidecar.sent.filter(frame => (frame as { type: string }).type === "host_tool_result") as {
			id: string;
			isError?: boolean;
			result: { content: { text: string }[] };
		}[];
		expect(replies.find(reply => reply.id === "bad")?.isError).toBe(true);
		expect(replies.find(reply => reply.id === "good")?.isError).toBeUndefined();
		expect(Array.isArray(replies[0].result.content)).toBe(true);
		expect(result.report).toEqual({
			status: "done",
			summary: "All green.",
			findings: [{ title: "Flaky test", detail: undefined, severity: "warn" }],
			changes: [],
			next: undefined,
		});
		expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 300, costUsd: 0.02, turns: 0 });
		expect(result.sessionPath).toBe("/sessions/run.jsonl");
	});

	it("turns a run that never reported into a partial report from its last message", async () => {
		const { result } = await run(config(), fake => fake.finishPrompt());
		expect(result.state).toBe("succeeded");
		expect(result.report).toMatchObject({ status: "partial", summary: "I looked around but did not report." });
	});
});

describe("run outcomes", () => {
	it("aborts the agent and ends as timed out at the time limit", async () => {
		vi.useFakeTimers();
		const pending = run(config({ timeoutMs: 60_000 }), () => {});
		await vi.advanceTimersByTimeAsync(60_000);
		await vi.advanceTimersByTimeAsync(10_000);
		const { result, sidecar } = await pending;
		expect(sidecar.fired.map(cmd => cmd.type)).toContain("abort");
		expect(result.state).toBe("timed_out");
		expect(sidecar.disposed).toBe(true);
	});

	it("classifies provider errors so only transient ones are retried", async () => {
		const rateLimited = await run(config(), fake =>
			fake.finishPrompt({
				status: "error",
				error: { message: "Too many requests", httpStatus: 429, retryable: true },
			}),
		);
		expect(rateLimited.result).toMatchObject({ state: "failed", error: { kind: "transient" } });
		const signedOut = await run(config(), fake =>
			fake.finishPrompt({
				status: "error",
				error: { message: "Request failed", httpStatus: 401, retryable: false },
			}),
		);
		expect(signedOut.result.error?.kind).toBe("auth");
	});

	it("treats a command line omp rejects as a setup problem, and other early exits as transient", async () => {
		const boot = async (status: "restarting" | "error", message: string) => {
			let sidecar: FakeSidecar | null = null;
			const result = await executeRun(
				{
					runId: "0000aaaabbbbcccc",
					config: config(),
					previous: null,
					signal: new AbortController().signal,
					onProgress: () => {},
				},
				{
					createSidecar: spec => {
						sidecar = new FakeSidecar(spec, baseHandlers, () => {});
						sidecar.start = () =>
							queueMicrotask(() => sidecar?.emit("status", { status, message, cwd: spec.cwd }));
						return sidecar;
					},
					now: () => Date.now(),
					cwdExists: async () => true,
				},
			);
			return { result, sidecar: sidecar as unknown as FakeSidecar };
		};
		const rejected = await boot(
			"restarting",
			"Exit code 2 — Error: Built-in tool unavailable in this session: find.",
		);
		expect(rejected.result).toMatchObject({ state: "blocked_config", error: { kind: "config" } });
		expect(rejected.sidecar.disposed).toBe(true);
		const crashed = await boot("error", "Exit code 1 — dyld: Library not loaded");
		expect(crashed.result).toMatchObject({ state: "failed", error: { kind: "transient" } });
	});

	it("stops before spawning when the folder is gone, and before prompting without a model", async () => {
		const gone = await run(config({ cwd: "/gone" }), () => {});
		expect(gone.result.state).toBe("blocked_config");
		expect(gone.sidecar).toBeNull();
		const noModel = await run(config(), () => {}, { get_state: () => ({ sessionFile: null, model: null }) });
		expect(noModel.result).toMatchObject({ state: "blocked_config", error: { kind: "config" } });
		expect(noModel.sidecar.fired.some(cmd => cmd.type === "prompt")).toBe(false);
	});
});

/** One round of agent work: a tool it ran, then the report it filed for the round (if any). */
function round(fake: FakeSidecar, report: Record<string, unknown> | null, tool: string | null = "read") {
	if (tool) fake.toolCalls++;
	if (report) fake.callTool("task_report", { ...goodReport, ...report });
	fake.finishPrompt();
}

/** Long enough for later rounds to start: each needs MIN_ROUND_MS left. */
const TEN_MINUTES = 10 * 60_000;

describe("rounds", () => {
	it("goes on with a goal in the same session while the agent reports partial, and ends at done", async () => {
		const messages: string[] = [];
		const { result, sidecar } = await run(
			config({ depth: { kind: "goal" }, timeoutMs: TEN_MINUTES }),
			(fake, message) => {
				messages.push(message);
				round(fake, messages.length === 1 ? { status: "partial", summary: "Half the docs." } : goodReport);
			},
		);
		expect(result).toMatchObject({ state: "succeeded", rounds: 2, report: { status: "done" } });
		expect(sidecar.fired.filter(cmd => cmd.type === "prompt")).toHaveLength(2);
		expect(messages[1]).toContain("Round 2");
		expect(messages[1]).toContain("not finished");
	});

	it("takes every research round even when the agent reports done early, each asking for more depth", async () => {
		const messages: string[] = [];
		const { result } = await run(
			config({ depth: { kind: "research", rounds: 3 }, timeoutMs: TEN_MINUTES }),
			(fake, message) => {
				messages.push(message);
				round(fake, goodReport);
			},
		);
		expect(result.rounds).toBe(3);
		expect(messages[0]).toContain("at least 3 rounds");
		expect(messages[2]).toContain("Go deeper");
	});

	it("stops a check after one round, and any run after a round that ran no tool", async () => {
		const check = await run(config({ depth: { kind: "check" }, timeoutMs: TEN_MINUTES }), fake =>
			round(fake, { status: "partial" }),
		);
		expect(check.result).toMatchObject({ rounds: 1, report: { status: "partial" } });
		const idle = await run(config({ depth: { kind: "goal" }, timeoutMs: TEN_MINUTES }), fake =>
			round(fake, { status: "partial" }, null),
		);
		expect(idle.result.rounds).toBe(1);
	});

	it("asks for the report a round skipped instead of ending without one", async () => {
		const messages: string[] = [];
		const { result } = await run(config({ depth: { kind: "check" }, timeoutMs: TEN_MINUTES }), (fake, message) => {
			messages.push(message);
			round(fake, messages.length === 1 ? null : goodReport);
		});
		expect(result).toMatchObject({ rounds: 2, report: { status: "done" } });
		expect(messages[1]).toContain("without calling `task_report`");
	});

	it("keeps the earlier report, marked partial, when a later round runs out of time", async () => {
		vi.useFakeTimers();
		let prompts = 0;
		const pending = run(config({ depth: { kind: "research", rounds: 3 }, timeoutMs: TEN_MINUTES }), fake => {
			prompts++;
			// The second round never finishes.
			if (prompts === 1) round(fake, { status: "done", summary: "Compared two of three tools." });
		});
		await vi.advanceTimersByTimeAsync(TEN_MINUTES);
		await vi.advanceTimersByTimeAsync(10_000);
		const { result, sidecar } = await pending;
		expect(sidecar.fired.map(cmd => cmd.type)).toContain("abort");
		expect(result).toMatchObject({
			state: "succeeded",
			rounds: 2,
			report: { status: "partial", summary: "Compared two of three tools." },
		});
	});
});

describe("worktree runs", () => {
	const bashLog: string[] = [];
	const worktreeHandlers = (files: string[], verifyExit?: number): Partial<Record<string, Handler>> => ({
		worktree_create: () => ({ path: "/wt/run", branch: "omp/gui/task-check-ci-bbbbcccc", baseCwd: "/work/repo" }),
		get_git_changes: () => ({ isRepo: true, files: files.map(path => ({ path, status: " M" })) }),
		bash: cmd => {
			const script = (cmd as { command: string }).command;
			bashLog.push(script);
			if (script.startsWith("git add")) return { output: "", exitCode: 0 };
			if (script.includes("worktree remove")) return { output: "", exitCode: 0 };
			return { output: `ran ${script}\nline 2`, exitCode: verifyExit };
		},
	});

	it("moves into a fresh worktree, verifies, and commits the changes for review", async () => {
		bashLog.length = 0;
		const { result, sidecar } = await run(
			config({ tools: "workspace", verify: { command: "bun test", timeoutMs: 5_000 } }),
			fake => {
				fake.callTool("task_report", { ...goodReport, changes: [{ path: "src/a.ts", note: "fix" }] });
				fake.finishPrompt();
			},
			worktreeHandlers(["src/a.ts"], 0),
		);
		expect(sidecar.restartedTo).toBe("/wt/run");
		expect(result.changedFiles).toEqual(["src/a.ts"]);
		expect(result.verification).toMatchObject({ state: "passed", exitCode: 0 });
		expect(bashLog[0]).toBe("bun test");
		expect(bashLog[1]).toMatch(/^git add -A && \(git commit -q -m 'omp task: Check CI \(run 0000aaaabbbbcccc\)'/);
		expect(result.worktree).toMatchObject({ path: "/wt/run", committed: true, removed: false });
	});

	it("removes a worktree and its branch when the run changed nothing", async () => {
		bashLog.length = 0;
		const { result } = await run(
			config({ tools: "full" }),
			fake => {
				fake.callTool("task_report", { ...goodReport, status: "nothing_to_report" });
				fake.finishPrompt();
			},
			worktreeHandlers([]),
		);
		expect(bashLog).toHaveLength(1);
		expect(bashLog[0]).toContain("worktree remove --force '/wt/run'");
		expect(bashLog[0]).toContain("branch -D 'omp/gui/task-check-ci-bbbbcccc'");
		expect(result.worktree?.removed).toBe(true);
	});

	it("maps verify exit codes: 1 is a failed check, anything else is a broken one", async () => {
		const failing = await run(
			config({ tools: "workspace", verify: { command: "bun test", timeoutMs: 5_000 } }),
			fake => fake.finishPrompt(),
			worktreeHandlers(["a"], 1),
		);
		expect(failing.result.verification.state).toBe("failed");
		const broken = await run(
			config({ tools: "workspace", verify: { command: "bun tset", timeoutMs: 5_000 } }),
			fake => fake.finishPrompt(),
			worktreeHandlers(["a"], 127),
		);
		expect(broken.result.verification).toMatchObject({
			state: "error",
			exitCode: 127,
			outputTail: "ran bun tset\nline 2",
		});
	});
});

describe("run policy flags", () => {
	it("spawns read-only runs with the read tool set and no-prompt approval mode", async () => {
		const { spec } = await run(config({ model: "anthropic/claude-x" }), fake => fake.finishPrompt());
		expect(spec.flags).toEqual([
			"--approval-mode",
			"always-ask",
			"--tools",
			"read,glob,grep,lsp,web_search,todo",
			"--model",
			"anthropic/claude-x",
		]);
	});

	it("keeps a launch profile from widening a run's policy", () => {
		const profile = [
			"--approval-mode",
			"yolo",
			"--tools=bash,edit",
			"--yolo",
			"--model",
			"big",
			"--provider",
			"work",
		];
		expect(
			stripDenylistedFlags(profile, { names: RUN_DENIED_FLAGS, withValue: RUN_DENIED_FLAGS_WITH_VALUE }),
		).toEqual(["--provider", "work"]);
		// A tab keeps its profile's tool list.
		expect(stripDenylistedFlags(["--tools", "read"])).toEqual(["--tools", "read"]);
	});
});

describe("run prompt", () => {
	it("tells the run what the last one found and why it was rejected", () => {
		const text = renderRunPrompt(
			config({ tools: "workspace" }),
			{
				summary: "Fixed the flaky test.",
				next: "Check the nightly job.",
				rejectionNote: "Do not touch the lockfile.",
			},
			{ branch: "omp/gui/task-x" },
		);
		expect(text).toContain("Look at the CI dashboard.");
		expect(text).toContain("branch `omp/gui/task-x`");
		expect(text).toContain("Fixed the flaky test.");
		expect(text).toContain("Check the nightly job.");
		expect(text).toContain("Do not touch the lockfile.");
		expect(text).not.toContain("read-only");
		const first = renderRunPrompt(config(), null, null);
		expect(first).toContain("This run is read-only");
		expect(first).not.toContain("Last run");
		expect(first).not.toMatch(/\{\{/);
	});
});
