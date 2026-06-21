# Eigendeck Export/Output Audit

Audit of every export path, end-to-end, with a stress-test deck exercising the
full matrix. Grounded in code read on the `main` branch + a headless HTML export
run on Linux via `tools/export-eigendeck.mjs` (same `buildExportHtml` core as the
app).

## Artifacts

- **Stress deck**: `/work/test-presentations/export-stress.eigendeck`
  (28 slides, 108 elements, 6 assets — schema v3, clean: no temporal/cache
  pollution). Built by `/work/tools/build_export_stress.py`.
- **Exported HTML** (for inspection): produced with
  `node tools/export-eigendeck.mjs test-presentations/export-stress.eigendeck out.html`
  → 18 MB, all assets inlined, 10 fonts embedded, 0 CDN font leaks.

## The three export paths

| # | Path | Entry | Core | Math | Notes |
|---|------|-------|------|------|-------|
| 1 | **Interactive HTML** | `exportPresentation` (`src/store/fileOps.ts:252`) → `buildExportHtml` (`src/lib/exportCore.mjs:169`) | shared `.mjs` | per-element SVG via `renderTextElement`/`makeTextElementRenderer` (`fileOps.ts:230`) | self-contained; live demos as srcdoc iframes. Also: CLI `src/export-cli.ts` + `tools/export-eigendeck.mjs` (legacy in-line text path). |
| 2 | **PDF (screenshots)** | `exportPdfScreenshots` (`src/App.tsx:150`) | `modern-screenshot` of `.slide-canvas` → `buildPdf` (`App.tsx:440`) | rasterized (whatever the live canvas shows) | needs the running webview; cannot run headless. |
| 2b| **PDF (print HTML)** | `printToPdf` (`src/App.tsx:224`) | own inline renderer (NOT `renderSlideForPrint`) | live-canvas screenshots for demo/video; vector text | writes HTML, user does Cmd+P. |
| 3 | **`renderSlideForPrint`** (`src/App.tsx:92`) | — | own inline renderer | none (raw `$..$`) | **DEAD CODE — no runtime caller** (only `src/__tests__/print-export.test.ts`). Often mistaken for the print path. |

## Matrix (rows = dimensions, cols = the 3 formats)

Legend: PASS / FAIL / CONCERN. Format 1 = Interactive HTML (`buildExportHtml`),
2 = PDF (both `printToPdf` print-HTML and `exportPdfScreenshots`), 3 =
`renderSlideForPrint` (dead).

