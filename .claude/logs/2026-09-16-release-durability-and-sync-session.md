# v26.9.15 release, durability fixes, sync hunt, demo work — 2026-09-11 → 09-16

Long multi-arc session. Continuation state (context near full). Everything below
is on `main` unless noted; v26.9.15 is published.

## SHIPPED — v26.9.15 (published, latest)
Cut + published the release (release skill). Since v26.9.9 it bundles:
- Overflow-badge JIT fix (051c465, earlier).
- Text sizes stored on new decks + back-filled on open (6c90720, de781e0).
- **Default title 62 for ALL decks** (bcc537c): `DEFAULT_TEXT_SIZES.title` 72→62
  (a title element carries no explicit fontSize → resolves through DEFAULT_TEXT_SIZES).
- **CLI `import json` hard-reject** of decks missing fonts/sizes (a3eb04d):
  `require_complete_config` in cli.rs (presence check only, cmd_import ONLY — NOT
  db_import_json which is also a Tauri cmd + the Save path). Stamped all 32
  e2e/fixtures + 15 make_*.py generators via `_deckcfg.py`, + 2 showcase tools.
- **verticalAlign STORED on elements** (f77dd21): required `valign` per preset in
  TEXT_PRESET_STYLES (title 'bottom', rest 'top'); createTextElement stamps it;
  ensureStoredValign back-fills on open; render resolver `el.verticalAlign||'top'`;
  6 inline sites deduped. Taller top-aligned footnote (1020×60 @ y960).
- e2e demo-theme probe path fix: hardcoded `/work/...` → `new URL(...,import.meta.url)`.
- **Cmd+A field-select fix** (WKWebView routes field Cmd+A through the native Edit
  menu's selectAll: which our accelerator-less custom item doesn't provide → fixed
  in App.tsx selectAllAction path + settings.tsx). Mac-only symptom, unverifiable
  headless — asked David to confirm.
Gates all green incl full e2e 126/126 + perf snapshot (no regression; intro-slide
rapidSlideNav 28→17ms = the JIT fix). Rig at $HOME/el-target (cargo, app+cli).

## SHIPPED post-release (on main, NOT in 26.9.15 — for next release)
- **Selected-element z-raise** (f17411c box/DraggableBox + e8b324e arrow): selected
  element floats to z-index 10000 (reverts on deselect) so its chrome (link badges,
  resize/endpoint handles, delete) is clickable under a higher-z element. Transient
  render-only — NOT a persistent reorder → does NOT touch SQLite (guarded by a test:
  presentation.exercise.test "selecting an element issues NO SQLite write", dddf72e).
- **Sync/link durability fix** (006d924 + unit guard c985625) — see next section.

## THE BIG ONE — sync "unsync reverts on reload" (REPRODUCED + FIXED)
David: unsynced a legend textbox in gitignore/source-inversion.eigendeck while
building a talk LIVE; it re-synced on reload. Root cause is DURABILITY, not sync
logic:
- "synced" is DERIVED on load from an element id shared across >1 slide
  (storage.rs:1102), stripped on write. So a DROPPED unsync silently REVERTS.
- Edits ride a **1s autosave debounce** (scheduleFlush). A non-graceful close in
  that window strands the write; the clean-quit path (App.tsx, isDirty=false) force_quits
  without flushing the queue (force_quit only checkpoints the WAL).
- Sync LOGIC is robust: I drove EIGHT seam variants (sequential frees, free+move,
  free+z-order, sync+link, full copy→link/dup→sync/unsync/paste, settled control) —
  ALL persist. `linkPastedToSource` == `linkElements` (paste path faithfully covered).
  The deck's bitemporal history shows NO free ever registered on the group (only
  z-order rewrites keeping the canonical id) — the failed frees never reached disk.
