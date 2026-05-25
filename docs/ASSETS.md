# Asset handling — design

How Eigendeck stores, watches, renders, and updates binary assets
(images, SVGs, PDFs, demo HTML) embedded in `.eigendeck` files. This
is the single source of truth for the *why* behind the asset code;
schema details that change frequently live in `LLM-EDITING.md` and
the source.

## Goals

1. **Self-contained `.eigendeck`** — opening a presentation shows
   every asset even if the original source files are gone. Bytes
   live in SQLite.
2. **Live workflow** — when you edit `chart.svg` in Inkscape, the
   presentation reflects the new version without you re-importing.
3. **History without bloat** — you can always recover an older
   version of an asset, but the file size doesn't explode the way
   inline-data-URI-per-element did in earlier versions.
4. **No surprises** — silent behavior the user might miss surfaces
   itself when there's a reasonable chance the user will be
   confused (the path collision dialog).
5. **Lightweight, native-feeling Mac tool** — system features like
   the clipboard work the way users expect, including Office and
   Adobe vendor formats web standards filter out.

## Data model

Single source of truth: the `assets` SQLite table.

```
CREATE TABLE assets (
  asset_id        TEXT NOT NULL,       -- UUID, stable across versions
  data            BLOB NOT NULL,       -- raw bytes
  mime_type       TEXT,
  size            INTEGER,
  hash            TEXT,                -- SHA-256 hex of data
  path            TEXT,                -- DISPLAY LABEL, NOT UNIQUE
  external_path   TEXT,                -- path relative to .eigendeck dir
                                       -- for the source file the watcher
                                       -- re-resolves to abs at runtime
  external_mtime  TEXT,                -- ISO-8601, last seen on disk
  auto_reload     TEXT,                -- 'on' | 'off' | NULL (follow pres/global)
  created_at      TEXT NOT NULL,
  valid_from      TEXT NOT NULL,
  valid_to        TEXT,                -- NULL = current row for this asset_id
  PRIMARY KEY (asset_id, valid_from)
);
```

Temporal shape: every byte change creates a new row with a fresh
`valid_from`; the prior row's `valid_to` is set to the same instant.
"Current" rows have `valid_to IS NULL`. Version history is "every row
with this asset_id, newest first."

### Why path is NOT unique

`path` is a human-readable LABEL — what shows up in the inspector,
what `element.src` references in the JSON. Two distinct assets can
legitimately share a path:

- User imports `chart.svg` from `~/talks/2024/`, imports a different
  `chart.svg` from `~/talks/2025/` — both get path "chart.svg" but
  are separate assets.
- "Import as new" (collision dialog, see below) explicitly creates
  a second asset at the same path label.

Element-to-asset binding is therefore by `asset_id`, not path —
see "Element binding" below.

### Why asset_id is a UUID

Stable across renames, copies, edits, and Save-As (which forks the
asset history along with the project_id). Independent of file path
on disk. Generated on first insert; never reused.

## Element binding

Image / demo / demo-piece elements carry both:

- `src` (or `demoSrc` for demo-piece): display label, also the
  legacy resolution key for elements that predate `assetId`.
- `assetId?: UUID`: stable binding to a specific row in `assets`.

**Resolution order**: `assetId` when set (unambiguous even when
multiple assets share a path); fall back to "most recent asset with
this path label" when `assetId` is absent (legacy elements).

### Backfill on load

Opening a `.eigendeck` runs a one-time per-load pass: every
image/demo/demo-piece element lacking an `assetId` gets one resolved
by path lookup against the assets table. Mutates the loaded
presentation in place before `setPresentation`. Idempotent and
cheap; persists when the user next saves (no force-dirty after
backfill — see `backfillElementAssetIds` in
`src/store/presentation.ts`).

## Asset lifecycle

### Insertion

Five paths, all converging on a single `db_store_asset` Tauri call
that returns the new (or reused) `asset_id`:

| Source | `externalPath` | Watcher? |
|---|---|---|
| Drag-drop file from Finder | rel path from .eigendeck dir | yes |
| File picker (+Image / +Demo) | rel path | yes |
| Clipboard paste (web `DataTransfer` or `navigator.clipboard.read`) | `null` | no |
| Native NSPasteboard (Office SVG, PDF, etc.) | `null` | no |
| Tauri file-drop event | rel path | yes |

`db_store_asset(path, data, mime, externalPath, externalMtime,
assetId?, autoReload?)` semantics:

1. Determine `asset_id`: explicit > path-lookup-most-recent >
   fresh UUID.
