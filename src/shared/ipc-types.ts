/**
 * IPC channel definitions shared between main, preload, and renderer.
 * Type-safe contract for the contextBridge API.
 */

import type {
	AgentSessionEvent,
	AvailableCommand,
	CommandOutputFrame,
	ConfigUpdateFrame,
	ExtensionErrorFrame,
	ExtensionUIRequest,
	ExtensionUIResponse,
	HostToolCallRequest,
	HostToolResult,
	HostToolUpdate,
	HostUriRequest,
	HostUriResult,
	ImageContent,
	ModelCatalogUpdateFrame,
	PromptResultFrame,
	RpcCommand,
	RpcDebugParams,
	RpcLiveUpdateFrame,
	RpcMcpServerInput,
	RpcResponse,
	RpcSecurityDispositionStatus,
	RpcSecurityTargetInput,
	RpcSshHostInput,
	SessionInfoUpdateFrame,
	SidecarStatus,
	SubagentFrame,
	ThinkingLevel,
	TodoPhase,
} from "./rpc-types";

// ============================================================================
// IPC Channels (main → renderer events)
// ============================================================================

export const IPC_EVENTS = {
	/** Batched agent session events (16ms cadence) */
	EVENTS_BATCH: "rpc:events",
	/** Sidecar connection status change */
	SIDECAR_STATUS: "sidecar:status",
	/** Per-tab sidecar status push (every tab of the window, foreground or background) */
	TAB_STATUS: "tab:status",
	/** Extension UI request from agent */
	EXTENSION_UI: "extension-ui:request",
	/** Host tool call request */
	HOST_TOOL_CALL: "host-tool:call",
	/** Host URI request */
	HOST_URI_REQUEST: "host-uri:request",
	/** Subagent frame */
	SUBAGENT_FRAME: "subagent:frame",
	/** Available commands updated */
	COMMANDS_UPDATE: "commands:update",
	/** Agent config changed (set_setting, slash-command config edits) */
	CONFIG_UPDATE: "config:update",
	/** Deferred result for locally handled extension slash commands */
	PROMPT_RESULT: "prompt:result",
	/** Text emitted by text-mode slash commands */
	COMMAND_OUTPUT: "command:output",
	/** Current session title/id changed */
	SESSION_INFO_UPDATE: "session-info:update",
	/** Extension runtime hook failed */
	EXTENSION_ERROR: "extension:error",
	/** Realtime voice session state/levels/transcript update. */
	LIVE_UPDATE: "live:update",
	/** Model/provider discovery completed after a bounded listing response. */
	MODEL_CATALOG_UPDATE: "model-catalog:update",
	/** Session list changed */
	SESSIONS_CHANGED: "sessions:changed",
	/** Log line appended */
	LOG_LINE: "log:line",
	/** Stats data ready */
	STATS_DATA: "stats:data",
	/** Native application menu action */
	MENU_ACTION: "menu:action",
	/** omp:// deep link (new session / switch session) */
	DEEP_LINK: "deep-link",
	/** Renderer → main fire-and-forget tray-state snapshot */
	TRAY_STATE_PUSH: "tray:state-push",
	/** Renderer → main fire-and-forget run-progress state (dock badge + progress bar) */
	PROGRESS_SET: "progress:set",
	/** Auto-update status machine push (idle/checking/available/downloading/downloaded/not-available/error) */
	UPDATER_STATUS: "updater:status",
} as const;

// ============================================================================
// IPC Channels (renderer → main invoke)
// ============================================================================

