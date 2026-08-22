/**
 * RPC protocol types for the omp GUI sidecar connection.
 * Hand-written from verified source (rpc-types.ts, rpc-mode.ts).
 * These are the wire types — no runtime dependency on @oh-my-pi/*.
 */

// ============================================================================
// RPC Commands (GUI → omp stdin)
// ============================================================================

export type RpcCommand =
	| { id?: string; type: "negotiate_protocol"; protocolVersion: number }
	| { id?: string; type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
	| { id?: string; type: "steer"; message: string; images?: ImageContent[] }
	| { id?: string; type: "follow_up"; message: string; images?: ImageContent[] }
	| { id?: string; type: "abort" }
	| { id?: string; type: "abort_and_prompt"; message: string; images?: ImageContent[] }
	| { id?: string; type: "new_session"; parentSession?: string }
	| { id?: string; type: "drop_session" }
	| { id?: string; type: "get_state" }
	| { id?: string; type: "set_fast_mode"; enabled: boolean }
	| { id?: string; type: "get_available_commands" }
	| { id?: string; type: "set_todos"; phases: TodoPhase[] }
	| { id?: string; type: "set_host_tools"; tools: HostToolDefinition[] }
	| { id?: string; type: "set_host_uri_schemes"; schemes: HostUriSchemeDefinition[] }
	| { id?: string; type: "set_subagent_subscription"; level: SubagentSubscriptionLevel }
	| { id?: string; type: "get_subagents" }
	| { id?: string; type: "get_subagent_messages"; subagentId?: string; sessionFile?: string; fromByte?: number }
	| { id?: string; type: "set_model"; provider: string; modelId: string }
	| { id?: string; type: "cycle_model"; direction?: "forward" | "backward" }
	| { id?: string; type: "get_available_models"; forceRefresh?: boolean }
	| { id?: string; type: "set_thinking_level"; level: ThinkingLevel | "auto" }
	| { id?: string; type: "cycle_thinking_level" }
	| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_interrupt_mode"; mode: "immediate" | "wait" }
	| { id?: string; type: "compact"; customInstructions?: string }
	| { id?: string; type: "set_auto_compaction"; enabled: boolean }
	| { id?: string; type: "set_auto_retry"; enabled: boolean }
	| { id?: string; type: "abort_retry" }
	| { id?: string; type: "bash"; command: string; excluded?: boolean }
	| { id?: string; type: "abort_bash" }
	| { id?: string; type: "eval"; language?: "python" | "js" | "ruby" | "julia"; code: string; excluded?: boolean }
	| { id?: string; type: "abort_eval" }
	| { id?: string; type: "dequeue" }
	// Queue management: stable per-entry ids (never array indices). queueId is
	// the entry id surfaced by get_queue; queue_edit changes plain user text
	// while preserving attachments; queue_move addresses visible-user order
	// with a clamped target unless toLane switches lanes; queue_clear drops
	// user-restorable entries only.
	| { id?: string; type: "get_queue" }
	| { id?: string; type: "queue_edit"; queueId: string; text: string }
	| { id?: string; type: "queue_remove"; queueId: string }
	| { id?: string; type: "queue_move"; queueId: string; toIndex: number; toLane?: "steering" | "followUp" }
	| { id?: string; type: "queue_clear"; lane?: "steering" | "followUp" }
	| { id?: string; type: "get_session_stats" }
	| { id?: string; type: "export_html"; outputPath?: string }
	| { id?: string; type: "switch_session"; sessionPath: string }
	| { id?: string; type: "branch"; entryId: string }
	| { id?: string; type: "fork" }
	| { id?: string; type: "get_branch_messages" }
	| { id?: string; type: "get_last_assistant_text" }
	| { id?: string; type: "set_session_name"; name: string; sessionPath?: string }
	| { id?: string; type: "set_entry_label"; entryId: string; label?: string }
	| { id?: string; type: "handoff"; customInstructions?: string }
	| { id?: string; type: "get_messages" }
	| { id?: string; type: "get_messages_page"; cursor?: string; limit?: number }
	| { id?: string; type: "get_login_providers" }
	| { id?: string; type: "login"; providerId: string }
	| { id?: string; type: "logout"; providerId: string }
	| { id?: string; type: "get_usage" }
	| { id?: string; type: "get_settings_schema" }
	| { id?: string; type: "get_settings"; paths?: string[] }
	| { id?: string; type: "set_setting"; path: string; value: unknown }
	| { id?: string; type: "get_providers"; forceRefresh?: boolean }
	| { id?: string; type: "set_plan_mode"; enabled: boolean }
	| { id?: string; type: "get_plan_mode" }
	| { id?: string; type: "get_model_roles" }
	| { id?: string; type: "set_model_role"; role: string; modelId: string | null }
	| { id?: string; type: "get_model_role_metadata" }

	// Domain inspection (read-only)
	| { id?: string; type: "get_skills" }
	| { id?: string; type: "get_skill_detail"; name: string }
	| { id?: string; type: "get_agent_definitions" }
	| { id?: string; type: "get_hooks" }
	| { id?: string; type: "get_mcp_servers" }
	| { id?: string; type: "get_gui_themes" }
	| { id?: string; type: "get_plugins" }
	| { id?: string; type: "get_marketplaces" }
	| { id?: string; type: "get_prompt_templates" }
	| { id?: string; type: "get_memory_report" }
	| { id?: string; type: "get_security_dashboard" }
	| { id?: string; type: "get_security_scan"; scanId: string }
	| { id?: string; type: "get_ssh_hosts" }
	| { id?: string; type: "get_omp_update" }

	// Session reports (structured TUI /context /share /jobs parity; /tools rides get_active_tools)
	| { id?: string; type: "get_context_report" }
	| { id?: string; type: "get_active_tools" }
	| { id?: string; type: "share_session" }
	| { id?: string; type: "get_jobs" }
	| { id?: string; type: "set_session_pinned"; sessionId: string; pinned: boolean }

	// One-shot session actions (TUI /prewalk /fresh /shake /reload-plugins
	// /force parity). set_force_tool takes exactly one of `tool` or
	// `clear: true`; fresh is refused with code "busy" while streaming.
	| { id?: string; type: "set_prewalk"; enabled: boolean }
	| { id?: string; type: "fresh" }
	| { id?: string; type: "shake_context"; mode: "elide" | "images" | "thinking" }
	| { id?: string; type: "reload_plugins" }
	| { id?: string; type: "set_force_tool"; tool?: string; clear?: boolean }
	| { id?: string; type: "get_force_tool" }
	| { id?: string; type: "get_session_tree" }
	| { id?: string; type: "get_themes" }
	| { id?: string; type: "get_theme_colors"; name: string }
	| { id?: string; type: "get_transcript" }
	| { id?: string; type: "get_copy_targets" }

	// Plan approval (structured)
	| {
			id?: string;
			type: "plan_approval";
			approved: boolean;
			option?: "execute" | "compact" | "keep_context" | "save";
			feedback?: string;
			savePath?: string;
	  }

	// Modes
	| { id?: string; type: "get_vibe_mode" }
	| { id?: string; type: "set_vibe_mode"; enabled: boolean }
	| { id?: string; type: "get_goal" }
	| { id?: string; type: "guided_goal"; initial?: string }
	| { id?: string; type: "set_agents_paused"; enabled: boolean }
	| { id?: string; type: "btw"; question: string }
	| { id?: string; type: "btw_branch" }
	| { id?: string; type: "tan"; work: string }
	| { id?: string; type: "omfg"; complaint: string }
	| {
			id?: string;
			type: "set_goal";
			objective?: string;
			tokenBudget?: number | null;
			action?: "pause" | "resume" | "drop";
	  }
	| { id?: string; type: "get_loop_mode" }
	| { id?: string; type: "set_loop_mode"; enabled: boolean; args?: string }

	// Domain actions (mutating)
	| { id?: string; type: "set_skill_enabled"; name: string; enabled: boolean }
	| {
			id?: string;
			type: "manage_skill";
			action: "create" | "update" | "delete";
			name: string;
			description?: string;
			body?: string;
	  }
	| { id?: string; type: "set_hook_enabled"; hookId: string; enabled: boolean }
	| { id?: string; type: "set_plugin_enabled"; pluginId: string; enabled: boolean; scope?: "user" | "project" }
	| {
			id?: string;
			type: "mcp_action";
			name: string;
			action: "enable" | "disable" | "reconnect" | "remove";
			scope?: "user" | "project";
	  }
	| { id?: string; type: "security_start"; target: RpcSecurityTargetInput }
	| { id?: string; type: "security_cancel"; operationId: string }
	| { id?: string; type: "security_validate"; scanId: string; findingId: string }
	| {
			id?: string;
			type: "security_set_disposition";
			scanId: string;
			findingId: string;
			status: RpcSecurityDispositionStatus;
			rationale?: string;
	  }
	| {
			id?: string;
			type: "ssh_manage";
			action: "create" | "update" | "delete";
			scope: "user" | "project";
			name: string;
			previousName?: string;
			previousScope?: "user" | "project";
			host?: RpcSshHostInput;
	  }
	| { id?: string; type: "ssh_test"; host: RpcSshHostInput & { name: string } }

	// Voice (speech in/out). `transcribe_audio.audioBase64` carries a canonical
	// RIFF/WAVE buffer — PCM16, mono, 16 kHz (the STT pipeline's native rate);
	// `mimeType` is informational ("audio/wav").
	| { id?: string; type: "transcribe_audio"; audioBase64: string; mimeType: string }
	| { id?: string; type: "synthesize_speech"; text: string }
	| { id?: string; type: "retry" }
	| { id?: string; type: "clear_context" }
	| { id?: string; type: "abort_subagent"; agentId: string }
	| { id?: string; type: "revive_subagent"; agentId: string }
	| { id?: string; type: "write_local_paste"; content: string }
	| { id?: string; type: "list_foreign_sessions"; source: "claude" | "codex" }
	| { id?: string; type: "import_foreign_session"; source: "claude" | "codex"; foreignId: string }
	| { id?: string; type: "fork_from"; entryId: string }
	| { id?: string; type: "switch_leaf"; entryId: string; summarize?: boolean; customInstructions?: string }
	| { id?: string; type: "resume_after_ask_reanswer" }
	| { id?: string; type: "get_command_arg_completions"; command: string; prefix: string }
	| { id?: string; type: "mcp_add"; name: string; config: RpcMcpServerInput; scope?: "user" | "project" }
	| { id?: string; type: "mcp_test"; name?: string; config?: RpcMcpServerInput }
	| { id?: string; type: "mcp_reauth"; name: string }
	| { id?: string; type: "mcp_reauth_cancel"; name: string }
	| {
			id?: string;
			type: "marketplace_action";
			action: "add" | "remove" | "update" | "install" | "uninstall" | "upgrade" | "list_available";
			marketplace?: string;
			plugin?: string;
			source?: string;
	  }
	| { id?: string; type: "get_plugin_detail"; pluginId: string }
	| { id?: string; type: "set_plugin_features"; pluginId: string; features: string[] }
	| { id?: string; type: "set_plugin_setting"; pluginId: string; key: string; value: unknown }
	| { id?: string; type: "delete_plugin_setting"; pluginId: string; key: string }
	| { id?: string; type: "live_start"; voice?: string }
	| { id?: string; type: "live_toggle_mute" }
	| { id?: string; type: "live_stop" }
	| { id?: string; type: "get_live_state" }
	| { id?: string; type: "debug"; params: RpcDebugParams }
	| { id?: string; type: "collab_start"; relayUrl?: string; view?: boolean }
	| { id?: string; type: "collab_join"; link: string }
	| { id?: string; type: "collab_leave" }
	| { id?: string; type: "get_collab_state" }

	// Workspace directories (TUI /dirs /add-dir /remove-dir /move parity).
	// add_directory/remove_directory return the post-mutation directory list;
	// remove_directory refuses the primary (cwd) directory; move_session
	// relocates the session file's cwd association on disk.
	| { id?: string; type: "get_directories" }
	| { id?: string; type: "add_directory"; path: string }
	| { id?: string; type: "remove_directory"; path: string }
	| { id?: string; type: "move_session"; path: string }
	// Git worktrees (tab × worktree binding, plan/20). get_git_status feeds the
	// footer git segment; worktree_create materializes branch omp/gui/<name> at
	// ~/.omp/wt/gui-<name>-<hash7>; worktree_remove refuses dirty unless force.
	| { id?: string; type: "get_git_status" }
	| { id?: string; type: "worktree_create"; name: string; baseCwd?: string; baseRef?: "HEAD" | "default" }
	| { id?: string; type: "worktree_remove"; path: string; force?: boolean }
	// Pull requests (PR Center, plan/21). pr_diff is per-file (lazy), pr_draft
	// is a model call, pr_checkout lands the PR in a worktree (plan/20 scheme).
	| { id?: string; type: "pr_repo" }
	| { id?: string; type: "pr_list"; state?: "open" | "closed" | "merged" | "all"; limit?: number }
	| { id?: string; type: "pr_get"; number: number }
	| { id?: string; type: "pr_diff"; number: number; path: string }
	| { id?: string; type: "pr_draft"; base?: string; head?: string }
	| { id?: string; type: "pr_create"; title: string; body: string; base?: string; head?: string; draft?: boolean }
	| { id?: string; type: "pr_checkout"; number: number };

// ============================================================================
// RPC Responses (omp stdout → GUI)
// ============================================================================

export interface RpcResponseSuccess {
	id?: string;
	type: "response";
	command: string;
	success: true;
	data?: unknown;
}

export interface RpcResponseError {
	id?: string;
	type: "response";
	command: string;
	success: false;
	error: string;
	code?: string;
	/**
	 * Optional structured details for machine-handled failures. Defined codes:
	 * `session_owned_elsewhere` (F-OWN switch_session refusal) carries
	 * `{ ownerTabId: string; ownerWinId: number }`.
	 */
	data?: unknown;
}

// ============================================================================
// Session Report Results (/context /share /jobs parity)
// ============================================================================

/** Provider-anchored token breakdown, mirroring the agent's ContextUsageBreakdown. */
export interface RpcContextUsageBreakdown {
	contextWindow: number;
	anchored: boolean;
	usedTokens: number;
	systemPromptTokens: number;
	systemToolsTokens: number;
	systemContextTokens: number;
	skillsTokens: number;
	messagesTokens: number;
}

/** get_context_report result. `contextWindow` 0 (and `model` empty) = no model selected. */
export interface RpcContextReportResult {
	breakdown?: RpcContextUsageBreakdown;
	contextWindow: number;
	model: string;
}

/** share_session result. `truncated` rides only when content was trimmed to fit the share budget. */
export interface RpcShareSessionResult {
	url: string;
	truncated?: boolean;
}

/** Provenance of one active tool (get_active_tools). Plugin-shipped tools surface as `extension`. */
export type RpcToolSource = "builtin" | "mcp" | "extension" | "plugin";

export interface RpcActiveTool {
	name: string;
	description?: string;
	source: RpcToolSource;
}

/** Result of get_active_tools: active top-level tools, then xd:// mounted entries. */
export interface RpcActiveToolsResult {
	tools: RpcActiveTool[];
}

/** Result of set_prewalk: the armed state after the toggle. */
export interface RpcPrewalkState {
	enabled: boolean;
}

/** Result of shake_context. `removed` is the one-line operator summary (TUI formatShakeSummary). */
export interface RpcShakeContextResult {
	removed: string;
}

/** Result of reload_plugins: post-reload inventory counts. */
export interface RpcReloadPluginsResult {
	plugins: number;
	skills: number;
	commands: number;
}

/** Result of set_force_tool / get_force_tool: the pending forced tool, or null. */
export interface RpcForceToolState {
	tool: string | null;
}

/** One async background job, as carried by the agent's job snapshot. */
export interface RpcAsyncJobItem {
	id: string;
	type: "bash" | "task";
	status: "running" | "completed" | "failed" | "cancelled";
	label: string;
	/** Epoch ms when the job started. */
	startTime: number;
}

/** get_jobs result: running jobs first, then recent (TUI /jobs ordering). */
export interface RpcJobsResult {
	jobs: RpcAsyncJobItem[];
}

export type RpcResponse = RpcResponseSuccess | RpcResponseError;

export type RpcDebugAction =
	| "launch"
	| "attach"
	| "set_breakpoint"
	| "remove_breakpoint"
	| "set_instruction_breakpoint"
	| "remove_instruction_breakpoint"
	| "data_breakpoint_info"
	| "set_data_breakpoint"
	| "remove_data_breakpoint"
	| "continue"
	| "step_over"
	| "step_in"
	| "step_out"
	| "pause"
	| "evaluate"
	| "stack_trace"
	| "threads"
	| "scopes"
	| "variables"
	| "disassemble"
	| "read_memory"
	| "write_memory"
	| "modules"
	| "loaded_sources"
	| "custom_request"
	| "output"
	| "terminate"
	| "sessions";

export interface RpcDebugParams {
	action: RpcDebugAction;
	program?: string;
	args?: string[];
	adapter?: string;
	cwd?: string;
	file?: string;
	line?: number;
	function?: string;
	name?: string;
	condition?: string;
	hit_condition?: string;
	expression?: string;
	context?: string;
	frame_id?: number;
	scope_id?: number;
	variable_ref?: number;
	pid?: number;
	port?: number;
	host?: string;
	levels?: number;
	memory_reference?: string;
	instruction_reference?: string;
	instruction_count?: number;
	instruction_offset?: number;
	count?: number;
	data?: string;
	data_id?: string;
	access_type?: "read" | "write" | "readWrite";
	command?: string;
	arguments?: Record<string, unknown>;
	offset?: number;
	resolve_symbols?: boolean;
	allow_partial?: boolean;
	start_module?: number;
	module_count?: number;
	timeout?: number;
}

export interface RpcLiveTranscript {
	role: "user" | "assistant";
	text: string;
	turn: number;
	final: boolean;
}

export interface RpcLiveState {
	active: boolean;
	phase: "connecting" | "listening" | "working" | "speaking" | "muted" | "error";
	muted: boolean;
	inputLevel: number;
	outputLevel: number;
	transcript?: RpcLiveTranscript;
	error?: string;
}

export interface RpcLiveUpdateFrame {
	type: "live_update";
	state: RpcLiveState;
}

export interface RpcCollabParticipant {
	name: string;
	role: "host" | "guest";
	readOnly?: boolean;
}

export interface RpcCollabState {
	role: "host" | "guest" | null;
	readOnly: boolean;
	link?: string;
	viewLink?: string;
	webLink?: string;
	webViewLink?: string;
	participants: RpcCollabParticipant[];
}

// ============================================================================
// Queue Management (get_queue / queue_edit / queue_remove / queue_move / queue_clear)
// ============================================================================

/**
 * One user-restorable queued message surfaced by get_queue. `id` is the
 * stable per-entry queue id assigned at enqueue time, valid for queue
 * operations until the entry is consumed or removed. `editable` distinguishes
 * plain user prompts from structured command payloads.
 */
export interface RpcQueuedMessage {
	id: string;
	text: string;
	images?: ImageContent[];
	editable: boolean;
	timestamp: number;
}

/** get_queue result: both lanes in visible execution order. */
export interface RpcGetQueueResult {
	steering: RpcQueuedMessage[];
	followUp: RpcQueuedMessage[];
}

/** queue_edit result. */
export interface RpcQueueEditResult {
	updated: true;
}

/** queue_remove result. */
export interface RpcQueueRemoveResult {
	removed: true;
}

/** queue_move result: the entry's lane and final visible index. */
export interface RpcQueueMoveResult {
	lane: "steering" | "followUp";
	index: number;
}

/** queue_clear result: count of user-restorable messages removed. */
export interface RpcQueueClearResult {
	removed: number;
}

// ============================================================================
// Domain inspection results (read-only)
// ============================================================================

/** A discoverable skill with its session enable state. */
export interface RpcSkillInfo {
	name: string;
	description: string;
	/** "<provider>:<level>", e.g. "native:project", "claude:user". */
	source: string;
	enabled: boolean;
	location: string;
	provider: string;
	providerName: string;
	level: "user" | "project" | "native";
	managed: boolean;
	hidden: boolean;
}
export interface RpcSkillsResult {
	skills: RpcSkillInfo[];
}
export interface RpcSkillDetail extends RpcSkillInfo {
	body: string;
}
export interface RpcManageSkillResult {
	action: "create" | "update" | "delete";
	name: string;
}

/** A discovered pre/post tool hook. */
export interface RpcHookInfo {
	/** Stable id used by `disabledExtensions`: "hook:<type>:<tool>:<name>". */
	id: string;
	name: string;
	/** Hook event: "<pre|post>:<tool>", e.g. "pre:bash". */
	event: string;
	enabled: boolean;
	source: string;
	path: string;
}
export interface RpcHooksResult {
	hooks: RpcHookInfo[];
}

/** A configured or discovered MCP server with live connection state. */
export interface RpcMcpServerInfo {
	name: string;
	transport: "stdio" | "http" | "sse" | "unknown";
	status: "connected" | "connecting" | "disconnected";
	toolCount: number;
	enabled: boolean;
	authed: boolean;
	/** Config provenance (C1). */
	scope?: "user" | "project";
	/** stdio only. */
	command?: string;
	/** http/sse only. */
	url?: string;
	lastError?: string;
	authState?: "none" | "authorized" | "expired" | "required";
}
export interface RpcMcpServersResult {
	servers: RpcMcpServerInfo[];
}

/** Input for adding an MCP server (C1 wizard). */
export interface RpcMcpServerInput {
	transport: "stdio" | "http" | "sse";
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
}

/** One plugin listed by marketplace_action list_available (cache-backed). */
export interface RpcMarketplacePluginInfo {
	name: string;
	description?: string;
	version?: string;
	installed: boolean;
	/** Catalog metadata; each field is absent when the catalog entry omits it. */
	author?: string;
	license?: string;
	repository?: string;
	homepage?: string;
	category?: string;
	tags?: string[];
}

/** Plugin detail for the config editor (C1). Secret values are never included in `values`. */
export interface RpcPluginDetail {
	id: string;
	enabled: boolean;
	features: Array<{ id: string; description?: string; enabled: boolean }>;
	settingsSchema?: unknown;
	values: Record<string, unknown>;
	/** Keys with persisted values, including write-only secret settings. */
	configuredKeys: string[];
}

/** Theme tokens contributed by one enabled plugin's gui.theme asset. */
export interface RpcGuiThemeInfo {
	id: string;
	tokens: Record<string, string>;
}

/** Result of `get_gui_themes`: declarative GUI theme tokens from enabled plugins. */
export interface RpcGuiThemesResult {
	themes: RpcGuiThemeInfo[];
}

/** An installed plugin (npm package or marketplace install). */
export interface RpcPluginInfo {
	name: string;
	marketplace: string;
	enabled: boolean;
	version: string;
	id?: string;
	scope?: "user" | "project";
	shadowedBy?: "project";
}
export interface RpcPluginsResult {
	plugins: RpcPluginInfo[];
}

/** One session workspace root. Exactly one entry — the session cwd — is primary. */
export interface RpcWorkspaceDirectory {
	path: string;
	primary: boolean;
}

/**
 * Result of get_directories / add_directory / remove_directory: the session's
 * workspace roots, primary (cwd) first, additional directories in order.
 */
export interface RpcWorkspaceDirectoriesResult {
	directories: RpcWorkspaceDirectory[];
}

/**
 * Result of get_git_status: footer git segment state for the session cwd.
 * `isRepo` false outside a repository (counts zeroed, branch null).
 */
export interface RpcGitStatus {
	isRepo: boolean;
	branch: string | null;
	staged: number;
	unstaged: number;
	untracked: number;
}

/** Result of worktree_create: the materialized worktree + its new branch + the repo it forked from. */
export interface RpcWorktreeCreateResult {
	path: string;
	branch: string;
	baseCwd: string;
}

/** pr_repo: gh availability + the session cwd's GitHub repo, or the typed reason it's unusable. */
export type RpcPrRepo =
	| { available: true; repo: string; defaultBranch: string | null }
	| { available: false; reason: "gh_missing" | "not_a_repo" | "no_github_remote" };

/** pr_list row: one PR with rollup CI counts. */
export interface RpcPrListItem {
	number: number;
	title: string;
	url: string;
	isDraft: boolean;
	authorLogin: string;
	headRefName: string;
	baseRefName: string;
	additions: number;
	deletions: number;
	updatedAt: string;
	reviewDecision: string | null;
	checks: { success: number; failure: number; pending: number };
}

/** pr_get detail: everything rendered except per-file diff text (lazy pr_diff). */
export interface RpcPrDetail {
	number: number;
	title: string;
	url: string;
	isDraft: boolean;
	authorLogin: string;
	body: string;
	baseRefName: string;
	headRefName: string;
	mergeStateStatus: string;
	additions: number;
	deletions: number;
	reviewDecision: string | null;
	files: Array<{ path: string; changeType: string; additions: number; deletions: number }>;
	checks: Array<{ name: string; status: string; conclusion: string | null }>;
}

/** pr_draft / pr_create results. */
export interface RpcPrDraftResult {
	title: string;
	body: string;
}
export interface RpcPrCreateResult {
	url: string;
	number: number;
}

/** A configured marketplace source. */
export interface RpcMarketplaceInfo {
	name: string;
	source: string;
	pluginCount?: number;
}
export interface RpcMarketplacesResult {
	marketplaces: RpcMarketplaceInfo[];
}

/** A file-based prompt template. */
export interface RpcPromptTemplateInfo {
	name: string;
	description: string;
	source: string;
	argumentHint?: string;
}
export interface RpcPromptTemplatesResult {
	templates: RpcPromptTemplateInfo[];
}

/** Structured memory backend status (mirrors MemoryBackendStatus). */
export interface RpcMemoryStatus {
	active: boolean;
	writable: boolean;
	searchable: boolean;
	scope?: string;
	retainBank?: string;
	recallBanks?: string[];
	workingCount?: number;
	episodicCount?: number;
	tripleCount?: number;
	lastMemory?: string;
	lastRecall?: boolean;
	database?: string;
	message?: string;
	error?: string;
}
/** Read-only memory backend report. */
export interface RpcMemoryReport {
	backend: string;
	entryCount?: number;
	status?: RpcMemoryStatus;
	stats?: string;
	diagnosis?: string;
}

export type RpcSecurityDispositionStatus = "open" | "false_positive" | "accepted_risk" | "fixed" | "wont_fix";
export type RpcSecuritySeverityLevel = "critical" | "high" | "medium" | "low" | "informational";
export type RpcSecurityTargetInput =
	| { kind: "repository" }
	| { kind: "working_tree" }
	| { kind: "ref_diff"; baseRevision: string; headRevision: string };
export interface RpcSecurityFindingInfo {
	id: string;
	scanId: string;
	title: string;
	summary: string;
	severity: RpcSecuritySeverityLevel;
	confidence: "high" | "medium" | "low";
	path?: string;
	line?: number;
	disposition: RpcSecurityDispositionStatus;
	validation: "unvalidated" | "validated" | "rejected" | "partial" | "error";
	remediation?: string;
	evidence: Array<{ label: string; explanation: string; excerpt?: string; path?: string; line?: number }>;
}
export interface RpcSecurityScanInfo {
	id: string;
	status: "planned" | "running" | "completed" | "partial" | "cancelled" | "failed";
	createdAt: string;
	completedAt?: string;
	producer: string;
	findingCount: number;
	target: {
		kind: "repository" | "scoped_path" | "ref_diff" | "working_tree" | "imported";
		displayName: string;
		revision?: string;
		baseRevision?: string;
		headRevision?: string;
	};
}
export interface RpcSecurityOperationInfo {
	operationId: string;
	planId: string;
	scanId: string;
	phase: "queued" | "preparing" | "reviewing" | "publishing" | "completed" | "partial" | "cancelled" | "failed";
	createdAt: string;
	updatedAt: string;
	findingCount: number;
	error?: string;
}
export interface RpcSecurityDashboardResult {
	enabled: boolean;
	modelReady: boolean;
	modelLabel?: string;
	repositoryRoot: string;
	revision?: string;
	scans: RpcSecurityScanInfo[];
	operations: RpcSecurityOperationInfo[];
	latest?: RpcSecurityScanResult;
}
export interface RpcSecurityScanResult {
	scan: RpcSecurityScanInfo;
	findings: RpcSecurityFindingInfo[];
}
export interface RpcSshHostInput {
	host: string;
	username?: string;
	port?: number;
	keyPath?: string;
	description?: string;
	compat?: boolean;
}
export interface RpcSshHostInfo extends RpcSshHostInput {
	name: string;
	scope: "user" | "project" | "native";
	editable: boolean;
	source: string;
	os?: "windows" | "linux" | "macos" | "unknown";
	shell?: "cmd" | "powershell" | "bash" | "zsh" | "sh" | "unknown";
	compatShell?: "bash" | "sh";
	transferShell?: "sh" | "bash" | "zsh";
}
export interface RpcSshHostsResult {
	openSshAvailable: boolean;
	hosts: RpcSshHostInfo[];
	warnings: string[];
}
export interface RpcSshTestResult {
	name: string;
	ok: boolean;
	checkedAt: string;
	os?: RpcSshHostInfo["os"];
	shell?: RpcSshHostInfo["shell"];
	compatShell?: RpcSshHostInfo["compatShell"];
	transferShell?: RpcSshHostInfo["transferShell"];
	error?: string;
}
export interface RpcOmpUpdateResult {
	currentVersion: string;
	latestVersion: string;
	updateAvailable: boolean;
	checkedAt: string;
	distribution: "bundled";
	installStrategy: "gui-update";
}

/** A node in the session's branch tree (visual session navigation). */
export interface RpcSessionTreeNode {
	entryId: string;
	parentId: string | null;
	role: "user" | "assistant" | "system";
	textPreview: string;
	timestamp: number;
	label?: string;
	onActiveBranch: boolean;
	isLeaf: boolean;
}
export interface RpcSessionTreeResult {
	tree: RpcSessionTreeNode[];
	activeLeafId: string | null;
}

export interface RpcThemeInfo {
	name: string;
	path?: string;
}
export interface RpcThemesResult {
	themes: RpcThemeInfo[];
}

/** A UI theme's resolved colors as CSS hex strings, keyed by theme token (accent, statusLineBg, …). */
export interface RpcThemeColorsResult {
	name: string;
	colors: Record<string, string>;
}

export interface RpcVibeModeState {
	enabled: boolean;
	killedWorkers?: number;
}
export interface RpcGoalState {
	enabled: boolean;
	status: string;
	objective?: string;
	tokenBudget?: number | null;
	tokensUsed?: number;
	timeUsedSeconds?: number;
	mode?: string;
}
export type RpcLoopLimit =
	| { kind: "iterations"; initial: number; remaining: number }
	| { kind: "duration"; durationMs: number; deadlineMs: number };
export interface RpcLoopModeState {
	enabled: boolean;
	state: "off" | "waiting" | "running" | "paused";
	prompt?: string;
	limit?: RpcLoopLimit;
}

// ============================================================================
// Ready Frame
// ============================================================================

export interface RpcReadyFrame {
	type: "ready";
	protocolVersion: number;
	supportedProtocolVersions: number[];
	maxFrameBytes: number;
	maxReassembledFrameBytes: number;
}

// ============================================================================
// Chunk Frame (v2 transport)
// ============================================================================

export interface RpcChunkFrame {
	type: "rpc_chunk";
	chunkId: string;
	index: number;
	count: number;
	byteLength: number;
	data: string; // base64
}

// ============================================================================
// Session State
// ============================================================================

export interface ContextUsage {
	tokens: number;
	contextWindow: number;
	percent: number;
}

export interface ModelInfo {
	provider: string;
	id: string;
	/** Present on the wire (get_available_models / get_state carry full Model
	 * objects) — used by the picker to flag over-context switches. */
	contextWindow?: number | null;
}

export interface RpcSessionState {
	model: ModelInfo | null;
	thinkingLevel: ThinkingLevel | undefined;
	/** Configured selector: "auto" while auto mode is active, else the effective level. */
	thinkingConfigured?: ThinkingLevel | "auto";
	/** Levels the active model supports (empty = no reasoning); the picker must not offer unsupported values. */
	availableThinkingLevels?: ThinkingLevel[];
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	interruptMode: "immediate" | "wait";
	sessionFile: string | null;
	cwd: string;
	sessionId: string;
	sessionName: string | null;
	fastModeEnabled: boolean;
	fastModeActive: boolean;
	tokensPerSecond: number | null;
	autoCompactionEnabled: boolean;
	autoRetryEnabled: boolean;
	messageCount: number;
	queuedMessageCount: number;
	todoPhases: TodoPhase[];
	systemPrompt: string[];
	dumpTools: ToolDump[];
	contextUsage: ContextUsage | null;
	planModeEnabled: boolean;
	/** Whether a prewalk model switch is armed and waiting for the first edit/write. */
	prewalkArmed?: boolean;
	agentsPaused: boolean;
	agentsPausedAt?: number;
	/** Session kind. Absent = agent; chat sessions are tool-free. */
	kind?: "chat";
}

/** Authoritative selector/effective pair returned after set_thinking_level. */
export interface RpcThinkingLevelState {
	thinkingLevel: ThinkingLevel | undefined;
	thinkingConfigured: ThinkingLevel | "auto" | undefined;
}

export interface ToolDump {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface CopyTarget {
	id: string;
	label: string;
	hint?: string;
	preview: string;
	language?: string;
	content?: string;
	copyMessage?: string;
	children?: CopyTarget[];
}

// ============================================================================
// Extension UI
// ============================================================================

export interface ExtensionAskDialogOption {
	label: string;
	description?: string;
	preview?: string;
}
export interface ExtensionAskDialogQuestion {
	id: string;
	question: string;
	header?: string;
	options: ExtensionAskDialogOption[];
	multi?: boolean;
	recommended?: number;
}
export interface ExtensionAskDialogResultItem {
	id: string;
	question: string;
	options: string[];
	multi: boolean;
	selectedOptions: string[];
	customInput?: string;
	note?: string;
	timedOut?: boolean;
}
export interface ExtensionAskDialogSubmitResult {
	kind: "submit";
	results: ExtensionAskDialogResultItem[];
}
export interface ExtensionAskDialogChatResult {
	kind: "chat";
}
export type ExtensionAskDialogResult = ExtensionAskDialogSubmitResult | ExtensionAskDialogChatResult;

export type ExtensionUIRequest =
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
	| {
			type: "extension_ui_request";
			id: string;
			method: "askDialog";
			questions: ExtensionAskDialogQuestion[];
			timeout?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "input";
			title: string;
			placeholder?: string;
			timeout?: number;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "editor";
			title: string;
			prefill?: string;
			promptStyle?: boolean;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "notify";
			message: string;
			notifyType?: "info" | "warning" | "error";
	  }
	| { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText?: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setWidget";
			widgetKey: string;
			widgetLines?: string[];
			widgetPlacement?: string;
	  }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "set_editor_text";
			text: string;
			images?: ImageContent[];
			prepend?: boolean;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "open_url";
			url: string;
			launchUrl?: string;
			instructions?: string;
	  }
	| { type: "extension_ui_request"; id: string; method: "cancel"; targetId: string };

export type ExtensionUIResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; askDialog: ExtensionAskDialogResult }
	| { type: "extension_ui_response"; id: string; cancelled: true; timedOut?: boolean };