2. SHA-256 hash dedup: if the current row for this `asset_id` has
   the same hash as the new bytes, no-op return same id.
3. Otherwise transactional close-old + insert-new with the same
   `asset_id`.

The element gets `assetId = <returned id>` so future renders
unambiguously target this asset.

### Path collision dialog

**When fired**: a new insertion's path already exists in the
project as a current asset, AND the new bytes' hash differs from
the currently-bound asset's hash. (Hash match = silent dedup, no
dialog.)

**Purpose**: ask the user which of two equally-valid intents they
have. Both options are legitimate; the dialog exists because the
choice is consequential and the user may not realize there is one.

The two intents:

1. *"Update everywhere"* — the user edited the source file and
   wants every slide showing this asset to reflect the new
   version. This is also what silent file-watching does
   automatically when on; the dialog surfaces the same outcome
   when triggered by a manual re-add.
2. *"This is a separate thing now"* — the user is intentionally
   importing a different file that happens to share a name (or
   forking an existing one). Older slides should keep their
   original appearance; only this new element gets the new bytes.

**Dialog framing**: a question, not a heads-up. No preselected
default action — the user picks. The body explains what each
option does in concrete terms (which slides change, which stay).

**Actions**:

| Button | Effect |
|---|---|
| **Update existing asset** | Call `db_store_asset` with the existing `asset_id`. Every element bound to that id (this slide AND others) shows the new bytes. Old version goes to history. Same outcome as silent file-watching, made explicit. |
| **Add as a new asset** | Call `db_store_asset` with no `assetId`, forcing a fresh UUID. The new element binds to the new asset. Both assets keep `path = 'chart.svg'`; older elements stay bound to the original asset and render their original bytes. Watcher behavior: the new asset has its own `external_path` link; the old asset's watcher continues independently. |
| **Cancel** | Abort the insertion entirely. No asset stored, no element added. |

**No path mutation**: "Add as a new asset" does NOT rename the new
asset's path (e.g. `chart-2.svg`). The path stays as the user
sees it. Disambiguation is by `asset_id` only.

**No default focus**: the dialog does not preselect a button. We
explicitly want the user to read and choose, since both options
have legitimate use cases.

**Dialog body contents**:

- Filename / path label.
- "Used on N elements across M slides." Makes the blast radius
  of "Update existing" concrete.
- The existing asset's `external_path` (source file on disk) if
  known — lets the user see whether they're re-adding from the
  same folder or a different one.

**Trigger scope**: drag-drop and file picker only. Clipboard
paste is excluded — paste creates synthetic paths like
`images/pasted-1748202345.svg`, so collisions are essentially
never the user's intent. Skipping paste avoids dialog spam.

**"Don't ask again this session" checkbox**: the dialog has a
checkbox below the buttons. When checked + a choice is clicked,
that choice becomes the session-wide default for any further
collision until app restart. Held in a module-level variable
(NOT persisted to `localStorage`), explicitly per-app-session so
the user gets a fresh prompt on next launch.

### Update (in-place new version)

Triggered by:

- File watcher firing on a disk change
- Manual "Reload from disk now" in the Asset properties section
- Open-time scan (`scanForChangedAssets`) catching disk edits made
  while the project was closed
- SVG embed-snapshot follow-up
- Path collision dialog "Continue & replace"

All call `db_store_asset` with the existing `asset_id`. Same
transactional close-old + insert-new with a new `valid_from`. Old
bytes stay in history; "current" pointer moves.

### Restore

`db_restore_asset_version(asset_id, valid_from)` snapshots an old
version's bytes + metadata, closes the current row, and inserts
the old bytes as the new current. Sets `auto_reload = 'off'` on
the restored row so the watcher doesn't immediately overwrite the
restore on the next disk event.

### History display

The Asset properties section shows every version newest-first via
`db_get_asset_history(asset_id)`. Each row has size, timestamp,
"current" badge, and a "Restore" button for non-current versions.

## Cascade resolution: file-watching auto-reload

Three layers, most specific wins:

```
effectiveAutoReload(perAsset, perPresentation, globalDefault) =
    perAsset === 'on'           ? true
  : perAsset === 'off'          ? false
  : perPresentation === 'on'    ? true
  : perPresentation === 'off'   ? false
  : globalDefault
```

| Layer | Where | UI surface |
|---|---|---|
| Per-asset | `assets.auto_reload` (`'on'`/`'off'`/null) | Properties → Asset → Auto-reload tri-state |
| Per-presentation | `config.autoReloadAssets` (`'on'`/`'off'`/absent) | Properties → Presentation (nothing selected) → Auto-reload Assets tri-state |
| Global default | `localStorage['eigendeck:pref:autoReloadAssets']` boolean (default true) | Eigendeck → Settings… (Cmd+,) → Auto-reload assets checkbox |

