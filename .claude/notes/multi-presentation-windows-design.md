# Multi-Presentation Windows — Feasibility & Design

**Status:** Analysis / design proposal
**Date:** 2026-06-04
**Goal:** Open multiple `.eigendeck` presentations at once in a *single app instance*
(like most document apps), each in its own window with its own JavaScript
environment for demos. NOT multiple OS-level copies of the app.

---

## Bottom line

Nothing in the current architecture makes this "almost impossible." The part that
sounded scary — each presentation needing its own JS environment for embedded demos
— is the *easiest* part: it falls out for free if each presentation lives in its own
native Tauri `WebviewWindow` (separate webview = separate V8 context).

The real work is collapsing singleton state that currently assumes "one open
document." It is large but mechanical, not an architectural dead end. The cost is
concentrated in **one** place: the global Rust SQLite connection.

**Key architectural decision: one `WebviewWindow` per open presentation** (native
windows), NOT tabs inside a single webview. See rationale below.

**Rough effort:** ~2–3 focused weeks, dominated by the Rust connection-pool refactor
and shaking out coordination edge cases.

---

## Why separate windows, not tabs

| | Separate `WebviewWindow` per deck | Tabs in one webview |
|---|---|---|
| Demo JS isolation | Free (separate V8 per webview) | Must hand-isolate; demos/iframes share one context |
| MathJax global singleton | Per-window automatically | Must fix the `window.MathJax` singleton |
| Zustand/zundo singletons | Naturally per-document (fresh JS context) | Must refactor to per-document store factory |
| Event listeners / keyboard | Window-scoped by Tauri | Must route by active tab |
| Cost | Rust connection pool + window lifecycle | Frontend singleton surgery everywhere |

Separate windows trade a contained Rust/coordination refactor for free isolation of
everything in the frontend. Given the hard requirement that each presentation have
its own JS environment, this is clearly the right model. The **presenter window
already proves the pattern works** (`src/lib/multiMonitor.ts` creates a second
`WebviewWindow` and coordinates it over Tauri events).

---

## What already works (no change needed)

- **Demo isolation** — demos render in sandboxed iframes
  (`SlideElementRenderer.tsx:317`). With per-window webviews they are double-isolated.
- **MathJax** — display rendering already uses an iframe-pool approach
  (`src/lib/mathjaxRenderer.ts`) that sidesteps the legacy `window.MathJax` singleton
  in `src/lib/mathjax.ts`. Per-window webviews make even the legacy path safe.
- **Assets** — each `.eigendeck` is its own SQLite DB; `asset_id` namespaces never
  collide across files. Naturally isolated.
- **Undo / temporal history** — already per-file (zundo stack cleared on open).
- **File watchers** — `src/lib/watcherRegistry.ts` is already keyed by `projectId`.
  Multi-document-ready today.
- **localStorage** — recent files, window bounds, global prefs are app-global *by
  intent*, not per-document. No collision risk.

---

## The real blockers

### 1. Global SQLite connection (PRIMARY blocker)

`src-tauri/src/storage.rs:13`
```rust
static DB: Lazy<Mutex<Option<Connection>>> = Lazy::new(|| Mutex::new(None));
```
One connection per app. Opening file B closes file A. Every data command routes
through the `with_db()` helper (`storage.rs:516`), which locks this single mutex.
Confirmed ~24 call sites; 68 Tauri commands total.

**Fix:** Replace the single connection with a keyed pool in Tauri managed state:
```rust
// docId (or project path) -> connection
HashMap<DocId, Mutex<Connection>>
```
Every data command gains a `docId` parameter to select its connection. `with_db`
becomes `with_db(doc_id, |conn| ...)`. Tedious (touches ~24 sites) but a standard,
well-trodden Tauri pattern. **This is the spine of the whole effort.**

### 2. `tauri-plugin-single-instance`

`src-tauri/src/lib.rs:624`. Currently a second launch (e.g. double-clicking another
`.eigendeck`) is routed into the *existing* "main" window via an `open-file` event.
**Keep the plugin** (we still want one app instance) but change its handler to **open
a new window** for the incoming file instead of reusing "main."

### 3. Menu hard-wired to the "main" window

`src-tauri/src/lib.rs` menu handler emits menu events to
`get_webview_window("main")`. On macOS there is one global menu bar, so menu actions
must dispatch to the **focused** window. Small but essential change.

### 4. Zustand store + zundo are module singletons

`src/store/presentation.ts` — one `create()` with one undo stack, plus a
module-level dirty tracker / flush timer / `sqliteDbPath`. With one window per
presentation this is *nearly* free: each window is a fresh JS context, so the
singleton is naturally per-document. The remaining work: teach the flush layer which
`docId` it owns (pass it in at window init via URL param) instead of the current
global `sqliteDbPath` (`store/presentation.ts:611`).

### 5. Presenter-window coordination

`src/lib/multiMonitor.ts` / `src/components/PresentMode.tsx`. The presenter window
currently assumes a single editor source. With multiple editor windows, presenter
events (`emitTo('presenter', 'presenter:goto', ...)`) must be **tagged by source
window**, or the app must allow only one "presenting" window at a time (simpler — and
probably the right initial constraint).

---

## Work breakdown

| Area | Effort | Nature |
|---|---|---|
| Rust: per-document connection pool; thread `docId` through ~24 commands | Large | Mechanical, standard Tauri |
| Single-instance handler → "open new window" | Small | Localized |
| Menu dispatch → focused window | Small | Localized |
| Window lifecycle: create / track / close, "Open in New Window" command | Medium | New code; presenter window is the template |
| Store/flush: bind to `docId` instead of global `sqliteDbPath` | Medium | Mechanical |
| Presenter coordination tagged by source window (or single-presenter constraint) | Medium | Edge-case correctness |