// ============================================================================
// Host Tools & URIs
// ============================================================================

export interface HostToolDefinition {
	name: string;
	label?: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface HostToolCallRequest {
	type: "host_tool_call";
	/** Snowflake request id the host echoes back in host_tool_result. */
	id: string;
	toolCallId: string;
	toolName: string;
	arguments: Record<string, unknown>;
}

export interface HostToolCancelRequest {
	type: "host_tool_cancel";
	id: string;
	targetId: string;
}

/** Sent by the host to complete a pending host tool call. */
export interface HostToolResult {
	type: "host_tool_result";
	id: string;
	result?: string;
	error?: string;
}

/** Sent by the host to stream a partial tool update. */
export interface HostToolUpdate {
	type: "host_tool_update";
	id: string;
	update: string;
}

export interface HostUriSchemeDefinition {
	scheme: string;
	description: string;
	writable?: boolean;
	immutable?: boolean;
}

export interface HostUriRequest {
	type: "host_uri_request";
	id: string;
	operation: "read" | "write";
	url: string;
	/** Present for write operations. */
	content?: string;
}

export interface HostUriCancelRequest {
	type: "host_uri_cancel";
	id: string;
	targetId: string;
}

/** Sent by the host to complete a pending URI request. */
export interface HostUriResult {
	type: "host_uri_result";
	id: string;
	content?: string;
	error?: string;
}

// ============================================================================
// Subagents
// ============================================================================
export type AgentSource = "bundled" | "user" | "project";
export type SubagentSubscriptionLevel = "off" | "progress" | "events";

export interface SubagentSnapshot {
	id: string;
	index: number;
	agent: string;
	agentSource?: AgentSource;
	description?: string;
	status: string;
	/** False when a registry ref claims running but has no turn in flight. */
	live?: boolean;
	task?: string;
	assignment?: string;
	sessionFile?: string;
	lastUpdate: number;
	progress?: AgentProgress;
	parentToolCallId?: string;
	/** Present when spawned by another subagent (absent = root spawn from main session). */
	parentSubagentId?: string;
	kind?: "sub" | "advisor";
}

export interface RpcAgentDefinitionInfo {
	name: string;
	description: string;
	source: "bundled" | "user" | "project";
	filePath?: string;
	model?: string[];
	thinkingLevel?: string;
	tools?: string[];
	spawns?: string[] | "*";
	autoloadSkills?: string[];
	output?: unknown;
	blocking?: boolean;
	readSummarize?: boolean;
	prewalk?: boolean | string;
	defaultPatterns: string[];
	defaultResolved?: string;
	effectivePatterns: string[];
	effectiveResolved?: string;
	effectiveThinkingLevel?: string;
	prewalkPattern?: string;
	prewalkResolved?: string;
}

export interface RpcAgentDefinitionsResult {
	agents: RpcAgentDefinitionInfo[];
}

export interface AgentProgress {
	index: number;
	id: string;
	agent: string;
	agentSource: AgentSource;
	status: "pending" | "running" | "completed" | "failed" | "aborted";
	task: string;
	assignment?: string;
	description?: string;
	lastIntent?: string;
	currentTool?: string;
	currentToolArgs?: string;
	currentToolStartMs?: number;
	recentTools: Array<{ tool: string; args: string; endMs: number }>;
	recentOutput: string[];
	toolCount: number;
	requests: number;
	tokens: number;
	contextTokens?: number;
	contextWindow?: number;
	cost: number;
	durationMs: number;
	modelOverride?: string | string[];
	modelRole?: string;
	resolvedModel?: string;
	resolvedModelIsFallback?: boolean;
	extractedToolData?: Record<string, unknown[]>;
	retryState?: {
		attempt: number;
		maxAttempts: number;
		delayMs: number;
		errorMessage: string;
		startedAtMs: number;
	};
	retryFailure?: { attempt: number; errorMessage: string };
	inflightTaskDetails?: unknown;
}

export interface SubagentLifecyclePayload {
	id: string;
	agent: string;
	agentSource: AgentSource;
	description?: string;
	status: "started" | "completed" | "failed" | "aborted";
	sessionFile?: string;
	parentToolCallId?: string;
	parentSubagentId?: string;
	index: number;
	detached?: boolean;
}

export interface SubagentProgressPayload {
	index: number;
	agent: string;
	agentSource: AgentSource;
	task: string;
	parentToolCallId?: string;
	parentSubagentId?: string;
	assignment?: string;
	progress: AgentProgress;
	sessionFile?: string;
	detached?: boolean;
}

export interface SubagentLifecycleFrame {
	type: "subagent_lifecycle";
	payload: SubagentLifecyclePayload;
}

export interface SubagentProgressFrame {
	type: "subagent_progress";
	payload: SubagentProgressPayload;
}

export interface SubagentEventFrame {
	type: "subagent_event";
	payload: { id: string; event: AgentSessionEvent };
}

export type SubagentFrame = SubagentLifecycleFrame | SubagentProgressFrame | SubagentEventFrame;

// ============================================================================
// Shared Value Types
// ============================================================================

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Extension-UI methods that block until the user responds — the "waiting for
 * input" surfaces (approval/ask flows). Used by the notification gate and the
 * sidebar's waiting-for-confirmation signal.
 */
export const BLOCKING_UI_METHODS: Record<string, true> = {
	select: true,
	confirm: true,
	askDialog: true,
	input: true,
	editor: true,
	open_url: true,
};

/** All levels in ascending effort order (picker menus, cycle parity). */
export const THINKING_LEVEL_VALUES: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/** Runtime narrowing for wire values (thinking_level_changed.configured, get_state). */
export function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && (THINKING_LEVEL_VALUES as readonly string[]).includes(value);
}

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export interface TodoPhase {
	name: string;
	tasks: TodoTask[];
}

