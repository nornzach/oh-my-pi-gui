/**
 * Preload script: exposes the OmpApi on window.omp via contextBridge.
 * All RPC commands delegate to ipcRenderer.invoke(IPC_COMMANDS.RPC_COMMAND, ...).
 * Event subscriptions return unsubscribe functions.
 */
import { contextBridge, ipcRenderer } from "electron";
import type {
	CustomProviderInput,
	CustomProviderView,
	DeepLinkPayload,
	IpcActiveTabEnvelope,
	IpcBenchmarkRunOptions,
	IpcBenchmarkRunResult,
	IpcFsListResult,
	IpcFsReadImageResult,
	IpcFsReadPlanPayload,
	IpcFsReadPlanResult,
	IpcFsReadResult,
	IpcOpenPathResult,
	IpcSessionOpenNewWindowPayload,
	IpcSessionOwner,
	IpcSidecarRestartPayload,
	IpcSidecarStatusPayload,
	IpcSpawnTabPayload,
	IpcSpawnTabResult,
	IpcTabInfo,
	IpcTabStatusPayload,
	MenuAction,
	MenuActionPayload,
	OmpApi,
	RunProgressState,
	RuntimeErrorReport,
	SessionInfo,
	TrayState,
	UpdateStatus,
} from "../shared/ipc-types";
import { IPC_COMMANDS, IPC_EVENTS } from "../shared/ipc-types";
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
	SubagentFrame,
	ThinkingLevel,
	TodoPhase,
} from "../shared/rpc-types";

function rpcCommand(cmd: RpcCommand, timeoutMs?: number): Promise<RpcResponse> {
	return ipcRenderer.invoke(IPC_COMMANDS.RPC_COMMAND, {
		command: cmd,
		timeoutMs: timeoutMs ?? timeoutForCommand(cmd),
	});
}

/**
 * Commands below resolve only after long-running model, OAuth, transcript, or
 * human-interaction work finishes. The 8s default would report a false
 * timeout while the sidecar keeps mutating state, so these get windows at
 * least as large as their server-side budgets. Fast commands keep the default.
 */
const RPC_COMMAND_TIMEOUTS: Record<string, number> = {
	bash: 660_000,
	eval: 660_000,
	compact: 660_000,
	export_html: 120_000,
	handoff: 660_000,
	reload_plugins: 120_000,
	plan_approval: 660_000,
	switch_leaf: 660_000,
	login: 660_000,
	get_transcript: 30_000,
	get_messages: 30_000,
	get_messages_page: 30_000,
};

function timeoutForCommand(cmd: RpcCommand): number | undefined {
	return RPC_COMMAND_TIMEOUTS[cmd.type];
}

function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
	const listener = (_event: Electron.IpcRendererEvent, data: T) => callback(data);
	ipcRenderer.on(channel, listener);
	return () => {
		ipcRenderer.removeListener(channel, listener);
	};
}

let activeTabId: string | null = null;

function subscribeActiveTab<T>(channel: string, callback: (data: T) => void): () => void {
	return subscribe<IpcActiveTabEnvelope<T>>(channel, envelope => {
		if (activeTabId === null || envelope.tabId === activeTabId) callback(envelope.payload);
	});
}

