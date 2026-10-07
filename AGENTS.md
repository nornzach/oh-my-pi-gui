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

- **All GUI work commits to this repo and pushes to `origin/main`.** Never commit GUI paths into the enclosing monorepo's git — from its perspective this directory is an intentionally untracked, self-contained checkout.
- Agent-side work (RPC commands, session logic, `packages/agent|coding-agent|ai|…`) belongs to the **monorepo**, commits at the monorepo root, and pushes to `nornzach/oh-my-pi` (fork) — it does not exist in this repo's history even though the files sit above this directory.

### Upstream sync (pulling new omp features)

Always the script (it re-provisions what a plain merge misses), from anywhere:

```bash
bash packages/gui/scripts/sync-upstream.sh   # run from the GUI repo; it cds to the monorepo root
# fetch upstream → incoming list → merge upstream/main → bun install →
# pi_natives re-provision on version bump → gen:stats → build:omp → GUI build + tests
```

- Conflicts: resolve, commit the merge, re-run with `SKIP_MERGE=1`.
- A sync touches monorepo files only until step 6; the sidecar rebuild (`build:omp`) and GUI build/tests close the loop. Push monorepo results from the monorepo root (fork), GUI results from here.
- **Every release starts with a sync** (README → Release process step 1) so the DMG's sidecar carries current upstream.

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

- The monorepo exists for **upstream feature sync and building the sidecar**; the GUI repo is **the only commit/release target**.
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

The standard procedure for every release. Run the phases **in order**; never skip, reorder, or substitute hand-rolled equivalents — each step guards a failure that has actually happened (wrong-arch sidecars, stale natives, missing `latest-mac.yml`, unsigned apps). If a step cannot run, stop and surface it rather than improvising around it.

Conventions, fixed for every release:

- Version `X.Y.Z` is semver; the tag is exactly `vX.Y.Z`.
- Release commit message is `release(gui): vX.Y.Z` (older `chore(release):` entries predate this convention — do not copy them).
- Everything GUI-side commits and tags in **this** repo (`packages/gui/.git`) and pushes to `origin` (`nornzach/oh-my-pi-gui`). Monorepo changes commit at the monorepo root and push to the fork's `origin`. `upstream` is never a push target.

### Phase 0 — Preconditions

1. GUI checkout on `main`, clean, current: `git -C packages/gui status` and `git -C packages/gui pull --ff-only`.
2. Monorepo checkout clean — `git status` at the monorepo root shows nothing but the intentionally untracked `packages/gui/`.
3. Version number chosen; changelog content drafted.

### Phase 1 — Upstream sync (mandatory, every release)

```bash
bash packages/gui/scripts/sync-upstream.sh        # run from anywhere; it cds to the monorepo root
# merge conflict → resolve at the MONOREPO root → git add -A && git commit →
SKIP_MERGE=1 bash packages/gui/scripts/sync-upstream.sh
```

Commit remaining monorepo changes at the monorepo root and push to the fork's `origin`. Never push to `upstream`.

Format and lint monorepo files with the monorepo's tooling (`bunx oxfmt` / `bunx oxlint` from `packages/coding-agent`), never the GUI's Biome — a Biome `--write` on merge-resolved files once added ~4k lines of formatting churn against upstream.

### Phase 2 — Release prep (inside `packages/gui/`)

1. Bump `version` in `package.json`.
2. Write the release's `CHANGELOG.md` section.
3. Update README install links, version mentions, and release notes in **both** the English and 中文 sections — keep them in sync.
4. Verify: `bunx vitest run && bun run check:types && bun run build`, plus `bunx biome check <touched files>`.

### Phase 3 — Commit, tag, push (GUI repo only)

```bash
git commit -am "release(gui): vX.Y.Z"
git tag vX.Y.Z
git push origin main && git push origin vX.Y.Z
```

Both checkouts must be clean before any artifact is produced.

### Phase 4 — Sidecars (all three, every release)

```bash
bun run build:omp          # → resources/omp     (darwin-arm64)
bun run build:omp:x64      # → resources/omp.x64 (darwin-x64)
bun run build:omp:win      # → resources/omp.exe (windows-x64)
file resources/omp resources/omp.x64            # confirm each architecture
bun scripts/smoke-sidecar.mjs resources/omp     # + .x64 on an Intel host, .exe on Windows
```