export interface TodoTask {
	content: string;
	status: "pending" | "in_progress" | "completed" | "abandoned" | "blocked";
}

// ============================================================================
// Messages (simplified wire format)
// ============================================================================

export interface AgentMessage {
	/** Persisted OMP session-tree node id, present on user/assistant transcript messages. */
	entryId?: string;
	role:
		| "user"
		| "assistant"
		| "system"
		| "toolResult"
		| "bashExecution"
		| "pythonExecution"
		| "custom"
		| "hookMessage"
		| "branchSummary"
		| "compactionSummary"
		| "fileMention";
	content?: MessageContent[] | string;
	steering?: boolean;
	stopReason?: string;
	errorMessage?: string;
	errorId?: number;
	timestamp?: string | number;
	command?: string;
	code?: string;
	output?: string;
	exitCode?: number;
	cancelled?: boolean;
	truncated?: boolean;
	toolCallId?: string;
	toolName?: string;
	details?: unknown;
	isError?: boolean;
	excludeFromContext?: boolean;
	/** Time to first token (ms), sibling of `duration` on assistant messages — rides the wire via event passthrough (event-controller.ts:1258). */
	ttft?: number;
	customType?: string;
	display?: boolean;
	summary?: string;
	shortSummary?: string;
	tokensBefore?: number;
	tokensAfter?: number;
	method?: string;
	files?: Array<{
		path: string;
		content: string;
		lineCount?: number;
		byteSize?: number;
		skippedReason?: "tooLarge" | "binary";
		image?: ImageContent;
	}>;
	[key: string]: unknown;
}

