/**
 * Sidecar lifecycle manager: spawns omp --mode rpc-ui, handles restart,
 * routes frames to RpcClient and EventBatcher.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import Store from "electron-store";
import { type FlagDenylist, parseLaunchProfile, profileToFlags, stripDenylistedFlags } from "../shared/launch-profile";
import { DEFAULT_ROLE_MODEL_SELECTOR, parseModelRestoreFailure } from "../shared/model-restore";
import type {
	AgentSessionEvent,
	CommandOutputFrame,
	ConfigUpdateFrame,
	ExtensionErrorFrame,
	ExtensionUIRequest,
	HostToolCallRequest,
	HostUriRequest,
	ModelCatalogUpdateFrame,
	OutboundFrame,
	PromptResultFrame,
	RpcBtwFrame,
	RpcDictationFrame,
	RpcLiveFrame,
	RpcReadyFrame,
	RpcResponse,
	RpcSessionState,
	RpcTerminalFrame,
	SessionInfoUpdateFrame,
	SessionSettledFrame,
	SidecarRestartProgress,
	SidecarStatus,
	SidecarStatusPayload,
	SubagentFrame,
} from "../shared/rpc-types";
import { BTW_FRAME_TYPES, DICTATION_FRAME_TYPES, LIVE_FRAME_TYPES, TERMINAL_FRAME_TYPES } from "../shared/rpc-types";
import { EventBatcher } from "./event-batcher";
import { dropUnsupportedProxies } from "./proxy-env";
import { attachNdjsonParser, supportsRpcProtocolV2 } from "./rpc-bridge";
import { RpcClient } from "./rpc-client";

const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAYS = [1000, 2000, 4000];

/**
 * Budget for a warm spare's `switch_session` (gui#29). Loading a large
 * transcript can outlast the 8s RPC default, and the fallback after a timeout
 * is the cold spawn the spare exists to avoid.
 */
const SESSION_BIND_TIMEOUT_MS = 60_000;

/** Frames a warm spare holds back until a tab adopts it. */
type ParkedFrame =
	| { event: "extensionUi"; frame: ExtensionUIRequest }
	| { event: "extensionError"; frame: ExtensionErrorFrame };

/** stderr lines kept per spawn for the crash report. */
const STDERR_TAIL_LINES = 20;
/** Cap on the stderr excerpt appended to the user-visible restart reason. */
const STDERR_REASON_CHARS = 240;

/**
 * Leading stderr line of the crashed spawn: a fatal message comes first
 * (`dyld: Library not loaded …`, `error: ENOENT …`) and whatever follows is
 * stack or warning noise. The full tail rides on the runtime-log report.
 */
function stderrExcerpt(lines: string[]): string {
	for (const line of lines) {
		// omp colors its fatal line; the reason is shown as plain text.
		const trimmed = stripVTControlCharacters(line).trim();
		if (!trimmed) continue;
		return trimmed.length > STDERR_REASON_CHARS ? `${trimmed.slice(0, STDERR_REASON_CHARS - 1)}…` : trimmed;
	}
	return "";
}

/** `switch_session` answered but declined (an extension veto, another workspace's session). */
function switchCancelled(response: RpcResponse): boolean {
	return (response.data as { cancelled?: unknown } | null | undefined)?.cancelled === true;
}

/** Event types routed to the EventBatcher. Hoisted: one lookup table for the
 * process, not one allocation per frame. */
const AGENT_EVENT_TYPES: Record<string, true> = {
	agent_start: true,
	agent_end: true,
	turn_start: true,
	turn_end: true,
	message_start: true,
	message_update: true,
	message_end: true,
	tool_execution_start: true,
	tool_execution_update: true,
	tool_execution_end: true,
	auto_compaction_start: true,
	auto_compaction_end: true,
	auto_retry_start: true,
	auto_retry_end: true,
	retry_fallback_applied: true,
	retry_fallback_succeeded: true,
	model_changed: true,
	ttsr_triggered: true,
	todo_reminder: true,
	todo_auto_clear: true,
	irc_message: true,
	notice: true,
	thinking_level_changed: true,
	goal_updated: true,
	loop_mode_update: true,
	plan_proposal: true,
	queue_update: true,
	collab_state: true,
};

