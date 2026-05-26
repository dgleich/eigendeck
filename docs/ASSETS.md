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

### Path collision dialog — "asset has silently changed since first add"

**Purpose**: surface a specific surprise that file-watching's silent
auto-update can cause. Users coming from PowerPoint don't expect
images in a saved deck to mutate when the source file is edited
elsewhere. Eigendeck's default behavior IS to silently auto-update
(see the cascade resolver above), but we want to give the user a
chance to notice and opt out when the situation comes up.

**Specific scenario**: user adds `Image.svg`; later, the file is
edited on disk and the watcher silently updates the asset; later
still, the user re-adds the same `Image.svg`. At that re-add moment,
we have evidence that (a) the asset existed and (b) it changed
without explicit user action since they first added it.

**Trigger condition**: a new drag-drop or file-picker insertion's
path already exists in the project, AND the bytes being added
differ from the existing asset's *original* bytes (oldest version's
hash in history). The comparison is "what the user is adding now"
vs "what the user originally added at this path" — divergence
catches the silent-watcher case AND the auto-reload-off case where
the file changed on disk without anyone updating the asset.

**Skipped when**:

- **Per-presentation auto-reload is OFF** ("PowerPoint mode" — see
  below). The dialog premise doesn't apply when the user has
  explicitly opted out of the auto-update paradigm.
- **User already clicked "I understand"** on the collision dialog
  for this presentation earlier in the same app session. The
  acceptance is per-presentation, per-app-session, held in a
  module-level `Set<project_id>` in `assetInsert.ts` (NOT
  persisted to localStorage / project config). Resets on app
  restart so a returning user can still be prompted if the
  scenario recurs in a fresh launch. See "Workflow rule" below.
- Path is new (no existing asset at that path) — no surprise.
- The bytes being added match the existing asset's ORIGINAL bytes
  (user is re-adding the same file they first put here) — no
  surprise.
- Existing asset has versions but no element currently references
  it (orphan) — no user to surprise.
- Insertion is via clipboard paste — paste paths are synthetic
  (`pasted-<ts>.svg`), this scenario never applies.

**Workflow rule** (the contract the user is acknowledging with each
choice):

- **"I understand and want this auto-updating behavior"** is a
  conceptual commitment for the rest of the app session: "I'm
  informed about how auto-updating works, don't keep asking me."
  Subsequent inserts at ANY path in this presentation skip the
  dialog and silently update on the existing asset. The flag
  clears at app restart — a user returning later still gets the
  awareness prompt if it applies.
- **"I want to revert the contents to the previous version..."** is
  a structural commitment for the presentation: it sets
  `config.autoReloadAssets = 'off'` (persisted in the
  `.eigendeck`), which puts the presentation in PowerPoint mode
  permanently. Subsequent inserts skip the dialog AND create
  independent assets.
- **Esc / outside-click** is the "I'm not deciding right now"
  escape. The insertion is cancelled (no asset stored, no element
  added), and nothing is remembered — re-attempting the same
  insert will re-prompt.

#### PowerPoint mode: per-presentation auto-reload OFF

When `config.autoReloadAssets === 'off'` — either set explicitly by
the user (Inspector → Presentation → Auto-reload Assets → Never), or
carried over from a prior "Revert + add as new" choice in the
collision dialog — every drag-drop / file-picker insertion creates
an INDEPENDENT asset:

- Fresh `asset_id` (UUID generated client-side, never reuses an
  existing asset_id even if the path label matches).
- `external_path` IS preserved (where one applies, i.e. drag-drop
  or file picker). The cascade resolver blocks the watcher from
  subscribing while per-pres is OFF — but the user can pull a
  fresh version explicitly via Properties → Asset → Reload from
  disk now. Manual recovery beats automatic surprise.
- No collision dialog (the divergence question doesn't apply once
  the user has opted out of the auto-update paradigm).

**Flipping per-presentation auto-reload back to ON** prompts a
confirmation dialog (`ReenableWatchingDialog`) — the user
previously opted out, and a quiet toggle shouldn't suddenly start
auto-updating every pre-existing asset. The dialog fires whenever
the effective per-pres value transitions from `false` to `true`,
so it catches both "Never → Always" and "Never → Follow global
(global ON)".

