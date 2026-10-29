/**
 * Executes one scheduled run on its own headless sidecar (plan/23 §3): spawn
 * with the task's policy flags, optionally move into a fresh worktree, prompt,
 * answer every prompt the agent raises with "no", collect the report, usage
 * and changes, verify, commit or clean the worktree, and exit. The sidecar
 * lives exactly as long as the run and never belongs to a window.
 */

import { APPROVAL_APPROVE, APPROVAL_DENY, isApprovalRequest, parseApprovalTitle } from "../../shared/approval-prompt";
import type { FlagDenylist } from "../../shared/launch-profile";
import {
	type AgentSessionEvent,
	BLOCKING_UI_METHODS,
	type ExtensionUIRequest,
	type HostToolCallRequest,
	type HostToolDefinition,
	type RpcCommand,
	type RpcGitChanges,
	type RpcResponse,
	type SessionStats,
	type SidecarStatus,
	type SidecarStatusPayload,
} from "../../shared/rpc-types";
import type {
	RunErrorKind,
	RunProgress,
	RunReport,
	RunUsage,
	RunVerification,
	RunWorktree,
	TaskConfig,
} from "../../shared/scheduler-types";
import {
	classifyRunError,
	MIN_ROUND_MS,
	type NextRound,
	nextRound,
	outputTail,
	policyUsesWorktree,
	RUN_DENIED_FLAGS,
	RUN_DENIED_FLAGS_WITH_VALUE,
	runPolicyFlags,
	shellQuote,
	startupFailure,
	worktreeNameFor,
} from "./policy";
import runTemplate from "./prompts/run.md?raw";
import runRoundTemplate from "./prompts/run-round.md?raw";
import taskReportDescription from "./prompts/task-report-tool.md?raw";
import { renderTemplate } from "./template";

const READY_TIMEOUT_MS = 90_000;
const COMMAND_TIMEOUT_MS = 30_000;
const ABORT_GRACE_MS = 10_000;
const PROGRESS_THROTTLE_MS = 500;

export const TASK_REPORT_TOOL = "task_report";

/** The slice of SidecarManager a run needs; tests drive a fake. */
export interface RunSidecar {
	readonly status: SidecarStatus;
	readonly rpcClient: {
		command(cmd: RpcCommand, timeoutMs?: number): Promise<RpcResponse>;
		fire(cmd: RpcCommand): string;
	} | null;
	start(): void;
	restart(cwd?: string): void;
	dispose(): void;
	sendSideChannel(frame: object): void;
	on<E extends keyof RunSidecarEvents>(event: E, listener: RunSidecarEvents[E]): unknown;
	off<E extends keyof RunSidecarEvents>(event: E, listener: RunSidecarEvents[E]): unknown;
}

/** The SidecarManager events a run listens to. */
export interface RunSidecarEvents {
	status: (payload: SidecarStatusPayload) => void;
	events: (events: AgentSessionEvent[]) => void;
	extensionUi: (request: ExtensionUIRequest) => void;
	hostToolCall: (request: HostToolCallRequest) => void;
	frame: (frame: Record<string, unknown>) => void;
	sessionSettled: () => void;
}

export interface RunSidecarSpec {
	cwd: string;
	flags: string[];
	deny: FlagDenylist;
}

export interface RunnerDeps {
	createSidecar(spec: RunSidecarSpec): RunSidecar;
	now(): number;
	cwdExists(path: string): Promise<boolean>;
}

export interface RunInput {
	runId: string;
	config: TaskConfig;
	previous: { summary: string; next?: string; rejectionNote?: string } | null;
	signal: AbortSignal;
	onProgress(progress: RunProgress): void;
	/** The run's session file, as soon as the sidecar names it. */
	onSession?(sessionPath: string): void;
}

export type RunEndState = "succeeded" | "failed" | "cancelled" | "timed_out" | "blocked_config";

export interface RunResult {
	state: RunEndState;
	startedAt: number;
	endedAt: number;
	sessionPath?: string;
	model?: string;
	usage?: RunUsage;
	worktree?: RunWorktree;
	report?: RunReport;
	/** Rounds the run took; see TaskDepth. */
	rounds?: number;
	blocked: { tool: string; target?: string }[];
	changedFiles: string[];
	verification: RunVerification;
	error?: { message: string; kind: RunErrorKind };
}