export interface SidecarOptions {
	binaryPath: string;
	cwd: string;
	extraFlags?: string[];
	/**
	 * `app.isPackaged`, injected because the missing-binary message branches on
	 * it: only a dev tree can act on a build instruction.
	 */
	packaged?: boolean;
	/** Fresh GUI tabs must not inherit the CLI's persistent autoResume setting. */
	fresh?: boolean;
	/** Session kind: "agent" (default) or "chat" (tool-free conversation). Immutable per sidecar. */
	kind?: "agent" | "chat";
	/**
	 * Scheduled runs (plan/23): code-controlled policy flags, and the extra
	 * flags a launch profile may not set because they would widen the policy.
	 */
	runPolicy?: { flags: string[]; deny: FlagDenylist };
	/** When set, spawn the workspace source CLI via bun instead of the installed binary. */
	sourceCli?: string;
	/**
	 * Resolves proxy env vars (PI_PROXY / HTTPS_PROXY / …) injected at spawn —
	 * the GUI proxy pref or the macOS system proxy. Finder-launched apps have
	 * no shell env, so without this a proxy-only network (e.g. codex's
	 * chatgpt.com backend behind a firewall) hangs every provider request.
	 * Called on every start()/restart(); crash-loop respawns reuse the last
	 * result. Resolution failure degrades to no proxy env, never a spawn block.
	 */
	proxyEnv?: () => Promise<Record<string, string>>;
	/**
	 * Resolves the login-shell PATH overlay injected at spawn. Finder-launched
	 * apps inherit launchd's bare PATH, so agent-spawned tools configured by
	 * bare name (MCP servers, CLI helpers) die with ENOENT while the terminal
	 * TUI works. Same point-of-use pattern as proxyEnv: called on every
	 * start()/restart(), failure degrades to the inherited PATH.
	 */
	shellEnv?: () => Promise<Record<string, string>>;
	/**
	 * Persists a crash report (reason + stderr tail) for post-mortem diagnosis.
	 * Same point-of-use injection as `proxyEnv`/`shellEnv`: the real
	 * implementation is `writeRuntimeLog`, which resolves its path through
	 * Electron's `app`, so the manager must keep working without it.
	 */
	reportFailure?: (report: SidecarFailureReport) => void;
}

/** One crash-loop step, as handed to `reportFailure`. */
export interface SidecarFailureReport {
	/** Exit/signal reason with the leading stderr line appended. */
	reason: string;
	/** Respawn about to be scheduled, or the exhausted count on the final error. */
	attempt: number;
	maxAttempts: number;
	/** stderr tail captured from this spawn (up to STDERR_TAIL_LINES). */
	stderr: string[];
	cwd: string;
}

/**
 * Load the workspace's launch profile from GUI prefs (`launchProfiles.<cwd>`)
 * and map it to agent CLI flags. Prefs access mirrors the 0.3.1 proxy-env
 * pattern (point-of-use electron-store read); any failure — prefs unreadable,
 * non-electron test env, malformed JSON — degrades to no flags, never a
 * spawn block. Profile changes require a sidecar restart: flags are
 * spawn-time argv, there is no live apply.
 */
function loadLaunchProfileFlags(cwd: string): string[] {
	try {
		// projectName is only a fallback for electron-less environments (tests):
		// with the app present, electron-store's own userData cwd wins and the
		// store matches index.ts/ipc.ts exactly. A pre-typed variable sidesteps
		// the excess-property check — electron-store's Options type hides
		// projectName, but its constructor passes it through to conf.
		const storeOptions = { name: "prefs", projectName: "omp-gui" };
		const profiles = new Store<{ launchProfiles?: Record<string, unknown> }>(storeOptions).get("launchProfiles");
		if (typeof profiles !== "object" || profiles === null) return [];
		return profileToFlags(parseLaunchProfile(profiles[cwd]));
	} catch {
		return [];
	}
}

/** Resolve the bun executable for source-sidecar spawns (PATH fallback last). */
function resolveBunExe(): string {
	if (process.env.OMP_BUN) return process.env.OMP_BUN;
	for (const candidate of [join(homedir(), ".bun", "bin", "bun"), "/opt/homebrew/bin/bun", "/usr/local/bin/bun"]) {
		if (existsSync(candidate)) return candidate;
	}
	return "bun";
}

