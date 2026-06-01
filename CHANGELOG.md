# Eigendeck Changelog

## Development Log (March 31 – April 2, 2026)

### Day 1 — Foundation (March 31)

**Initial scaffold and MVP** (commits 1–10)
- Created Tauri v2 + React + TypeScript app from scratch
- Installed Rust toolchain and Tauri system dependencies in Linux container
- Built slide editor with TipTap WYSIWYG text editing
- Slide sidebar with drag-and-drop reorder
- Present mode using reveal.js
- Export to self-contained HTML
- GitHub Actions CI (TypeScript check, Vite build, cargo check, clippy)
- Release workflow for Linux, macOS (ARM64 + x64), Windows
- PT Sans font bundled for slides, system font for UI
- Keyboard shortcuts: Cmd+S, F5, Escape

**Testing and docs** (commits 11–15)
- Vitest test suite with 18 tests (store, file ops, types)
- Full Tauri build verified (15MB binary, 5.7MB .deb)
- SETUP.md for environment setup (macOS, Linux, Windows)
- MAC-BUILD.md for building from shared Colima directory
- CLAUDE.md project guide

**Feature additions** (commits 16–30)
- Speaker notes panel with timer
- Image support (file picker, clipboard paste, drag positioning)
- Theme picker (11 reveal.js themes)
- Editable presentation title
- Demo iframe embedding with reload
- Slide layouts: default, centered, two-column
- Slide numbers in footer
- Author/venue footer text
- Font size picker, PT Sans Narrow, uppercase button
- 14-color text color palette
- Native macOS menu bar (File, Edit, View, Window)
- Unsaved changes warning
- Text boxes (positioned anywhere)
- Annotation arrows (SVG with draggable endpoints)
- Undo/redo with zundo (100-step history, batched drags)
- Resizable sidebar with drag handle

### Day 2 — Architecture (April 1)

**Reveal.js removal** (commits 31–35)
- Replaced reveal.js with custom presenter (identical to editor rendering)
- Standalone HTML export without any dependencies
- CSS bundle: 63KB → 16KB (74% smaller)
- JS bundle: 768KB → 630KB (18% smaller)
- No more WYSIWYG mismatches between editor and presenter

**Unified elements array** (commits 36–40)
- Refactored data model: all content is now positioned elements
- Single `elements[]` array per slide (array order = z-order)
- Z-order controls: move to top/up/down/bottom
- Delete key deletes selected element
- Properties panel (Cmd+I) with contextual properties
- -1007 net lines removed

**Text presets** (commits 41–43)
- Removed TipTap entirely — all text uses contentEditable
- 5 text presets: Title, Body, Text Box, Annotation, Footnote
- JS bundle: 630KB → 247KB (61% smaller!)
- LLM-EDITING.md guide for programmatic presentation editing

**Auto-save and history** (commits 44–46)
- Debounced auto-save (3 seconds after last change)
- Save on window blur, before present mode
- Timestamped backup files (keeps last 20)
- Undo history cleared on file load

### Day 2–3 — MathJax and Polish (April 1–2)

**MathJax integration** (commits 47–67)
- Custom PT Sans math font via MathJax 4
- `$...$` inline math, `$$...$$` display math
- Extensive debugging of Tauri WebKit blob Worker issues
- SRE (Speech Rule Engine) causes blob: Worker that Tauri blocks
- Solution: nosre MathJax bundle + Worker stub + brace wrapping
- Debug console (Cmd+Shift+D) for JS error visibility
- WebKit devtools auto-open in dev mode
- Separate display/edit divs so MathJax doesn't corrupt editing
- `$$` lines don't wrap while editing (WYSIWYG consistency)
- Compact placeholder while MathJax renders

**Slide groups** (commits 68–72)
- Groups share slide numbers
- Child slides indented and smaller in sidebar
- "+ Build" button duplicates into same group
- Moving parent moves entire group
- Foundation for linked object animations