export type MessageContent = TextContent | ImageContent | ThinkingContent | ToolCallContent;

export interface TextContent {
	type: "text";
	text: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
}

export interface ToolCallContent {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	partialArgs?: string;
	streamIndex?: number;
	intent?: string;
}

// ============================================================================
// Messages Page
// ============================================================================

export interface MessagesPage {
	messages: AgentMessage[];
	totalMessages: number;
	nextCursor?: string;
}

// ============================================================================
// Available Commands
// ============================================================================

export interface AvailableCommand {
	name: string;
	description: string;
	aliases?: string[];
	/** Input hint (ghost text) for commands that take a simple argument. */
	input?: { hint?: string };
	/** Declarative subcommands for dropdown completion (e.g. /mcp add). */
	subcommands?: Array<{ name: string; description?: string; usage?: string }>;
	/** Where the command came from (builtin, skill, extension, custom, mcp_prompt, file). */
	source?: string;
	/** Whether the command consumes text after its name (drives post-space completion). */
	allowArgs?: boolean;
	/** Whether dynamic candidates exist via get_command_arg_completions. */
	hasDynamicArgCompletion?: boolean;
	/** False for builtins that require a native GUI/TUI surface. */
	textModeExecutable?: boolean;
}

// ============================================================================
// Login Providers
// ============================================================================