| Dimension | 1 HTML | 2 PDF | 3 print(dead) | Reason / citation |
|---|---|---|---|---|
| **Slide theme background** (light/dark/black) | **FAIL** | PASS | PASS | `buildExportHtml` hardcodes `.slide{background:#fff}` (`exportCore.mjs:372-373`) and never emits a per-slide bg; the per-slide `theme` is read for text *color* only. `printToPdf` (`App.tsx:386`) and `renderSlideForPrint` (`App.tsx:145`) use `theme.background`. → On dark/black themes, exported HTML shows white text on white. |
| **Text color follows theme** | PASS | PASS | PASS | `makeTextElementRenderer` uses `themeColorForPreset` (`fileOps.ts:236`). Color is right — but on a white slide bg (bug above) light-theme text is invisible. |
| **Cover matches slide bg (explicit color)** | PASS | PASS | PASS | Explicit `el.color` honored everywhere. |
| **Cover with NO color → theme bg** | **FAIL** | PASS | PASS | `exportCore.mjs:315` falls back to `'#ffffff'`; print paths fall back to `theme.background` (`App.tsx:138,376`). A color-less cover on a dark slide exports white. |
| **All 9 fonts, per preset** | PASS | PASS | n/a | `buildEmbeddedFontFacesCSS` (`fonts.ts:44`) embeds used fonts as base64 `@font-face`; export verified to embed all 10 families with 0 googleapis leaks. `resolveFont`/`fontFamilyForPreset` applied per element. |
| **Math, per-preset font (cached)** | PASS | PASS | **FAIL** | HTML SVG path renders math per-bundle when `math_cache` is seeded (verified on `math-heavy`: 26/26 cache hits, 52 inline SVGs). PDF screenshots capture live canvas. `renderSlideForPrint` leaves raw `$..$`. |
| **Math when cache is COLD (offline export, never opened)** | **FAIL** | n/a | FAIL | CLI (`export-cli.ts`) + `tools/export-eigendeck.mjs` provide a `renderMath` that returns the raw `$$tex$$` on a cache miss **without throwing**, so `hasUnrenderedMath` (`exportCore.mjs:265-267`) stays false → the MathJax-CDN fallback is never injected → missed math stays as literal `$$\sqrt{\pi}$$` text in the output. Verified: stress deck (cold) → 52 misses, 0 MathJax fallback, raw `\sqrt` visible. |
| **Text presets (title/body/textbox/annotation/footnote/hype)** | PASS | PASS | PASS | All presets rendered; valign + font sizes resolved via `effectiveFontSize`. |
| **Image — raster (PNG/JPG)** | PASS | PASS | PASS | Inlined as data URL (`exportCore.mjs:284-294`). |
| **Image — SVG** | PASS (CONCERN) | CONCERN | PASS | Inlined as `data:image/svg+xml` (raw bytes). Works in `<img>`. CONCERN: editor displays the **rasterized** `asset_cache` PNG; export inlines raw SVG, so SVGs with external refs / unsupported features can differ from what the user saw. PDF print path inlines the same raw bytes. |
| **Image — PDF (kind=pdf)** | **FAIL** | CONCERN | FAIL | `getImageDataUrl` builds `data:image/pdf;base64,...` (`exportCore.mjs:148-160`) and drops it into `<img>` — a PDF data URL does not render in `<img>`. The editor shows the pdfium-rasterized `asset_cache` PNG (`src-tauri/src/pdf.rs`); export never consults `asset_cache`. Verified: 1 `data:application/pdf` in `<img>` in the output → blank. |
| **Demo (full, interactive)** | PASS | n/a→img | n/a | srcdoc iframe with sandbox (`exportCore.mjs:297-302`). PDF uses a cached/captured screenshot (`App.tsx:377-383`). |
| **Demo-piece (BroadcastChannel)** | PASS | n/a→img | n/a | Per-piece iframe + hidden controller iframe + parent postMessage relay (`exportCore.mjs:304-339`, relay `:425-433`). |
| **Notebook** | **FAIL** | **FAIL** | FAIL | `buildExportHtml`'s element switch has **no `notebook` case** (`exportCore.mjs:243-326`) → silently dropped (verified: 0 iframes/imgs on the notebook slide). `printToPdf` also omits notebook: every branch keys on `demo/demo-piece/video` only (`App.tsx:248,306,377`), and the `slideHtmls` loop (`App.tsx:338-387`) has no notebook branch → dropped in print-HTML too. `renderSlideForPrint` likewise (`App.tsx:139-143`). Notebook is unsupported in ALL export paths. |
| **Video (file or embed)** | **FAIL** | CONCERN | FAIL | No `video` case in `buildExportHtml` → dropped. Verified: video slide has no embed/iframe. `printToPdf` handles video as a screenshot (`App.tsx:377`); `renderSlideForPrint` renders a "▶ Video" placeholder (`App.tsx:141`). |
| **Arrow** | PASS | PASS | PASS | SVG line+polygon (`exportCore.mjs:317-325`; print `App.tsx:366-374`). |
| **Element opacity / borderRadius / shadow / rotation** | PASS | PARTIAL | PARTIAL | HTML honors all four for images (`exportCore.mjs:290-293`). `printToPdf` honors shadow/radius/opacity but **not rotation** for images (`App.tsx:357-365`); text rotation handled. |
| **Footer (author · venue · number)** | PASS | n/a | n/a | `exportCore.mjs:341`. Not in PDF/print. |
| **Round-trip (embedded source)** | PASS | n/a | n/a | base64 deck JSON embedded (`exportCore.mjs:356-358,417`), re-imported by `importFromHtml` (`fileOps.ts:310`). |

## Prioritized bugs to file

### P0 — wrong output, silent, hits common decks

1. **HTML export ignores per-slide/deck theme background (white-on-white).**
   `buildExportHtml` hardcodes `.slide { … background: #fff; }`
   (`src/lib/exportCore.mjs:372-373`) and emits each slide as a bare
   `<div class="slide">` with no per-slide background. The per-slide `theme` is
   only consulted for *text color* (`fileOps.ts:236`). Any deck using the light,
   dark, or black theme exports with a white background — dark-theme white text
   becomes invisible.
   *Repro:* open any `theme-dark`/`theme-black` deck (or `export-stress` slides
   3–9) → File ▸ Export HTML → slide bg is white.
   *Fix:* resolve `theme.background` per slide (as `printToPdf`/`renderSlideForPrint`
   already do) and emit it as an inline style on the `.slide` div, or pass it
   through `buildExportHtml`. The renderers in `App.tsx:145` / `App.tsx:386`
   are the reference.

2. **Notebook elements are dropped from EVERY export path.**
   `buildExportHtml`'s element `switch` (`src/lib/exportCore.mjs:243-326`) has
   no `case 'notebook'` (verified: 0 iframes/imgs on the notebook slide).
   `printToPdf` keys all its branches on `demo/demo-piece/video` only
   (`App.tsx:248,306,377`) and its `slideHtmls` loop (`App.tsx:338-387`) has no
   notebook branch; `renderSlideForPrint` likewise (`App.tsx:139-143`). So a
   notebook on a slide exports to nothing in HTML, PDF-screenshot, and
   print-HTML.
   *Fix:* render a static snapshot (the proactively-cached preview, as
   `printToPdf` uses via `previewCache` for demos) or at minimum the notebook
   source as formatted code; mirror what `SlideThumbnail` does for static
   contexts. Add the case to all three renderers.

