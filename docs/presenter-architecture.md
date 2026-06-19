# Present / presenter rendering architecture

How slides are rendered across the editor, the single-window present, the
dual-monitor presenter (speaker view + projector), and export — and why the
code is shared the way it is. The guiding rule: **as few renderers as possible,
each used everywhere it applies, with nothing window-specific re-derived.**

## The rendering contexts

There are four *kinds* of slide rendering. Two splits are genuine (you can't
collapse them); the rest is shared.

| Kind | Where | Code |
|---|---|---|
| **Editor** (interactive) | editor canvas | `SlideEditor` + `SlideElementRenderer` |
| **Live present** | single-window present **and** the projector window | `PresentMode` + `PresentSlide.tsx` |
| **Static** (frozen snapshot) | sidebar thumbnails **and** the dual-monitor speaker view | `SlideThumbnail.tsx` |
| **Export** | printable HTML / PDF (in-app) and the CLI/HTML exporter | `renderSlideForPrint` (App.tsx) / `exportCore.mjs` |

Shared atom across all of them: **`TextElementSvg`** renders text + per-preset
MathJax (an `<svg><foreignObject>` with math pre-rendered via the iframe pool).
That's the hard part (per-preset math fonts on one slide) and it is unified.

### Why live and static are separate
Live needs interactive iframes / running notebooks / playing video. Static must
use **cached PNG previews** for those heavy element types — you can't run 50
live demo iframes in a sidebar. So `PresentSlide` (live) and `SlideThumbnail`
(static) differ only on demo / notebook / video; text/image/arrow/cover are the
same idea (and text literally shares `TextElementSvg`).

### Why the CLI exporter is separate
`exportCore.mjs` runs in plain Node (the `eigendeck-cli` export tool), no React,
so it can't import the components. It mirrors the React output and is the one
place that must be kept in sync by hand (the source of past export-only bugs).

## One live viewer for both windows

The single-window present and the projector (secondary monitor) render the
**same `PresentMode`**. The projector is a *separate Tauri webview*
(`presenter.html` → `presenter.tsx`); it does NOT have its own renderer. It:

1. receives the presentation + navigation from the main window over Tauri events
   (`presenter:init` / `presenter:goto` / `presenter:update`),
2. drops the presentation into its (separate) store,
3. renders `<PresentMode controlledIndex={index} onExit={…}>`.

`PresentMode` is **controlled-or-self-driven**:
- **Uncontrolled** (no `controlledIndex`) = single-window: owns keyboard nav;
  Escape exits present mode.
- **Controlled** (`controlledIndex` set) = projector: index comes from the
  speaker window's events; keyboard nav is off; Escape calls `onExit` (close the
  projector window).

The slide-change transition runs in a `useLayoutEffect` keyed on the index, so
it fires identically for local navigation and for the controlled prop.

> **Gotcha — set the entering state before paint.** The transition MUST run in
> `useLayoutEffect`, not `useEffect`. A `useEffect` runs after paint, so the new
> slide paints once at opacity 1 (it isn't marked "entering" yet), then jumps to
> 0 and fades — a visible "pop, then fade." `useLayoutEffect` runs before paint,
> so the first painted frame is already opacity 0 (the start of the fade).

Element rendering itself lives in `PresentSlide.tsx` (`PresentElement`,
prop-driven, reads no store), used by `PresentMode` for both windows.

## One static renderer for sidebar + speaker view

`SlideThumbnail.tsx` renders a frozen, scaled snapshot of a slide (cached
previews for demo/notebook/video, `TextElementSvg` for text). It's used by the
`SlideSidebar` thumbnails and the dual-monitor speaker view (`SpeakerMode`'s
current/next-slide panes). The speaker view is the static renderer; the projector
is the live one — that's the genuine live-vs-static split in the dual setup.

## One bootstrap for both windows

Both window entries — `main.tsx` (main) and `presenter.tsx` (projector) — call
`initRuntime()` (`src/lib/runtime.ts`): inject `@font-face` for bundled fonts,
start Jupyter server discovery. Having one bootstrap is what stops the projector
silently missing setup the main window does (the cause of projector-only font /
math glitches).

## Math cache (why the projector needs warming)

The math renderer caches rendered SVGs in an **in-memory per-bundle pool**, and
write-throughs each to SQLite (`math_cache`). The cache is **per-webview**:

- The **main window** is warm because editing + sidebar thumbnails already
  rendered every expression into its pool.
- The **projector** is a fresh webview with an empty pool. So on
  `presenter:init` it calls `warmMathCacheFromSqlite()` to load the persisted
  SVGs; `TextElementSvg` also pulls cached math **synchronously** for its first
  paint (`renderMathInHtmlSync`) so warmed math is present in frame 1 rather than
  swapping in async.

> **Gotcha — the cache key includes the preamble.** `setMathPreamble` must NOT
> clear the pool cache: `mathCacheKey(tex, bundle, display, preamble)` already
> namespaces by preamble, so a preamble change can't serve a stale entry.
> Clearing it wiped the warmed-from-SQLite SVGs, forcing the cold projector to
> re-render and time out (5s) on complex display math → raw `$$…$$` spliced back
> in and overflowing the slide (the "mathjax spillover").

## Window close is scoped to `main`

Tauri's `CloseRequested` fires per window and `window.emit` is global. Close
handling is scoped to the `main` window (unsaved-changes check + quit). The
projector window emits `presenter:closed` (main leaves the dual-screen speaker
view) and closes itself — otherwise closing the projector ran the main window's
quit flow and killed the whole app.

## The bug class this eliminates

A *second rendering context* (the projector webview) that re-derives renderers,
bootstrap, and caches, and **diverges silently** — invisible because it needs a
real second monitor to exercise. Collapsing to one viewer + one bootstrap + one
static renderer means verifying the single-window present (and the sidebar) also
covers the projector and speaker view. The projector-unique surface is just a
thin event shim.

See also `DESIGN_DECISIONS.md` (preferences cascade, theme inheritance) and
`docs/sync-and-link.md` (cross-slide linked-object animations the live viewer
plays).
