import { createTwoFilesPatch, FILE_HEADERS_ONLY } from "diff";
import type { AgentTypeStats, AggregatedStats, TimeSeriesPoint } from "../../stats/src/shared-types";
import type {
	AgentMessage,
	AvailableCommand,
	AvailableModelsResult,
	ContextUsage,
	MessagesPage,
	ModelInfo,
	ModelRoleCandidate,
	ModelRoleMetadata,
	ModelRoleMetadataResult,
	ModelRolesResult,
	PlanModeState,
	ProvidersResult,
	RpcActiveToolsResult,
	RpcAgentDefinitionsResult,
	RpcCollabState,
	RpcCommand,
	RpcContextReportResult,
	RpcGetQueueResult,
	RpcGitChanges,
	RpcGitDiff,
	RpcGitStatus,
	RpcGoalState,
	RpcGuiThemesResult,
	RpcHooksResult,
	RpcJobsResult,
	RpcLiveState,
	RpcLoopModeState,
	RpcMarketplacesResult,
	RpcMcpServersResult,
	RpcMemoryReport,
	RpcPluginsResult,
	RpcPromptTemplatesResult,
	RpcSecurityDashboardResult,
	RpcSessionState,
	RpcSessionTreeResult,
	RpcSkillsResult,
	RpcSshHostsResult,
	RpcThemesResult,
	RpcVibeModeState,
	RpcWorkspaceDirectoriesResult,
	SessionStats,
	SettingsSchemaResult,
	SubagentSnapshot,
	UsageResult,
} from "../src/shared/rpc-types";

export const showcaseTimestamp = Date.UTC(2026, 8, 21, 10, 30);
const dayMs = 86_400_000;
const preferencesPath = "src/components/Preferences.tsx";
const testsPath = "tests/Preferences.test.tsx";

const preferencesBefore = `interface PreferencesLabels {
  title: string;
  highContrast: string;
  reduceMotion: string;
}

export function Preferences({ labels }: { labels: PreferencesLabels }) {
  return (
    <div>
      <h2>{labels.title}</h2>
      <input type="checkbox" name="highContrast" aria-label={labels.highContrast} />
      <input type="checkbox" name="reduceMotion" aria-label={labels.reduceMotion} />
    </div>
  );
}
`;
const testsBefore = `import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Preferences } from "../src/components/Preferences";

const labels = { title: "aurora-web", highContrast: "highContrast", reduceMotion: "reduceMotion" };
const html = () => renderToStaticMarkup(<Preferences labels={labels} />);

test("Preferences/native-checkbox", () => {
  expect(html().match(/type="checkbox"/g)).toHaveLength(2);
});
`;
export const projectFiles: Record<string, string> = {
	[preferencesPath]: `interface PreferencesLabels {
  title: string;
  highContrast: string;
  reduceMotion: string;
}

export function Preferences({ labels }: { labels: PreferencesLabels }) {
  return (
    <section aria-labelledby="preferences-title">
      <h2 id="preferences-title">{labels.title}</h2>
      <label htmlFor="contrast">{labels.highContrast}</label>
      <input id="contrast" type="checkbox" name="highContrast" />
      <label htmlFor="motion">{labels.reduceMotion}</label>
      <input id="motion" type="checkbox" name="reduceMotion" />
    </section>
  );
}
`,
	[testsPath]: `${testsBefore}
test("Preferences/aria-labelledby", () => {
  expect(html()).toContain('aria-labelledby="preferences-title"');
  expect(html()).toContain('<h2 id="preferences-title">aurora-web</h2>');
});

test("Preferences/label-for", () => {
  expect(html()).toContain('<label for="contrast">highContrast</label>');
  expect(html()).toContain('<input id="contrast"');
  expect(html()).toContain('<label for="motion">reduceMotion</label>');
  expect(html()).toContain('<input id="motion"');
});
`,
};