export const IPC_COMMANDS = {
	/** Persist a renderer runtime failure in the main-process crash log */
	RUNTIME_ERROR_REPORT: "runtime:error-report",
	/** Absolute path to the main-process crash log */
	RUNTIME_LOG_PATH: "runtime:log-path",
	/** Send an RPC command, get response */
	RPC_COMMAND: "rpc:command",
	/** Send an RPC command to a specific tab's sidecar (IpcRpcCommandForTabPayload). */
	RPC_COMMAND_FOR_TAB: "rpc:command-for-tab",
	/** Respond to extension UI request */
	EXTENSION_UI_RESPOND: "extension-ui:respond",
	/** Send host tool result */
	HOST_TOOL_RESULT: "host-tool:result",
	/** Send host tool update */
	HOST_TOOL_UPDATE: "host-tool:update",
	/** Send host URI result */
	HOST_URI_RESULT: "host-uri:result",
	/** Get session list */
	SESSIONS_LIST: "sessions:list",
	/** Delete a session file */
	SESSIONS_DELETE: "sessions:delete",
	/** Rename a saved session without switching the active tab */
	SESSIONS_RENAME: "sessions:rename",
	/** Full-content search over session files; returns matching paths */
	SESSIONS_SEARCH: "sessions:search",
	/** Fetch stats endpoint */
	STATS_FETCH: "stats:fetch",
	/** Run/cancel an isolated bundled `omp bench --json` process. */
	BENCH_RUN: "bench:run",
	BENCH_ABORT: "bench:abort",
	/** Open external URL */
	SYSTEM_OPEN_EXTERNAL: "system:open-external",
	/** Open a file path in the system editor (relative resolves against the workspace) */
	SYSTEM_OPEN_PATH: "system:open-path",
	/** Show save dialog */
	SYSTEM_SAVE_DIALOG: "system:save-dialog",
	/** Show open dialog */
	SYSTEM_OPEN_DIALOG: "system:open-dialog",
	/** Read clipboard */
	SYSTEM_CLIPBOARD_READ: "system:clipboard-read",
	/** Show notification */
	SYSTEM_NOTIFY: "system:notify",
	/** Get GUI preferences */
	PREFS_GET: "prefs:get",
	/** Set GUI preferences */
	PREFS_SET: "prefs:set",
	/** Restart sidecar */
	SIDECAR_RESTART: "sidecar:restart",
	/** Get sidecar status */
	SIDECAR_STATUS_GET: "sidecar:status-get",
	/** Choose a project directory and restart the sidecar there */
	SIDECAR_SELECT_PROJECT: "sidecar:select-project",
	SIDECAR_SET_PROJECT: "sidecar:set-project",
	/** Resolve and create the GUI-owned Work-mode workspace. */
	SIDECAR_DEFAULT_WORKSPACE: "sidecar:default-workspace",
	/** List custom models.yml providers */
	MODELS_PROVIDERS_LIST: "models:providers-list",
	/** Upsert a custom provider into models.yml */
	MODELS_PROVIDER_UPSERT: "models:provider-upsert",
	/** Delete a custom provider from models.yml */
	MODELS_PROVIDER_DELETE: "models:provider-delete",
	/** Open the agent's models.yml in the system editor (created when missing; falls back to revealing it in the file manager) */
	MODELS_CONFIG_OPEN: "models:config-open",
	/** List workspace files as a tree (main-process readdir, no sidecar needed) */
	FS_LIST: "fs:list",
	/** Read a workspace file with a byte cap */
	FS_READ: "fs:read",
	/** Read the plan-mode document off the RPC bus (with session-local fallback) */
	FS_READ_PLAN: "fs:read-plan",
	/** Read an image file as a data URL for markdown <img> rendering (sniffed mime, size cap) */
	FS_READ_IMAGE: "fs:read-image",
	/** Open a session (or a fresh window) in a new parallel window with its own sidecar */
	SESSION_OPEN_NEW_WINDOW: "session:open-new-window",
	/** Fresh window pulls the session it was opened for (one-shot) */
	SESSION_CONSUME_PENDING: "session:consume-pending",
	/** Spawn a tab (own sidecar) bound to the calling window */
	SPAWN_TAB: "tab:spawn",
	/** Close a tab: release its sidecar; last tab leaves the window tab-less */
	CLOSE_TAB: "tab:close",
	/** Move full event forwarding to the window's active tab */
	SET_ACTIVE_TAB: "tab:set-active",
	/** List the calling window's tabs (boot reconciliation) */
	GET_TABS: "tab:get-all",
	/** Look up the tab/window currently attached to a session file (F-OWN double-attach guard) */
	GET_SESSION_OWNER: "tab:get-session-owner",
	/** Round-trip a draft through the user's $VISUAL/$EDITOR (temp file, exit-0 read-back) */
	EDITOR_OPEN_EXTERNAL: "editor:open-external",
	/** Manual update check */
	UPDATER_CHECK: "updater:check",
	/** Download the updater-selected payload or architecture-matched macOS installer */
	UPDATER_DOWNLOAD: "updater:download",
	/** Apply an automatic update or reopen a downloaded manual installer */
	UPDATER_APPLY: "updater:apply",
	/** Current updater status (replay for renderer boot) */
	UPDATER_GET_STATUS: "updater:getStatus",
	/** Current app version (settings → updates row) */
	UPDATER_VERSION: "updater:version",
} as const;

export type RuntimeErrorSource =
	| "react-render"
	| "react-uncaught"
	| "react-recoverable"
	| "window-error"
	| "unhandled-rejection"
	| "renderer-console"
	| "renderer-load"
	| "preload"
	| "renderer-process"
	| "renderer-unresponsive"
	| "application-resources"
	| "child-process"
	| "main-uncaught"
	| "main-unhandled-rejection"
	| "unknown";

/** Bounded, serializable renderer/main failure payload written as JSONL. */
export interface RuntimeErrorReport {
	source: RuntimeErrorSource;
	message: string;
	stack?: string;
	componentStack?: string;
	url?: string;
	line?: number;
	column?: number;
	details?: Record<string, string | number | boolean | null>;
}

// Update status machine (electron-updater/manual macOS installer → renderer)
// ============================================================================

export type UpdateInstallMode = "automatic" | "manual";

export type UpdateStatus =
	| { state: "idle" }
	| { state: "checking" }
	| { state: "available"; version: string; notes?: string; mode: UpdateInstallMode }
	| {
			state: "downloading";
			version: string;
			mode: UpdateInstallMode;
			percent: number;
			bytesPerSecond: number;
			transferred: number;
			total: number;
	  }
	| { state: "downloaded"; version: string; mode: UpdateInstallMode }
	| { state: "not-available"; version: string }
	| { state: "error"; message: string; showInBanner?: boolean };

export type MenuAction =
	| "new-session"
	| "new-tab"
	| "new-chat-tab"
	| "open-project"
	| "toggle-sidebar"
	| "toggle-panel"
	| "open-settings"
	| "open-usage"
	| "export-html"
	| "handoff"
	| "toggle-fast"
	| "cycle-thinking"
	| "set-approval"
	| "toggle-language"
	| "switch-project";

/** Action forwarded to the renderer for an omp:// deep link. */
export type DeepLinkPayload = { action: "new-session" } | { action: "switch-session"; sessionId: string };

/** Optional payload carried alongside a MenuAction (approval mode / project cwd). */
export interface MenuActionPayload {
	approvalMode?: "always-ask" | "write" | "yolo";
	cwd?: string;
}

/** Run-progress state pushed by the renderer (terminal.showProgress): dock badge + window progress bar. */
export type RunProgressState = "working" | "waiting" | "idle";

export type IpcBenchmarkProfile = "mix" | "chat" | "prefill" | "generation";

export interface IpcBenchmarkRunOptions {
	models: string[];
	profile: IpcBenchmarkProfile;
	runs: number;
	parallel: number;
	maxTokens?: number;
}