- **REPRO**: e2e/sync-durability-probe.mjs — `nosave` (free, quit inside 1s window,
  no save) REVERTS; `settled` (wait 1.6s) persists. Both wired into run-all.sh
  (syncgroup fixture in make_e2e_decks.py).
- **FIX (006d924)**: `flushSyncLinkNow()` (presentation.ts) → free/resync/link/unlink/
  relink/promoteToSync flush to disk IMMEDIATELY (bypass debounce). Clean-quit path
  (App.tsx) now `flushToSqlite()` before force_quit. nosave probe now PASSES; DB
  shows freed row right after the free. Unit guard c985625 (freeElement flushes
  within a tick without an explicit save). NOTE: resync/unlink/relink DO mark dirty
  (via updateElement) — the earlier "they don't" was a false grep negative; the
  mark-dirty fix was unneeded.

## FLAGGED, NOT FIXED (in auto-memory)
- **Asset-reload durability** (project_eigendeck_asset_reload_durability_bug): a
  watched-source image v2 isn't durably saved to the main .eigendeck (WAL-only,
  reload/Cmd+S don't checkpoint) → synced copy on machine 2 shows v1. Same durability
  family as the sync fix; the flushSyncLinkNow pattern is the template.
- **Demo-piece reload** (project_eigendeck_demo_piece_reload_bug): watching a demo
  whose source edit changes piece count/identity — auto-reload re-stores bytes but
  doesn't reconcile demo-piece elements (piece referenced by name). Open design Q.

## DEMO work
- Fixed gitignore/llm-source-inversion.html to be a well-formed MULTIPART demo: it
  used bare `#controller/#interact/#pca/#scores` hash; rewired boot() to Eigendeck's
  `#piece=<name>` / `#role=controller` params. extractDemoPieceNames now finds
  ["interact","pca","scores"]; BroadcastChannel protocol verified. (David confirmed fixed.)
- Extracted genslm demo → gitignore/genslm-trained-codon-transformer.html (278958 B,
  valid marker, SINGLE-piece — pieces=[]). Via `export json --with-assets` on a COPY.
- Cross-deck demo move: copy/paste does NOT carry demo bytes (internal clip is
  image-only; demos are `clipboardRef`/in-app only, #167). Recommended path: drag the
  source .html into the target deck (re-embeds + auto-splits pieces via htmlDropRoute).

## OPEN / IN PROGRESS — cut-paste demos (INCOMPLETE, do repro-test FIRST)
David: "we don't seem to be able to cut-paste demos at all right now." Started
reading code (should have built an e2e repro FIRST — David's explicit feedback).
Found so far: handleCopy (App.tsx:1333) DOES write the demo's clip JSON to the OS
clipboard (kind:'elements', el has assetId); pasteInternalClip (pasteClip.ts) clones
with a NEW id but PRESERVES assetId (JSON.stringify) → same-deck should resolve.
normalizeUntrustedElement (normalizePresentation.ts:69) returns `el` for demos
(line 38) after generic checks — does NOT drop demos by type. So the break is NOT
the sanitizer and NOT assetId loss. NEXT: build an e2e probe that copies+pastes a
demo element (same-deck) and asserts the pasted element renders — pin where it
actually fails (maybe the copy event doesn't fire for a demo selection, or paste
handler filters, or the demo iframe doesn't mount for the pasted assetId).

## Process feedback captured
- For a bug: BUILD AN E2E REPRO FIRST, then read code (David, twice — sync hunt +
  cut-paste). Don't lead with code archaeology.
- David works LIVE (talks); don't demand exact repro steps — harden + instrument instead.

## State
main HEAD after c985625 (pushed). Uncommitted: only pre-existing
examples/graph-algorithms.eigendeck (M), examples/genslm (untracked),
gitignore/*.html (the extracted demos + the fixed llm-source-inversion). Rig
provisioned. Next-release queue: z-raise + Cmd+A + durability fix (+ pending 26.9.10
perf-guard items from the prior worklog, + welcome-demo d3 revisit).
