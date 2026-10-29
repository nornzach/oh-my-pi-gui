# Changelog

## [Unreleased]

### Added

- **Notify while focused** in Settings → GUI: desktop notifications now have a companion switch for the case they always skipped, so a turn that finishes while you are looking at the window still announces itself. It stays off by default, and the master switch still silences everything.
- Ask the agent to list, change, pause, resume or delete the scheduled tasks of the workspace you are in, and it does so in the conversation. Only you can let a task's runs edit files, in Scheduled Tasks.

### Changed

- Sessions you click in the sidebar open right away instead of after up to a few seconds. A blank tab, or a tab you opened from the sidebar and have not sent a message in, shows the next session you click instead of starting another tab ([#29](https://github.com/nornzach/oh-my-pi-gui/issues/29)).
- A scheduled task you ask the agent for is created right away and reported in the conversation, with its first run, instead of waiting for you to confirm a card. Runs stay read-only, and a model you name is used for them.

### Fixed

- On Windows and Linux, shortcuts shown with ⌘ use Ctrl. Ctrl+T and Ctrl+Shift+T open an agent or chat tab, Ctrl+W closes a tab, Ctrl+1–Ctrl+9 select one, Ctrl+Alt+Shift+← / → move it, and Ctrl+Shift+F searches conversations; before, these took the Windows key and did nothing. Show or hide thinking, which was Ctrl+T there, is now Alt+Shift+T. The shortcuts list and the new-tab buttons' tooltips show the Ctrl keys ([#30](https://github.com/nornzach/oh-my-pi-gui/issues/30)).
- Links in Chinese replies no longer swallow the text after them: a bare address ends at full-width punctuation such as `，` or `。`, or where Chinese text runs straight into its host or port, and a bold address renders bold with the link inside ([#35](https://github.com/nornzach/oh-my-pi-gui/issues/35)).
- Model Roles keeps a role's thinking level when you change its model, shows the saved model as selected, and lets you pick the level, including Off ([#34](https://github.com/nornzach/oh-my-pi-gui/issues/34)).
- Settings search results for GUI and Advanced settings name their page ("GUI", "Advanced") instead of showing `settings.tab.gui` or `settings.tab.advanced`.
- The model dropdown in the scheduled-task editor opens again. Model dropdowns also stay open while you scroll their list, and Escape inside a dialog closes only the dropdown.

## [0.9.32] - 2026-10-28

### Added

- Drag a tab to reorder the tab bar; the order is kept after a restart, and a split pair moves as one ([#30](https://github.com/nornzach/oh-my-pi-gui/issues/30)).
- **Tab bar** settings in Settings → GUI: compact, default or wide tabs, and an option to wrap tabs onto up to three rows instead of scrolling ([#30](https://github.com/nornzach/oh-my-pi-gui/issues/30)).
- An all-tabs button at the end of the tab bar counts the tabs scrolled out of view and opens a searchable list of every tab ([#30](https://github.com/nornzach/oh-my-pi-gui/issues/30)).
- Tab shortcuts: ⌘1–⌘9 select a tab (⌘9 the last), ⌃Tab and ⌃⇧Tab go to the next or previous tab, and ⌥⇧⌘← / ⌥⇧⌘→ move the current tab ([#30](https://github.com/nornzach/oh-my-pi-gui/issues/30)).

### Changed

- Bundled agent rebuilt from monorepo `e1df76a4`, on upstream omp v18.13.3 (`7a3f804f`). Among upstream's changes: one Esc no longer stops a session from waking on its own background job results, `!` commands on zsh or fish no longer hang at interactive prompts, resuming after a prewalk handoff keeps the model it switched to, and auto-compaction no longer fires early on OpenAI-compatible models that don't replay past reasoning.
- Split view keeps its pairs: two split tabs merge into one chip in the tab bar and one frame in the sidebar, and selecting either shows both. Selecting another tab shows it alone without undoing the pair, a window can hold several pairs, and all of them come back after a restart. Right-click a tab for **Split with…** to pick its partner or **Separate pair** to undo it, and drop a tab on one pane of a shown pair to put it there instead ([#30](https://github.com/nornzach/oh-my-pi-gui/issues/30)).
- Opening a session from the sidebar, or a new tab with ⌘T, in a workspace you already have open no longer waits for omp to start: an idle agent is kept running there and the tab takes it over instead of starting its own. A session whose saved model is gone still opens, on the default model ([#29](https://github.com/nornzach/oh-my-pi-gui/issues/29)).

## [0.9.31] - 2026-10-28

### Added

- Right-click a file in the Files panel or in the Changes panel's working tree to reveal it in Finder, open or preview it, or copy its path ([#27](https://github.com/nornzach/oh-my-pi-gui/issues/27)). A file that no longer exists, such as a deleted one, offers only **Copy path**, here and on file links.
- Provider quotas in the tray menu: clicking the omp icon in the menu bar, system tray or panel shows, at the top, a row per provider with each time window's used share (`Anthropic — 5h 42%, 7d 60%`) and a ring that turns yellow, then red, near the limit. Hover a row for every limit and when it resets. With more than five subscriptions, the five nearest their limit stay on top and the rest sit under More quotas ([#28](https://github.com/nornzach/oh-my-pi-gui/issues/28)).
- Quotas in the sidebar, off by default: turn on **Quotas in the sidebar** in Settings → GUI for a strip above Settings with a row per provider and a ring for each time window. Hover a row for every limit and when it resets, click it to open Usage & quotas, or right-click to refresh or hide the strip. With more than four subscriptions, the four nearest their limit show and the rest are counted under More quotas ([#28](https://github.com/nornzach/oh-my-pi-gui/issues/28)).

### Changed

- Bundled agent rebuilt from monorepo `59e27303`, on upstream omp main after v18.13.1 (`6163dff1`). Among upstream's changes: pressing Esc on a busy session keeps queued messages from extensions and agents, resuming a conversation that continued in a new file opens the copy with the newest turn, `@` mentions of PDF, Word, Excel, PowerPoint and EPUB files attach their text, and image descriptions use the least expensive vision model instead of the first one in the catalog.

### Fixed

- On Windows, file links to another drive open the file. A `file:///E:/…` link previewed `C:\E:\…` and failed to read, and a link written as `E:\…` or `E:/…` did nothing when clicked ([#27](https://github.com/nornzach/oh-my-pi-gui/issues/27)).

## [0.9.30] - 2026-10-27

### Added

- **Rosé Pine** theme: the dark Rosé Pine palette for the whole window, in Settings → Theme. — thanks [@ItsLemmy](https://github.com/ItsLemmy) ([#24](https://github.com/nornzach/oh-my-pi-gui/pull/24))
- Web addresses and file paths in replies and tool output are links. A click opens a web page in the Browser panel and a file in the Files preview at the named line (`src/app.ts:42`, `#L42`); ⌘/Ctrl-click opens it in your browser or default app. Right-click opens, reveals in Finder, or copies the link or path. Paths become links only when they exist ([#27](https://github.com/nornzach/oh-my-pi-gui/issues/27)).
- Right-clicking selected text in a reply or tool output offers **Copy**.

### Changed

- Clicking a file path in a tool card previews it in the Files panel; ⌘/Ctrl-click opens it in the default app as a plain click did before.
- Bundled agent rebuilt from monorepo `b5a2c108`, on upstream omp v18.13.1 plus the fork's sign-in fixes for Open in Browser and MCP re-authorization. Among upstream's changes: `tools.restrictedFolders` makes every action on a listed folder ask for approval in every mode, `/pause` shows what is still running across subagents, advisors wait out timed rate limits instead of dropping their review, and task subagents no longer receive `AGENTS.md` files when the session has extra workspace roots.

### Fixed

- The Agents card above the message box shows only while an agent is working, and **Pinned Agents** in Settings now applies to it: Off hides it, Collapsed shows the summary, Full lists every agent. Finished agents stay in the Agents tab ([#25](https://github.com/nornzach/oh-my-pi-gui/issues/25)).
- Usage reset times read like the CLI's, such as `resets in 5d 2h` instead of `resets in 7328m 42s`. Other times over an hour, such as job and goal timers, also show hours and days ([#26](https://github.com/nornzach/oh-my-pi-gui/issues/26)).
- Signing in from **Open in Browser** no longer asks for a pasted code after you press Done: the dialog waits for the browser and closes by itself once you're signed in. If the browser can't reach the app, paste the code into the same dialog.
- Cancelling **Open in Browser** while re-authorizing an MCP server stops the re-authorization, without an error message.

## [0.9.29] - 2026-10-26

### Added

- Each row in the Agents tab says the agent's type and number, its model with the reasoning level, and its tokens and cost, as the agents card above the message box does ([#23](https://github.com/nornzach/oh-my-pi-gui/issues/23)).

### Fixed

- **All** in the Agents tab lists agents in the order they were spawned, so new agents land at the end instead of mixing in with the agents of earlier task calls ([#23](https://github.com/nornzach/oh-my-pi-gui/issues/23)).
- **This turn** keeps every agent spawned since your last message after it finishes, including agents spawned by an agent from an earlier turn ([#23](https://github.com/nornzach/oh-my-pi-gui/issues/23)).
- The bundled agent runs on Bun 1.4.4, so it no longer trusts certificates from the compromised eMudhra intermediate CAs (CVE-2026-91403) and no longer carries the Brotli decoder out-of-bounds write (CVE-2026-111497).

### Changed

- Bundled agent rebuilt from monorepo `08a26683`, on upstream omp v18.13.0 plus the fork's RPC queue fix and the saved subagents of reopened sessions. Among upstream's changes: a subagent's result up to 11,500 characters reaches its parent whole, waiting on a subagent shows its run time, cost and stage, `grep` can leave paths out with `!`, and compaction no longer repeats on small context windows.

## [0.9.28] - 2026-10-26

### Added

- **Subagent pages**: click a subagent anywhere to open its page in a tab beside its session. It shows the agent's conversation, live while it works, with Stop, Revive, Open beside and Keep open, and the title bar shows its parents, status and facts. A page only reads: it never acts on the session.
- **Agents in the sidebar**: each open session lists this turn's agents under its row, background tabs included: five at most, then a count of the hidden working and failed ones. Once a later turn starts none, the session keeps its earlier agents behind a closed arrow with a count. Resting on an agent row shows its status, current step and last steps.
- **Agents tab in the right drawer**: this turn's agents or all of them, as a list or a graph, with pause, stop and expand, and a dot for a working agent or an unseen failure.

### Fixed

- Closing a session and reopening it keeps its agents, with their names, outcome, model, tokens and conversations, and its "Todos updated" rows. An agent still running when the session closed shows as aborted.
- Finished agents no longer vanish from the sidebar, and parked agents no longer count as running.
- Launching the installed app with a folder (`omp ~/code/x`, or `open -a omp --args ~/code/x`) opens that folder instead of Work mode.
- On a fresh profile, new sessions appear in the sidebar without a restart.
- Deleting a session no longer leaves an empty "Untitled" row in its place.
- Pressing Escape at the "Close tab?" prompt for a running tab no longer stops the run it was protecting.
- A split pane's ✕ removes that pane instead of the other one.
- Clicking a session's row while one of its agent pages is shown returns to the conversation.

### Changed

- A session's menu has one Open action; "Open in new tab" and the hover + are gone.
- Bundled agent rebuilt from monorepo `79e6760b`: upstream main has no new commits since 0.9.27 (still past v18.12.6), plus the fork's RPC queue fix and the saved subagents of reopened sessions.

## [0.9.27] - 2026-10-25

### Added

- **Scheduled tasks**: ask the agent to do something on a schedule ("check the dashboard every weekday at 9") and it drafts a task you confirm, edit or decline, or create one from **Scheduled tasks** in the sidebar. Tasks run on their own in the background, read-only or in their own git worktree, end with a short report, can run a shell check, and land in a review queue when they changed files. Runs, reviews and an insights page (success rate, cost, runs per day, recent failures) live in the same window, with notifications and a dock badge for what needs you. Slots the computer slept through are recorded as missed, never replayed.
- **Overview tab in the right drawer**: opening the drawer now lands on an overview of the session. It shows how full the context is, the folder, branch and model, uncommitted files, what is running (the agent, subagents, side questions, todo progress), and the state of each MCP server, with links to the full views. Chat tabs show only context, workspace and running work.
- **Context breakdown by category**: `/context` and the usage popover beside Send now show one stacked bar and a row per category (messages, tool schemas, system prompt, system context, skills) with tokens and share of the window, plus the auto-compact buffer and free space, matching the compaction threshold the strategy bar shows.
- **Side questions in the right drawer**: a Side questions tab lists this session's `/btw` topics and shows each full thread, where you can follow up, stop, copy, or branch an answer into the main conversation. `/btw` on its own opens the tab, and closing the `/btw` window no longer stops the answer: it keeps streaming in the drawer. — thanks [@Sakura1618](https://github.com/Sakura1618) ([#21](https://github.com/nornzach/oh-my-pi-gui/pull/21))
- **Select sessions in bulk**: turn on Select in the sidebar, or ⌘-click and ⇧-click sessions, then archive, unarchive or delete them together. ⌘A selects every shown session and ⌫ deletes; deleting asks first, counts off its progress and leaves running sessions alone. Archived sessions move to their own collapsible section.
- **Find in the conversation**: Edit → Find (⌘F) opens a find bar over the transcript with a match count; Enter and ⇧Enter (or ⌘G and ⇧⌘G) step through the matches. In the browser panel ⌘F still searches the page.

### Fixed

- Sessions no longer drop out of the sidebar when a slow list read answers after a newer one.
- A session whose first line is longer than 4 KB keeps its folder instead of landing in a nameless group.
- The sidebar no longer holds thousands of files open: it watches session files only and lets go of logs older than a day.
- Opening a global search result lands on the matching message instead of stopping short of it.

### Changed

- The shortcuts window labels the menu-bar shortcuts and lists the find and session-selection keys.
- Bundled agent rebuilt from monorepo `6484c767`, with no change in behavior: upstream main has no new commits since 0.9.26 (still past v18.12.6), plus the fork's RPC queue fix.

## [0.9.26] - 2026-10-24

### Fixed

- **A manual `/compact` or handoff no longer makes the agent look unavailable**: slow commands (compaction, handoff, a compacting plan approval, sign-in, MCP and plugin actions) no longer hold every later command in a queue, so state reads, transcript loads and Stop keep answering while they run. Moving to another point in the conversation is refused until a compaction or handoff finishes, instead of moving the session under it ([#19](https://github.com/nornzach/oh-my-pi-gui/issues/19)).
- **An auto-retried run keeps your prompt**: the prompt and the failed attempt no longer vanish from the transcript after a retry, and the "retrying" row clears as soon as the retried run starts.
- **Add row works for number maps** such as `task.agentSoftRequestBudget`: the new row stays a draft until it has a key and a value instead of saving an empty value the setting rejects ([#20](https://github.com/nornzach/oh-my-pi-gui/issues/20)).
- A reply you stopped reads "Stopped" with Retry instead of a red "Request failed" card.
- Failed and interrupted tool steps are colored in the transcript and named for screen readers.
- Checklist items no longer show a bullet next to their checkbox; unlabeled code blocks no longer claim "plaintext" or show an empty header.

### Changed

- **Slow operations show their progress**: compaction, handoff, provider sign-in and a summarizing branch switch show an animated status with the elapsed time, a hint when the wait runs long, and Stop where it can be cancelled. A manual compaction or handoff gets a card in the chat with a progress track, and the title bar reads "Working" while it runs.
- **Opening a tab shows a proper loading screen** instead of a small spinner at the top of a blank page: an animated mark, what is happening, the elapsed time, and placeholder rows shaped like the conversation.
- Your message's time, copy, edit and fork buttons sit under the bubble and appear when you hover the message.
- Bundled agent built from monorepo `fbde92e4`: upstream main past v18.12.6 (no new upstream commits since 0.9.25) plus the fork's RPC queue fix above.

## [0.9.25] - 2026-10-23

### Fixed

- **The app no longer freezes when several agents stream at once**: the GUI now asks the agent for incremental streaming updates instead of a full copy of the reply so far on every token, and subagents report progress instead of every token they stream. Long or parallel streams could flood the app until commands timed out and the window stopped responding ([#19](https://github.com/nornzach/oh-my-pi-gui/issues/19)).
- **Background tabs no longer look stuck after you switch back**: a tab shown again resets its "waiting for the model" timer instead of counting thousands of seconds from before you left, and a tab whose run finished while it sat in the background settles within about 15 seconds instead of showing a live run forever.

### Changed

- While a tool call's arguments stream in, its card reads "tool call" until the agent names the tool.
- Bundled agent rebuilt from upstream main past v18.12.6 (monorepo `290010dc`): `/resume` cancels the previous session's background jobs; `/memory clear` no longer wipes other projects' memory; `grep` says when it trims matches; web `read` retries with another user agent on 403/429; a project-wide LSP rename no longer corrupts files edited outside omp; llama.cpp discovery also finds llama-server's new default port 9931; and `dd … of=/dev/null` no longer triggers the critical-command prompt.

## [0.9.24] - 2026-10-22

### Added

- **Ask and remember approvals**: a fourth approval mode. Permission prompts can remember a file or folder grant for this session or across sessions, shown as their own rows in the dialog; `/forget-approvals` clears remembered grants.
- **Live job widgets**: background jobs render a live card in the Jobs window — sparklines with reference lines, progress meters, stage text and stat blocks, driven by the agent's `widget` model role.
- Subagent task rows show the step the subagent reports working on plus a self-estimated completion percentage.
- **Collapsible providers in the model picker**: each provider is now a dropdown. The current model's provider opens with the picker, and providers you expand stay open across opens. While you search, every matching provider is open and can be collapsed for that query. A collapsed provider that holds the current model shows a check mark. — thanks [@jtmano](https://github.com/jtmano) ([#18](https://github.com/nornzach/oh-my-pi-gui/pull/18))

### Fixed

- **Blocking prompts raised in a background tab are no longer lost**: approvals, confirmations, host-tool calls and plan proposals emitted while a tab is parked now reach the app — previously the request was dropped in the main process and the agent waited forever on a dialog nobody saw. Blocking dialogs from any tab now surface globally; editor-text and title mutations still apply to their owning tab.
- **Dialogs can no longer hide under full-screen surfaces**: modal overlays (approvals, command palette, conversation search) now sit on a dedicated z tier above settings and PR-center windows — a confirmation could pop beneath an opaque page and look like it never appeared.
- A stale response can no longer be routed into a restarted sidecar that never asked for it.

### Changed

- Bundled agent rebuilt from upstream through **v18.12.6** (monorepo `566a0d96`): Esc no longer revives the agent when a background job completes; in-flight tool results survive compaction and session switches; `set_todos` persists across restore and compaction; MCP tools can no longer run twice after a reconnect; `/mcp reauth` works over RPC so a broken OAuth server can be repaired without restart; startup defers tool-only extensions so the composer accepts input sooner; killed and timed-out subagents can be revived by messaging them; mistyped slash commands no longer trigger similar ones; GitLab merge requests work with `/review` and `/annotate`; and `providers.cacheRetention` can extend the OpenAI prompt cache to 12 hours.

## [0.9.23] - 2026-10-19

### Added

- **Russian interface localization**: a third interface language joining English and 中文, chosen from an explicit language picker. Covers all renderer strings, settings schema labels, and native menus/tray; technical terms (MCP, model names, tool ids) stay English per `docs/localization/ru.md`. — thanks [@AG-albino](https://github.com/AG-albino) ([#16](https://github.com/nornzach/oh-my-pi-gui/pull/16))
- PR CI: a `localization` workflow now runs typecheck, the test suite, and a production build on every pull request. — thanks [@AG-albino](https://github.com/AG-albino) ([#16](https://github.com/nornzach/oh-my-pi-gui/pull/16))
- **Config warning banner**: problems in `settings.json` that the terminal app shows as a banner now surface in the app too, so a mistyped key or dead credential stops failing silently.
- **Drag files into the composer**: dropping files on the input area inserts them as `@`-mentions (paths with spaces are quoted).
- **Edit & resend from a message**: user message bubbles offer an edit action that puts the text back into the composer and forks the session from that point — the terminal's history-edit flow without leaving the window.
- **Command palette parity**: the palette now covers `/effort`, `/slow`, `/pin`, `/wt`, `/seance`, `/cleanse`, `/trace`, `/open`, `/ratchet`, `/modelpreset`, `/skillful`, `/extended-context` and `/record`, and adds missing MCP / marketplace / advisor / git subcommands. `/git` keeps the diff view and can also open the full terminal git UI; `/advisor configure` opens the shared configuration screen in a terminal overlay.
- **Window recording**: `/record` captures the window to a WebM video — the desktop counterpart of the terminal's session recording. A REC chip in the title bar stops and saves the take.
- **Usage reset credits**: the usage window can redeem banked provider resets — the `/usage` reset picker from the terminal.
- **Advisor badge**: a status eye next to the model chip shows when the advisor is watching (and when it has yielded), with live cost in the title bar.
- **Dedicated tool cards** for `checkpoint`, `rewind`, `context_notes`, `new_context`, `learn`, `manage_skill`, `security_scan` and `ida` replace the generic key/value dump.
- Extensions that open their own interactive screens now work in the app: they run in a terminal overlay instead of silently doing nothing.

### Changed

- Bundled agent rebuilt from upstream through **v18.12.2** (monorepo `72ca21f9`): paged file reads keep content at the spill threshold, resumed edits reject column-cut lines, native web reads keep collapsed sections, finalized reasoning survives providers that stream no deltas, and image/video chips render with proper emoji glyphs.
- The config-source disclosure under each setting now appears only when a project/launch/runtime layer actually overrides the value — "default" and "set globally" no longer repeat under every row.
- Chinese copy audit: agent terminology unified to 代理 across the interface, a mistranslated sidebar button ("New task" was "新对话"), full-width punctuation, and 96 unused locale keys removed.

### Fixed

- Stopping a window recording no longer hangs when the capture already ended, and a denied screen-recording permission explains where to enable it instead of showing a raw DOMException.
- `/wt` can create a worktree on the default branch with no arguments — previously the palette forced a branch prompt the terminal doesn't require.
- The `manage_skill` tool card no longer announces a created/updated/deleted skill while the operation is still running.
- Settings that can never take effect in the app no longer appear: Vim editing mode, Markdown read previews, stream server/redaction, and cleared-draft recall.

## [0.9.22] - 2026-10-17

### Added

- **Approve for this session**: when a tool call can be approved for the rest of the session, the approval dialog adds a button for it, so matching calls stop asking until you start a new session.
- The Jobs window shows subagent jobs nested under the task that runs them, like `/jobs` in the terminal, with a running count.
- `/seance <session id|path>` consults a saved session without resuming it, using the session's saved model unless you add `--model`.
- Chinese labels for the new **Auto Prewalk**, **Auto-prewalk target** and LSP **Request Timeout** settings.

### Changed

- Bundled agent rebuilt from upstream through **v18.11.3** (monorepo `8c0ef7e5`): three-way tool approval, automatic prewalk (`prewalk.auto`), a configurable LSP request timeout, and assorted fixes.

## [0.9.21] - 2026-10-15

### Added

- **Terminal in the side panel**: the ⌘J panel gains a **Terminal** view that opens a shell in the tab's folder (**+** opens more). Agent commands that wait for input (`pty: true`) open there with a hint, so you type the answer and the agent gets the result.
- **The agent works with your terminals**: ask about "the error in my terminal" and it reads what your shell shows; dev servers and watchers it starts run in their own terminal (robot icon) that you can watch or close, and it can stop them again.
- **Browser in the side panel**: a **Browser** view with an address bar (a URL, a local port like `localhost:5173`, a file path, or a search), back/forward/reload, several pages, DevTools and open-in-default-browser. The agent's `browser` tool opens and drives its pages there instead of a separate Chromium, so you can watch it work or take over; the panel switches to a page the agent opens in front, while pages it opens in the background leave your view alone. Sign-ins persist across restarts.
- **The agent can work on the page you have open**: ask it to "check this page" and it uses your page in the panel instead of opening a copy, then hands it back. Pages the agent is driving show an **Agent** badge.
- **Links open beside your work**: links in replies and tool output open in the Browser view; ⌘-click (Ctrl-click) opens them in your default browser.
- The side panel widens to fit the Browser view, and a dialog or menu over the panel shows a still of the page instead of being hidden behind it.
- **Browser keys work like a browser**: with a page focused, ⌘R reloads the page (not the app), ⌘L jumps to the address bar, ⌘[ / ⌘] go back and forward, and ⌥⌘I opens DevTools (Ctrl/Alt/F5/F12 equivalents elsewhere); app shortcuts such as ⌘J keep working.
- Web addresses a command prints in the Terminal view, like a dev server's `Local:` URL, are links that open in the Browser view.
- Notifications move beside the Browser view instead of appearing behind the page.
- **Find in page**: ⌘F (Edit → Find in Page…) searches the page the Browser view shows, with a match count; Enter / ⇧Enter or ⌘G / ⇧⌘G (F3 / ⇧F3) step through matches and Esc closes the bar. A web app with its own ⌘F, like an online editor, keeps it.
- **Pages rest when out of sight**: pages you are not looking at — in the background, with the side panel closed, or with the window minimized or covered — sleep like a browser's background tabs and stop using CPU. A page the agent is working in stays awake until it has been idle for 30 seconds, even with the window covered or minimized.
- Pages the agent works in behind the scenes get a desktop-size window (1280×800 at least), so a narrow side panel never hands it a phone layout.
- **Memory**: a window (sidebar, or ⌥⇧M) shows what omp remembers about a project. Turning it on reads the project's idle sessions with live progress; then write notes omp follows as standing instructions, keep or edit the lessons it captured, see which sessions it learned from (forget or restore any of them), update on demand, or erase the project's memory. A meter shows how much of it fits in each session.
- **Learned skills to review**: skills omp writes for itself are active straight away and wait in Memory → Skills with a count in the sidebar. Review each, see exactly what changed since you last looked, edit, switch off or remove it.
- **Search conversations** (⇧⌘F, sidebar or command palette): finds what you or omp said in any session — never tool output — answered per message with the matches highlighted, in this project or all of them. ↵ opens the session scrolled to that message and marks it; ⌘↵ opens it in a new tab. Recent searches are one keystroke away.
- **Live dictation**: words appear as you speak and land at the caret as each phrase ends, with the live-streaming Nemotron model, the local Whisper and Parakeet models, or a cloud dictation model. The first use shows the model download. Enter or **Done** finishes, Esc discards, and Send waits until dictation is over.

### Changed

- Bundled agent rebuilt from upstream through **v18.11.0** (monorepo `e3270da6`): session entries record which omp build wrote them, agent `structured: true` frontmatter, and assorted fixes. An auto-cleared todo list is now hidden rather than erased, and a tab can cancel or steer only the subagents it started itself.

### Fixed

- Signed builds could be denied the microphone for dictation; the app now carries the macOS microphone entitlement.
- In narrow windows the side panel drawer was see-through over the title bar, and its header buttons could drag the window instead of responding to clicks.

## [0.9.20] - 2026-10-12

### Changed

- Bundled agent rebuilt from upstream through **v18.10.1** (monorepo `c0b153d8`): codex gpt-6.1-sol default window raised to 500k, running agents and jobs merged into one status counter, model catalog refresh, and assorted fixes.

- **No more tab limit**: open as many tabs and windows as you like — the old 10-tab ceiling is gone, a restored session brings back every tab, and a restored tab only starts its process when you open it.
- **Background tabs speak up**: when a run finishes in a tab you are not looking at you get a short "“…” finished" notice, and a failure shows its error; desktop notifications follow the same completion/error settings as the visible tab. A tab retrying after a provider error shows an amber dot, a failed one a red dot until you open it.
- The tab strip keeps **⋯**, **+** and the chat/worktree buttons pinned at its end however many tabs are open, scrolls to the tab you switch to, takes the mouse wheel, and no longer shows a scrollbar.
- A run that retries after the same provider error shows one error card with the attempt count instead of a stack of identical cards.
- The model picker ends with **Add models or providers…**, which opens Providers.
- The queue chip above the composer lists only lanes that hold messages ("Steering 1", not "Queued 0 · Steering 1").
- **New look**: neutral graphite (dark) and white (light) default themes with one clear blue accent, the system font (SF Pro on macOS), and larger reading text — replies at 15px, interface text no smaller than 11px.
- Your messages appear as right-aligned bubbles; step summaries read as one line ("3 steps complete ›") with a slim guide when expanded; tables, code blocks and inline code are lighter and use sentence-case labels instead of all-caps headers.
- The composer is a single rounded surface with round controls and a round send/stop button.
- **Composer never wraps**: attach, full-screen editor (⌃G) and prompt history (⌃R) live behind one **+** button, the send/stop cluster keeps its place at every window width, and while a task runs Stop stands alone until you type a follow-up. In narrow windows the model picker keeps its name instead of collapsing to a bare arrow.
- The line under the composer pairs the context strategy with how full the context is ("6% of 128k"); the model is named once, in the picker.
- **Waiting and errors**: the wait for a reply is one quiet "Waiting for the model" line (elapsed time after 5s, a Stop button once it stalls) instead of a terminal-style Esc hint; provider retries show a countdown, the attempt and Stop; a failed reply is a clear error card with **Retry**. Retry and failure toasts now appear only for tabs you are not looking at.
- After a run that edited files, the conversation ends with "N files changed +x −y · Review", which opens those edits in the review panel.
- The title bar's usage figures are one quiet readout (tokens · cost · time, zeros left out) with the full breakdown on hover.
- The turn map sits beside the scrollbar, appears from three turns on, and steps aside in narrow windows; turns are evenly spaced.
- Sidebar, tabs and the Workspace panel are calmer: status shows as a small dot (finished past sessions show none), keyboard shortcuts appear on hover, and tabs are single-line pills.
- **Redesigned sidebar**: Code and Work switch with one click from a segmented control, **New task** leads the list, app-wide tools (capabilities, providers, usage, stats, shortcuts, feedback) open from a single **More** menu instead of pushing your tasks down, and every task shows how recently it was used. Project folders turn into a disclosure arrow on hover, and row actions take the place of the time only while you point at them.
- **Review toggle in the title bar** (top right, mirrors the sidebar toggle; ⌘J still works) shows how many files the checkout has changed and replaces the sidebar's "Open workspace" row.
- **Redesigned review panel**: it holds **Changes** and **Files** only, and Working tree refreshes itself when a run finishes. Changes has one menu for Working tree, Session edits, Edit history and Artifacts. Each changed file is a card with its status letter, name, folder and +/− counts; small change sets open fully, larger ones expand per file or all at once, headers stay pinned while you scroll a long diff, and unified/split applies everywhere.
- **Files** preview shows line numbers and offers copy path, @mention and open externally as compact buttons; search shows file name and folder separately.
- **Logs** moved out of the side panel into their own window (title bar **⋯** menu or the `logs` command). They read as time, level and message, with each record's extra fields folded into one dim line you can click to expand; level filters show their counts, and records are filed by their real level instead of by any "error" word inside them.
- Settings forms sit on a centered column so each switch stays beside its label; all switches share one size and glide when toggled.
- Motion is smoother: dialogs, menus and toasts settle in on a single long-deceleration curve, new turns rise gently into place, and live work labels ("Thinking", running steps) shimmer instead of flashing color.

### Fixed

- A long draft or an opening dock card no longer pushes the latest turn under the composer.
- A tab you open while it is retrying shows its retry countdown and attempt instead of "Waiting for the model".
- `/compact` on a session too small to compact says so as a notice and no longer puts `/compact` back in the composer as if the message were lost.
- Step summaries read "1 step complete", not "1 steps complete".
- The welcome screen no longer clips under the tab strip in windows around 720–820px tall, and an empty composer in a narrow split pane no longer shows a scrollbar.
- Working-tree diffs no longer show git's `index …` header line as part of the file.
- Working-tree diffs now load for projects opened through a symlinked folder (such as `/tmp` on macOS); every file used to fail with "File resolves outside this checkout".
- Slash-command completion accepts digits and `:` in the query, so `/p4` finds `skill:p4-case-rename` (and argument completion works for digit-named commands) instead of never opening.

## [0.9.19] - 2026-10-11

### Changed

- Bundled agent rebuilt from upstream through **v18.9.1** (monorepo `bfe63c0b`, ~1,100 commits since v18.8.6): configurable extra context files (`contextFiles.extra`, e.g. `AGENTS.local.md`), `retry.fallbackOn` to restrict model fallback to quota errors only or to non-quota errors, saved Codex/Claude rate-limit resets can be listed and redeemed (`omp usage reset`) with expiry warnings and background auto-redeem, structured async job metadata, and judge improvements including new OpenAI Decisions and Workers AI judges. Fixes that matter to the GUI include RPC sessions no longer keeping stale MCP tool lists after servers change, sessions no longer stuck busy when a retry-related session write fails, plugins installing from non-GitHub Git URLs, the first prompt keeping prompt-cache coverage while MCP servers start up, `grep` finding matches past the first 512 bytes of long lines, and snapcompaction no longer leaving too little context room.
- **Settings page**: complete Simplified Chinese coverage — every visible setting label, description, group title and enum option now renders in Chinese (about 200 strings added), including the settings introduced by this upstream range.
- **Settings page hides controls that only affect the terminal UI** and did nothing in the GUI: composer predictions, OSC 7501 program status, bare exit/bare slash commands, thinking-block expansion, subagent live preview, SVG figures and auto-graph tables.

## [0.9.18] - 2026-10-09

### Changed

- Bundled agent rebuilt from upstream through **v18.8.6** (monorepo `ba05fea6`, ~500 commits since v18.8.0): Claude Haiku 5.5 joins the smol tier, per-model compaction limits can be set from the model hub, sessions recorded inside a removed worktree reopen in the checkout that owns them, and resumed Claude sessions keep their thinking configuration and prompt cache.
- No GUI-side changes; this release carries the upstream agent update.

## [0.9.17] - 2026-10-08

### Added

- **Streaming `/btw` side questions**: the Side Question dialog streams the answer as it is written, keeps follow-ups in the same side conversation, and offers **Stop answer** while it runs. Answers are saved to the session's shared `/btw` history, so the terminal UI and the GUI see the same topics. Closing the dialog mid-answer stops it, so the next question is no longer rejected as "still running"; a turn that fails or is stopped before any text shows why instead of an endless spinner.
- **Context strategy row under the composer**: one line shows the running model, its window, the compaction strategy and the method that will really run for that model (for example "Kimi K3 256K 262.1k · Balanced · Image archive at 222.8k"). Click it to switch between Balanced, Preserve detail and the experimental Notes-backed mode, tune the compaction threshold and how much recent history is kept verbatim, and toggle automatic compaction and larger-model promotion. A quiet dot recommends Preserve detail for models without server-side compaction, whose defaults would otherwise archive history as images and truncate old tool output.

### Changed

- Bundled agent rebuilt from upstream through **v18.8.0** (monorepo `97990a6c`, merge `185562f4`): upstream's `/btw` history and streaming protocol (`btw_delta`/`btw_record`, `get_btw_history`, `btw_cancel`), per-credential logout (`get_logout_accounts`), and the native addon now embedded in memory at compile time. Upstream published the 18.8.0 natives for every platform, so no target compiles natives from source this release.
- **Sign out** in Providers follows upstream's per-credential logout: it lists the provider's stored accounts and removes each, so the row's meaning ("log out of this provider") is unchanged.
- Calmer motion throughout: transcript turns, tool cards, panels and empty states appear in place instead of sliding or cascading in; dialogs, menus and toasts use short fades without bounce or backdrop blur; hover and press change color only.
- Streaming replies render formatted as they arrive — bold, inline code, lists, tables and code blocks take their final shape immediately instead of flashing raw Markdown and reflowing when each paragraph completes. The caret is a thin, softly blinking bar at the end of the live line.
- The sidebar keeps Commands, Agent Hub, PR Center and Workspace in view and folds the app-wide tools under **More**; Settings moved to the sidebar footer and opens on the GUI preferences page.
- The composer keeps model, thinking, approval and modes inline at narrower widths (labels collapse to icons first), so opening the workspace panel no longer hides them behind "…".
- Command Center rows show an icon for their category instead of the same slash on every row.
- New tabs show their start screen while the agent starts, instead of a spinner on a blank page; tabs resuming a session still wait for its history.
- The conversation column is narrower (about 110 characters of prose per line) and the composer aligns with it; a prompt's copy/branch actions float on its edge on hover instead of reserving empty space under every message.
- The title bar hides usage figures until a session has spent something, and gives the session title priority in narrow windows.
- The Modes menu describes each mode in one line; Agent Hub's model override and prewalk read as clickable fields.
- Settings: switches are legible in both themes, the per-row "Reading the existing Agent setting" note is gone (the section intro explains it), the paste threshold is a compact field, and the capabilities page no longer leaves a gap beside Quick actions.

### Fixed

- Text fields drew a second focus ring inside their focused border: global focus and transition styles now sit below Tailwind utilities in the cascade.
- The title bar showed "New session" after the first prompt while the tab and sidebar already showed the conversation title.
- Long tab titles no longer scroll on hover; the full title is in the tab tooltip.
- PR Center no longer repeats its title inside its own header, and the Diff panel's empty states use the panel's text size.
- Providers no longer shows a red "model lists could not be refreshed" warning on a fresh install; refresh problems are reported, in amber, only for providers you signed in to or configured.
- The selected session in the sidebar is a filled row instead of an outlined box that looked like a focus ring.
- **Session tree dialog crashed on long sessions** (`Maximum call stack size exceeded`): the tidy-tree layout recursed once per message depth and computed each node's depth with an O(n²) walk-up, so opening the tree on a tens-of-thousands-entry session overflowed the call stack and froze the renderer. Both the depth pass and the layout walk are now linear iterative passes. Same fix applied to the subagent DAG layout the code was ported from.
- **Branch into conversation** from `/btw` inserted the provider's raw reply (duplicate text parts, redacted reasoning) instead of the answer shown in the dialog, and an answer that arrived after being stopped could still be branched. It now branches exactly the visible answer, and only from a completed turn.

## [0.9.16] - 2026-10-06

### Added

- **Windows release CI** (`.github/workflows/release-windows.yml`): builds the NSIS installer, portable exe, and `latest.yml` on `windows-latest` at release publish — dispatchable for existing tags — smoke-tests the sidecar, verifies the PE architecture, guards the locale-pak set (issue #12 regression guard), and launches the packaged GUI to fail on a dying renderer. — thanks [@mwyborski](https://github.com/mwyborski) ([#14](https://github.com/nornzach/oh-my-pi-gui/pull/14))
- **Session model recovery.** Upstream now refuses to resume a session on a different model when its saved model is gone (provider removed, signed out, model retired). Opening such a session from the sidebar, ⌘P picker, or a deep link shows a dialog naming the missing model and offering to reopen it bound to your current model, instead of a dead-end error. A sidecar restart onto such a session — which upstream now aborts at boot — respawns once on your default model (`--model @default`) with a warning toast, instead of crash-looping the tab.
- **Live voice transcript history**: the Live Voice dialog keeps a scrolling transcript of the call (incremental turns shown dimmed until final) and shows the active voice, instead of only the latest line.

### Changed

- Bundled agent rebuilt from upstream `main` through v18.6.2 (monorepo `ca3a7196`, merge `f8bcc259` + a build-tooling commit): RPC `open_session`/`switch_session` accept an explicit `provider`/`modelId`, resumed sessions fail closed on an unavailable model, `/thinking` level picker, attachment-only session titles, `models.yml` `compat.statefulResponses`, and Windows bash cancellation fixes.
- Live voice now speaks upstream's wire protocol (`live_phase`/`live_levels`/`live_transcript`/`live_end` frames, `live_mute`); the fork's `live_update` snapshots, `live_toggle_mute`, and `get_live_state` are retired. Cancelling while connecting ends the call without an error toast.
- `build:omp` recognizes the natives addon's post-link version stamp through the loader's own `version-sentinel.js`, so a locally built or newly stamped addon is no longer mistaken for a stale one.
- Windows and Linux release CI no longer depend on upstream publishing the `@oh-my-pi/pi-natives-*` npm leaf: when the pinned version is absent, the runner compiles the addon from `crates/pi-natives` (both x64 ISA variants) before building the sidecar.

## [0.9.15] - 2026-10-02

### Changed

- Bundled agent rebuilt from upstream `main` at monorepo merge `a859518c`: RPC user input now flows through a single ordered pipeline (`dispatchOrderedUserInput`) that hooks extension `input` handlers, skills, and built-in slash commands before admission; a new `goal` command and goal-mode state land in `get_state`; `fork` accepts an optional `entryId` and refuses while the session is busy; session-change commands (new/switch/drop/branch/fork) quiesce pending goal continuations before switching.

### Fixed

- **Blank window on Windows (issue #12)**: `electronLanguages: [en]` in the electron-builder configs matched none of Electron's `locales/*.pak` basenames (`en-US.pak`, not `en.pak`), so the build stripped **every** Chromium locale file. Chromium hard-requires `locales/en-US.pak` and aborts the renderer without it — the window drew for an instant, then stayed black. Removed `electronLanguages` from all three configs, so packages ship Electron's stock locale set again (verified: the shipped v0.9.14 payloads have an empty `locales/`; the same binaries run with paks restored). — thanks [@mwyborski](https://github.com/mwyborski) ([#13](https://github.com/nornzach/oh-my-pi-gui/pull/13))
- `bun run build` failed after `electron-vite build` on Windows: `check-main-bundle.ts` resolved its bundle with `URL.pathname`, which keeps a leading slash (`/E:/…`) on Windows. Now uses `fileURLToPath`. — thanks [@mwyborski](https://github.com/mwyborski) ([#13](https://github.com/nornzach/oh-my-pi-gui/pull/13))

## [0.9.14] - 2026-10-01

### Added

- **Feedback dialog** reachable from the sidebar, the Help menu, the command palette, and the crash page — collects a detailed report and opens a prefilled GitHub issue in the browser. No token is embedded; sign-in happens on github.com. Optional environment info and the recent-error log tail are previewable before anything leaves the app.

### Fixed

- **Black screen on Windows** (and any GPU crash): a dead GPU process now relaunches the app with software rendering, and a renderer that crashes past the reload cooldown offers a native restart dialog instead of a black window. `--disable-gpu` / `--enable-gpu` force the mode. (issue #12)

### Changed

- Bundled agent rebuilt from upstream `main` (monorepo merges `ae326c53`, `5abd0e9f`), adding queued-message promote/remove commands, `predict_word` completion, `cancel_subagent`/`steer_subagent`, native Windows clipboard paste, and session-file ownership fixes; RPC `prompt` responses now acknowledge at admission.
- The GUI opts into upstream's `set_ask_dialog` protocol so extension ask dialogs keep working under the new wire contract.

## [0.9.13] - 2026-10-01

### Changed

- Bundled agent rebuilt from upstream `main` (monorepo merge `4e3ed70b`), adding Factory Droid login and fixing role fallback chains and queued prompts during rewind.
- The stats dashboard's Behavior page is now **Frustration**, matching the redesigned stats API: annoyed / at-the-assistant / angry rates overall and per model version.

### Fixed

- Stats **Sync** no longer fails with `405 Method Not Allowed`, and its toast now reports the finished sync's real message and file counts instead of an instant "0 messages".
- The Providers page shows the subscription-window table again.

## [0.9.12] - 2026-09-30

### Changed

- Bundled agent rebuilt from upstream `main` beyond omp 18.4.4 (monorepo merge `a8ee6852`), adding model presets, live queue-update events, delta message updates for RPC hosts, and cache-warming controls.

### Fixed

- Large conversations now restore correctly when switching tabs.

## [0.9.11] - 2026-09-30

### Added

- Native capability panels expose model roles, extensions, MCP, SSH, security, and session controls.

### Changed

- Bundled agent upgraded to omp 18.4.4.
- Background sessions remain active until the agent reports that all work has settled.
- Platform download links now resolve explicitly to the matching macOS or Windows build.

### Fixed

- Large session transcripts now restore through bounded pages instead of overflowing the RPC response.
- Bundled macOS sidecars are executable-signed for reliable app packaging.

## [0.9.10] - 2026-09-24

### Added

- **Windows x64 packaging**: download an NSIS installer or portable executable with the bundled `omp/18.3.0` sidecar.

### Changed

- **Cross-platform sidecar startup**: Windows resolves `omp.exe`, keeps the inherited tool environment, hides sidecar consoles, and registers the `omp://` protocol in installed builds.
- **Windows release metadata**: NSIS update metadata and blockmaps are generated alongside the installer and portable artifact.

### Fixed

- **Cross-platform icon generation**: Windows `.ico` output no longer requires macOS `iconutil`; macOS `.icns` generation remains unchanged.

## [0.9.9] - 2026-09-24

### Added

- **Coordination tool views**: `wait`, `read proc://…`, `write agent://…`, and process control writes now render as compact, structured cards instead of generic text or file operations.

### Changed

- **Bundled agent upgraded to omp 18.3.0**, including background-job coordination, wait/protocol support, explicit process cancellation, and Apple Foundation Models discovery on supported Apple Silicon systems.
- **Execution details stay bounded**: coordination cards summarize status and expose focused scrollable details without taking over the transcript.

### Fixed

- **Upstream protocol parity**: GUI tool dispatch now recognizes the current `wait` and internal `proc://`/`agent://` protocols while retaining legacy `hub` transcript rendering.

## [0.9.8] - 2026-09-22

### Added

- **Bilingual feature tour**: refreshed English and Chinese documentation includes 24 matching-language screenshots captured with isolated, synthetic demo data.

### Changed

- **Bundled agent upgraded to omp 18.2.8** with expanded browser automation, buffered cloud transcription, faster credential scanning, and more reliable aborted LSP requests.
- **Smoother interactions**: streaming Markdown, common dialogs, popovers, hover feedback, and panel entrances stay visually stable as content updates.

### Fixed

- **Model and provider refresh**: switching models, signing in or out, and adding, editing, or removing custom providers update the originating session's model and account views without stale responses undoing newer state.
- **Live accounting**: context, cost, and cache values refresh during runs; measured context usage remains visible when model capacity is unknown.
- **Conversation follow**: new output follows the viewport at the bottom without pulling readers out of scrollback, and jump-to-latest reliably resumes following.
- **Settings and dialogs**: IME-safe keyboard handling, layered Escape behavior, focus recovery, confirmation dialogs, and scrollable layouts make controls more predictable.
- **Packaged startup and recovery**: bundled configuration dependencies are available at launch, custom-provider writes are atomic, and off-screen saved windows recover to usable bounds.
- **Statistics resilience**: unexpected list responses no longer crash the statistics view.

## [0.9.7] - 2026-09-21

### Added

- **Bundled agent upgraded to omp 18.2.7**: semantic `find` search, `^model` delegation, configurable specialist model roles, batch evaluation/judgment, and `omp stream` livestreaming in the bundled Core.
- **Model Roles window** now lists backend-filtered eligible models grouped by kind, split into chat and specialized sections, and hides roles the backend marks hidden.
- **Delegation chips**: models tagged with `^` in a message render as chips on your message in the transcript.
- **Chinese labels** for all Core settings and options newly added upstream (find, generation rate, stream, judgment, title spinner, spelling, and more).

### Changed

- The `/drop` session command is now `/delete` in the command menu (the `drop` alias still works).

### Fixed

- **Stats dashboard** no longer shows a dead-end "stats unavailable" error while the bundled stats server finishes its first-time re-index after an upgrade; it now stays in a loading state and recovers on its own.

## [0.9.6] - 2026-09-14

### Changed

- **Bundled agent upgraded to omp 18.1.20** with the latest upstream provider, collaboration, speculative execution, and tool interaction updates.

### Fixed

- **Model switching**: slow switches have more time to finish, and connection failures display an error.
- **Quota display**: Kimi and other providers with unspecified quota units show the known usage percentage instead of an internal `unknown` label.
- **Math rendering**: TeX formulas render correctly in replies and restored history, stay together while streaming, and scroll within narrow windows.

## [0.9.5] - 2026-09-07

### Fixed

- **History restoration**: reloading a restored task shows its transcript even when task metadata arrives before the ready event.
- **Preference reliability**: slow startup reads cannot undo a chosen theme or font; failed proxy and launch-profile saves preserve edits and never trigger a premature restart.
- **Concurrent task updates**: completed subtasks and live goal state survive delayed refreshes, and retired tasks cannot send commands to their replacements.
- **Settings navigation**: search results for proxy and launch parameters open Advanced; concurrent workspace profile edits preserve each other.
- **Desktop navigation**: workspace links cannot replace the application with an untrusted document.
- **Rule editing**: empty Bash approval and interception rules use an object editor; terminal-only spelling controls are hidden and new Core settings have Chinese labels.

- **Task isolation**: delayed replies, queued input, modes and collaboration updates stay with the task that requested them.
- **Reliable input**: running tasks retain send and stop controls; uncertain delivery preserves the draft and prevents accidental duplicate submission.
- **Settings and dialogs**: eight searchable settings groups remain accessible at narrow widths, with consistent focus and truthful security states.
- **Session actions**: sharing previews match uploads; imports and handoff retries avoid duplicates; file changes distinguish repository state from edit history and virtual output.
- **Statistics**: request history supports stable pagination, and usage separates current context from the complete session journal.
- **Desktop boundaries**: typed sharing, voice and side questions retain their preview or start step; unavailable context limits show as unknown, and statistics connect only to the bundled service.
- **Startup and recovery**: delayed setup checks no longer cover an open dialog, and restarting the core preserves unsent drafts even when its session identity changes.
- **Notifications**: transient notifications stay clear of the composer's send and stop controls.

- **Formatted write previews**: overwrite diffs match the final file after automatic formatting.
- **Extension choices**: selection dialogs display option descriptions while returning the original choice to the agent.
- **Continuous conversation rendering**: replies, steering, and follow-ups keep their content and order when multiple lifecycle events arrive together.
- **Context maintenance**: automatic compaction refreshes history without clearing resumed work, and long context summaries open on demand.
- **Transcript continuity**: switching tasks restores the reading position and expanded process groups; earlier errors remain available in history.
- **Appearance controls**: GUI fonts scale transcript text consistently, density no longer zooms the page, and terminal palettes apply only when explicitly enabled without leaking across tasks.

### Changed

- **Redesigned GUI themes**: eleven coordinated palettes with clearer text, quieter surfaces, and matching transcript and terminal colors.

- **Bundled agent upgraded to omp 18.1.13**: includes Muse Code subscription support, memory scope isolation, corrected Astra context windows, and more reliable tool calls and retries.
- **Retry and shell settings**: GUI settings include waiting for quota resets and per-command approval of simple `&&` chains; long retry waits show a scheduled time and keep notifications brief.
- **GUI settings**: theme, density, and accessible colors use application preferences; terminal-only display options are hidden, and proxy and launch configuration live under Advanced.

## [0.9.4] - 2026-09-04

### Added

- **Bash terminal images**: Kitty and Sixel graphics returned by the bundled agent render alongside command output, including multiple images.
- **Richer model and session details**: the model picker shows catalog names, descriptions, release badges, intelligence, and speed, while session info shows routed models and credit usage.

### Changed

- **Clone-first worktrees**: worktree tabs now honor omp's configured copy-on-write backend and fall back to a normal checkout when cloning is unavailable.
- **Current omp settings**: Settings includes Chinese labels for the new provider, reaction, skill, eval, image-question, and isolation controls.
- **Bundled agent upgraded to omp 18.1.10**: packaged sidecars include current Codex V2 metadata and cache handling, disabled-reasoning preservation, Plan Review mouse input, and subagent yield updates from monorepo commit `36732cf5ed`.

### Fixed

- **Agent reactions**: opening reaction emoji render as a badge on the preceding user message instead of ordinary assistant prose.
- **Eval image output**: images returned by eval-backed browser, computer, JavaScript, and Python runs render alongside their text output.

### Removed

- **Obsolete vision controls**: removed the retired `/vision` menu and legacy `inspect_image` settings after omp moved image questions to `read <image>?q=<question>`.

## [0.9.3] - 2026-09-01

### Added

- **Sharpshooter memory controls**: Settings now exposes the model, consolidation interval, and context injection limit for project decision memory.

### Changed

- **Clearer session navigation**: workspace folders, chat icons, nested task alignment, and stronger active states make the sidebar hierarchy easier to scan.
- **Bundled agent upgraded to omp 18.0.11**: packaged sidecars include the latest provider compatibility, model discovery, Anthropic context management, and z.ai OAuth fixes from monorepo commit `6655097656`.

### Fixed

- **Work conversation settlement**: streamed turns stay visible until the persisted transcript replaces them by entry ID, preventing replies from disappearing or rendering twice.
- **Immediate prompt feedback**: user prompts render locally before a slow RPC settles and hand off to the persisted transcript exactly once.
- **Workspace creation intent**: choosing a workspace from New task always opens an agent task instead of occasionally creating a chat.
- **Modal Escape handling**: Escape closes the topmost dialog after IME composition ends instead of being ignored by stale key-code state.
- **Theme overlays**: session theme accents are reapplied consistently after changing or restoring the global theme.

## [0.9.2] - 2026-08-27

### Added

- **Two-session split view**: drag a tab onto the workspace or use its context menu to run two isolated sessions side by side or stacked, with a resizable, keyboard-accessible divider and restored layout.

### Changed

- **Bundled agent upgraded to omp 18.0.6**: packaged sidecars now include current provider, browser, task, streaming, TUI, and runtime fixes from monorepo commit `ef0bd7d84a`.

### Fixed

- **Completed-turn reconciliation**: a reply that finalizes while streaming now remains one conversation turn instead of appearing twice.
- **Provider configuration cancellation**: cancelling an edit exits the provider configuration flow instead of repeatedly reopening it.
- **Recovered conversation errors**: reactivating a conversation keeps partial output but removes stale interruption and network error boxes from older turns.
- **Todo transcript progress**: status updates replace the existing Todo history row instead of stacking one row per progress step.

## [0.9.1] - 2026-08-23

### Added

- **Branch to a new tab**: user and assistant message footers can copy the conversation through that exact turn into an independent session and open it in the current window without changing the source session.
- **Plan save-only review**: plan approval suggests a topic filename, saves the reviewed Markdown, exits plan mode, and reports when a fresh session is cancelled or fails instead of claiming success.
- **Context cleanup and image publishing controls**: `/shake thinking` removes reasoning history, while Settings exposes usable nested JSON configuration for the complete image URL broker with masked credentials.
- **Native writing assistance**: the composer and expanded editor enable platform spelling, autocorrect, sentence capitalization, and native replacement suggestions.
- **Shared session pins**: pinning a GUI session keeps the bundled agent's pinned-session list in sync without losing concurrent updates from other windows or the CLI.
- **Model benchmark**: run the bundled omp TTFT, prefill, and decode benchmark from a native GUI results table.

### Changed

- **Bundled agent upgraded to omp 18.0.0**: packaged sidecars now include the current upstream runtime plus RPC plan-save, thinking-only context shake, entry-id branching, and race-safe shared session pins from monorepo commit `d9e6bdaa2d`.

### Fixed

- **Independent conversation navigation**: expanding task or agent docks no longer compresses the left-side turn navigator or extends it behind the composer.

## [0.9.0] - 2026-08-22

### Changed

- **Bundled agent upgraded**: packaged sidecars now carry omp 17.4.0 plus the marketplace RPC features from monorepo commit `a7b2784898` — plugin metadata/themes on the catalog, and post-mutation activation verdicts computed from the installed-plugin runtime snapshot.
- **Assisted updates for unsigned macOS builds**: ad-hoc-signed apps now download the architecture-matched DMG, show progress, verify its release-metadata SHA-512, open it in Finder, and explain the safe manual replacement flow. Certificate-signed builds retain Squirrel's restart-and-install path ([#3](https://github.com/nornzach/oh-my-pi-gui/issues/3)).

### Added

- **Plugin marketplace**: browse plugins with author/license/category/tags metadata and clickable repository/homepage links; installs ask for confirmation before granting local execution rights, and executable plugin changes restart their originating tab when idle (or after the running turn) before refreshing state.
- **Declarative plugin themes**: plugins can ship a `gui.theme` token map; tokens are validated against the transcript palette and layered over the active theme, with the agent theme winning conflicts.

### Fixed

- **Manual compaction RPC**: submitting `/compact` now uses the long-running compaction channel instead of falsely failing after the prompt RPC's 8-second timeout while compaction continues.
- **Cold-start theme flash**: a pre-paint script applies the saved color scheme before first render — dark-theme users no longer see a white flash on launch.
- **IME-safe abort**: Escape during CJK candidate composition dismisses the IME instead of aborting the running turn.
- **Session stats staleness**: switching sessions clears the previous session's token/cost readout immediately, and a late response from the old session can no longer repaint it.
- **External-link scheme guard**: links opening a new window only launch http(s) URLs, blocking arbitrary protocol handlers from renderer surfaces.
- **Sidebar performance**: collapsed workspace groups no longer build their session rows into the DOM on every background refresh.

## [0.8.4] - 2026-08-21

### Changed

- **Bundled agent upgraded to omp 17.4.0**: packaged sidecars now include the latest upstream context-maintenance, provider, tool, and runtime fixes from monorepo commit `8a4f72647a`.
- **Context-maintenance parity**: settings now expose current compaction ordering, asynchronous compaction, extended-context, and eval background options, while transcript summaries show the selected method and before/after token counts.

### Fixed

- **Session and extension recovery**: aborting an active retry clears its pending UI and server retry state, and fire-and-forget extension UI updates no longer retain stale tab ownership.
- **macOS first-launch override**: release bundles are now completely ad-hoc signed, preserving Gatekeeper's user-override flow instead of being rejected as a corrupted bundle when no Developer ID certificate is available ([#2](https://github.com/nornzach/oh-my-pi-gui/pull/2) by [@Brandon168](https://github.com/Brandon168)).

## [0.8.3] - 2026-08-20

### Changed

- **Bundled agent upgraded to omp 17.3.8**: packaged sidecars now include Qwen reasoning-effort fallback handling, catalog routing fixes, compaction boundary hardening, MCP OAuth reauthentication discovery, model and provider refreshes, and updated usage aggregation from monorepo commit `943bb49462`.
- **Code / Work navigation**: the sidebar now switches between project-bound Code sessions and a full-agent Work lane backed by a GUI-managed default workspace; the main sidebar action creates an Agent, its adjacent quick-chat action creates a tool-free Chat, and saved Chats remain visible in their global sidebar section. Chat creation also remains available from the tab strip, shortcuts, command palette, and native menu.
- **Unified session search entry**: the sidebar header now opens the existing global session picker with metadata, fuzzy, project-path, recency, and full-transcript matching instead of maintaining a weaker duplicate inline filter.
- **In-app file preview**: local file links in rendered responses now open the Files drawer; Markdown renders as formatted content, while SQL and other text files use the code view with external-open and @mention actions retained.
- **Live session metrics**: the title bar now shows total tokens, cost, cache-hit rate, and actual execution time for the active session, while management actions move into the collapsible sidebar navigation.
- **Context usage meter**: the composer shows live used/available tokens and the popover adds an accessible progress bar plus explicit used and remaining totals.
- **Opt-in provider discovery**: new custom providers no longer fetch `/v1/models` automatically; model discovery is an explicit choice, preventing a single manually configured model from expanding into hundreds of upstream entries.
- **Simplified settings navigation**: removed the decorative workspace/logo header so settings navigation starts directly with its useful sections.

### Fixed

- **Wide click targets**: press feedback no longer scales full-row buttons away from the pointer, so execution summaries, task/agent disclosures, and other wide menu rows reliably receive their click at either edge.
- **Workspace dock disclosures**: task and multi-agent card headers now collapse from the full row or right chevron even after entering focused "view all" mode; the separate back action remains available for returning to the summary without collapsing.
- **Workspace drawer resizing**: the right-side divider now measures from the window edge instead of recursively shrinking against the drawer's own width, so dragging left grows it and dragging right reduces it without snapping closed.
- **Stable execution disclosures**: reasoning/tool summaries now stay exactly where the user leaves them across live status updates, virtualization, and live-to-final row replacement instead of auto-opening and auto-closing during a run.
- **Extension status output**: transient extension status pills no longer float over composer controls; extension widget text still uses the shared terminal-output renderer instead of exposing raw escape codes.
- **Model pricing input**: zero, leading-zero decimals, and arbitrary fractional prices such as `0.014` remain editable instead of being erased or rewritten mid-entry.
- **Transcript action placement**: user-message timestamps and copy actions render below the bubble instead of escaping into the right side of wide layouts.

## [0.8.2] - 2026-08-18

### Changed

- **Bundled agent upgraded to omp 17.3.7**: packaged sidecars now include brokered extension file-write/delete fallbacks, restored configurable stats-dashboard binding, refreshed GPT context/pricing data, paid xAI/SuperGrok defaults for Grok 4.6, and the corrected xAI chat User-Agent from monorepo commit `e9e2fa8b10`.
- **Frame-paced streaming presentation**: live replies now coalesce IPC bursts onto browser frames, promote complete Markdown paragraphs/code/math into parse-once blocks, keep only the unfinished suffix lightweight, and reveal new text with a subtle fade plus a smooth breathing caret instead of 200ms chunk jumps. Agent-event delivery now runs at a stable ~30 Hz, while finalized content and manual scroll positions remain unchanged.
- **Responsive composer controls**: thinking level, fast mode, approval mode, and session modes now stay expanded across the toolbar whenever its measured width can hold them; only narrow composers fall back to the compact overflow menu, including live transitions when sidebars or the window resize.
- **Compact composer placement**: removed the redundant keyboard-shortcut caption below the composer and tightened its outer spacing so the input sits closer to the window footer.
- **Simplified window chrome**: removed the redundant bottom status strip and moved the keyboard-shortcuts entry into the top toolbar, giving the transcript and composer the full window height.

### Fixed

- **Tool-card path links**: clicking a path whose file no longer exists now surfaces an error toast instead of failing silently (`openPath`/reveal both no-op on missing paths).
- **Bash trailer stripping**: the wall-time notice is removed wherever it sits (the agent appends it before intermediate notices like timeout-clamp and pty fallback) instead of leaking into the output block when it is not the final line.
- **Escape-sequence gate**: output carrying only OSC escapes (window titles, hyperlinks) is parsed and stripped now too, instead of printing raw `\x1b]…` bytes.
- **Undefined theme tokens**: the conversation-navigator focus ring referenced `--omp-focus-ring` and the security finding detail referenced `--omp-shadow` — neither token exists; both now map to defined tokens (`--omp-accent`, `--omp-shadow-md`).
- **Sidebar interactions**: the dragged sidebar width persists across sessions; clicking elsewhere or pressing Escape cancels a pending inline delete confirm; Escape clears the search box; session status dots carry translated tooltips (previously raw English status strings).

## [0.8.1] - 2026-08-16

### Changed

- **Bundled agent upgraded to omp 17.3.5**: the packaged sidecars now use the native PDF backend, updated provider/model catalog, one-shot retry hardening, stale Agent Hub activity signals, and extension-handler timeout settings from monorepo commit `0107a9eb22`.
- **Native macOS menu-bar mark**: the generic colored status dot is replaced by a crisp Retina π template icon that automatically follows light, dark and selected menu-bar states.
- **Recent-first navigation**: sidebar sessions and workspace groups now move dynamically by last use, persist that MRU order across restarts and package updates, retain pinned-first priority, and preserve relevance ordering while searching.
- **Quieter execution history**: each reasoning/tool run now folds into one lightweight inline activity summary instead of a stack of nested cards and scroll boxes; active work opens for progress, then both successful and failed runs collapse to an outcome summary with full details available on demand.

### Fixed

- **OMP 17.3.5 GUI parity**: PDF page screenshots returned by the upgraded native `read` tool now render inline, stale Agent Hub registrations are labeled as having no active turn and remain cancellable, and the new extension-handler timeout setting is localized instead of silently degrading to raw schema text.
- **omp 17.3.5 sidecar builds**: the GUI packager now follows upstream's native PDF implementation and no longer calls the removed MuPDF generation/reset scripts, so upstream syncs can rebuild the bundled agent instead of failing before compilation.
- **Live provider catalog**: login, logout, and custom provider/model add, edit, or delete operations now invalidate and refresh every provider/model selector; slow discovery finishes update the GUI automatically, upstream failures are shown in Providers, explicit refresh bypasses the cache, settings dropdowns no longer retain process-lifetime option caches, and custom OpenAI or Anthropic Messages providers can populate models directly from `/v1/models` without a manual model row.
- **Clean, consistent tabs**: the disposable empty startup chat now disappears after a real tab opens (including layouts saved by older builds), while drafts and genuine sessions remain protected; restored tabs carry their transcript path before delayed session metadata arrives, so labels reliably use the same renamed-title/first-message fallback as the sidebar and truncate long text with the full title available on hover.
- **Persistent tab workspace**: the open top-tab order and active session now survive app restarts and package replacement; stale workspaces are discarded and missing transcripts fall back safely instead of reopening a random project.
- **Single waiting indicator**: model-response, retry, and compaction waiting rows now show one loading animation instead of duplicating it in the transcript timeline.
- **Single execution indicator**: each active turn or execution phase now owns at most one loading animation; timeline groups, expanded tools, read previews, todo rows, PR checks, the title bar, and the active tab use static status dots instead of stacking duplicate spinners and pulses.
- **Thinking level selection**: nested effort options now dispatch before the parent runtime-settings menu dismisses them, and explicit picker/cycle changes synchronize both the configured selector and effective effort from the authoritative RPC receipt instead of leaving stale state behind.
- **Fresh local packages**: every packaging command now rebuilds the Electron app first instead of silently reusing an old `out/` directory.
- **Default startup tab**: untargeted launches and new windows now open a fresh, unnamed global chat without inheriting a random recent workspace or auto-resuming its session; the chat's internal process cwd is no longer presented as a selected workspace.
- **Streaming transcript reading position**: any manual scroll-up releases tail following immediately; live-row growth no longer competes with native browser anchoring, and finalizing a streamed response preserves the virtual row identity instead of snapping an unpinned reader to the bottom.

## [0.8.0] - 2026-08-14

### Changed

- **Felt-quality visual language** (plan 22): one accent family — dark mode is the night version of the light theme instead of a separate cobalt-blue product; surfaces get a clear hierarchy (warm paper canvas, sidebar one step darker, user bubbles with a visible hairline border, code blocks that read as inset rather than page); card borders strengthened; hover/press states change only color and alpha with shared motion tokens (`--omp-motion-fast` / `--omp-motion-med`), now lint-enforced so layout never shifts on interaction.
- **Session switching feels like turning a page**: the outgoing transcript stays on screen until the new session's transcript is ready — no blank flash; sidecar events arriving mid-switch are dropped instead of appending onto the outgoing transcript; hydrated transcripts patch in place when delivery identities match, eliminating the second paint after tab restore.
- **Conversation navigator**: a stack of anchor buttons (timestamp + preview) along the transcript lets you jump between turns in long sessions; it compacts beyond 32 anchors and collapses into a dense rail beyond 64.
- **Execution groups**: completed reasoning/tool phases collapse to a single-line disclosure, while live and failed work auto-opens so current progress and actionable errors are never hidden.
- **Goal control strip**: a compact persistent bar in the dock carries the session's active goal and its controls.
- **Context usage popover**: the token/context readout moved out of the title bar and status footer into a popover anchored to the composer (accent-dot indicator on its button); the status footer's minimal mode is now path-only.
- **Markdown**: user-authored prompts no longer parse single-dollar inline math, so SQL/JSONPath expressions like `$.field` stay literal; display math (`$$…$$`) still renders.
- **Settings schema labels**: updated for omp 17.3.x — per-agent advisor (`task.agentAdvisor`) label added, stale `advisor.subagents` label removed.
- **Sidebar rows**: session and workspace titles no longer compress into scrolling labels on hover; full-row titles stay readable with overflow-aware action buttons.
- **Bundled agent**: the sidecar is rebuilt from the monorepo fork tracking upstream omp 17.3.3.

### Fixed

- Session-switch races: events could append onto the outgoing transcript while the new one hydrates, and tab restore could repaint the entire transcript a second time.
- Model thinking display: reasoning level and context usage no longer duplicate across the title bar, status footer, and composer surfaces.

## [0.7.5] - 2026-08-13

### Changed

- **Agent and chat navigation**: chat history now lives in a dedicated global section instead of appearing under workspace projects; workspace groups, counts, delete operations, and “new here” actions are agent-only, while saved chats preserve their chat kind when opened in a tab.
- **Large execution-dock summaries**: Todo and Agents share one scroll owner, summarize large collections into bounded previews, preserve actionable and urgent rows, and expand one card into a focused full-list view without squeezing the composer behind nested scrollbars.
- **Codex-style sidebar tasks**: workspace and session titles use the full row until hover compresses them into overflow-aware scrolling labels beside their action buttons, workspace rows reveal a one-click new-agent button on hover, session clicks open in tabs by default, and idle background tasks can be renamed or deleted while other tabs continue running.
- **Secondary text hierarchy**: session-list titles now use smaller, quieter typography, expanded reasoning content renders smaller, dimmer, and without bold emphasis, and the sidebar utility bar now aligns with the main status footer height.
- **Model token accounting**: the model stats table now shows exact uncached input, output, cache-read, and cache-write token counts plus cache hit rate for cost analysis.
- **English and Chinese GUI localization**: completed bilingual coverage for native menus, settings and dynamic schema options, onboarding, notifications, accessibility text, tool renderers, and shared application surfaces, with persisted language selection synchronized across renderer and main processes.

### Fixed

- **Fresh agent sessions**: new agent tabs now start with empty session state even when the project enables CLI auto-resume; replaced background sessions discard their old transcript, draft, title, approval, and extension UI snapshots; and old subagents no longer reappear after an in-place session reset.
- **Safe sidebar task actions**: saved chat sessions now open in chat tabs, and automatic compaction is treated as busy so affected tasks cannot be renamed or deleted mid-operation.

## [0.7.4] - 2026-08-12

### Fixed

- **Edit tool summaries**: freeform hashline and apply-patch invocations now derive edited paths from their payload headers, so collapsed transcript rows and streaming fallback headers no longer render without a target file.
- **Transcript timeline spacing**: timestamped phase markers now reserve enough row height and use a tighter marker-to-time stack, preventing adjacent completion and background-task markers from overlapping.
- **Transcript delivery identity**: `agent_end` payloads that contain post-maintenance rewrites of already streamed tool results are now deduplicated by stable delivery fields, preventing a full result and its `[Shaken]` replacement from rendering as separate conversation rows.
- **Conversation hierarchy**: composer mode controls now collapse into one stateful menu, prompt bubbles size to their content, queue management uses a wider layout with full-size controls, and repeated identical notices coalesce into a counted toast.
- **Provider credential editing**: provider-row edit actions now resolve the exact editable resource. Custom `models.yml` providers open their own configuration, while registered API-key providers such as Tavily and DeepSeek reopen their credential flow instead of opening an unrelated custom-provider form or exposing no edit action.
- **Todo transcript snapshots**: automatic cleanup after all todos complete now clears only the live state and preserves the final completed snapshot instead of appending a contradictory "Todos cleared" row.
- **Live todo transcript updates**: successful todo tool results now update the active todo state and append the transcript snapshot immediately, without waiting for the run to finish or the session to be reopened.
- **Editable, sortable pending messages**: the message-queue panel now edits plain steering and follow-up text in place, keeps reorder controls visible without hover, persists the visible order through the agent queue RPCs, and rolls back optimistic changes when RPC responses or transport calls fail.

## [0.7.3] - 2026-08-11

### Changed

- **Global surface unification**: content surfaces are now colorless by policy — cards, rows, chips, panels, and page sections render transparent over the canvas and separate with hairline borders, while paint is reserved for the canvas, navigation chrome, floating overlays (modals/menus/toasts), interaction states, semantic fills, code blocks, and form fields. The policy is written into `styles/global.css` and enforced by `scripts/lint-surfaces.mjs` (wired into `bun run check`), so static grey fills can no longer creep back in.
- **Unified content column**: the transcript, composer, dock, settings, and management pages now share one centered, viewport-adaptive container (`omp-column-reading` / `omp-column-workspace` in `styles/components.css`) with a fluid gutter — replacing the transcript's asymmetric left-rail gutters and the settings window's per-tab max-widths, so every page aligns the same way at every resolution.
- **Unified type scale**: UI text across chat, tools, panels, settings, dialogs, and layout now uses the six-step `text-omp-*` scale (defined in `global.css`, enforced by the surface lint) instead of ~990 ad-hoc raw pixel classes.
- **Live execution state moved into the conversation**: todos, plan review, subagents, and the message queue now render as collapsible live cards in a dock between the transcript and the composer instead of hiding behind the workspace drawer. Todo editing (status cycle, inline edit, drag reorder), plan review (steps/raw, approve, per-step feedback), the subagent roster (list/graph, expandable transcripts), and queue management (reorder/remove/clear in a modal from the dock chip) keep their full capabilities; queued messages continue to render as inline bubbles at the transcript tail. The workspace drawer now carries only Diff, Files, and Logs, and command-palette entries (`todo edit`, `plan-review`) deep-link the matching dock card.

### Added

- **Todo change archive in the transcript**: every semantic todo-list change after session hydration inserts a compact snapshot row at its position in the conversation (expandable, read-only), so the evolution of the work plan is reviewable alongside the messages that drove it.
- **Cross-lane queue moves**: queue entries can switch between the steering and follow-up lanes from the queue manager (appended to the target lane's end via the extended `queue_move` RPC).
- **Dock height budget**: the dock region caps at 45% of the window height with its own scroll, so simultaneous plan/todo/agents cards can't squeeze the transcript away.

### Fixed

- **Responsive conversation sizing**: the starter cards, transcript, composer, and title bar now shrink from the workspace's actual available width, switch to compact controls at constrained widths, and cannot expand the main canvas past the viewport or clip its right edge.

### Removed

- **Workspace drawer tabs**: Todo, Plan, Agents, and Queue tabs (and the composer activity strip) are gone; their surfaces live in the center dock. Existing `defaultPanelTab` preferences pointing at removed tabs fall back to Diff.

## [0.7.2] - 2026-08-10

### Added

- **Native management surfaces**: Settings now exposes dedicated Skills, MCP, Security Center, SSH Hosts, and Updates pages backed by native RPC instead of hiding these workflows behind commands.
- **Skills and operations controls**: inspect installed skills, enable or disable them by scope, preview their full instructions, audit the active repository, and manage reusable SSH targets from the GUI.

### Changed

- **Responsive application shell**: settings pages, center content, dialogs, drawers, tabs, and activity panels now size from the available viewport instead of fixed desktop measurements; wide displays use the space without stretching content into unreadable lines, while compact windows reflow controls and columns.
- **Quieter visual hierarchy**: management pages use the window surface as their canvas, reserve tint for selection and status, remove nested grey/green panel fills, reduce decorative borders, and let long previews grow with the page instead of clipping them into a short inset box.
- **Settings information architecture**: OMP capabilities, extensions, operations, configuration, and application concerns are separated into discoverable left-navigation groups with localized labels and search support.

### Fixed

- **Auto-update release discovery**: update errors are normalized into actionable UI state, and the release pipeline now publishes `latest-mac.yml`, ZIP payloads, and blockmaps alongside both DMGs so packaged clients can actually resolve and download the newest version.
- **Dialog and drawer containment**: stacked overlays share a single top-layer contract, preserve focus ownership, fit narrow windows, and keep every tab and footer action reachable without overflowing the viewport.
- **Skills, MCP, and inventory layouts**: removed fixed preview heights and oversized tinted containers that left most of the window empty or made content look disabled; empty, loading, error, and populated states now share the same responsive geometry.
- **Renderer presentation regressions**: compacted message/tool rows no longer reserve blank bands, and status, badges, cards, and navigation keep consistent contrast without unexplained dark or colored backgrounds.

## [0.7.1] - 2026-08-10

### Added

- **Six designed light themes**: Porcelain, Linen, Sage Paper, Sakura Mist, Glacier, and Sandstone add distinct low-glare palettes while preserving the complete GUI token contract.
- **Markdown image rendering**: assistant output can display remote, data/blob, and local image sources; local files are read through the bounded preload bridge and failures degrade to an explicit fallback instead of an empty block.

### Changed

- **Subagent workspace views**: the Agents drawer now presents a real parent/child spawn tree plus a graph view, uses the sidecar's concise UI label instead of dumping the full delegated prompt into the heading, keeps completed rows legible, exposes expandable transcripts, and derives elapsed time from the agent's own runtime sample so opening the drawer never restarts the clock.
- **Lower-churn streaming renderer**: text/thinking updates are throttled at the presentation edge, hidden or empty rows stay out of the virtual layout, and the transcript follows appended content only while the reader remains near the end.

### Fixed

- **Active-tab routing and hydration races**: tab status, session hydration, queue/subagent state, approvals, extension UI, composer drafts, and streaming snapshots are now applied only to the tab and session that own them. Fresh tabs can become usable even when their ready event beats the full route wiring, and rapid switches discard stale hydration replies.
- **Long-transcript session switching**: switching to a session anchors the transcript at its real end instead of an arbitrary virtualized position, while intentional user scrolling is preserved during subsequent streaming.
- **Composer dispatch isolation**: delayed submits, queued shorthand, paste blobs, and restored failures keep their originating tab/session identity and cannot leak into a tab selected after Enter.
- **Chat-tab workspace safety**: agent-only drawer tabs and modes are clamped out of tool-free chat sessions instead of showing stale data from the previous agent tab.
- **Unknown subagent statuses**: future or provider-specific status strings now degrade to a muted label instead of dereferencing missing metadata and crashing the renderer.

## [0.7.0] - 2026-08-08

### Added

- **Tab × worktree binding (plan/20)**: any tab can run in its own git worktree — parallel tabs never step on each other's files. Create via the tab strip's third button (⌥T) or a workspace group's menu: names a branch `omp/gui/<name>` checked out at `~/.omp/wt/gui-<name>-<hash7>` (swept by `omp worktree clear`). Bound tabs carry a branch marker, label by worktree name, and — on close — prompt to delete a clean worktree or force-delete/keep a dirty one (per-tab status reads ride a new tab-addressed RPC channel, never forcing a switch).
- **Git status segment in the footer**: branch plus `*unstaged`/`+staged`/`?untracked` indicators (TUI parity), live-polled from the active session and refreshed on run end / tab / cwd change; click to refresh.
- **PR Center (plan/21, ⌥P)**: a fullscreen panel for GitHub pull requests — rich list (CI health badges, author initial avatars, diff stats), markdown detail with per-check status, per-file lazily-loaded syntax-highlighted diffs, an AI-drafted create flow (title/body from the branch's commits, editable before submit), and one-click checkout that opens the PR in its own worktree-bound tab.
- **Upstream v17.2.10+ sync (112 commits)**: Chinese quota-exhaustion classification, ANTHROPIC_BASE_URL for chat, OAuth org re-login fix, concurrent extension imports, ACP legacy session resolution, hook-refusal and fallback-commit exit-code fixes, and more — all inherited via the bundled sidecar.

### Changed

- **Editorial execution timeline**: rebuilt the conversation renderer around narrated phases, stable virtual-row identities, compact status markers, quieter read/tool cards, refined typography, spacing, borders, light/dark colors, and clearer collapsed reasoning controls. Consecutive filler-only tool messages now merge into the surrounding phase instead of producing repetitive visual blocks.

### Fixed

- **White screen after replacing a running app**: packaged windows now fingerprint `app.asar` at launch and relaunch Electron when an installed update replaces those resources, preventing Chromium from mixing an old archive index with new bytes. The condition is recorded in the bounded runtime JSONL log with its trigger and resource identity.
- **Blank transcript bands and unstable streaming rows**: hidden tool results, punctuation-only deltas, and other zero-height messages no longer reserve virtualized space; tool-only live turns still appear immediately, and existing rows keep stable keys when history changes.
- **New-session and workspace menus**: outside dismissal now begins on the next pointer press, after the opening click has completed, so the sidebar `+` menu and workspace actions stay open and remain clickable.
- **Stacked dialog focus and Escape handling**: opening a dialog moves focus inside it, closing restores the trigger, and only the visually topmost modal/settings layer handles Escape or focus trapping.
- **Tab chip tracks the session's workspace**: switching a session re-roots the chip's cwd (previously frozen at the app's launch project for the tab's whole life).
- **Idle-tab close bypass**: clicking × on an idle tab skipped the confirm handler entirely — it now routes through it, so the worktree cleanup prompt can't be missed.

## [0.6.1] - 2026-08-07

### Added

- **Persistent runtime diagnostics**: React render failures, global JavaScript errors, unhandled promises, preload failures, failed page loads, renderer console errors, unresponsive windows, and renderer/GPU/utility process exits are now recorded as bounded, rotating JSONL at `~/Library/Application Support/@oh-my-pi/omp-gui/logs/gui-runtime.jsonl`. A root-level error surface shows the failure and log path instead of leaving an unexplained blank window.

### Fixed

- **White-screen recovery after renderer exit**: when Chromium's renderer process disappears while the Electron main process and sidecars remain alive, the window now records the exit reason/code and reloads the renderer automatically. Recovery is rate-limited to prevent a boot crash from becoming an infinite reload loop.
- **Packaged font loading**: the renderer CSP now permits bundled data fonts, removing a noisy startup error that could rapidly fill the new runtime log.

## [0.6.0] - 2026-08-07

### Added

- **Chat sessions — tool-free conversations**: new session type (`kind: "chat"` in session headers) for pure dialogue without tool access. Chat sessions isolate from agent sessions in the sidebar and switch dialogs, spawn with `--chat` flag, and render a trimmed composer (no slash commands, file refs, or queue syntax). New-tab menu offers Agent (workspace chooser) or Chat (direct tab) modes.
- **Workspace group management**: right-click any workspace header to pin/unpin (pinned groups float to top in pin order), rename (inline edit with check/cancel), or delete (with confirmation and session-file cleanup). Workspace aliases persist across restarts via `sidebar-prefs` store.
- **Session tabs — full parallel system**: tabs own independent sidecar processes with complete state isolation (session, run, queue, subagents). Background tabs execute autonomously with streaming dots and done badges; switching snapshots and restores full UI state. Type-isolated switching refuses cross-kind attaches (agent ↔ chat) and routes to a new tab of the correct type instead.
- **Session kind guards**: SessionIndex exposes `kindFor(path)` to distinguish agent/chat sessions; switch/open flows check kind compatibility and refuse or redirect mismatches (e.g., clicking a chat session while an agent tab is active opens a new chat tab instead of breaking the current run).

### Fixed

- **ContextMenu click-through race**: menu items now fire their `onSelect` handlers reliably — the dismiss listener switched from `pointerdown` to `click` so it no longer races menu item interactions and closes the portal before the action executes.
- **Session list churn**: SessionIndex watcher events debounce to 350ms trailing (one refresh max per burst) and swap silently — no loading spinner on background updates, no animation churn while agents stream session files.
- **Sidebar ghosting during reorder**: removed all View Transitions CSS rules; pin/rename/delete operations now update immediately without snapshot overlays or crossfade artifacts.

## [0.5.1] - 2026-08-06

### Fixed

- **Session-tabs hardening pass** (full architecture audit + click-through repro): session-file ownership is now tracked pool-wide and duplicate attaches are refused/redirected on every open path — spawn-tab, sidebar/session-picker switch, session-tree "switch to this point", and "open in new window" (a foreign owner's window is focused instead) — closing the double-attach that silently forked transcripts when two sidecars shared one session file. Extension-UI/approval and host tool/URI responses now route to the sidecar that RAISED the request (never the currently-active tab), so answering an approval while viewing another tab can no longer approve the wrong session. Resuming a session into a new tab skips the redundant `switch_session` when the sidecar already holds it, removing an unconditional-abort hazard for the first typed message. Closing a tab whose sidecar is mid-run now inline-confirms (✓/✕, 3s auto-cancel) instead of silently killing the work; `retryPending` clears on tab switch; a failed `SET_ACTIVE_TAB` surfaces an error toast and re-converges from `GET_TABS`; hydrate clears the zombie streaming bubble when returning to a background-settled tab and re-asserts the subagent subscription; tab chips label by session title with an `#n` suffix for untitled duplicates.

## [0.5.0] - 2026-08-06

### Added

- **Session tabs — multi-session parallelism inside ONE window**: each tab owns its own sidecar process (independent session, run, queue, and subagents), so a running task no longer forces a new window — press `+` in the new tab strip (below the title bar) to start a parallel session next to the current one, exactly the Claude Code / Codex model. Background tabs keep executing autonomously (a tab's streaming dot shows activity; a done badge appears when its run finishes while you're elsewhere); switching tabs snapshots and restores the full session state (transcript, todos, subagents, queue lanes, model state, composer draft) and reattaches the renderer to that tab's sidecar with zero duplicated event listeners. Tabs close individually (releasing their sidecar; pool cap of 10 is now shared across tabs and windows), the busy-session switch dialog now offers "open in a new tab" as the recommended parallel path, and sessions can be opened straight into a new tab.

## [0.4.1] - 2026-08-06

### Added

- **Auto-update flow**: the app now discovers, stages, and applies updates from GitHub Releases end to end. A banner announces new versions ("新版本 x.y.z 已发布") with per-version dismissal; downloads run user-initiated (`autoDownload` stays off) with a live progress bar (percent + transferred/total, differential via release blockmaps); a "重启安装" prompt applies the staged update via quit-and-install. Settings → 界面 gains an 应用更新 row (current version + manual check + live status). The main-process updater drives a single status machine (idle/checking/available/downloading/downloaded/not-available/error) replayed to every window; `OMP_DEV_UPDATE_CHECK=1` + `dev-app-update.yml` enables the same flow from `electron-vite preview` for development.

## [0.4.0] - 2026-08-06

### Added

- **Activity Dock — execution state is now visible**. A persistent ActivityStrip above the composer shows `➤ 队列 N · 引导 M` while messages are queued and `🤖 N 个子代理 ▾` while subagents run, each jumping to its drawer tab; queued messages also render as grey pending bubbles at the stream tail with one-click removal. A new **队列** drawer tab (riding the new `get_queue`/`queue_remove`/`queue_move`/`queue_clear` RPCs with stable per-lane queue ids) manages both lanes: dnd-kit reorder plus hover-revealed ▲/▼ move buttons and per-item × delete, per-lane clear, count badges. Queue state is pushed live over a new `queue_update` frame emitted on every queue mutation (enqueue/drain/remove/move/clear), so the strip, panel, and bubbles track drains instantly instead of going stale until the next prompt. Composer mode chips are now stateful (accent + check + live tooltips: plan state, goal objective, loop limit) and the footer gains active-mode badges (计划/目标/循环/vibe/暂停). The agents tab's instance cards are labeled by task/assignment instead of bare type names, with status badges, elapsed time, model, and view-messages/abort/revive actions.
- **Realtime voice, collaboration, and debugger windows** complete the last three previously TUI-only interactive surfaces. Voice mode now starts the sidecar's native live controller, streams phase/transcript/audio-level updates, supports mute, and tears down on close; collaboration can host or join editable/read-only relay sessions, display/copy/open share links and live participants, leave cleanly, and expose `/collab`/`join`/`leave`; the debugger console sends the complete DAP action schema through the agent's existing debug tool and renders structured results.
- **Native `/btw`, `/tan`, `/omfg`, and agent pause flows**: ephemeral side questions stream outside the transcript and can be copied or promoted into a branch, tangential work dispatches through the background-agent controller, repeated-behavior complaints run the interactive TTSR rule forge, and pause/resume uses a process-wide gate shared by the main turn and subagents.

- **Queue shorthand in the composer** (TUI `queue-input.ts` parity): drafts starting with `->` or `=>` show a "➤ Queue" chip, enumerated lists (`1.` / `i.` / `a.` sequences with uniform indent and punctuation) preview a "splits into N" badge, and submitting dispatches one queued message per item — first item prompts with `streamingBehavior:"followUp"` when idle, the rest follow up, images ride on the first item only. Bare `->` with no images warns instead of enqueueing; partial dispatch failures restore the remainder as a renumbered queue draft. The composer auto-inserts a newline after a bare prefix, and items that name extension commands route through `prompt` (the `followUp` path would reject them server-side).
- **Backward model cycling (⇧⌃P)** now truly cycles backward via the new `cycle_model.direction` RPC arg (previously it rode the forward cycle as a wire gap).
- **Retry last failed turn (⌥R / palette "Retry Last Turn")** now uses the new `retry` RPC — the server knows what "failed turn" means — replacing the client-side re-send, which remains available as the distinct palette action "Resend Last Message".
- **Native `/clear`**: typed `/clear` and the palette "Clear Context" action now drop the conversation context in place via the new `clear_context` RPC (keeping the session id), with the dropped-message count toasted and the transcript/context bar rehydrated. Previously `/clear` was an alias for starting a new session, and a typed `/clear` could fall through to the model as literal text while idle.
- **Per-agent abort and revive** in the Agent Hub (TUI hub `x`/`r` parity): live rows get an inline-confirmed abort, parked rows get a revive, both riding the new `abort_subagent`/`revive_subagent` RPCs with translated refusal reasons (advisor read-only, main agent, not found, not parked).
- **Paste "Save as file"**: the large-paste card's third action now persists the blob into the session's `local://` store via the new `write_local_paste` RPC (agent-side name allocation, multi-window safe) and inserts the `local://paste-N.md` reference for the agent to read on demand. Falls back to the inline marker on write failure.
- **Large-paste handling** (TUI editor parity): pasted text over 10 lines or 1000 chars collapses to a `[Paste #N]` marker with the blob held in memory and expanded inline at submit time on every dispatch path (prompt, bash, python, queue items). Past `paste.largeMenuThreshold` lines (default 100) an inline card offers "paste inline" or "attach as wrapped block" (`<attachment>`) with a head/tail preview; Esc takes the default.
- **Keyboard shortcut top-up**: ⌃T toggles thinking-block visibility (via `hideThinkingBlock`), ⌃Enter sends as follow-up, ⌥M opens the model picker, ⌥A opens the agent hub, and ⌘/ opens a new searchable keyboard-shortcuts panel — which is also the new native home of `/hotkeys` in the command palette (previously TUI-only).
- **Usage row segments**: TTFT (when the message carries it) and an HH:MM message time now render alongside tokens/cost/duration/throughput, honoring `display.showTokenUsage`.
- GFM task-list checkboxes now render in markdown (readonly), closing the sanitize gap that stripped `<input>` tags.
- **Session tree node actions**: every node now offers three actions via its corner menu — "Switch to this point" (`switch_leaf` RPC, TUI tree-selector Enter parity, works on any node and restores the target's draft into the composer), "Branch from here" (user nodes), and "Open in new window" (`fork_from` RPC: an independent session file containing only the path to that node, opened in a parallel window). Keyboard Enter switches (Shift+Enter summarizes the abandoned branch first).
- **Foreign session import** (⌘K → "Import External Session"): a wizard lists Claude/Codex sessions (titles, workspaces, times, message counts), multi-selects, and imports each as a fresh OMP copy via the new `list_foreign_sessions`/`import_foreign_session` RPCs — a single import opens it immediately. Sources are never modified; unavailable sources are greyed with the reason.
- **Composer completion chain**: the autocomplete menu is now a provider chain (TUI `getSuggestions` order) adding slash-command argument completion (static subcommands + usage hints, dynamic MCP-server-name/directory candidates via `get_command_arg_completions`), GitHub `#123` → `pr://`/`issue://` completion, and emoji completion (`:smi` popup from a lazily loaded shortcode table, `:name:` inline replace on the closing colon, western emoticons on a terminator, submit-time expansion of stragglers — all gated by `emojiAutocomplete`). Commands with `allowArgs: false` close the menu after the name, and a contextual usage hint row shows the command's/subcommand's usage while you type.
- **Ctrl+G editor dialog**: a fullscreen CodeMirror editor (markdown, history, soft wrap) for the draft — ⌘↵/Save writes back (expanded paste markers resolve to inline text and their blobs are consumed), Esc with unsaved changes arms a double-Esc discard guard, and an optional button round-trips the content through `$VISUAL`/`$EDITOR` via a main-process temp-file bridge.
- **Read-tool grouping** (TUI read-tool-group parity): consecutive collapsible reads fold into one card (`Read (N)` with a `├─/└─` tree, same-file selector merges like `path:1-5,7`, single reads render `● Read <path:sel>`), accreting across assistant messages until visible text/thinking, a non-read tool, or a user message breaks the run. Applies to both finalized history and the live streaming path in full-detail mode (compact mode's ProcessGroup still wins); expanding reveals the individual read cards with full content.
- **MCP server management** (Extensions panel): an add-server wizard (stdio/http/sse transports, per-transport fields with validation parity — names may contain `:`, optional pre-flight connection test) plus upgraded server cards (scope/transport/auth-state badges, command or URL, tool count, expandable last error) with per-card 测试连接 and 重新授权 actions riding the new `mcp_add`/`mcp_test`/`mcp_reauth` RPCs. Connection tests use a throwaway manager and never disturb the live set; reauth drives the existing browser/code dialogs and rejects concurrent flows with `oauth_busy`.
- **Marketplace management** (Inventory panel): add marketplaces by source (https/git/ssh/`owner/repo`/local path — bare names rejected client-side), refresh with cache-freshness notes, remove behind inline confirm, and install/upgrade/uninstall plugins from an expandable per-marketplace list — all via the new `marketplace_action` RPC with in-flight states and copyable failure detail.
- **Plugin config editor** (Inventory panel): plugin rows open a detail drawer with enable toggle, feature checkboxes, and a schema-driven settings form (enum/chip/KV editors, validated JSON fallback). Server validation errors render under the field without losing your input; secret values are write-only (never echoed); per-field reset restores defaults.
- **Keybinding remapping**: the shortcuts panel (⌘/) is now editable — click any remappable row and press a new chord, with user-user conflict errors and shadow-vs-default warnings, per-row reset and reset-all. Overrides are GUI-local prefs (never `keybindings.yml`), take effect immediately, and survive restarts. Chords require a real modifier so typing is never hijacked.
- **Launch profiles** (Settings → 启动配置): per-workspace sidecar launch flags — system prompt / append prompt, extra directories (native picker), tool whitelist, no-rules / no-LSP / plan-yolo, profile, session dir, config overlay — with a truthful effective-command-line preview and a busy-aware "restart now" action. A 12-flag denylist guarantees code-controlled flags (`--session`, `--mode`, …) can never be smuggled in.
- **Markdown code line numbers**: an optional gutter for code blocks in assistant messages (Settings → GUI), sharing the tool renderers' gutter component.

### Changed

- **Prompt-passthrough commands are now native GUI flows**: the last batch of palette entries that injected `/cmd` text and rendered TUI-style text replies has been replaced with real affordances — Workspace Directories dialog (list/add via native picker/remove/move-session, riding new `get_directories`/`add_directory`/`remove_directory`/`move_session` RPCs), Context Report dialog (per-category token bars, `get_context_report`), Active Tools dialog (grouped searchable list, `get_active_tools`), Share Session dialog (encrypted link with copy/open, `share_session`), Background Jobs dialog (`get_jobs`), Force Tool picker (`set_force_tool`/`get_force_tool`), and a bundled Changelog dialog. One-shot actions (`/prewalk`, `/fresh`, `/shake elide|images`, `/reload-plugins`) run new RPCs with toasts; `/dump` formats the transcript client-side into the clipboard; `/queue` prefills the composer's `->` shorthand; advisor/computer/vision/browser/todo submenus map to their real toggles/panels; mcp enable/disable/remove/reconnect and marketplace/plugin install actions ride the existing `mcp_action`/`marketplace_action` RPCs with refreshes. Remaining prompts are intentional: skill/custom/MCP-prompt text expansions, security subsystem (own panel round), `/session pin/delete`, and text-report leftovers (advisor status/dump, mcp resources/prompts) pending structured RPCs. `ssh list/add/remove` is honestly `unavailable` until an SSH surface exists.
- The debug console is now a structured debugger UI instead of a raw-JSON REPL: a sessions strip (auto-refreshed, selectable, status badges, guided empty state with launch/attach examples), an action bar (Threads/Stack/Continue/Pause/Step Over/In/Out/Output/Terminate with state-aware enablement), and typed result rendering (thread tables, numbered stack frames, session snapshot cards, output scrollback). The raw JSON request editor survives behind a collapsed "Advanced" disclosure.
- The command palette is fully localized: all 159 built-in commands and submenu items resolve labels/descriptions through the locale (zh + en) at menu-construction time and rebuild on locale switch, and category headers render via the existing `category.*` keys.

### Fixed

- **MCP servers, shell-exported API keys, and CLI tools configured by bare name now work in the packaged app**: the sidecar spawn merges the user's login-shell environment (dumped once via `$SHELL -ilc env` with marker-delimited extraction — rc-exported provider keys like `ANTHROPIC_API_KEY`, locale, and tool config fill gaps the launch env lacks, while PATH merges the probed shell PATH with existence-checked well-known bin dirs as fallback). Finder-launched apps previously inherited launchd's bare env, so `mcp:codegraph`-style servers died with ENOENT and rc-only API keys showed providers as unauthenticated while the terminal TUI worked. Proxy vars keep the v0.3.1 precedence chain, and an explicitly exported launch env always wins. The external-editor round trip resolves `$VISUAL`/`$EDITOR` through the same probe and spawns with the merged PATH.
- **Auto-update and Help → Documentation now point at the GUI repo** (`nornzach/oh-my-pi-gui`) instead of the upstream CLI repo — update checks previously 404'd against `can1357/oh-my-pi` releases, and a future upstream macOS artifact could have offered a cross-product "update".
- The title bar no longer shows "新建会话" (or blank) for sessions whose auto-title never ran: empty-string title slots now fall through to the session-list title / first message at every layer (RPC state hydration, session switch, main-process session index).
- The `->` queue shorthand now works while streaming: the prefix parse runs before the streaming→steer fallback, so queued drafts enqueue as followUps with the prefix stripped instead of landing in the steer lane as literal `> text`.
- The bundled GUI sidecar build now generates and embeds the stats dashboard and MuPDF assets (alongside native and collaboration assets) before compilation, then restores every temporary source artifact. `omp --smoke-test` now passes on the shipped self-contained binary instead of the stats route failing with HTTP 500.
- The `prompt` RPC call now passes `streamingBehavior` through the preload bridge (the field existed on the wire but was dropped), which queue shorthand dispatch depends on for first-item semantics.
- Fixed a white-screen renderer crash on any session containing a read group: the group card's status selector allocated a new Map inside the zustand selector, so the snapshot was never referentially stable and React threw error #185 in a forceStoreRerender loop. Statuses now derive via useMemo from the stable store map reference.
- Thinking blocks now render reasoning as Markdown — bold headers, inline code, links, and fenced code blocks (TUI parity) — instead of showing literal `**` markers in monospace plain text. The live streaming caret behavior is unchanged, and the markdown pipeline is still sanitized for untrusted model output.

### Security

- Task-list checkbox rendering is two-layer hardened against untrusted model output: the sanitize schema value-pins `input` to `type="checkbox"` (raw `<input type="password">` / `type="file"` / `type="text"` in model output lose the attribute) and the component forces `disabled readOnly tabindex=-1` regardless of input attributes.

## [0.3.1] - 2026-08-05

### Added

- **Proxy support for the agent sidecar.** Provider requests (OAuth, streaming, usage) no longer depend on shell env the Finder-launched app never had: the sidecar now spawns with proxy env resolved per spawn — explicit GUI pref (Settings → GUI → HTTP proxy) → inherited env (terminal launch) → macOS system proxy (auto-detected via Chromium's PAC resolution). Applies on agent restart, done automatically when idle; a busy run is never killed to change proxy. This fixes codex/OAuth models hanging silently on proxy-only networks, where the TUI worked only because the terminal shell exported HTTPS_PROXY.
- Switching sessions while the attached session is streaming or compacting now opens a confirmation dialog offering "open in a new window" (the parallel path, recommended), "abort & switch", or cancel — instead of silently killing the in-flight run. Covers the sidebar, ⌘P session picker, and `omp://session/<id>` deep links; idle sessions still switch straight through.
- The model picker now flags over-context models (live session tokens exceed the model's context window) with a warning badge and tooltip, mirroring the TUI's grayed rows; picking one compacts with the current model first, then switches, with toasts at each stage.
- Failed turns now raise an in-app error toast in addition to the chat error bubble — desktop error notifications default off, so a provider failure (e.g. right after a model switch) no longer looks like a silent no-op. Deferred mid-run settles, live auto-retries, and user aborts stay quiet.
- The waiting-for-model row gains a second escalation tier: after 90s without a first response it explains the likely network cause, the ~5-minute automatic timeout/retry, and that Esc aborts immediately (previously only a generic 30s "slow response" hint).

### Changed

- The schema-driven Settings window now omits entries marked TUI-only from tabs, empty groups, Advanced, and global search instead of showing controls that cannot affect the GUI. Shared settings with real GUI behavior remain visible and now describe both clients honestly (themes, color-blind palette, status footer, native progress, title state, compact density, Mermaid, token usage, and compaction display).
- Settings now opens on an action-oriented **OMP Capabilities** home instead of generic runtime toggles, surfacing TTSR mid-stream correction, parallel subagents, role-based model routing, the second-model advisor, goal/loop modes, cross-session memory, and the native toolchain with direct configure/open actions; ordinary runtime controls remain available in the next tab.

### Fixed

- `/compact` (and the Command Palette "Compact Context" action) now shows success/failure feedback and refreshes the transcript and context-usage bar on completion — previously it resolved silently with no UI update.
- Boolean settings now use the full row as one switch, keep save-state text out of the hit target, immediately reflect the persisted value, and rehydrate after a sidecar reconnect instead of looking unclickable or reverting on restart.
- Capability-home toggles now expose their real runtime state: TTSR restarts the idle sidecar and resumes the current session so cached rule buckets actually change, busy sessions get an explicit next-restart notice, toggle buttons show in-flight state, and enabling Advisor without a resolvable advisor model now shows a persistent not-running badge plus the missing model-role warning instead of appearing to succeed silently.
- Slash commands **typed into the composer** ("/compact", "/model", …) no longer vanish without feedback: they always route through the prompt RPC (never steer/followUp while streaming, which would inject the text as a user steer), and local-only resolutions (`agentInvoked:false`, no agent events) now rehydrate the transcript — so the compaction summary, model change, and context bar actually appear, matching the TUI re-render.
- Session-replacing actions are now guarded everywhere while a turn is running, closing the paths that silently killed the run: the sidebar "+" workspace dialog (new session here / jump workspace / open project), the `/new` and `/clear` command-palette entries, and `/new` or `/clear` typed into the composer. All block with a warning toast (Esc to abort first, or use ⌘⇧N for a parallel window), consistent with the existing menu and deep-link guards; session switching itself already offered the new-window/abort/cancel dialog.
- Fixed a crash in language detection when `navigator.language` is unavailable (e.g. under the test runner), which took down the entire renderer test suite (52 failures).
- Fixed transcript noise in tool-heavy runs: punctuation-only text blocks (".", "…", "---" — model filler between tool calls) no longer render as stray glyphs and ghost bubbles, and tool-call-only messages drop the hover footer row and use compact padding, removing the ~60px-per-message blank bands between consecutive tool cards.
- Fixed the awaiting-model test harness missing `sessions.consumePendingOpen`, matching the boot contract added with parallel sessions.

## [0.3.0] - 2026-08-05

### Added

- Added true parallel sessions: up to 10 windows, each with its own independent agent sidecar process. Opening a session "in a new window" (per-session row button, ⌘⇧N / File → New Window, tray, deep link) spawns a dedicated sidecar for that window, so a session running in one window is never disturbed by switching or creating sessions in another. The sidecar manager is now a per-window pool (cap 10) instead of a global singleton; all IPC routes by `event.sender` to the calling window's sidecar, and each sidecar's events forward only to its owning window. Desktop notifications dedupe within a window but no longer collapse distinct windows' notifications, and the tray/dock indicator aggregates across windows (any error > streaming > waiting > idle).
- Added a per-row "open in new window" action in the session sidebar for explicit parallelism; the default click/`+` behavior (replace the current window's session, server aborts first) is unchanged.

### Changed

- Reworked session/workspace deletion to inline confirm: the first click swaps the trash button for an in-place ✓/✕ pair (confirm sits exactly where delete was), a second click deletes, ✕ or clicking away cancels — no more modal dialog in the center of the screen. Applies to both single sessions and whole workspace groups.
- Rebalanced sidebar visual hierarchy: session titles are now larger and bolder while workspace group headers are smaller and muted, so the session (the thing you act on) reads as the primary row and the workspace as a quiet grouping label.
- Made the left session sidebar resizable by dragging its right edge (mirrors the existing right-panel drag), clamped to 180–420 px.
- The rename (pencil) button on the active session row is now always visible instead of hover-only, so it can no longer be squeezed out of view by neighboring content.
- Upgraded `bun scripts/gen-types.ts` from a command-name-only comparison to a structural shape check: it now parses every `Rpc*` interface in the agent's `rpc-types.ts` and fails (`--check`) when the GUI's same-named interface drifts in field names. The host-tool, subagent, and `toolcall_delta` drifts below all slipped through the old name-only check.

### Fixed

- Fixed the Handoff, plan-approval, and session-tree label dialogs losing focus on every keystroke. The Modal component re-ran its focus-capture effect whenever the caller's `onClose` closure identity changed (on each `setState`), yanking focus from the input back to the dialog's close button; focus capture now runs once per open transition, and close-time focus restore no longer blurs an element inside a freshly opened dialog.
- Fixed the chat not following long streaming replies: the pinned-to-bottom effect only re-ran on row-count changes, so text accumulating inside the constant streaming row and the final message swap never scrolled. It now also tracks streaming text/thinking length so content growth snaps back to the bottom.
- Fixed the agent's `ask` tool (askDialog) leaving no waiting signal: `BLOCKING_UI_METHODS` omitted `askDialog`, so the title marker, sidebar signal light, tray waiting state, and unfocused-window notification all stayed off while the agent waited for an answer.
- Fixed spurious "RPC timeout" errors on long-running `!cmd` bash, `$ code` python, `/compact`, and HTML export. The sidecar only answers these after the work finishes, but every command shared an 8s timeout, so anything longer errored out while actually running; these commands now get generous windows and `window.omp.rpc.command` accepts a per-call timeout.
- Fixed streaming tool cards never showing their accumulating arguments: the `toolcall_delta` wire shape had drifted (`{contentIndex, delta, partial}` vs the assumed `{toolCallId, name, argsDelta}`), so the attribution id was always undefined and every delta overwrote one undefined-key phantom entry. Tool-call deltas are now attributed by the real id from `partial.content[contentIndex]`.
- Fixed live subagent updates attributing to the wrong (or a single undefined-key) entry: `subagent_lifecycle`/`progress`/`event` frames arrive nested as `{type, payload}`, but the GUI read flat fields off the top level, so `id`/`index` were always undefined. Lifecycle frames are now read from `payload`, and progress frames attribute by `payload.progress.id` (the batch-local `index` repeats across task batches).
- Fixed opening a session in a new window showing a blank conversation instead of the target session: the sidecar switch raced the window's boot hydration. The switch now happens in the new window's renderer on boot (it pulls a `pendingSessionPath` and runs `switch_session` + hydrate itself), which both orders the hydration correctly and surfaces switch failures in that window.
- Removed the `gui_open_url`/`gui_notify`/`gui_clipboard_read` host-tool registrations. They were deadlocked end-to-end: the agent emits `{id, toolName, arguments}` frames, the main-process executor read the drifted `{callId, name, args}` fields (always undefined), the renderer had zero `onHostToolCall` consumers, and the agent-side call has no timeout — a model call to any of these hung the turn until the sidecar restarted. Registration is removed until the host-tool pipeline is properly wired; the main-process executor stays in place.

## [0.2.1] - 2026-08-04

### Fixed

- Fixed a renderer crash (white screen) when opening the Agents or Diff workspace tab while the agent was running. Live subagent frames carry runtime statuses the panels' status table never mapped (`running`, `pending`, `aborted`, `parked`, `idle`), so `STATUS_META[status]` was `undefined` and reading `.live`/`.variant` off it tore down the whole React tree; progress payloads also arrived without the assumed shape, spraying `reading 'description'` errors mid-run. Status metadata now covers every runtime status with a safe fallback, "is this agent live" is a single shared predicate instead of scattered `status === "started"` checks, and each workspace panel is wrapped in an error boundary so a future panel-local failure degrades to an inline retry card instead of blanking the window.

## [0.2.0] - 2026-08-04

### Added

- Added the Electron desktop GUI with session navigation, conversation and tool rendering, model controls, settings, workspace panels, stats, light and dark themes, and compact-window support.
- Added voice features driven by the agent's speech/STT pipelines: a composer microphone (honors `stt.enabled`, `stt.modelName`, `stt.submitTrigger`, `stt.language`) that records, resamples to 16 kHz mono WAV, and transcribes server-side via the new `transcribe_audio` RPC, and auto-speak of assistant output (honors `speech.enabled`, `speech.mode`, `speech.voice`, `tts.localModel`) via the new `synthesize_speech` RPC with local TTS synthesis. Packaged builds carry the macOS microphone usage description and audio-input entitlement.
- Added dock/tray run progress honoring `terminal.showProgress`: dock badge (● working, ! waiting) and window progress bar, plus an amber waiting state in the tray icon.
- Added unified themes: the GUI now honors the agent's `theme.dark`/`theme.light` theme names by resolving them server-side (`get_theme_colors` RPC) and layering the colors over the active GUI theme, re-applied on config updates and theme switches.
- Added a status footer bar honoring `statusLine.preset` (default/minimal/compact/full/nerd/ascii) with model + thinking level, cwd, context meter, and session name segments.
- Added compact density (`tui.tight`, root zoom) and a color-blind-safe palette (`colorBlindMode`, Okabe-Ito tokens) — both formerly TUI-only.
- The GUI now honors four settings that were previously TUI-only: `display.showTokenUsage` (per-turn usage row on assistant messages — note the schema default is off, so usage rows now follow the setting and stay hidden until enabled), `display.collapseCompacted` (pre-compaction history folds behind an expandable divider), `tui.titleState` (run-state marker in the window title: `●` working, `!` waiting on you, `›` your turn), and `goal.statusInFooter` (composer goal chip).
- Added a signal light to session rows in the sidebar: a pulsing green dot for sessions that are currently running (live store state for the attached session, the session file's tail status for others), and a pulsing yellow warning when the attached session is blocked on a confirmation (plan approval, ask, or permission prompt) — visible at a glance while juggling multiple sessions.
- Added an explicit thinking-level picker in the composer (Codex/Claude Code style): the chip now opens a menu listing `off`, `auto`, and exactly the effort levels the active model supports, with the current selector checked — replacing the blind click-to-cycle that jumped to an unspecified next value. The get_state wire now carries `thinkingConfigured` and `availableThinkingLevels`, and `set_thinking_level` accepts `auto`.
- Added a Settings → GUI toggle to expand reasoning (thinking) blocks by default; blocks can still be collapsed individually and the preference persists across launches.

### Fixed

- Fixed settings edited from the GUI settings window not taking effect in the running session for runtime-cached keys (sampling parameters, default thinking level, advisor, memory backend, vision mode, provider search/image orders, MCP notifications, conversation-flow modes, omit-thinking, mermaid prompt refresh) — `set_setting` now applies them live via the shared runtime-apply path.
- Fixed the settings window showing stale values after a setting was changed elsewhere (TUI, composer controls, another window); it now refreshes on config_update while open, without clobbering an in-progress row edit.
- TUI-chrome-only settings (status line, terminal images, boot screens, speech/audio, …) are now badged "TUI only" in the settings window so it's clear they have no GUI effect.
- Settings cached at session construction (tool/prompt registration, thinking budgets, autolearn, LSP pool, …) are now badged "restart required" — edits take effect after a sidecar restart in every client.
- Fixed `plan.defaultOnStartup` never applying to GUI sessions, and closed todos never auto-clearing (`tasks.todoClearDelay` now runs in the agent session, not the TUI).
- Fixed the chat showing no feedback while the agent was busy but nothing had streamed yet. A live status row now mirrors the TUI's loader line: waiting for the model's first event (elapsed seconds, escalating slow-response hint after 30s), auto-retry delay/attempt with a live countdown and failure detail, and auto-compaction maintenance with the TUI's reason/action text — each carrying an Esc-interrupt hint. The row also appears when attaching to a session that is already streaming (launch/reconnect/session switch), and stays visible through the user-prompt echo and the empty assistant shell that precede the first streamed token.
- Fixed the composer sending the message when Enter was pressed while an IME candidate window was open (e.g. Chinese pinyin); Enter now commits the composition instead.
- Fixed packaged applications crashing at startup because main-process dependencies were externalized while `node_modules` was excluded from the application archive.
- Fixed RPC extension UI subscriptions so interactive ask and approval dialogs appear and return user responses.
- Fixed historical tool calls and results rendering as empty assistant messages after session hydration.