export interface LoginProvider {
	id: string;
	name: string;
	available: boolean;
	authenticated: boolean;
}

// ============================================================================
// Usage (provider quotas + local session tallies)
// ============================================================================

export interface UsageLimit {
	id: string;
	label: string;
	usedFraction?: number;
	used?: number;
	limit?: number;
	unit?: string;
	remainingFraction?: number;
	windowLabel?: string;
	resetsAt?: number;
	status?: string;
	notes?: string[];
}

export interface UsageReport {
	provider: string;
	fetchedAt: number;
	limits: UsageLimit[];
	notes?: string[];
	account?: string;
	resetCreditsAvailable?: number;
}

export interface UsageSessionStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	orchestrationTokens: number;
	premiumRequests: number;
	cost: number;
}

export interface UsageResult {
	reports: UsageReport[];
	session: UsageSessionStats;
}

// ============================================================================
// Settings schema
// ============================================================================

export interface SettingEntry {
	path: string;
	type: "boolean" | "string" | "number" | "enum" | "array" | "record";
	value: unknown;
	default: unknown;
	label?: string;
	description?: string;
	tab?: string;
	group?: string;
	options?: Array<{ value: string; label: string; description?: string }>;
	secret?: boolean;
	advanced?: boolean;
	/** Visibility gate name; hidden only when the GUI can evaluate it to false. */
	condition?: string;
	/** True when array order is meaningful and the editor supports reordering. */
	ordered?: boolean;
	/** True when the setting only affects TUI chrome — the GUI hides it. */
	tuiOnly?: boolean;
	/** True when the value is cached at session construction — edits need a sidecar restart. */
	restartRequired?: boolean;
}

