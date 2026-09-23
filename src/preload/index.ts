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
	IpcSetTabViewPayload,
	IpcSidecarRestartPayload,
	IpcSidecarStatusPayload,
	IpcSpawnTabPayload,
	IpcSpawnTabResult,
	IpcTabInfo,
	IpcTabStatusPayload,
	LogBatch,
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
import { createSessionRpcClient, timeoutForCommand } from "../shared/rpc-client";
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
	ModelCatalogUpdateFrame,
	PromptResultFrame,
	RpcCommand,
	RpcLiveUpdateFrame,
	RpcResponse,
	SessionInfoUpdateFrame,
	SubagentFrame,
} from "../shared/rpc-types";

function rpcCommand(cmd: RpcCommand, timeoutMs?: number): Promise<RpcResponse> {
	return ipcRenderer.invoke(IPC_COMMANDS.RPC_COMMAND, {
		command: cmd,
		timeoutMs: timeoutMs ?? timeoutForCommand(cmd),
	});
}

function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
	const listener = (_event: Electron.IpcRendererEvent, data: T) => {
		// Node aborts the remaining listeners of an emit once one throws, so a
		// single bad handler would silently freeze every other feature listening
		// to the same main->renderer channel. Isolate it and report instead.
		try {
			callback(data);
		} catch (error) {
			const failure = error instanceof Error ? error : new Error(String(error));
			ipcRenderer.send(IPC_COMMANDS.RUNTIME_ERROR_REPORT, {
				source: "preload",
				message: `IPC handler for "${channel}" failed: ${failure.message}`,
				stack: failure.stack,
				details: { channel },
			} satisfies RuntimeErrorReport);
		}
	};
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

function subscribeTab<T>(channel: string, callback: (data: T, tabId: string) => void): () => void {
	return subscribe<IpcActiveTabEnvelope<T>>(channel, envelope => callback(envelope.payload, envelope.tabId));
}

