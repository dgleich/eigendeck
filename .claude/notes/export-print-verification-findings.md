# Export & Print WYSIWYG verification — findings

Audit of Eigendeck's TWO static export paths for element/style fidelity.

- **Path #4 — HTML export**: `buildExportHtml()` in `src/lib/exportCore.mjs` (pure).
  Three callers: app (`src/store/fileOps.ts` `buildPresentationExportHtml`), CLI
  (`src/export-cli.ts`), debug batch (`src/debug/batchExportHtml.ts`).
- **Path #5 — printable HTML / PDF**: `buildPrintSlideHtml()` in
  `src/lib/printSlideHtml.ts` (pure, px→inch), driven by `printToPdf()` in
  `src/App.tsx`.

Method: a pure vitest matrix harness exercising every (type × style) cell through
BOTH builders and asserting the property lands in the output; representative
headless renders (playwright chromium + swiftshader) rasterizing export/print HTML
to confirm pixels paint; source review of all three HTML-export callers for the
#85 wiring class. Harness + PNGs: `gitignore/export-audit/` (git-ignored).

**Result: 80/80 matrix cells pass. Both pure builders now carry nearly every
property.** The tree has been substantially refactored since the skill docs were
written — both paths route through shared descriptor/HTML/text helpers
(`elementDescriptor.mjs`, `elementHtml.mjs`, `textElementHtml.mjs`,
`arrowGeometry.mjs`, `textStyle.mjs`), which closes most historical drift. Two
findings remain: one real print-only bug (scaleMode), one #85 caller-wiring gap
(FIXED this session).

## Matrix (rows = element type × style; cols = HTML export / print-PDF)

Legend: ✓ carried & verified · ✗ dropped/wrong · N-A not applicable.