export interface SettingsSchemaResult {
	entries: SettingEntry[];
	tabs: Array<{ id: string; label: string; groups: string[] }>;
}

// ============================================================================
// Providers
// ============================================================================

export interface ProviderInfo {
	id: string;
	name: string;
	authenticated: boolean;
	authKind?: "oauth" | "apikey" | "env";
	account?: string;
	loginAvailable: boolean;
	disabled: boolean;
	baseUrl?: string;
	modelCount: number;
}

export type ProviderDiscoveryStatus = "idle" | "ok" | "empty" | "cached" | "unavailable" | "unauthenticated";

export interface ProviderDiscoveryState {
	provider: string;
	status: ProviderDiscoveryStatus;
	optional: boolean;
	stale: boolean;
	fetchedAt?: number;
	models: string[];
	error?: string;
}

export interface AvailableModelsResult {
	models: ModelInfo[];
	discoveryStates: ProviderDiscoveryState[];
	refreshPending: boolean;
	generation: number;
}

export interface ProvidersResult {
	providers: ProviderInfo[];
	models: ModelInfo[];
	discoveryStates: ProviderDiscoveryState[];
	refreshPending: boolean;
	generation: number;
}

export interface ModelCatalogUpdateFrame extends AvailableModelsResult {
	type: "model_catalog_update";
	providers: ProviderInfo[];
}