export const TASK_REPORT_TOOL_DEFINITION: HostToolDefinition = {
	name: TASK_REPORT_TOOL,
	label: "Task report",
	description: taskReportDescription.trim(),
	loadMode: "essential",
	parameters: {
		type: "object",
		properties: {
			status: { type: "string", enum: ["done", "nothing_to_report", "blocked", "partial"] },
			summary: { type: "string" },
			findings: {
				type: "array",
				items: {
					type: "object",
					properties: {
						title: { type: "string" },
						detail: { type: "string" },
						severity: { type: "string", enum: ["info", "warn", "error"] },
					},
					required: ["title", "detail", "severity"],
					additionalProperties: false,
				},
			},
			changes: {
				type: "array",
				items: {
					type: "object",
					properties: { path: { type: "string" }, note: { type: "string" } },
					required: ["path", "note"],
					additionalProperties: false,
				},
			},
			next: { type: "string" },
		},
		required: ["status", "summary", "findings", "changes", "next"],
		additionalProperties: false,
	},
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Validate the agent's `task_report` arguments; null when the shape is wrong. */
export function parseTaskReport(args: Record<string, unknown>): RunReport | null {
	const status = args.status;
	if (status !== "done" && status !== "nothing_to_report" && status !== "blocked" && status !== "partial") return null;
	if (typeof args.summary !== "string" || args.summary.trim() === "") return null;
	const findings = Array.isArray(args.findings) ? args.findings : [];
	const changes = Array.isArray(args.changes) ? args.changes : [];
	return {
		status,
		summary: clip(args.summary.trim(), 4000),
		findings: findings.slice(0, 50).flatMap(item => {
			if (typeof item !== "object" || item === null) return [];
			const finding = item as Record<string, unknown>;
			if (typeof finding.title !== "string" || finding.title.trim() === "") return [];
			const severity =
				finding.severity === "info" || finding.severity === "warn" || finding.severity === "error"
					? finding.severity
					: undefined;
			const detail =
				typeof finding.detail === "string" && finding.detail.trim() ? clip(finding.detail.trim(), 2000) : undefined;
			return [{ title: clip(finding.title.trim(), 300), detail, severity }];
		}),
		changes: changes.slice(0, 200).flatMap(item => {
			if (typeof item !== "object" || item === null) return [];
			const change = item as Record<string, unknown>;
			if (typeof change.path !== "string" || change.path.trim() === "") return [];
			const note = typeof change.note === "string" && change.note.trim() ? clip(change.note.trim(), 500) : undefined;
			return [{ path: clip(change.path.trim(), 500), note }];
		}),
		next: typeof args.next === "string" && args.next.trim() ? clip(args.next.trim(), 1000) : undefined,
	};
}

export function renderRunPrompt(
	config: TaskConfig,
	previous: RunInput["previous"],
	worktree: { branch: string } | null,
): string {
	return renderTemplate(runTemplate, {
		title: config.title,
		prompt: config.prompt,
		readOnly: config.tools === "read_only",
		worktree: worktree !== null,
		branch: worktree?.branch,
		previousSummary: previous?.summary,
		previousNext: previous?.next,
		rejectionNote: previous?.rejectionNote,
		[config.depth.kind]: true,
		rounds: config.depth.kind === "research" ? String(config.depth.rounds) : undefined,
	});
}

/** The message that starts round `round` (from 2) of a run, and why it runs. */
export function renderRoundPrompt(config: TaskConfig, round: number, why: NextRound): string {
	const minRounds = config.depth.kind === "research" && round <= config.depth.rounds ? config.depth.rounds : null;
	return renderTemplate(runRoundTemplate, {
		round: String(round),
		[why]: true,
		minRounds: minRounds === null ? undefined : String(minRounds),
	});
}

/** Raised inside the run to end it with a given state; caught at the top. */
class RunStop extends Error {
	constructor(
		readonly state: RunEndState,
		message: string,
		readonly kind: RunErrorKind = "other",
	) {
		super(message);
	}
}

function waitForReady(sidecar: RunSidecar, signal: AbortSignal): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const timer = setTimeout(
		() => finish(new RunStop("failed", "The agent did not start in time", "transient")),
		READY_TIMEOUT_MS,
	);
	const onStatus = (payload: SidecarStatusPayload) => {
		if (payload.status === "ready") return finish();
		const message = payload.message ?? "The agent could not start";
		const failure = startupFailure(message);
		// A rejected command line fails every respawn too; stop at the first.
		if (payload.status === "error" || payload.status === "exited" || failure.kind === "config") {
			finish(new RunStop(failure.state, message, failure.kind));
		}
	};
	const onAbort = () => finish(new RunStop("cancelled", "Cancelled"));
	function finish(error?: Error) {
		clearTimeout(timer);
		sidecar.off("status", onStatus);
		signal.removeEventListener("abort", onAbort);
		if (error) reject(error);
		else resolve();
	}
	sidecar.on("status", onStatus);
	signal.addEventListener("abort", onAbort, { once: true });
	if (sidecar.status === "ready") finish();
	return promise;
}

