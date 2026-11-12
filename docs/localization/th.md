# Thai interface localization

Thai extends the existing English/Russian/Chinese localization. The globe opens an explicit English / Русский / 中文 / ไทย menu. The preference is stored in the existing `prefs.language` and `omp.lang` keys, broadcast to every window, and used by native menus, tray labels, notifications, settings search, and date formatting. With no explicit preference, a Thai system locale selects Thai.

## Translation surfaces

- `src/renderer/locales/th.ts`: all English UI keys (currently 4,129).
- `src/main/native-th.ts`: application/browser menus, native dialogs, update errors, and tray labels.
- `src/shared/languages.ts`: supported language IDs, names and formatting locales.

Settings-schema localization (`schema-th.ts` / `schema-option-th.ts`) is **not provided yet**; settings titles and descriptions fall back to English until translated.

User messages, model output, tool output, system instructions, code, paths, configuration identifiers and model/provider names are not translated. Built-in starter cards and approval/revision templates are localized like the existing Chinese/Russian interfaces, preserving their intent and parameters. Unknown future strings fall back to English; update the translation before shipping them.

## Terminology

Keep MCP, Skills, Skill, API, OAuth, Git, GitHub, PR, CLI, RPC, SSH, SDK, LSP, URL, JSON, YAML, TOML, HTML, Markdown and product/model/provider names in English. Keep technical feature names such as Agent Hub, Agent, Chat, Thinking, Reasoning, Hooks, Plugins, Marketplace, Worktree, Handoff, Fork command. Keep Git concepts used as technical identifiers, including worktree, diff, commit, branch, fork, rebase and merge. Translate surrounding prose. These exceptions are intentional.

Use consistent Thai terms: session — เซสชัน; task/job — งาน (background job — งานพื้นหลัง); workspace — พื้นที่ทำงาน; provider — ผู้ให้บริการ; tool — เครื่องมือ; context — บริบท; token — โทเคน; approval — การอนุมัติ; permission — สิทธิ์; cache — แคช; compaction — การย่อบริบท; prompt — พรอมต์; label — ป้ายกำกับ; tab — แท็บ; settings — การตั้งค่า; model — โมเดล; command — คำสั่ง; extension — ส่วนขยาย; stats — สถิติ; usage — การใช้งาน; dashboard — แดชบอร์ด; theme — ธีม; subagent — ซับเอเจนต์ (or keep "subagent" where it names the feature).

Common verb buttons: Save=บันทึก, Cancel=ยกเลิก, Delete=ลบ, Open=เปิด, Close=ปิด, Copy=คัดลอก, Edit=แก้ไข, Search=ค้นหา, Refresh=รีเฟรช, Upload=อัปโหลด, Download=ดาวน์โหลด, Export=ส่งออก, Import=นำเข้า, Rename=เปลี่ยนชื่อ, Create=สร้าง, Add=เพิ่ม, Remove=ลบออก, Reset=รีเซ็ต, Apply=ใช้, Retry=ลองอีกครั้ง, Continue=ดำเนินการต่อ, Confirm=ยืนยัน.

Use concise, natural Thai — translate meaning, not word-for-word. Preserve interpolation variables (`{name}`), markup, newlines, commands, URLs and code examples. English plural-suffix placeholders (`{plural}`, `{editPlural}`, `{filePlural}`) may be omitted — Thai has no plural suffixes; use count-neutral constructions such as `งาน: {count}` instead of invented plural forms. Preserve `…` and `—` punctuation. Enum *display labels* such as Stable and Default are prose and should be translated; raw enum values in RPC/configuration are identifiers and must be preserved.

## Validation and maintenance

Run `bunx vitest run src/renderer/locales/th.test.ts src/renderer/lib/i18n-language.test.ts src/renderer/components/common/LangSwitcher.test.tsx` for key/placeholder completeness, protected terminology, template parameters, language selection, and persistence. `th-identical.json` documents reviewed English names and code left untranslated (theme names, proper nouns); do not regenerate it automatically for new strings.

Run the full suite, `bun run check:types`, and Biome on touched files. Some pre-existing POSIX process fixtures require Linux/macOS and cannot execute on Windows.