// ============================================================================
// Plan Mode
// ============================================================================

export interface PlanModeState {
	enabled: boolean;
	planFilePath?: string;
}

// ============================================================================
// Model Roles
// ============================================================================

export interface ModelRoleEntry {
	id: string;
	name: string;
	tag: string;
	color: string;
	model?: string;
	source: string;
}

export interface ModelRolesResult {
	roles: ModelRoleEntry[];
}

export interface ModelRoleMetadata {
	id: string;
	name: string;
	tag: string;
	color: string;
	hidden?: boolean;
}

export interface ModelRoleMetadataResult {
	roles: ModelRoleMetadata[];
}

// ============================================================================
// Session Stats
// ============================================================================

export interface SessionStats {
	sessionFile?: string;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		reasoning: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	premiumRequests: number;
	cost: number;
	contextUsage?: ContextUsage;
}

// ============================================================================
// Voice (speech in/out)
// ============================================================================

/** Result of `transcribe_audio`: the recognized utterance. */
export interface TranscribeAudioResult {
	text: string;
}

/** Result of `synthesize_speech`: local TTS output as base64 WAV (PCM16). */
export interface SynthesizeSpeechResult {
	audioBase64: string;
	mimeType: string;
}

// ============================================================================
// Outbound Frame Union (everything omp can emit on stdout)
// ============================================================================

