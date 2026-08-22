<div align="center">

# omp GUI

**A native desktop control center for the [omp](https://github.com/can1357/oh-my-pi) coding agent.**

Run parallel agent sessions · inspect every tool call · manage models and usage — without living in a terminal.

<a href="https://github.com/nornzach/oh-my-pi-gui/releases"><img src="https://img.shields.io/github/v/release/nornzach/oh-my-pi-gui?style=flat&colorA=222222&colorB=3FB950" alt="Release"></a>
<a href="https://github.com/nornzach/oh-my-pi-gui/releases"><img src="https://img.shields.io/github/downloads/nornzach/oh-my-pi-gui/total?style=flat&colorA=222222&colorB=58A6FF" alt="Downloads"></a>
<a href="./LICENSE"><img src="https://img.shields.io/github/license/nornzach/oh-my-pi-gui?style=flat&colorA=222222&colorB=BE185D" alt="License"></a>
<img src="https://img.shields.io/badge/platform-macOS-222222?style=flat" alt="Platform">
<img src="https://img.shields.io/badge/Electron-35-47848F?style=flat&logo=electron&logoColor=white" alt="Electron">
<img src="https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=white" alt="React">

[English](#english) · [中文](#中文)

</div>

---

![Chat](docs/screenshots/01-chat-main.webp)

<a name="english"></a>
## English

`omp GUI` is a desktop app for the [omp](https://github.com/can1357/oh-my-pi) coding agent. It bundles the agent as a built-in binary — **no need to separately install omp, Bun, or Node** — and gives you a full visual interface for running parallel agent sessions, inspecting tool calls, and managing models, providers, and usage.

**Contents**

- [Why a GUI?](#why-a-gui)
- [Highlights](#highlights)
- [Screenshots](#screenshots)
- [Install](#install)
- [Quick Start](#quick-start)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Release process (maintainers)](#release-process-maintainers)

### Why a GUI?

The omp TUI is powerful, but some things are easier with a visual interface. omp GUI doesn't replace the TUI — it complements it, sharing the same `~/.omp` config and sessions.

| | omp TUI | omp GUI | Claude Code | Cursor |
|---|---|---|---|---|
| Parallel sessions | ✓ | ✓ (tabs + worktrees) | ✓ | — |
| Visual tool calls | — | ✓ | partial | — |
| Provider/model management | CLI | GUI + OAuth | limited | limited |
| Usage analytics | CLI | dashboard | — | — |
| Session search / fork | ✓ | ✓ | — | — |
| Requires terminal | yes | no | yes | no |
| Bundled agent | npm/brew | sidecar (zero deps) | — | — |

### Highlights

- **Parallel sessions.** Open up to 10 tabs, each with its own sidecar, session, queue, and optional git worktree. Background tabs keep running, and the open/active tab workspace survives restarts and app upgrades.
- **Chats stay separate from agent workspaces.** The sidebar keeps tool-free chat history in a global section while project groups contain only coding-agent tasks, so workspace actions never sweep chats into project operations.
- **Dense execution state without nested scrollbars.** Large Todo and Agents collections collapse into bounded summaries, keep urgent rows visible, and expand one card into a focused full-list view when you need every item.
- **Every `/` command as a menu.** `⌘K` opens a searchable command palette — sub-menus, argument prompts, and toggles all run real RPC, never a fake input box.
- **Visual tool calls.** Bash, edit, read, grep, task — rendered live with real diffs, syntax highlighting, collapsible thinking blocks, KaTeX math, and mermaid diagrams.
- **Model & provider management.** OAuth or API-key sign-in, live upstream model discovery for OpenAI and Anthropic-compatible providers, per-role model assignment, thinking-level tuning, and a full usage dashboard with cost/speed/cache-hit charts.
- **Bundled agent, zero deps.** The app ships its own omp binary — no separate omp / Bun / Node install required. The same `~/.omp` config is shared with the TUI.

### Screenshots

| | |
|---|---|
| **Large-list dock** — bounded Todo and Agents summaries avoid nested scrollbars; one card can expand into a focused full-list view | ![Execution dock summary](docs/screenshots/09-dock-summary.webp) |
| **Command Palette (`⌘K`)** — every slash command as a grouped, searchable menu | ![Command palette](docs/screenshots/02-command-palette.webp) |
| **Workspace panel** — Diff / Files / Logs beside the chat; live todos, plan review, subagents, and queue render as dock cards in the conversation | ![Workspace](docs/screenshots/03-workspace-files.webp) |
| **Settings** — runtime, model, context, tools, providers, GUI, all in one window | ![Settings](docs/screenshots/05-settings.webp) |
| **Model picker** — grouped by provider with auth status | ![Model picker](docs/screenshots/06-model-picker.webp) |
| **Usage & stats** — requests, tokens, cost, cache-hit, speed over time | ![Stats](docs/screenshots/07-session-stats.webp) |
| **Providers & login** — OAuth / API-key sign-in, third-party providers | ![Providers](docs/screenshots/08-providers-login.webp) |

### Install

Current release: [**v0.9.1**](https://github.com/nornzach/oh-my-pi-gui/releases/tag/v0.9.1)

- **Apple Silicon (M1/M2/M3/M4):** `omp-0.9.1-arm64.dmg`
- **Intel:** `omp-0.9.1.dmg`

Open the `.dmg` and drag **omp** into **Applications**. The build is ad-hoc signed but not notarized, so on first launch macOS may block it: **right-click → Open** (or *System Settings → Privacy & Security → Open Anyway*).

### Quick Start

1. **Install** — download the `.dmg`, drag **omp** to **Applications**, right-click → Open
2. **Sign in** — add your provider via OAuth or API key (`⌘,` → Providers)
3. **Start a session** — `⌘N` for a new session, type a prompt, hit Enter
4. **Browse commands** — `⌘K` to open the command palette and explore every `/` command as a menu
5. **Go parallel** — `⌥T` to spawn a new tab with its own session and optional git worktree

### Keyboard shortcuts

`⌘K` command palette · `⌘P` session search · `⌘N` new session · `⌘,` settings · `⌘B`/`⌘J` toggle sidebars · `Esc` abort turn

---

<details>
<summary><b>Development</b> — for building and developing the GUI itself</summary>

*End users installing the DMG can stop here.*

#### Repository layout (read this first)

This repo ([`nornzach/oh-my-pi-gui`](https://github.com/nornzach/oh-my-pi-gui)) is the **only** commit/release target for the GUI — but it does **not** contain the agent source. The agent is compiled in from the [oh-my-pi monorepo fork](https://github.com/nornzach/oh-my-pi) (tracking [upstream can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)) at package time, as a bundled sidecar binary. Consequences:

- **Cloning this repo alone is not enough to build a package.** `bun run build:omp` resolves `../../coding-agent` and `../../natives`, i.e. it expects this repo checked out at `packages/gui/` inside a monorepo clone.
- **The ~120 MB sidecar binaries (`resources/omp*`) are gitignored.** A fresh clone has no `resources/omp`, and without it the app shows "Built-in omp not found" at startup. That is expected until you build or drop in a sidecar.
- The monorepo is only a **sync + build source**; GUI commits, tags, and GitHub releases live exclusively in this repo.

#### Build from source

**Prerequisites:** macOS (for the DMG targets), [Bun](https://bun.sh) ≥ 1.3.14, and both repos side by side:

```bash
# 1. Monorepo — provides the agent + native addon that become the sidecar
git clone https://github.com/nornzach/oh-my-pi.git omp-monorepo
cd omp-monorepo && bun install && cd ..

# 2. GUI repo, checked out at packages/gui inside the monorepo
cd omp-monorepo/packages
git clone https://github.com/nornzach/oh-my-pi-gui.git gui
cd gui && bun install
```

Then build (all commands run from `packages/gui`):

```bash
bun run build             # renderer + main + preload → out/
bun run build:omp         # compile the agent sidecar → resources/omp  (arm64)
bun run build:omp:x64     # …and the Intel sidecar → resources/omp.x64 (cross-build on Apple Silicon)
bun run package:mac:arm64 # → dist/omp-<ver>-arm64.dmg (ships resources/omp)
bun run package:mac:x64   # → dist/omp-<ver>.dmg       (ships resources/omp.x64)
```

`build:omp` stages the matching `pi_natives` native addon automatically (downloading the published `@oh-my-pi/pi-natives-<platform>` package when missing, replacing stale-version addons), embeds it into the binary, and restores the natives tree afterwards — its errors name the missing piece and the fix. Every `package:*` script rebuilds the Electron app before packaging so a stale `out/` directory cannot produce an old GUI; run the matching `build:omp*` first whenever agent/sidecar source changed. `package:mac:arm64` / `package:mac:x64` exist because the two architectures use different electron-builder configs (`electron-builder.yml` vs `electron-builder.x64.yml`); packaging Intel with the default config ships the wrong-arch sidecar.

**Without the monorepo** (e.g. CI artifact assembly): drop a prebuilt sidecar into `resources/omp` (arm64) and/or `resources/omp.x64` (Intel), run `bun run build` + the matching `package:mac:*` script, and skip `build:omp` entirely. The release apps already include the sidecar, so end users never need any of this.

#### Dev commands

```bash
bun run dev               # electron-vite dev with HMR (uses resources/omp as the sidecar)
OMP_SIDECAR=source bun run dev   # dev override: run the monorepo agent source instead
bunx vitest run           # test suite
bun run check:types       # tsc
```

</details>

### Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `Built-in omp not found` at startup | No `resources/omp` in the clone — it is gitignored. Run `bun run build:omp` (needs the monorepo layout above) or drop in a prebuilt sidecar. |
| `build-bundled-omp must run inside the omp monorepo` | The repo isn't at `packages/gui/` inside a monorepo clone. Re-create the nested checkout (step 1–2 above). |
| `replacing stale addon … version sentinel ≠ <ver>` | Informational: the monorepo's cached `pi_natives` was from an older release; the script replaced it automatically. No action needed. |
| `Failed to download @oh-my-pi/pi-natives-<platform>@<ver>` | That natives version isn't on npm yet (fresh upstream bump). Build it from source: `bun --cwd=packages/natives run build` (Rust toolchain required), then re-run `build:omp`. |
| Intel DMG crashes at launch / sidecar exits immediately | Wrong-arch sidecar packaged. Always use `bun run package:mac:x64` for Intel — the default `package:mac` config ships `resources/omp` (arm64). |
| macOS blocks first launch | The build is ad-hoc signed but not notarized: **right-click → Open**, or *System Settings → Privacy & Security → Open Anyway*. |
| Syncing the monorepo with upstream | Run `bash packages/gui/scripts/sync-upstream.sh` from the monorepo root — it merges upstream, re-provisions natives, rebuilds the sidecar, and runs the GUI build + tests. |

### Release process (maintainers)

Releases are published **only** from this repo, to [`github.com/nornzach/oh-my-pi-gui/releases`](https://github.com/nornzach/oh-my-pi-gui/releases):

1. Sync the monorepo with upstream (`scripts/sync-upstream.sh`) and keep both checkouts clean.
2. Bump `version` in `package.json`, write the `CHANGELOG.md` section, update the Install links above.
3. `bunx vitest run && bun run check:types && bun run build`.
4. `bun run build:omp && bun run build:omp:x64` — smoke-test each binary (`resources/omp --smoke-test`, or launch with `--mode rpc-ui` and expect `{"type":"ready"}`).
5. `bun run package:mac:arm64 -- --publish never` and `bun run package:mac:x64 -- --publish never`; verify both app bundles are sealed (`codesign --verify --deep --strict --verbose=2 <path-to-omp.app>`), mount both DMGs, verify the bundled sidecar is the matching arch (`file …/Contents/Resources/omp`), and launch each app once (sidecar `ready`, settings toggle persists).
6. Commit, tag `vX.Y.Z`, push `main` + tag, publish the GitHub Release with both DMGs and the changelog body.

---

<a name="中文"></a>
## 中文

`omp GUI` 是 [omp](https://github.com/can1357/oh-my-pi) 编码 agent 的桌面应用。它将 agent 作为内置二进制打包——**无需单独安装 omp、Bun 或 Node**——提供完整的可视化界面来运行并行 agent 会话、检查工具调用、管理模型与用量。

**目录**

- [为什么需要 GUI?](#为什么需要-gui)
- [核心特性](#核心特性)
- [界面截图](#界面截图)
- [安装](#安装)
- [快速上手](#快速上手)
- [快捷键](#快捷键)
- [开发](#开发)
- [常见问题](#常见问题)
- [发布流程（维护者）](#发布流程维护者)

### 为什么需要 GUI?

omp TUI 很强大,但有些事情用可视化界面更方便。omp GUI 不替代 TUI——两者互补,共享同一份 `~/.omp` 配置和会话。

| | omp TUI | omp GUI | Claude Code | Cursor |
|---|---|---|---|---|
| 并行会话 | ✓ | ✓（标签页 + worktree） | ✓ | — |
| 可视化工具调用 | — | ✓ | 部分 | — |
| Provider/模型管理 | 命令行 | GUI + OAuth | 有限 | 有限 |
| 用量分析 | 命令行 | 仪表盘 | — | — |
| 会话搜索/分支 | ✓ | ✓ | — | — |
| 需要终端 | 是 | 否 | 是 | 否 |
| 内置 agent | npm/brew | sidecar（零依赖） | — | — |

### 核心特性

- **并行会话。** 最多同时打开 10 个标签页,每个拥有独立 sidecar、会话、队列和可选 git worktree。后台标签页持续运行,已打开及选中的标签工作区会跨重启和应用升级保留。
- **Chat 与 Agent 工作区分离。** 左侧栏把无工具聊天历史放进全局分组,项目工作区只保留编码 agent 任务,工作区操作不会再把 chat 混入项目范围。
- **大量任务也不出现双层滚动。** Todo 与 Agents 使用受控摘要展示,保留待处理和紧急项；需要查看全部时可将单一卡片展开为聚焦视图。
- **所有 `/` 命令做成菜单。** `⌘K` 打开可搜索的命令面板——子菜单、参数输入、开关项都走真实 RPC,绝不是套个输入框。
- **可视化工具调用。** Bash、edit、read、grep、task——实时渲染真实 diff、语法高亮、可折叠思考块、KaTeX 公式和 mermaid 图。
- **模型与 Provider 管理。** OAuth 或 API key 登录、OpenAI/Anthropic 兼容 Provider 的上游模型实时发现、按角色分配模型、调节思考等级,以及完整的用量仪表盘（花费/速度/缓存命中图表）。
- **内置 agent,零依赖。** 应用自带 omp 二进制——无需单独安装 omp / Bun / Node。与 TUI 共享同一份 `~/.omp` 配置。

### 界面截图

| | |
|---|---|
| **大量任务 Dock**——Todo 与 Agents 使用受控摘要避免双层滚动,并可将单一卡片展开为聚焦全列表 | ![执行 Dock 摘要](docs/screenshots/09-dock-summary.webp) |
| **命令面板(`⌘K`)**——所有 slash 命令的分组可搜索菜单 | ![命令面板](docs/screenshots/02-command-palette.webp) |
| **工作区面板**——聊天旁的待办/计划/子agent/Diff/文件/日志 | ![工作区](docs/screenshots/03-workspace-files.webp) |
| **设置**——运行时、模型、上下文、工具、Provider、GUI 集中一窗 | ![设置](docs/screenshots/05-settings.webp) |
| **模型选择器**——按 provider 分组,带认证状态 | ![模型选择器](docs/screenshots/06-model-picker.webp) |
| **用量统计**——请求、token、花费、缓存命中、速度随时间变化 | ![统计](docs/screenshots/07-session-stats.webp) |
| **Provider 与登录**——OAuth / API key 登录、第三方 provider | ![Provider](docs/screenshots/08-providers-login.webp) |

### 安装

当前版本：[**v0.9.1**](https://github.com/nornzach/oh-my-pi-gui/releases/tag/v0.9.1)

- **Apple Silicon（M1/M2/M3/M4）：** `omp-0.9.1-arm64.dmg`
- **Intel：** `omp-0.9.1.dmg`

打开 `.dmg`,把 **omp** 拖进 **应用程序**。当前构建采用 ad-hoc 签名但未经 Apple 公证,首次打开 macOS 可能拦截:**右键 → 打开**(或 *系统设置 → 隐私与安全性 → 仍要打开*)。

### 快速上手

1. **安装** — 下载 `.dmg`,把 **omp** 拖到 **应用程序**,右键 → 打开
2. **登录** — 通过 OAuth 或 API key 添加你的 provider（`⌘,` → Providers）
3. **开始会话** — `⌘N` 新建会话,输入提示词,回车
4. **浏览命令** — `⌘K` 打开命令面板,探索所有 `/` 命令
5. **并行运行** — `⌥T` 新建标签页,拥有独立会话和可选 git worktree

### 快捷键

`⌘K` 命令面板 · `⌘P` 会话搜索 · `⌘N` 新会话 · `⌘,` 设置 · `⌘B`/`⌘J` 切换侧栏 · `Esc` 中止回合

---

<details>
<summary><b>开发</b> — 面向构建与开发 GUI 本身</summary>

*通过 DMG 安装的最终用户可以到此为止。*

#### 仓库结构（先读这段）

本仓库（[`nornzach/oh-my-pi-gui`](https://github.com/nornzach/oh-my-pi-gui)）是 GUI **唯一**的提交与发布仓库——但它**不包含** agent 源码。agent 在打包时从 [oh-my-pi monorepo fork](https://github.com/nornzach/oh-my-pi)(同步自[上游 can1357/oh-my-pi](https://github.com/can1357/oh-my-pi))编译进来,成为内置 sidecar 二进制。因此：

- **只 clone 本仓库无法完成打包。** `bun run build:omp` 会解析 `../../coding-agent` 与 `../../natives`,即要求本仓库位于 monorepo 克隆的 `packages/gui/` 位置。
- **约 120 MB 的 sidecar 二进制(`resources/omp*`)不入库。** 全新克隆没有 `resources/omp`,此时启动应用会显示"Built-in omp not found",这是构建/放置 sidecar 之前的预期行为。
- monorepo 只承担**同步上游 + 提供构建源**的角色;GUI 的提交、标签、GitHub Release 全部只属于本仓库。

#### 从源码构建

**前置条件:** macOS（构建 DMG）、[Bun](https://bun.sh) ≥ 1.3.14,以及并排的两个仓库：

```bash
# 1. monorepo——提供编译 sidecar 所需的 agent 与原生插件
git clone https://github.com/nornzach/oh-my-pi.git omp-monorepo
cd omp-monorepo && bun install && cd ..

# 2. GUI 仓库,克隆到 monorepo 的 packages/gui 位置
cd omp-monorepo/packages
git clone https://github.com/nornzach/oh-my-pi-gui.git gui
cd gui && bun install
```

然后构建（所有命令都在 `packages/gui` 下执行）：

```bash
bun run build             # 渲染层 + 主进程 + preload → out/
bun run build:omp         # 编译 agent sidecar → resources/omp（arm64）
bun run build:omp:x64     # 再编译 Intel sidecar → resources/omp.x64（Apple Silicon 上交叉构建）
bun run package:mac:arm64 # → dist/omp-<版本>-arm64.dmg（随包 resources/omp）
bun run package:mac:x64   # → dist/omp-<版本>.dmg（随包 resources/omp.x64）
```

`build:omp` 会自动准备匹配的 `pi_natives` 原生插件（缺失时从 npm 下载已发布的 `@oh-my-pi/pi-natives-<平台>` 包,版本不符时自动替换）,将其嵌入二进制,并在结束后还原 natives 目录——脚本报错会明确指出缺失的部分和修复方法。每个 `package:*` 脚本都会先重新构建 Electron 应用,避免残留的旧 `out/` 被再次封装；agent/sidecar 源码有改动时,仍需先运行匹配架构的 `build:omp*`。`package:mac:arm64` / `package:mac:x64` 之所以分开,是因为两种架构使用不同的 electron-builder 配置（`electron-builder.yml` 与 `electron-builder.x64.yml`）;用默认配置打 Intel 包会装入错误架构的 sidecar。

**没有 monorepo 时**（如 CI 组装产物）：把预编译 sidecar 放入 `resources/omp`（arm64）和/或 `resources/omp.x64`（Intel）,执行 `bun run build` 加对应的 `package:mac:*` 脚本,完全跳过 `build:omp`。Release 应用已内置 sidecar,最终用户无需关心以上任何步骤。

#### 开发命令

```bash
bun run dev               # electron-vite 开发模式(HMR,使用 resources/omp 作为 sidecar)
OMP_SIDECAR=source bun run dev   # 开发覆盖:改为运行 monorepo 中的 agent 源码
bunx vitest run           # 测试套件
bun run check:types       # tsc 类型检查
```

</details>

### 常见问题

| 症状 | 原因与修复 |
|---|---|
| 启动时报 `Built-in omp not found` | 克隆中没有 `resources/omp`（该文件不入库）。在上方嵌套结构中运行 `bun run build:omp`,或放入预编译 sidecar。 |
| 报 `build-bundled-omp must run inside the omp monorepo` | 仓库不在 monorepo 克隆的 `packages/gui/` 位置。按上方第 1–2 步重建嵌套检出。 |
| 日志出现 `replacing stale addon … version sentinel ≠ <版本>` | 提示信息：monorepo 缓存的 `pi_natives` 来自旧版本,脚本已自动替换。无需处理。 |
| 报 `Failed to download @oh-my-pi/pi-natives-<平台>@<版本>` | 该版本原生插件尚未发布到 npm（上游刚升版）。改用源码构建：`bun --cwd=packages/natives run build`（需要 Rust 工具链）,然后重跑 `build:omp`。 |
| Intel DMG 启动即崩溃 / sidecar 立即退出 | 打进了错误架构的 sidecar。Intel 包必须用 `bun run package:mac:x64`——默认 `package:mac` 配置装的是 `resources/omp`（arm64）。 |
| macOS 首次启动被拦截 | 当前构建采用 ad-hoc 签名但未经 Apple 公证：**右键 → 打开**,或 *系统设置 → 隐私与安全性 → 仍要打开*。 |
| 需要同步 monorepo 上游 | 在 monorepo 根目录运行 `bash packages/gui/scripts/sync-upstream.sh`——自动合并上游、重备原生插件、重建 sidecar,并执行 GUI 构建与测试。 |

### 发布流程（维护者）

发布**只**从本仓库进行,目标为 [`github.com/nornzach/oh-my-pi-gui/releases`](https://github.com/nornzach/oh-my-pi-gui/releases)：

1. 用 `scripts/sync-upstream.sh` 同步 monorepo 上游,保持两个检出干净。
2. 提升 `package.json` 的 `version`,撰写 `CHANGELOG.md` 段落,更新上方安装链接。
3. `bunx vitest run && bun run check:types && bun run build`。
4. `bun run build:omp && bun run build:omp:x64`——分别烟测两个二进制（`resources/omp --smoke-test`,或以 `--mode rpc-ui` 启动并期待 `{"type":"ready"}`）。
5. `bun run package:mac:arm64 -- --publish never` 与 `bun run package:mac:x64 -- --publish never`；挂载两个 DMG,用 `file …/Contents/Resources/omp` 确认包内 sidecar 架构匹配,各启动一次（sidecar 到达 `ready`、设置开关可持久化）。
6. 提交、打 `vX.Y.Z` 标签、推送 `main` 与标签,携带两个 DMG 和 changelog 正文发布 GitHub Release。

---

<div align="center">
Built on the <a href="https://github.com/can1357/oh-my-pi">oh-my-pi</a> agent. The TUI and GUI coexist and share <code>~/.omp</code>.
</div>