Two explicit choices + Esc-cancels:

- **Only enable for new files**: walks every linked asset with
  `auto_reload = NULL` (implicitly following the cascade) and
  sets it to `'off'` per-asset, baking the current OFF behavior
  in. The per-pres pref then flips to ON; future inserts get
  watched, existing assets stay quiet unless the user
  individually flips them back on via the Asset properties
  tri-state.
- **Re-enable and re-scan all**: per-pres flips to ON; assets
  with `auto_reload = NULL` resume watching via the cascade;
  `scanForChangedAssets` runs immediately to pull any drift that
  accumulated on disk while OFF mode was active.

Assets the user explicitly flipped to "Never" in the Asset
properties tri-state stay opted out regardless of which option
they pick — that was an intentional per-asset choice.

**Dialog body** (verbatim wording):

> *Image.svg* has changed since you added it on slide(s) *N* / *N and M*.
> The default behavior in Eigendeck is to update it to the latest
> version when it changes, which has already happened. Both the
> existing and new copy will now show the updated version.

Slide numbers come from `getSlideNumber` (same numbering as the
sidebar).

**Two explicit choices** — no default-focused button, user must
opt in to one. Esc / clicking-outside abandons the insertion (no
visible Cancel button — the dialog is paternalistic about needing
a choice, but Esc remains as a safety net since users expect it).

| Choice | Effect |
|---|---|
| **I understand and want this auto-updating behavior** | `db_store_asset` reusing existing `asset_id`. New bytes either dedup against the silently-updated current (typical) or genuinely update again. The new element binds to the existing asset. Same end state as if the dialog hadn't appeared — this option is opt-in awareness. |
| **I want to revert the contents of slide(s) X to the previous version and add this as a new version. I don't want the auto-updating behavior. (This will disable it for this presentation.)** | Three actions: (1) `db_restore_asset_version` on the existing asset using its oldest version's `valid_from` — restores the original bytes and sets `auto_reload='off'` on the restored row; (2) `db_store_asset` with no `assetId` — creates a fresh asset_id with the just-dragged bytes; new element binds to it; (3) `presentation.config.autoReloadAssets = 'off'` — disables auto-reload presentation-wide. Effectively splits: existing slides show their original appearance; the new slide gets the new bytes. |

**No path mutation**: "Revert and add as new version" does NOT
rename the new asset's path. The path stays as the user sees it.
Two assets at the same path label, disambiguated by `asset_id`.

**No session memory / "Don't ask again"**: deliberately omitted.
The dialog is rare (only fires on a real silent-change scenario)
and the choice is consequential (one option reverts content and
flips a presentation-wide preference). User must reckon with each
occurrence freshly.

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

### Per-asset tri-state on shared assets (auto-fork)

The per-asset tri-state lives in Properties → Asset (per element
selected) — but multiple elements can be bound to the same
`asset_id` (e.g. the user dragged the same SVG onto three slides
and accepted "Update existing" in the collision dialog, or never
hit the dialog at all). Setting `auto_reload` on the shared row
would affect every bound element, contradicting the per-element
mental model of the panel.

When the user changes the tri-state for a shared asset (usage
count > 1), `AssetSection.setAutoReload` **forks** the asset:

1. Read current bytes via `db_get_asset_by_id(oldAssetId)`.
2. `db_store_asset` with a fresh `crypto.randomUUID()` assetId,
   same path label, same external_path / mime_type, and the
   chosen `auto_reload` value baked in.
3. `updateElement(elementId, { assetId: newAssetId })` rebinds
   THIS element to the new asset. Other elements stay on the
   original asset (so the file watcher's auto-update continues
   to affect them normally).

When usage count is 1 (no other elements share the asset), the
in-place flip via `db_set_asset_auto_reload` is correct — no fork
needed.

This makes the panel behave "per-element" from the user's POV,
even though the underlying storage is asset-keyed.

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