export interface IpcBenchmarkMetricStats {
	mean: number;
	min: number;
	p50: number;
	p95: number;
	max: number;
}

export interface IpcBenchmarkStats {
	ttftMs: IpcBenchmarkMetricStats;
	durationMs: IpcBenchmarkMetricStats;
	tokensPerSecond: IpcBenchmarkMetricStats;
	generationTps: IpcBenchmarkMetricStats;
	prefillTps: IpcBenchmarkMetricStats;
	inputTokens: number;
	outputTokens: number;
	cost: number;
}

export interface IpcBenchmarkModelReport {
	selector: string;
	model: string;
	stats: IpcBenchmarkStats | null;
	byChallenge: Partial<Record<Exclude<IpcBenchmarkProfile, "mix">, IpcBenchmarkStats>>;
	results: Array<{ ok: boolean; error?: string }>;
}

export interface IpcBenchmarkSummary {
	runs: number;
	profile?: IpcBenchmarkProfile;
	models: IpcBenchmarkModelReport[];
	failures: number;
}

export type IpcBenchmarkRunResult =
	| { success: true; summary: IpcBenchmarkSummary; exitCode: number | null; stderr?: string }
	| { success: false; error: string; stderr?: string };

/** Compact snapshot the renderer pushes to main to build the tray menu. */
export interface TrayState {
	status: "idle" | "streaming" | "waiting" | "error";
	language: "zh" | "en";
	cwd: string | null;
	projectName: string;
	modelId: string | null;
	thinkingLevel: string;
	fastMode: boolean;
	approvalMode: "always-ask" | "write" | "yolo";
	contextPercent: number | null;
	contextTokens: number | null;
	workspaces: { cwd: string; name: string; current: boolean }[];
}

// ============================================================================
// IPC Payload Types
// ============================================================================

export interface IpcRpcCommandPayload {
	command: RpcCommand;
	/** Per-call timeout override (ms) for slow commands (voice STT/TTS model load). */
	timeoutMs?: number;
}

/**
 * RPC addressed at a SPECIFIC tab's sidecar (default RPC_COMMAND resolves the
 * window's ACTIVE tab). Needed by flows that act on a background tab — the
 * worktree close prompt queries/removes on the tab being closed without
 * yanking the user onto it (plan/20).
 */
export interface IpcRpcCommandForTabPayload {
	tabId: string;
	command: RpcCommand;
	timeoutMs?: number;
}

export interface IpcEventsBatchPayload {
	events: AgentSessionEvent[];
}

export interface IpcSidecarStatusPayload {
	status: "starting" | "ready" | "exited" | "error" | "restarting";
	message?: string;
	cwd: string;
}

export interface IpcExtensionUiPayload {
	tabId: string;
	request: ExtensionUIRequest;
}

export interface IpcExtensionUiRespondPayload {
	response: ExtensionUIResponse;
}

export interface IpcHostToolCallPayload {
	request: HostToolCallRequest;
}

export interface IpcHostToolResultPayload {
	result: HostToolResult;
}

export interface IpcHostToolUpdatePayload {
	update: HostToolUpdate;
}

export interface IpcHostUriRequestPayload {
	request: HostUriRequest;
}

export interface IpcHostUriResultPayload {
	result: HostUriResult;
}

export interface IpcSubagentFramePayload {
	frame: SubagentFrame;
}

export interface IpcCommandsUpdatePayload {
	commands: AvailableCommand[];
}

/** API protocols accepted by the agent's models.yml (mirror of ApiSchema in
 *  coding-agent/src/config/models-config-schema-bundle.ts — keep in sync). */
export const CUSTOM_PROVIDER_APIS = [
	"openai-completions",
	"openai-responses",
	"openai-codex-responses",
	"azure-openai-responses",
	"anthropic-messages",
	"bedrock-converse-stream",
	"google-generative-ai",
	"google-gemini-cli",
	"google-vertex",
] as const;

export type CustomProviderApi = (typeof CUSTOM_PROVIDER_APIS)[number];

/** Reasoning/thinking effort levels accepted by models.yml (EffortSchema). */
export const CUSTOM_MODEL_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type CustomModelEffort = (typeof CUSTOM_MODEL_EFFORTS)[number];

export type CustomModelThinkingMode =
	| "effort"
	| "budget"
	| "google-level"
	| "anthropic-adaptive"
	| "anthropic-budget-effort";

/** Thinking configuration of a model (ModelThinkingSchema, canonical efforts form). */
export interface CustomProviderModelThinking {
	mode: CustomModelThinkingMode;
	efforts: CustomModelEffort[];
	defaultLevel?: CustomModelEffort;
	supportsDisplay?: boolean;
}