The watcher subscriber gate (in `useAssetFileWatcher` and
`scanForChangedAssets`) applies this resolution; "OFF" means no
watch, no auto-reload. Manual "Reload from disk now" ignores the
cascade — explicit user action always works.

## File watching

### Watcher registry

`src/lib/watcherRegistry.ts` — singleton per `project_id` (UUID in
`_meta`). Each registry holds `Map<external_path, {unwatch, assets:
Set<{assetId, path}>, mimeType, lastHandledAt}>`.

- One `fs.watch` per source file, fanning out to every subscribed
  asset on disk change. Two elements pointing at the same source
  file share one kernel watch.
- 250ms coalescing window per path (`lastHandledAt`) — macOS atomic
  saves emit 5–7 events; we collapse to one reload.
- `project_id` keying survives in-place rename of the `.eigendeck`
  file. Save-As writes a fresh `project_id` and forks the watcher
  set (correct: the new file is a different project).

### Scan-on-load

`scanForChangedAssets(projectDir, presOverride)` stats every linked
asset on project open, reloads any whose `external_mtime` moved
since the stored value. Catches edits made while the project was
closed. Also gated by the cascade.

### Cross-cutting Tauri requirements

The watcher needs BOTH `tauri-plugin-fs`'s `watch` Cargo feature
AND `fs:allow-watch` / `fs:allow-unwatch` capabilities in
`src-tauri/capabilities/default.json`. Missing either causes
`Command watch not found` (Cargo feature) or a permission rejection
(capability).

### Unsaved presentations

File watching is fundamentally impossible without a project
directory to resolve `external_path` against. When the user adds a
trackable asset to an unsaved presentation:

- The toast system fires a warning ("Asset added, but file-watching
  is disabled until the presentation is saved").
- The Properties → Asset section replaces the auto-reload tri-state
  + Reload Now button with a yellow info bar + Save… button.
- The toast suppression rule: don't nag if the effective auto-reload
  is OFF for this project (user opted out, no point).

## Renderer

Two hooks resolve assets to blob URLs:

- `useAssetUrl(path, hash?, assetId?)` (`src/lib/demoAssets.ts`)
  — raw bytes via blob URL, cached. Used for HTML demos and
  unrasterized images.
- `useRenderedAsset(path, kind, maxW, maxH, variant?, assetId?)`
  (`src/lib/assetRenderer.ts`) — cache-or-rasterize PNG into
  `asset_cache` SQLite table at the requested dimensions. Used by
  the slide sidebar thumbnails. SVG <200KB takes the native fast
  path (raw blob URL); larger SVG and all raster go through the
  PNG cache.

Both prefer `assetId` for cache identity AND for the DB lookup
(`db_get_asset_by_id`); fall back to path label (`db_get_asset`)
when `assetId` is absent. Cache key is `assetId ?? path`.

### Cache invalidation event

`invalidateRenderedAsset(sourceId, assetId?)` does three things:

1. `db_clear_asset_cache(sourceId)` — drop rasterized PNGs.
2. `invalidateAsset(path, assetId?)` — drop the in-memory blob
   URL cache (both id-keyed and path-keyed entries).
3. Dispatches `eigendeck:asset-changed` window event with
   `{path, assetId}` detail.

Listening hooks (`useAssetUrl`, `useRenderedAsset`, `AssetSection`)
filter the event by `assetId` when both sides have one, else by
`path`. This is what makes the watcher's silent updates trigger
re-fetches in the live UI.

## Insertion sources (paste / drag-drop / pasteboard)

### Paste (Cmd+V)

Priority order: SVG > PDF > raster, with vendor UTIs aliased to
canonical MIMEs (`com.microsoft.image-svg-xml` → `image/svg+xml`,
`com.adobe.pdf` → `application/pdf`, etc.). SVG before PDF because
the pdfium render path isn't built yet; flip when PDF works.

Three discovery paths in priority order:

1. Native macOS `NSPasteboard` via `objc2-app-kit` (`pasteboard_list_types` / `pasteboard_read_type` Tauri commands) — the only path that sees Office/Apple/Adobe custom UTIs that WebKit filters out of JS clipboard APIs.
2. Async `navigator.clipboard.read()` — sometimes exposes formats the sync API doesn't.
3. Sync `clipboardData.items` — fallback.

### Drag-drop

Two paths:

1. Native macOS drag pasteboard via `pasteboard_read_drag_type` — exposed during Tauri's `onDragDropEvent` handler. Sees the same Office/Adobe UTIs paste does.
2. Web `DataTransfer.items` — fallback for non-Mac and as safety net.

**Unsolved**: drag-out-of-PowerPoint produces zero JS events
because Tauri's drag-drop bridge filters at the NSWindow level
before any custom-UTI drag reaches the webview. Documented as a
known limitation; tracked separately. Paste works as a workaround.

### File picker (+Image / +Demo buttons)

Plain `@tauri-apps/plugin-dialog` `open()`, then file read + store.
Same `db_store_asset` call as drag-drop.

## Settings surfaces

| Setting | Where it lives | UI |
|---|---|---|
| Global `autoReloadAssets` | `localStorage` | Eigendeck → Settings… (Cmd+,) modal |
| Global `mathPreamble` | `localStorage` | Same Settings modal (textarea) |
| Per-presentation `autoReloadAssets` | `config.autoReloadAssets` in `.eigendeck` JSON | Inspector → Presentation block (nothing selected) → tri-state |
| Per-presentation `mathPreamble` | `config.mathPreamble` | Inspector → Presentation → textarea + "Insert global" / "Replace with global" buttons |
| Per-asset `auto_reload` | `assets.auto_reload` column | Inspector → Asset section → tri-state (shown only when project is saved) |

The Settings modal is webview-based today; native NSPanel is
deferred — see GitHub issue #62.

### Math preamble semantics

**Render time**: only `config.mathPreamble` (per-presentation)
matters. There is no cascade or merge with the global preamble.

**Editing time**: the global preamble is a template:

- New presentations seed `config.mathPreamble` from the global pref
  at creation (in `fileOps.createProject`).
- "Insert global" button on the per-presentation textarea: prepends
  the current global preamble text to whatever's in the per-pres
  field. Use case: opened someone else's deck, want your common
  macros available.
- "Replace with global" button: overwrites per-pres with global
  (confirm prompt if per-pres is non-empty). Use case: updated
  global, want this deck to use the new version.

Both buttons disabled when global is empty.

## Toasts (non-modal user warnings)

`src/lib/toasts.ts` + `<ToastHost>` at the bottom of the window.
Used today for the "asset added to unsaved presentation" warning
with an inline Save… button. Replace any future "this would be
modal but isn't critical" use case with a toast rather than a
dialog.

Color-coded by kind (info / warning / error / success), auto-
dismiss with configurable `ttl` (0 = sticky), `key` field dedupes
repeated identical toasts.

## Open questions / future work

- **Native settings window** (issue #62) — current Settings modal
  is webview; native NSPanel scales better with future preferences.
- **PDF render path** — `pdfium-render` integration; bytes are
  stored today, render is placeholder.
- **PowerPoint drag** — needs a Tauri plugin or NSView subclass to
  bypass the webview's drag MIME filter.
- **Demo snapshots** (issue #59) — `asset_cache.variant` column
  reserved; capture flow not built.
- **Cross-platform clipboard** — swap `pasteboard.rs` for
  `clipboard-rs` when Windows/Linux become real targets.

## File-by-file index

| File | Role |
|---|---|
| `src-tauri/src/storage.rs` | `assets` table, all `db_*` asset commands |
| `src-tauri/src/pasteboard.rs` | Native NSPasteboard reads |
| `src/lib/watcherRegistry.ts` | Per-`project_id` watcher singleton, scan-on-load |
| `src/lib/assetWatcher.ts` | `useAssetFileWatcher` React hook |
| `src/lib/demoAssets.ts` | `useAssetUrl` / `getAssetUrl` + blob cache |
| `src/lib/assetRenderer.ts` | `useRenderedAsset` / `renderAsset` + invalidation |
| `src/lib/preferences.ts` | `usePreference`, `effectiveAutoReload` cascade resolver |
| `src/lib/toasts.ts` | Module-level toast subscribe pattern |
| `src/components/AssetSection.tsx` | Properties panel section per image element |
| `src/components/SettingsModal.tsx` | Global preferences modal |
| `src/components/ToastHost.tsx` | Toast renderer mounted in App |
| `src/components/SlideEditor.tsx` | All insertion callsites (paste, drag, native pasteboard) |
| `src/store/presentation.ts` | `backfillElementAssetIds` on load |
| `src/types/presentation.ts` | `ImageElement.assetId`, `DemoElement.assetId`, `DemoPieceElement.assetId` |