async function command<T>(sidecar: RunSidecar, cmd: RpcCommand, timeoutMs = COMMAND_TIMEOUT_MS): Promise<T> {
	const client = sidecar.rpcClient;
	if (!client) throw new Error("The agent is not connected");
	const response = await client.command(cmd, timeoutMs);
	if (!response.success) throw new Error(response.error ?? `${cmd.type} failed`);
	return response.data as T;
}

interface BashOutcome {
	output: string;
	exitCode: number | undefined;
	timedOut: boolean;
}

async function bash(sidecar: RunSidecar, script: string, timeoutMs: number): Promise<BashOutcome> {
	const client = sidecar.rpcClient;
	if (!client) throw new Error("The agent is not connected");
	try {
		const data = await command<{ output?: string; exitCode?: number; timedOut?: boolean; cancelled?: boolean }>(
			sidecar,
			{ type: "bash", command: script, excluded: true },
			timeoutMs,
		);
		return { output: data.output ?? "", exitCode: data.exitCode, timedOut: data.timedOut === true };
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("RPC timeout")) {
			client.fire({ type: "abort_bash" });
			return { output: "", exitCode: undefined, timedOut: true };
		}
		throw error;
	}
}

type PromptEnd =
	| {
			kind: "result";
			status: "completed" | "aborted" | "error";
			error?: { message: string; httpStatus?: number; retryable?: boolean };
			settled: boolean;
	  }
	| { kind: "rejected"; message: string }
	| { kind: "local" };