Cross-compilation is not runtime verification — smoke-test each binary on a compatible host.

An npm natives leaf may ship only one x64 variant (`pi-natives-darwin-x64@18.8.0` carries `baseline` only); `build:omp` sets aside a stale local sibling for the build so the embedder doesn't reject it, then restores it.

### Phase 5 — Installers

```bash
bun run package:mac:arm64 -- --publish never
bun run package:mac:x64   -- --publish never   # dedicated x64 config — never plain package:mac
bun run package:win       -- --publish never
```

Inspect every artifact before publishing:

- Mount each DMG; verify the seal: `codesign --verify --deep --strict --verbose=2 "<path>/omp.app"`.
- `file "<path>/omp.app/Contents/Resources/omp"` — the bundled sidecar arch must match the DMG (`omp-X.Y.Z-arm64.dmg` = arm64; `omp-X.Y.Z.dmg` = Intel).
- Launch each package on a compatible host: sidecar reaches `ready`, `get_settings` RPC succeeds, one settings toggle persists. From an agent shell, launch with `env -u ELECTRON_RUN_AS_NODE …/Contents/MacOS/omp --user-data-dir=/tmp/<dir>`: a leaked `ELECTRON_RUN_AS_NODE=1` makes Electron exit 0 silently, and a separate user-data dir avoids the single-instance lock of an installed copy.
- Windows: `file win-unpacked/resources/omp.exe` (arch must be x86-64). Preferred path is CI: `.github/workflows/release-windows.yml` (windows-latest) runs on release publish — or dispatch it for an existing tag — and reproduces the sidecar from `sidecar-source.json`'s monorepo pin, smoke-tests it (sidecar RPC handshake + packaged-GUI launch with no renderer crash, plus the locale-pak regression guard), then attaches the setup/portable installers + `latest.yml` itself. Local `bun run package:win -- --publish never` remains available on a Windows host.
- Linux is built by CI, not locally: `.github/workflows/release-linux.yml` (ubuntu-latest) runs on release publish — or dispatch it for an existing tag — and reproduces the sidecar from `sidecar-source.json`'s monorepo pin, smoke-tests it, then attaches AppImage + deb + `latest-linux.yml` itself.

### Phase 6 — Publish

Create the GitHub Release on tag `vX.Y.Z` with:

- `omp-X.Y.Z-arm64.dmg` and `omp-X.Y.Z.dmg`, plus both macOS ZIPs
- `omp-X.Y.Z-setup.exe` and `omp-X.Y.Z-portable.exe`
- All generated update metadata — critically, a `latest-mac.yml` covering **both** architectures (the built-in updater resolves DMGs from it; a release without it, or with only one architecture's entries, breaks update checks)
- The changelog as the release body; record the monorepo commit the sidecars were built from, especially when it isn't upstream `main`

Never commit sidecar binaries. Never push to `upstream`.

### Phase 7 — Post-release

- `site/` needs no edit: version strings and DMG links resolve from the GitHub releases API at page load.
- Verify the release page lists every expected asset and that the updater feed resolves `latest-mac.yml`.
- Confirm the Linux workflow run attached `omp-*.AppImage`, `omp_*.deb`, and `latest-linux.yml` (check the Actions run if they're missing).

## Build, Test, Release

- Commit messages carry no AI attribution trailers — no `Generated with`, `Co-Authored-By`, or similar lines.
- Check: `bun run check:types` (tsc) and `bunx biome check .` — keep touched files clean even if legacy diagnostics remain.
- Test: `bunx vitest run` (full suite must stay green).
- Build: `bun run build` (electron-vite → `out/`), then `bun run package:mac:arm64 -- --publish never` (arm64) or `bun run package:mac:x64 -- --publish never` (Intel).
- **Every release follows the [Release Runbook](#release-runbook) below, phase by phase, no substitutions.**
- Every release's DMGs embed the sidecar compiled from the monorepo — record the monorepo commit in the release notes if it isn't upstream `main`.
- **The public site is `site/`** (`site/index.html` + `site/assets/`). Pages is configured as `build_type=workflow`, so `.github/workflows/pages.yml` is the only publisher: a push to `main` touching `site/**` deploys it. Its version string and DMG links are read from the GitHub releases API at page load, so a release needs **no site edit**; the values in the HTML are only the no-JS fallback.

## Code Conventions

- Follow the enclosing monorepo's `AGENTS.md` for TypeScript style (no `any`, no inline imports, `#private` fields, Bun APIs over Node where cleaner).
- i18n: every user-visible string goes through `useT()` with entries in **both** `src/renderer/locales/en.ts` and `zh.ts` (they must stay key-identical — `locales.test.ts` enforces it).
- Rendering model output: sanitize through `MarkdownRenderer` (rehype-sanitize schema in `src/renderer/lib/markdown.tsx`) — never `dangerouslySetInnerHTML` with raw model text.
- Tool-rendered text follows the monorepo's TUI sanitization rules (tabs, truncation, path shortening) via the helpers in `src/renderer/lib/format.ts`.
- Preview ceilings come from the tiers in `src/renderer/lib/preview.ts` (`PREVIEW_SCROLL_*` + line caps) — don't invent new `max-h-*` values in tool renderers. Captured subprocess output renders through `AnsiText` (`src/renderer/lib/ansi.tsx`), never raw (ANSI escapes would print literally).
- Tests use the linkedom harness pattern (see `src/renderer/components/chat/ThinkingBlock.test.tsx`); zustand stores are reset in `afterEach` via their `reset()`/setters — never `mock.module()`.

## Examples

### Everyday GUI change — commits land in the right repo

```bash
# cwd: packages/gui/ — every git command here acts on the GUI repo
bun run dev                              # HMR against resources/omp
# …edit src/renderer/…
bunx vitest run && bun run check:types
bunx biome check <touched files>         # whole-repo check has legacy diagnostics
git commit -am "Add X to the settings window"   # → nornzach/oh-my-pi-gui
git push origin main
```

The same edit one level up (`packages/coding-agent/…`) belongs to the **monorepo**: commit at the monorepo root (`packages/gui/../..`) and push to the `nornzach/oh-my-pi` fork — never from here.

### Upstream sync with a merge conflict

```bash
bash packages/gui/scripts/sync-upstream.sh
# merge stops: CONFLICT in packages/coding-agent/src/…
# resolve the markers, then from the MONOREPO ROOT (git there = fork):
git add -A && git commit
SKIP_MERGE=1 bash packages/gui/scripts/sync-upstream.sh   # resumes after the merge step
git push origin main                       # monorepo root → nornzach/oh-my-pi
# GUI-side changes (if any) commit and push separately from packages/gui/
```

### Adding a user-visible string (i18n)

```ts
// src/renderer/locales/en.ts
"settings.proxy.enabled": "Proxy enabled",
// src/renderer/locales/zh.ts — identical key, translated value
"settings.proxy.enabled": "已启用代理",
```

```tsx
// component
import { useT } from "../../lib/i18n";

const t = useT();
<span>{t("settings.proxy.enabled")}</span>
// interpolation: t("input.thinking", { level }) fills "Thinking: {level} — click to change"
```

Add the key to both locale files in the same commit — `locales.test.ts` fails the suite if the key sets diverge.

### Rendering model or tool text

```tsx
import { MarkdownRenderer } from "../../lib/markdown";

<MarkdownRenderer content={modelText} />
```

Never `dangerouslySetInnerHTML` with model output, and never build a second markdown path — extend the sanitize schema in `src/renderer/lib/markdown.tsx` if a construct is missing.

### Writing a component test (linkedom harness)

Follow `ThinkingBlock.test.tsx`: set up linkedom globals once, mount through `I18nProvider`, and reset stores in `afterEach`:

```tsx
import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settings";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
Object.assign(globals, { document, window, Event, HTMLElement, Element, Node, IS_REACT_ACT_ENVIRONMENT: true });
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

let container: Element;
let root: Root;

async function mount(element: ReactElement): Promise<void> {
	// linkedom's types don't match React's — cast as in ThinkingBlock.test.tsx
	container = document.createElement("div") as unknown as Element;
	document.body.appendChild(container as never);
	root = createRoot(container);
	await act(async () => {
		root.render(<I18nProvider>{element}</I18nProvider>);
	});
}

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	useSettingsStore.getState().reset();   // setters/reset() — never mock.module()
});
```