const api: OmpApi = {
	runtime: {
		report: (error: RuntimeErrorReport) => ipcRenderer.send(IPC_COMMANDS.RUNTIME_ERROR_REPORT, error),
		logPath: () => ipcRenderer.invoke(IPC_COMMANDS.RUNTIME_LOG_PATH) as Promise<string>,
		logSnapshot: () => ipcRenderer.invoke(IPC_COMMANDS.LOG_SNAPSHOT) as Promise<LogBatch>,
	},
	// Fire-and-forget: the guard may show a modal, and the renderer has nothing
	// to learn from the outcome.
	app: {
		quit: () => ipcRenderer.send(IPC_COMMANDS.APP_QUIT),
	},

	rpc: {
		...createSessionRpcClient(rpcCommand),
		commandForTab: (tabId: string, cmd: RpcCommand, timeoutMs?: number) =>
			ipcRenderer.invoke(IPC_COMMANDS.RPC_COMMAND_FOR_TAB, {
				tabId,
				command: cmd,
				timeoutMs: timeoutMs ?? timeoutForCommand(cmd),
			}) as Promise<RpcResponse>,
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
		onLogLines: (callback: (lines: string[]) => void) =>
			subscribe<LogBatch>(IPC_EVENTS.LOG_LINE, batch => callback(batch.lines)),
		onLogBatch: (callback: (batch: LogBatch) => void) => subscribe<LogBatch>(IPC_EVENTS.LOG_LINE, callback),
		onPromptResult: (callback: (frame: PromptResultFrame) => void) =>
			subscribeActiveTab<PromptResultFrame>(IPC_EVENTS.PROMPT_RESULT, callback),
		onCommandOutput: (callback: (frame: CommandOutputFrame) => void) =>
			subscribeActiveTab<CommandOutputFrame>(IPC_EVENTS.COMMAND_OUTPUT, callback),
		onSessionInfoUpdate: (callback: (frame: SessionInfoUpdateFrame) => void) =>
			subscribeActiveTab<SessionInfoUpdateFrame>(IPC_EVENTS.SESSION_INFO_UPDATE, callback),
		onExtensionError: (callback: (frame: ExtensionErrorFrame) => void) =>
			subscribeActiveTab<ExtensionErrorFrame>(IPC_EVENTS.EXTENSION_ERROR, callback),
		onTabBatch: (callback: (events: AgentSessionEvent[], tabId: string) => void) =>
			subscribeTab<AgentSessionEvent[]>(IPC_EVENTS.EVENTS_BATCH, callback),
		onTabSidecarStatus: (callback: (status: IpcSidecarStatusPayload, tabId: string) => void) =>
			subscribeTab<IpcSidecarStatusPayload>(IPC_EVENTS.SIDECAR_STATUS, callback),
		onTabSubagentFrame: (callback: (frame: SubagentFrame, tabId: string) => void) =>
			subscribeTab<SubagentFrame>(IPC_EVENTS.SUBAGENT_FRAME, callback),
		onTabModelCatalogUpdate: (callback: (frame: ModelCatalogUpdateFrame, tabId: string) => void) =>
			subscribeTab<ModelCatalogUpdateFrame>(IPC_EVENTS.MODEL_CATALOG_UPDATE, callback),
		onTabCommandsUpdate: (callback: (commands: AvailableCommand[], tabId: string) => void) =>
			subscribeTab<AvailableCommand[]>(IPC_EVENTS.COMMANDS_UPDATE, callback),
		onTabConfigUpdate: (callback: (frame: ConfigUpdateFrame, tabId: string) => void) =>
			subscribeTab<ConfigUpdateFrame>(IPC_EVENTS.CONFIG_UPDATE, callback),
		onTabPromptResult: (callback: (frame: PromptResultFrame, tabId: string) => void) =>
			subscribeTab<PromptResultFrame>(IPC_EVENTS.PROMPT_RESULT, callback),
		onTabCommandOutput: (callback: (frame: CommandOutputFrame, tabId: string) => void) =>
			subscribeTab<CommandOutputFrame>(IPC_EVENTS.COMMAND_OUTPUT, callback),
		onTabSessionInfoUpdate: (callback: (frame: SessionInfoUpdateFrame, tabId: string) => void) =>
			subscribeTab<SessionInfoUpdateFrame>(IPC_EVENTS.SESSION_INFO_UPDATE, callback),
		onTabExtensionError: (callback: (frame: ExtensionErrorFrame, tabId: string) => void) =>
			subscribeTab<ExtensionErrorFrame>(IPC_EVENTS.EXTENSION_ERROR, callback),
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
		setView: async (focusedTabId: string, visibleTabIds: string[], split?: IpcSetTabViewPayload["split"]) => {
			const switched = (await ipcRenderer.invoke(IPC_COMMANDS.SET_TAB_VIEW, {
				focusedTabId,
				visibleTabIds,
				split,
			})) as boolean;
			if (switched) activeTabId = focusedTabId;
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
		updateLaunchProfile: (cwd, patch) => ipcRenderer.invoke(IPC_COMMANDS.PREFS_UPDATE_LAUNCH_PROFILE, { cwd, patch }),
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
		list: (path?: string, maxDepth?: number, maxEntries?: number, tabId?: string) =>
			ipcRenderer.invoke(IPC_COMMANDS.FS_LIST, { path, maxDepth, maxEntries, tabId }) as Promise<IpcFsListResult>,
		read: (path: string, maxBytes?: number, tabId?: string) =>
			ipcRenderer.invoke(IPC_COMMANDS.FS_READ, { path, maxBytes, tabId }) as Promise<IpcFsReadResult>,
		readPlan: (payload: IpcFsReadPlanPayload) =>
			ipcRenderer.invoke(IPC_COMMANDS.FS_READ_PLAN, payload) as Promise<IpcFsReadPlanResult>,
		readImage: (path: string, tabId?: string) =>
			ipcRenderer.invoke(IPC_COMMANDS.FS_READ_IMAGE, { path, tabId }) as Promise<IpcFsReadImageResult>,
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