**Bug fixes throughout**
- Drag-and-drop: rewrote with pointer events for WebKit
- Demo iframes: transparent overlay for drag, double-click to interact
- Arrow dragging over demos
- Dark theme CSS bleed fixed
- Image rendering consistency between editor and presenter
- Text format toolbar portaled to body (not scaled with canvas)
- Selection highlighting during drag

### Architecture Summary

```
Technology          Before          After
─────────────────────────────────────────────
Rich text editor    TipTap          contentEditable
Presentation engine reveal.js       Custom renderer
Slide data model    Separate fields Unified elements[]
CSS bundle          63 KB           18 KB
JS bundle           768 KB          258 KB
Test count          18              18
Total commits       81              —
```

### Current Feature List

- 5 text element presets with inline formatting
- Images (file picker + Cmd+V paste)
- Annotation arrows (SVG, draggable)
- Interactive HTML demos (iframe, double-click to interact)
- LaTeX math ($...$ and $$...$$) via MathJax SVG
- Slide groups for builds/animations
- Custom presenter (WYSIWYG with editor)
- Standalone HTML export
- Properties panel (Cmd+I)
- Z-order controls
- Undo/redo (Cmd+Z, 100 steps)
- Auto-save with backup history
- Native macOS menu bar
- Resizable sidebar
- Speaker notes with timer
- Author/venue footer
- Debug console (Cmd+Shift+D)
- 3 example presentations
- LLM editing guide
- CI/CD for Linux, macOS, Windows

---

## Asset Versioning + File Watching (May 19 – 25, 2026)

Branch `svg-pdf-image-cache`, ~21 commits ahead of `main`, unpushed at end
of session. Detailed session notes (with WHY-it-stalled traces and the
full TODO) live in `gitignore/worklog-2026-05-19-to-05-25.md`.

### Schema v3: temporal `assets`

- `assets` PK changed from `(path)` to `(asset_id, valid_from)`. `path` becomes a non-unique LABEL — two assets can legitimately share it (two `screenshot.png` imports, for instance).
- `asset_id` is a stable UUID assigned at first insert; survives every version.
- New columns: `valid_from`, `valid_to`, `auto_reload` (text enum `'on'`/`'off'`/null), plus existing `external_path`/`external_mtime`.
- `db_store_asset` is transactional close-old + insert-new with SHA-256 hash dedup (no-op when bytes unchanged — coalesces watcher storms / re-saves with same content).
- Migration on first open recreates old-shape tables and backfills.
- New `_meta` field `project_id` — UUID generated lazily in-memory at open, persisted only on save. Survives macOS in-place rename (inode-based file handle). Save As writes a fresh UUID (fork semantics).

### New Tauri commands

`db_get_asset_by_id`, `db_get_asset_meta_by_path`, `db_get_asset_history`,
`db_restore_asset_version`, `db_list_linked_assets`,
`db_set_asset_auto_reload`, `db_get_project_id`, `db_save_as_to_file`.

### File watcher

- `src/lib/watcherRegistry.ts` — per-`project_id` registry; `Map<external_path, {unwatch, assets: Set<{assetId, path}>, mimeType, lastHandledAt}>`. One `fs.watch` per source file, fans out to all subscribing assets via Set.
- macOS atomic-rename emits 5–7 events per save; coalesced via 250ms `lastHandledAt` window.
- `scanForChangedAssets(projectDir)` on `openSqliteProject` — stat every linked asset, reload where disk mtime differs from stored `external_mtime`. Catches edits made while project was closed.
- `closeSqliteProject` → `closeWatcherRegistry(projectId)`, no leaked kernel watch slots.
- `useAssetFileWatcher` hook is the React glue; SidebarImageThumb mounts one per image element.
- **Both required to actually fire**: `tauri-plugin-fs` `watch` feature flag in `Cargo.toml` (otherwise `Command watch not found`) AND `fs:allow-watch` / `fs:allow-unwatch` capabilities in `src-tauri/capabilities/default.json` (otherwise the call rejects).
- Verbose `[watcher]` / `[watcher-hook]` `console.log` breadcrumbs throughout — visible in the in-app Debug Console (View menu). Toggleable via const.

