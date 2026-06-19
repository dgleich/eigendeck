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
  speaker window's events. Keyboard nav still works but is *forwarded*: a key on
  the projector emits `presenter:nav` to the main window, which navigates and
  echoes `presenter:goto` back (one source of truth — the projector never sets
  its own index). Escape calls `onExit` (close the projector window).

The slide-change transition runs in a `useLayoutEffect` keyed on the index, so
it fires identically for local navigation and for the controlled prop.

> **Gotcha — set the entering state before paint.** The transition MUST run in
> `useLayoutEffect`, not `useEffect`. A `useEffect` runs after paint, so the new
> slide paints once at opacity 1 (it isn't marked "entering" yet), then jumps to
> 0 and fades — a visible "pop, then fade." `useLayoutEffect` runs before paint,
> so the first painted frame is already opacity 0 (the start of the fade).

Element rendering itself lives in `PresentSlide.tsx` (`PresentElement`,
prop-driven, reads no store), used by `PresentMode` for both windows.

### The transition renders ONE stable-keyed list — don't re-bucket
The slide-change transition classifies each element (fading in, animating
position via a linked partner, static cover / carried-over element) but renders
**all current-slide elements from a single list over `slide.elements`, keyed by
`el.id`, in true z-order** — the per-element *style* encodes its role. Leaving
elements (on the previous slide only) are a separate transient list.

> **Gotcha — never move an element between separate `.map()` blocks across the
> transition.** The original code rendered four buckets (fade-out / linked /
> fade-in / unlinked) as separate lists, each with bucket-relative z-indices. A
> linked element (e.g. a title or demo that animates across slides) lived in the
> fade-in/linked block *during* the transition and the unlinked block *after*
> settle — a different list, so React **unmounted and re-created it**. Two bugs
> fell out of this:
> - **z-jump**: bucket-relative z (linked +10, unlinked +200) didn't match true
>   z-order, so a linked title sat *under* its unlinked image mid-transition,
>   then snapped on top at settle ("image fades in on top, then jumps behind").
> - **iframe flash**: re-creating a `demo`/`video`/`notebook` element reloads its
>   iframe → one blank frame as it finishes fading in.
>
> One stable-keyed list fixes both: an element never changes key or tree
> position, so iframes are never remounted, and z-index is always true z-order.

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

> **Gotcha — the WRITE and READ paths must key by the SAME preamble.** Because
> the key includes the preamble, the cache only works if the write uses the same
> preamble string the read uses. `renderMathInHtml` (write) must pass the deck
> preamble through to `renderMath` — it once didn't, so writes keyed under `""`
> while `renderMathInHtmlSync` / warm-from-SQLite read under the real preamble.
> Result: a 100% cache miss in present mode → every expression re-rendered live
> → custom-macro math failed (preamble not yet registered) → raw-LaTeX cruft on
> slides that render fine in the editor. Keep the key consistent across paths.
>
> Relatedly, `setMathPreamble` waits for the iframe to ACK that the preamble is
> registered (`preamble-applied`) before renders proceed — otherwise a fresh
> window renders custom-macro math before the macros exist.

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
