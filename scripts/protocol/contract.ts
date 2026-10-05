/** Compile-time, directional wire contracts; never imported by the application. */
import type * as Core from "../../../coding-agent/src/modes/rpc/rpc-types";
import type { SessionStats } from "../../../coding-agent/src/session/agent-session";
import type * as Gui from "../../src/shared/rpc-types";

// Numeric/string enum members cross JSON as their primitive values, not nominal TS enum types.
type Wire<T> = T extends string ? `${T}` : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;
type Accepts<Consumer, Producer extends Consumer> = Producer;
export type Commands = Accepts<Wire<Core.RpcCommand>, Gui.RpcCommand>;
export type State = Accepts<Gui.RpcSessionState, Wire<Core.RpcSessionState>>;
export type Stats = Accepts<Gui.SessionStats, Wire<SessionStats>>;
export type Queue = Accepts<Gui.RpcGetQueueResult, Wire<Core.RpcGetQueueResult>>;
export type GitChanges = Accepts<Gui.RpcGitChanges, Wire<Core.RpcGitChanges>>;
export type GitDiff = Accepts<Gui.RpcGitDiff, Wire<Core.RpcGitDiff>>;
export type Jobs = Accepts<Gui.RpcJobsResult, Wire<Core.RpcJobsResult>>;
export type SharePreview = Accepts<Gui.RpcShareSessionPreview, Wire<Core.RpcShareSessionPreview>>;
export type Share = Accepts<Gui.RpcShareSessionResult, Wire<Core.RpcShareSessionResult>>;
export type Goal = Accepts<Gui.RpcGoalState, Wire<Core.RpcGoalState>>;
export type Loop = Accepts<Gui.RpcLoopModeState, Wire<Core.RpcLoopModeState>>;
export type Vibe = Accepts<Gui.RpcVibeModeState, Wire<Core.RpcVibeModeState>>;
export type RpcActiveTool = Accepts<Gui.RpcActiveTool, Wire<Core.RpcActiveTool>>;
export type RpcActiveToolsResult = Accepts<Gui.RpcActiveToolsResult, Wire<Core.RpcActiveToolsResult>>;
export type RpcAgentDefinitionInfo = Accepts<Gui.RpcAgentDefinitionInfo, Wire<Core.RpcAgentDefinitionInfo>>;
export type RpcAgentDefinitionsResult = Accepts<Gui.RpcAgentDefinitionsResult, Wire<Core.RpcAgentDefinitionsResult>>;
export type RpcChunkFrame = Accepts<Gui.RpcChunkFrame, Wire<Core.RpcChunkFrame>>;
export type RpcCollabParticipant = Accepts<Gui.RpcCollabParticipant, Wire<Core.RpcCollabParticipant>>;
export type RpcCollabState = Accepts<Gui.RpcCollabState, Wire<Core.RpcCollabState>>;
export type RpcContextReportResult = Accepts<Gui.RpcContextReportResult, Wire<Core.RpcContextReportResult>>;
export type RpcForceToolState = Accepts<Gui.RpcForceToolState, Wire<Core.RpcForceToolState>>;
export type RpcForeignSessionInfo = Accepts<Gui.RpcForeignSessionInfo, Wire<Core.RpcForeignSessionInfo>>;
export type RpcGitStatus = Accepts<Gui.RpcGitStatus, Wire<Core.RpcGitStatus>>;
export type RpcGuiThemeInfo = Accepts<Gui.RpcGuiThemeInfo, Wire<Core.RpcGuiThemeInfo>>;
export type RpcGuiThemesResult = Accepts<Gui.RpcGuiThemesResult, Wire<Core.RpcGuiThemesResult>>;
export type RpcHookInfo = Accepts<Gui.RpcHookInfo, Wire<Core.RpcHookInfo>>;
export type RpcHooksResult = Accepts<Gui.RpcHooksResult, Wire<Core.RpcHooksResult>>;
export type RpcLiveFrame = Accepts<Gui.RpcLiveFrame, Wire<Core.RpcLiveFrame>>;
export type RpcManageSkillResult = Accepts<Gui.RpcManageSkillResult, Wire<Core.RpcManageSkillResult>>;
export type RpcMarketplaceInfo = Accepts<Gui.RpcMarketplaceInfo, Wire<Core.RpcMarketplaceInfo>>;
export type RpcMarketplacePluginInfo = Accepts<Gui.RpcMarketplacePluginInfo, Wire<Core.RpcMarketplacePluginInfo>>;
export type RpcMarketplacesResult = Accepts<Gui.RpcMarketplacesResult, Wire<Core.RpcMarketplacesResult>>;
export type RpcMcpServerInfo = Accepts<Gui.RpcMcpServerInfo, Wire<Core.RpcMcpServerInfo>>;
export type RpcMcpServerInput = Accepts<Gui.RpcMcpServerInput, Wire<Core.RpcMcpServerInput>>;
export type RpcMcpServersResult = Accepts<Gui.RpcMcpServersResult, Wire<Core.RpcMcpServersResult>>;
export type RpcMemoryReport = Accepts<Gui.RpcMemoryReport, Wire<Core.RpcMemoryReport>>;
export type RpcMemoryStatus = Accepts<Gui.RpcMemoryStatus, Wire<Core.RpcMemoryStatus>>;
export type RpcOmpUpdateResult = Accepts<Gui.RpcOmpUpdateResult, Wire<Core.RpcOmpUpdateResult>>;
export type RpcPluginDetail = Accepts<Gui.RpcPluginDetail, Wire<Core.RpcPluginDetail>>;
export type RpcPluginInfo = Accepts<Gui.RpcPluginInfo, Wire<Core.RpcPluginInfo>>;
export type RpcPluginsResult = Accepts<Gui.RpcPluginsResult, Wire<Core.RpcPluginsResult>>;
export type RpcPrCreateResult = Accepts<Gui.RpcPrCreateResult, Wire<Core.RpcPrCreateResult>>;
export type RpcPrDetail = Accepts<Gui.RpcPrDetail, Wire<Core.RpcPrDetail>>;
export type RpcPrDraftResult = Accepts<Gui.RpcPrDraftResult, Wire<Core.RpcPrDraftResult>>;
export type RpcPrListItem = Accepts<Gui.RpcPrListItem, Wire<Core.RpcPrListItem>>;
export type RpcPrRepo = Accepts<Gui.RpcPrRepo, Wire<Core.RpcPrRepo>>;
export type RpcPrewalkState = Accepts<Gui.RpcPrewalkState, Wire<Core.RpcPrewalkState>>;
export type RpcPromptTemplateInfo = Accepts<Gui.RpcPromptTemplateInfo, Wire<Core.RpcPromptTemplateInfo>>;
export type RpcPromptTemplatesResult = Accepts<Gui.RpcPromptTemplatesResult, Wire<Core.RpcPromptTemplatesResult>>;
export type RpcQueueClearResult = Accepts<Gui.RpcQueueClearResult, Wire<Core.RpcQueueClearResult>>;
export type RpcQueueEditResult = Accepts<Gui.RpcQueueEditResult, Wire<Core.RpcQueueEditResult>>;
export type RpcQueueMoveResult = Accepts<Gui.RpcQueueMoveResult, Wire<Core.RpcQueueMoveResult>>;
export type RpcQueueRemoveResult = Accepts<Gui.RpcQueueRemoveResult, Wire<Core.RpcQueueRemoveResult>>;
export type RpcQueuedMessage = Accepts<Gui.RpcQueuedMessage, Wire<Core.RpcQueuedMessage>>;
export type RpcReadyFrame = Accepts<Gui.RpcReadyFrame, Wire<Core.RpcReadyFrame>>;
export type RpcReloadPluginsResult = Accepts<Gui.RpcReloadPluginsResult, Wire<Core.RpcReloadPluginsResult>>;
export type RpcSecurityDashboardResult = Accepts<Gui.RpcSecurityDashboardResult, Wire<Core.RpcSecurityDashboardResult>>;
export type RpcSecurityDispositionStatus = Accepts<
	Gui.RpcSecurityDispositionStatus,
	Wire<Core.RpcSecurityDispositionStatus>
