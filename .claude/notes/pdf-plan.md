# PDF rendering plan — `svg-pdf-image-cache` branch

Captured 2026-05-27, after the asset-model refactor (phases 1-5)
shipped. The original branch goal was **SVG + PDF**; the SVG arc
surfaced asset-management pain that turned into a 6-phase model-B
refactor. PDF is the last big remaining piece on the branch.

## Why PDF matters

PDF is the **highest-value remaining input format** for this app:

- Pasting a slide from PowerPoint or Keynote frequently arrives as PDF
  (PDF is the macOS clipboard's vector default).
- Pasting from Illustrator / Affinity Designer / academic figures
  exported from Matplotlib/PGFPlots is often PDF.
- Pasting from Preview's "select" or any "Save as PDF" path is PDF.

Currently: paste/drag/picker DETECTS and STORES PDF bytes with
`kind: 'pdf'`, but the renderer can't display them (`renderAsset`
throws on the `pdf` case). The user sees an empty/broken placeholder.

After this work: paste → first paint within ~100 ms (rasterized to
PNG, cached in asset_cache). Same hot-path as SVG-large-files.

## What already works (no change needed)

| Piece | Status |
|---|---|
| Clipboard paste detects `com.adobe.pdf` / `application/pdf` UTI | ✅ `SlideEditor.tsx::handlePaste` |
| Native macOS NSPasteboard reads PDF bytes | ✅ `pasteboard.rs::pasteboard_read_type` |
| Drag-drop PDF from Finder | ✅ `SlideEditor.tsx::onDragDropEvent` |
| File picker accepts `.pdf` | ✅ `App.tsx` + Demo button |
| `db_store_asset` stores PDF bytes with `mime_type='application/pdf'` | ✅ |
| `ImageElement.kind: 'pdf'` set at insert time | ✅ |
| `asset_cache` schema supports PDF (variant column reserved) | ✅ |
| Element-to-asset binding (`asset_id` column) | ✅ phase 3 |
| Asset GC won't trim referenced PDF history | ✅ phase 5 |

## What's missing (the work)

Single switch arm in `renderAsset` throws today. Everything below
unblocks it.

| Piece | Status |
|---|---|
| pdfium dylib bundled with the app | ❌ |
| `pdfium-render` Rust dep wired up | ❌ |
| Tauri command `db_render_pdf_page(assetId, page, maxW, maxH) -> Vec<u8>` | ❌ |
| `renderAsset` case `'pdf'` calls it instead of throwing | ❌ |
| Inspector hint for multi-page PDFs ("page 1 of N") | ❌ (v2) |
| Page picker UI | ❌ (v2 — deferred) |

## Decision: how to ship pdfium

PDFium is Google's PDF engine, extracted from Chromium. Building it
from source is impractical (depot_tools, multi-hour build, platform
sysroots). Everyone consumes [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries)
prebuilts. Two ways to consume those:

### Option A — **Dynamic dylib bundled via Tauri resources (RECOMMENDED)**

- `build.rs` (or a `setup.sh` step) downloads the bblanchon archive
  for the build's target triple, extracts the dylib, places it in
  `src-tauri/resources/pdfium/<platform>/`.
- `tauri.conf.json` lists the dylib as a bundled resource → ends up
  next to the executable in the packaged app.
- pdfium-render at runtime: `Pdfium::new(Pdfium::bind_to_library(path))`
  with the resource path resolved via Tauri's resource API.
- Cross-platform binary names: `libpdfium.dylib` (macOS),
  `libpdfium.so` (Linux), `pdfium.dll` (Windows).

Pros:
- Industry-standard pdfium consumer pattern.
- Swap pdfium versions by bumping a single bblanchon release tag.
- Build itself stays fast; download is cached.
- Each platform ships only its own dylib (Mac universal, Win x64, Linux x64).

Cons:
- Adds ~10 MB per platform to the bundle.
- One extra file alongside the executable (Tauri's bundler handles
  this on Mac/Win cleanly; Linux AppImage needs RPATH or `$ORIGIN`
  config).

