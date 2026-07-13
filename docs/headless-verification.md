# Headless verification — what an agent CAN check without the Mac

This repo runs in a Linux container (CI-like). A lot *can* be verified headlessly
here — including things that feel "app-only." Reach for the right tier below
**before** deferring to a human Mac smoke test. Default to "I can check this"
unless it hits the genuinely-Mac-only list at the bottom.

## The tiers (weakest/fastest → strongest/slowest)

### 1. `vitest` (jsdom) — unit + component
- **Can:** pure functions; the export/print HTML **builders** (`buildExportHtml`,
  `buildPrintSlideHtml`) as strings; React components via
  `@testing-library/react` (render, fire events, assert DOM, spy on calls).
- **Cannot:** rasterize. jsdom parses the DOM but never lays out or paints, so
  anything that turns DOM → pixels (`modern-screenshot`'s `domToDataUrl`, canvas
  pixels, real font metrics) must be **mocked**. Cannot run Tauri `invoke`.
- **Corollary:** a screenshot/preview bug is usually a *cache-key / wiring* bug you
  test at the data level (e.g. "theme change → new salt → re-capture"), not a
  pixel bug — jsdom can't see pixels anyway.

### 2. Playwright + headless Chromium — real rendering
- **Can:** render HTML → **PNG** (`page.screenshot`), run real browser JS in the
  page (so `modern-screenshot`, `<canvas>`, and WebGL via **swiftshader** all
  work), produce a real **PDF** (`page.pdf()`), emulate print media
  (`emulateMedia({media:'print'})`). This is how the export/print *visual* checks
  and the demo WebGL checks run.
- **How:** committed tests are gated (`EIGENDECK_RENDER=1`); resolve
  `playwright-core` + a chromium exe (see `src/lib/exportRender.test.mjs`;
  container path `/tmp/pw/...` and `~/.cache/ms-playwright/.../chrome`, launch with
  `--no-sandbox --disable-gpu --use-gl=swiftshader --enable-unsafe-swiftshader`).
  See the `demo-browser-verify` reference for the 3-iframe demo harness.
- **Cannot:** it's **Chromium**, not the app's WebKit — good for "do the pixels
  paint / is the layout right," not for WebKit-specific rendering nuances.

### 3. The e2e Tauri rig — the **real app**, headless (`eigendeck-e2e` skill)
- **This runs the actual Eigendeck app** in real **WebKitGTK** under
  `tauri-driver` + `WebKitWebDriver` + `xvfb`, with real `invoke` and real SQLite.
  Do NOT say "this runs in the live app, so I can't test it" — *this is* the live
  app, headless.
- **Can:** the full frontend↔Rust boundary; the real export pipeline
  (`buildPresentationExportHtml`) driven through the `window.__eigendeck` seam;
  notebook/overlay/persist round-trips; anything the seam or a launch-arg can
  reach. Screenshots via the WebDriver `/screenshot` endpoint.
- **Cannot:** drive **native dialogs** (Open / Save As / the Print→PDF dialog) —
  work through the seam or launch args instead. Cannot run **macOS-native** code
  (it's WebKitGTK/Linux; see below).
- **Build:** `VITE_EIGENDECK_SEAM=1 npm run build` + `CARGO_TARGET_DIR=/tmp/el-target`;
  full provisioning + gotchas in the `eigendeck-e2e` skill.

### 4. `eigendeck-cli` — headless deck build/inspect/edit
- Build a deck from JSON (`import json`), export HTML/JSON, bulk-edit — no GUI.
  The reliable way to construct fixtures (see the `eigendeck-cli` skill).

### 5. `cargo check` / `cargo clippy` — Rust
- Compiles/lints the **non-macOS** Rust here. Code behind
  `#[cfg(target_os = "macos")]` (the NSToolbar, native menu) does **not** compile
  on Linux — that part is Mac-only (below).

## What genuinely needs a Mac

Short list — everything else, prefer a tier above:
- **macOS-native code**: the `#[cfg(target_os="macos")]` NSToolbar, native menu +
  accelerators, proxy icon, window chrome. Can't compile or run on Linux.
- **The real macOS clipboard** (NSPasteboard flavors) end-to-end.
- **Final visual sign-off in the shipped WebKit** — the app renders in macOS
  WebKit; the e2e rig (WebKitGTK) is close, Chromium (Playwright) less so. For a
  pixel-perfect "does it look right on the actual app" call, the Mac is authoritative.
- The **Print → Save as PDF** *dialog UX* itself (but the print HTML, the
  `domToDataUrl` capture, and `page.pdf()` output are all checkable via tiers 2/3).

## Rule of thumb
Before writing "verify this on the Mac," ask: is it macOS-native code, macOS
clipboard, or a pixel-perfect WebKit judgment? If not, a tier above can check it —
build the harness instead of deferring.