export async function executeRun(input: RunInput, deps: RunnerDeps): Promise<RunResult> {
	const startedAt = deps.now();
	const { config } = input;
	const blocked: RunResult["blocked"] = [];
	let report: RunReport | undefined;
	/** The report filed in the round under way, if any. */
	let roundReport: RunReport | null = null;
	let turns = 0;
	let round = 1;
	/** `task_report` calls in the round under way, valid or not. */
	let reportCalls = 0;
	let lastTool: string | null = null;
	let progressTimer: NodeJS.Timeout | null = null;
	let sidecar: RunSidecar | null = null;
	let worktree: RunWorktree | undefined;
	let sessionPath: string | undefined;
	let model: string | undefined;
	let usage: RunUsage | undefined;
	let changedFiles: string[] = [];
	let verification: RunVerification = { state: "none" };

	const pushProgress = () => {
		if (progressTimer) return;
		progressTimer = setTimeout(() => {
			progressTimer = null;
			input.onProgress({ turns, lastTool, round });
		}, PROGRESS_THROTTLE_MS);
	};

	const onEvents = (events: AgentSessionEvent[]) => {
		for (const event of events) {
			if (event.type === "turn_end") turns++;
			else if (event.type === "tool_execution_start") lastTool = event.toolName;
		}
		pushProgress();
	};

	const onUi = (request: ExtensionUIRequest) => {
		const target = sidecar;
		if (!target) return;
		if (isApprovalRequest(request)) {
			const { toolName, body } = parseApprovalTitle(request.title);
			// The run's own report tool only records what the run found.
			if (toolName === TASK_REPORT_TOOL) {
				target.sendSideChannel({ type: "extension_ui_response", id: request.id, value: APPROVAL_APPROVE });
				return;
			}
			const firstLine = body.split("\n").find(line => line.trim() !== "");
			blocked.push({ tool: toolName || "tool", target: firstLine ? clip(firstLine.trim(), 200) : undefined });
			target.sendSideChannel({ type: "extension_ui_response", id: request.id, value: APPROVAL_DENY });
			return;
		}
		if (BLOCKING_UI_METHODS[request.method]) {
			target.sendSideChannel({ type: "extension_ui_response", id: request.id, cancelled: true });
		}
	};

	const onHostTool = (request: HostToolCallRequest) => {
		const target = sidecar;
		if (!target) return;
		const reply = (text: string, isError = false) =>
			target.sendSideChannel({
				type: "host_tool_result",
				id: request.id,
				result: { content: [{ type: "text", text }] },
				...(isError ? { isError: true } : {}),
			});
		if (request.toolName !== TASK_REPORT_TOOL) {
			reply(`Unknown tool: ${request.toolName}`, true);
			return;
		}
		reportCalls++;
		const parsed = parseTaskReport(request.arguments);
		if (!parsed) {
			reply(
				"Invalid report: status must be one of done, nothing_to_report, blocked, partial, and summary must not be empty.",
				true,
			);
			return;
		}
		report = parsed;
		roundReport = parsed;
		reply("Report recorded. End your turn here.");
	};

	const finish = (state: RunEndState, error?: RunResult["error"]): RunResult => ({
		state,
		startedAt,
		endedAt: deps.now(),
		sessionPath,
		model,
		usage,
		worktree,
		report,
		rounds: round,
		blocked,
		changedFiles,
		verification,
		error,
	});

	try {
		if (!(await deps.cwdExists(config.cwd))) {
			throw new RunStop("blocked_config", `The workspace folder no longer exists: ${config.cwd}`, "config");
		}
		sidecar = deps.createSidecar({
			cwd: config.cwd,
			flags: runPolicyFlags(config.tools, config.model),
			deny: { names: RUN_DENIED_FLAGS, withValue: RUN_DENIED_FLAGS_WITH_VALUE },
		});
		sidecar.on("events", onEvents);
		sidecar.on("extensionUi", onUi);
		sidecar.on("hostToolCall", onHostTool);
		sidecar.start();
		await waitForReady(sidecar, input.signal);

		if (policyUsesWorktree(config.tools)) {
			let created: { path: string; branch: string; baseCwd: string };
			try {
				created = await command(sidecar, {
					type: "worktree_create",
					name: worktreeNameFor(config.title, input.runId),
					baseCwd: config.cwd,
					baseRef: "HEAD",
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new RunStop("blocked_config", `Could not create a worktree: ${message}`, "config");
			}
			worktree = { ...created, removed: false, committed: false };
			sidecar.restart(created.path);
			await waitForReady(sidecar, input.signal);
		}

		await command(sidecar, { type: "set_host_tools", tools: [TASK_REPORT_TOOL_DEFINITION] });
		const state = await command<{ sessionFile?: string | null; model?: { provider: string; id: string } | null }>(
			sidecar,
			{ type: "get_state" },
		);
		sessionPath = state.sessionFile ?? undefined;
		if (sessionPath) input.onSession?.(sessionPath);
		if (state.model) model = `${state.model.provider}/${state.model.id}`;
		else {
			throw new RunStop(
				"blocked_config",
				config.model
					? `The pinned model is not available: ${config.model}`
					: "No model is configured for this workspace",
				"config",
			);
		}

		// Rounds go on in the same session while the agent's own report says the
		// task's depth is not reached yet (policy.nextRound), within the time limit.
		const deadline = deps.now() + config.timeoutMs;
		let message = renderRunPrompt(config, input.previous, worktree ? { branch: worktree.branch } : null);
		let end: PromptEnd | null = null;
		// Read from the session, not the event stream: events arrive in batches,
		// so a quick round can end before its tool events do.
		const sessionToolCalls = async (target: RunSidecar) =>
			(await command<SessionStats>(target, { type: "get_session_stats" }).catch(() => null))?.toolCalls ?? null;
		let callsBefore = 0;
		for (;;) {
			roundReport = null;
			reportCalls = 0;
			try {
				end = await promptAndWait(sidecar, message, deadline - deps.now(), input.signal);
			} catch (error) {
				// A later round that runs out of time leaves the earlier rounds' report standing.
				if (!(error instanceof RunStop && error.state === "timed_out" && round > 1 && report)) throw error;
				end = null;
				break;
			}
			if (end.kind !== "result" || end.status !== "completed") break;
			// A round whose only tool call was its report made no progress.
			const callsAfter = await sessionToolCalls(sidecar);
			const progressed = callsAfter !== null && callsAfter - callsBefore > reportCalls;
			callsBefore = callsAfter ?? callsBefore;
			const next = nextRound(config.depth, round, { report: roundReport, progressed });
			if (!next || deadline - deps.now() < MIN_ROUND_MS) break;
			round++;
			input.onProgress({ turns, lastTool, round });
			message = renderRoundPrompt(config, round, next);
		}
		if (progressTimer) {
			clearTimeout(progressTimer);
			progressTimer = null;
		}
		input.onProgress({ turns, lastTool, round });

		// Whatever happened, read what the session holds before the sidecar goes.
		await collect();

		// A later round cut short by time or an error: the work so far stands, unfinished.
		const cutShort =
			round > 1 && report !== undefined && (end === null || end.kind !== "result" || end.status !== "completed");
		if (cutShort && report) report = { ...report, status: "partial" };
		else if (end?.kind === "rejected") {
			throw new RunStop("failed", end.message, classifyRunError({ message: end.message }));
		} else if (end?.kind === "result" && end.status === "error") {
			const facts = end.error ?? { message: "The run ended with an error" };
			throw new RunStop("failed", facts.message, classifyRunError(facts));
		} else if (end?.kind === "result" && end.status === "aborted") {
			throw new RunStop("failed", "The agent aborted the run");
		}

		if (!report) {
			const text = await command<{ text?: string | null }>(sidecar, { type: "get_last_assistant_text" }).catch(
				() => ({
					text: null,
				}),
			);
			report = {
				status: "partial",
				summary: clip(text.text?.trim() || "The run ended without a report.", 4000),
				findings: [],
				changes: [],
			};
		}

		if (config.verify) {
			const result = await bash(sidecar, config.verify.command, config.verify.timeoutMs);
			verification = {
				state: result.timedOut
					? "error"
					: result.exitCode === 0
						? "passed"
						: result.exitCode === 1
							? "failed"
							: "error",
				exitCode: result.exitCode,
				outputTail: outputTail(result.output),
			};
		}
		await settleWorktree();
		return finish("succeeded");
	} catch (error) {
		const stop =
			error instanceof RunStop
				? error
				: new RunStop("failed", error instanceof Error ? error.message : String(error), "other");
		if (sidecar && (stop.state === "timed_out" || stop.state === "cancelled" || stop.state === "failed")) {
			await collect().catch(() => {});
			await settleWorktree().catch(() => {});
		}
		return finish(stop.state, { message: stop.message, kind: stop.kind });
	} finally {
		if (progressTimer) clearTimeout(progressTimer);
		if (sidecar) {
			sidecar.off("events", onEvents);
			sidecar.off("extensionUi", onUi);
			sidecar.off("hostToolCall", onHostTool);
			sidecar.dispose();
		}
	}

	async function collect(): Promise<void> {
		const target = sidecar;
		if (target?.status !== "ready") return;
		const stats = await command<SessionStats>(target, { type: "get_session_stats" }).catch(() => null);
		if (stats) {
			usage = { inputTokens: stats.tokens.input, outputTokens: stats.tokens.output, costUsd: stats.cost, turns };
			if (!sessionPath && stats.sessionFile) sessionPath = stats.sessionFile;
		}
		if (worktree) {
			const changes = await command<RpcGitChanges>(target, { type: "get_git_changes" }).catch(() => null);
			if (changes?.isRepo) changedFiles = changes.files.map(file => file.path);
		}
	}

	/** Commit a worktree's changes for review, or remove a worktree that changed nothing. */
	async function settleWorktree(): Promise<void> {
		const target = sidecar;
		if (!target || !worktree || target.status !== "ready") return;
		if (changedFiles.length > 0) {
			const message = shellQuote(`omp task: ${clip(config.title, 60)} (run ${input.runId})`);
			const result = await bash(
				target,
				`git add -A && (git commit -q -m ${message} || git -c user.name='omp scheduled task' -c user.email='omp-task@localhost' commit -q -m ${message})`,
				COMMAND_TIMEOUT_MS,
			);
			worktree = { ...worktree, committed: result.exitCode === 0 };
			return;
		}
		const result = await bash(target, worktreeRemovalScript(worktree, true), COMMAND_TIMEOUT_MS);
		if (result.exitCode === 0) worktree = { ...worktree, removed: true };
	}
}

/**
 * Send the run prompt and wait for its `prompt_result`, then for background
 * work to settle. Ends early on timeout, cancellation, or the sidecar going
 * down, aborting the agent first so the session file is left consistent.
 */
function promptAndWait(
	sidecar: RunSidecar,
	message: string,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<PromptEnd> {
	const client = sidecar.rpcClient;
	if (!client) return Promise.reject(new RunStop("failed", "The agent is not connected", "transient"));
	const { promise, resolve, reject } = Promise.withResolvers<PromptEnd>();
	let promptId = "";
	let result: Extract<PromptEnd, { kind: "result" }> | null = null;
	let stopping: RunStop | null = null;
	let graceTimer: NodeJS.Timeout | null = null;
	let sawTurn = false;

	const timeout = setTimeout(() => stop(new RunStop("timed_out", "The run hit its time limit")), timeoutMs);

	function cleanup() {
		clearTimeout(timeout);
		if (graceTimer) clearTimeout(graceTimer);
		sidecar.off("frame", onFrame);
		sidecar.off("status", onStatus);
		sidecar.off("sessionSettled", onSettled);
		sidecar.off("events", onEvents);
		signal.removeEventListener("abort", onAbort);
	}

	function stop(reason: RunStop) {
		if (stopping) return;
		stopping = reason;
		client?.fire({ type: "abort" });
		// Give the agent a moment to write its abort; then stop waiting regardless.
		graceTimer = setTimeout(() => {
			cleanup();
			reject(reason);
		}, ABORT_GRACE_MS);
	}

	function onFrame(frame: Record<string, unknown>) {
		if (frame.type === "response" && frame.id === promptId) {
			if (frame.success === false) {
				cleanup();
				resolve({
					kind: "rejected",
					message: typeof frame.error === "string" ? frame.error : "The prompt was refused",
				});
			} else if ((frame.data as { agentInvoked?: boolean } | undefined)?.agentInvoked === false) {
				cleanup();
				resolve({ kind: "local" });
			}
			return;
		}
		if (frame.type !== "prompt_result" || (frame.id !== undefined && frame.id !== promptId)) return;
		const error = frame.error as { message: string; httpStatus?: number; retryable?: boolean } | undefined;
		result = {
			kind: "result",
			status: (frame.status as "completed" | "aborted" | "error" | undefined) ?? "completed",
			error,
			settled: frame.sessionSettled !== false,
		};
		if (stopping) {
			cleanup();
			reject(stopping);
			return;
		}
		if (result.settled) {
			cleanup();
			resolve(result);
		}
	}

	function onSettled() {
		if (!result) return;
		cleanup();
		if (stopping) reject(stopping);
		else resolve(result);
	}

	function onEvents(events: AgentSessionEvent[]) {
		if (events.some(event => event.type === "turn_end")) sawTurn = true;
	}

	function onStatus(payload: SidecarStatusPayload) {
		if (payload.status === "ready") return;
		cleanup();
		reject(
			new RunStop("failed", payload.message ?? "The agent stopped unexpectedly", sawTurn ? "other" : "transient"),
		);
	}

	function onAbort() {
		stop(new RunStop("cancelled", "Cancelled"));
	}

	sidecar.on("frame", onFrame);
	sidecar.on("status", onStatus);
	sidecar.on("sessionSettled", onSettled);
	sidecar.on("events", onEvents);
	signal.addEventListener("abort", onAbort, { once: true });
	promptId = client.fire({ type: "prompt", message });
	return promise;
}

/**
 * Run one shell script on a short-lived read-only sidecar in `cwd`, for
 * cleanup after the run's own sidecar is gone (rejected worktrees, sweeps).
 * Resolves the exit code, or null when the sidecar could not start.
 */
export async function runMaintenanceScript(deps: RunnerDeps, cwd: string, script: string): Promise<number | null> {
	if (!(await deps.cwdExists(cwd))) return null;
	const sidecar = deps.createSidecar({
		cwd,
		flags: runPolicyFlags("read_only", null),
		deny: { names: RUN_DENIED_FLAGS, withValue: RUN_DENIED_FLAGS_WITH_VALUE },
	});
	const controller = new AbortController();
	try {
		sidecar.start();
		await waitForReady(sidecar, controller.signal);
		const result = await bash(sidecar, script, COMMAND_TIMEOUT_MS);
		return result.exitCode ?? null;
	} catch {
		return null;
	} finally {
		sidecar.dispose();
	}
}

/** The cleanup script for a run's worktree: the directory, and the branch when asked. */
export function worktreeRemovalScript(worktree: RunWorktree, deleteBranch: boolean): string {
	const base = shellQuote(worktree.baseCwd);
	const remove = `(git -C ${base} worktree remove --force ${shellQuote(worktree.path)} || test ! -e ${shellQuote(worktree.path)}) && git -C ${base} worktree prune`;
	return deleteBranch ? `${remove} && (git -C ${base} branch -D ${shellQuote(worktree.branch)} || true)` : remove;
}