### Option B — Statically linked

- Use pdfium-render's `static` feature.
- `build.rs` downloads the bblanchon **static** archive (`libpdfium.a`
  on macOS/Linux, `pdfium.lib` on Windows), sets `PDFIUM_STATIC_LIB_PATH`
  env var, plus link flags for the platform-specific extras
  (CoreFoundation/CoreGraphics on Mac, gdi32 on Win, etc.).
- Final binary is one file, ~30 MB larger.

Pros:
- One file to ship per platform. Cleaner artifact.

Cons:
- Static archives are 100-300 MB at compile time; link step is heavy.
- Platform-specific link flags are fragile (the bblanchon README
  documents them but they drift across pdfium versions).
- pdfium-render's `static` mode has historically been less-trodden
  than dynamic; bug surface is higher.
- Re-link on every Rust build that touches the binary (incremental
  iteration gets slower for everyone on the team).

### Recommendation

**Dynamic (Option A) for v1.** It's the well-trodden path, lets us
start working today without fighting build-system battles. Static
remains additive — `pdfium-render` supports both behind a feature
flag, so we can switch if the dylib-bundling causes pain on
Linux AppImage or Windows code-signing.

## Cross-platform staging

User's machine is Mac. The cleanest implementation sequence:

1. **Mac arm64** first — local dev loop fast, no remote CI required.
2. **Windows + Linux x86_64** next — `build.rs` already has the
   target_os/target_arch info; just add the download URLs and
   bundling paths.

The `build.rs` script picks the right archive based on `CARGO_CFG_TARGET_OS`
+ `CARGO_CFG_TARGET_ARCH`. Single source of truth; per-platform
forks live in `bblanchon/pdfium-binaries` releases, not in our code.

## Implementation steps

### Step 1 — Add pdfium dependencies + bundling

- `src-tauri/Cargo.toml`: add `pdfium-render = { version = "...", features = ["thread_safe"] }`
- `src-tauri/build.rs` (new): download the bblanchon prebuilt for
  the target platform, drop into `src-tauri/resources/pdfium/`.
  Skip if already present (cached).
- `src-tauri/tauri.conf.json`: add the resource path to `bundle.resources`.
- `.gitignore`: ignore the downloaded `src-tauri/resources/pdfium/`
  binaries.

### Step 2 — Tauri command `db_render_pdf_page`

```rust
#[tauri::command]
pub fn db_render_pdf_page(
    asset_id: String,
    page: u32,       // 0-indexed; v1 always passes 0
    max_width: u32,
    max_height: u32,
) -> Result<Vec<u8>, String> {
    // 1. Load asset bytes via existing storage::db_get_asset_by_id
    // 2. pdfium-render: parse, get page, render to PNG bytes at aspect-fit
    //    max_width × max_height
    // 3. Return PNG bytes
}
```

- Single shared `Pdfium` instance behind a `OnceLock` (thread-safe
  per the feature flag).
- Bind library at first-call: `Pdfium::bind_to_library(resolve_resource("pdfium/libpdfium.dylib"))`.

### Step 3 — Wire into `renderAsset`

Replace the `throw` in `src/lib/assetRenderer.ts::renderAsset`'s
`case 'pdf':` arm with a Tauri invoke:

```ts
case 'pdf':
  png = new Uint8Array(await invoke<number[]>('db_render_pdf_page', {
    assetId, page: 0, maxWidth, maxHeight,
  }));
  break;
```

That's it. The asset_cache write below is unchanged; the variant
stays `'_'` for v1 (page 1 only).

### Step 4 — Update SlideElementRenderer's PDF handling

`ImageBox` currently uses `useAssetUrl` (raw blob URL). PDFs can't
render as `<img src=blob:...>` — WebKit doesn't natively rasterize
PDFs inline. So:

- If `element.kind === 'pdf'`, use `useRenderedAsset(assetId, 'pdf',
  maxW, maxH)` instead (same hook the sidebar uses).