### Global preferences module

- `src/lib/preferences.ts` — typed wrapper over `localStorage`. First pref: `autoReloadAssets: boolean` (default true).
- `effectiveAutoReload(perAsset, globalDefault)`: per-asset `'on'` always wins, per-asset `'off'` always wins, otherwise follow global.

### Properties panel "Asset" section

- New `src/components/AssetSection.tsx`. Shows: path, source file (`external_path`), source mtime, auto-reload tri-state toggle (Follow global / Always / Never), Reload Now button, scrollable version history with size + relative-time stamps, Restore button per old version.
- Restore creates a new version with old bytes and auto-clears `auto_reload` so the watcher doesn't immediately overwrite the restore on the next disk event.
- Live-updates via the `eigendeck:asset-changed` event.

### Sidebar thumbnails

- `SidebarImageThumb` uses cached PNG renders via `asset_cache` (separate non-temporal table added pre-session) at the `thumb` (256 px) tier. Sidebar redraws no longer decode full-resolution assets every paint.
- SVG-specific fast path: small SVGs (<200 KB) served as raw blob URL (vector-perfect at any CSS size); large SVGs rasterized via canvas to avoid per-paint parse cost.

### Paste / drag from cross-app sources

- WebKit's `clipboardData` and `navigator.clipboard.read()` filter clipboard contents to a small allowlist of standard MIMEs. Custom UTIs like `com.microsoft.image-svg-xml` (Office), `com.adobe.pdf`, and `public.svg-image` are invisible to JS.
- Fix: native `NSPasteboard` access via `objc2-app-kit`. New `src-tauri/src/pasteboard.rs` with four commands: `pasteboard_list_types`, `pasteboard_read_type`, `pasteboard_list_drag_types`, `pasteboard_read_drag_type`. All dispatched to the main thread.
- Paste handler in `SlideEditor` tries native first, then falls through to async `navigator.clipboard`, then sync `clipboardData`.
- Preference order: SVG > PDF > raster, with vendor UTIs aliased to canonical MIMEs. SVG before PDF for now (pdfium not wired); flip when pdfium lands.

### ⚠ Drag from PowerPoint — unsolved

Tauri's drag-drop bridge filters at the NSWindow level: macOS shows the `+`
cursor (drop accepted), but Tauri only forwards file URLs / known image
MIMEs to either `onDragDropEvent` or the webview's DOM. Custom UTIs are
swallowed before any JS event fires. Confirmed via diagnostic logging:
PowerPoint drag produces zero `dragenter` / `dragover` / `drop` events.

**Workaround**: paste works perfectly for the same use case.

**Real fix (not done)**: Tauri plugin or webview NSView subclass that overrides `draggingEntered:` / `performDragOperation:` and forwards every UTI to JS via a Tauri event. Moderate work — 1-2 days with the right Tauri/objc context. Worth doing if cross-app drag becomes a real workflow blocker.

### Toast notification system

- `src/lib/toasts.ts` + `src/components/ToastHost.tsx`. Module-level subscribe pattern (no Zustand).
- `showToast({ message, kind, action?, ttl?, key? })`. Color-coded (info/warning/error/success), optional action button, auto-dismiss with `ttl` (default 6s; 0 = sticky), `key` dedupes repeats.
- Fixed bottom-center stack; `pointer-events: none` on container so clicks pass through underneath.
- First use: warning when adding an asset to an unsaved project (no project dir to resolve `external_path` against → no watching). Toast offers a "Save…" button that triggers `saveProject`. Suppressed when global auto-reload is off (user opted out, no nag).

### Plugin system design (deferred)

