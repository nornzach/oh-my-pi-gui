/**
 * Chinese (zh) translations for the agent settings schema content:
 * group titles keyed by schema group name, setting labels/descriptions
 * keyed by setting path. SettingsWindow consults these only when the
 * active language is zh and falls back to the schema's English text
 * for anything missing.
 *
 * Boundary: the named tabs (appearance…providers) and the Advanced tab
 * (schema settings without ui metadata) are both fully covered.
 */

/** Section headings declared in the schema's TAB_GROUPS. */
export const ZH_GROUP_TITLES: Record<string, string> = {
	Theme: "主题",
	"Status Line": "状态栏",
	Display: "显示",
	Images: "图片",
	Thinking: "思考",
	Sampling: "采样",
	Prompt: "提示词",
	"Retry & Fallback": "重试与回退",
	Advisor: "顾问（Advisor）",
	Prewalk: "Prewalk",
	Vision: "视觉",
	Input: "输入",
	Approvals: "审批",
	Notifications: "通知",
	Speech: "语音",
	Collab: "协作",
	"Magic Keywords": "魔法关键词",
	"Startup & Updates": "启动与更新",
	"Power (macOS)": "电源（macOS）",
	Agent: "Agent",
	Git: "Git",
	General: "常规",
	Compaction: "压缩",
	"Rules (TTSR)": "规则（TTSR）",
	Experimental: "实验性",
	"Auto-Learn": "自动学习",
	Mnemopi: "Mnemopi",
	Hindsight: "Hindsight",
	Editing: "编辑",
	Reading: "读取",
	"Read Summaries": "读取摘要",
	LSP: "LSP",
	Bash: "Bash",
	"Eval & Runtimes": "Eval 与运行时",
	"Available Tools": "可用工具",
	Todos: "待办",
	"Grep & Browser": "Grep 与浏览器",
	Computer: "桌面控制",
	GitHub: "GitHub",
	"Output Limits": "输出上限",
	Execution: "执行",
	"Discovery & MCP": "发现与 MCP",
	Extensions: "扩展",
	Developer: "开发者",
	Modes: "模式",
	Subagents: "子代理",
	Isolation: "隔离",
	"Commands & Skills": "命令与技能",
	Services: "服务",
	Fireworks: "Fireworks",
	"Tiny Model": "微型模型",
	Protocol: "协议",
	Timeouts: "超时",
	Privacy: "隐私",
};