| Element × style | HTML export (#4) | Print/PDF (#5) |
|---|---|---|
| **text** bg color + opacity (rgba) | ✓ | ✓ |
| text boxTint / Card #132 (theme-relative) | ✓ | ✓ |
| text box-shadow | ✓ | ✓ |
| text effect (shadow/glow → text-shadow) | ✓ | ✓ |
| text custom padding | ✓ | ✓ |
| text vertical-align (middle/bottom) | ✓ | ✓ |
| text border-radius | ✓ | ✓ |
| text rotation | ✓ | ✓ |
| text explicit fontSize | ✓ | ✓ |
| text named fontSizeName | ✓ | ✓ |
| text accent color token | ✓ | ✓ |
| text inline rich (b/i/u/color/code) | ✓ | ✓ |
| text code-font on `<code>` | ✓ | ✓ (via app mark / mono) |
| text MathJax ($ / $$) | ✓ (app: iframe pool; CLI: math_cache) | ✓ (pre-rendered by caller) |
| text per-preset math font | ✓ | ✓ |
| **image** shadow / radius / opacity / rotation / object-fit | ✓ | ✓ |
| image kind:pdf → preview PNG | ✓ | ✓ (imageCache) |
| image missing asset | ✓ visible placeholder | ✗ **silently dropped** (low) |
| **arrow** heads end/start/both/none | ✓ | ✓ (was the #98 print gap — now FIXED) |
| arrow headSize / strokeWidth / color / opacity | ✓ | ✓ |
| arrow curved (c1/c2) + interior points | ✓ | ✓ |
| **cover** color / boxTint / theme-bg | ✓ | ✓ |
| **html** locked sandbox (no script/net) | ✓ | ✓ |
| html background → srcdoc + print-color-adjust | ✓ | ✓ |
| html content escaping | ✓ | ✓ |
| html scaleMode (contain-scale) | ✓ | ✗ **content clipped — units bug** (HIGH) |
| html `interactive` (pointer-events) | ~ not threaded (low) | N-A (no interaction in print) |
| **demo / demo-piece** | ✓ live iframe | ✓ baked screenshot |
| **notebook** app export | ✓ full-fidelity render | ✓ baked screenshot |
| notebook CLI export | ✓ preview PNG (#85 fix, present) | N-A |
| notebook cold (no cache) | ✓ "NB" placeholder | ✓ label placeholder |
| **video** embed (YouTube/Vimeo/PeerTube) | ✓ provider iframe | ✓ baked screenshot |
| video file (controls/loop/autoplay/muted) | ✓ `<video>` | ✓ baked screenshot |
| **fonts** embedded @font-face | ✓ app | (print embeds separately in App.tsx) |
| fonts embedded @font-face — **CLI** | ✗→✓ **was dropped; FIXED** (HIGH) | N-A |

## Findings detail

### F1 (HIGH) — CLI HTML export dropped embedded fonts — FIXED this session
`src/export-cli.ts` did not wire the `fontFacesCss` option that the app export
(`fileOps.ts:449,508`) and debug batch (`batchExportHtml.ts:38`) both pass. With
`fontFacesCss` absent, `exportCore.mjs:473` falls back to the **PT-Sans-only
Google Fonts CDN**. A deck using any other of the 10 families, exported from the
CLI, therefore rendered in a fallback face on any machine without that font and
depended on the network — diverging from the app export which embeds every used
font as a data URL. Textbook #85 (a capability added to exportCore but wired in
only some callers).
- Root cause: `src/export-cli.ts` `main()` options bag (before fix, ~line 150).
- `buildEmbeddedFontFacesCSS` (`src/lib/fonts.ts:46`) `fetch`es `/fonts/*` and
  already runs in this same hidden webview (the math-cache path fetches there),
  so embedding works headlessly.
- **Fix (committed `d4d595d`)**: wire `fontFacesCss: await
  buildEmbeddedFontFacesCSS(presentation)` in `export-cli.ts`, mirroring the app.
  Added exportCore contract tests (embedded ⇒ no CDN; CDN only when absent) and a
  source-parity guard `src/__tests__/export-cli-wiring.test.ts` pinning every
  shared capability the CLI must thread.

### F2 (HIGH) — Print scaleMode html clips its content — DOCUMENTED (needs decision)
An `html` element with `scaleMode` (contain-scale, #137) renders CORRECTLY in
HTML export but **clips in the print/PDF path** — only the top-left of the design
box shows, the rest is cut off. Verified by isolated headless render:
`gitignore/export-audit/scale-{export,print}-only.png` (a bordered 200×100 design
box fills its box cleanly in export; in print it is cropped to a corner).
- **Root cause**: `src/lib/printSlideHtml.ts:87-88` converts `designW/designH` to
  inches (`Lpx.designW * S`) before passing to `htmlElementScaledIframeHtml`. That
  sizes the **iframe's own viewport** in inches (200 slide-px → 1.1458in), but the
  content HTML inside is authored in **CSS px** (`width:200px` = 2.08in). One slide
  px = `11/1920`in ≈ 0.0057in, one CSS px = `1/96`in ≈ 0.0104in — a ~1.8× mismatch,
  so the px-authored content overflows the inch-sized iframe viewport, then
  `scale()` magnifies the overflowing corner.
- Why the DOM/export paths are fine: there slide-px **==** CSS-px (the slide is
  1920 CSS-px then transform-scaled as a whole), so `designW/designH` stay in px
  and content px matches (`SlideElementRenderer.tsx:481`, `PresentSlide.tsx:83`,
  `SlideThumbnail.tsx:121`, `exportCore.mjs:420` all size the iframe in px).
- **Why NOT auto-fixed**: the clean fix is unit-tangled and changes intended
  output. The scale-mode iframe must host px-authored content, so its viewport must
  be in **px** (design size, unconverted) while the wrapper box + offsets are in
  inches; a single CSS `transform: translate(<in>) scale(<ratio>)` can't mix an
  inch offset with a px-sized target cleanly, and the correct scale becomes
  `box.width_in ÷ (designW_px / 96)` (treat design px as CSS px, scale to the inch
  box) — a real redesign of the print scale math, not a mechanical mirror.
  Non-scaled html print is unaffected (verified: sandbox, background,
  print-color-adjust all correct).
- **Proposed fix (for review)**: in `printSlideHtml.ts`, keep `designW/designH` in
  CSS px and compute an inch-aware scale, OR wrap the scaled iframe in a px-unit
  sub-context. Add a `printSlideHtml.test.ts` case asserting the inner iframe
  width equals the design px (not the inch conversion) once the contract is chosen.

### F3 (LOW) — Print silently drops an un-cached image; export shows a placeholder
`printSlideHtml.ts:73-74` emits nothing when `imageCache.get(el.assetId)` misses
(`if (src) ...`), whereas HTML export (`exportCore.mjs:314-318`) emits a visible
"image"/"PDF" placeholder. In practice `printToPdf` (`App.tsx:278-315`) pre-loads
the cache for every image, so a miss only occurs on a caught asset-read exception
(missing/corrupt asset). Defensive-inconsistency only, not a live-deck bug.
- Optional fix: mirror the export placeholder in the `else` branch. Behavior-safe
  but adds a placeholder to a currently-empty slot — left for the user's call.

### F4 (LOW) — html `interactive` flag not threaded into export
The `interactive` flag (native script-less controls: `<input type=range>`,
`:hover`, `<details>`) drives `pointer-events` in the DOM paths
(`SlideElementRenderer.tsx:484` `live ? 'auto' : 'none'`) but is not consulted in
HTML export or print (`htmlElement.mjs` iframe has no pointer-events rule → default
`auto`). Effect: in HTML export a non-interactive html element still captures
pointer events, and there's no explicit gating. Harmless today (export has no
click-to-navigate, and an interactive element working is the desired case), but a
latent fidelity nuance if navigation-over-html is ever added. Document only.

## Known-gaps status (from editing-slide-elements "Known gaps")

| Gap (as documented) | Status | Evidence |
|---|---|---|
| Arrow `heads`/`opacity`/`headSize` dropped by **#5 print** | **NOW-FIXED** | Print routes `arrow` through `describeArrow`→`arrowGeometry`→`arrowSvgInner` (`printSlideHtml.ts:77`, `elementHtml.mjs:21`); matrix + render confirm end/start/both/none, opacity, headSize, curved all correct. |
| Same gap in **#6 link overlay / #7 thumbnail** | STILL-REAL (out of audit scope) | Those paths (`LinkOverlay.tsx`, `SlideThumbnail.tsx`) are not the two export/print paths under audit; not re-verified here. Doc note that #5 is now on the shared path stands. |
| Arrow default color split `#2563eb`/`#e53e3e` | RESOLVED for #4/#5 | `describeArrow` (`elementDescriptor.mjs:63`) owns the canonical `#2563eb` default; both export & print consume it. (Present/overlay still hard-code red but real arrows carry explicit color, so it never surfaces.) |
| Print (#5) genuinely diverges by design (inches, image shadow 4/8/16 vs editor, radius in inches) | AS-DESIGNED | `printSlideHtml.ts` header + snapshot gate pin these; image shadow is now the SHARED `imageVisuals` string (`elementDescriptor.mjs:43`), so shadow is actually IDENTICAL across targets — the "smaller 2px" note in the older doc is stale. |
| `assetUsage.ts` `isAssetBearing` omits `notebook`/`video` | Not re-verified (asset-GC concern, not an export/print render path) | Out of this audit's scope. |

## Recommended fixes (priority order)

1. **F2 print scaleMode (HIGH)** — needs a units-contract decision (see F2). This
   is the one real visual break in the two audited paths. Recommend fixing in
   `printSlideHtml.ts` + a `printSlideHtml.test.ts` assertion on the inner iframe
   design size.
2. **F1 CLI fonts (HIGH)** — DONE (`d4d595d`).
3. **F3 print image placeholder (LOW)** — optional defensive mirror.
4. **F4 html interactive (LOW)** — document; revisit only if export gains
   click-to-navigate.

## What was verified vs not

- Verified headlessly (pure builders + playwright render): all text/image/arrow/
  cover/html/live cells above, in white AND dark themes, gradients, Card tints,
  print-color-adjust, arrow heads/curves/opacity, scaleMode (caught the print bug).
- NOT run: the full Tauri app-seam export and the Rust-CLI→webview `export-cli`
  round-trip (needs the tauri-driver rig; the CLI binary at
  `/tmp/el-target/debug/eigendeck-cli` has no `export html` verb — HTML export is
  the hidden-webview `export-cli.ts`). The CLI wiring was audited by source +
  guarded by the new parity test instead. Paths #6/#7 (link overlay, thumbnail)
  are outside the two-path scope.