`PLUGIN_IDEAS.md` captures an architect-agent's design for a future plugin system: 20 plugin ideas (CC image search, SMILES → 2D structure, TikZ, plot from equation, Mermaid, citations, etc.), sandbox model (per-plugin iframe + Tauri asset-protocol scheme), manifest format with `contributes` for toolbar/menu/inspector integration points, output contract (postMessage with typed `PluginResult` envelope), and 5 forks-in-the-road (distribution, font access, asset-cache integration, editability vs opacity, permissions UX). **No implementation yet** — treat as separate project.

## Notebooks (May 31 – June 1, 2026)

Live Jupyter notebook elements on slides. Drop a `.ipynb` from
Finder (or `+ Notebook` toolbar button); cells render natively in
the slide; click ▶ on a code cell to spin up a kernel and see
output live. External Jupyter server (any language: Python, Julia,
R, ...) is the v1 backend; JupyterLite/Pyodide ("portable demo for
anyone") is wired in the type / cascade but defers display-only
until v1.5.

Branch `feat/notebook-spike`; squashed history covers spikes →
data model → renderer → kernel → PresentMode → docs.

### Architecture choices (see DESIGN_DECISIONS.md "Notebooks")

- **Native cell rendering** instead of an iframe with JupyterLab.
  Lighter, themes match the slide, scrolling/selection are native,
  no postMessage IPC for display.
- **On-demand kernel boot**: no WS connection until the user
  clicks ▶ on a cell. Scrolling a slide with a notebook on it
  never starts a kernel.
- **Dual-backend type, single-backend runtime**: NotebookElement.kernel
  is `{ kind: 'external', ... } | { kind: 'lite' }`. External is
  proven and wired end-to-end; lite has a placeholder banner and
  display-only fallback. Lite implementation is v1.5 work.
- **Default-setting cascade** (DESIGN_DECISIONS.md "Preferences
  cascade"): NotebookElement.kernel → PresentationConfig.notebookKernel
  → app default `{ external, localhost:8888, python3 }`. Fields
  cascade independently so a deck can set baseUrl while individual
  elements override kernelName.

### Spike (validated headless then in real Tauri)

`public/notebook-spike/` — Spike A (external-kernel.html) and
Spike B (built JupyterLite dist, gitignored, see spike-tools/setup.sh).
Both pass in Chromium + Playwright WebKit; David confirmed Spike A
in real Tauri WebKit via Safari with both Python and Julia kernels.

### v1 limitations / open work

- **No in-eigendeck cell editing yet.** Source is read-only; user
  edits in JupyterLab / VSCode, file-watcher reloads. CodeMirror
  swap-in is the natural next step.
- **Outputs are session-scoped.** Running a cell shows output but
  doesn't persist back to the .ipynb. Reloading the slide loses
  live outputs. Explicit "Save outputs to notebook" button is a
  v1.5 candidate.
- **Kernel state dies on slide nav.** Iframes/state are not
  hoisted across slides. Hoisting is a v1.5 conversation.
- **No syntax highlighting.** Source renders as plain monospace
  `<pre>` for now. Comes free with the CodeMirror swap-in.
- **Token in deck**. `.eigendeck` files include the auth token if
  the user sets one in the inspector. Acceptable for localhost
  workflows; v2 moves to an app-prefs server registry keyed by
  baseUrl.

### Test coverage

195 tests pass. New: `notebookParser.test.ts` (8 tests, all output
kinds + language inference + malformed input), `notebookKernel.test.ts`
(7 tests covering cascade + lite short-circuit + token handling),
`assetCache.test.ts` (detect helpers).

### TODO at end of session

- **Small**: Insertion collision dialog (Update / Import as new / Cancel). Global pref UI toggle.
- **Medium**: Demo snapshots (issue #59, schema already reserves `asset_cache.variant`). Editor canvas via `asset_cache` (probably defer indefinitely).
- **Large**: pdfium PDF rendering — PDF clipboard payload is stored today but renders as placeholder. Adds ~10 MB to macOS bundle.
- **Long-term**: PowerPoint drag (see above). Cross-platform clipboard (swap `pasteboard.rs` for `clipboard-rs` when Windows/Linux become real targets).