export type OutboundFrame =
	| RpcReadyFrame
	| RpcResponse
	| RpcChunkFrame
	| AgentSessionEvent
	| ExtensionUIRequest
	| HostToolCallRequest
	| HostToolCancelRequest
	| HostUriRequest
	| HostUriCancelRequest
	| SubagentFrame
	| AvailableCommandsUpdateFrame
	| PromptResultFrame
	| CommandOutputFrame
	| SessionInfoUpdateFrame
	| ConfigUpdateFrame
	| RpcLiveUpdateFrame
	| ModelCatalogUpdateFrame
	| ExtensionErrorFrame;

export interface AvailableCommandsUpdateFrame {
	type: "available_commands_update";
	commands: AvailableCommand[];
}

/** Result of switch_leaf (session.navigateTree passthrough + the leaf after the move). */
export interface RpcSwitchLeafResult {
	cancelled: boolean;
	aborted?: boolean;
	reopenAsk?: { toolCallId: string; questions: unknown };
	editorText?: string;
	editorImages?: ImageContent[];
	activeLeafId?: string;
	askReanswerCommitted?: boolean;
}

/** Lightweight metadata of one Claude/Codex session offered for import. */
export interface RpcForeignSessionInfo {
	id: string;
	path: string;
	cwd: string;
	title?: string;
	created: string;
	modified: string;
	messageCount?: number;
	firstMessage?: string;
}

export interface PromptResultFrame {
	type: "prompt_result";
	id?: string;
	agentInvoked: boolean;
}

export interface CommandOutputFrame {
	type: "command_output";
	text: string;
}

export interface SessionInfoUpdateFrame {
	type: "session_info_update";
	title?: string | null;
	sessionId?: string;
}

export interface ConfigUpdateFrame {
	type: "config_update";
	[key: string]: unknown;
}

export interface ExtensionErrorFrame {
	type: "extension_error";
	extensionPath: string;
	event: string;
	error: string;
}

// ============================================================================
// AgentSessionEvent (24 types)
// ============================================================================

export type AgentSessionEvent =
	| { type: "agent_start"; sessionId?: string }
	| { type: "agent_end"; messages?: AgentMessage[]; isTerminal?: boolean; telemetry?: unknown; coverage?: unknown }
	| { type: "turn_start" }
	| { type: "turn_end"; message?: AgentMessage; toolResults?: unknown[] }
	| { type: "message_start"; message: AgentMessage }
	| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	| {
			type: "tool_execution_start";
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
			intent?: string;
	  }
	| {
			type: "tool_execution_update";
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
			partialResult: unknown;
	  }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError?: boolean }
	| { type: "auto_compaction_start"; reason: "threshold" | "overflow" | "idle" | "incomplete"; action: string }
	| {
			type: "auto_compaction_end";
			action: string;
			result: unknown;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
			skipped?: boolean;
	  }
	| {
			type: "auto_retry_start";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
			errorMessage: string;
			errorId?: number;
	  }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string; recoveredErrors?: unknown[] }
	| { type: "retry_fallback_applied"; from: string; to: string; role: string }
	| { type: "retry_fallback_succeeded"; model: string; role: string }
	| { type: "model_changed" }
	| { type: "ttsr_triggered"; rules: unknown[] }
	| { type: "todo_reminder"; todos: TodoTask[]; attempt: number; maxAttempts: number }
	| { type: "todo_auto_clear" }
	| { type: "irc_message"; message: unknown }
	| { type: "notice"; level: "info" | "warning" | "error"; message: string; source?: string }
	| {
			type: "thinking_level_changed";
			thinkingLevel: ThinkingLevel | undefined;
			configured?: string;
			resolved?: string;
	  }
	| { type: "goal_updated"; goal: unknown; state?: unknown }
	| {
			type: "plan_proposal";
			planFilePath: string;
			title?: string;
			suggestedFileName?: string;
			planContent: string;
			options: string[];
	  }
	| { type: "loop_mode_update"; state: RpcLoopModeState }
	// Authoritative queue snapshot after every queue mutation (enqueue,
	// drain/consume, remove, move, clear, dequeue restore). The queue store
	// treats this as the update channel; get_queue is only a hydrate fallback.
	| { type: "queue_update"; steering: RpcQueuedMessage[]; followUp: RpcQueuedMessage[] };

export type AssistantMessageEvent =
	| { type: "text_delta"; contentIndex: number; delta: string; partial: AgentMessage }
	| { type: "thinking_delta"; contentIndex: number; delta: string; partial: AgentMessage }
	| { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AgentMessage };

// ============================================================================
// Sidecar Status
// ============================================================================

export type SidecarStatus = "starting" | "ready" | "exited" | "error" | "restarting";
