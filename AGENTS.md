# GUI Development Rules

This file governs the **omp GUI sub-repository**. Read it before any edit here — the directory layout (a repo nested inside the omp monorepo) is unusual and getting it wrong breaks builds or leaks commits into the wrong remote.

## Repository Identity

- **This repo is the real product repo:** [`nornzach/oh-my-pi-gui`](https://github.com/nornzach/oh-my-pi-gui). It owns all GUI code, commits, tags, and GitHub Releases.
- **Remote layout:** `origin` = `nornzach/oh-my-pi-gui` (push here). The surrounding monorepo's remotes are NOT this repo's remotes — never `git push` from inside `packages/gui/` expecting monorepo changes to go anywhere, and never push anything to `can1357`.

### The three repos — never confuse them

| Repo | Role | Push? | Pull/sync from? |
|---|---|---|---|
| [`nornzach/oh-my-pi-gui`](https://github.com/nornzach/oh-my-pi-gui) | **This repo** — GUI product, releases. | ✅ all GUI work | only own commits |
| [`nornzach/oh-my-pi`](https://github.com/nornzach/oh-my-pi) | **Monorepo fork** (`origin` of the enclosing checkout) — agent source; the only sidecar build source, and the monorepo the README's build-from-source flow clones. | ✅ (from the monorepo root, not from here) | only own commits |
| [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi) | **Upstream** (`upstream` of the enclosing checkout) — where new omp features come from. | ❌ **NEVER** | ✅ `scripts/sync-upstream.sh` |

- GUI changes belong to this repo and its `origin`. Before syncing, committing, or packaging, check status, active ref, and remote in each repository separately. Preserve existing changes and nested checkouts; stage paths explicitly. Do not commit, push, or release unless the task authorizes it.
- Agent-side work (RPC commands, session logic, `packages/agent|coding-agent|ai|…`) belongs to the **monorepo**, commits at the monorepo root, and pushes to `nornzach/oh-my-pi` (fork) — it does not exist in this repo's history even though the files sit above this directory.

### Upstream sync (pulling new omp features)

Run the script from the monorepo root; it performs the rebuild and verification a plain merge misses:

```bash
bash packages/gui/scripts/sync-upstream.sh
# fetch upstream → incoming list → merge upstream/main → bun install →
# pi_natives re-provision on version bump → gen:stats → build:omp → GUI build + tests
```

- Conflicts: resolve, commit the merge, re-run with `SKIP_MERGE=1`.
- The script ends by writing `sidecar-source.json` from the current fork commit. Recheck that pin if any Core changes are committed after the sync; its value must match the source that actually builds the release binaries.

## Nested Checkout Layout

This repo lives at `packages/gui/` inside a clone of the omp monorepo:

```
oh-my-pi/                    ← monorepo (upstream sync + sidecar source)
├── packages/coding-agent/   ← agent source compiled into the sidecar
├── packages/natives/        ← native addon compiled into the sidecar
└── packages/gui/            ← THIS repo (own .git, tags, releases)
    ├── .git/                ← GUI repo — do not confuse with monorepo .git
    ├── src/                 ← GUI code (commits land here)
    └── resources/omp*       ← sidecar binaries (gitignored, built locally)
```

- The monorepo is the Core source and upstream integration point. The GUI repo owns the desktop installer releases.
- `git status` / `git log` / `git push` run inside `packages/gui/` act on the GUI repo. Anything outside `packages/gui/` acts on the monorepo.
- Do not move this directory out of the monorepo: `scripts/build-bundled-omp.ts` resolves `../../coding-agent` relative to it. If you clone standalone, building the sidecar requires the monorepo next to it (see README → Build from source).

## Sidecar & Packaging Rules

The GUI runs the agent as a **bundled sidecar** (`resources/omp`, a compiled `Bun.build --compile` binary of `packages/coding-agent`). Rules that keep packaging sane:

- `resources/omp` and `resources/omp.*` are **gitignored build artifacts** (~120 MB each). Never commit them; never hand-edit them.
- Build the arm64 sidecar with `bun run build:omp`; cross-build Intel with `bun run build:omp:x64` (outputs `resources/omp.x64`). The script auto-stages the matching `pi_natives` addon — including replacing stale addons whose version sentinel doesn't match — downloads it from npm when missing, and restores the natives directory afterwards. It requires the monorepo neighbors and fails with setup instructions when they're absent.
- The sidecar embeds the `pi_natives` native addon. After syncing the monorepo with upstream (version bump), re-provision natives **before** `build:omp` — `scripts/sync-upstream.sh` automates this.
- Packaging reads the sidecar via `extraResources` (`electron-builder.yml` → `resources/omp` for arm64, `electron-builder.x64.yml` → `resources/omp.x64` for Intel). Building x64 from the default config ships the wrong-arch sidecar — always package Intel with `bun run package:mac:x64` (the x64 config), never plain `package:mac`.
- A packaged GUI never consults a system-installed `omp`. `src/main/index.ts` (`resolveBundledOmp`) only accepts the bundled binary; missing binary = actionable error, not a fallback.

## Release Runbook

Follow these steps for an authorized GUI release. A local test package needs the same source and architecture checks, but no tag, upload, or updater changes.

### 1. Confirm source and sync Core

- Start from current, clean GUI `main` and the intended fork ref. Compare each with its own `origin`; fast-forward clean tracking branches with `git pull --ff-only`. The enclosing repo may show separate GUI and wiki checkouts as untracked.
- Check Bun against the Core `packageManager` requirement before provisioning natives. Sync upstream via `scripts/sync-upstream.sh` and verify compatibility with the merged Core. Use `UPSTREAM_TAG=vX.Y.Z` in a clean fork release checkout when intentionally targeting published Core and its matching npm addons.

```bash
bash packages/gui/scripts/sync-upstream.sh
# After resolving and committing any merge conflicts at the monorepo root:
# SKIP_MERGE=1 bash packages/gui/scripts/sync-upstream.sh
```

- Push Core changes to the fork first. Use the monorepo's oxfmt/oxlint for Core and Biome for GUI files. Generate the full Core SHA from `git rev-parse HEAD`, resolve it in the fork locally and on GitHub, and verify it is reachable from the intended remote ref. A matching short prefix or release note is insufficient.

### 2. Prepare and verify the GUI tag

1. Set `package.json` to `X.Y.Z`, finalize the changelog, and update version notes or fixed links in both languages of README. Keep new user-facing notes under `[Unreleased]` during development and leave prior release sections intact.
2. Set `sidecar-source.json` to `nornzach/oh-my-pi` and the verified **full** Core SHA. Use the same Core source for local builds and CI. Run `bun run test`, `bun run check`, `bun run check:protocol`, and `bun run build` from the GUI repo. Run targeted Electron tests for changed interactions.
3. Commit in the GUI repo with `release(gui): vX.Y.Z` and tag it `vX.Y.Z`. Before pushing, read `git show vX.Y.Z:sidecar-source.json` and compare both fields with the verified fork and full build SHA. Push GUI `main` and the tag to its `origin`, then check the remote ref resolves to the expected GUI commit. Treat pushed release tags as immutable.

### 3. Build and verify packages

Build from the clean GUI tag and pinned Core checkout. Check that each sidecar matches its target and Core version; matching the version string alone does not prove the source was current. Choose the architecture explicitly, especially for an arm64 test package after new commits.

```bash
bun run build:omp          # → resources/omp     (darwin-arm64)
bun run build:omp:x64      # → resources/omp.x64 (darwin-x64)
bun scripts/smoke-sidecar.mjs resources/omp
bun run package:mac:arm64 -- --publish never
bun run package:mac:x64   -- --publish never
```

- macOS: verify the DMGs (`hdiutil verify`), the mounted app seal (`codesign --verify --deep --strict`), the installed ASAR and sidecar freshness, and the sidecar architecture (`file`). The unsuffixed DMG is Intel; the `-arm64.dmg` is Apple silicon. Keep the matching ZIPs and generated blockmaps. Merge the two builds' updater entries into **one** `latest-mac.yml` containing both architectures' DMGs and ZIPs; check filename, SHA-512 and size against the files. Ad-hoc signing does not imply notarization.
- Launch or run the sidecar smoke on a compatible host. Require `VERDICT PASS` and a zero exit status for RPC and the settings round trip. Test an installed GUI with a separate user data directory and a temporary profile; unset a leaked `ELECTRON_RUN_AS_NODE` before launching. Separate static packaging checks, runtime smoke, and full interaction E2E when reporting results.
- Windows x64 and Linux x64 are built by [release-windows.yml](.github/workflows/release-windows.yml) and [release-linux.yml](.github/workflows/release-linux.yml). They build from the tagged GUI and pinned fork, smoke the sidecar, and attach their assets when the release is published. Windows CI also checks PE architecture, locale `.pak` files, and renderer startup. For local Windows verification use `bun run build:omp:win` and `bun run package:win -- --publish never` on a compatible host; a cross-built executable is not runtime evidence.

### 4. Publish and read back

When a maintainer requests a GUI release, use `vX.Y.Z` from the prepared GUI version and include the changelog and full Core SHA in the Release notes. Ordinary changes do not publish a version. Publishing the verified tag's Release starts the three `release: published` workflows. Check all three runs for this exact tag and commit and check the nonempty attachments below, substituting the GUI version for `X.Y.Z`. The macOS workflow builds and smoke-tests both architectures on native runners and checks both updater feeds against the build outputs. Signing is ad-hoc, not notarized.

| Platform | Release assets |
|---|---|
| [macOS](.github/workflows/release-macos.yml) | `omp-X.Y.Z-arm64.dmg`, `omp-X.Y.Z-arm64-mac.zip`, `omp-X.Y.Z.dmg`, `omp-X.Y.Z-mac.zip`, their four `.blockmap` files, and `latest-mac.yml` |
| [Windows](.github/workflows/release-windows.yml) | `omp-X.Y.Z-setup.exe`, `omp-X.Y.Z-setup.exe.blockmap`, `omp-X.Y.Z-portable.exe`, and `latest.yml` |
| [Linux](.github/workflows/release-linux.yml) | `omp-X.Y.Z.AppImage`, `omp_X.Y.Z_amd64.deb`, and `latest-linux.yml`; also upload a blockmap if generated |

- Query the release asset list using `gh release view vX.Y.Z --repo nornzach/oh-my-pi-gui --json assets`. Read back the three updater feeds; confirm the version, filenames, sizes and hashes against the referenced release files. During an upload with no terminal output, check GitHub for progress before restarting it.
- Fork drills publish to the triggering GUI repository only. To use a different Core fork, set the repository Actions variable `OMP_CORE_REPO` and commit its matching `sidecar-source.json`. The default source remains `nornzach/oh-my-pi`.
- If an authorized backfill needs a corrected pin, leave the tag unchanged. Correct the pin on GUI `main` and dispatch the affected workflow from `main` with `tag=vX.Y.Z`, `gui_ref=vX.Y.Z` and `monorepo_sha=<verified full SHA>`. An ordinary rerun still uses the original tag's pin. Verify the rerun and the new assets and updater metadata again.
- `site/` reads versions and download links from GitHub; a normal release needs no site edit. For follow-up comments, inspect existing replies, link the shipped version and say what the reporter should retest. The enclosing `AGENTS.md` requires approval for the exact target and text before posting; posting a reply does not authorize closing the issue.

## Local Verification

- `bun run check` runs the surface policy, Biome, and GUI type checks. Use `bun run check:types` for a focused type pass. The nested checkout can use hoisted tools from the fork; if lint results differ from a standalone clone, check the resolved tool version against the relevant lockfile before changing the rules.
- `bun run test` runs Vitest; `bun run build` creates `out/` and checks that the packaged main bundle does not rely on hoisted dependencies. `bun run check:protocol` checks RPC and stats contracts against the adjacent Core checkout and also runs during `build:omp`.
- `bun run test:e2e e2e/issues-fixes.e2e.ts` checks the Electron UI with an isolated profile and a synthetic sidecar after `bun run build`. `e2e/real-core.e2e.ts` exercises the actual sidecar. Give each case its own state; use semantic locators, real clicks, keyboard input, and overlap or focus checks. A DOM node existing does not prove it is visible or clickable.
- Respect the enclosing commit convention: no AI attribution trailers.

## Code Conventions

- Follow the enclosing monorepo's `AGENTS.md` for TypeScript style (no `any`, no inline imports, `#private` fields, Bun APIs over Node where cleaner).
- Keep code at its owner. Core owns provider policy, account identity, and persisted session events. Electron main owns filesystem/process work and settings that affect sidecar spawn. Expose typed IPC via `src/shared/ipc-types.ts` and the preload bridge; the renderer owns interaction and display state. Update the Core producer and GUI consumer together for wire changes; keep `scripts/protocol/` checking the shapes the GUI consumes.
- Reuse the owning helper and export only what another module consumes. During cleanup trace Electron and HTML entrypoints, lazy imports, IPC/RPC registration, configuration, packaging hooks, test fixtures, and CSS/locale name families. A static scan is a candidate list. Keep compatibility code for released preferences and session formats until its migration path is proven.
- Keep comments that explain an invariant, race, protocol constraint, or platform workaround. Remove commented-out implementations, stale plan references, and descriptions that repeat the next line. Put durable conventions here and product history in the changelog.
- i18n: every user-visible string goes through `useT()` (components) or `translate()` (services). Update `src/renderer/locales/{en,zh,ru,th}.ts` together and run the locale tests for key and placeholder parity. Native menus and Core settings-schema labels have separate localization maps.
- Keep normal content surfaces transparent, using borders, `text-omp-*` and the shared motion tokens in `src/renderer/styles/global.css`. Use the existing overlay primitives and layer helpers for real overlays; menus must paint and receive clicks above dock headers. A focused overlay must handle Escape before the turn abort handler.
- Rendering model output: sanitize through `MarkdownRenderer` (rehype-sanitize schema in `src/renderer/lib/markdown.tsx`) — never `dangerouslySetInnerHTML` with raw model text.
- Tool-rendered text follows the monorepo's TUI sanitization rules (tabs, truncation, path shortening) via the helpers in `src/renderer/lib/format.ts`.
- Preview ceilings come from the tiers in `src/renderer/lib/preview.ts` (`PREVIEW_SCROLL_*` + line caps) — don't invent new `max-h-*` values in tool renderers. Captured subprocess output renders through `AnsiText` (`src/renderer/lib/ansi.tsx`), never raw (ANSI escapes would print literally).
- Tests use the linkedom harness pattern (see `src/renderer/components/chat/ThinkingBlock.test.tsx`). Mount through `I18nProvider`; restore mocks and reset stores after each test. Exercise observable changes and races; never use `mock.module()` or source-text assertions.

## Interaction and State Patterns

- **Session and transcript:** Use `SessionRuntime` and tab-addressed RPC for work that can cross an `await`; recheck the same tab/session and event version before applying a fetched snapshot. Keep persisted entries, optimistic/live messages, and local builtin replies distinct. Reconcile using `mergeFetchedTranscript`/message identity helpers; preserve local command output across refresh, and compare image content by digest when base64 and blob references represent the same image. Verify streaming, `message_end`/`agent_end`, tab switches, hydration, and reopening.
- **Disclosures and scroll:** Every expanded process, thinking block, tool output, read group, or context detail has its own bottom `CollapseButton`. Bind it to the same open state as the header; it stays clickable after the turn ends, collapses only that block, and does not depend on being the last block, hover, or live state. Exercise click and scroll anchoring with multiple rows open, during streaming and after finalization.
- **Requests and drafts:** Queue extension UI by tab/request ID, reuse the form body and response handler for inline/modal rendering, and keep one draft per request across tab switches. Use the dialog when the owning conversation is out of view. Keep composer transformations shared between preview and submit; paste-marker folding and the large-paste menu are independent settings.
- **Quotas, proxy, and project actions:** Merge repeated quota reports by provider/account/organization before display; keep distinct organizations separate and distinguish unknown usage from exhausted allowance. Preserve local/private endpoints and `NO_PROXY` when applying a proxy; explicit direct mode ignores the system proxy. Removing a sidebar project only changes registration; deleting sessions or files is a separate action.