---

## Suggested phased plan

1. **De-risk the spine first.** Refactor the Rust `static DB` into a keyed
   connection pool behind `with_db(doc_id, ...)`, keeping a single window. Prove the
   app still works with the new signature everywhere. This is the highest-risk,
   highest-value piece — do it before any window/UI work.
2. **Window lifecycle.** Add a Rust command to spawn a new editor `WebviewWindow`
   with a `docId` (+ file path) URL param. Frontend reads `docId` at init and binds
   its store/flush to it. Wire "File → Open in New Window."
3. **Menu + single-instance routing.** Dispatch menu events to the focused window;
   route incoming-file launches to a new window.
4. **Presenter coordination.** Start with a single-presenter constraint; tag events
   by source window if/when multi-presenter is wanted.
5. **Polish.** Recent-files menu across windows, window-bounds persistence per
   window, save-as path tracking per document, focus-routing edge cases.

---

## Open questions

- **Same file in two windows?** Should we detect and focus the existing window, or
  allow it (and reconcile writes)? Recommend: detect + focus existing, disallow
  double-open initially.
- **Presenter scope:** one global presenter window, or one per editor window?
  Recommend: one presenter, owned by whichever window started presenting.
- **`docId` source of truth:** reuse the stable `projectId` from the `_meta` table
  (already used by the watcher registry) as the connection-pool key, so Rust and
  frontend agree on identity.

---

## Key file references

- `src-tauri/src/storage.rs:13` — global `DB`; `:516` — `with_db` helper
- `src-tauri/src/lib.rs:624` — single-instance plugin; menu handler (emits to "main")
- `src/store/presentation.ts:143` — `usePresentationStore` singleton; `:611` —
  module-level `sqliteDbPath` / dirty tracking / flush timer
- `src/lib/multiMonitor.ts` — existing `WebviewWindow` creation (presenter); template
  for editor-window spawning
- `src/lib/watcherRegistry.ts` — already keyed by `projectId` (multi-doc-ready)
- `src/components/SlideElementRenderer.tsx:317` — sandboxed demo iframes
- `src/lib/mathjaxRenderer.ts` — iframe-pool math rendering (sidesteps singleton)

---

## Welcome-window split — locked design (2026-07-10), DEFERRED into this arc

Explored splitting the welcome/startup screen (#66's `WelcomeWindow`) out of the
single window as an independently-shippable "front half" of this multi-doc effort.
Design got locked; then **paused** on the realization that it costs ~80% of the full
multi-window engineering for ~20% of the value.

**Why it's not a cheap standalone slice.** The expensive part is NOT the SQLite
connection pool — it's de-coupling the backend from the `"main" == editor`
assumption and building the window lifecycle (create/focus/close/quit, menu → focused
window, open-with-file → new window, per-window save/close). That rewiring is
identical with or without the pool. The pool is the *only* extra piece, and it's the
sole thing standing between "one document window" and "N document windows." So the
split would deliver a nicer welcome screen while still capping at one open document.
Decision: fold it into the real multi-document effort, don't ship it alone.

**The locked model (build this when the arc runs):**
- There is **no UX "main" window.** `"main"` is only Tauri's auto-created window
  label. Attach that label to the **welcome** window (the one thing that lives for
  the whole app session); every document is a uniform dynamically-created
  `"doc-<id>"` window (key it by the `_meta` `projectId`, per Open questions above).
- **Launch, no file → welcome window** (own window: small, fixed-size, no toolbar,
  no bounds-restore → nothing to flash/jump).
- **Pick a deck in welcome → welcome HIDES (not minimized — fully hidden, user
  doesn't want to see it lingering), a `doc-<id>` window opens** with the editor +
  native toolbar (toolbar installs visible from frame one; retires the
  install-hidden stopgap `bb30b82`).
- **File ▸ New ▸ Presentation → a brand-new separate document window.**
- **Welcome is the persistent anchor**, re-summonable via `Window ▸ Welcome to
  Eigendeck` (and the Dock icon / relaunch).
- **Launch WITH a file (double-click / open-with) → skip welcome entirely, open a
  document window directly.** (This is the flash the reverted `launchChecked`
  stopgap was targeting; the window split fixes it structurally instead.)
- **Quit rule (this branch's single-DB cap):** closing a document window **quits
  outright** (after the unsaved-changes check). Opening a second deck (from welcome
  or File ▸ New) while one is open **first fires the close/unsaved-changes workflow**
  on the current doc, then opens the new window — because the single global
  connection allows only one open DB. When the pool lands, delete that cap and both
  the quit rule and the "close-first" handoff relax into true simultaneous docs.

**Backend touch-points that must move off the hard-coded `"main"` (all in `lib.rs`):**
`tauri_plugin_single_instance` handler (`open-file` → new doc window, not "main"),
`RunEvent::Opened` (same), the menu handler (dispatch to focused window), the
`CloseRequested`/`Destroyed` close-db+quit logic (per-doc-window), and the frontend
`check-close` / `open-file` listeners in `App.tsx`.

**Already-shipped launch stopgaps on main (independent of this split):**
- `bb30b82` mac toolbar installs hidden (no empty-toolbar flash before welcome)
- `bd5597c` main window created hidden, restores bounds, then shows (no position jump)
- REVERTED (not shipped): the `launchChecked` gate that suppressed the welcome-screen
  flash on a file-launch. Re-appliable as a ~10-line standalone fix if the structural
  window split stays deferred and that flash still bugs.