const api: OmpApi = {
	runtime: {
		report: (error: RuntimeErrorReport) => ipcRenderer.send(IPC_COMMANDS.RUNTIME_ERROR_REPORT, error),
		logPath: () => ipcRenderer.invoke(IPC_COMMANDS.RUNTIME_LOG_PATH) as Promise<string>,
	},

	rpc: {
		command: (cmd: RpcCommand, timeoutMs?: number) => rpcCommand(cmd, timeoutMs),
		commandForTab: (tabId: string, cmd: RpcCommand, timeoutMs?: number) =>
			ipcRenderer.invoke(IPC_COMMANDS.RPC_COMMAND_FOR_TAB, {
				tabId,
				command: cmd,
				timeoutMs,
			}) as Promise<RpcResponse>,
		getState: () => ipcRenderer.invoke(IPC_COMMANDS.RPC_COMMAND, { command: { type: "get_state" } }),
		prompt: (message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp") =>
			rpcCommand({ type: "prompt", message, images, streamingBehavior }),
		steer: (message: string, images?: ImageContent[]) => rpcCommand({ type: "steer", message, images }),
		followUp: (message: string, images?: ImageContent[]) => rpcCommand({ type: "follow_up", message, images }),
		abort: () => rpcCommand({ type: "abort" }),
		abortAndPrompt: (message: string) => rpcCommand({ type: "abort_and_prompt", message }),
		newSession: (parentSession?: string) => rpcCommand({ type: "new_session", parentSession }),
		dropSession: () => rpcCommand({ type: "drop_session" }),
		switchSession: (sessionPath: string) => rpcCommand({ type: "switch_session", sessionPath }),
		branch: (entryId: string) => rpcCommand({ type: "branch", entryId }),
		fork: () => rpcCommand({ type: "fork" }),
		eval: (code: string, language?: "python" | "js" | "ruby" | "julia", excluded?: boolean) =>
			rpcCommand({ type: "eval", code, language, excluded }),
		abortEval: () => rpcCommand({ type: "abort_eval" }),
		dequeue: () => rpcCommand({ type: "dequeue" }),
		getQueue: () => rpcCommand({ type: "get_queue" }),
		queueEdit: (queueId: string, text: string) => rpcCommand({ type: "queue_edit", queueId, text }),
		queueRemove: (queueId: string) => rpcCommand({ type: "queue_remove", queueId }),
		queueMove: (queueId: string, toIndex: number, toLane?: "steering" | "followUp") =>
			rpcCommand({ type: "queue_move", queueId, toIndex, toLane }),
		queueClear: (lane?: "steering" | "followUp") => rpcCommand({ type: "queue_clear", lane }),
		setModel: (provider: string, modelId: string) => rpcCommand({ type: "set_model", provider, modelId }),
		cycleModel: (direction?: "forward" | "backward") => rpcCommand({ type: "cycle_model", direction }),
		retry: () => rpcCommand({ type: "retry" }),
		clearContext: () => rpcCommand({ type: "clear_context" }),
		abortSubagent: (agentId: string) => rpcCommand({ type: "abort_subagent", agentId }),
		reviveSubagent: (agentId: string) => rpcCommand({ type: "revive_subagent", agentId }),
		writeLocalPaste: (content: string) => rpcCommand({ type: "write_local_paste", content }),
		getActiveTools: () => rpcCommand({ type: "get_active_tools" }),
		setPrewalk: (enabled: boolean) => rpcCommand({ type: "set_prewalk", enabled }),
		fresh: () => rpcCommand({ type: "fresh" }),
		shakeContext: (mode: "elide" | "images" | "thinking") => rpcCommand({ type: "shake_context", mode }),
		reloadPlugins: () => rpcCommand({ type: "reload_plugins" }),
		setForceTool: (payload: { tool: string } | { clear: true }) => rpcCommand({ type: "set_force_tool", ...payload }),
		getForceTool: () => rpcCommand({ type: "get_force_tool" }),
		listForeignSessions: (source: "claude" | "codex") =>
			rpcCommand({ type: "list_foreign_sessions", source }, 60_000),
		importForeignSession: (source: "claude" | "codex", foreignId: string) =>
			rpcCommand({ type: "import_foreign_session", source, foreignId }, 120_000),
		forkFrom: (entryId: string) => rpcCommand({ type: "fork_from", entryId }),
		switchLeaf: (entryId: string, options?: { summarize?: boolean; customInstructions?: string }) =>
			rpcCommand({ type: "switch_leaf", entryId, ...options }),
		resumeAfterAskReanswer: () => rpcCommand({ type: "resume_after_ask_reanswer" }),
		getCommandArgCompletions: (command: string, prefix: string) =>
			rpcCommand({ type: "get_command_arg_completions", command, prefix }),
		mcpAdd: (name: string, config: RpcMcpServerInput, scope?: "user" | "project") =>
			rpcCommand({ type: "mcp_add", name, config, scope }, 60_000),
		mcpTest: (probe: { name?: string; config?: RpcMcpServerInput }) =>
			rpcCommand({ type: "mcp_test", ...probe }, 60_000),
		mcpReauth: (name: string) => rpcCommand({ type: "mcp_reauth", name }, 360_000),
		mcpReauthCancel: (name: string) => rpcCommand({ type: "mcp_reauth_cancel", name }, 10_000),
		marketplaceAction: (payload: {
			action: "add" | "remove" | "update" | "install" | "uninstall" | "upgrade" | "list_available";
			marketplace?: string;
			plugin?: string;
			source?: string;
		}) => rpcCommand({ type: "marketplace_action", ...payload }, 180_000),
		getPluginDetail: (pluginId: string) => rpcCommand({ type: "get_plugin_detail", pluginId }, 30_000),
		setPluginFeatures: (pluginId: string, features: string[]) =>
			rpcCommand({ type: "set_plugin_features", pluginId, features }),
		setPluginSetting: (pluginId: string, key: string, value: unknown) =>
			rpcCommand({ type: "set_plugin_setting", pluginId, key, value }),
		deletePluginSetting: (pluginId: string, key: string) =>
			rpcCommand({ type: "delete_plugin_setting", pluginId, key }),
		getDirectories: () => rpcCommand({ type: "get_directories" }),
		addDirectory: (path: string) => rpcCommand({ type: "add_directory", path }),
		removeDirectory: (path: string) => rpcCommand({ type: "remove_directory", path }),
		moveSession: (path: string) => rpcCommand({ type: "move_session", path }, 30_000),
		getGitStatus: () => rpcCommand({ type: "get_git_status" }),
		// Worktree mutations are background RPC commands — generous timeouts for
		// large repos (git worktree add copies the index, remove walks the tree).
		worktreeCreate: (name: string, options?: { baseCwd?: string; baseRef?: "HEAD" | "default" }) =>
			rpcCommand({ type: "worktree_create", name, baseCwd: options?.baseCwd, baseRef: options?.baseRef }, 120_000),
		worktreeRemove: (path: string, force?: boolean) => rpcCommand({ type: "worktree_remove", path, force }, 60_000),
		// PR Center (plan/21): all network ops, background dispatched sidecar-side.
		prRepo: () => rpcCommand({ type: "pr_repo" }),
		prList: (state?: "open" | "closed" | "merged" | "all", limit?: number) =>
			rpcCommand({ type: "pr_list", state, limit }, 60_000),
		prGet: (number: number) => rpcCommand({ type: "pr_get", number }, 60_000),
		prDiff: (number: number, path: string) => rpcCommand({ type: "pr_diff", number, path }, 60_000),
		prDraft: (options?: { base?: string; head?: string }) =>
			rpcCommand({ type: "pr_draft", base: options?.base, head: options?.head }, 180_000),
		prCreate: (input: { title: string; body: string; base?: string; head?: string; draft?: boolean }) =>
			rpcCommand({ type: "pr_create", ...input }, 120_000),
		prCheckout: (number: number) => rpcCommand({ type: "pr_checkout", number }, 180_000),
		liveStart: (voice?: string) => rpcCommand({ type: "live_start", voice }, 60_000),
		liveToggleMute: () => rpcCommand({ type: "live_toggle_mute" }),
		liveStop: () => rpcCommand({ type: "live_stop" }, 30_000),
		getLiveState: () => rpcCommand({ type: "get_live_state" }),
		debug: (params: RpcDebugParams) => rpcCommand({ type: "debug", params }, 120_000),
		collabStart: (relayUrl?: string, view?: boolean) => rpcCommand({ type: "collab_start", relayUrl, view }, 60_000),
		collabJoin: (link: string) => rpcCommand({ type: "collab_join", link }, 120_000),
		collabLeave: () => rpcCommand({ type: "collab_leave" }, 60_000),
		getCollabState: () => rpcCommand({ type: "get_collab_state" }),
		getAvailableModels: (forceRefresh?: boolean) => rpcCommand({ type: "get_available_models", forceRefresh }),
		setThinkingLevel: (level: ThinkingLevel | "auto") => rpcCommand({ type: "set_thinking_level", level }),
		cycleThinkingLevel: () => rpcCommand({ type: "cycle_thinking_level" }),
		setFastMode: (enabled: boolean) => rpcCommand({ type: "set_fast_mode", enabled }),
		setSteeringMode: (mode: "all" | "one-at-a-time") => rpcCommand({ type: "set_steering_mode", mode }),
		setFollowUpMode: (mode: "all" | "one-at-a-time") => rpcCommand({ type: "set_follow_up_mode", mode }),
		setInterruptMode: (mode: "immediate" | "wait") => rpcCommand({ type: "set_interrupt_mode", mode }),
		compact: (customInstructions?: string) => rpcCommand({ type: "compact", customInstructions }),
		setAutoCompaction: (enabled: boolean) => rpcCommand({ type: "set_auto_compaction", enabled }),
		setAutoRetry: (enabled: boolean) => rpcCommand({ type: "set_auto_retry", enabled }),
		abortRetry: () => rpcCommand({ type: "abort_retry" }),
		bash: (command: string, excluded?: boolean) => rpcCommand({ type: "bash", command, excluded }),
		abortBash: () => rpcCommand({ type: "abort_bash" }),
		getSessionStats: () => rpcCommand({ type: "get_session_stats" }),
		setSessionPinned: (sessionId: string, pinned: boolean) =>
			rpcCommand({ type: "set_session_pinned", sessionId, pinned }),
		exportHtml: (outputPath?: string) => rpcCommand({ type: "export_html", outputPath }),
		getBranchMessages: () => rpcCommand({ type: "get_branch_messages" }),
		getLastAssistantText: () => rpcCommand({ type: "get_last_assistant_text" }),
		getCopyTargets: () => rpcCommand({ type: "get_copy_targets" }),
		setSessionName: (name: string) => rpcCommand({ type: "set_session_name", name }),
		setEntryLabel: (entryId: string, label?: string) => rpcCommand({ type: "set_entry_label", entryId, label }),
		handoff: (customInstructions?: string) => rpcCommand({ type: "handoff", customInstructions }),
		getMessages: () => rpcCommand({ type: "get_messages" }),
		getMessagesPage: (cursor?: string, limit?: number) => rpcCommand({ type: "get_messages_page", cursor, limit }),
		getLoginProviders: () => rpcCommand({ type: "get_login_providers" }),
		login: (providerId: string) => rpcCommand({ type: "login", providerId }),
		logout: (providerId: string) => rpcCommand({ type: "logout", providerId }),
		getUsage: () => rpcCommand({ type: "get_usage" }),
		getSettingsSchema: () => rpcCommand({ type: "get_settings_schema" }),
		getSettings: (paths?: string[]) => rpcCommand({ type: "get_settings", paths }),
		setSetting: (path: string, value: unknown) => rpcCommand({ type: "set_setting", path, value }),
		getProviders: (forceRefresh?: boolean) => rpcCommand({ type: "get_providers", forceRefresh }),
		setPlanMode: (enabled: boolean) => rpcCommand({ type: "set_plan_mode", enabled }),
		getPlanMode: () => rpcCommand({ type: "get_plan_mode" }),
		getModelRoles: () => rpcCommand({ type: "get_model_roles" }),
		setModelRole: (role: string, modelId: string | null) => rpcCommand({ type: "set_model_role", role, modelId }),
		getModelRoleMetadata: () => rpcCommand({ type: "get_model_role_metadata" }),
		getAvailableCommands: () => rpcCommand({ type: "get_available_commands" }),
		getSkills: () => rpcCommand({ type: "get_skills" }),
		getSkillDetail: (name: string) => rpcCommand({ type: "get_skill_detail", name }),
		getAgentDefinitions: () => rpcCommand({ type: "get_agent_definitions" }),
		getHooks: () => rpcCommand({ type: "get_hooks" }),
		getMcpServers: () => rpcCommand({ type: "get_mcp_servers" }),
		getGuiThemes: () => rpcCommand({ type: "get_gui_themes" }),
		getPlugins: () => rpcCommand({ type: "get_plugins" }),
		getMarketplaces: () => rpcCommand({ type: "get_marketplaces" }),
		getPromptTemplates: () => rpcCommand({ type: "get_prompt_templates" }),
		getMemoryReport: () => rpcCommand({ type: "get_memory_report" }),
		getSecurityDashboard: () => rpcCommand({ type: "get_security_dashboard" }, 60_000),
		getSecurityScan: (scanId: string) => rpcCommand({ type: "get_security_scan", scanId }, 30_000),
		securityStart: (target: RpcSecurityTargetInput) => rpcCommand({ type: "security_start", target }, 120_000),
		securityCancel: (operationId: string) => rpcCommand({ type: "security_cancel", operationId }),
		securityValidate: (scanId: string, findingId: string) =>
			rpcCommand({ type: "security_validate", scanId, findingId }, 30_000),
		securitySetDisposition: (
			scanId: string,
			findingId: string,
			status: RpcSecurityDispositionStatus,
			rationale?: string,
		) => rpcCommand({ type: "security_set_disposition", scanId, findingId, status, rationale }),
		getSshHosts: () => rpcCommand({ type: "get_ssh_hosts" }, 30_000),
		sshManage: (payload: {
			action: "create" | "update" | "delete";
			scope: "user" | "project";
			name: string;
			previousName?: string;
			previousScope?: "user" | "project";
			host?: RpcSshHostInput;
		}) => rpcCommand({ type: "ssh_manage", ...payload }, 30_000),
		sshTest: (host: RpcSshHostInput & { name: string }) => rpcCommand({ type: "ssh_test", host }, 60_000),
		getOmpUpdate: () => rpcCommand({ type: "get_omp_update" }, 60_000),
		getContextReport: () => rpcCommand({ type: "get_context_report" }),
		// Uploads + seals the session snapshot to the share server — network-bound.
		shareSession: () => rpcCommand({ type: "share_session" }, 120_000),
		getJobs: () => rpcCommand({ type: "get_jobs" }),
		getSessionTree: () => rpcCommand({ type: "get_session_tree" }),
		getThemes: () => rpcCommand({ type: "get_themes" }),
		getThemeColors: (name: string) => rpcCommand({ type: "get_theme_colors", name }),
		getTranscript: () => rpcCommand({ type: "get_transcript" }),
		planApproval: (
			approved: boolean,
			option?: "execute" | "compact" | "keep_context" | "save",
			feedback?: string,
			savePath?: string,
		) => rpcCommand({ type: "plan_approval", approved, option, feedback, savePath }),
		getVibeMode: () => rpcCommand({ type: "get_vibe_mode" }),
		setVibeMode: (enabled: boolean) => rpcCommand({ type: "set_vibe_mode", enabled }),
		getGoal: () => rpcCommand({ type: "get_goal" }),
		guidedGoal: (initial?: string) => rpcCommand({ type: "guided_goal", initial }),
		setAgentsPaused: (enabled: boolean) => rpcCommand({ type: "set_agents_paused", enabled }),
		setGoal: (args: { objective?: string; tokenBudget?: number | null; action?: "pause" | "resume" | "drop" }) =>
			rpcCommand({ type: "set_goal", ...args }),
		btw: (question: string) => rpcCommand({ type: "btw", question }),
		btwBranch: () => rpcCommand({ type: "btw_branch" }),
		tan: (work: string) => rpcCommand({ type: "tan", work }),
		omfg: (complaint: string) => rpcCommand({ type: "omfg", complaint }),
		getLoopMode: () => rpcCommand({ type: "get_loop_mode" }),
		setLoopMode: (enabled: boolean, args?: string) => rpcCommand({ type: "set_loop_mode", enabled, args }),
		setSkillEnabled: (name: string, enabled: boolean) => rpcCommand({ type: "set_skill_enabled", name, enabled }),
		manageSkill: (args: {
			action: "create" | "update" | "delete";
			name: string;
			description?: string;
			body?: string;
		}) => rpcCommand({ type: "manage_skill", ...args }),
		setHookEnabled: (hookId: string, enabled: boolean) => rpcCommand({ type: "set_hook_enabled", hookId, enabled }),
		setPluginEnabled: (pluginId: string, enabled: boolean, scope?: "user" | "project") =>
			rpcCommand({ type: "set_plugin_enabled", pluginId, enabled, scope }),
		mcpAction: (name: string, action: "enable" | "disable" | "reconnect" | "remove", scope?: "user" | "project") =>
			rpcCommand({ type: "mcp_action", name, action, scope }),
		setTodos: (phases: TodoPhase[]) => rpcCommand({ type: "set_todos", phases }),
		setSubagentSubscription: (level: "off" | "progress" | "events") =>
			rpcCommand({ type: "set_subagent_subscription", level }),
		getSubagents: () => rpcCommand({ type: "get_subagents" }),
		getSubagentMessages: (subagentId?: string, sessionFile?: string, fromByte?: number) =>
			rpcCommand({ type: "get_subagent_messages", subagentId, sessionFile, fromByte }),
		setHostTools: (tools: unknown[]) => rpcCommand({ type: "set_host_tools", tools: tools as never }),
		setHostUriSchemes: (schemes: unknown[]) =>
			rpcCommand({ type: "set_host_uri_schemes", schemes: schemes as never }),
		// Voice (speech in/out) — AgentVoice region; keep at the end of the rpc object.
		// Generous timeouts: the first call on a fresh sidecar loads the STT/TTS
		// model into the worker, far beyond the default 8s RPC timeout.
		transcribeAudio: (audioBase64: string, mimeType: string) =>
			rpcCommand({ type: "transcribe_audio", audioBase64, mimeType }, 120_000),
		synthesizeSpeech: (text: string) => rpcCommand({ type: "synthesize_speech", text }, 60_000),
	},

	events: {
		onBatch: (callback: (events: AgentSessionEvent[]) => void) =>
			subscribeActiveTab<AgentSessionEvent[]>(IPC_EVENTS.EVENTS_BATCH, callback),
		onSidecarStatus: (callback: (status: IpcSidecarStatusPayload) => void) =>
			subscribeActiveTab<IpcSidecarStatusPayload>(IPC_EVENTS.SIDECAR_STATUS, callback),
		onTabStatus: (callback: (payload: IpcTabStatusPayload) => void) =>
			subscribe<IpcTabStatusPayload>(IPC_EVENTS.TAB_STATUS, callback),
		onExtensionUi: (callback: (request: ExtensionUIRequest, tabId: string) => void) =>
			subscribe<{ request: ExtensionUIRequest; tabId: string }>(IPC_EVENTS.EXTENSION_UI, data =>
				callback(data.request, data.tabId),
			),
		onHostToolCall: (callback: (request: HostToolCallRequest) => void) =>
			subscribe<{ request: HostToolCallRequest }>(IPC_EVENTS.HOST_TOOL_CALL, data => callback(data.request)),
		onHostUriRequest: (callback: (request: HostUriRequest) => void) =>
			subscribe<{ request: HostUriRequest }>(IPC_EVENTS.HOST_URI_REQUEST, data => callback(data.request)),
		onSubagentFrame: (callback: (frame: SubagentFrame) => void) =>
			subscribeActiveTab<SubagentFrame>(IPC_EVENTS.SUBAGENT_FRAME, callback),
		onLiveUpdate: (callback: (frame: RpcLiveUpdateFrame) => void) =>
			subscribeActiveTab<RpcLiveUpdateFrame>(IPC_EVENTS.LIVE_UPDATE, callback),
		onModelCatalogUpdate: (callback: (frame: ModelCatalogUpdateFrame) => void) =>
			subscribeActiveTab<ModelCatalogUpdateFrame>(IPC_EVENTS.MODEL_CATALOG_UPDATE, callback),
		onCommandsUpdate: (callback: (commands: AvailableCommand[]) => void) =>
			subscribeActiveTab<AvailableCommand[]>(IPC_EVENTS.COMMANDS_UPDATE, callback),
		onConfigUpdate: (callback: (payload: ConfigUpdateFrame) => void) =>
			subscribeActiveTab<ConfigUpdateFrame>(IPC_EVENTS.CONFIG_UPDATE, callback),
		onSessionsChanged: (callback: () => void) => subscribe<undefined>(IPC_EVENTS.SESSIONS_CHANGED, () => callback()),
		onLogLines: (callback: (lines: string[]) => void) => subscribe<string[]>(IPC_EVENTS.LOG_LINE, callback),
		onPromptResult: (callback: (frame: PromptResultFrame) => void) =>
			subscribeActiveTab<PromptResultFrame>(IPC_EVENTS.PROMPT_RESULT, callback),
		onCommandOutput: (callback: (frame: CommandOutputFrame) => void) =>
			subscribeActiveTab<CommandOutputFrame>(IPC_EVENTS.COMMAND_OUTPUT, callback),
		onSessionInfoUpdate: (callback: (frame: SessionInfoUpdateFrame) => void) =>
			subscribeActiveTab<SessionInfoUpdateFrame>(IPC_EVENTS.SESSION_INFO_UPDATE, callback),
		onExtensionError: (callback: (frame: ExtensionErrorFrame) => void) =>
			subscribeActiveTab<ExtensionErrorFrame>(IPC_EVENTS.EXTENSION_ERROR, callback),
		onMenuAction: (callback: (action: MenuAction, payload?: MenuActionPayload) => void) =>
			subscribe<{ action: MenuAction } & MenuActionPayload>(IPC_EVENTS.MENU_ACTION, data =>
				callback(data.action, data),
			),
		onDeepLink: (callback: (link: DeepLinkPayload) => void) =>
			subscribe<DeepLinkPayload>(IPC_EVENTS.DEEP_LINK, callback),
		onUpdaterStatus: (callback: (status: UpdateStatus) => void) =>
			subscribe<UpdateStatus>(IPC_EVENTS.UPDATER_STATUS, callback),
	},

	updater: {
		check: () => ipcRenderer.invoke(IPC_COMMANDS.UPDATER_CHECK),
		download: () => ipcRenderer.invoke(IPC_COMMANDS.UPDATER_DOWNLOAD),
		apply: () => ipcRenderer.invoke(IPC_COMMANDS.UPDATER_APPLY),
		getStatus: () => ipcRenderer.invoke(IPC_COMMANDS.UPDATER_GET_STATUS),
		version: () => ipcRenderer.invoke(IPC_COMMANDS.UPDATER_VERSION),
	},

	ui: {
		respondExtensionUi: (response: ExtensionUIResponse) => {
			ipcRenderer.invoke(IPC_COMMANDS.EXTENSION_UI_RESPOND, { response });
		},
		sendHostToolResult: (result: HostToolResult) => {
			ipcRenderer.invoke(IPC_COMMANDS.HOST_TOOL_RESULT, { result });
		},
		sendHostToolUpdate: (update: HostToolUpdate) => {
			ipcRenderer.invoke(IPC_COMMANDS.HOST_TOOL_UPDATE, { update });
		},
		sendHostUriResult: (result: HostUriResult) => {
			ipcRenderer.invoke(IPC_COMMANDS.HOST_URI_RESULT, { result });
		},
	},

	sessions: {
		list: (scope: "local" | "global") =>
			ipcRenderer.invoke(IPC_COMMANDS.SESSIONS_LIST, { scope }) as Promise<SessionInfo[]>,
		delete: (sessionPath: string) =>
			ipcRenderer.invoke(IPC_COMMANDS.SESSIONS_DELETE, { sessionPath }) as Promise<void>,
		rename: (sessionPath: string, name: string) =>
			ipcRenderer.invoke(IPC_COMMANDS.SESSIONS_RENAME, { sessionPath, name }) as Promise<void>,
		search: (query: string, scope: "local" | "global") =>
			ipcRenderer.invoke(IPC_COMMANDS.SESSIONS_SEARCH, { query, scope }) as Promise<string[]>,
		openInNewWindow: (payload: IpcSessionOpenNewWindowPayload) =>
			ipcRenderer.invoke(IPC_COMMANDS.SESSION_OPEN_NEW_WINDOW, payload) as Promise<boolean>,
		consumePendingOpen: () => ipcRenderer.invoke(IPC_COMMANDS.SESSION_CONSUME_PENDING) as Promise<string | null>,
	},

	tabs: {
		list: () => ipcRenderer.invoke(IPC_COMMANDS.GET_TABS) as Promise<IpcTabInfo[]>,
		spawn: (payload: IpcSpawnTabPayload) =>
			ipcRenderer.invoke(IPC_COMMANDS.SPAWN_TAB, payload) as Promise<IpcSpawnTabResult | null>,
		close: (tabId: string) => ipcRenderer.invoke(IPC_COMMANDS.CLOSE_TAB, { tabId }) as Promise<boolean>,
		setActive: async (tabId: string) => {
			const switched = (await ipcRenderer.invoke(IPC_COMMANDS.SET_ACTIVE_TAB, { tabId })) as boolean;
			if (switched) activeTabId = tabId;
			return switched;
		},
		getSessionOwner: (sessionPath: string) =>
			ipcRenderer.invoke(IPC_COMMANDS.GET_SESSION_OWNER, { sessionPath }) as Promise<IpcSessionOwner | null>,
	},

	stats: {
		fetch: (path: string, params?: Record<string, string>) =>
			ipcRenderer.invoke(IPC_COMMANDS.STATS_FETCH, { path, params }),
	},

	bench: {
		run: (options: IpcBenchmarkRunOptions) =>
			ipcRenderer.invoke(IPC_COMMANDS.BENCH_RUN, options) as Promise<IpcBenchmarkRunResult>,
		abort: () => ipcRenderer.invoke(IPC_COMMANDS.BENCH_ABORT) as Promise<boolean>,
	},

	system: {
		openExternal: (url: string) => ipcRenderer.invoke(IPC_COMMANDS.SYSTEM_OPEN_EXTERNAL, url),
		openPath: (path: string) => ipcRenderer.invoke(IPC_COMMANDS.SYSTEM_OPEN_PATH, path) as Promise<IpcOpenPathResult>,
		showSaveDialog: (defaultPath?: string, filters?: { name: string; extensions: string[] }[]) =>
			ipcRenderer.invoke(IPC_COMMANDS.SYSTEM_SAVE_DIALOG, defaultPath, filters),
		showOpenDialog: (filters?: { name: string; extensions: string[] }[], options?: { directory?: boolean }) =>
			ipcRenderer.invoke(IPC_COMMANDS.SYSTEM_OPEN_DIALOG, filters, options),
		clipboardRead: () => ipcRenderer.invoke(IPC_COMMANDS.SYSTEM_CLIPBOARD_READ),
		notify: (title: string, body?: string) => {
			ipcRenderer.invoke(IPC_COMMANDS.SYSTEM_NOTIFY, { title, body });
		},
	},

	prefs: {
		get: (key?: string) => ipcRenderer.invoke(IPC_COMMANDS.PREFS_GET, { key }),
		set: (key: string, value: unknown) => ipcRenderer.invoke(IPC_COMMANDS.PREFS_SET, { key, value }),
	},

	sidecar: {
		restart: (payload?: IpcSidecarRestartPayload) => ipcRenderer.invoke(IPC_COMMANDS.SIDECAR_RESTART, payload),
		selectProject: () => ipcRenderer.invoke(IPC_COMMANDS.SIDECAR_SELECT_PROJECT),
		setProject: (cwd: string) => ipcRenderer.invoke(IPC_COMMANDS.SIDECAR_SET_PROJECT, { cwd }),
		defaultWorkspace: () => ipcRenderer.invoke(IPC_COMMANDS.SIDECAR_DEFAULT_WORKSPACE) as Promise<string>,
		getStatus: () => ipcRenderer.invoke(IPC_COMMANDS.SIDECAR_STATUS_GET),
	},

	tray: {
		pushState: (state: TrayState) => ipcRenderer.send(IPC_EVENTS.TRAY_STATE_PUSH, state),
	},

	progress: {
		set: (state: RunProgressState) => ipcRenderer.send(IPC_EVENTS.PROGRESS_SET, state),
	},

	models: {
		listProviders: () => ipcRenderer.invoke(IPC_COMMANDS.MODELS_PROVIDERS_LIST) as Promise<CustomProviderView[]>,
		upsertProvider: (input: CustomProviderInput) =>
			ipcRenderer.invoke(IPC_COMMANDS.MODELS_PROVIDER_UPSERT, input) as Promise<void>,
		deleteProvider: (id: string) => ipcRenderer.invoke(IPC_COMMANDS.MODELS_PROVIDER_DELETE, id) as Promise<void>,
		openConfig: () =>
			ipcRenderer.invoke(IPC_COMMANDS.MODELS_CONFIG_OPEN) as Promise<{ path: string; opened: boolean }>,
	},

	fs: {
		list: (path?: string, maxDepth?: number, maxEntries?: number) =>
			ipcRenderer.invoke(IPC_COMMANDS.FS_LIST, { path, maxDepth, maxEntries }) as Promise<IpcFsListResult>,
		read: (path: string, maxBytes?: number) =>
			ipcRenderer.invoke(IPC_COMMANDS.FS_READ, { path, maxBytes }) as Promise<IpcFsReadResult>,
		readPlan: (payload: IpcFsReadPlanPayload) =>
			ipcRenderer.invoke(IPC_COMMANDS.FS_READ_PLAN, payload) as Promise<IpcFsReadPlanResult>,
		readImage: (path: string) =>
			ipcRenderer.invoke(IPC_COMMANDS.FS_READ_IMAGE, { path }) as Promise<IpcFsReadImageResult>,
	},

	editor: {
		openExternal: (content: string) =>
			ipcRenderer.invoke(IPC_COMMANDS.EDITOR_OPEN_EXTERNAL, { content }) as Promise<{
				ok: boolean;
				unavailable: boolean;
				text: string | null;
				error?: string;
			}>,
	},
};

contextBridge.exposeInMainWorld("omp", api);
