# C-3 caller checks, flush data-loss fixes, and three betas — 2026-08-24 → 09-04

Backfill: this arc followed the C-1/C-2 audit work (logged 2026-08-25) and Codex's
persistence tests (logged 2026-08-26) but wasn't itself captured. All on `main`.

## Security — audit C-3 (main-window caller boundary)
Closed C-3 for the current threat model in phases:
- **Phase 1:** dropped the `capabilities/default.json` `windows:["main","*"]` wildcard to
  the explicit 4 labels; `read_dir` is now `#[cfg(debug_assertions)]` (compiled OUT of
  release, with its `DirEntryInfo` + `generate_handler!` entry). Found the whole Debug
  subsystem was already debug-gated; a stale `debug.rs` comment claiming `--debug` works in
  release had misled an earlier runtime-gate attempt — corrected.
- **Phase 1b:** `require_main` / `require_windows` caller checks on every arbitrary-path
  command — `write_file`/`write_text_file`/`make_dir`/`path_stat`/`path_exists`/`watch_path`
  (fscmds), `db_open`/`db_save_to_file`/`db_save_as_to_file` (storage), `cli_write_and_exit`
  (lib), `install_llm_tools` (llmtools) → main only; `resolve_and_read` → main+presenter+
  **security** (the security window resolves linked files for its report — an initial
  main+presenter allowlist broke the approve/watch flow, caught by the full e2e run and
  fixed in `5b05b4c`). fs logic moved to window-free `*_impl` helpers so unit tests stay
  window-free. Negative regression: `e2e/security-fs-guard-probe.mjs` (secondary window's
  write is refused + writes nothing; its resolve_and_read is allowed).
- Scope rule agreed with the maintainer: exported HTML = same trust boundary as any HTML an
  attacker could send; only fix things that gain native privilege / bypass a sandbox / run on
  open / expose unrelated data. Everything else is accepted web-content risk.

## Data loss found by driving Tauri (#185)
Ran an exploratory "build a presentation" campaign in the real headless app and found a
silent data-loss bug: **save after an undo→redo of not-yet-flushed structural edits persists
a stale snapshot.** Root cause: `flushToSqlite`'s add/delete-queue reconciliation cancelled a
row queued as both added+deleted (the "created-then-deleted-before-first-flush" case), but
undo→redo produces that same both-queues state for a row that IS present in the final view.
Fix (`5e46777`): the reconciliation now follows the final store state — cancel the add only
when the row is absent from `getState()`. Deterministic repro `e2e/_iso-clean-probe.mjs`.
Filed + closed #185. Also fixed 5 stale e2e fixtures using off-schema `{w,h}` position keys
(the normalizer legitimately dropped them; 0/1046 real-deck elements affected).

## Reviewed Codex's four commits
`0701f56` (_syncId/_linkId preserved through Save As), `ddc0a41` (moveSlide contiguous run),
`9401bb1` (user-driven probes), `3ffd950` (#186: preserve edits made DURING an active flush —
detach queues into a private batch before awaiting; my #185 reconciliation preserved). Ran
the gates Codex couldn't (no Rust toolchain there): found the new round-trip test didn't
compile (nested `json!` > default recursion limit) and relayed the fix + how to run cargo in
this container. All green after: cargo 88, clippy, vitest 1568, full e2e.

## Mac-only UI fixes (maintainer-verified on macOS)
- **Title didn't persist** (`5a00f38`): the native-toolbar title/author/venue `NSTextField`s
  lacked `sendsActionOnEndEditing`, so they fired only on Return/Tab — clicking away never
  committed → deck not dirty → Save wrote the old title. Set the flag; guard the JS
  `toolbar:field` handler to apply only on real change.
- **Cmd+A in a text box** (`2c54702`): regression from dropping the Select-All menu
  accelerator; contentEditable doesn't get WKWebView's automatic select-all, so handle
  Cmd/Ctrl+A in the editing box's `onKeyDown` with an explicit `selectAllChildren`.
- **Recent list showed the old title** (`3e39734`): `addRecentProject` ran only on open;
  `saveProject` now refreshes it (keyed by the full `.eigendeck` path — `store.projectPath`
  has the extension stripped, so re-add it to replace, not duplicate).

## Releases (all published as prereleases / beta)
Cut **26.8.26**, **26.8.27**, **26.8.31** via the `release` skill (fonts + icons already
current each time). Gates each: cargo check, vitest 1568, full e2e 119/119, perf baseline
committed (no regressions). 26.8.26 = the security-audit arc + #185/#186; 26.8.27 = the Mac
title + Cmd+A fixes; 26.8.31 = the recent-list fix.

## Docs & misc
- `AGENTS.md`: how to run cargo in THIS container (cargo not on PATH; `/work` is noexec so
  set `CARGO_TARGET_DIR`; GTK deps present + sudo works; storage tests need `--test-threads=1`)
  + a "Committing" section (conventional headers, no backticks in `-m`, green-gate checklist).
  Written because Codex misread the two setup gotchas as "GTK not installed."
- Separate **eigendeck-web** repo: fixed the Search Console "Page with redirect" on
  `downloads.html` — internal links now point at the clean `/downloads` + added canonical tags
  (committed locally there; left unpushed since the site repo had other undeployed commits).