/** Per-model pricing in USD per million tokens (all four required when cost is set). */
export interface CustomProviderModelCost {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

export type CustomProviderDiscoveryType =
	| "ollama"
	| "llama.cpp"
	| "lm-studio"
	| "openai-models-list"
	| "proxy"
	| "litellm";

export interface CustomProviderDiscovery {
	type: CustomProviderDiscoveryType;
	timeoutMs?: number;
}

export interface CustomProviderModelInput {
	id: string;
	name?: string;
	/** Per-model protocol override (falls back to the provider's api). */
	api?: CustomProviderApi;
	/** Per-model endpoint override. */
	baseUrl?: string;
	reasoning?: boolean;
	/** Structured thinking config; required `efforts` when present. */
	thinking?: CustomProviderModelThinking;
	/** Input modalities the model accepts. */
	input?: ("text" | "image")[];
	supportsTools?: boolean;
	cost?: CustomProviderModelCost;
	premiumMultiplier?: number;
	contextWindow?: number;
	maxTokens?: number;
	omitMaxOutputTokens?: boolean;
	headers?: Record<string, string>;
}

export interface CustomProviderInput {
	id: string;
	api: CustomProviderApi;
	baseUrl: string;
	apiKey?: string;
	auth?: "apiKey" | "none" | "oauth";
	/** Send the key in an Authorization header instead of the provider default. */
	authHeader?: boolean;
	headers?: Record<string, string>;
	discovery?: CustomProviderDiscovery;
	disableStrictTools?: boolean;
	/** Route every model through the auth-gateway's /v1/pi/stream endpoint. */
	transport?: "pi-native";
	/** compat.extraBody — extra request-body parameters merged into every call. */
	extraBody?: Record<string, unknown>;
	models: CustomProviderModelInput[];
}

/** A provider entry as shown in the GUI (apiKey masked, never the real value). */
export interface CustomProviderView {
	id: string;
	api: string;
	baseUrl: string;
	hasApiKey: boolean;
	apiKeyPreview?: string;
	auth?: "apiKey" | "none" | "oauth";
	authHeader?: boolean;
	headers?: Record<string, string>;
	discovery?: CustomProviderDiscovery;
	disableStrictTools?: boolean;
	transport?: "pi-native";
	extraBody?: Record<string, unknown>;
	models: CustomProviderModelInput[];
	builtin: boolean;
}

export interface IpcSessionsListPayload {
	scope: "local" | "global";
}

export interface IpcSessionsDeletePayload {
	sessionPath: string;
}

export interface IpcSessionsRenamePayload {
	sessionPath: string;
	name: string;
}

export interface IpcSessionsSearchPayload {
	query: string;
	scope: "local" | "global";
}

export interface IpcStatsFetchPayload {
	path: string;
	params?: Record<string, string>;
}

export interface IpcNotifyPayload {
	title: string;
	body?: string;
}

export interface IpcPrefsGetPayload {
	key?: string;
}

export interface IpcPrefsSetPayload {
	key: string;
	value: unknown;
}

// ============================================================================
// Workspace Filesystem Types
// ============================================================================

export interface IpcFsListPayload {
	/** Directory to walk, relative to the workspace root; defaults to the root. */
	path?: string;
	/** Max directory depth to descend into (root level = 0). */
	maxDepth?: number;
	/** Max number of files to include before truncating. */
	maxEntries?: number;
}

export interface FsTreeEntry {
	name: string;
	/** Workspace-relative path using POSIX separators. */
	path: string;
	kind: "file" | "dir";
	/** Directories only; omitted or empty beyond the depth cap. */
	children?: FsTreeEntry[];
}

export interface IpcFsListResult {
	ok: boolean;
	entries: FsTreeEntry[];
	/** True when the file cap stopped the walk early. */
	truncated: boolean;
	error?: string;
}

export interface IpcFsReadPayload {
	/** Workspace-relative path, or an absolute/~/ path selected for local preview. */
	path: string;
	/** Max bytes to read; hard-capped in main. */
	maxBytes?: number;
}

export interface IpcFsReadResult {
	ok: boolean;
	content: string;
	/** File exceeded maxBytes; content is a prefix. */
	truncated: boolean;
	/** NUL byte found in the read region; content is empty. */
	binary: boolean;
	/** Total file size in bytes. */
	size: number;
	error?: string;
}

export interface IpcOpenPathResult {
	ok: boolean;
	/** The absolute path that was opened/revealed, when successful. */
	resolvedPath?: string;
	error?: string;
}

export interface IpcFsReadPlanPayload {
	/** Absolute path of the configured plan file. */
	fsPath: string;
	/** Session-local artifacts root for the newest-`*plan.md` fallback (plan under `local://`); null disables the fallback. */
	localRoot: string | null;
}

export interface IpcFsReadImagePayload {
	/**
	 * Image path from a markdown `![alt](src)` in model output. Relative paths
	 * resolve against the session workspace; absolute paths (and `~`) are read
	 * as-is — the bytes only ever reach a local <img>, so there is no exfil
	 * channel, but the file must sniff as a real image type.
	 */
	path: string;
}

export interface IpcFsReadImageResult {
	ok: boolean;
	/** `data:<mime>;base64,…` ready for <img src>. */
	dataUrl: string | null;
	mime: string | null;
	/** Total file size in bytes. */
	size: number;
	error?: string;
}

export interface IpcFsReadPlanResult {
	ok: boolean;
	/** The file actually read (fsPath or the fallback pick); null when no plan file exists. */
	path: string | null;
	/** File content ("" for an empty file); null when no plan file exists. */
	content: string | null;
	error?: string;
}

// ============================================================================
// Session Index Types
// ============================================================================

/**
 * Open a session (or a fresh project window) in a new parallel window.
 * `sessionPath` opens that specific session; `cwd` chooses the project for a
 * fresh window. Both optional — omit both for a fresh window in the caller's cwd.
 */
export interface IpcSessionOpenNewWindowPayload {
	sessionPath?: string;
	cwd?: string;
}

// ============================================================================
// Session Tab Types (in-window parallel sessions, one sidecar per tab)
// ============================================================================

/**
 * Tab chip status: the sidecar's connection status plus a main-synthesized
 * "running" (connection ready + agent run in flight, from the event stream).
 */
export type TabStatus = SidecarStatus | "running";

/** Session kind: "agent" (tools enabled) or "chat" (tool-free conversation). */
export type SessionKind = "agent" | "chat";

/**
 * A tab's git-worktree binding (tab × worktree, plan/20). Immutable, set at
 * spawn like `kind`; main-held so it survives renderer reloads. `name` is the
 * user-facing slug (chip label for untitled tabs), `branch` the created
 * omp/gui/<name> ref, `baseCwd` the repo checkout the worktree forked from.
 */
export interface IpcTabWorktree {
	name: string;
	branch: string;
	baseCwd: string;
}

/** One tab of a window: its sidecar's cwd, last status, and cached session meta. */
export interface IpcTabInfo {
	/** Opaque snowflake id minted by main at acquire. */
	tabId: string;
	cwd: string;
	status: TabStatus;
	/** Present on GET_TABS for the tab main currently routes as active. */
	active?: boolean;
	/** True while automatic transcript compaction is mutating this session. */
	compacting?: boolean;
	/** Immutable session kind, fixed when the tab's sidecar was spawned. */
	kind: SessionKind;
	/** Disposable untargeted startup tab. Cleared permanently when its first run starts. */
	placeholder?: boolean;
	/** Present when the tab was spawned bound to a git worktree. */
	worktree?: IpcTabWorktree;
	/** Authoritative transcript attached to this tab, available before session_info_update; null clears it. */
	sessionPath?: string | null;
	/** Present once the tab's sidecar reported session_info_update. */
	sessionId?: string;
	/** Null explicitly clears the previous session's cached title. */
	title?: string | null;
}

/** TAB_STATUS push payload — a full tab snapshot from any tab, active or background. */
export type IpcTabStatusPayload = IpcTabInfo;

/** Full sidecar event tagged with the tab that emitted it. The preload drops
 * envelopes from a previously active tab after SET_ACTIVE_TAB resolves. */
export interface IpcActiveTabEnvelope<T> {
	tabId: string;
	payload: T;
}

/** Spawn a tab bound to the calling window. Defaults: caller's cwd, fresh session. */
export interface IpcSpawnTabPayload {
	cwd?: string;
	sessionPath?: string;
	/** Session kind for the new tab; omitted = "agent". Immutable once spawned. */
	kind?: SessionKind;
	/** Spawn a full agent in the GUI-owned default Work workspace. */
	defaultWorkspace?: boolean;
	/**
	 * Worktree binding minted by a prior worktree_create RPC: cwd is the
	 * worktree path and the tab carries the binding for chip rendering and
	 * the close-time cleanup prompt.
	 */
	worktree?: IpcTabWorktree;
}

/** Owner of a session file: the tab (and its window) currently attached to it. */
export interface IpcSessionOwner {
	tabId: string;
	/** Owner window's webContents.id. */
	winId: number;
}

export interface IpcSpawnTabResult {
	/**
	 * Minted tab id. Null when the requested sessionPath is already attached
	 * to a tab — the renderer switches to/focuses the owner instead of
	 * spawning a second sidecar for the same file (F-OWN).
	 */
	tabId: string | null;
	/** Resolved cwd when main selected the default Work workspace. */
	cwd?: string;
	/** Present iff tabId is null: the tab/window owning the requested sessionPath. */
	ownerTabId?: string;
	ownerWinId?: number;
	/**
	 * Why the spawn was refused (tabId null). `owned` = the session file is
	 * already attached elsewhere (F-OWN); `kind-mismatch` = the requested kind
	 * disagrees with the target session file's stamped kind.
	 */
	refusal?: "owned" | "kind-mismatch";
}

/** Look up which tab/window owns a session file (F-OWN renderer belt-guards). */
export interface IpcGetSessionOwnerPayload {
	sessionPath: string;
}

export interface IpcCloseTabPayload {
	tabId: string;
}

export interface IpcSetActiveTabPayload {
	tabId: string;
}

export interface IpcSidecarRestartPayload {
	/** Omitted for manual active-tab restarts; plugin activation always supplies the origin tab. */
	tabId?: string;
	sessionPath?: string;
}

export interface SessionInfo {
	path: string;
	id: string;
	title: string | null;
	cwd: string;
	created: string;
	modified: string;
	messageCount: number;
	size: number;
	status: "complete" | "interrupted" | "aborted" | "error" | "pending" | "unknown";
	/** Session kind read from the file header; absent = agent (legacy sessions). */
	kind?: "chat";
	parentSessionPath?: string;
	firstMessage: string;
}

// ============================================================================
// Preload API Shape (what window.omp exposes)
// ============================================================================

export interface OmpApi {
	runtime: {
		/** Best-effort fire-and-forget reporting so fatal render paths never wait on IPC. */
		report(error: RuntimeErrorReport): void;
		logPath(): Promise<string>;
	};
	rpc: {
		command(cmd: RpcCommand, timeoutMs?: number): Promise<RpcResponse>;
		commandForTab(tabId: string, cmd: RpcCommand, timeoutMs?: number): Promise<RpcResponse>;
		getState(): Promise<RpcResponse>;
		prompt(message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp"): Promise<RpcResponse>;
		steer(message: string, images?: ImageContent[]): Promise<RpcResponse>;
		followUp(message: string, images?: ImageContent[]): Promise<RpcResponse>;
		abort(): Promise<RpcResponse>;
		abortAndPrompt(message: string): Promise<RpcResponse>;
		newSession(parentSession?: string): Promise<RpcResponse>;
		dropSession(): Promise<RpcResponse>;
		switchSession(sessionPath: string): Promise<RpcResponse>;
		branch(entryId: string): Promise<RpcResponse>;
		fork(): Promise<RpcResponse>;
		eval(code: string, language?: "python" | "js" | "ruby" | "julia", excluded?: boolean): Promise<RpcResponse>;
		abortEval(): Promise<RpcResponse>;
		dequeue(): Promise<RpcResponse>;
		getQueue(): Promise<RpcResponse>;
		queueEdit(queueId: string, text: string): Promise<RpcResponse>;
		queueRemove(queueId: string): Promise<RpcResponse>;
		queueMove(queueId: string, toIndex: number, toLane?: "steering" | "followUp"): Promise<RpcResponse>;
		queueClear(lane?: "steering" | "followUp"): Promise<RpcResponse>;
		setModel(provider: string, modelId: string): Promise<RpcResponse>;
		cycleModel(direction?: "forward" | "backward"): Promise<RpcResponse>;
		retry(): Promise<RpcResponse>;
		clearContext(): Promise<RpcResponse>;
		abortSubagent(agentId: string): Promise<RpcResponse>;
		reviveSubagent(agentId: string): Promise<RpcResponse>;
		writeLocalPaste(content: string): Promise<RpcResponse>;
		getActiveTools(): Promise<RpcResponse>;
		setPrewalk(enabled: boolean): Promise<RpcResponse>;
		fresh(): Promise<RpcResponse>;
		shakeContext(mode: "elide" | "images" | "thinking"): Promise<RpcResponse>;
		reloadPlugins(): Promise<RpcResponse>;
		setForceTool(payload: { tool: string } | { clear: true }): Promise<RpcResponse>;
		getForceTool(): Promise<RpcResponse>;
		listForeignSessions(source: "claude" | "codex"): Promise<RpcResponse>;
		importForeignSession(source: "claude" | "codex", foreignId: string): Promise<RpcResponse>;
		forkFrom(entryId: string): Promise<RpcResponse>;
		switchLeaf(entryId: string, options?: { summarize?: boolean; customInstructions?: string }): Promise<RpcResponse>;
		resumeAfterAskReanswer(): Promise<RpcResponse>;
		getCommandArgCompletions(command: string, prefix: string): Promise<RpcResponse>;
		mcpAdd(name: string, config: RpcMcpServerInput, scope?: "user" | "project"): Promise<RpcResponse>;
		mcpTest(probe: { name?: string; config?: RpcMcpServerInput }): Promise<RpcResponse>;
		mcpReauth(name: string): Promise<RpcResponse>;
		mcpReauthCancel(name: string): Promise<RpcResponse>;
		marketplaceAction(payload: {
			action: "add" | "remove" | "update" | "install" | "uninstall" | "upgrade" | "list_available";
			marketplace?: string;
			plugin?: string;
			source?: string;
		}): Promise<RpcResponse>;
		getPluginDetail(pluginId: string): Promise<RpcResponse>;
		setPluginFeatures(pluginId: string, features: string[]): Promise<RpcResponse>;
		setPluginSetting(pluginId: string, key: string, value: unknown): Promise<RpcResponse>;
		deletePluginSetting(pluginId: string, key: string): Promise<RpcResponse>;
		getDirectories(): Promise<RpcResponse>;
		addDirectory(path: string): Promise<RpcResponse>;
		removeDirectory(path: string): Promise<RpcResponse>;
		moveSession(path: string): Promise<RpcResponse>;
		getGitStatus(): Promise<RpcResponse>;
		worktreeCreate(name: string, options?: { baseCwd?: string; baseRef?: "HEAD" | "default" }): Promise<RpcResponse>;
		worktreeRemove(path: string, force?: boolean): Promise<RpcResponse>;
		prRepo(): Promise<RpcResponse>;
		prList(state?: "open" | "closed" | "merged" | "all", limit?: number): Promise<RpcResponse>;
		prGet(number: number): Promise<RpcResponse>;
		prDiff(number: number, path: string): Promise<RpcResponse>;
		prDraft(options?: { base?: string; head?: string }): Promise<RpcResponse>;
		prCreate(input: {
			title: string;
			body: string;
			base?: string;
			head?: string;
			draft?: boolean;
		}): Promise<RpcResponse>;
		prCheckout(number: number): Promise<RpcResponse>;
		liveStart(voice?: string): Promise<RpcResponse>;
		liveToggleMute(): Promise<RpcResponse>;
		liveStop(): Promise<RpcResponse>;
		getLiveState(): Promise<RpcResponse>;
		debug(params: RpcDebugParams): Promise<RpcResponse>;
		collabStart(relayUrl?: string, view?: boolean): Promise<RpcResponse>;
		collabJoin(link: string): Promise<RpcResponse>;
		collabLeave(): Promise<RpcResponse>;
		getCollabState(): Promise<RpcResponse>;
		getAvailableModels(forceRefresh?: boolean): Promise<RpcResponse>;
		setThinkingLevel(level: ThinkingLevel | "auto"): Promise<RpcResponse>;
		cycleThinkingLevel(): Promise<RpcResponse>;
		setFastMode(enabled: boolean): Promise<RpcResponse>;
		setSteeringMode(mode: "all" | "one-at-a-time"): Promise<RpcResponse>;
		setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<RpcResponse>;
		setInterruptMode(mode: "immediate" | "wait"): Promise<RpcResponse>;
		compact(customInstructions?: string): Promise<RpcResponse>;
		setAutoCompaction(enabled: boolean): Promise<RpcResponse>;
		setAutoRetry(enabled: boolean): Promise<RpcResponse>;
		abortRetry(): Promise<RpcResponse>;
		bash(command: string, excluded?: boolean): Promise<RpcResponse>;
		abortBash(): Promise<RpcResponse>;
		getSessionStats(): Promise<RpcResponse>;
		setSessionPinned(sessionId: string, pinned: boolean): Promise<RpcResponse>;
		exportHtml(outputPath?: string): Promise<RpcResponse>;
		getBranchMessages(): Promise<RpcResponse>;
		getLastAssistantText(): Promise<RpcResponse>;
		getCopyTargets(): Promise<RpcResponse>;
		setSessionName(name: string): Promise<RpcResponse>;
		setEntryLabel(entryId: string, label?: string): Promise<RpcResponse>;
		handoff(customInstructions?: string): Promise<RpcResponse>;
		getMessages(): Promise<RpcResponse>;
		getMessagesPage(cursor?: string, limit?: number): Promise<RpcResponse>;
		getLoginProviders(): Promise<RpcResponse>;
		login(providerId: string): Promise<RpcResponse>;
		logout(providerId: string): Promise<RpcResponse>;
		getUsage(): Promise<RpcResponse>;
		getSettingsSchema(): Promise<RpcResponse>;
		getSettings(paths?: string[]): Promise<RpcResponse>;
		setSetting(path: string, value: unknown): Promise<RpcResponse>;
		getProviders(forceRefresh?: boolean): Promise<RpcResponse>;
		setPlanMode(enabled: boolean): Promise<RpcResponse>;
		getPlanMode(): Promise<RpcResponse>;
		getModelRoles(): Promise<RpcResponse>;
		setModelRole(role: string, modelId: string | null): Promise<RpcResponse>;
		getModelRoleMetadata(): Promise<RpcResponse>;
		getAvailableCommands(): Promise<RpcResponse>;
		getSkills(): Promise<RpcResponse>;
		getSkillDetail(name: string): Promise<RpcResponse>;
		getAgentDefinitions(): Promise<RpcResponse>;
		getHooks(): Promise<RpcResponse>;
		getMcpServers(): Promise<RpcResponse>;
		getGuiThemes(): Promise<RpcResponse>;
		getPlugins(): Promise<RpcResponse>;
		getMarketplaces(): Promise<RpcResponse>;
		getPromptTemplates(): Promise<RpcResponse>;
		getMemoryReport(): Promise<RpcResponse>;
		getSecurityDashboard(): Promise<RpcResponse>;
		getSecurityScan(scanId: string): Promise<RpcResponse>;
		securityStart(target: RpcSecurityTargetInput): Promise<RpcResponse>;
		securityCancel(operationId: string): Promise<RpcResponse>;
		securityValidate(scanId: string, findingId: string): Promise<RpcResponse>;
		securitySetDisposition(
			scanId: string,
			findingId: string,
			status: RpcSecurityDispositionStatus,
			rationale?: string,
		): Promise<RpcResponse>;
		getSshHosts(): Promise<RpcResponse>;
		sshManage(payload: {
			action: "create" | "update" | "delete";
			scope: "user" | "project";
			name: string;
			previousName?: string;
			previousScope?: "user" | "project";
			host?: RpcSshHostInput;
		}): Promise<RpcResponse>;
		sshTest(host: RpcSshHostInput & { name: string }): Promise<RpcResponse>;
		getOmpUpdate(): Promise<RpcResponse>;
		getContextReport(): Promise<RpcResponse>;
		shareSession(): Promise<RpcResponse>;
		getJobs(): Promise<RpcResponse>;
		getSessionTree(): Promise<RpcResponse>;
		getThemes(): Promise<RpcResponse>;
		getThemeColors(name: string): Promise<RpcResponse>;
		getTranscript(): Promise<RpcResponse>;
		planApproval(
			approved: boolean,
			option?: "execute" | "compact" | "keep_context" | "save",
			feedback?: string,
			savePath?: string,
		): Promise<RpcResponse>;
		getVibeMode(): Promise<RpcResponse>;
		setVibeMode(enabled: boolean): Promise<RpcResponse>;
		getGoal(): Promise<RpcResponse>;
		guidedGoal(initial?: string): Promise<RpcResponse>;
		setAgentsPaused(enabled: boolean): Promise<RpcResponse>;
		setGoal(args: {
			objective?: string;
			tokenBudget?: number | null;
			action?: "pause" | "resume" | "drop";
		}): Promise<RpcResponse>;
		btw(question: string): Promise<RpcResponse>;
		btwBranch(): Promise<RpcResponse>;
		tan(work: string): Promise<RpcResponse>;
		omfg(complaint: string): Promise<RpcResponse>;
		getLoopMode(): Promise<RpcResponse>;
		setLoopMode(enabled: boolean, args?: string): Promise<RpcResponse>;
		setSkillEnabled(name: string, enabled: boolean): Promise<RpcResponse>;
		manageSkill(args: {
			action: "create" | "update" | "delete";
			name: string;
			description?: string;
			body?: string;
		}): Promise<RpcResponse>;
		setHookEnabled(hookId: string, enabled: boolean): Promise<RpcResponse>;
		setPluginEnabled(pluginId: string, enabled: boolean, scope?: "user" | "project"): Promise<RpcResponse>;
		mcpAction(
			name: string,
			action: "enable" | "disable" | "reconnect" | "remove",
			scope?: "user" | "project",
		): Promise<RpcResponse>;
		setTodos(phases: TodoPhase[]): Promise<RpcResponse>;
		setSubagentSubscription(level: "off" | "progress" | "events"): Promise<RpcResponse>;
		getSubagents(): Promise<RpcResponse>;
		getSubagentMessages(subagentId?: string, sessionFile?: string, fromByte?: number): Promise<RpcResponse>;
		setHostTools(tools: unknown[]): Promise<RpcResponse>;
		setHostUriSchemes(schemes: unknown[]): Promise<RpcResponse>;
		// Voice (speech in/out): audio is canonical PCM16 mono 16 kHz WAV, base64.
		transcribeAudio(audioBase64: string, mimeType: string): Promise<RpcResponse>;
		synthesizeSpeech(text: string): Promise<RpcResponse>;
	};
	events: {
		onBatch(callback: (events: AgentSessionEvent[]) => void): () => void;
		onSidecarStatus(callback: (status: IpcSidecarStatusPayload) => void): () => void;
		onTabStatus(callback: (payload: IpcTabStatusPayload) => void): () => void;
		onExtensionUi(callback: (request: ExtensionUIRequest, tabId: string) => void): () => void;
		onHostToolCall(callback: (request: HostToolCallRequest) => void): () => void;
		onHostUriRequest(callback: (request: HostUriRequest) => void): () => void;
		onLiveUpdate(callback: (frame: RpcLiveUpdateFrame) => void): () => void;
		onModelCatalogUpdate(callback: (frame: ModelCatalogUpdateFrame) => void): () => void;
		onSubagentFrame(callback: (frame: SubagentFrame) => void): () => void;
		onCommandsUpdate(callback: (commands: AvailableCommand[]) => void): () => void;
		onConfigUpdate(callback: (payload: ConfigUpdateFrame) => void): () => void;
		onPromptResult(callback: (frame: PromptResultFrame) => void): () => void;
		onCommandOutput(callback: (frame: CommandOutputFrame) => void): () => void;
		onSessionInfoUpdate(callback: (frame: SessionInfoUpdateFrame) => void): () => void;
		onExtensionError(callback: (frame: ExtensionErrorFrame) => void): () => void;
		onSessionsChanged(callback: () => void): () => void;
		onLogLines(callback: (lines: string[]) => void): () => void;
		onMenuAction(callback: (action: MenuAction, payload?: MenuActionPayload) => void): () => void;
		onDeepLink(callback: (link: DeepLinkPayload) => void): () => void;
		onUpdaterStatus(callback: (status: UpdateStatus) => void): () => void;
	};
	updater: {
		check(): Promise<UpdateStatus>;
		download(): Promise<UpdateStatus>;
		apply(): Promise<void>;
		getStatus(): Promise<UpdateStatus>;
		version(): Promise<string>;
	};
	ui: {
		respondExtensionUi(response: ExtensionUIResponse): void;
		sendHostToolResult(result: HostToolResult): void;
		sendHostToolUpdate(update: HostToolUpdate): void;
		sendHostUriResult(result: HostUriResult): void;
	};
	sessions: {
		list(scope: "local" | "global"): Promise<SessionInfo[]>;
		delete(sessionPath: string): Promise<void>;
		rename(sessionPath: string, name: string): Promise<void>;
		search(query: string, scope: "local" | "global"): Promise<string[]>;
		/**
		 * Open a session (or a fresh project window) in a new parallel window.
		 * False at the cap. When `sessionPath` is already attached to a tab,
		 * the owner window is focused instead of spawning (F-OWN) and the
		 * call resolves true — the session is foregrounded either way.
		 */
		openInNewWindow(payload: IpcSessionOpenNewWindowPayload): Promise<boolean>;
		/** One-shot: the session this window was opened to display, if any. */
		consumePendingOpen(): Promise<string | null>;
	};
	tabs: {
		/** The calling window's tabs in acquisition order (boot reconciliation). */
		list(): Promise<IpcTabInfo[]>;
		/**
		 * Spawn a background tab bound to this window. Null at the pool cap.
		 * When `sessionPath` is already attached to a tab, resolves with
		 * `{ tabId: null, ownerTabId, ownerWinId }` instead of spawning (F-OWN).
		 */
		spawn(payload: IpcSpawnTabPayload): Promise<IpcSpawnTabResult | null>;
		/** Release a tab's sidecar. False when the tab is unknown or foreign. */
		close(tabId: string): Promise<boolean>;
		/** Move full event forwarding to this tab. False when unknown or foreign. */
		setActive(tabId: string): Promise<boolean>;
		/** The tab/window currently attached to a session file, if any (F-OWN). */
		getSessionOwner(sessionPath: string): Promise<IpcSessionOwner | null>;
	};
	stats: {
		fetch(path: string, params?: Record<string, string>): Promise<unknown>;
	};
	bench: {
		run(options: IpcBenchmarkRunOptions): Promise<IpcBenchmarkRunResult>;
		abort(): Promise<boolean>;
	};
	system: {
		openExternal(url: string): Promise<void>;
		/** Open a file in the system editor; relative paths resolve against the workspace. */
		openPath(path: string): Promise<IpcOpenPathResult>;
		showSaveDialog(defaultPath?: string, filters?: { name: string; extensions: string[] }[]): Promise<string | null>;
		showOpenDialog(
			filters?: { name: string; extensions: string[] }[],
			options?: { directory?: boolean },
		): Promise<string[] | null>;
		clipboardRead(): Promise<string>;
		notify(title: string, body?: string): void;
	};
	prefs: {
		get(key?: string): Promise<unknown>;
		set(key: string, value: unknown): Promise<void>;
	};
	sidecar: {
		restart(payload?: IpcSidecarRestartPayload): Promise<void>;
		selectProject(): Promise<string | null>;
		setProject(cwd: string): Promise<boolean>;
		defaultWorkspace(): Promise<string>;
		getStatus(): Promise<IpcSidecarStatusPayload>;
	};
	tray: {
		pushState(state: TrayState): void;
	};
	progress: {
		set(state: RunProgressState): void;
	};
	models: {
		listProviders(): Promise<CustomProviderView[]>;
		upsertProvider(input: CustomProviderInput): Promise<void>;
		deleteProvider(id: string): Promise<void>;
		openConfig(): Promise<{ path: string; opened: boolean }>;
	};
	fs: {
		list(path?: string, maxDepth?: number, maxEntries?: number): Promise<IpcFsListResult>;
		read(path: string, maxBytes?: number): Promise<IpcFsReadResult>;
		readPlan(payload: IpcFsReadPlanPayload): Promise<IpcFsReadPlanResult>;
		readImage(path: string): Promise<IpcFsReadImageResult>;
	};
	editor: {
		openExternal(content: string): Promise<{
			ok: boolean;
			unavailable: boolean;
			text: string | null;
			error?: string;
		}>;
	};
}
