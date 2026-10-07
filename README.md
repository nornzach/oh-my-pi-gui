<div align="center">

# omp GUI

**A desktop home for parallel coding agents.**<br>
**让对话、代码与并行 Agent 工作尽在眼前。**

<a href="https://github.com/nornzach/oh-my-pi-gui/releases"><img src="https://img.shields.io/github/v/release/nornzach/oh-my-pi-gui?style=flat&colorA=222222&colorB=3FB950" alt="Release"></a>
<a href="https://github.com/nornzach/oh-my-pi-gui/releases"><img src="https://img.shields.io/github/downloads/nornzach/oh-my-pi-gui/total?style=flat&colorA=222222&colorB=58A6FF" alt="Downloads"></a>
<a href="./LICENSE"><img src="https://img.shields.io/github/license/nornzach/oh-my-pi-gui?style=flat&colorA=222222&colorB=BE185D" alt="License"></a>
<img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-222222?style=flat" alt="Platform: macOS | Windows | Linux">
<img src="https://img.shields.io/badge/Electron-35-47848F?style=flat&logo=electron&logoColor=white" alt="Electron">
<img src="https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=white" alt="React">

[English](#english) · [中文](#中文) · [Releases / 下载](https://github.com/nornzach/oh-my-pi-gui/releases)

</div>

---

## English

Keep the conversation, code changes, and agent activity in one place. Review a diff while another session works in its own Git worktree, compare two sessions in a split view, or open a tool-free Chat to think through an idea.

Built on [omp](https://github.com/can1357/oh-my-pi), this Electron desktop app bundles its own agent: **users of the DMG, NSIS, and portable packages do not need to install omp, Bun, or Node separately.** It complements the TUI and shares the usual `~/.omp` configuration and sessions.

[Features](#en-features) · [What's new in 0.9.17](#en-recent) · [Gallery](#en-gallery) · [Install](#en-install) · [Shortcuts](#en-shortcuts) · [Development](#en-development) · [Help](#en-help) · [Releasing](#en-release)
> **v0.9.17 release.** The improvements below are included in v0.9.17, with the bundled agent rebuilt from upstream through v18.8.0 (monorepo `97990a6c`). The gallery screenshots may show earlier GUI surfaces; [GitHub Releases](https://github.com/nornzach/oh-my-pi-gui/releases) is authoritative for available downloads and release contents.

<img src="docs/screenshots/en/01-conversation.png" alt="English omp GUI conversation in the synthetic aurora-web project" width="100%">

**About the screenshots:** these are real Electron GUI renders of a synthetic `aurora-web` project. Conversations, model lists, agent states, and metrics are scripted demonstration data—not actual provider benchmarks or account data. Captures use a fresh temporary HOME, Electron profile, and project with a synthetic sidecar, without live credentials or personal workspace content.

<a id="en-features"></a>
### A workspace for the whole workflow

The distinctive part is not just a chat window: it is being able to **separate parallel work, inspect what happened, and choose how the next step runs** without losing the thread.

| Area | What you can do | Scope and useful limits |
|---|---|---|
| **Independent sessions** | Run up to **10 tabs**, each with its own sidecar, session, and message queue; keep background work running and create fresh Git worktree tabs. | Separate session runtimes are not an OS security boundary. Git must be available for worktrees. |
| **Split views & windows** | Place two sessions side by side or stacked, resize the divider, and use multiple windows. Restore the open/active tab layout across restarts. | A split contains **two panes**, not an unlimited pane grid. |
| **Chat vs. Agent** | Use global, tool-free **Chat** for conversation and workspace **Agent** sessions for coding tasks. | Chat history stays separate from project groups and workspace operations. |
| **Readable execution** | Inspect diffs and Bash, read, grep, and task calls in dedicated renderers; follow streaming Markdown, highlighted code, collapsible thinking, math, Mermaid, and images. | Tool output remains inspectable alongside the conversation rather than being flattened into plain chat text. |
| **Background coordination** | Follow `wait` jobs, inspect `proc://` task and service state, and review `agent://` messages and process controls in compact structured cards. | Coordination details stay bounded and expandable; legacy `hub` transcripts remain readable. |
| **Plans, Todos & queues** | Review plans and approvals, queue follow-up messages, and monitor bounded Todos/Agents dock cards. Expand a card for a focused full list. | Compact summaries keep large task lists from taking over the conversation. |
| **Agent Hub** | Manage agent definitions, enable/disable agents, set model and prewalk overrides, inspect progress/logs, abort work, and wake parked agents. | Available actions follow the agent's current state; role assignments and per-agent overrides serve different purposes. |
| **Models & roles** | Pick models by provider, assign models to roles, and adjust reasoning/thinking levels. | Reasoning controls appear only for models that support them. |
| **Providers** | Sign in, add/edit/remove custom providers, and discover models from compatible OpenAI or Anthropic endpoints. | OAuth or API-key support depends on the provider; endpoint compatibility and advertised models vary. |
| **Session library** | Search history, explore session trees, branches and forks, organize labels, copy-import Claude/Codex sessions, export HTML, and preview sharing. | Copy import is not live synchronization with another app. Review content before exporting or sharing. |
| **Context & live accounting** | Inspect context usage and live cost/cache updates; retain measured context usage even when model capacity is unknown. | Measured usage and a model's maximum capacity are different facts. |
| **Statistics & usage** | Open a private local statistics dashboard and session metrics for requests, tokens, cost, cache, and speed; inspect provider usage/quotas. | Provider quotas depend on API/account availability. Local statistics are not a provider billing statement. |
| **MCP** | Manage servers, test connections, reconnect, and complete supported authentication flows. | External MCP executables/services still need installation and configuration. |
| **Skills & plugins** | Enable skills, edit managed skills, and manage plugins and marketplaces. | Managed-skill editing does not imply every discovered resource is editable. |
| **Hooks & resources** | Configure hooks and inspect templates, memory, and other discovered resources from settings. | Some hook changes take effect next session; templates and memory are mostly inspection surfaces. |
| **SSH hosts** | Configure hosts through the native SSH settings page. | `/ssh list`, `/ssh add`, and `/ssh remove` management commands remain disabled; OpenSSH and host access must be configured separately. |
| **Commands & voice** | Use a searchable palette for supported dialogs, menus, toggles, and argument prompts; access the voice command. | Some slash commands pass through to the agent or are unsupported. Voice depends on runtime, permissions, and service support—not a promise of offline or all-OS availability. |
| **Relay collaboration** | Host or join a shared session with edit or read-only access. | Requires a configured relay service; it is not a purely local collaboration mode. |
| **Settings & control** | Configure GUI/runtime/tool behavior, switch English/Chinese, choose themes, and access approvals and security scans/settings. | Approvals and scans are **not an OS sandbox**; command coverage is not total CLI parity. |

Model requests still go to the providers you configure. The bundled agent removes the separate runtime install, not the need to configure credentials, project dependencies, external Git/OpenSSH/MCP tools, or optional services. Only connect tools and services you trust.

<a id="en-recent"></a>
### What's new in 0.9.17

v0.9.17 syncs the bundled agent to upstream v18.8.0, streams `/btw` side questions, and makes the interface calmer:

| In daily use | What has improved |
|---|---|
| **Bundled agent** | Rebuilt from upstream through v18.8.0 (monorepo `97990a6c`): shared `/btw` history and streaming, per-credential logout, and in-memory native-addon embedding. |
| **`/btw` side questions** | Answers stream as they are written, follow-ups stay in the same side conversation, **Stop answer** while it runs, and **Branch into conversation** inserts exactly the answer you saw. |
| **Context strategy row** | One line under the composer shows the model, its window, the compaction strategy, and the method that will really run — click to switch strategy and tune thresholds. |
| **Calmer, steadier UI** | Turns and panels appear in place instead of sliding in; streaming replies render formatted as they arrive; the sidebar keeps the daily tools in view and folds the rest under **More**. |
| **Long sessions** | The session tree no longer crashes (`Maximum call stack size exceeded`) on sessions with tens of thousands of entries. |
<a id="en-gallery"></a>
### Explore the interface

Open a group for a closer look. All images in this section use the English interface and the synthetic showcase data described above.

<details>
<summary><b>Work across projects — workspace inspection and two-pane split</b></summary>

Keep files, diffs, and logs within reach, then place a second session beside the first without merging their runtimes.

| Workspace | Split view |
|---|---|
| ![English workspace panel](docs/screenshots/en/02-workspace.png) | ![English two-pane split view](docs/screenshots/en/11-split.png) |

</details>

<details>
<summary><b>Choose your connection — models and providers</b></summary>

Browse the model picker and provider controls. The displayed model roster and account states are fixtures, not a live catalog or connected account.

| Models | Providers |
|---|---|
| ![English model picker](docs/screenshots/en/03-models.png) | ![English provider management](docs/screenshots/en/04-providers.png) |

</details>

<details>
<summary><b>Delegate deliberately — model roles and Agent Hub</b></summary>

Assign models by role, then inspect agent definitions and task activity without losing the main conversation.

| Model roles | Agent Hub |
|---|---|
| ![English model role assignments](docs/screenshots/en/05-model-roles.png) | ![English Agent Hub with scripted agent states](docs/screenshots/en/06-agent-hub.png) |

</details>

<details>
<summary><b>See the numbers — local statistics and provider usage</b></summary>

Separate session analytics from provider-reported usage. The values below are scripted examples, not measured model performance, real spending, or account quotas.

| Local statistics | Usage |
|---|---|
| ![English local statistics with synthetic metrics](docs/screenshots/en/07-statistics.png) | ![English usage view with synthetic values](docs/screenshots/en/12-usage.png) |

</details>

<details>
<summary><b>Understand and tune — context and settings</b></summary>

Inspect what a session is carrying, then configure the runtime and GUI from the settings window.

| Context | Settings |
|---|---|
| ![English context inspection](docs/screenshots/en/08-context.png) | ![English settings window](docs/screenshots/en/10-settings.png) |

</details>

<details>
<summary><b>Find the next action — command palette</b></summary>

Search with `⌘K`. Supported commands lead to native controls; pass-through and unavailable commands should not be mistaken for complete GUI coverage of the CLI.

![English command palette](docs/screenshots/en/09-commands.png)

</details>

<a id="en-install"></a>
### Install & start

**Documented install baseline: [v0.9.17](https://github.com/nornzach/oh-my-pi-gui/releases/tag/v0.9.17).** Check [Releases](https://github.com/nornzach/oh-my-pi-gui/releases) for authoritative current downloads and release notes.

| Mac | v0.9.17 download |
|---|---|
| Apple Silicon | [omp-0.9.17-arm64.dmg](https://github.com/nornzach/oh-my-pi-gui/releases/download/v0.9.17/omp-0.9.17-arm64.dmg) |
| Intel | [omp-0.9.17.dmg](https://github.com/nornzach/oh-my-pi-gui/releases/download/v0.9.17/omp-0.9.17.dmg) |

| Windows x64 | v0.9.17 download |
|---|---|
| Installer | [omp-0.9.17-setup.exe](https://github.com/nornzach/oh-my-pi-gui/releases/download/v0.9.17/omp-0.9.17-setup.exe) |
| Portable | [omp-0.9.17-portable.exe](https://github.com/nornzach/oh-my-pi-gui/releases/download/v0.9.17/omp-0.9.17-portable.exe) |

| Linux x64 | v0.9.17 download |
|---|---|
| AppImage | [omp-0.9.17.AppImage](https://github.com/nornzach/oh-my-pi-gui/releases/download/v0.9.17/omp-0.9.17.AppImage) |
| Debian/Ubuntu | [omp_0.9.17_amd64.deb](https://github.com/nornzach/oh-my-pi-gui/releases/download/v0.9.17/omp_0.9.17_amd64.deb) |

Open the DMG and drag **omp** into **Applications**. The app and bundled macOS sidecar are ad-hoc signed but not notarized. If macOS blocks the first launch, use **right-click → Open**, or **System Settings → Privacy & Security → Open Anyway**, after confirming the download's source.

Windows packages are currently unsigned. Windows SmartScreen may require **More info → Run anyway** on first launch after confirming the download's source.

1. **Connect a provider:** open **Providers & login** from the sidebar and use the authentication method it supports.
2. **Choose your work:** open a project Agent tab with `⌘T`, or a tool-free Chat with `⇧⌘T`; select an available model.
3. **Start a conversation:** enter a request. Use `⌘N` when you want a new session, and inspect tool calls and approvals as work proceeds.
4. **Go parallel:** `⌥T` creates a fresh worktree tab. Use the tab context menu or drag a tab into the workspace for a two-pane split.
5. **Find and revisit:** `⌘K` opens commands; `⌘P` searches session history.

<a id="en-shortcuts"></a>
### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘T` | New Agent tab |
| `⇧⌘T` | New tool-free Chat tab |
| `⌥T` | Fresh Git worktree tab |
| `⌘N` | New session |
| `⌘K` | Command palette |
| `⌘P` | Session history search |
| `⌘,` | Settings |
| `⌘B` / `⌘J` | Toggle sidebars |
| `Esc` | Context-dependent close or abort; not an unconditional abort shortcut |

<a id="en-development"></a>
### Development

<details>
<summary><b>Build, test, and reproduce the showcase</b> — DMG users do not need these steps</summary>

#### Repository boundaries

This is a **separate repository nested inside a monorepo**, not an ordinary monorepo package:

```text
omp-monorepo/                    # nornzach/oh-my-pi: fork and sidecar build source
├── .git/
├── packages/coding-agent/
├── packages/natives/
└── packages/gui/                # nornzach/oh-my-pi-gui: this product repository
    ├── .git/
    ├── src/
    └── resources/omp*           # ignored, locally built sidecars
```

| Repository | Responsibility |
|---|---|
| [`nornzach/oh-my-pi-gui`](https://github.com/nornzach/oh-my-pi-gui) | GUI code, commits, tags, and releases. GUI work goes to this repository's `origin/main`. |
| [`nornzach/oh-my-pi`](https://github.com/nornzach/oh-my-pi) | Enclosing monorepo fork: agent source, upstream sync, and sidecar builds. Agent changes are committed here and pushed to its `origin`. |
| [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi) | Upstream feature source, fetched through the monorepo's `upstream` remote. **Never push here.** |

Never stage `packages/gui/` into the monorepo: its untracked status there is intentional. Git commands inside `packages/gui/` act on the GUI repository; run monorepo Git commands at the monorepo root. Read [AGENTS.md](./AGENTS.md) before making changes.

#### Build from source

**Prerequisites:** Git and [Bun](https://bun.sh) **≥ 1.4**. macOS is required for the macOS sidecar and DMG commands; Windows x64 and Linux x64 (AppImage/deb) can be cross-built — Linux packages build natively on Ubuntu via `bun run package:linux` (or CI: `.github/workflows/release-linux.yml`); Windows x64 packages build natively via `bun run package:win` (or CI: `.github/workflows/release-windows.yml`).

```bash
# Clone the monorepo fork, then nest the GUI repository inside it.
git clone https://github.com/nornzach/oh-my-pi.git omp-monorepo
cd omp-monorepo
git remote add upstream https://github.com/can1357/oh-my-pi.git
bun install
git clone https://github.com/nornzach/oh-my-pi-gui.git packages/gui
cd packages/gui
bun install
```

Run the following from `packages/gui/`:

```bash
bun run build                                  # main + preload + renderer -> out/
bun run build:omp                              # arm64 host -> resources/omp
bun run build:omp:x64                          # Intel -> resources/omp.x64
bun run package:mac:arm64 -- --publish never    # dist/omp-<version>-arm64.dmg
bun run package:mac:x64 -- --publish never      # dist/omp-<version>.dmg
bun run build:omp:win                           # Windows x64 -> resources/omp.exe
bun run package:win -- --publish never           # Windows NSIS + portable installers
# On a Linux host only:
bun run build:omp                                # linux-x64 host -> resources/omp
bun run package:linux -- --publish never         # AppImage + deb + latest-linux.yml
```

`build:omp` compiles the neighboring monorepo agent source and embeds the native addon. It stages the matching `pi_natives` version, downloads the published package when needed, replaces stale addons, and restores temporary staging afterwards. Sidecars at `resources/omp*` are ignored build artifacts: **never commit them**.

Packaging rebuilds the Electron app, **not the agent sidecar**. Re-run the matching `build:omp*` after agent/RPC changes or upstream updates. The arm64 config uses `resources/omp`; the Intel config uses `resources/omp.x64`. Always use `package:mac:x64` for Intel—using the default config can package the wrong architecture.

The Windows configuration targets x64 and bundles `resources/omp.exe`. It produces an NSIS installer and a portable executable. Windows packages are currently unsigned; production distribution should add a Windows code-signing certificate before treating SmartScreen warnings as resolved.

**A standalone GUI clone cannot compile the sidecar.** It must occupy `packages/gui/` in the layout above. For artifact assembly without monorepo sources, supply trusted, compatible prebuilt sidecars at `resources/omp` and/or `resources/omp.x64`, then run `build` and the matching packaging command. A packaged app uses its bundled agent; installing a system `omp` is not a fallback for a missing sidecar.

#### Daily development

```bash
bun run dev                         # HMR, using resources/omp
OMP_SIDECAR=source bun run dev       # explicit dev override: monorepo agent source
bunx vitest run                     # GUI tests
bun run check:types                 # GUI type checks
bun run build                      # production GUI build and main-bundle check
```

Run Biome on touched supported files as well. Changes to agent/RPC code belong in the monorepo and require rebuilding the bundled sidecar before validating a packaged GUI.

#### Reproduce the screenshots

From the GUI repository, after installing its dependencies:

```bash
bun run build
bun scripts/capture-showcase.ts
```

The capture script renders the actual Electron GUI using a fresh temporary HOME, Electron profile, synthetic `aurora-web` project, and synthetic sidecar—**no live credentials or personal workspace are used**. It writes localized showcase images to `docs/screenshots/en/` and `docs/screenshots/zh/`. Scripted conversations, model lists, agent states, and metrics make the scenes reproducible; they are not provider tests or real usage records. This fixture setup is not an OS sandbox.

</details>

<a id="en-help"></a>
### Troubleshooting

| Symptom | What to check |
|---|---|
| macOS blocks the first launch | Confirm the download came from the release page, then right-click → Open or use Privacy & Security → Open Anyway. The app and bundled sidecar are ad-hoc signed, not notarized. |
| Windows SmartScreen blocks the first launch | Confirm the download came from the release page, then choose More info → Run anyway. The Windows package is currently unsigned. |
| A screenshot shows something absent from the installed app | The showcase accompanies v0.9.17, but screenshots may show earlier GUI surfaces. Check the installed version and its release notes; earlier releases may not include these improvements. |
| `Built-in omp not found` | In a source checkout, build the sidecar or supply a compatible prebuilt one. In an installed app, reinstall the correct official DMG; a separate system `omp` will not fix a missing bundle resource. |
| `build:omp` cannot find the monorepo | Put the GUI checkout at the monorepo's `packages/gui/`, alongside `packages/coding-agent/` and `packages/natives/`. |
| `replacing stale addon … version sentinel ≠ …` | Informational: the builder detected and replaced a mismatched native addon. |
| Native addon download fails | Check registry access and whether that version is published. If necessary, from the monorepo root run `bun --cwd=packages/natives run build` with the required Rust toolchain, then rebuild the sidecar. |
| Intel sidecar exits immediately | Check the sidecar architecture and package with `bun run package:mac:x64`, not the default config. |
| A command or integration is unavailable | Some slash commands pass through or are unsupported. Configure external services/tools separately; use SSH settings rather than the disabled `/ssh` management commands. |

<a id="en-release"></a>
### Release process (maintainers)

<details>
<summary><b>Canonical procedure: the Release Runbook in AGENTS.md</b></summary>

The standard, step-by-step release procedure is the [Release Runbook](AGENTS.md#release-runbook) in `AGENTS.md`. Every release follows it exactly — checkout preconditions, upstream sync, version/CHANGELOG/README prep and verification, commit + `vX.Y.Z` tag + push, all three sidecar builds with smoke tests, installer builds with per-artifact inspection, then the GitHub Release carrying both DMGs, both ZIPs, the Windows NSIS and portable installers, and update metadata.

Releases belong only to [`nornzach/oh-my-pi-gui`](https://github.com/nornzach/oh-my-pi-gui/releases). Never commit sidecar binaries; never push to `upstream`.

</details>

---

## 中文

把对话、代码变更与 Agent 执行状态放在同一视野中。一边审查 diff，一边让另一段会话在独立 Git worktree 中推进任务；需要对照时打开双会话分屏，只想讨论思路时则切换到无工具 Chat。

这是基于 [omp](https://github.com/can1357/oh-my-pi) 的 Electron 桌面应用，内置 Agent 二进制：**通过 DMG、NSIS 或便携版安装的用户无需另装 omp、Bun 或 Node。** GUI 与 TUI 互补，共享常规的 `~/.omp` 配置与会话。

[功能全览](#zh-features) · [0.9.17 更新内容](#zh-recent) · [界面导览](#zh-gallery) · [安装](#zh-install) · [快捷键](#zh-shortcuts) · [开发](#zh-development) · [常见问题](#zh-help) · [发布](#zh-release)

> **v0.9.17 功能展示。** 下文改进均纳入 v0.9.17，内置 Agent 基于上游重建至 v18.8.0（monorepo `97990a6c`）。截图可能展示较早的 GUI 界面；可用下载及实际发布内容以 [GitHub Releases](https://github.com/nornzach/oh-my-pi-gui/releases) 为准。

<img src="docs/screenshots/zh/01-conversation.png" alt="中文 omp GUI 中的合成 aurora-web 项目对话" width="100%">

**截图说明：**所有截图均为真实 Electron GUI 渲染，展示合成的 `aurora-web` 项目。对话、模型列表、Agent 状态与统计数值均由脚本构造，**不是实际 Provider 基准测试或账号数据**。截图使用全新的临时 HOME、Electron 配置目录、项目及合成 sidecar，不使用真实凭据或个人工作区内容。

<a id="zh-features"></a>
### 覆盖完整工作流，而不只是聊天

这里的重点是：**让并行任务各有空间，让执行过程可以检查，让下一步如何运行由你掌握**，同时不打断当前思路。

| 领域 | 可以怎样使用 | 范围与边界 |
|---|---|---|
| **独立会话** | 最多运行 **10 个标签页**，各自拥有 sidecar、会话和消息队列；后台任务可继续运行，也可新建 Git worktree 标签页。 | 独立会话运行时不是操作系统安全边界；worktree 需要可用的 Git。 |
| **分屏与多窗口** | 两段会话可左右或上下排列，分隔条可调整，也可使用多个窗口；重启后恢复已打开及选中的标签布局。 | 每个分屏为**双面板**，不是无限面板网格。 |
| **Chat 与 Agent** | 全局、无工具的 **Chat** 用于交流；项目工作区中的 **Agent** 会话用于编码任务。 | Chat 历史与项目分组、工作区操作保持分离。 |
| **可读的执行过程** | 专用视图呈现 diff、Bash、read、grep、task；支持流式 Markdown、代码高亮、可折叠思考块、公式、Mermaid 与图片。 | 工具输出可在对话旁直接检查，而不是全部压成普通聊天文本。 |
| **后台协作状态** | `wait` 任务、`proc://` 进程与服务状态、`agent://` 消息及进程控制操作均以紧凑结构化卡片呈现。 | 详情保持有边界并可展开；历史 `hub` 记录仍可正常阅读。 |
| **计划、待办与队列** | 审查计划与审批、排队发送后续消息，通过有高度约束的 Todos/Agents Dock 卡片查看状态；展开单张卡片查看完整列表。 | 大量任务以紧凑摘要呈现，不占满对话区域。 |
| **Agent Hub** | 管理 Agent 定义、启用/停用、覆盖模型与 prewalk 设置，查看进度和日志、中止任务、唤醒已停驻的 Agent。 | 可用操作取决于 Agent 当前状态；角色模型分配与单个 Agent 覆盖是不同层次的控制。 |
| **模型与角色** | 按 Provider 选择模型，为不同角色分配模型，调整推理/思考等级。 | 只有支持的模型才提供推理等级控制。 |
| **Provider 管理** | 登录，新增/编辑/删除自定义 Provider，从兼容 OpenAI 或 Anthropic 的端点发现模型。 | OAuth 或 API key 支持取决于 Provider；端点兼容程度与返回的模型列表可能不同。 |
| **会话资料库** | 搜索历史、查看会话树、分支与分叉、管理标签，复制导入 Claude/Codex 会话、导出 HTML、预览分享内容。 | 复制导入不是与其他应用实时同步；导出或分享前请检查内容。 |
| **上下文与实时计量** | 检查上下文用量和实时花费/缓存变化；即使模型容量未知，仍可查看已测得的上下文用量。 | 已测用量与模型最大容量是两件事，不应混为一谈。 |
| **统计与用量** | 内置私有、本地运行的统计仪表盘，查看请求、token、花费、缓存、速度及会话指标，也可查看 Provider 用量/配额。 | 配额信息取决于 API 与账号可用性；本地统计不等于 Provider 账单。 |
| **MCP** | 管理服务、测试连接、重连，并完成受支持的认证流程。 | 外部 MCP 可执行程序或服务仍需自行安装和配置。 |
| **Skills 与插件** | 启用技能、编辑受管理的技能，管理插件与市场。 | 支持编辑受管理技能，不代表所有发现的资源都能编辑。 |
| **Hooks 与资源** | 在设置中配置 hooks，查看模板、记忆及其他已发现资源。 | 部分 hook 改动到下一段会话才生效；模板与记忆主要提供检查视图。 |
| **SSH 主机** | 通过原生 SSH 设置页面配置主机。 | `/ssh list`、`/ssh add`、`/ssh remove` 管理命令仍停用；OpenSSH 与主机访问需另行配置。 |
| **命令与语音** | 可搜索命令面板提供受支持的对话框、菜单、开关与参数输入，也提供语音命令入口。 | 部分 slash 命令转交 Agent 或尚不支持；语音取决于运行环境、权限和服务，不承诺离线或所有系统可用。 |
| **Relay 协作** | 主持或加入共享会话，使用可编辑或只读权限。 | 需要已配置的 relay 服务，并非纯本地协作模式。 |
| **设置与控制** | 配置 GUI、运行时和工具行为，切换中英文与主题，使用审批及安全扫描/设置入口。 | 审批与扫描**不是操作系统沙箱**；GUI 命令覆盖不等于完整 CLI 功能对齐。 |

模型请求仍会发送到你配置的 Provider。内置 Agent 省去了单独安装运行时的步骤，但不替你配置凭据、项目依赖、外部 Git/OpenSSH/MCP 工具或可选服务。请只连接你信任的工具与服务。

<a id="zh-recent"></a>
### 0.9.17 更新内容

v0.9.17 将内置 Agent 同步至上游 v18.8.0，`/btw` 旁问改为流式输出，界面也更沉稳：

| 日常场景 | 改进内容 |
|---|---|
| **内置 Agent** | 基于上游重建至 v18.8.0（monorepo `97990a6c`）：共享的 `/btw` 历史与流式输出、按凭据登出、原生插件改为编译时内存嵌入。 |
| **`/btw` 旁问** | 回答边生成边显示，追问留在同一个旁问会话里；运行中可点 **停止回答**；**并入为对话分支** 插入的正是你看到的那份回答。 |
| **上下文策略行** | 输入框下方一行显示模型、上下文窗口、压缩策略以及实际会执行的方式——点击即可切换策略、调整阈值。 |
| **更沉稳的界面** | 消息与面板原地出现，不再滑入；流式回复边到边排版；侧栏常用入口始终可见，其余收进 **更多**。 |
| **长会话** | 会话树在数万条记录的会话上不再崩溃（`Maximum call stack size exceeded`）。 |

<a id="zh-gallery"></a>
### 界面导览

展开感兴趣的分组即可查看。本节图片全部使用中文界面，以及上文说明的合成展示数据。

<details>
<summary><b>跨项目推进 — 工作区检查与双面板分屏</b></summary>

文件、diff 与日志随手可查；把另一段会话放在旁边，也不会合并两者的运行时。

| 工作区 | 分屏 |
|---|---|
| ![中文工作区面板](docs/screenshots/zh/02-workspace.png) | ![中文双面板分屏](docs/screenshots/zh/11-split.png) |

</details>

<details>
<summary><b>选择连接方式 — 模型与 Provider</b></summary>

浏览模型选择器与 Provider 控制。画面中的模型列表和账号状态均为预设数据，不是实时目录或已连接的真实账号。

| 模型 | Provider |
|---|---|
| ![中文模型选择器](docs/screenshots/zh/03-models.png) | ![中文 Provider 管理](docs/screenshots/zh/04-providers.png) |

</details>

<details>
<summary><b>明确分工 — 模型角色与 Agent Hub</b></summary>

按角色分配模型，再查看 Agent 定义与任务状态，无需离开主对话的工作脉络。

| 模型角色 | Agent Hub |
|---|---|
| ![中文模型角色分配](docs/screenshots/zh/05-model-roles.png) | ![中文 Agent Hub 与脚本构造的 Agent 状态](docs/screenshots/zh/06-agent-hub.png) |

</details>

<details>
<summary><b>看清数值 — 本地统计与 Provider 用量</b></summary>

区分会话分析和 Provider 报告的用量。以下数值为脚本示例，不是实测模型性能、真实消费或账号配额。

| 本地统计 | 用量 |
|---|---|
| ![中文本地统计与合成指标](docs/screenshots/zh/07-statistics.png) | ![中文用量视图与合成数值](docs/screenshots/zh/12-usage.png) |

</details>

<details>
<summary><b>理解并调整 — 上下文与设置</b></summary>

检查当前会话携带的上下文，再通过设置窗口调整运行时与 GUI。

| 上下文 | 设置 |
|---|---|
| ![中文上下文检查](docs/screenshots/zh/08-context.png) | ![中文设置窗口](docs/screenshots/zh/10-settings.png) |

</details>

<details>
<summary><b>找到下一步 — 命令面板</b></summary>

通过 `⌘K` 搜索操作。受支持命令会打开原生控件；转交 Agent 或不可用的命令不应被理解为 CLI 已被完整图形化。

![中文命令面板](docs/screenshots/zh/09-commands.png)

</details>

<a id="zh-install"></a>
### 安装与开始使用

**本文安装基线：[v0.9.17](https://github.com/nornzach/oh-my-pi-gui/releases/tag/v0.9.17)。** 最新可下载版本与发布说明以 [Releases](https://github.com/nornzach/oh-my-pi-gui/releases) 为准。

| Mac | v0.9.17 下载 |
|---|---|
| Apple Silicon | [omp-0.9.17-arm64.dmg](https://github.com/nornzach/oh-my-pi-gui/releases/download/v0.9.17/omp-0.9.17-arm64.dmg) |
| Intel | [omp-0.9.17.dmg](https://github.com/nornzach/oh-my-pi-gui/releases/download/v0.9.17/omp-0.9.17.dmg) |

| Windows x64 | v0.9.17 下载 |
|---|---|
| 安装程序 | [omp-0.9.17-setup.exe](https://github.com/nornzach/oh-my-pi-gui/releases/download/v0.9.17/omp-0.9.17-setup.exe) |
| 便携版 | [omp-0.9.17-portable.exe](https://github.com/nornzach/oh-my-pi-gui/releases/download/v0.9.17/omp-0.9.17-portable.exe) |

| Linux x64 | v0.9.17 下载 |
|---|---|
| AppImage | [omp-0.9.17.AppImage](https://github.com/nornzach/oh-my-pi-gui/releases/download/v0.9.17/omp-0.9.17.AppImage) |
| Debian/Ubuntu | [omp_0.9.17_amd64.deb](https://github.com/nornzach/oh-my-pi-gui/releases/download/v0.9.17/omp_0.9.17_amd64.deb) |

打开 DMG，把 **omp** 拖入**应用程序**。应用与内置 macOS sidecar 均采用 ad-hoc 签名，未经公证。如果 macOS 拦截首次启动，请先确认下载来源，再使用**右键 → 打开**，或**系统设置 → 隐私与安全性 → 仍要打开**。

Windows 包当前未签名。首次启动前请确认下载来源；Windows SmartScreen 可能需要点击**更多信息 → 仍要运行**。

1. **连接 Provider：**从侧栏打开**提供商与登录**，使用该服务支持的认证方式。
2. **选择工作方式：**`⌘T` 新建项目 Agent 标签页，或 `⇧⌘T` 打开无工具 Chat；选择可用模型。
3. **开始对话：**输入请求。需要新会话时使用 `⌘N`，执行过程中检查工具调用并处理审批。
4. **并行推进：**`⌥T` 新建 worktree 标签页；使用标签右键菜单，或把标签拖入工作区，打开双面板分屏。
5. **查找与回顾：**`⌘K` 浏览命令，`⌘P` 搜索会话历史。

<a id="zh-shortcuts"></a>
### 快捷键

| 快捷键 | 操作 |
|---|---|
| `⌘T` | 新建 Agent 标签页 |
| `⇧⌘T` | 新建无工具 Chat 标签页 |
| `⌥T` | 新建 Git worktree 标签页 |
| `⌘N` | 新建会话 |
| `⌘K` | 命令面板 |
| `⌘P` | 会话历史搜索 |
| `⌘,` | 设置 |
| `⌘B` / `⌘J` | 切换侧栏 |
| `Esc` | 按当前上下文关闭界面或中止执行，不是无条件中止快捷键 |

<a id="zh-development"></a>
### 开发

<details>
<summary><b>构建、测试与复现展示截图</b> — DMG 用户无需执行这些步骤</summary>

#### 仓库边界

这是**嵌套在 monorepo 内的独立仓库**，不是普通的 monorepo 包：

```text
omp-monorepo/                    # nornzach/oh-my-pi：fork 与 sidecar 构建源
├── .git/
├── packages/coding-agent/
├── packages/natives/
└── packages/gui/                # nornzach/oh-my-pi-gui：本产品仓库
    ├── .git/
    ├── src/
    └── resources/omp*           # 本地构建、不入库的 sidecar
```

| 仓库 | 职责 |
|---|---|
| [`nornzach/oh-my-pi-gui`](https://github.com/nornzach/oh-my-pi-gui) | GUI 代码、提交、标签与发布；GUI 工作推送到本仓库的 `origin/main`。 |
| [`nornzach/oh-my-pi`](https://github.com/nornzach/oh-my-pi) | 外层 monorepo fork：提供 Agent 源码、同步上游与构建 sidecar；Agent 改动在这里提交并推送到它的 `origin`。 |
| [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi) | 上游功能来源，通过 monorepo 的 `upstream` 拉取；**绝不向其推送。** |

不要把 `packages/gui/` 暂存到 monorepo；它在外层显示为未跟踪是刻意的安排。在 `packages/gui/` 中运行 Git 命令操作的是 GUI 仓库；monorepo Git 命令应在 monorepo 根目录运行。修改前请阅读 [AGENTS.md](./AGENTS.md)。

#### 从源码构建

**前置条件：**Git、[Bun](https://bun.sh) **≥ 1.4**。macOS sidecar 与 DMG 命令需要 macOS；Windows x64 sidecar 可以在 macOS 或 Linux 上交叉构建，但仍需相邻的 monorepo。Windows 安装包可在 Windows 上用 `bun run package:win` 构建，或由 CI(`.github/workflows/release-windows.yml`)在发布时自动构建并附加。

```bash
# 克隆 monorepo fork，再将 GUI 仓库嵌套其中。
git clone https://github.com/nornzach/oh-my-pi.git omp-monorepo
cd omp-monorepo
git remote add upstream https://github.com/can1357/oh-my-pi.git
bun install
git clone https://github.com/nornzach/oh-my-pi-gui.git packages/gui
cd packages/gui
bun install
```

在 `packages/gui/` 下执行：

```bash
bun run build                                  # 主进程 + preload + 渲染层 -> out/
bun run build:omp                              # arm64 宿主 -> resources/omp
bun run build:omp:x64                          # Intel -> resources/omp.x64
bun run package:mac:arm64 -- --publish never    # dist/omp-<版本>-arm64.dmg
bun run package:mac:x64 -- --publish never      # dist/omp-<版本>.dmg
bun run build:omp:win                           # Windows x64 -> resources/omp.exe
bun run package:win -- --publish never           # Windows NSIS + portable 安装包
```

`build:omp` 编译相邻的 monorepo Agent 源码并嵌入原生插件。它会准备匹配版本的 `pi_natives`，需要时下载已发布的包，替换旧插件，并在结束后还原临时准备的文件。`resources/omp*` 是被忽略的构建产物，**绝不能提交入库**。

打包会重新构建 Electron 应用，**不会重新构建 Agent sidecar**。Agent/RPC 源码或上游更新后，先运行匹配的 `build:omp*`。arm64 配置使用 `resources/omp`，Intel 配置使用 `resources/omp.x64`。Intel 必须使用 `package:mac:x64`，默认配置可能装入错误架构。

Windows 配置目标为 x64，并将 `resources/omp.exe` 放入应用包；它会生成 NSIS 安装程序与便携版可执行文件。Windows 包当前未签名，正式分发前应配置 Windows 代码签名证书。

**单独克隆 GUI 仓库无法编译 sidecar。**它必须位于上述结构的 `packages/gui/`。如仅组装产物、没有 monorepo 源码，可在 `resources/omp` 和/或 `resources/omp.x64` 放入可信且兼容的预编译 sidecar，再执行 `build` 与对应的打包命令。已打包应用使用内置 Agent；另装系统 `omp` 不能替代缺失的 sidecar。

#### 日常开发

```bash
bun run dev                         # HMR，使用 resources/omp
OMP_SIDECAR=source bun run dev       # 显式开发覆盖：使用 monorepo Agent 源码
bunx vitest run                     # GUI 测试
bun run check:types                 # GUI 类型检查
bun run build                      # GUI 生产构建与主进程 bundle 检查
```

同时用 Biome 检查修改过且受其支持的文件。Agent/RPC 改动归属 monorepo；验证打包 GUI 前，需要重新构建内置 sidecar。

#### 复现截图

在 GUI 仓库安装依赖后运行：

```bash
bun run build
bun scripts/capture-showcase.ts
```

截图脚本使用全新的临时 HOME、Electron 配置目录、合成 `aurora-web` 项目与合成 sidecar，渲染真实 Electron GUI，**不使用真实凭据或个人工作区**。本地化图片输出到 `docs/screenshots/en/` 与 `docs/screenshots/zh/`。对话、模型列表、Agent 状态和指标由脚本构造，便于复现；它们不是 Provider 测试或真实使用记录。这套展示数据环境不是操作系统沙箱。

</details>

<a id="zh-help"></a>
### 常见问题

| 现象 | 检查方式 |
|---|---|
| macOS 拦截首次启动 | 确认来自发布页后，右键 → 打开，或通过隐私与安全性 → 仍要打开。应用与内置 sidecar 均为 ad-hoc 签名，未经公证。 |
| Windows SmartScreen 拦截首次启动 | 确认来自发布页后，点击更多信息 → 仍要运行。Windows 包当前未签名。 |
| 截图中的功能在已安装应用中不存在 | 本展示对应 v0.9.17，但截图可能展示较早的 GUI 界面；请检查已安装版本及其发布说明，较早版本可能不包含这些改进。 |
| `Built-in omp not found` | 源码检出中需构建或放入兼容 sidecar；已安装应用请重新安装正确的官方 DMG。另装系统 `omp` 无法补齐包内资源。 |
| `build:omp` 找不到 monorepo | 将 GUI 放在 monorepo 的 `packages/gui/`，与 `packages/coding-agent/`、`packages/natives/` 同级。 |
| `replacing stale addon … version sentinel ≠ …` | 提示信息：构建器发现并替换了版本不匹配的原生插件。 |
| 原生插件下载失败 | 检查 registry 访问及该版本是否已发布。必要时安装所需 Rust 工具链，在 monorepo 根目录运行 `bun --cwd=packages/natives run build`，然后重建 sidecar。 |
| Intel sidecar 立即退出 | 检查 sidecar 架构，并使用 `bun run package:mac:x64` 打包，不要使用默认配置。 |
| 命令或集成不可用 | 部分 slash 命令转交 Agent 或尚未支持。外部工具和服务需另行配置；SSH 管理使用设置页面，而非已停用的 `/ssh` 管理命令。 |

<a id="zh-release"></a>
### 发布流程（维护者）

<details>
<summary><b>标准流程：AGENTS.md 中的 Release Runbook</b></summary>

标准的分步发布流程以 `AGENTS.md` 的 [Release Runbook](AGENTS.md#release-runbook) 为准，每次发布严格照此执行——检出前置检查、上游同步、版本/CHANGELOG/README 准备与验证、提交 + `vX.Y.Z` 标签 + 推送、三个 sidecar 构建与烟测、安装包构建与逐产物检查，最后是携带两个 DMG、两个 ZIP、Windows NSIS 与便携版安装包及更新元数据的 GitHub Release。

发布只属于 [`nornzach/oh-my-pi-gui`](https://github.com/nornzach/oh-my-pi-gui/releases)。绝不提交 sidecar 二进制，也不向 `upstream` 推送。

</details>

---

<div align="center">
Built on <a href="https://github.com/can1357/oh-my-pi">oh-my-pi</a> · GUI releases at <a href="https://github.com/nornzach/oh-my-pi-gui/releases">nornzach/oh-my-pi-gui</a><br>
基于 oh-my-pi · TUI 与 GUI 共存，共享 <code>~/.omp</code>
</div>