/** Per-setting row text, keyed by schema setting path. */
export const ZH_SETTINGS: Record<string, { label: string; description?: string }> = {
	"extensionHandlers.toolCallTimeoutMs": {
		label: "扩展工具调用超时（毫秒）",
		description: "扩展 tool_call 处理器的有效工作超时；等待 OMP 对话框期间不计时，无效值回退为 30000 毫秒。",
	},
	// ── appearance ──────────────────────────────────────────────────────────
	"theme.dark": { label: "深色主题", description: "TUI 与 GUI 使用深色外观时的主题配色" },
	"theme.light": { label: "浅色主题", description: "TUI 与 GUI 使用浅色外观时的主题配色" },
	symbolPreset: { label: "符号预设", description: "图标与符号的字形集（Unicode、Nerd Font 或 ASCII）" },
	colorBlindMode: { label: "色盲模式", description: "差异新增行使用蓝色而非绿色" },
	"statusLine.preset": { label: "状态预设", description: "TUI 状态栏与 GUI 底部状态栏共用的布局预设" },
	"statusLine.separator": { label: "状态栏分隔符", description: "各分段之间分隔符的样式" },
	"statusLine.sessionAccent": { label: "会话强调色", description: "将会话名称的颜色用于编辑器边框和状态栏间隙" },
	"statusLine.transparent": {
		label: "透明状态栏",
		description:
			"状态栏使用终端默认背景而非主题的 `statusLineBg`。Powerline 端帽会被丢弃，因为它们需要对比色填充来过渡到周围的终端区域。",
	},
	"statusLine.compactThinkingLevel": {
		label: "紧凑思考等级",
		description: "在模型名称上以单个图标显示思考等级，而不是附加独立的 ` · <等级>` 后缀。",
	},
	"statusLine.showHookStatus": { label: "显示钩子状态", description: "在状态栏下方显示钩子状态消息" },
	"terminal.showImages": { label: "显示内联图片", description: "在终端中内联渲染图片" },
	"images.autoResize": { label: "自动缩放图片", description: "将大图缩放至最大 2000x2000，以获得更好的模型兼容性" },
	"images.blockImages": { label: "屏蔽图片", description: "阻止图片发送给 LLM 提供商" },
	"terminal.showProgress": {
		label: "原生运行进度",
		description: "显示原生运行进度：终端使用 OSC 9;4，GUI 使用 Dock 徽标与窗口进度条",
	},
	"tui.textSizing": {
		label: "大标题（Kitty）",
		description:
			"使用 Kitty 的 OSC 66 文本尺寸协议将 Markdown H1 标题以 2 倍缩放渲染。仅在 Kitty 终端上生效，其他终端忽略。默认关闭。",
	},
	"tui.renderMermaid": {
		label: "渲染 Mermaid 图表",
		description: "允许 Agent 使用 Mermaid 图表：TUI 渲染为 ASCII，GUI 渲染为图形",
	},
	"tui.codexResetFireworks": {
		label: "Codex 重置烟花",
		description: "当 Codex 每周用量意外重置或有新存入的保存重置时，在屏幕顶部三分之一处放烟花庆祝，直到按 Escape",
	},
	"tui.titleState": {
		label: "标题运行状态",
		description: "在终端标题或 GUI 窗口标题中显示 Agent 的工作、等待和轮到用户状态",
	},
	"tui.hyperlinks": {
		label: "终端超链接",
		description:
			"将路径和 URL 包裹为 OSC 8 超链接，以便终端原生点击打开（auto：检测支持；off：从不；always：无条件）",
	},
	"tui.tight": { label: "紧凑界面密度", description: "压缩 TUI 输出与 GUI 界面间距" },
	"tui.scrollbackRebuild": {
		label: "重写滚动历史",
		description:
			"当块的最终形态替换其实时预览时，擦除并重放终端滚动历史。关闭时（默认），过时的预览副本保留在历史中，最终内容追加在下方。",
	},
	"display.shimmer": { label: "微光动画", description: "工作/加载消息的动画样式" },
	"display.smoothStreaming": { label: "平滑流式输出", description: "在数据块到达时平滑地展现助手文本和流式工具输入" },
	"display.showTokenUsage": { label: "显示 Token 用量", description: "在助手消息上显示每轮 token 用量" },
	"display.cacheMissMarker": {
		label: "缓存未命中标记",
		description: "当某轮助手请求丢失（未命中）提示词缓存时，在其上方显示分隔线",
	},
	"display.collapseCompacted": {
		label: "折叠已压缩历史",
		description: "在实时转录中把压缩前的历史折叠到摘要分隔线之后；禁用则保留完整转录，并在每个压缩点显示分隔线",
	},
	showHardwareCursor: { label: "显示硬件光标", description: "显示终端光标以支持输入法（IME）" },
	"tui.imeSafeCursor": {
		label: "输入法安全的提示符布局",
		description: "把提示符底边框移到单独一行，避免 macOS 输入法预编辑文本使其移位",
	},
	"task.showResolvedModelBadge": {
		label: "显示解析后模型徽章",
		description: "在任务部件状态行中显示每个子代理实际使用的模型 ID",
	},

	// ── model ───────────────────────────────────────────────────────────────
	"advisor.enabled": {
		label: "启用顾问",
		description: "搭配第二个模型（分配给 'advisor' 角色），被动审查每一轮并注入批注。",
	},
	"prewalk.enabled": {
		label: "启用 Prewalk",
		description:
			"先以当前模型开始，在计划提示的待办列表生成后、首次编辑/写入时切换到快速/便宜的模型（默认 'smol' 角色）——强模型负责规划、提交待办并开始实现，然后交接。可用 --prewalk / --no-prewalk 按会话覆盖。",
	},
	// 17.3.0 移除了全局 advisor.subagents（迁移至 task.agentAdvisor）。
	"task.agentAdvisor": {
		label: "子代理顾问（按 agent）",
		description:
			'按 agent 名称配置顾问模型（取代已移除的 advisor.subagents），例如 { task: "on" } 表示对 task 子代理启用默认顾问。',
	},
	"advisor.syncBacklog": {
		label: "顾问同步积压",
		description: "当顾问落后此轮数时，暂停主 Agent 最多 30 秒。Off 表示禁用追赶延迟。",
	},
	"advisor.immuneTurns": {
		label: "顾问免疫轮数",
		description: "顾问的疑虑或阻断打断一次之后，在此数量的主轮次内将后续的疑虑/阻断以非打断方式路由。",
	},
	modelRoleStorage: { label: "模型角色存储", description: "模型选择器中角色分配的保存位置" },
	"images.describeForTextModels": {
		label: "为纯文本模型描述图片",
		description: "当图片附加到不支持视觉的模型时，将其保存到 local:// 下，并注入来自视觉模型的描述，而不是丢弃",
	},
	"images.urls.enabled": {
		label: "以 URL 发送图片",
		description: "通过配置的后端发布图片，并向可抓取 URL 的提供商发送短链接；全部后端失败时自动回退为内联图片",
	},
	"images.urls.backends": { label: "图片 URL 后端", description: "发布图片时按顺序尝试的目标" },
	"images.urls.options": { label: "图片 URL 后端选项", description: "各发布后端使用的 JSON 选项" },
	"images.urls.credentials": { label: "图片 URL 后端凭据", description: "各发布后端使用的凭据；界面会隐藏其值" },
	"images.urls.command": { label: "图片上传命令", description: "command 后端使用的 argv 模板" },
	"images.urls.publicBaseUrl": { label: "图片公共 URL", description: "代理图片服务的外部可访问基础 URL" },
	"images.urls.ttlHours": {
		label: "图片 URL 有效期",
		description: "图片链接的有效小时数；0 表示 broker 运行期间持续有效",
	},
	"images.urls.bindHost": { label: "图片服务监听地址", description: "图片 blob 服务监听的主机地址" },
	"images.urls.sshTarget": { label: "图片 SSH 目标", description: "建立 SSH 反向转发的 user@host 目标" },
	"images.urls.sshRemotePort": { label: "图片 SSH 远端端口", description: "SSH 反向转发使用的远端监听端口" },
	defaultThinkingLevel: { label: "思考等级", description: "支持思考的模型的推理深度" },
	hideThinkingBlock: { label: "隐藏思考块", description: "在助手回复中隐藏思考块" },
	proseOnlyThinking: { label: "仅散文思考", description: "从思考摘要中省略代码块，并以省略号替代" },
	omitThinking: { label: "省略思考摘要", description: "指示上游提供商在回复中完全省略思考摘要（在支持的情况下）" },
	"model.loopGuard.enabled": { label: "循环守卫", description: "为模型推理和散文输出启用自动流式循环检测" },
	"model.loopGuard.checkAssistantContent": {
		label: "循环守卫扫描散文",
		description: "除思考日志外，还对助手散文消息应用循环守卫",
	},
	"model.loopGuard.toolCallReminder": {
		label: "循环守卫工具调用提醒",
		description:
			"当 Gemini 推理流连续输出多个规划标题却不调用工具时，中断它并注入一条要求发起工具调用的提醒（需启用循环守卫）",
	},
	"model.toolCallLoopGuard.enabled": {
		label: "工具调用循环守卫",
		description: "检测跨轮次的连续相同工具调用，并注入纠正性引导",
	},
	"model.toolCallLoopGuard.threshold": {
		label: "工具调用循环阈值",
		description: "注入纠正性引导所需的连续相同工具调用次数",
	},
	"model.toolCallLoopGuard.exemptTools": {
		label: "循环豁免工具",
		description: "允许连续重复而不触发跨轮循环守卫的工具名称",
	},
	inlineToolDescriptors: {
		label: "内联工具描述符",
		description:
			"在系统提示词中渲染完整的工具描述符，并从提供商工具 schema 中剥离顶层/嵌套描述，使描述文本只发送一次。Auto 对 Gemini 模型启用，其他模型禁用",
	},
	includeModelInPrompt: {
		label: "在提示词中包含模型",
		description: "在系统提示词中暴露当前模型标识符，让 Agent 知道自己使用的是哪个模型",
	},
	includeWorkspaceTree: {
		label: "包含工作区目录树",
		description: "在系统提示词中渲染工作区目录树。警告：文件修改时可能破坏跨会话的提示词缓存。",
	},
	personality: { label: "性格", description: "渲染到系统提示词性格块中的沟通风格" },
	temperature: { label: "温度", description: "采样温度（0 = 确定性，1 = 创造性，-1 = 提供商默认）" },
	topP: { label: "Top P", description: "核采样截断（0-1，-1 = 提供商默认）" },
	topK: { label: "Top K", description: "从概率最高的 K 个 token 中采样（-1 = 提供商默认）" },
	minP: { label: "Min P", description: "最小概率阈值（0-1，-1 = 提供商默认）" },
	presencePenalty: { label: "存在惩罚", description: "对引入已出现 token 的惩罚（-1 = 提供商默认）" },
	repetitionPenalty: { label: "重复惩罚", description: "对重复 token 的惩罚（-1 = 提供商默认）" },
	textVerbosity: { label: "文本详细度", description: "OpenAI Responses 与 Codex 的回复详细度（low、medium 或 high）" },
	"tier.openai": {
		label: "服务等级 — OpenAI",
		description:
			"OpenAI / OpenAI-Codex 请求以及经 OpenRouter 路由的 OpenAI 系模型的处理等级（none = 不发送）。以 `service_tier` 发送。",
	},
	"tier.anthropic": {
		label: "服务等级 — Anthropic",
		description:
			'Claude 请求的处理等级。`priority` 在支持的 Anthropic 直连模型上实现快速模式（`speed: "fast"`）；在 Bedrock/Vertex Claude 及经 OpenRouter 时忽略。',
	},
	"tier.google": {
		label: "服务等级 — Google",
		description:
			"Gemini（Google AI Studio + Vertex）请求以及经 OpenRouter 路由的 Google 系模型的处理等级（none = 不发送）。以顶层 `serviceTier` 字段发送。",
	},
	"tier.subagent": {
		label: "服务等级 — 子代理",
		description:
			"派生的 task/eval 子代理的服务等级。Inherit = 跟随主 Agent 当前的按厂商等级（随 /fast 变化）；选择具体值则应用于子代理模型所属的厂商。",
	},
	"tier.advisor": {
		label: "服务等级 — 顾问",
		description:
			"顾问模型的服务等级。None = 标准处理；Inherit = 跟随主 Agent 当前的按厂商等级；选择具体值则应用于顾问模型所属的厂商。",
	},
	"retry.maxRetries": { label: "重试次数", description: "API 出错时的最大重试次数" },
	"retry.maxDelayMs": {
		label: "最大重试延迟",
		description:
			"重试之间的最长等待时间（毫秒）。当提供商要求等待超过此值、且没有凭据或模型回退成功时，请求会快速失败而不是睡眠等待（例如 Anthropic 长达 3 小时的限流窗口）。",
	},
	"retry.modelFallback": { label: "重试模型回退", description: "允许重试恢复时切换到配置的回退模型" },
	"retry.usageAwareFallback": {
		label: "用量感知回退",
		description:
			"利用可靠的编程套餐额度报告，在硬性用量限制前优先选择同提供商账户，其次是配置的回退模型。普通配置的 API 密钥不参与。",
	},
	"retry.usageReservePct": {
		label: "预留余量",
		description: "剩余额度低于此百分比时，将编程套餐模型视为接近上限。用量未知或未映射时保持主模型。",
	},
	"retry.usageReservePolicy": {
		label: "预留策略",
		description: "当所有同提供商编程套餐账户都进入预留余量时的处理方式。",
	},
	"retry.fallbackChains": {
		label: "重试回退链",
		description:
			'将模型角色、模型选择器（"provider/model-id"）或提供商通配符（"provider/*"）映射为有序回退选择器的 JSON 对象，例如 {"default":["openai/gpt-4o-mini"],"google-antigravity/*":["google/*","google-vertex/*"]}。面向模型的键在该模型/提供商激活时生效，与角色无关；"provider/*" 条目保留失败模型的 id 并更换提供商。带 id 前缀的通配符（"openrouter/google/*"）会为失败模型的裸 id 重新添加前缀（google-antigravity/gemini-x -> openrouter/google/gemini-x），用作键时仅匹配该提供商在该前缀下的 id。',
	},
	"retry.fallbackRevertPolicy": { label: "回退恢复策略", description: "回退之后何时返回主模型" },
	"providers.anthropic.serverSideFallback": {
		label: "Anthropic 服务端回退（Fable 5）",
		description:
			"当 Claude Fable 5 / Mythos 5 请求被 Anthropic 安全分类器拦截时，在服务端改用 Claude Opus 4.8 重试（Anthropic `server-side-fallback-2026-06-01` beta）。需手动开启——保持关闭则所有请求维持回退前的行为。",
	},
	"providers.autoThinkingModel": {
		label: "自动思考模型",
		description: "`auto` 思考等级的难度分类器：默认在线（/models 中的 TINY 角色，否则为 smol），或本地端侧模型",
	},
	"providers.autoThinkingMaxEffort": {
		label: "自动思考强度上限",
		description:
			"`auto` 分类器可解析的最高强度。`xhigh` 使分类器比最高档低一级，因此只有显式的 `ultrathink` 才能达到 `max`；`max` 则允许分类器判定为异常的轮次在暴露该档位的模型上按最高档计费。",
	},

	// ── interaction ─────────────────────────────────────────────────────────
	autoResume: { label: "自动恢复", description: "自动恢复当前目录中最近的会话" },
	"power.sleepPrevention": {
		label: "防止睡眠",
		description: "在活动会话期间防止 macOS 睡眠。每个等级是累积的——它会叠加所有更低等级的标志。",
	},
	"git.enabled": { label: "启用 Git 集成", description: "在 TUI 中显示 git 分支、状态和 PR 信息，并监视仓库元数据。" },
	steeringMode: { label: "引导模式", description: "Agent 工作时如何处理排队的消息" },
	followUpMode: { label: "跟进模式", description: "一轮结束后如何逐出跟进消息" },
	interruptMode: { label: "中断模式", description: "引导消息何时中断工具执行" },
	"loop.mode": { label: "循环模式", description: "/loop 迭代之间、重新提交提示词之前执行什么操作" },
	doubleEscapeAction: { label: "双击 Escape 动作", description: "编辑器为空时连续按两次 Escape 触发的动作" },
	treeFilterMode: { label: "会话树过滤", description: "打开会话树时的默认过滤模式" },
	autocompleteMaxVisible: { label: "自动补全条目数", description: "自动补全下拉框中最大可见条目数（3-20）" },
	emojiAutocomplete: {
		label: "Emoji 自动补全",
		description: "根据 `:name:` 短代码建议 emoji，并展开 `:D` 或 `:-)` 之类的文本表情",
	},
	"paste.largeMenuThreshold": {
		label: "大段粘贴菜单",
		description:
			"当粘贴达到此行数时，提供菜单将其包裹为代码块、包裹进 XML 标签或保存为文件。0 表示禁用该菜单（大段粘贴仍会折叠为 [Paste] 标记）。",
	},
	"startup.quiet": { label: "静默启动", description: "跳过欢迎界面和启动状态消息" },
	"startup.showSplash": {
		label: "显示启动画面",
		description: "正常交互式启动时显示完整的动画设置画面，而不重新运行设置。静默启动仍会抑制它。",
	},
	"startup.setupWizard": { label: "设置向导", description: "每个设置版本展示一次新增的入门引导步骤" },
	"startup.checkUpdate": { label: "检查更新", description: "启动时检查 omp 更新" },
	"marketplace.autoUpdate": { label: "插件市场自动更新", description: "启动时检查插件更新" },
	"startup.changelogMode": { label: "启动更新日志", description: "选择更新说明以摘要、完整详情开始，或保持隐藏" },
	"magicKeywords.enabled": {
		label: "魔法关键词",
		description: "为独立的 ultrathink、orchestrate 和 workflowz 关键词启用隐藏提示",
	},
	"magicKeywords.ultrathink": {
		label: "Ultrathink 关键词",
		description: "允许独立的 ultrathink 请求最大自动思考并附加其隐藏提示",
	},
	"magicKeywords.orchestrate": {
		label: "Orchestrate 关键词",
		description: "允许独立的 orchestrate 附加其隐藏的多代理编排提示",
	},
	"magicKeywords.workflow": {
		label: "Workflow 关键词",
		description: "允许独立的 workflowz 附加其隐藏的 eval 工作流提示",
	},
	"completion.notify": { label: "完成通知", description: "Agent 完成一轮时通知" },
	"error.notify": { label: "错误通知", description: "Agent 因错误停止时通知" },
	"ask.timeout": { label: "询问超时", description: "经过此秒数后自动选择推荐的询问选项（0 表示禁用）" },
	"ask.notify": { label: "询问通知", description: "ask 工具等待输入时通知" },
	"recap.enabled": { label: "空闲回顾", description: "终端空闲一段时间后，生成一段简短的 LLM 回顾说明当前进展" },
	"recap.idleSeconds": { label: "空闲回顾延迟", description: "空闲等待多少秒后显示回顾" },
	"collab.relayUrl": { label: "中继 URL", description: "/collab 使用的中继（wss://host[:port]）" },
	"collab.webUrl": {
		label: "Web UI URL",
		description: "/collab 链接使用的浏览器 UI；留空则从 collab.relayUrl 推导；显式 http:// 仅限 localhost",
	},
	"collab.displayName": { label: "显示名称", description: "向其他协作参与者显示的名字（默认：操作系统用户名）" },
	"share.serverUrl": {
		label: "分享服务器",
		description: "/share 使用的分享查看/上传基础地址（加密 blob 上传 + 查看器；链接形如 <base>/<id>#<key>）",
	},
	"share.store": { label: "分享存储", description: "/share 上传加密会话 blob 的位置" },
	"share.redactSecrets": {
		label: "分享密钥脱敏",
		description: "上传前对 /share 快照运行密钥混淆器（使用 secrets.* 配置）",
	},
	"stt.enabled": { label: "语音转文字", description: "启用通过麦克风的语音转文字输入" },
	"stt.modelName": {
		label: "语音识别模型",
		description:
			"本地端侧语音模型。Parakeet TDT v3（sherpa-onnx）是 SoTA 默认；Whisper base/small/large-v3-turbo 各档（transformers.js）以体积换取多语言覆盖。首次使用时下载。",
	},
	"stt.submitTrigger": {
		label: "语音听写提交触发",
		description: "选择语音听写何时自动提交：从不、松手（2 个以上词）、松手且句子完整、或当我说“提交”。",
	},
	"tools.approval": {
		label: "工具审批策略",
		description:
			"按工具配置审批策略。设为 'allow' 自动批准，'prompt' 需要确认，'deny' 阻止。这些覆盖在任何审批模式下都生效。",
	},
	"tools.approvalMode": {
		label: "工具审批",
		description:
			"工具调用的默认审批行为。'总是询问' 仅自动批准只读工具；'写入' 自动批准读取和工作区写入工具；'Yolo' 自动批准所有层级，但用户策略仍可提示或阻止。",
	},
	"features.unexpectedStopDetection": {
		label: "检测意外停止",
		description: "使用小模型检测助手声称要继续却没有调用工具就停止的情况；自动提示它继续。",
	},

	// ── context ─────────────────────────────────────────────────────────────
	"workspace.additionalDirectories": {
		label: "额外工作区目录",
		description:
			"作为额外根目录加入每个会话的工作区目录（多根工作区）。可通过 /add-dir 和 /remove-dir 实时管理。路径相对于 cwd 解析，建议使用绝对路径。Agent 会被告知这些根目录存在，并可对它们 read/grep/glob。",
	},
	"contextPromotion.enabled": {
		label: "自动提升上下文",
		description: "上下文溢出时提升到更大上下文的模型，而不是压缩",
	},
	extendedContext: {
		label: "扩展上下文",
		description: "对超过标准计费阈值会加价的模型启用扩展上下文；关闭后会在标准计费窗口前触发压缩。",
	},
	"compaction.enabled": { label: "自动压缩", description: "上下文过大时自动压缩" },
	"compaction.midTurnEnabled": {
		label: "轮中压缩",
		description: "在下一次提供商请求之前，于安全的轮中工具循环边界检查阈值",
	},
	"compaction.methodOrder": {
		label: "压缩方法顺序",
		description: "自动维护上下文时按此顺序尝试；当前方法不可用或失败后会继续下一个。",
	},
	"compaction.thresholdPercent": {
		label: "压缩阈值",
		description: "上下文维护的百分比阈值；设为 Default 使用旧的基于预留的行为",
	},
	"compaction.thresholdTokens": {
		label: "压缩 Token 上限",
		description: "上下文维护的固定 token 上限；设置后覆盖百分比阈值",
	},
	"compaction.handoffSaveToDisk": {
		label: "保存交接文档",
		description: "为自动交接流程把生成的交接文档保存为 markdown 文件",
	},
	"compaction.remoteStreamingV2Enabled": {
		label: "远程压缩 V2",
		description: "对兼容的远程压缩模型使用 Responses 流式压缩",
	},
	"compaction.asyncEnabled": {
		label: "异步压缩",
		description: "接近阈值时在后台预先生成压缩结果，达到阈值后立即接入当前会话。",
	},
	"compaction.idleEnabled": { label: "空闲压缩", description: "token 数超过阈值时在空闲时压缩上下文" },
	"compaction.idleThresholdTokens": { label: "空闲压缩阈值", description: "触发空闲压缩的 token 数" },
	"compaction.idleTimeoutSeconds": { label: "空闲压缩延迟", description: "空闲等待多少秒后开始压缩" },
	"compaction.supersedeReads": {
		label: "取代过期读取",
		description: "当同一文件被再次读取时，修剪较旧的读取结果（缓存感知，每轮运行）",
	},
	"compaction.dropUseless": {
		label: "省略无用结果",
		description: "工具结果被消费后，修剪被标记为上下文无用（无匹配、等待超时）的结果（缓存感知）",
	},
	"snapcompact.systemPrompt": {
		label: "Snapcompact 系统提示词",
		description:
			"实验性：将选定的系统提示词文本渲染为密集 PNG 图片并附加到首条用户消息（仅限视觉模型）。节省 token，但被成像的文本会失去提示词缓存。",
	},
	"snapcompact.toolResults": {
		label: "Snapcompact 工具结果",
		description:
			"实验性：将大型历史工具结果渲染为密集 PNG 图片而非文本（仅限视觉模型）。节省累积的读取/搜索输出的 token。",
	},
	"tools.format": {
		label: "工具调用模式",
		description:
			"控制工具如何暴露给模型。Auto 使用提供商原生工具调用，除非所选模型被标记为不支持，则回退到 GLM 自有方言。Native 强制提供商原生工具；其他值强制使用指定的自有方言。会话启动时生效。",
	},
	"snapcompact.shape": {
		label: "Snapcompact 形状",
		description: "snapcompact 打印文本所用的画框形状（压缩归档与内联成像）。Auto 选择针对当前模型调优的形状。",
	},
	"branchSummary.enabled": { label: "分支摘要", description: "离开分支时提示生成摘要" },
	"ttsr.enabled": {
		label: "TTSR",
		description: "当输出匹配规则模式时中断 Agent 流式输出（时间旅行流规则，Time-Traveling Stream Rules）",
	},
	"ttsr.contextMode": { label: "TTSR 上下文模式", description: "TTSR 触发时如何处理部分输出" },
	"ttsr.interruptMode": { label: "TTSR 中断模式", description: "何时在流中直接中断，何时在完成后再注入警告" },
	"ttsr.repeatMode": { label: "TTSR 重复模式", description: "规则如何重复触发：每会话一次，或间隔若干消息后" },
	"ttsr.repeatGap": { label: "TTSR 重复间隔", description: "规则再次触发前需要的消息数" },
	"ttsr.builtinRules": {
		label: "内置规则",
		description: "加载 Agent 自带的默认规则（可用 ttsr.disabledRules 单独覆盖）",
	},
	"ttsr.disabledRules": { label: "禁用规则", description: "完全忽略的规则名称（对内置默认规则和你自己的规则都生效）" },

	// ── memory ──────────────────────────────────────────────────────────────
	"memory.backend": { label: "记忆后端", description: "关闭、本地摘要管线、Mnemopi SQLite，或 Hindsight 远程记忆" },
	"autolearn.enabled": {
		label: "自动学习（实验性）",
		description: "Agent 停止后，提醒它把经验教训沉淀到记忆，并创建/完善隔离的受管技能",
	},
	"autolearn.autoContinue": {
		label: "停止时自动沉淀",
		description: "开启时，停止后自动运行一个私密的沉淀轮次（消耗额外 token）。关闭时，仅保留常驻的自动学习引导。",
	},
	"mnemopi.dbPath": { label: "Mnemopi 数据库路径", description: "可选的 SQLite 数据库路径。默认为 Agent 记忆目录。" },
	"mnemopi.bank": {
		label: "Mnemopi 记忆库",
		description: "可选的共享记忆库基础名称。按项目模式会由它派生项目本地记忆库。",
	},
	"mnemopi.scoping": {
		label: "Mnemopi 作用域",
		description:
			"global = 一个共享记忆库；per-project = 每个 cwd 独立记忆库；per-project-tagged = 项目本地写入 + 全局召回可见",
	},
	"mnemopi.embeddingVariant": {
		label: "嵌入模型变体",
		description:
			"本地嵌入模型家族。en = 更强的英文模型；multilingual = 跨语言模型。更改后会在下次启动时重建现有记忆嵌入。",
	},
	"mnemopi.autoRecall": { label: "Mnemopi 自动召回", description: "在每个会话的第一轮召回本地记忆" },
	"mnemopi.autoRetain": { label: "Mnemopi 自动留存", description: "把完成的对话轮次留存到本地 Mnemopi 记忆" },
	"mnemopi.polyphonicRecall": {
		label: "Mnemopi 多声部召回",
		description: "启用 4 路召回（向量、图、事实、时序），以倒数排名融合（RRF）合并",
	},
	"mnemopi.enhancedRecall": { label: "Mnemopi 增强召回", description: "为重复和相似的召回查询启用分层查询结果缓存" },
	"mnemopi.proactiveLinking": {
		label: "Mnemopi 主动链接",
		description: "新记忆存储时即纳入情景图，链接到相关实体与记忆",
	},
	"mnemopi.noEmbeddings": { label: "Mnemopi 禁用嵌入", description: "强制使用确定性的纯 FTS 召回，而非向量嵌入" },
	"mnemopi.embeddingModel": {
		label: "Mnemopi 嵌入模型",
		description: "高级：显式嵌入模型 id，覆盖变体设置。留空则使用 mnemopi.embeddingVariant。",
	},
	"mnemopi.embeddingApiUrl": { label: "Mnemopi 嵌入 API URL", description: "传给 Mnemopi 的可选 OpenAI 兼容嵌入端点" },
	"mnemopi.embeddingApiKey": { label: "Mnemopi 嵌入 API 密钥", description: "传给 Mnemopi 的可选嵌入 API 密钥" },
	"mnemopi.llmMode": {
		label: "Mnemopi LLM 模式",
		description: "不使用 LLM、使用在线微型模型（/models 中的 TINY 角色，否则为 @smol），或远程 OpenAI 兼容端点",
	},
	"mnemopi.llmBaseUrl": { label: "Mnemopi LLM Base URL", description: "Mnemopi 远程模式的可选 OpenAI 兼容 LLM 端点" },
	"mnemopi.llmApiKey": { label: "Mnemopi LLM API 密钥", description: "Mnemopi 远程模式的可选 LLM API 密钥" },
	"mnemopi.llmModel": { label: "Mnemopi LLM 模型", description: "Mnemopi 远程模式的可选 LLM 模型名称" },
	"hindsight.apiUrl": { label: "Hindsight API URL", description: "Hindsight 服务器 URL（云端或自托管）" },
	"hindsight.apiToken": { label: "Hindsight API 令牌", description: "用于需要认证的 Hindsight 服务器的 Bearer 令牌" },
	"hindsight.bankId": { label: "Hindsight 记忆库 ID", description: "记忆库标识符（默认：项目名）" },
	"hindsight.scoping": {
		label: "Hindsight 作用域",
		description:
			"global = 一个共享记忆库；per-project = 每个 cwd 独立记忆库；per-project-tagged = 共享记忆库带项目标签，召回时合并全局与项目记忆",
	},
	"hindsight.autoRecall": { label: "Hindsight 自动召回", description: "在每个会话的第一轮召回记忆" },
	"hindsight.autoRetain": { label: "Hindsight 自动留存", description: "每 N 轮及会话边界处留存转录" },
	"hindsight.retainMode": {
		label: "Hindsight 留存模式",
		description: "full-session = 每会话更新插入一份文档；last-turn = 分块",
	},
	"hindsight.mentalModelsEnabled": {
		label: "Hindsight 心智模型",
		description:
			"启动时把精选的反思摘要（心智模型）读入开发者指令。加载记忆库上已有的模型——不写入。搭配 hindsight.mentalModelAutoSeed 可同时自动创建内置种子集。",
	},
	"hindsight.mentalModelAutoSeed": {
		label: "Hindsight 心智模型自动播种",
		description:
			"会话启动时，创建记忆库上尚不存在的内置心智模型（project-conventions、project-decisions、user-preferences）。",
	},
	"providers.memoryModel": {
		label: "记忆模型",
		description:
			"Mnemopi 用于事实提取与整合的 LLM：默认在线（/models 中的 TINY 角色，否则为 smol/远程），或本地端侧模型",
	},

	// ── files ───────────────────────────────────────────────────────────────
	"edit.mode": { label: "编辑模式", description: "选择编辑工具变体（replace、patch、hashline 或 apply_patch）" },
	"edit.fuzzyMatch": { label: "模糊匹配", description: "对空白差异接受高置信度的模糊匹配" },
	"edit.fuzzyThreshold": { label: "模糊匹配阈值", description: "接受模糊匹配的相似度阈值（0-1）" },
	"edit.streamingAbort": { label: "预览失败即中止", description: "补丁预览失败时中止流式编辑工具调用" },
	"edit.blockAutoGenerated": {
		label: "阻止自动生成的文件",
		description: "阻止编辑看似自动生成的文件（protoc、sqlc、swagger 等）",
	},
	"edit.enforceSeenLines": {
		label: "强制执行已见行守卫",
		description: "拒绝锚定在先前读取/搜索从未完整展示过的行上的编辑",
	},
	"edit.blackbox.enabled": {
		label: "记录编辑解析回归",
		description: "编辑导致 AST 解析失败时，将修改前后源码及调用信息追加到本地诊断日志",
	},
	readLineNumbers: { label: "行号", description: "默认在读取工具输出前添加行号" },
	"read.defaultLimit": { label: "默认读取行数", description: "Agent 调用 read 且不指定行数上限时默认返回的行数" },
	"read.renderMarkdown": {
		label: "Markdown 预览",
		description: "将 Markdown 读取结果渲染为格式化的终端 Markdown 预览，而非原始源码",
	},
	"read.summarize.enabled": { label: "读取摘要", description: "当 read 不带显式选择器调用时返回结构化代码摘要" },
	"read.summarize.prose": { label: "散文摘要", description: "对 Markdown 和纯文本读取返回结构化摘要" },
	"read.summarize.minBodyLines": {
		label: "摘要折叠正文行数",
		description: "多行函数体或字面量超过此行数后才在读取摘要中折叠",
	},
	"read.summarize.minCommentLines": {
		label: "摘要折叠注释行数",
		description: "多行块注释超过此行数后才在读取摘要中折叠",
	},
	"read.summarize.minTotalLines": {
		label: "摘要最小文件行数",
		description: "总行数少于此值的文件按原文读取，而不做结构化摘要",
	},
	"read.summarize.unfoldUntil": {
		label: "摘要展开目标",
		description: "BFS 展开可省略区段，直到摘要至少达到此可见行数。0 表示仅保留最外层省略。",
	},
	"read.summarize.unfoldLimit": {
		label: "摘要展开上限",
		description:
			"BFS 展开时摘要大小的硬上限。若某次展开后可见行数将超过此值，则跳过该展开（该区段保持折叠），并继续展开其余区段。",
	},
	"read.toolResultPreview": { label: "内联读取预览", description: "在转录中内联渲染读取工具结果，而非摘要行" },
	"lsp.enabled": { label: "LSP", description: "启用 lsp 工具以获得代码智能（定义、引用、诊断、重命名）" },
	"lsp.lazy": {
		label: "延迟启动 LSP",
		description: "首次使用（lsp 工具或编辑匹配文件类型）时才启动语言服务器，而非会话启动时",
	},
	"lsp.formatOnWrite": { label: "写入后格式化", description: "写入代码文件后自动使用 LSP 格式化" },
	"lsp.diagnosticsOnWrite": { label: "写入后诊断", description: "写入代码文件后返回 LSP 诊断" },
	"lsp.diagnosticsOnEdit": { label: "编辑后诊断", description: "编辑代码文件后返回 LSP 诊断" },
	"lsp.diagnosticsDeduplicate": {
		label: "诊断去重",
		description: "抑制文件中已展示过的编辑后 LSP 诊断，只呈现新增或变化的",
	},

	// ── shell ───────────────────────────────────────────────────────────────
	"bash.enabled": { label: "Bash", description: "启用 bash 工具以执行 shell 命令" },
	"bash.autoBackground.enabled": {
		label: "Bash 自动后台",
		description: "自动将长时间运行的 bash 命令转入后台，稍后交付结果",
	},
	"bash.patterns": {
		label: "Bash 审批模式",
		description: "有序的 bash 命令审批规则。每项含 match 和 approval 字段；仅支持 '*' 通配符。",
	},
	"bashInterceptor.enabled": { label: "Bash 拦截器", description: "阻止已有专用工具的 shell 命令" },
	"bash.direnv": {
		label: "direnv 自动加载",
		description:
			"自动将仓库的 direnv/devenv `.envrc` 加载到 bash 会话中，无需手动 `direnv exec` 即可使用 devenv 工具和环境变量。遵循 direnv 的允许列表：未经 `direnv allow` 的 `.envrc` 绝不会被执行",
	},
	"bash.direnvLoadTimeoutMs": {
		label: "direnv 加载超时（毫秒）",
		description:
			"首次 `direnv export` 的最长等待时间（冷启动的 devenv shell 可能较慢）；超时后会话将在没有 direnv 环境的情况下运行",
	},
	"shellMinimizer.enabled": {
		label: "Shell 输出压缩",
		description: "在返回给 Agent 前压缩冗长的 shell 输出（git、npm、cargo 等）",
	},
	"shellMinimizer.sourceOutlineLevel": {
		label: "Shell 压缩源码大纲",
		description: "cat/read 源码文件时的源码大纲模式：default 或 aggressive",
	},
	"eval.py": { label: "Python Eval 后端", description: "允许 eval 工具把 Python 单元格派发到 IPython 内核" },
	"eval.js": { label: "JavaScript Eval 后端", description: "允许 eval 工具把 JavaScript 单元格派发到进程内运行时" },
	"eval.rb": { label: "Ruby Eval 后端", description: "允许 eval 工具把 Ruby 单元格派发到持久 Ruby 内核" },
	"eval.jl": { label: "Julia Eval 后端", description: "允许 eval 工具把 Julia 单元格派发到持久 Julia 内核" },
	"python.kernelMode": {
		label: "Python 内核模式",
		description: "在 eval 调用之间保持 IPython 内核存活，或每次全新启动",
	},
	"python.interpreter": {
		label: "Python 解释器",
		description: "指向精确 Python 可执行文件的可选路径。设置后跳过自动 Python 运行时探测。",
	},
	"ruby.interpreter": {
		label: "Ruby 解释器",
		description: "指向精确 Ruby 可执行文件的可选路径。设置后跳过自动 Ruby 运行时探测。",
	},
	"julia.interpreter": {
		label: "Julia 解释器",
		description: "指向精确 Julia 可执行文件的可选路径。设置后跳过自动 Julia 运行时探测。",
	},

	// ── tools ───────────────────────────────────────────────────────────────
	"tools.artifactSpillThreshold": {
		label: "Artifact 溢出阈值（KB）",
		description: "超过此大小的工具输出保存为 artifact；尾部保留内联",
	},
	"tools.artifactTailBytes": {
		label: "Artifact 尾部大小（KB）",
		description: "输出溢出为 artifact 时保留内联的尾部内容量",
	},
	"tools.artifactHeadBytes": {
		label: "Artifact 头部大小（KB）",
		description: "输出溢出为 artifact 时与尾部一起保留内联的头部内容量（中间省略）。0 表示禁用——仅保留尾部。",
	},
	"tools.outputMaxColumns": {
		label: "输出列上限",
		description:
			"流式工具输出（bash、python、js eval）和 `read` 的每行字节上限。超过此宽度的行以省略号截断；到下一个换行符之间的剩余字节被丢弃。0 表示禁用。",
	},
	"tools.artifactTailLines": {
		label: "Artifact 尾部行数",
		description: "输出溢出为 artifact 时保留内联的最大尾部行数",
	},
	"todo.enabled": { label: "待办", description: "启用 todo 工具进行任务跟踪" },
	"todo.reminders": { label: "待办提醒", description: "提醒 Agent 在停止前完成待办" },
	"todo.remindersMax": { label: "待办提醒上限", description: "放弃前的最大待办提醒次数" },
	"todo.eager": { label: "自动创建待办", description: "首条消息后推动自动创建待办列表的力度" },
	"glob.enabled": { label: "Glob", description: "启用 glob 工具进行 glob 模式文件查找" },
	"grep.enabled": { label: "Grep", description: "启用 grep 工具进行正则内容搜索" },
	"grep.contextBefore": { label: "Grep 前置上下文", description: "每个 grep 匹配前显示的上下文行数" },
	"grep.contextAfter": { label: "Grep 后置上下文", description: "每个 grep 匹配后显示的上下文行数" },
	"astGrep.enabled": { label: "AST Grep", description: "启用 ast_grep 工具进行结构化 AST 搜索" },
	"astEdit.enabled": { label: "AST Edit", description: "启用 ast_edit 工具进行结构化 AST 重写" },
	"debug.enabled": { label: "Debug", description: "启用 debug 工具进行基于 DAP 的调试" },
	"launch.enabled": { label: "Launch", description: "启用 launch 工具以监管共享的长期项目进程" },
	"speechgen.enabled": {
		label: "语音生成",
		description: "启用 tts 工具进行端侧（Kokoro）或 xAI Grok Voice 语音文件合成",
	},
	"generate_image.enabled": {
		label: "生成图片",
		description: "启用 generate_image 工具（文生图与图片编辑）。tools.xdev 开启时以 xd:// 设备形式暴露。",
	},
	"inspect_image.mode": {
		label: "图片理解",
		description:
			"控制 inspect_image 工具——它把图片理解委派给视觉模型。'auto' 仅在当前模型缺少原生图片输入时暴露；'on' 总是暴露；'off' 从不暴露。",
	},
	"computer.enabled": { label: "桌面控制", description: "启用原生桌面截图与输入，用于 OpenAI computer use" },
	"computer.backend": { label: "桌面控制后端", description: "选择自动或显式指定平台原生的桌面捕获与输入" },
	"computer.display": { label: "桌面控制显示器", description: "合成所有显示器，或选择一个原生显示器 id" },
	"computer.maxWidth": { label: "截图宽度上限", description: "合成截图的最大宽度（像素）" },
	"computer.maxHeight": { label: "截图高度上限", description: "合成截图的最大高度（像素）" },
	"inspect_image.timeoutMs": {
		label: "图片理解超时",
		description:
			"inspect_image 视觉模型调用的单次请求超时（毫秒）。提供商卡顿时快速失败并返回超时错误，而不是一直阻塞到手动中止。设为 0 禁用超时。",
	},
	"checkpoint.enabled": { label: "检查点/回退", description: "启用 checkpoint 与 rewind 工具进行上下文检查点管理" },
	"fetch.enabled": { label: "读取 URL", description: "允许 read 工具抓取并处理 URL" },
	"vault.enabled": {
		label: "Obsidian 仓库",
		description:
			"启用 vault:// 内部 URL，通过 Obsidian CLI 读写 Obsidian 仓库内容。禁用时 vault:// 解析被拒绝，系统提示词中的 vault:// 条目也会被省略。",
	},
	"github.enabled": {
		label: "GitHub CLI",
		description:
			"启用 github 工具（基于 op 的派发，覆盖仓库、issue、pull request、diff、搜索、checkout、push 与 Actions 监视工作流）",
	},
	"github.cache.enabled": {
		label: "GitHub 视图缓存",
		description: "把渲染好的 issue/PR 视图输出缓存到 ~/.omp/cache/github-cache.db，重复读取零开销",
	},
	"github.cache.softTtlSec": {
		label: "GitHub 缓存软 TTL",
		description: "在此时间窗内直接返回缓存的 issue/PR 视图行（秒；默认 5 分钟）",
	},
	"github.cache.hardTtlSec": {
		label: "GitHub 缓存硬 TTL",
		description: "超过软 TTL 后返回缓存行并在后台刷新；超过硬 TTL 后丢弃（秒；默认 7 天）",
	},
	"web_search.enabled": { label: "网络搜索", description: "启用 web_search 工具获取实时网络结果" },
	"security.enabled": {
		label: "安全",
		description: "启用 OMP 原生安全扫描的规划、执行，以及只读的 security:// 资源命名空间",
	},
	"ask.enabled": { label: "Ask", description: "启用 ask 工具进行交互式用户提问" },
	"browser.enabled": { label: "浏览器", description: "启用 browser 工具进行脚本化 Chromium 自动化（puppeteer）" },
	"browser.cdpUrl": {
		label: "浏览器 CDP URL",
		description:
			"默认的 HTTP CDP 发现端点（例如 http://127.0.0.1:9222），用于附着到已有浏览器而不是启动新浏览器。工具调用中显式的 app.cdp_url 或 app.path 优先。",
	},
	"browser.headless": { label: "无头浏览器", description: "以无头模式启动浏览器（禁用则显示浏览器界面）" },
	"browser.cmux": {
		label: "cmux 浏览器",
		description:
			"有 cmux socket 可用时，使用 cmux WKWebView 表面进行浏览器自动化。可用 PI_BROWSER_CMUX=0 或 PI_BROWSER_CMUX=1 覆盖。",
	},
	"browser.screenshotDir": {
		label: "截图目录",
		description:
			"保存截图的目录。未设置时截图写入临时文件。支持 ~。示例：~/Downloads、~/Desktop、/sdcard/Download（Android）",
	},
	"tools.intentTracing": { label: "意图追踪", description: "要求 Agent 在执行每个工具调用前描述其意图" },
	"tools.abortOnFabricatedResult": {
		label: "捏造工具结果即中止",
		description:
			"使用带内工具调用时，模型一旦在轮次中开始幻觉编造工具结果便立即停止。禁用则让模型完成生成并丢弃编造的后续内容。",
	},
	"tools.maxTimeout": { label: "工具超时上限", description: "Agent 可为任何工具设置的最大超时秒数（0 = 不限制）" },
	"async.enabled": { label: "异步执行", description: "启用异步 bash 命令和后台任务执行" },
	"async.pollWaitDuration": {
		label: "最大轮询时间",
		description:
			"`hub` 等待监视后台任务的时长。固定值每次等待该时长。`smart` 自适应：从 5 秒开始，连续等待时逐渐加长（最长 5 分钟），约一分钟不再等待后重置为 5 秒。",
	},
	"irc.timeoutMs": {
		label: "IRC 超时",
		description: "hub 消息等待（以及 send await:true）的默认超时（毫秒）；0 表示禁用超时",
	},
	"tools.xdev": {
		label: "xd:// 工具",
		description:
			"把不常用（可发现）的工具挂载到 xd:// 设备 URL 下，通过 read/write 驱动，而不是每次请求都携带它们的 schema。禁用则把所有已启用工具顶层暴露。",
	},
	"tools.xdevDocs": {
		label: "xd:// 提示词文档",
		description:
			"选择哪些挂载设备的文档与 schema 内联进系统提示词。Built-ins 保持核心工具内联，MCP 与扩展工具保持按需。",
	},
	"tools.xdevInlineDevices": {
		label: "xd:// 内联设备",
		description:
			"当 xd:// 提示词文档为“仅内置”时，内联名称匹配这些 glob 模式的动态设备（例如 mcp__context_mode_*）。“仅目录”忽略此设置。",
	},
	"mcp.enableProjectConfig": { label: "MCP 项目配置", description: "从项目根加载 .mcp.json/mcp.json" },
	"mcp.renderMarkdownResults": {
		label: "MCP Markdown 结果",
		description: "把非 JSON 的 MCP 文本结果在转录中渲染为 Markdown",
	},
	"mcp.notifications": { label: "MCP 更新注入", description: "把 MCP 资源更新注入 Agent 对话" },
	"mcp.notificationDebounceMs": { label: "MCP 通知防抖", description: "MCP 资源更新注入对话前的防抖窗口（毫秒）" },
	"tasks.todoClearDelay": { label: "待办自动清除延迟", description: "已完成或已放弃的待办从待办部件中移除前的延迟" },
	"dev.autoqa": {
		label: "自动 QA",
		description:
			"自动工具问题上报（xd://report_issue）。默认开启；首次上报会征求同意，拒绝则停止上报，直到显式重新启用",
	},
	"dev.autoqaPush.endpoint": {
		label: "自动 QA 推送端点",
		description: "接收自动 QA JSON 报告的完整 URL（默认 https://qa.omp.sh/v1/grievances）",
	},

	// ── tasks ───────────────────────────────────────────────────────────────
	"plan.enabled": { label: "计划模式", description: "启用计划模式：执行前先进行只读探索与规划" },
	"plan.defaultOnStartup": { label: "以计划模式启动", description: "每个新会话开始时自动进入计划模式" },
	"goal.enabled": { label: "目标模式", description: "启用按会话的目标模式和隐藏的 goal 工具" },
	"goal.statusInFooter": { label: "在底栏显示目标状态", description: "在状态栏的目标指示旁显示 token 预算" },
	"goal.continuationModes": { label: "目标续行模式", description: "活动目标可在轮次之间自动续行的运行模式" },
	"title.refreshOnReplan": {
		label: "重新规划时刷新标题",
		description: "待办初始化导致重新规划后刷新生成的会话标题，除非标题由用户设置",
	},
	"task.isolation.mode": {
		label: "隔离模式",
		description:
			'子代理的隔离后端。"auto" 让原生 PAL 选择最佳可用后端（支持写时复制（CoW）的文件系统，其次 overlayfs/ProjFS，再次 git worktree / 递归复制兜底）。',
	},
	"task.isolation.apply": {
		label: "应用隔离更改",
		description: "自动把成功的隔离任务更改应用到父检出；禁用则保留 patch 或分支产物",
	},
	"task.isolation.merge": { label: "隔离合并策略", description: "隔离任务更改的整合方式（应用 patch 或合并分支）" },
	"task.isolation.commits": { label: "隔离提交风格", description: "嵌套仓库更改的提交消息风格（通用或 AI 生成）" },
	"worktree.base": {
		label: "Worktree 基础目录",
		description:
			"Agent 管理的 worktree 的基础目录——任务隔离副本、`github` PR 检出和 `omp worktree` 清理都位于此处。未设置时使用 ~/.omp/wt。必须是绝对路径或 ~ 相对路径；相对路径会被忽略。OMP_WORKTREE_DIR 环境变量可覆盖此项。",
	},
	"task.eager": { label: "优先任务委派", description: "推动把工作委派给子代理的力度" },
	"task.batch": {
		label: "批量任务调用",
		description:
			"把 task 工具切换为批量形态：一次调用携带 { context, tasks[] }——每项一个子代理，可选按项指定 agent（默认为会话派生策略 agent）、按项隔离，并带有一份前置到每个任务的共享上下文。async.enabled=true 时，每个派生作为独立后台 agent 运行，走正常的 idle/parked 生命周期；否则调用阻塞等待合并结果。禁用则恢复扁平的单次派生 schema。",
	},
	"task.enableEffort": {
		label: "按任务指定强度",
		description: "在任务派生上暴露可选的 effort 参数，允许调用方覆盖每个子代理的思考等级",
	},
	"task.maxConcurrency": { label: "最大并发任务数", description: "并发运行的子代理最大数量" },
	"task.enableLsp": {
		label: "子代理使用 LSP",
		description:
			"允许 task 工具派生的子代理使用 lsp 工具。默认关闭以保持子代理低成本；当 LSP 感知的委派值得额外 token 时启用。",
	},
	"task.maxRecursionDepth": { label: "任务递归深度上限", description: "子代理可以派生自己子代理的层级深度" },
	"task.maxRuntimeMs": {
		label: "子代理运行时长上限",
		description:
			"每个子代理的硬性墙钟时限（毫秒）。0 表示禁用。用于防御逃脱推理层看门狗的提供商侧流式挂起；触发时按“超时”原因正常中止子代理。",
	},
	"task.agentIdleTtlMs": {
		label: "Agent 空闲 TTL",
		description:
			"空闲子代理在内存中保持存活的时长，之后被停泊到磁盘（毫秒）。被停泊的 agent 在收到消息或被恢复时自动唤醒。0 表示空闲 agent 保持存活直到退出。",
	},
	"task.softRequestBudget": {
		label: "子代理软请求预算",
		description:
			"每个子代理的软请求预算（每次运行的助手请求数）。超过时注入一条收尾引导提示（见 task.softRequestBudgetNotice）；达到预算 1.5 倍时强制停止运行，agent 必须交出部分结论。0 表示禁用该守卫。内置 scout/sonic agent 有更低的内置预算上限，因此低于该上限的值对它们仍然生效。",
	},
	"task.softRequestBudgetNotice": {
		label: "软请求预算提示",
		description: "当子代理越过软请求预算时注入一条引导提示，要求它在 1.5 倍强制交出停止前收尾。",
	},
	"task.maxEffort": {
		label: "单次派生强度上限",
		description:
			"task 工具按派生 effort 提示所允许的最大推理强度。较低的值防止调用方把子代理提升到超过此上限；默认值保留模型的完整范围。",
	},
	"task.prewalk": {
		label: "通用任务 Prewalk",
		description:
			"为内置的通用 `task` 子代理启用 prewalk：它以解析出的模型启动，规划并开始实现，然后在首次编辑/写入时交接给 'smol' 角色。按 agent 的覆盖（task.agentPrewalk，在 /agents 中按 P 切换）和用户 agent 的 `prewalk` frontmatter 不受此开关影响。",
	},
	"skills.enableSkillCommands": { label: "技能命令", description: "把技能注册为 /skill:name 命令" },
	"commands.enableClaudeUser": { label: "Claude 用户命令", description: "从 ~/.claude/commands/ 加载命令" },
	"commands.enableClaudeProject": { label: "Claude 项目命令", description: "从 .claude/commands/ 加载命令" },
	"commands.enableOpencodeUser": {
		label: "OpenCode 用户命令",
		description: "从 ~/.config/opencode/commands/ 加载命令",
	},
	"commands.enableOpencodeProject": { label: "OpenCode 项目命令", description: "从 .opencode/commands/ 加载命令" },

	// ── providers ───────────────────────────────────────────────────────────
	"providers.maxInFlightRequests": {
		label: "最大并发请求数",
		description:
			'每个提供商 id 的最大并发 LLM 请求数（例如 "openai" 或 "anthropic"），在使用此配置根目录的本地 OMP 进程间共享。未列出的提供商不受限制。',
	},
	"secrets.enabled": {
		label: "隐藏密钥",
		description: "发送给 AI 提供商前，混淆已配置的密钥并对凭据形态的 token 脱敏",
	},
	"providers.ollama-cloud.maxConcurrency": {
		label: "Ollama Cloud 最大并发",
		description: "每个进程的 Ollama Cloud 子代理并发运行上限；0 表示禁用该提供商专属限制",
	},
	"providers.webSearchOrder": {
		label: "网络搜索提供商顺序",
		description: "web_search 工具的优先提供商排序；未列出的提供商按默认顺序排在其后",
	},
	"providers.webSearchExclude": {
		label: "排除的网络搜索提供商",
		description: "web_search 绝不使用的提供商，即使作为兜底",
	},
	"providers.webSearchGeminiModel": {
		label: "Gemini web_search 模型",
		description: "Gemini Google 搜索接地所用的模型 ID。默认 gemini-2.5-flash。",
	},
	"providers.antigravityEndpoint": {
		label: "Antigravity 端点模式",
		description: "google-antigravity 提供商的端点路由策略（chat、search、image、discovery）",
	},
	"providers.imageOrder": {
		label: "图片生成提供商顺序",
		description: "图片生成的优先提供商排序；未列出的提供商跟随当前会话提供商及内置顺序",
	},
	"providers.fireworksTier": { label: "Fireworks 等级", description: "默认服务路径（不带 service_tier）" },
	"live.voice": { label: "实时语音音色", description: "Codex 支持的实时语音会话所用的音色" },
	"providers.tts": {
		label: "文字转语音提供商",
		description: "tts 工具的后端：本地端侧神经网络 TTS（Kokoro-82M）或 xAI Grok Voice",
	},
	"tts.localModel": { label: "本地 TTS 模型", description: "本地 TTS 后端使用的端侧神经网络 TTS 模型（Kokoro-82M）" },
	"tts.localVoice": { label: "本地 TTS 音色", description: "本地 TTS 后端使用的 Kokoro 音色（美式/英式，女声/男声）" },
	"speech.enabled": { label: "语音朗读", description: "助手输出在流式到达时通过扬声器朗读出来" },
	"speech.mode": {
		label: "语音朗读模式",
		description: "朗读内容：all = 助手消息 + 思考；assistant = 仅消息；yield = 仅回合结束时的最终消息",
	},
	"speech.enhanced": {
		label: "增强语音改写",
		description:
			"合成前用微型/smol 模型把助手输出改写为自然的口语文本（描述代码、去掉链接和 markdown）。失败时回退到机械式清理",
	},
	"speech.voice": { label: "语音朗读音色", description: "朗读助手输出时使用的 Kokoro 音色" },
	"providers.tinyModel": {
		label: "微型模型",
		description: "会话标题模型：默认在线（/models 中的 TINY 角色，否则为 @smol），或本地端侧模型",
	},
	"providers.tinyModelDevice": {
		label: "微型模型设备",
		description:
			"本地微型模型（标题 + 记忆）的 ONNX 执行提供商。默认仅 CPU 推理。PI_TINY_DEVICE 环境变量可覆盖此项。",
	},
	"providers.tinyModelDtype": {
		label: "微型模型精度",
		description:
			"本地微型模型的 ONNX 量化/精度。默认使用各模型自带的 dtype（q4）；更低精度更快，更高精度更保真。PI_TINY_DTYPE 环境变量可覆盖此项。",
	},
	"providers.unexpectedStopModel": {
		label: "意外停止检测模型",
		description: "意外停止检测的分类器：默认在线（/models 中的 TINY 角色，否则为 smol），或本地端侧模型。",
	},
	"providers.kimiApiFormat": {
		label: "Kimi API 格式",
		description: "Kimi Code 提供商的 API 格式（auto 跟随实时模型元数据）",
	},
	"providers.openaiWebsockets": {
		label: "OpenAI WebSockets",
		description: "OpenAI Codex 模型的 websocket 策略（auto 使用模型默认值，on 强制开启，off 禁用）",
	},
	"providers.streamFirstEventTimeoutSeconds": {
		label: "流首个事件超时",
		description: "等待模型流首个事件的秒数；-1 使用提供商/环境变量默认值，0 禁用看门狗",
	},
	"providers.streamIdleTimeoutSeconds": {
		label: "流空闲超时",
		description: "模型流在事件之间允许保持静默的秒数；-1 使用提供商/环境变量默认值，0 禁用看门狗",
	},
	"providers.openrouterVariant": {
		label: "OpenRouter 路由",
		description: "附加到 OpenRouter 模型 ID 的默认路由变体后缀（当选择器已指定变体时被覆盖）",
	},
	"providers.fetch": { label: "抓取提供商", description: "fetch/read URL 工具的阅读器后端优先级" },
	"codexResets.autoRedeem": {
		label: "Codex 自动兑换已存重置",
		description:
			"自动使用保存的 Codex 限流重置：当轮次被卡、且没有其他账户可接管时，恢复因 5 小时或每周窗口耗尽而被锁的账户；并挽救即将过期的额度。unset 会在首次使用前询问，yes 不提示直接使用，no 禁用两类检查。",
	},
	"codexResets.minBlockedMinutes": {
		label: "Codex 自动兑换最小锁定时长",
		description:
			"仅当自然解锁——已耗尽的 5 小时/每周窗口中最晚的那个重置——距今至少此分钟数时才自动兑换（不要为省去短暂等待而花掉稀缺额度）。调大（如 360）可忽略仅 5 小时窗口的锁定。",
	},
	"codexResets.keepCredits": {
		label: "Codex 自动兑换保留量",
		description:
			"保存的重置低于此数量时绝不自动使用（0 = 最后一份额度也可自动使用）。即将过期的额度例外——保留的额度过期等于什么都没保住。",
	},
	"codexResets.salvageHorizonHours": {
		label: "Codex 重置挽救窗口",
		description:
			"当保存的 Codex 重置将在此小时数内过期、且任一聊天窗口（5 小时或每周）有可恢复的有效用量时，自动将其用掉（0 表示禁用过期挽救）。",
	},
	"provider.appendOnlyContext": {
		label: "仅追加上下文",
		description:
			"缓存系统提示词 + 工具规格并保持仅追加的消息日志，使提供商前缀缓存（DeepSeek、Xiaomi/SGLang、Anthropic）以最大比率命中。Auto 对已知支持前缀缓存的提供商启用。",
	},
	"exa.enabled": { label: "Exa", description: "所有 Exa 搜索工具的总开关" },
	"exa.enableSearch": { label: "Exa 搜索", description: "启用 Exa 基础搜索、深度搜索、代码搜索和抓取工具" },
	"exa.searchDelayMs": {
		label: "Exa 搜索延迟",
		description: "Exa 网络搜索请求之间的最小延迟（毫秒）；设为 0 禁用节流",
	},
	"exa.enableResearcher": { label: "Exa 研究员", description: "启用 Exa researcher 工具进行 AI 驱动的深度调研" },
	"exa.enableWebsets": { label: "Exa Websets", description: "启用 Exa webset 管理与增强工具" },
	"searxng.endpoint": { label: "SearXNG 端点", description: "用于网络搜索的自托管 SearXNG 实例基础 URL" },

	// ── advanced（无 ui 元数据，归入 Advanced 选项卡）─────────────────────────
	// 常规
	setupVersion: { label: "设置向导版本", description: "记录最近运行过的设置向导版本，用于按版本只展示新增的引导步骤" },
	"auth.broker.url": {
		label: "认证代理 URL",
		description: "远程 `omp auth-broker serve` 主机地址，凭据经它代理；通常由 OMP_AUTH_BROKER_URL 环境变量设置",
	},
	"auth.broker.token": {
		label: "认证代理令牌",
		description: "访问认证代理的令牌；通常由 OMP_AUTH_BROKER_TOKEN 环境变量设置",
	},
	shellPath: { label: "Shell 路径", description: "自定义 shell 可执行文件路径，覆盖自动探测结果" },
	extensions: { label: "扩展路径", description: "启动时额外加载的扩展路径列表" },
	enabledModels: {
		label: "启用模型白名单",
		description: "限定可用模型的选择器模式列表；为空表示不限制（支持按路径作用域配置）",
	},
	disabledProviders: {
		label: "禁用的提供商",
		description: "禁用的提供商 id 列表——能力发现来源与模型选择器中的提供商通用",
	},
	disabledExtensions: { label: "禁用的扩展", description: "按 id 禁用的扩展列表（在扩展面板中管理）" },
	modelRoles: { label: "模型角色分配", description: "角色（default、smol、slow、advisor 等）到模型选择器的映射" },
	modelTags: { label: "模型标签", description: "自定义模型标签的名称、颜色与可见性配置" },
	modelProviderOrder: { label: "提供商排序", description: "模型选择器中提供商的显示顺序" },
	cycleOrder: { label: "快速切换循环", description: "模型快速切换循环的角色顺序（默认 smol → default → slow）" },
	// 状态栏与内联图片
	"statusLine.leftSegments": { label: "状态栏左侧分段", description: "状态栏左侧按顺序显示的分段 id 列表" },
	"statusLine.rightSegments": { label: "状态栏右侧分段", description: "状态栏右侧按顺序显示的分段 id 列表" },
	"statusLine.segmentOptions": {
		label: "状态栏分段选项",
		description: "按分段 id 覆盖各分段的渲染选项（键为分段 id）",
	},
	"tui.maxInlineImageColumns": {
		label: "内联图片列宽上限",
		description: "内联图片的最大宽度（终端列数，默认 100）。设为 0 表示不限制（仅受终端宽度约束）。",
	},
	"tui.maxInlineImageRows": {
		label: "内联图片行高上限",
		description: "内联图片的最大高度（终端行数，默认 20）。设为 0 表示仅使用基于视口的限制（终端高度的 60%）。",
	},
	"tui.maxInlineImages": {
		label: "内联图片数量上限",
		description:
			"作为实时终端图形保留的内联图片最大数量（默认 8）。超出上限后较旧的图片经完整重绘回退为文本占位符。设为 0 表示保留所有图片（无限制）。",
	},
	// 重试
	"retry.enabled": { label: "启用重试", description: "API 请求失败时自动重试的总开关" },
	"retry.baseDelayMs": { label: "重试基础延迟", description: "重试之间指数退避的基础等待时间（毫秒，默认 500）" },
	// 语音
	"stt.language": { label: "语音识别语言", description: "语音转文字的识别语言代码（默认 en）" },
	// 压缩
	"compaction.reserveTokens": {
		label: "压缩预留 Token",
		description: "压缩后为模型回复预留的 token 数。不设置表示未显式选择——小窗口恢复时可能换用按比例计算的预留。",
	},
	"compaction.keepRecentTokens": {
		label: "压缩保留最近 Token",
		description: "压缩时原样保留的最近消息 token 数（默认 20000）",
	},
	"compaction.autoContinue": { label: "压缩后自动继续", description: "自动压缩完成后自动继续当前轮次" },
	"compaction.remoteEndpoint": { label: "远程压缩端点", description: "远程压缩服务的端点 URL；未设置时使用默认端点" },
	"compaction.v2RetainedMessageBudget": {
		label: "远程压缩 V2 保留预算",
		description: "远程压缩 V2 中原样保留的消息 token 预算（默认 64000）",
	},
	"branchSummary.reserveTokens": {
		label: "分支摘要预留 Token",
		description: "为分支摘要生成预留的上下文 token 数（默认 16384）",
	},
	// 本地记忆管线
	"memories.enabled": {
		label: "本地记忆（旧版开关）",
		description: "旧版本地记忆开关，仅为向后兼容迁移保留——请改用 memory.backend",
	},
	"memories.maxRolloutsPerStartup": {
		label: "每次启动提取上限",
		description: "单次启动最多运行的记忆提取（rollout）批次数（默认 64）",
	},
	"memories.maxRolloutAgeDays": {
		label: "提取会话最大年龄",
		description: "纳入记忆提取的会话最大年龄（天，默认 30）",
	},
	"memories.minRolloutIdleHours": {
		label: "提取会话空闲时长",
		description: "会话至少空闲此小时数后才纳入记忆提取（默认 12）",
	},
	"memories.threadScanLimit": {
		label: "线程扫描上限",
		description: "启动时扫描记忆提取候选的会话线程数上限（默认 300）",
	},
	"memories.maxRawMemoriesForGlobal": {
		label: "全局汇总原始记忆上限",
		description: "触发全局汇总前允许的原始记忆条数上限（默认 200）",
	},
	"memories.stage1Concurrency": { label: "阶段一并发数", description: "阶段一（逐线程提取）的并发任务数（默认 8）" },
	"memories.stage1LeaseSeconds": { label: "阶段一租约时长", description: "阶段一提取任务的租约时长（秒，默认 120）" },
	"memories.stage1RetryDelaySeconds": {
		label: "阶段一重试延迟",
		description: "阶段一失败任务的重试延迟（秒，默认 120）",
	},
	"memories.phase2LeaseSeconds": {
		label: "阶段二租约时长",
		description: "阶段二（全局汇总）任务的租约时长（秒，默认 180）",
	},
	"memories.phase2RetryDelaySeconds": {
		label: "阶段二重试延迟",
		description: "阶段二失败后的重试延迟（秒，默认 180）",
	},
	"memories.phase2HeartbeatSeconds": { label: "阶段二心跳间隔", description: "阶段二运行时的心跳间隔（秒，默认 30）" },
	"memories.rolloutPayloadPercent": {
		label: "提取负载上下文占比",
		description: "单个提取批次输入允许占模型上下文窗口的比例（默认 0.7）",
	},
	"memories.phase1InputTokenLimit": {
		label: "阶段一输入 Token 上限",
		description: "阶段一每个线程输入的 token 上限（默认 4000）",
	},
	"memories.fallbackTokenLimit": {
		label: "回退 Token 上限",
		description: "模型上下文窗口未知时使用的兜底 token 上限（默认 16000）",
	},
	"memories.summaryInjectionTokenLimit": {
		label: "记忆摘要注入上限",
		description: "注入会话的记忆摘要 token 上限（默认 5000）",
	},
	"autolearn.minToolCalls": {
		label: "自动学习最小工具调用数",
		description: "会话中的工具调用达到此数量后才触发自动学习沉淀（默认 5）",
	},
	// Mnemopi
	"mnemopi.retainEveryNTurns": { label: "Mnemopi 留存间隔", description: "每隔多少轮留存一次转录（默认 4）" },
	"mnemopi.recallLimit": { label: "Mnemopi 召回条数上限", description: "每次召回返回的记忆条数上限（默认 8）" },
	"mnemopi.recallContextTurns": {
		label: "Mnemopi 召回上下文轮数",
		description: "构造召回查询时纳入的最近对话轮数（默认 3）",
	},
	"mnemopi.recallMaxQueryChars": {
		label: "Mnemopi 召回查询长度上限",
		description: "召回查询的最大字符数（默认 4000）",
	},
	"mnemopi.injectionTokenLimit": {
		label: "Mnemopi 注入 Token 上限",
		description: "注入提示词的召回记忆 token 上限（默认 5000）",
	},
	"mnemopi.debug": { label: "Mnemopi 调试日志", description: "输出 Mnemopi 记忆后端的调试日志" },
	// Hindsight
	"hindsight.bankIdPrefix": { label: "Hindsight 记忆库 ID 前缀", description: "为自动生成的记忆库 ID 添加此前缀" },
	"hindsight.bankMission": {
		label: "Hindsight 反思使命",
		description: "创建记忆库时写入的反思使命（reflect mission），引导该库的反思方向",
	},
	"hindsight.retainMission": {
		label: "Hindsight 留存使命",
		description: "创建记忆库时写入的留存使命（retain mission），引导从转录中提取哪些记忆",
	},
	"hindsight.retainEveryNTurns": { label: "Hindsight 留存间隔", description: "每隔多少轮留存一次转录（默认 3）" },
	"hindsight.retainOverlapTurns": {
		label: "Hindsight 留存重叠轮数",
		description: "相邻留存块之间重叠的轮数，避免边界处上下文丢失（默认 2）",
	},
	"hindsight.retainContext": {
		label: "Hindsight 留存上下文标签",
		description: "留存文档附带的上下文标签（默认 omp）",
	},
	"hindsight.recallBudget": { label: "Hindsight 召回预算", description: "召回深度档位：low、mid 或 high（默认 mid）" },
	"hindsight.recallMaxTokens": {
		label: "Hindsight 召回 Token 上限",
		description: "注入召回记忆的最大 token 数（默认 1024）",
	},
	"hindsight.recallContextTurns": {
		label: "Hindsight 召回上下文轮数",
		description: "构造召回查询时纳入的最近对话轮数（默认 1）",
	},
	"hindsight.recallMaxQueryChars": {
		label: "Hindsight 召回查询长度上限",
		description: "召回查询的最大字符数（默认 800）",
	},
	"hindsight.recallTypes": {
		label: "Hindsight 召回类型",
		description: "参与召回的记忆类型（默认 world 与 experience）",
	},
	"hindsight.debug": { label: "Hindsight 调试日志", description: "输出 Hindsight 记忆后端的调试日志" },
	"hindsight.requestTimeoutMs": {
		label: "Hindsight 请求超时",
		description: "Hindsight 一般请求的超时（毫秒，默认 30000）",
	},
	"hindsight.reflectTimeoutMs": {
		label: "Hindsight 反思超时",
		description: "Hindsight 反思请求的超时（毫秒，默认 120000）",
	},
	"hindsight.recallTimeoutMs": {
		label: "Hindsight 召回超时",
		description: "Hindsight 召回请求的超时（毫秒，默认 30000）",
	},
	"hindsight.retainTimeoutMs": {
		label: "Hindsight 留存超时",
		description: "Hindsight 留存请求的超时（毫秒，默认 60000）",
	},
	"hindsight.mentalModelRefreshIntervalMs": {
		label: "Hindsight 心智模型刷新间隔",
		description: "重新读取心智模型的间隔（毫秒，默认 5 分钟）",
	},
	"hindsight.mentalModelMaxRenderChars": {
		label: "Hindsight 心智模型渲染上限",
		description: "心智模型渲染进指令时的最大字符数（默认 16000）",
	},
	// Shell 与工具
	"bashInterceptor.patterns": {
		label: "Bash 拦截规则",
		description: "有序的 bash 拦截规则：正则模式命中时提示改用对应的专用工具",
	},
	"shellMinimizer.settingsPath": {
		label: "Shell 压缩设置文件",
		description: "覆盖压缩器字段默认值的可选 TOML 设置文件路径（支持 ~）",
	},
	"shellMinimizer.only": {
		label: "Shell 压缩白名单",
		description: "仅对这些程序名启用输出压缩（如 git）；为空表示启用所有内置过滤器",
	},
	"shellMinimizer.except": { label: "Shell 压缩排除列表", description: "明确不做输出压缩的程序名" },
	"shellMinimizer.maxCaptureBytes": {
		label: "Shell 压缩捕获上限",
		description: "每条命令捕获的最大字节数，超过则回退为原始未压缩输出（默认 4 MiB）",
	},
	"shellMinimizer.legacyFilters": {
		label: "Shell 旧版过滤器",
		description: "回退到 grep/find/pytest 的旧版过滤行为；未设置时由 OMP_MINIMIZER_LEGACY_FILTERS 环境变量决定",
	},
	"inspect_image.enabled": {
		label: "图片理解（旧版开关）",
		description: "旧版布尔开关，仅为迁移到 inspect_image.mode 保留——请改用 inspect_image.mode",
	},
	"async.maxJobs": { label: "后台任务数上限", description: "并发运行的后台任务最大数量（默认 100）" },
	"bash.autoBackground.thresholdMs": {
		label: "自动后台阈值",
		description: "bash 命令运行超过此毫秒数后自动转入后台（默认 60000）",
	},
	"eval.autoBackground.enabled": {
		label: "Eval 自动转后台",
		description: "自动把长时间运行的 eval 单元转入后台，完成后再投递结果。",
	},
	"eval.autoBackground.thresholdMs": {
		label: "Eval 自动后台阈值",
		description: "eval 单元运行超过此毫秒数后自动转入后台（默认 60000）。",
	},
	// 任务
	"task.disabledAgents": {
		label: "禁用的子代理",
		description: "被禁用的子代理名称列表，task 工具不再提供（在 /agents 面板中管理）",
	},
	"task.agentModelOverrides": {
		label: "按子代理的模型覆盖",
		description: "子代理名称到模型选择器的映射，覆盖各 agent 的默认模型（在 /agents 面板中管理）",
	},
	"task.agentPrewalk": {
		label: "按子代理的 Prewalk 覆盖",
		description: "子代理名称到 prewalk 开关状态的映射（在 /agents 面板中按 P 切换）",
	},
	// 技能
	"skills.enabled": { label: "启用技能", description: "技能发现与加载的总开关" },
	"skills.enableCodexUser": { label: "Codex 用户技能", description: "从 ~/.codex/skills 加载技能" },
	"skills.enableClaudeUser": { label: "Claude 用户技能", description: "从 ~/.claude/skills 加载技能" },
	"skills.enableClaudeProject": { label: "Claude 项目技能", description: "从 .claude/skills 加载技能" },
	"skills.enablePiUser": { label: "Pi 用户技能", description: "从 ~/.omp/agent/skills 加载技能" },
	"skills.enablePiProject": { label: "Pi 项目技能", description: "从 .omp/skills 加载技能" },
	"skills.enableAgentsUser": {
		label: "Agents 用户技能",
		description: "从 ~/.agent/skills 与 ~/.agents/skills 加载技能",
	},
	"skills.enableAgentsProject": {
		label: "Agents 项目技能",
		description: "从 .agent/skills 与 .agents/skills 加载技能",
	},
	"skills.customDirectories": { label: "自定义技能目录", description: "额外扫描技能的自定义目录列表" },
	"skills.ignoredSkills": { label: "忽略的技能", description: "按名称 glob 模式忽略的技能列表" },
	"skills.includeSkills": { label: "仅包含的技能", description: "非空时仅加载名称匹配这些 glob 模式的技能" },
	// SearXNG
	"searxng.token": { label: "SearXNG 访问令牌", description: "SearXNG 实例的访问令牌（token 认证）" },
	"searxng.basicUsername": { label: "SearXNG Basic 用户名", description: "SearXNG 实例 HTTP Basic 认证的用户名" },
	"searxng.basicPassword": { label: "SearXNG Basic 密码", description: "SearXNG 实例 HTTP Basic 认证的密码" },
	"searxng.categories": { label: "SearXNG 分类", description: "限定搜索的分类（逗号分隔，如 general,news）" },
	"searxng.engines": { label: "SearXNG 引擎", description: "限定使用的搜索引擎（逗号分隔）" },
	"searxng.language": { label: "SearXNG 语言", description: "搜索结果的偏好语言代码" },
	// 提交
	"commit.mapReduceEnabled": {
		label: "提交分析 Map-Reduce",
		description: "大 diff 的提交信息生成改用逐文件并行分析再汇总的 map-reduce 流程",
	},
	"commit.mapReduceMinFiles": {
		label: "Map-Reduce 最小文件数",
		description: "变更文件数达到此值才启用 map-reduce 分析（默认 4）",
	},
	"commit.mapReduceMaxFileTokens": {
		label: "Map-Reduce 单文件 Token 上限",
		description: "单文件 diff 超过此 token 数时启用 map-reduce 分析（默认 50000）",
	},
	"commit.mapReduceTimeoutMs": { label: "Map-Reduce 超时", description: "map-reduce 分析的超时（毫秒，默认 120000）" },
	"commit.mapReduceMaxConcurrency": {
		label: "Map-Reduce 最大并发",
		description: "map-reduce 逐文件分析的并发上限（默认 5）",
	},
	"commit.changelogMaxDiffChars": {
		label: "更新日志 Diff 字符上限",
		description: "生成更新日志时提供给模型的 diff 最大字符数（默认 120000）",
	},
	// 开发者
	"dev.autoqaPush.token": { label: "自动 QA 推送令牌", description: "推送自动 QA 报告时使用的认证令牌" },
	"dev.autoqaConsent": {
		label: "自动 QA 同意状态",
		description:
			"是否同意分享自动工具问题报告：unset = 首次上报时询问；granted = 记录并（配置推送时）发送；denied = 静默忽略",
	},
	// 存储 GC
	"gc.blobs": { label: "GC 清理 Blob", description: "`omp gc` 时清理不再被引用的会话 blob" },
	"gc.archive": { label: "GC 归档冷会话", description: "`omp gc` 时将长期未活动的会话移入归档" },
	"gc.wal": { label: "GC 处理 WAL", description: "`omp gc` 时处理会话存储的预写日志（WAL）" },
	"gc.coldArchiveAfterDays": { label: "冷归档天数", description: "未活动超过此天数的会话才会被归档（默认 30）" },
	"gc.retainNewestGlobal": {
		label: "全局保留最新会话数",
		description: "无论多旧都保留的最新未活动会话数量（全局，默认 20）",
	},
	"gc.retainNewestPerCwd": {
		label: "每目录保留最新会话数",
		description: "每个工作目录无论多旧都保留的最新未活动会话数量（默认 10）",
	},
	// 思考预算
	"thinkingBudgets.minimal": {
		label: "思考预算（minimal）",
		description: "minimal 思考等级的推理 token 预算（默认 1024）",
	},
	"thinkingBudgets.low": { label: "思考预算（low）", description: "low 思考等级的推理 token 预算（默认 2048）" },
	"thinkingBudgets.medium": {
		label: "思考预算（medium）",
		description: "medium 思考等级的推理 token 预算（默认 8192）",
	},
	"thinkingBudgets.high": { label: "思考预算（high）", description: "high 思考等级的推理 token 预算（默认 16384）" },
	"thinkingBudgets.xhigh": {
		label: "思考预算（xhigh）",
		description: "xhigh 思考等级的推理 token 预算（默认 32768）",
	},
	"thinkingBudgets.max": { label: "思考预算（max）", description: "max 思考等级的推理 token 预算（默认 32768）" },
	"display.hideToolActivity": {
		label: "隐藏工具活动",
		description: "在转录中隐藏模型发起的工具调用及其结果",
	},
	externalThinking: {
		label: "外部思考",
		description: "使用私有 think 工具，并将推理工作交给 GPT Responses 模型",
	},
	"lsp.shared": {
		label: "共享语言服务器",
		description: "通过守护进程代理，让同一项目的 omp 实例共享语言服务器；不可用时回退到私有服务器",
	},
	"browser.relay": {
		label: "浏览器中继",
		description:
			"通过 omp 浏览器中继控制自己的 Chrome 标签页。只需安装一次扩展（`omp browser-relay install`）；浏览器工具需要时会自动启动中继服务器。它优先于浏览器 CDP URL；可设置 PI_BROWSER_RELAY=0 或 PI_BROWSER_RELAY=1 覆盖。",
	},
	"browser.relayUrl": {
		label: "浏览器中继 URL",
		description: "omp 浏览器中继端点（默认 http://127.0.0.1:9224）",
	},
	"providers.webSearchTimeoutSeconds": {
		label: "网络搜索超时",
		description: "每个提供商的搜索传输硬超时；超时后 web_search 会尝试下一个回退项，单位为秒（最大 300）",
	},
	"searxng.safesearch": { label: "SearXNG 安全搜索" },
};
