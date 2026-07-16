# 2026-07-16 — Demo slide-switch perf regression: root-cause + first fix

Continuation of the perf hunt from `2026-07-16-release-issues-clipboard-perf-session.md`.
Focus (per dgleich): the post-security demo-deck slowdown, in **present mode AND
slide-edit mode**. Branch `perf/demo-font-embed` (off `main`); not pushed/merged.

## Reproduced this session (headless rig, env-relative ms, fresh deck copies)
`graph-explorer` (4 slides: text / 1-demo / 2-demo / text), old `v26.6.24` vs `main`:

| activity            | old | new | ratio |
|---------------------|-----|-----|-------|
| rapidSlideNav (editor) | 26  | 96  | 3.7×  |
| presentAdvance      | 18  | 88  | 4.9×  |
| presentPrev         | 16  | 90  | 5.6×  |
| enterPresent        | 18  | 16  | ~1×   |

`enterPresent` unchanged → the cost is the **slide switch**, not steady state.
The present transition machinery predates security (present-view merged before
the isolation), so the only variable is **opaque-origin demo iframes**.

## Attribution (the real finding)
Custom per-transition diag (`selectSlide` A↔B, blobs warm) + a hook-neutralize
diag pinned the ~70 ms editor gap on a **font-free** demo (`graph-explorer`):
- **~28 ms** — the deck's `@font-face` (base64 `data:`, ~1.7 MB PT Sans) is
  spliced into every demo doc (opaque origin can't fetch `/fonts`) and **re-parsed
  on every mount**. For `graph-explorer` the demo names no deck font, so this was
  pure waste.
- **~7 ms** — `useDemoInternetBlocked` per-mount dynamic imports + re-check.
- **~35 ms** — inherent opaque-origin mount: fresh context + bridge handshake +
  demo re-exec. Not reducible in JS.

Present: `selectSlide` (no transition) is flat ~33 ms in BOTH builds; the
`presentAdvance` extra is the 300 ms cross-fade compositing both slides' demos
(ArrowRight path sets `prevIndex`/`animating`; `selectSlide` doesn't).

Rig caveat: software-GL over-weights iframe compositing → magnitudes ≠ Mac.

## Shipped (branch `perf/demo-font-embed`, committed, NOT merged)
1. **`perf(demos): only embed deck @font-face into demos that name a deck font`**
   (0cb3351) — `demoReferencesFonts(raw, fontFacesCss)` in `demoTheme.mjs` gates
   the embed in `getDemoDocumentUrl` (`demoMount.ts`). Embeds only when the demo
   names `--eigendeck-font/narrow/mono` or a declared family (#86 preserved).
   Measured `graph-explorer`: rapidSlideNav **96→68**, presentAdvance **88→79**.
   Tests: `demoTheme.test.ts` +5 cases; e2e `demo-theme-deck-verify` 40/40,
   `demo-theme-scenario` 40/40, `demo-theme-verify` green. `tsc`+full vitest green.
2. **`docs(perf): record the demo-switch regression attribution`** (26ec64f) —
   the breakdown above in `docs/perf-report.md`.

**Caveat on real decks:** `magnetic-powers` (6/8 demos name fonts) and `welcome`
(4/5) mostly DON'T benefit — they still pay the ~28 ms font re-parse.
`magnetic-powers` old 56/17 → new+fix 119/74 (still 2–4×).

## Remaining levers (need dgleich's call + Mac validation — NOT done)
- **A. Demo-iframe pool** — keep demo iframes mounted (hidden) across slide
  switches, keyed by `assetId`; removes the ~35 ms inherent mount for ALL demos,
  editor + present. Biggest win but a deep change to the security-critical demo
  lifecycle; **must Mac-profile first**.
- **B. Shrink the embedded font payload** — WOFF2 (no tooling in the container;
  needs the update-fonts pipeline) or embed only declared weights. Helps the
  font-USING majority (~28 ms), cross-platform, moderate effort.
- **C. Internet-block per-mount caching** (~7 ms) — small, touches the security
  path; low priority.

## What's per-mount vs cached (base64 is NOT re-encoded)
Traced every call site to be sure the embed cost isn't wasted re-encoding:
- `bytesToBase64` runs only inside `buildEmbeddedFontFacesCSS` (`fonts.ts`).
- For the LIVE demo path that's reached only via `deckFontFacesCss` (`demoMount.ts`),
  memoized by the deck's font signature (`fontCssCache`) → the base64 encode runs
  **once per deck-font-set per session**, not per mount.
- The spliced demo document (base64 already inline) is cached as a blob URL in
  `docBlobCache`, keyed by asset+role+capture+net+theme+fonts → the splice +
  `createObjectURL` also run **once per key**, reused across mounts.
- So per mount our JS does ZERO encode/splice work; it reuses the same blob URL.
  The ONLY per-mount cost is browser-side: parsing the big `data:` URL text into
  the CSSOM on each fresh iframe load, plus the (inherent, unavoidable) font
  decode when glyphs render. WOFF2 shrinks the PARSE payload (~1.7MB→~0.7MB of
  base64), not any re-encode.

## If/when demos move to a real Tauri origin — MUCH of this may be undone
This whole font-embed machinery exists ONLY because demos are **opaque-origin**
blob iframes that can't fetch app-origin `/fonts` (docs/DEMO-PLATFORM.md). If
demos are ever served from a real Tauri origin (a custom protocol / asset origin
with a stable, app-controlled origin), the tradeoffs flip:
- Demos could load fonts by normal `@font-face { src: url('/fonts/…woff2') }` /
  `<link>`, and the **browser font cache would hold ONE decode across every demo
  mount** — eliminating the per-mount parse AND decode entirely. That is a bigger
  win than anything here.
- **Then these become unnecessary / should be reverted:** the base64 font embed
  in `buildEmbeddedFontFacesCSS` for the demo path, the `demoReferencesFonts`
  gate (commit 0cb3351), and the WOFF2-into-base64 embed (commit cf08ee5). Keep
  the WOFF2 FILES + generator (`tools/build_font_woff2.py`, setup wiring) — serving
  `.woff2` by URL is still the right call; only the *inlining* goes away.
- A real origin may also restore same-origin comms (BroadcastChannel) and remove
  the rAF-throttle workaround → the parent **relay + rAF pump** (`demoMount.ts`)
  and part of the ~35 ms inherent-mount cost could go too. Re-measure then.
- The `injectDemoTheme*` vars-splice can stay (cheap) or move to a served stylesheet.
- **Net:** treat commits 0cb3351 + cf08ee5 as *opaque-origin-era* mitigations. The
  durable artifacts are (a) the perf-report attribution, (b) the WOFF2 files +
  generator, (c) the finding that the real fix is "don't re-mount / don't re-embed"
  — which a Tauri origin delivers for free. Revisit both commits at that migration.

## Resume pointers
- Old build present: `/tmp/el-old-target/debug/eigendeck` + `/tmp/el-old` worktree
  (`v26.6.24`); new binary `/tmp/el-target/debug/eigendeck`. Both dists carry the
  seam. Rebuild dist after any frontend change: `VITE_EIGENDECK_SEAM=1 npm run build`.
- Perf-suite reproduces cleanly; the per-transition diag (delete-after) lived at
  `e2e/perf-switch-diag.mjs` / `e2e/perf-jank-diag.mjs` (removed; logic in git of
  this session if needed).
- Decision pending: pursue A (iframe pool, needs Mac) or B (font payload) next,
  or stop and Mac-validate the shipped fix before more.