3. **Video elements are dropped from HTML export.**
   Same missing-case as #2 — no `case 'video'` in `exportCore.mjs`. Both
   `file` and `embed` (YouTube/Vimeo/PeerTube) videos disappear.
   *Fix:* for `embed`, emit the provider iframe; for `file`, inline the asset
   as `<video>` (or a poster image).

4. **PDF-kind images render blank in HTML export.**
   `getImageDataUrl` (`src/lib/exportCore.mjs:212-225,148-160`) inlines the raw
   PDF bytes as `data:image/pdf;base64,…` into an `<img>`, which never renders.
   The editor shows the pdfium-rasterized PNG from `asset_cache`
   (`src-tauri/src/pdf.rs`) — export ignores that table.
   *Fix:* for `kind:'pdf'` (and ideally `kind:'svg'`), read the rasterized PNG
   from `asset_cache` and inline that, instead of the source bytes.

### P1 — wrong output in a narrower case

5. **Color-less cover exports white instead of the theme background.**
   `exportCore.mjs:315` uses `el.color || '#ffffff'`; the print paths correctly
   use `el.color || theme.background` (`App.tsx:138,376`). A bare cover on a
   dark slide exports as a white box.
   *Fix:* fall back to the resolved `theme.background`.

6. **Cold-cache offline HTML export leaves raw LaTeX (no MathJax fallback).**
   The CLI (`src/export-cli.ts`) and `tools/export-eigendeck.mjs` pass a
   `renderMath` that, on a `math_cache` miss, returns the raw `$$tex$$`
   **without throwing**. So `hasUnrenderedMath` (`exportCore.mjs:262-267`) never
   flips true and the MathJax-CDN fallback (`:346-353`) is never emitted →
   missed expressions stay as literal `$$\sqrt{\pi}$$` text.
   *Repro:* export a never-opened deck offline (`export-stress` cold) → 52
   misses, no MathJax, raw `\sqrt` on slides.
   *Resolution (chosen):* **delete the MathJax-CDN fallback entirely** — it was
   network-dependent, rendered with the wrong (default) font, not the deck's, and
   its `$…$` detector false-positived on prose like "$5 and $10". Exports are
   self-contained SVG: the GUI export pre-renders every box via the warm iframe
   pool, and the CLI (`export-cli.ts`) renders cache misses via WebKit
   (`renderMathInHtml`) — both cover all 10 shipped font bundles. Only the
   pure-Node `tools/export-eigendeck.mjs` test harness still ships `$tex$`
   verbatim on a genuine cold miss (no WebKit), which is honest and dev-only.
   See `docs/export-architecture.md` for why no export path needs MathJax at
   runtime.

### P2 — papercuts / hygiene

7. **Image rotation lost in the print-HTML PDF path.**
   `printToPdf` adds shadow/borderRadius/opacity to images but not
   `transform:rotate(...)` (`src/App.tsx:357-365`), unlike `buildExportHtml`
   (`exportCore.mjs:293`) and `renderSlideForPrint` (`App.tsx:121`). Rotated
   images print unrotated.

8. **`renderSlideForPrint` is dead code.**
   Exported from `App.tsx:92`, exercised only by `print-export.test.ts`; no
   runtime caller (the real print path is `printToPdf`'s own inline renderer).
   It's the most theme-correct of the three renderers, so it reads as "the print
   path" but isn't wired up. Either wire it into `printToPdf` (DRY + fixes #1/#5
   for free) or delete it so it stops masking divergence. The shared `.mjs`
   exporter and these App.tsx renderers are three near-duplicate renderers — the
   exact "diverges silently" class `docs/presenter-architecture.md` warns about.

## What still needs MANUAL verification (needs the webview / macOS)

- **PDF screenshot export** (`exportPdfScreenshots`, `App.tsx:150`): drives the
  live `.slide-canvas` through `modern-screenshot`. Can't run headless on Linux.
  Verify: theme backgrounds (it fills white before drawing — `App.tsx:198`, so a
  transparent-bg slide may flatten to white), demo/notebook/video current-state
  capture, and `buildPdf` output opening in a real PDF viewer.
- **`printToPdf`** (`App.tsx:224`): the print-HTML branch is reviewable (themes
  ✓, fonts ✓ via `buildEmbeddedFontFacesCSS`), but the demo/video live-capture
  flip-through and the Cmd+P→PDF page geometry (letter-landscape, 11in×6.1875in,
  1.15625in top margin) need a real run.
- **Interactive HTML demos in a browser**: srcdoc sandboxing + the
  BroadcastChannel postMessage relay (`exportCore.mjs:113-136,425-433`) need a
  browser to confirm demo-piece sync actually works post-export.
- The Mac `eigendeck-cli` binary (`src-tauri/target/release/eigendeck-cli`) is
  arm64 Mach-O — could not run on Linux. The Node tool was used as an equivalent
  driver of the same `buildExportHtml`.