- Cache tier for the main canvas: use the slide's render-size
  dimensions (e.g. element.position.width × element.position.height,
  capped by zoom).

`PresentMode.PresentImage` + `presenter.tsx::PresenterImage` need
the same branch.

### Step 5 — Flip paste priority

Today: SVG > PDF in both the native pasteboard handler and the web
fallback (`PREFERRED_FORMATS` array in `SlideEditor.tsx`). Comments
in the source flag this as "flip when pdfium lands".

After PDF renders: keep SVG first (still higher-fidelity at scale
— text stays selectable in HTML export); PDF stays at #2 as a
better fallback than raster. So **no priority flip needed** — the
existing order is already correct once PDF actually displays.

### Step 6 — Tests

- Rust: tiny PDF fixture in `src-tauri/tests/fixtures/` (or generate
  one inline via pdfium itself). Test `db_render_pdf_page` returns
  PNG bytes that decode to non-zero dimensions.
- Mount test: ImageBox with `kind='pdf'` renders an `<img>` whose
  src is the cached PNG (mock the invoke call).
- Integration check on Mac: paste a PDF from Preview → see it on
  the slide.

### Step 7 — Inspector hint for multi-page PDFs (small UX)

Read page count from `db_get_asset_meta_by_id` (extend meta with
`page_count?: number` for PDFs only — populated at first render).
In `AssetSection`, when `meta.page_count > 1`, show:

> Page 1 of 7  ·  (multi-page picker coming soon)

This sets expectations honestly without committing to the picker.

### Step 8 — Update docs/ASSETS.md + LLM-EDITING.md

Bump the open-questions list (drop "PDF render path"). Document
`db_render_pdf_page` alongside the other `db_*` commands.

## Out of scope (deferred)

- **Multi-page picker UI** — per-page select, "open in new element"
  per page. Requires inspector page-list, per-page snapshotVariant
  rewrite, and a UX for choosing variants. Add when the user has
  a concrete multi-page-PDF workflow they want to support.
- **PDF text-layer extraction** — for in-app search across PDF
  contents. pdfium-render exposes text extraction; defer until
  search-across-PDFs is a user-asked feature.
- **Form fields / annotations** — render-only for v1.
- **Encrypted PDFs** — pdfium handles password-protected docs with
  an extra API call; defer until a real document needs it.

## Risks / open questions

- **Tauri resource paths at dev vs packaged** — the resource path
  resolution differs between `cargo tauri dev` (loose files) and the
  packaged bundle (inside `.app/Contents/Resources` on Mac).
  pdfium-render's load needs to handle both. Probably a small
  resolve helper.
- **Linux AppImage RPATH** — bundling a dylib next to an AppImage
  binary needs `$ORIGIN` in RPATH or LD_LIBRARY_PATH manipulation.
  May need an AppImage-specific wrapper script.
- **Windows code-signing** — code-signing a bundled DLL alongside
  the exe is straightforward but adds one more thing to sign in CI.
- **Build-time download** — if the bblanchon GitHub release is down,
  builds fail. Mitigation: vendor the URL in a constant, document
  manual fallback (drop the dylib in place by hand).

## Estimate

A focused day for Mac arm64: dependency + build.rs + Tauri command
+ renderer wire-up + the SlideElementRenderer branch + one Rust
test + manual paste test. Add ~half day each for Windows and Linux
once the Mac path stabilizes.

## First commit boundaries

To keep diffs reviewable:

1. **Add pdfium dep + Mac dylib download + Tauri command (no render yet)** — verify it loads, returns PNG bytes from a fixture.
2. **Wire into `renderAsset` + SlideElementRenderer** — ImageBox + PresentImage + PresenterImage branches for `kind === 'pdf'`.
3. **Inspector "page 1 of N" hint** — small UX, separate commit.
4. **Windows + Linux build.rs branches** — separate commit per platform once Mac is solid.

Branch stays `svg-pdf-image-cache`. Will push when user gives the OK.