export const projectDiffs: Record<string, RpcGitDiff> = Object.fromEntries(
	Object.entries({ [preferencesPath]: preferencesBefore, [testsPath]: testsBefore }).map(([path, before]) => [
		path,
		{
			path,
			diff: createTwoFilesPatch(`a/${path}`, `b/${path}`, before, projectFiles[path], undefined, undefined, {
				context: 2,
				headerOptions: FILE_HEADERS_ONLY,
			}),
			kind: "text",
			truncated: false,
		} satisfies RpcGitDiff,
	]),
);

export function createShowcaseData(
	locale: "en" | "zh",
	cwd: string,
): { replies: Record<string, unknown>; stats: Record<string, unknown> } {
	const text = (en: string, zh: string): string => (locale === "zh" ? zh : en);
	const demo = text("Demo", "演示");
	const notice = text("Synthetic demo data · no external requests", "合成演示数据 · 无外部请求");
	const sessionId = `showcase-aurora-web-${locale}`;
	const sessionName = text("Build accessible settings", "构建无障碍设置页");
	const rateCard = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
	const model: ModelInfo = {
		provider: "anthropic",
		id: "claude-sonnet-4-5",
		name: `Claude Sonnet 4.5 · ${demo}`,
		description: text("Demo coding model · illustrative prices and limits", "演示编程模型 · 价格与额度均为示例"),
		contextWindow: 200_000,
		maxTokens: 16_384,
		cost: rateCard,
		tps: 72,
		isRecommended: true,
	};
	const models: ModelInfo[] = [
		model,
		{
			provider: "anthropic",
			id: "claude-opus-4-5",
			name: `Claude Opus 4.5 · ${demo}`,
			description: text("Demo deep-reasoning model · not connected", "演示深度推理模型 · 未连接"),
			contextWindow: 200_000,
			maxTokens: 16_384,
			cost: rateCard,
			tps: 48,
		},
		{
			provider: "openai",
			id: "gpt-5.2",
			name: `GPT-5.2 · ${demo}`,
			description: text("Demo general-purpose model · not connected", "演示通用模型 · 未连接"),
			contextWindow: 200_000,
			maxTokens: 16_384,
			cost: rateCard,
			tps: 94,
		},
		{
			provider: "openai",
			id: "gpt-5.2-codex",
			name: `GPT-5.2 Codex · ${demo}`,
			description: text("Demo code-review model · not connected", "演示代码审查模型 · 未连接"),
			contextWindow: 200_000,
			maxTokens: 16_384,
			cost: rateCard,
			tps: 88,
		},
		{
			provider: "google",
			id: "gemini-3-pro-preview",
			name: `Gemini 3 Pro · ${demo}`,
			description: text("Demo planning model · not connected", "演示规划模型 · 未连接"),
			contextWindow: 1_000_000,
			maxTokens: 16_384,
			cost: rateCard,
			tps: 105,
		},
		{
			provider: "google",
			id: "gemini-3-flash-preview",
			name: `Gemini 3 Flash · ${demo}`,
			description: text("Demo fast-exploration model · not connected", "演示快速探索模型 · 未连接"),
			contextWindow: 1_000_000,
			maxTokens: 16_384,
			cost: rateCard,
			tps: 152,
		},
	];
	const availableModels: AvailableModelsResult = {
		models,
		discoveryStates: [],
		refreshPending: false,
		generation: 1,
	};
	const providers: ProvidersResult = {
		...availableModels,
		providers: [
			{ id: "anthropic", name: `Anthropic · ${demo}` },
			{ id: "openai", name: `OpenAI · ${demo}` },
			{ id: "google", name: `Google · ${demo}` },
		].map(provider => ({
			...provider,
			authenticated: false,
			loginAvailable: false,
			disabled: false,
			modelCount: 2,
			account: text("Example catalog · no account connected", "示例目录 · 未连接任何账号"),
		})),
	};

	const summary = text(
		"## Accessible settings, ready\n\n- Added a named settings region and visible labels.\n- Kept native checkboxes for keyboard navigation.\n- Added coverage for labels and heading associations.\n\n**Demo test result:** 3/3 passed. Synthetic data; no external requests.",
		"## 无障碍设置页已就绪\n\n- 为设置区域添加名称与可见标签。\n- 保留原生复选框，支持键盘操作。\n- 补充标签关联与标题语义的测试。\n\n**演示测试结果：** 3/3 通过。数据均为合成，无外部请求。",
	);
	const editIntent = text("Add accessible labels and regression coverage", "补充无障碍标签与回归测试");
	const messages: AgentMessage[] = [
		{
			role: "user",
			entryId: "showcase-user",
			timestamp: showcaseTimestamp - 70_000,
			content: [
				{
					type: "text",
					text: text(
						"In the aurora-web demo project, make the preferences page accessible: add visible labels, preserve keyboard navigation, and cover the changes with tests.",
						"请为 aurora-web 演示项目构建无障碍设置页：添加可见标签，保留键盘操作，并为改动补充测试。",
					),
				},
			],
		},
		{
			role: "assistant",
			entryId: "showcase-edit",
			timestamp: showcaseTimestamp - 60_000,
			provider: model.provider,
			model: model.id,
			stopReason: "toolUse",
			duration: 5_800,
			ttft: 380,
			content: [
				{
					type: "thinking",
					thinking: text(
						"I’ll keep the native controls, associate each visible label with its input, and name the settings region. The demo checks will cover these semantics without contacting a provider.",
						"我会保留原生控件，将可见标签与输入框关联，并为设置区域命名。演示检查将覆盖这些语义，不联系任何服务商。",
					),
				},
				{
					type: "toolCall",
					id: "showcase-edit-preferences",
					name: "edit",
					intent: editIntent,
					arguments: {
						edits: [preferencesPath, testsPath].map(path => ({
							path,
							op: "update",
							diff: projectDiffs[path].diff,
						})),
					},
				},
			],
		},
		{
			role: "toolResult",
			entryId: "showcase-edit-result",
			timestamp: showcaseTimestamp - 53_000,
			toolCallId: "showcase-edit-preferences",
			toolName: "edit",
			isError: false,
			content: [{ type: "text", text: text("Demo: updated two synthetic files.", "演示：已更新两个合成文件。") }],
			details: {
				perFileResults: [preferencesPath, testsPath].map(path => ({
					path,
					diff: projectDiffs[path].diff,
					op: "update",
					firstChangedLine: path === preferencesPath ? 9 : 12,
				})),
			},
		},
		{
			role: "assistant",
			entryId: "showcase-summary",
			timestamp: showcaseTimestamp - 48_000,
			provider: model.provider,
			model: model.id,
			stopReason: "stop",
			duration: 4_200,
			ttft: 340,
			content: [{ type: "text", text: summary }],
		},
	];
	const contextUsage: ContextUsage = { tokens: 18_400, contextWindow: 200_000, percent: 9.2 };
	const collab: RpcCollabState = { role: null, readOnly: false, participants: [] };
	const state: RpcSessionState = {
		model,
		thinkingLevel: "high",
		thinkingConfigured: "high",
		availableThinkingLevels: ["low", "medium", "high"],
		isStreaming: false,
		isCompacting: false,
		steeringMode: "all",
		followUpMode: "all",
		interruptMode: "immediate",
		sessionFile: null,
		cwd,
		sessionId,
		sessionName,
		fastModeEnabled: false,
		fastModeActive: false,
		tokensPerSecond: 72,
		autoCompactionEnabled: true,
		autoRetryEnabled: true,
		messageCount: messages.length,
		queuedMessageCount: 0,
		todoPhases: [],
		systemPrompt: [],
		dumpTools: [],
		contextUsage,
		planModeEnabled: false,
		prewalkArmed: false,
		agentsPaused: false,
		collab,
	};
	const sessionStats: SessionStats = {
		sessionId,
		userMessages: 1,
		assistantMessages: 2,
		toolCalls: 1,
		toolResults: 1,
		totalMessages: messages.length,
		tokens: { input: 6_600, output: 1_200, reasoning: 320, cacheRead: 14_400, cacheWrite: 2_400, total: 24_600 },
		premiumRequests: 2,
		cost: 0.05112,
		contextUsage,
	};
	const contextReport: RpcContextReportResult = {
		contextWindow: contextUsage.contextWindow,
		model: model.id,
		breakdown: {
			contextWindow: contextUsage.contextWindow,
			anchored: true,
			usedTokens: contextUsage.tokens,
			systemPromptTokens: 2_100,
			systemToolsTokens: 4_600,
			systemContextTokens: 900,
			skillsTokens: 400,
			messagesTokens: 10_400,
		},
	};
	const usage: UsageResult = {
		reports: [
			{
				provider: `Anthropic · ${demo}`,
				fetchedAt: showcaseTimestamp,
				notes: [notice],
				limits: [
					{
						id: "demo-session",
						label: text("Session allowance (example)", "会话额度（示例）"),
						usedFraction: 0.32,
						remainingFraction: 0.68,
						resetsAt: showcaseTimestamp + 2 * 3_600_000,
						status: "ok",
					},
					{
						id: "demo-week",
						label: text("Weekly allowance (example)", "每周额度（示例）"),
						usedFraction: 0.18,
						remainingFraction: 0.82,
						resetsAt: showcaseTimestamp + 4 * dayMs,
						status: "ok",
					},
				],
			},
			{
				provider: `OpenAI · ${demo}`,
				fetchedAt: showcaseTimestamp,
				notes: [notice],
				limits: [
					{
						id: "demo-requests",
						label: text("Request allowance (example)", "请求额度（示例）"),
						used: 42,
						limit: 200,
						usedFraction: 0.21,
						unit: text("requests", "次"),
						status: "ok",
					},
				],
			},
		],
		session: {
			input: sessionStats.tokens.input,
			output: sessionStats.tokens.output,
			cacheRead: sessionStats.tokens.cacheRead,
			cacheWrite: sessionStats.tokens.cacheWrite,
			totalTokens: sessionStats.tokens.total,
			orchestrationTokens: 0,
			premiumRequests: sessionStats.premiumRequests,
			cost: sessionStats.cost,
		},
	};

	const candidates: ModelRoleCandidate[] = models.map(candidate => ({
		provider: candidate.provider,
		id: candidate.id,
		name: candidate.name ?? candidate.id,
		kind: "chat",
	}));
	const roleMetadata: ModelRoleMetadata[] = [
		{ id: "default", name: text("Default", "默认"), tag: text("DEFAULT", "默认"), color: "success", section: "chat" },
		{ id: "smol", name: text("Fast", "快速"), tag: text("FAST", "快速"), color: "warning", section: "chat" },
		{ id: "slow", name: text("Thinking", "推理"), tag: text("THINK", "推理"), color: "accent", section: "chat" },
		{ id: "plan", name: text("Architect", "规划"), tag: text("PLAN", "规划"), color: "muted", section: "chat" },
		{ id: "task", name: text("Subtask", "子任务"), tag: text("TASK", "任务"), color: "muted", section: "chat" },
		{ id: "advisor", name: text("Advisor", "顾问"), tag: text("REVIEW", "审查"), color: "accent", section: "chat" },
	];
	const assignments: Record<string, string> = {
		default: "anthropic/claude-sonnet-4-5",
		smol: "google/gemini-3-flash-preview",
		slow: "anthropic/claude-opus-4-5",
		plan: "google/gemini-3-pro-preview",
		task: "openai/gpt-5.2-codex",
		advisor: "openai/gpt-5.2",
	};
	const modelRoles: ModelRolesResult = {
		roles: roleMetadata.map(role => ({ ...role, model: assignments[role.id], source: notice, candidates })),
	};

	const agentRows = [
		{
			agent: "scout",
			status: "completed",
			role: "smol",
			tokens: 9_200,
			cost: 0.012,
			durationMs: 28_000,
			toolCount: 4,
			task: text("Demo · map the existing form patterns", "演示 · 梳理现有表单模式"),
			note: text("Found reusable labels and native controls", "已定位可复用标签与原生控件"),
		},
		{
			agent: "task",
			status: "running",
			role: "task",
			tokens: 6_800,
			cost: 0.018,
			durationMs: 38_000,
			toolCount: 3,
			task: text("Demo · check the narrow-screen layout", "演示 · 检查窄屏布局"),
			note: text("Checking spacing at 320 px · 2/3 checks", "正在检查 320 像素间距 · 已完成 2/3 项"),
		},
		{
			agent: "reviewer",
			status: "parked",
			role: "advisor",
			tokens: 4_300,
			cost: 0.0098,
			durationMs: 19_000,
			toolCount: 2,
			task: text("Demo · review keyboard and label semantics", "演示 · 复核键盘与标签语义"),
			note: text("Review complete · parked for follow-up", "复核完成 · 已停驻，等待后续任务"),
		},
	];
	const subagents: SubagentSnapshot[] = agentRows.map((row, index) => {
		const id = `showcase-${row.agent}`;
		return {
			id,
			index: index + 1,
			agent: row.agent,
			agentSource: "bundled",
			kind: "sub",
			status: row.status,
			live: row.status === "running",
			lastUpdate: showcaseTimestamp,
			task: row.task,
			assignment: row.task,
			description: row.task,
			progress: {
				id,
				index,
				agent: row.agent,
				agentSource: "bundled",
				status: row.status === "running" ? "running" : "completed",
				task: row.task,
				assignment: row.task,
				description: row.note,
				lastIntent: row.note,
				recentTools: [{ tool: "read", args: preferencesPath, endMs: showcaseTimestamp - 2_000 }],
				recentOutput: [row.note, notice],
				toolCount: row.toolCount,
				requests: 2,
				tokens: row.tokens,
				contextTokens: row.tokens,
				contextWindow: 200_000,
				cost: row.cost,
				durationMs: row.durationMs,
				modelRole: row.role,
				resolvedModel: assignments[row.role],
			},
		};
	});
	const agentDefinitions: RpcAgentDefinitionsResult = {
		agents: agentRows.map(row => ({
			name: row.agent,
			description: `${row.task} · ${notice}`,
			source: "bundled",
			model: [`@${row.role}`],
			thinkingLevel: "medium",
			effectiveThinkingLevel: "medium",
			tools: row.agent === "task" ? ["read", "edit", "bash"] : ["read", "grep", "find"],
			spawns: [],
			blocking: false,
			defaultPatterns: [`@${row.role}`],
			defaultResolved: assignments[row.role],
			effectivePatterns: [`@${row.role}`],
			effectiveResolved: assignments[row.role],
		})),
	};

	const schema: SettingsSchemaResult = {
		tabs: [
			{ id: "context", label: text("Context", "上下文"), groups: [] },
			{ id: "model", label: text("Models", "模型"), groups: [] },
			{ id: "providers", label: text("Providers", "服务商"), groups: [] },
			{ id: "tasks", label: text("Tasks", "任务"), groups: [] },
			{ id: "files", label: text("Files", "文件"), groups: [] },
			{ id: "shell", label: text("Shell", "终端"), groups: [] },
			{ id: "tools", label: text("Tools", "工具"), groups: [] },
			{ id: "memory", label: text("Memory", "记忆"), groups: [] },
			{ id: "interaction", label: text("Interaction", "交互"), groups: [] },
		],
		entries: [
			{
				path: "compaction.enabled",
				type: "boolean",
				tab: "context",
				value: true,
				default: true,
				label: text("Automatic compaction", "自动压缩"),
				description: text(
					"Demo: preserve room for the next task by summarizing older context.",
					"演示：汇总较早的上下文，为后续任务保留空间。",
				),
			},
			{
				path: "compaction.thresholdPercent",
				type: "number",
				tab: "context",
				value: 80,
				default: 80,
				label: text("Context threshold (%)", "上下文阈值（%）"),
				description: text(
					"Demo: compact when context reaches this percentage.",
					"演示：上下文达到此比例时进行压缩。",
				),
			},
			{
				path: "compaction.reserveTokens",
				type: "number",
				tab: "context",
				value: 16_384,
				default: 16_384,
				label: text("Reserved output tokens", "预留输出令牌"),
				description: text(
					"Demo: keep a response budget available after compaction.",
					"演示：压缩后仍为模型回复预留额度。",
				),
			},
			{
				path: "hideThinkingBlock",
				type: "boolean",
				tab: "model",
				value: false,
				default: false,
				label: text("Hide reasoning blocks", "隐藏推理内容"),
				description: text(
					"Demo: keep reasoning visible alongside the answer.",
					"演示：在回答旁保留可查看的推理内容。",
				),
			},
			{
				path: "task.showResolvedModelBadge",
				type: "boolean",
				tab: "tasks",
				value: true,
				default: true,
				label: text("Show agent models", "显示智能体模型"),
				description: text(
					"Demo: identify the model assigned to each delegated task.",
					"演示：显示每个委派任务使用的模型。",
				),
			},
			{
				path: "bash.enabled",
				type: "boolean",
				tab: "shell",
				value: true,
				default: true,
				label: text("Shell tool", "终端工具"),
				description: text("Demo capability only; no commands are executed.", "仅展示演示能力，不实际执行命令。"),
			},
			{
				path: "tools.approvalMode",
				type: "enum",
				tab: "tools",
				value: "always-ask",
				default: "always-ask",
				label: text("Tool approvals", "工具审批"),
				description: text(
					"Demo: request confirmation before a tool changes the workspace.",
					"演示：工具更改工作区前请求确认。",
				),
				options: [
					{ value: "always-ask", label: text("Always ask", "始终询问") },
					{ value: "write", label: text("Ask before writes", "写入前询问") },
					{ value: "yolo", label: text("Do not ask", "不询问") },
				],
			},
			{
				path: "memory.backend",
				type: "enum",
				tab: "memory",
				value: "off",
				default: "off",
				options: [{ value: "off", label: text("Off", "关闭") }],
				label: text("Persistent memory", "持久记忆"),
				description: text(
					"Disabled in the demo; no personal history is loaded.",
					"演示中已禁用，不读取任何个人历史。",
				),
			},
			{
				path: "display.showTokenUsage",
				type: "boolean",
				tab: "interaction",
				value: true,
				default: false,
				label: text("Show token usage", "显示令牌用量"),
				description: text("Demo: display synthetic usage figures for the session.", "演示：显示此会话的合成用量。"),
			},
		],
	};
	const values: Record<string, unknown> = {
		...Object.fromEntries(schema.entries.map(entry => [entry.path, entry.value])),
		"theme.dark": "dark",
		"theme.light": "light",
		"theme.mode": "dark",
		"security.enabled": false,
		"speech.enabled": false,
		"stt.enabled": false,
		"display.collapseCompacted": true,
		"terminal.showProgress": true,
		proseOnlyThinking: true,
		omitThinking: false,
	};
	const skills: RpcSkillsResult = {
		skills: [
			{
				name: text("Accessibility review", "无障碍审查"),
				slug: "accessibility",
				description: text(
					"Demo skill: inspect labels, focus order, and native controls.",
					"演示技能：检查标签、焦点顺序与原生控件。",
				),
			},
			{
				name: text("React testing", "React 测试"),
				slug: "react-testing",
				description: text(
					"Demo skill: protect component behavior with focused regression tests.",
					"演示技能：用针对性的回归测试保护组件行为。",
				),
			},
		].map(skill => ({
			name: skill.name,
			description: skill.description,
			source: "native:project",
			provider: "native",
			providerName: text("Demo project", "演示项目"),
			level: "project",
			location: `${cwd}/.showcase/skills/${skill.slug}/SKILL.md`,
			enabled: true,
			managed: false,
			hidden: false,
		})),
	};
	const mcpServers: RpcMcpServersResult = {
		servers: [
			{
				name: text("Design references · demo", "设计参考 · 演示"),
				transport: "http",
				url: "https://design.example.invalid/mcp",
			},
			{
				name: text("Project documentation · demo", "项目文档 · 演示"),
				transport: "http",
				url: "https://docs.example.invalid/mcp",
			},
		].map(server => ({
			...server,
			transport: "http",
			scope: "project",
			status: "disconnected",
			toolCount: 0,
			enabled: false,
			authed: false,
			authState: "none",
			lastError: notice,
		})),
	};
	const gitChanges: RpcGitChanges = {
		isRepo: true,
		root: cwd,
		base: "HEAD",
		truncated: false,
		files: [
			{ path: preferencesPath, status: "M" },
			{ path: testsPath, status: "M" },
		],
	};
	const commands: AvailableCommand[] = [
		{ name: "settings", description: text("Open demo settings", "打开演示设置") },
		{ name: "models", description: text("Browse the demo model catalog", "浏览演示模型目录") },
		{ name: "context", description: text("Inspect synthetic context usage", "查看合成上下文用量") },
		{ name: "stats", description: text("Open synthetic activity statistics", "打开合成活动统计") },
		{ name: "providers", description: text("Inspect disconnected demo providers", "查看未连接的演示服务商") },
	].map(command => ({ ...command, source: "builtin", textModeExecutable: false }));

	const replies = {
		get_state: state,
		get_messages: { messages },
		get_transcript: { messages },
		get_messages_page: { messages, totalMessages: messages.length } satisfies MessagesPage,
		get_available_models: availableModels,
		get_providers: providers,
		get_login_providers: { providers: [] },
		get_model_roles: modelRoles,
		get_model_role_metadata: { roles: roleMetadata } satisfies ModelRoleMetadataResult,
		get_subagents: { subagents },
		get_subagent_messages: { messages: [], nextByte: 0 },
		get_agent_definitions: agentDefinitions,
		get_session_stats: sessionStats,
		get_context_report: contextReport,
		get_usage: usage,
		get_git_status: {
			isRepo: true,
			branch: "demo/accessible-settings",
			staged: 0,
			unstaged: 2,
			untracked: 0,
		} satisfies RpcGitStatus,
		get_git_changes: gitChanges,
		get_git_diff: projectDiffs[preferencesPath],
		get_settings: { values, advisorEnabled: false, advisorActive: false },
		get_settings_schema: schema,
		get_skills: skills,
		get_mcp_servers: mcpServers,
		get_queue: { steering: [], followUp: [] } satisfies RpcGetQueueResult,
		get_goal: { enabled: false, status: "none" } satisfies RpcGoalState,
		get_loop_mode: { enabled: false, state: "off" } satisfies RpcLoopModeState,
		get_vibe_mode: { enabled: false } satisfies RpcVibeModeState,
		get_plan_mode: { enabled: false } satisfies PlanModeState,
		get_plugins: { plugins: [] } satisfies RpcPluginsResult,
		get_hooks: { hooks: [] } satisfies RpcHooksResult,
		get_themes: { themes: [] } satisfies RpcThemesResult,
		get_gui_themes: { themes: [] } satisfies RpcGuiThemesResult,
		get_collab_state: collab,
		get_marketplaces: { marketplaces: [] } satisfies RpcMarketplacesResult,
		get_prompt_templates: { templates: [] } satisfies RpcPromptTemplatesResult,
		get_jobs: { jobs: [] } satisfies RpcJobsResult,
		get_directories: { directories: [{ path: cwd, primary: true }] } satisfies RpcWorkspaceDirectoriesResult,
		get_active_tools: {
			tools: [
				{
					name: "read",
					source: "builtin",
					description: text("Demo: inspect synthetic project files", "演示：查看合成项目文件"),
				},
				{
					name: "edit",
					source: "builtin",
					description: text("Demo: preview a two-file change", "演示：预览两个文件的改动"),
				},
				{
					name: "task",
					source: "builtin",
					description: text("Demo: display delegated work", "演示：展示委派任务"),
				},
			],
		} satisfies RpcActiveToolsResult,
		get_available_commands: { commands },
		get_live_state: {
			active: false,
			phase: "connecting",
			muted: false,
			inputLevel: 0,
			outputLevel: 0,
		} satisfies RpcLiveState,
		get_memory_report: {
			backend: "off",
			entryCount: 0,
			status: { active: false, writable: false, searchable: false, message: notice },
		} satisfies RpcMemoryReport,
		get_security_dashboard: {
			enabled: false,
			modelReady: false,
			repositoryRoot: cwd,
			scans: [],
			operations: [],
		} satisfies RpcSecurityDashboardResult,
		get_ssh_hosts: { hosts: [], warnings: [], openSshAvailable: false } satisfies RpcSshHostsResult,
		list_foreign_sessions: { sessions: [] },
		get_session_tree: { tree: [], activeLeafId: null } satisfies RpcSessionTreeResult,
		get_copy_targets: { targets: [] },
		get_last_assistant_text: { text: summary },
		get_force_tool: { tool: null },
		set_subagent_subscription: {},
		set_host_tools: {},
		set_host_uri_schemes: {},
	} satisfies Partial<Record<RpcCommand["type"], unknown>>;

	// The renderer prints agentType verbatim, so localize this display column.
	const byAgentType: Array<Omit<AgentTypeStats, "agentType"> & { agentType: string }> = [
		{ agentType: text("Main · demo", "主智能体 · 演示"), requests: 290 },
		{ agentType: text("Subagents · demo", "子智能体 · 演示"), requests: 174 },
		{ agentType: text("Advisor · demo", "顾问 · 演示"), requests: 44 },
	].map(row => ({
		agentType: row.agentType,
		totalRequests: row.requests,
		totalInputTokens: row.requests * 1_500,
		totalOutputTokens: row.requests * 800,
		totalCacheReadTokens: row.requests * 7_000,
		totalCacheWriteTokens: row.requests * 700,
		totalCost: row.requests * 0.02,
	}));
	const dailyRequests = [48, 62, 57, 84, 73, 96, 88];
	const dailyErrors = [0, 1, 0, 1, 0, 0, 1];
	const firstDay = Date.UTC(2026, 8, 15);
	const timeSeries: TimeSeriesPoint[] = dailyRequests.map((requests, index) => ({
		timestamp: firstDay + index * dayMs,
		requests,
		errors: dailyErrors[index],
		tokens: requests * 10_000,
		cost: requests * 0.02,
	}));
	const totalRequests = dailyRequests.reduce((sum, requests) => sum + requests, 0);
	const failedRequests = dailyErrors.reduce((sum, errors) => sum + errors, 0);
	const overall: AggregatedStats = {
		totalRequests,
		successfulRequests: totalRequests - failedRequests,
		failedRequests,
		errorRate: failedRequests / totalRequests,
		totalInputTokens: totalRequests * 1_500,
		totalOutputTokens: totalRequests * 800,
		totalCacheReadTokens: totalRequests * 7_000,
		totalCacheWriteTokens: totalRequests * 700,
		cacheRate: 7_000 / (1_500 + 7_000 + 700),
		cacheSavings: 0.64,
		totalCost: totalRequests * 0.02,
		unpricedRequests: 0,
		totalPremiumRequests: totalRequests,
		avgDuration: 11_100,
		avgTtft: 420,
		avgTokensPerSecond: 72,
		firstTimestamp: firstDay,
		lastTimestamp: showcaseTimestamp,
	};
	return {
		replies,
		stats: { "/api/stats/overview": { overall, byAgentType, timeSeries, source: notice } },
	};
}