/**
 * The "no omp binary" message, worded for the build that hit it. A dev tree
 * can rebuild the sidecar; a packaged app cannot, so telling its user to run
 * `build:omp` sends them into a source checkout they do not have.
 */
export function missingSidecarMessage(packaged: boolean, resourcesPath?: string): string {
	if (!packaged) {
		return "Built-in omp not found. Build it with `bun --cwd=packages/gui run build:omp`, then relaunch.";
	}
	const target = resourcesPath ? join(resourcesPath, "omp") : "the bundled omp binary";
	return `omp is missing from this installation (${target}). Reinstall omp GUI, then relaunch.`;
}

export interface SidecarEvents {
	status: (payload: SidecarStatusPayload) => void;
	events: (events: AgentSessionEvent[]) => void;
	extensionUi: (request: ExtensionUIRequest) => void;
	hostToolCall: (request: HostToolCallRequest) => void;
	hostUriRequest: (request: HostUriRequest) => void;
	subagentFrame: (frame: SubagentFrame) => void;
	liveFrame: (frame: RpcLiveFrame) => void;
	dictationFrame: (frame: RpcDictationFrame) => void;
	/** Terminal frames, forwarded for every tab (not only visible ones): output must not be lost. */
	terminalFrame: (frame: RpcTerminalFrame) => void;
	btwFrame: (frame: RpcBtwFrame) => void;
	modelCatalogUpdate: (frame: ModelCatalogUpdateFrame) => void;
	commandsUpdate: (commands: unknown[]) => void;
	sessionSettled: (frame: SessionSettledFrame) => void;
	frame: (frame: OutboundFrame) => void;
}

export class SidecarManager extends EventEmitter {
	#child: ChildProcess | null = null;
	#rpcClient: RpcClient | null = null;
	#batcher: EventBatcher | null = null;
	#detachParser: (() => void) | null = null;
	#restartCount = 0;
	#restartTimer: NodeJS.Timeout | null = null;
	/**
	 * Spawn-cycle counter, bumped whenever a cycle is torn down or started.
	 * Every continuation that outlives the synchronous spawn (protocol
	 * negotiation, env resolution) captures it and drops itself when it no
	 * longer matches, so a dead child can never report `ready` or reset the
	 * crash-loop counter.
	 */
	#generation = 0;
	/** `start()` calls in flight; a superseded env resolution must not spawn. */
	#startSeq = 0;
	#lastStderr: string[] = [];
	/**
	 * `asleep` until something calls start(): a restored background tab costs
	 * nothing until it is shown. start() flips to `starting` synchronously, so
	 * "is a spawn already under way?" is answerable from this field alone.
	 */
	#status: SidecarStatus = "asleep";
	#options: SidecarOptions;
	#proxyEnvVars: Record<string, string> = {};
	#shellEnvVars: Record<string, string> = {};
	#resumeSessionPath: string | null = null;
	#freshLaunchPending: boolean;
	/** Whether the current spawn cycle reached `ready`. */
	#bootedThisSpawn = false;
	/**
	 * Saved session model that failed to restore at boot. The next spawn adds
	 * `--model @default` so the session opens on the configured default model
	 * instead of exiting (upstream resumes fail closed), and the ready status
	 * carries it so the renderer can say so.
	 */
	#bootModelFallback: string | null = null;
	/**
	 * Non-null while this manager is a warm spare no tab has adopted yet. A
	 * spare has no window to show extension prompts or load errors in, and a
	 * blocking prompt dropped here would hang its caller, so they wait for
	 * `adopt()` to replay them to the tab.
	 */
	#parkedFrames: ParkedFrame[] | null = null;
	/**
	 * Set when a tab adopted this spare while its process was still booting:
	 * the session to switch onto once it is ready, in place of announcing it.
	 * Per spawn — a respawn opens the session itself through `--session`.
	 */
	#bindOnReady: { sessionPath: string | undefined } | null = null;
	#disposed = false;

	constructor(options: SidecarOptions) {
		super();
		this.#options = options;
		this.#freshLaunchPending = options.fresh === true;
	}

	get status(): SidecarStatus {
		return this.#status;
	}

	get cwd(): string {
		return this.#options.cwd;
	}

	get rpcClient(): RpcClient | null {
		return this.#rpcClient;
	}

