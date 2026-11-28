# Russian interface localization

Russian extends the existing English/Chinese localization. The globe opens an explicit English / Русский / 中文 menu. The preference is stored in the existing `prefs.language` and `omp.lang` keys, broadcast to every window, and used by native menus, tray labels, notifications, settings search, and date formatting. With no explicit preference, a Russian system locale selects Russian.

## Translation surfaces

- `src/renderer/locales/ru.ts`: all 3,329 English UI keys.
- `src/main/native-ru.ts`: application/browser menus, native dialogs, update errors, and tray labels.
- `src/renderer/components/settings/schema-ru.ts`: setting labels/descriptions and section headings for the bundled Core schema.
- `src/renderer/components/settings/schema-option-ru.ts`: display labels/descriptions for enum options. Underlying option values and setting paths are unchanged.
- `src/shared/languages.ts`: supported language IDs, names and formatting locales.

User messages, model output, tool output, system instructions, code, paths, configuration identifiers and model/provider names are not translated. Built-in starter cards and approval/revision templates are localized like the existing Chinese interface, preserving their intent and parameters. Unknown future strings fall back to English; update the translation before shipping them.

## Terminology

Keep MCP, Skills, Skill, API, OAuth, Git, GitHub, PR, CLI, RPC, SSH, SDK, LSP, URL, JSON, YAML, TOML, HTML, Markdown and product/model/provider names in English. Keep technical feature names such as Agent Hub, Thinking, Reasoning, Prewalk, Hooks and Plugins. Keep Git concepts used as technical identifiers, including worktree, diff, commit, branch, fork, rebase and merge. Translate surrounding prose. These exceptions are intentional.

Use consistent Russian terms: session — сессия; task/job — задача (фоновая задача for background execution); subagent — субагент; generic agent — агент; workspace — рабочая область; provider — провайдер; tool — инструмент; context — контекст; token — токен; approval — подтверждение; permission — разрешение; cache — кеш; compaction — сжатие контекста; prompt — промпт; label — метка; tab — вкладка. Named Agent and Chat modes retain their names.

Use concise, neutral Russian. Buttons use infinitives: Сохранить, Отменить, Удалить, Открыть. Preserve interpolation variables, markup, newlines, commands, URLs and code examples. English `{plural}` suffixes may be omitted; use count-neutral constructions such as `Задач: {count}` instead of grammatically incorrect plural forms.

Enum *display labels* such as Stable and Default are prose and should be translated. Raw enum values in RPC/configuration are identifiers and must be preserved.

## Validation and maintenance

Run `bunx vitest run src/renderer/locales/ru.test.ts src/renderer/lib/i18n-language.test.ts src/renderer/components/common/LangSwitcher.test.tsx src/renderer/components/settings/schema-localization.test.ts` for key/placeholder completeness, protected terminology, template parameters, language selection, persistence, cross-window events, and schema localization/search. `ru-identical.json` documents reviewed English names and code; do not regenerate it automatically for new strings.

Run the full suite, `bun run check:types`, `bun run build`, and Biome on touched files. Tests default to English independently of the OS; localization cases select their own language. Some pre-existing POSIX process fixtures require Linux/macOS and cannot execute on Windows. Verify packaged Windows behavior separately in an isolated profile.

When the bundled Core changes, run `bun scripts/check-localized-schema.ts <sidecar-path>`. Translate added keys/options, review terminology, and inspect screens for clipping. A saved language preference survives normal updates using the same application profile; the new binary must also contain Russian.