>;
export type RpcSecurityFindingInfo = Accepts<Gui.RpcSecurityFindingInfo, Wire<Core.RpcSecurityFindingInfo>>;
export type RpcSecurityOperationInfo = Accepts<Gui.RpcSecurityOperationInfo, Wire<Core.RpcSecurityOperationInfo>>;
export type RpcSecurityScanInfo = Accepts<Gui.RpcSecurityScanInfo, Wire<Core.RpcSecurityScanInfo>>;
export type RpcSecurityScanResult = Accepts<Gui.RpcSecurityScanResult, Wire<Core.RpcSecurityScanResult>>;
export type RpcSecuritySeverityLevel = Accepts<Gui.RpcSecuritySeverityLevel, Wire<Core.RpcSecuritySeverityLevel>>;
export type RpcSecurityTargetInput = Accepts<Gui.RpcSecurityTargetInput, Wire<Core.RpcSecurityTargetInput>>;
export type RpcSessionTreeNode = Accepts<Gui.RpcSessionTreeNode, Wire<Core.RpcSessionTreeNode>>;
export type RpcSessionTreeResult = Accepts<Gui.RpcSessionTreeResult, Wire<Core.RpcSessionTreeResult>>;
export type RpcShakeContextResult = Accepts<Gui.RpcShakeContextResult, Wire<Core.RpcShakeContextResult>>;
export type RpcSkillDetail = Accepts<Gui.RpcSkillDetail, Wire<Core.RpcSkillDetail>>;
export type RpcSkillInfo = Accepts<Gui.RpcSkillInfo, Wire<Core.RpcSkillInfo>>;
export type RpcSkillsResult = Accepts<Gui.RpcSkillsResult, Wire<Core.RpcSkillsResult>>;
export type RpcSshHostInfo = Accepts<Gui.RpcSshHostInfo, Wire<Core.RpcSshHostInfo>>;
export type RpcSshHostInput = Accepts<Gui.RpcSshHostInput, Wire<Core.RpcSshHostInput>>;
export type RpcSshHostsResult = Accepts<Gui.RpcSshHostsResult, Wire<Core.RpcSshHostsResult>>;
export type RpcSshTestResult = Accepts<Gui.RpcSshTestResult, Wire<Core.RpcSshTestResult>>;
export type RpcSwitchLeafResult = Accepts<Gui.RpcSwitchLeafResult, Wire<Core.RpcSwitchLeafResult>>;
export type RpcThemeColorsResult = Accepts<Gui.RpcThemeColorsResult, Wire<Core.RpcThemeColorsResult>>;
export type RpcThemeInfo = Accepts<Gui.RpcThemeInfo, Wire<Core.RpcThemeInfo>>;
export type RpcThemesResult = Accepts<Gui.RpcThemesResult, Wire<Core.RpcThemesResult>>;
export type RpcThinkingLevelState = Accepts<Gui.RpcThinkingLevelState, Wire<Core.RpcThinkingLevelState>>;
export type RpcToolSource = Accepts<Gui.RpcToolSource, Wire<Core.RpcToolSource>>;
export type RpcWorkspaceDirectoriesResult = Accepts<
	Gui.RpcWorkspaceDirectoriesResult,
	Wire<Core.RpcWorkspaceDirectoriesResult>
>;
export type RpcWorkspaceDirectory = Accepts<Gui.RpcWorkspaceDirectory, Wire<Core.RpcWorkspaceDirectory>>;
export type RpcWorktreeCreateResult = Accepts<Gui.RpcWorktreeCreateResult, Wire<Core.RpcWorktreeCreateResult>>;