	start(): void {
		if (this.#disposed) return;
		// Closed loop: only the bundled binary (or an explicit source override)
		// may run. Missing it is an actionable error, never an external fallback.
		if (!this.#options.binaryPath && !this.#options.sourceCli) {
			this.#setStatus("error", missingSidecarMessage(!!this.#options.packaged, process.resourcesPath));
			return;
		}
		this.#setStatus("starting");
		const resolveProxyEnv = this.#options.proxyEnv;
		const resolveShellEnv = this.#options.shellEnv;
		if (!resolveProxyEnv && !resolveShellEnv) {
			this.#spawn();
			return;
		}
		const fallback = () => ({}) as Record<string, string>;
		// Env resolution takes up to 4s. A restart()/start() landing inside that
		// window supersedes this pending spawn — it already killed whatever child
		// existed (nothing yet) — so spawning here would orphan the newer child
		// and tear it down with the session it just opened.
		const seq = ++this.#startSeq;
		void Promise.all([
			resolveProxyEnv ? resolveProxyEnv().catch(fallback) : Promise.resolve({}),
			resolveShellEnv ? resolveShellEnv().catch(fallback) : Promise.resolve({}),
		]).then(([proxyEnv, shellEnv]) => {
			if (this.#disposed || seq !== this.#startSeq) return;
			this.#proxyEnvVars = proxyEnv;
			this.#shellEnvVars = shellEnv;
			this.#spawn();
		});
	}

	#spawn(): void {
		// One live child per manager. `#child` is only ever set here, so anything
		// still attached means a previous spawn was never retired — kill it through
		// the normal teardown instead of letting it run parser-less and unkillable.
		const superseded = this.#child;
		if (superseded) {
			this.#cleanup();
			superseded.kill("SIGTERM");
		}
		this.#generation++;
		this.#lastStderr = [];
		this.#bootedThisSpawn = false;
		this.#bindOnReady = null;
		const { binaryPath, sourceCli, cwd, extraFlags } = this.#options;

		const args = ["--mode", "rpc-ui"];
		if (this.#resumeSessionPath) args.push("--session", this.#resumeSessionPath);
		else if (this.#freshLaunchPending) args.push("--no-auto-resume");
		if (this.#bootModelFallback) args.push("--model", DEFAULT_ROLE_MODEL_SELECTOR);
		if (this.#options.kind === "chat") args.push("--chat");
		const runPolicy = this.#options.runPolicy;
		if (runPolicy) args.push(...runPolicy.flags);
		// User-controllable flags ride the extraFlags seam + the launch profile.
		// Strip the code-controlled-flag denylist (pair-aware) over BOTH, then
		// append: neither can override the code-controlled argv above, while a
		// profile value that merely looks like a protected flag survives intact.
		const userFlags = [...(extraFlags ?? []), ...loadLaunchProfileFlags(cwd)];
		args.push(...stripDenylistedFlags(userFlags, runPolicy?.deny));

		// Source sidecar (monorepo dev): run the workspace coding-agent from
		// source via bun so in-repo RPC fixes are live in the running GUI.
		// Falls back to the installed binary when no workspace source exists.
		const command = sourceCli ? resolveBunExe() : binaryPath;
		const spawnArgs = sourceCli ? [sourceCli, ...args] : args;
		console.log(`[sidecar] spawning ${sourceCli ? "source" : "bundled"} omp (${args.length} args, cwd: ${cwd})`);

		let child: ChildProcess;
		try {
			child = spawn(command, spawnArgs, {
				stdio: ["pipe", "pipe", "pipe"],
				env: dropUnsupportedProxies({
					...process.env,
					// Login-shell PATH first so the GUI proxy pref (and inherited
					// proxy env) keeps precedence over rc-file proxy exports.
					...this.#shellEnvVars,
					...this.#proxyEnvVars,
					PI_RPC_EMIT_TITLE: "1",
					PI_NO_PTY: "1",
					PI_NOTIFICATIONS: "off",
				}),
				cwd,
				windowsHide: true,
			});
		} catch (err) {
			// spawn() throws synchronously (EBADF/ENOENT) — surface it as a
			// sidecar failure + retry, never an uncaught main-process exception.
			this.#attemptRestart(err instanceof Error ? err.message : String(err));
			return;
		}

		this.#child = child;

		// Set up RPC client with stdin writer
		const send = (frame: object) => {
			if (child.stdin?.writable) {
				child.stdin.write(`${JSON.stringify(frame)}\n`);
			}
		};
		this.#rpcClient = new RpcClient(send);

		// Set up event batcher
		this.#batcher = new EventBatcher(events => {
			this.emit("events", events);
		});

		// Parse stdout NDJSON
		if (child.stdout) {
			this.#detachParser = attachNdjsonParser(child.stdout, frame => this.#routeFrame(frame));
		}

		// Log stderr to main process console for diagnostics, and keep a per-spawn
		// tail: a sidecar that dies before it can log anywhere only speaks through
		// this pipe, so without the ring the crash report is just an exit code.
		child.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf-8").trim();
			if (text) {
				console.error(`[sidecar stderr] ${text}`);
				for (const line of text.split("\n")) {
					this.#lastStderr.push(line);
					if (this.#lastStderr.length > STDERR_TAIL_LINES) this.#lastStderr.shift();
				}
				this.emit("stderr", text);
			}
		});

		child.on("exit", (code, signal) => {
			if (this.#child !== child) return;
			this.#cleanup();
			if (this.#disposed) return;

			if (code === 0) {
				this.#setStatus("exited", "Normal shutdown");
			} else if (this.#recoverBootModelRestore()) {
				this.#spawn();
			} else {
				const msg = `Exit code ${code}${signal ? ` (signal: ${signal})` : ""}`;
				this.#attemptRestart(msg);
			}
		});

		child.on("error", err => {
			if (this.#child !== child) return;
			this.#cleanup();
			if (this.#disposed) return;
			this.#attemptRestart(err.message);
		});
	}

	#routeFrame(frame: unknown): void {
		if (typeof frame !== "object" || frame === null) return;
		const obj = frame as Record<string, unknown>;

		// Ready frame
		if (obj.type === "ready") {
			this.#handleReady(obj as unknown as RpcReadyFrame);
			return;
		}

		// Response frame → route to RPC client
		if (obj.type === "response") {
			const handled = this.#rpcClient?.onResponse(obj as unknown as RpcResponse);
			if (handled) return;
		}

		// Extension UI request
		if (obj.type === "extension_ui_request") {
			if (this.#parkedFrames) {
				this.#parkedFrames.push({ event: "extensionUi", frame: obj as ExtensionUIRequest });
				return;
			}
			this.emit("extensionUi", obj as ExtensionUIRequest);
			this.emit("frame", obj);
			return;
		}

		// Host tool/URI requests
		if (obj.type === "host_tool_call") {
			this.emit("hostToolCall", obj as unknown as HostToolCallRequest);
			this.emit("frame", obj);
			return;
		}
		if (obj.type === "host_uri_request") {
			this.emit("hostUriRequest", obj as unknown as HostUriRequest);
			this.emit("frame", obj);
			return;
		}

		// Subagent frames
		if (obj.type === "subagent_lifecycle" || obj.type === "subagent_progress" || obj.type === "subagent_event") {
			this.emit("subagentFrame", obj as unknown as SubagentFrame);
			this.emit("frame", obj);
			return;
		}

		// Available commands update
		if (obj.type === "available_commands_update") {
			this.emit("commandsUpdate", (obj as { commands: unknown[] }).commands);
			this.emit("frame", obj);
			return;
		}
		if (obj.type === "model_catalog_update") {
			this.emit("modelCatalogUpdate", obj as unknown as ModelCatalogUpdateFrame);
			this.emit("frame", obj);
			return;
		}

		// Config update (set_setting, slash-command config edits)
		if (obj.type === "config_update") {
			this.emit("configUpdate", obj as unknown as ConfigUpdateFrame);
			this.emit("frame", obj);
			return;
		}
		if (obj.type === "prompt_result") {
			this.emit("promptResult", obj as unknown as PromptResultFrame);
			this.emit("frame", obj);
			return;
		}
		if (obj.type === "session_settled") {
			this.emit("sessionSettled", obj as unknown as SessionSettledFrame);
			this.emit("frame", obj);
			return;
		}
		if (obj.type === "command_output") {
			this.emit("commandOutput", obj as unknown as CommandOutputFrame);
			this.emit("frame", obj);
			return;
		}
		if (obj.type === "session_info_update") {
			this.emit("sessionInfoUpdate", obj as unknown as SessionInfoUpdateFrame);
			this.emit("frame", obj);
			return;
		}
		if (obj.type === "extension_error") {
			if (this.#parkedFrames) {
				this.#parkedFrames.push({ event: "extensionError", frame: obj as unknown as ExtensionErrorFrame });
				return;
			}
			this.emit("extensionError", obj as unknown as ExtensionErrorFrame);
			this.emit("frame", obj);
			return;
		}
		if (LIVE_FRAME_TYPES.has(obj.type as string)) {
			this.emit("liveFrame", obj as unknown as RpcLiveFrame);
			this.emit("frame", obj);
			return;
		}
		if (DICTATION_FRAME_TYPES.has(obj.type as string)) {
			this.emit("dictationFrame", obj as unknown as RpcDictationFrame);
			return;
		}
		if (TERMINAL_FRAME_TYPES.has(obj.type as string)) {
			this.emit("terminalFrame", obj as unknown as RpcTerminalFrame);
			return;
		}
		if (BTW_FRAME_TYPES.has(obj.type as string)) {
			this.emit("btwFrame", obj as unknown as RpcBtwFrame);
			this.emit("frame", obj);
			return;
		}

		// Agent session events → batcher
		if (AGENT_EVENT_TYPES[obj.type as string] === true) {
			this.#batcher?.push(obj as AgentSessionEvent);
			this.emit("frame", obj);
			return;
		}

		// Other extension/host frames not consumed directly by the renderer.
		this.emit("frame", obj);
	}

	#handleReady(ready: RpcReadyFrame): void {
		// An adopted spare still has its session to open: a crash before the
		// switch must respawn into it.
		if (!this.#bindOnReady) this.#resumeSessionPath = null;
		this.#bootedThisSpawn = true;
		const modelFallback = this.#bootModelFallback ?? undefined;
		this.#bootModelFallback = null;
		// Freshness is a creation contract, not a restart policy. Once the new
		// tab has booted successfully, later crash/manual restarts may auto-resume
		// the session it has since created or opened.
		this.#freshLaunchPending = false;
		// Negotiation settles after this frame — and when the sidecar dies on boot,
		// `#cleanup()` rejects the pending command on a generation that is already
		// gone. Unguarded, that rejection announced "ready" and zeroed the restart
		// counter, so a broken binary respawned forever behind a healthy UI.
		// Stay on v1 when an older/malformed sidecar omits the negotiation fields
		// or advertises limits this decoder cannot safely honor.
		const generation = this.#generation;
		const announceReady = (): void => {
			if (!this.#isLive(generation)) return;
			const bind = this.#bindOnReady;
			this.#bindOnReady = null;
			if (bind && this.#rpcClient) {
				this.#restartCount = 0;
				this.#bindAdopted(this.#rpcClient, bind.sessionPath);
				return;
			}
			this.#setStatus("ready", undefined, undefined, modelFallback);
			this.#restartCount = 0;
		};
		const announceReadyWithEventFilter = (): void => {
			if (this.#isLive(generation) && this.#rpcClient) {
				// Delta updates: a full `message_update` re-sends the whole message so far
				// on every token — quadratic bytes that saturate this process's event loop
				// under long streams and starve command responses (gui#19).
				void this.#rpcClient
					.command({ type: "set_event_filter", events: Object.keys(AGENT_EVENT_TYPES), messageUpdates: "delta" })
					.catch(() => {});
				// Opt into upstream's `ask` protocol — the GUI renders ask dialogs.
				void this.#rpcClient.command({ type: "set_ask_dialog", enabled: true, form: true }).catch(() => {});
				// `pty: true` bash runs in the terminal panel, where the user can answer it,
				// and the agent's `terminal` tool reads the panel's terminals and starts
				// long-lived commands (dev servers) there.
				void this.#rpcClient
					.command({ type: "terminal_configure", interactiveCommands: true, agentTools: true })
					.catch(() => {});
			}
			announceReady();
		};
		if (supportsRpcProtocolV2(ready)) {
			this.#rpcClient
				?.command({ type: "negotiate_protocol", protocolVersion: 2 })
				.then(announceReadyWithEventFilter, announceReady);
		} else {
			announceReady();
		}
	}

	/** Continuation guard: false once the spawn cycle that captured `generation`
	 *  has been torn down or replaced. */
	#isLive(generation: number): boolean {
		return !this.#disposed && generation === this.#generation;
	}

	#attemptRestart(reason: string): void {
		// The exit code alone is never the diagnosis; the spawn's stderr carries it.
		const excerpt = stderrExcerpt(this.#lastStderr);
		const detail = excerpt ? `${reason} — ${excerpt}` : reason;
		const exhausted = this.#restartCount >= MAX_RESTART_ATTEMPTS;
		const attempt = exhausted ? MAX_RESTART_ATTEMPTS : this.#restartCount + 1;
		this.#options.reportFailure?.({
			reason: detail,
			attempt,
			maxAttempts: MAX_RESTART_ATTEMPTS,
			stderr: [...this.#lastStderr],
			cwd: this.#options.cwd,
		});
		if (exhausted) {
			this.#setStatus("error", detail, { attempt, maxAttempts: MAX_RESTART_ATTEMPTS });
			return;
		}

		const delay = RESTART_DELAYS[attempt - 1] ?? 4000;
		this.#restartCount = attempt;
		this.#setStatus("restarting", detail, { attempt, maxAttempts: MAX_RESTART_ATTEMPTS });

		this.#restartTimer = setTimeout(() => {
			this.#restartTimer = null;
			if (!this.#disposed) {
				this.#spawn();
			}
		}, delay);
	}

	/**
	 * A spawn that died before `ready` because its saved session model could not
	 * be restored would fail identically on every retry. Arm one `--model @default`
	 * respawn instead (outside the crash budget); true when armed.
	 */
	#recoverBootModelRestore(): boolean {
		if (this.#bootedThisSpawn || this.#bootModelFallback) return false;
		const missing = parseModelRestoreFailure(this.#lastStderr.join("\n"));
		if (!missing) return false;
		console.warn(`[sidecar] session model ${missing} unavailable at boot — resuming on the default model`);
		this.#bootModelFallback = missing;
		return true;
	}

	#setStatus(status: SidecarStatus, message?: string, restart?: SidecarRestartProgress, modelFallback?: string): void {
		this.#status = status;
		this.emit("status", { status, message, cwd: this.#options.cwd, restart, modelFallback });
	}

	#cleanup(): void {
		// Any async continuation of the current cycle (pending negotiation) is
		// stale from here on, even before the replacement spawns.
		this.#generation++;
		this.#detachParser?.();
		this.#detachParser = null;
		this.#batcher?.flushNow();
		this.#batcher?.dispose();
		this.#batcher = null;
		this.#rpcClient?.rejectAll("Sidecar disconnected");
		this.#rpcClient = null;
		this.#child = null;
	}

	/** Send a side-channel frame (bypasses command queue). */
	sendSideChannel(frame: object): void {
		if (this.#child?.stdin?.writable) {
			this.#child.stdin.write(`${JSON.stringify(frame)}\n`);
		}
	}

	/** Mark the sidecar as unhealthy (e.g. health check failed after ready). */
	markUnhealthy(reason: string): void {
		this.#setStatus("error", reason);
	}

	/**
	 * Adopt a new logical cwd WITHOUT a respawn. `switch_session` onto a file
	 * rooted in another workspace re-roots the agent with no main-observable
	 * event, leaving `get cwd()` (and the tab chip reading it) frozen at the
	 * spawn cwd. The RPC passthrough reports the post-switch cwd here so every
	 * consumer — status payloads, future plain `restart()` spawns,
	 * launch-profile lookup — follows the live session. Project switch goes
	 * through `restart(cwd)` instead (explicit re-root). Returns true when the
	 * cwd actually changed.
	 */
	adoptCwd(cwd: string): boolean {
		if (cwd === this.#options.cwd) return false;
		this.#options = { ...this.#options, cwd };
		return true;
	}

	/** Boot as a warm spare (gui#29): a running process bound to no tab until `adopt()`. */
	prewarm(): void {
		this.#parkedFrames = [];
		this.start();
	}

	/**
	 * Hand a warm spare to the tab taking it over: switch its blank session onto
	 * `sessionPath` (a new tab keeps the blank one), then report `ready` as a
	 * fresh boot would. A switch takes well under a second where a cold spawn
	 * takes seconds — tens of seconds on slow Windows hosts (gui#29).
	 *
	 * A spare still booting is adopted too, keeping the part of its boot already
	 * done: the switch waits for its `ready`, or, before the process is even
	 * spawned, the spawn opens the session itself.
	 *
	 * Whatever the switch cannot open the way `--session` would falls back to
	 * that cold start: a spare that is neither booting nor idle, or a switch the
	 * agent refuses (another workspace's session) or fails. A saved model that
	 * no longer resolves reopens on this process's own model — the configured
	 * default, as the cold path's `--model @default` respawn would pick.
	 */
	adopt(sessionPath?: string): void {
		if (this.#status === "starting") {
			// A crash before the switch respawns straight into the session.
			this.#resumeSessionPath = sessionPath ?? null;
			if (this.#child) this.#bindOnReady = { sessionPath };
			else this.#parkedFrames = null;
			this.#setStatus("starting");
			return;
		}
		const client = this.#rpcClient;
		if (this.#status !== "ready" || !client) {
			this.restart(undefined, sessionPath);
			return;
		}
		this.#bindAdopted(client, sessionPath);
	}

	/** Switch a booted, adopted spare onto its tab's session, then announce it ready. */
	#bindAdopted(client: RpcClient, sessionPath: string | undefined): void {
		const parked = this.#parkedFrames ?? [];
		this.#parkedFrames = null;
		const generation = this.#generation;
		// A crash mid-switch respawns into the session, not a blank one.
		this.#resumeSessionPath = sessionPath ?? null;
		if (this.#status !== "starting") this.#setStatus("starting");
		this.#bindSession(client, sessionPath).then(
			modelFallback => {
				if (!this.#isLive(generation)) return;
				this.#resumeSessionPath = null;
				this.#setStatus("ready", undefined, undefined, modelFallback);
				for (const { event, frame } of parked) this.emit(event, frame);
			},
			(err: unknown) => {
				if (!this.#isLive(generation)) return;
				console.warn(
					`[sidecar] warm session switch failed, cold-starting instead: ${err instanceof Error ? err.message : String(err)}`,
				);
				this.restart(undefined, sessionPath);
			},
		);
	}

	/**
	 * Switch the spare onto `sessionPath`. Resolves the saved model that could
	 * not be restored (undefined when none); rejects when only a cold start can
	 * open the session.
	 */
	async #bindSession(client: RpcClient, sessionPath: string | undefined): Promise<string | undefined> {
		if (!sessionPath) return undefined;
		const switched = await client.command({ type: "switch_session", sessionPath }, SESSION_BIND_TIMEOUT_MS);
		if (switched.success) {
			if (switchCancelled(switched)) throw new Error("switch_session was cancelled");
			return undefined;
		}
		const missing = parseModelRestoreFailure(switched.error);
		if (!missing) throw new Error(switched.error ?? "switch_session failed");
		const state = await client.command({ type: "get_state" });
		const model = state.success ? (state.data as RpcSessionState | null)?.model : null;
		if (!model) throw new Error(switched.error ?? "switch_session failed");
		const retried = await client.command(
			{ type: "switch_session", sessionPath, provider: model.provider, modelId: model.id },
			SESSION_BIND_TIMEOUT_MS,
		);
		if (!retried.success) throw new Error(retried.error ?? "switch_session failed");
		if (switchCancelled(retried)) throw new Error("switch_session was cancelled");
		return missing;
	}

	restart(cwd?: string, resumeSessionPath?: string): void {
		this.#parkedFrames = null;
		this.kill();
		if (cwd) this.#options = { ...this.#options, cwd };
		this.#resumeSessionPath = resumeSessionPath ?? null;
		this.#bootModelFallback = null;
		this.#restartCount = 0;
		this.start();
	}

	kill(): void {
		if (this.#restartTimer) {
			clearTimeout(this.#restartTimer);
			this.#restartTimer = null;
		}
		const child = this.#child;
		this.#cleanup();
		child?.kill("SIGTERM");
	}

	dispose(): void {
		this.#disposed = true;
		this.kill();
		this.removeAllListeners();
	}
}
