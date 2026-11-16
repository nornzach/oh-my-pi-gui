# 0.9.44 release audit

Date: 2026-11-17. Agent source: `nornzach/oh-my-pi` commit
`aed530c29ca61c17104fd52cffbae5ce92952df4`, including upstream
`6f03614d761366972e80e84e25d1418ed678d2c7` (omp 18.21.0).
The native addon is 18.21.0. Builds use Bun 1.4.4.

## Findings and changes

- **HTML export:** the compiled fork requested its content-addressed viewer from
  an upstream CDN path that returned HTTP 404. The GUI builder now verifies and
  embeds the generated viewer through an optional core compiler input. The normal
  upstream hosted build remains available. The real-core export test opens the
  exported document without intercepting or replacing the viewer request.
- **Settings reset:** the updated core rejected a missing `set_setting` value as
  a malformed write. The handler now uses the registry's existing `unset` path
  for removal. Real-core RPC verifies write, unset and effective readback.
- **Settings relevance:** the newly exposed TUI spinner interval has no GUI
  consumer. It is excluded from GUI navigation and search by the existing
  terminal-display filter.
- **Merge boundaries:** model discovery preserves positive reasoning capability
  evidence and leaves unknown support detectable; explicit false still wins.
  Explicit queue shorthand goes to the agent even while a BTW question has focus.
  Focused core regressions cover those outcomes and the BTW/worker lifecycle.
- **Test reliability:** the quote harness implements the browser's selection API
  and awaits the caret-restoration frame. Desktop tests address the current
  settings pages and account for navigation groups that remain expanded.
- **Release integrity:** the GUI pins the fork's exact source commit. macOS
  packaging uses separate architecture configurations and output directories;
  the release's update manifest must include both DMGs and ZIPs with their hashes.

## Functional and logic coverage

- Full GUI unit suite: 253 files, 2,279 tests passed, with no unhandled errors.
- Focused core regressions: 437 tests passed. HTML template/compiled export
  regressions: six passed, including safe script escaping and a compiled viewer
  that works from an unrelated directory.
- Core type checking: 5,080 files passed. GUI type checking and production build
  passed; the main bundle has no unresolved runtime package imports.
- The settings audit inventories all 630 schema definitions, separates terminal
  settings and secrets, and exercises supported controls through real Electron
  UI plus RPC readback. Runtime-pinned values verify the saved global layer and
  the override notice; immediately applied settings verify the effective value.
  Incomplete record drafts are recorded separately and are not counted as writes.
  Results: 525 write/readback/restore passes, zero failures; 79 filtered or
  unavailable entries, eight secrets, two external-operation settings and 16
  controls without a completed safe mutation remain explicitly excluded.
- All 108 advertised core commands are searchable; 15 native command submenus
  open successfully without executing their destructive or external actions.
- Desktop audit covers quote insertion at the retained caret, formula source,
  live-turn exclusion, task send/stop, uncertain-delivery duplicate protection,
  collaboration permissions, scan states, local-only sharing preview, modal focus,
  cancelled settings edits, stale refreshes, failed preference saves, navigation
  isolation, and concurrent launch-profile writes.
- One hundred modal and task cycles leave one task and do not grow document
  listeners.
- Real core RPC verifies settings persistence, shell execution, session creation,
  switching and restoration, HTML export, all ten statistics routes, Chinese
  settings pages and theme/preference ordering.
- A 50,000-message fixture verifies five tasks, draft recovery after sidecar
  restart and a reading anchor with zero pixel movement during streaming.
  Separate streaming checks verify sustained following, manual scroll ownership,
  jump-to-latest and reclaiming the live edge on a new send.

## Display coverage

- Eleven named themes meet a 4.5:1 contrast ratio for primary body text and the
  send control. Light and dark formula layouts retain their own horizontal
  scrolling inside the transcript column.
- Settings and the send action remain reachable at 1280×800, 1000×700 and
  1280×900 with 200% zoom, without document-wide horizontal overflow.
- English and Chinese settings, theme switching, the quote action and formula
  rendering are exercised in actual Electron windows. Synthetic provider replies
  are used for display and streaming cases; real-core RPC cases use the compiled
  sidecar and isolated profiles.

## Acceptance boundaries

Installer acceptance follows `AGENTS.md`: verify each DMG and strict app seal,
check Electron and bundled-core architectures, run the sidecar smoke and real-core
E2E from the app extracted from that DMG. Intel runs under Rosetta on this Mac.
Windows and Linux installers are built and checked by their native GitHub Actions
workflows from the release tag and source pin. Their workflow results and final
asset inventory are release evidence, separate from cross-compilation.

No live provider inference, account login, paid API operation or production
collaboration service is required by this audit. The legacy-core compatibility
E2E is skipped because no legacy binary was supplied. Exported documents still
load the shared integrity-pinned Markdown and highlighting libraries online.
macOS signing is ad hoc; notarization is not configured.
