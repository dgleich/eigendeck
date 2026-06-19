# Presenter / present-mode architecture (and the bug class it eliminates)

Written 2026-06-19 on branch `fix/presenter-view`, after a run of bugs in the
dual-monitor presenter (demos broken on the projector, font glitches, raw-LaTeX
"mathjax spillover", quit-on-close, different animations/flashes).

## The bug class

A **second rendering context** — the projector window, a *separate Tauri
webview* (`presenter.html`) with its own JS context, module instances, caches,
and React root — that independently re-derives what the main window does, and
**diverges silently**. It's invisible because the projector needs a real second
monitor to exercise, so the rig can't see it. Sub-classes:

1. **Renderer drift** — a parallel slide renderer (the old `presenter.tsx`
   re-implemented element rendering) that breaks features the main one has
   (demos, demo-piece controllers, notebooks).
2. **Bootstrap drift** — the projector forgot setup `main.tsx` does
   (`injectFontFaces`, server discovery) → fonts/math glitches only there.
3. **State/cache divergence** — the projector is a *cold* webview: empty math
   pool, so it re-rendered every `$..$` and complex display math hit the 5s
   timeout → raw LaTeX spliced back in → overflow spill.
4. **Viewer drift** — the projector used a no-animation stage while the main
   used `PresentMode`'s transitions → different animations + hard-swap flashes.
5. **Cross-window event misrouting** — a global `check-close` emit hit the main
   window → closing the projector quit the app.

## How we architected it out

The principle: **one renderer, one bootstrap, one viewer — used by every
context; nothing window-specific re-derived.**

- **One LIVE viewer.** `PresentMode` is now THE live present view for both the
  single-window present AND the projector. The projector (`presenter.tsx`)
  renders `<PresentMode controlledIndex onExit>` — same transitions, same
  element rendering. (#3) Element rendering lives in `PresentSlide.tsx`
  (`PresentElement`), prop-driven, no store reads.
- **One STATIC renderer.** `SlideThumbnail.tsx` is the static snapshot used by
  the sidebar AND the dual-monitor speaker view. (Live vs static stay separate
  by design — you can't run live demo iframes in a 50-slide sidebar.)
- **One bootstrap.** `src/lib/runtime.ts` `initRuntime()` (fonts + server
  discovery) is called by both `main.tsx` and `presenter.tsx`. Add global boot
  steps there, once.
- **Controlled vs self-driven.** `PresentMode` takes `controlledIndex`/`onExit`:
  uncontrolled = main window (keyboard nav, Escape exits); controlled =
  projector (index from events, Escape closes the window). The transition fires
  on index change via a `useEffect`, so it animates identically in both.
- **Window-scoped close.** Rust `CloseRequested` is scoped to the `main` window;
  the projector emits `presenter:closed` and closes itself.

### Why this kills the class
Verifying the single-window present in the e2e rig now ALSO verifies the
projector — it's the same component + same bootstrap. The projector-unique
surface is just a thin event shim (populate store from `presenter:init/goto`,
warm the math cache, render `PresentMode`).

## The math cache (subtle, bit us twice)

The editor write-throughs every rendered SVG to SQLite (`math_cache`), so the
store of pre-rendered math already exists. Two things defeated reuse:
1. The projector wasn't warming it → added `warmMathCacheFromSqlite()` on
   `presenter:init`.
2. `setMathPreamble` did `pool.cache.clear()`, wiping the warm — and that clear
   was **unnecessary** because the cache key already includes the preamble.
   Removed it. Now persisted SVGs are actually used → no live re-render → no
   timeout → no spill.

## Remaining hardening (recommended, not yet done)

1. **Contain failure (defense in depth).** A failed/un-rendered math element
   must NOT be able to overflow its box. `TextElementSvg` uses
   `overflow:visible` (for italic ink overhang) — scope the clip so the
   *fallback* (raw source) can never spill across the slide. Trade-off: strict
   clipping trims a few px of ink overhang; scope it to the present/static
   renderers where the #61 ghost-trace concern doesn't apply.
2. **Pre-render-before-present gate.** Render every deck math expression into the
   cache before entering present / opening the projector, and surface failures
   at authoring time, not mid-talk. The store exists; this guarantees it's
   complete (today it relies on the editor/sidebar having rendered everything).

## Debug affordances (temporary)

- View → **Test Present (1-window)** — forces single-window present
  (`eigendeck:test-present-single`).
- View → **Test Presenter (2-window)** — opens the projector as a windowed,
  non-fullscreen second window on the same screen
  (`eigendeck:test-presenter`, `{skipWindow}` for speaker-only e2e).
Remove both before shipping.
