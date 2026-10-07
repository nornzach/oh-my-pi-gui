import type { OmpApi } from "./ipc-types";
import type { SessionModelOverride } from "./model-restore";
import type {
	ImageContent,
	MessagesPage,
	RpcCommand,
	RpcDebugParams,
	RpcMcpServerInput,
	RpcResponse,
	RpcSecurityDispositionStatus,
	RpcSecurityTargetInput,
	RpcSshHostInput,
	ThinkingLevel,
	TodoPhase,
} from "./rpc-types";

export type SessionRpcClient = Omit<OmpApi["rpc"], "commandForTab">;
export type RpcTransport = (command: RpcCommand, timeoutMs?: number) => Promise<RpcResponse>;

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
	set_model: 30_000,
	cycle_model: 30_000,
	export_html: 120_000,
	handoff: 660_000,
	reload_plugins: 120_000,
	plan_approval: 660_000,
	switch_leaf: 660_000,
	login: 660_000,
	get_transcript: 30_000,
	get_messages: 30_000,
	get_transcript_page: 30_000,
};

export function timeoutForCommand(cmd: RpcCommand): number | undefined {
	return RPC_COMMAND_TIMEOUTS[cmd.type];
}

const TRANSCRIPT_PAGE_LIMIT = 256;

function transcriptPageData(response: RpcResponse): MessagesPage | undefined {
	if (!response.success || typeof response.data !== "object" || response.data === null) return undefined;
	const data = response.data as { messages?: unknown; nextCursor?: unknown; totalMessages?: unknown };
	if (
		!Array.isArray(data.messages) ||
		!Number.isSafeInteger(data.totalMessages) ||
		(data.totalMessages as number) < 0 ||
		(data.nextCursor !== undefined && typeof data.nextCursor !== "string")
	)
		return undefined;
	return data as unknown as MessagesPage;
}

async function fetchTranscript(transport: RpcTransport): Promise<RpcResponse> {
	const legacy = () => transport({ type: "get_transcript" });
	let page = await transport({ type: "get_transcript_page", limit: TRANSCRIPT_PAGE_LIMIT });
	if (!page.success) return legacy();

	const messages: MessagesPage["messages"] = [];
	const seenCursors = new Set<string>();
	let totalMessages: number | undefined;
	for (;;) {
		const data = transcriptPageData(page);
		if (!data || (totalMessages !== undefined && totalMessages !== data.totalMessages)) return legacy();
		totalMessages = data.totalMessages;
		messages.push(...data.messages);
		const cursor = data.nextCursor;
		if (!cursor) {
			if (messages.length !== totalMessages) return legacy();
			return { id: page.id, type: "response", command: "get_transcript", success: true, data: { messages } };
		}
		if (seenCursors.has(cursor)) return legacy();
		seenCursors.add(cursor);
		page = await transport({ type: "get_transcript_page", cursor, limit: TRANSCRIPT_PAGE_LIMIT });
		if (!page.success) return legacy();
	}
}

/** One wire adapter shared by preload and task-bound renderer clients. */
export function createSessionRpcClient(transport: RpcTransport): SessionRpcClient {
	const rpcCommand: RpcTransport = (command, timeoutMs) => transport(command, timeoutMs ?? timeoutForCommand(command));
	return {
		command: rpcCommand,
		getState: () => rpcCommand({ type: "get_state" }),
		prompt: (message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp") =>
			rpcCommand({ type: "prompt", message, images, streamingBehavior }),
		steer: (message: string, images?: ImageContent[]) => rpcCommand({ type: "steer", message, images }),
		followUp: (message: string, images?: ImageContent[]) => rpcCommand({ type: "follow_up", message, images }),
		abort: () => rpcCommand({ type: "abort" }),
		abortAndPrompt: (message: string) => rpcCommand({ type: "abort_and_prompt", message }),
		newSession: (parentSession?: string) => rpcCommand({ type: "new_session", parentSession }),
		dropSession: () => rpcCommand({ type: "drop_session" }),
		switchSession: (sessionPath: string, model?: SessionModelOverride) =>
			rpcCommand({ type: "switch_session", sessionPath, ...model }),
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
		getGitChanges: () => rpcCommand({ type: "get_git_changes" }),
		getGitDiff: path => rpcCommand({ type: "get_git_diff", path }),
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
		liveStart: (options?: { voice?: string; instructions?: string }) =>
			rpcCommand({ type: "live_start", ...options }, 60_000),
		liveMute: (muted?: boolean) => rpcCommand({ type: "live_mute", muted }),
		liveStop: () => rpcCommand({ type: "live_stop" }, 30_000),
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
		getLogoutAccounts: (providerId: string) => rpcCommand({ type: "get_logout_accounts", providerId }),
		logout: (providerId: string, credentialId: number) => rpcCommand({ type: "logout", providerId, credentialId }),
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
		previewShareSession: () => rpcCommand({ type: "preview_share_session" }),
		shareSession: snapshotId => rpcCommand({ type: "share_session", snapshotId }, 120_000),
		getJobs: () => rpcCommand({ type: "get_jobs" }),
		getSessionTree: () => rpcCommand({ type: "get_session_tree" }),
		getThemes: () => rpcCommand({ type: "get_themes" }),
		getThemeColors: (name: string) => rpcCommand({ type: "get_theme_colors", name }),
		getTranscript: () => fetchTranscript(rpcCommand),
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
	};
}
