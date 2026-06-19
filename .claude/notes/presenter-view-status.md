# Presenter-view work — status / handoff (for a context reset)

Last updated 2026-06-19. Companion to `presenter-architecture.md` (the design /
principles); THIS file is "where we are right now."

## Branch
`fix/presenter-view` — **NOT merged to main**, pushed. Tip `bf6fc01`.
Verify: `git log --oneline main..fix/presenter-view`.

## Goal
The dual-monitor presenter had a pile of bugs (demos broken on the projector,
font glitches, raw-LaTeX "mathjax spillover", quit-on-close, different
animations / flashes). Root cause class: the **projector is a separate Tauri
webview** (`presenter.html` → `presenter.tsx`) that re-derived everything and
diverged. The fix arc unifies it. User wants the two windows to be the SAME
viewer, and to "architect out" this class of bug.

## Commits on the branch (oldest→newest)
- `d0dfcf0` unify renderers (PresentSlide.tsx live, SlideThumbnail.tsx static) +
  speaker view uses SlideThumbnail + speaker notes + scope close-handling to
  the `main` window (fixes closing projector quitting the app).
- `e177bbf` View → **Test Present (1-window)** debug (`eigendeck:test-present-single`).
- `baa5d64` inject fonts (+server discovery) in the projector.
- `bfaa35d` warm math cache from SQLite on `presenter:init`.
- `01130b3` stop `setMathPreamble` clearing the SVG cache (key already includes
  preamble; the clear wiped the warm → spillover).
- `c97cd95` **#3**: projector renders the REAL `<PresentMode>` (controlled by
  events) — `PresentMode` gained `controlledIndex`/`onExit`; transition moved
  out of `goTo`; shared boot `src/lib/runtime.ts initRuntime()` (main.tsx +
  presenter.tsx); removed PresentSlideStage/Content.
- `ac85a7b` design note (`presenter-architecture.md`).
- `9932dfd` `renderMathInHtmlSync` + TextElementSvg paints cached math on first
  frame (no raw→SVG swap). [addressed a misread symptom; harmless, keep or revert]
- `bf6fc01` **the real flash fix**: transition trigger is `useLayoutEffect` (not
  `useEffect`) so the entering slide is set to opacity 0 BEFORE paint — was
  painting at opacity 1 then fading = "pop then fade."

## Architecture now (the target)
- **B / live viewer = `PresentMode`** for BOTH single-window and projector
  (`presenter.tsx` renders `<PresentMode controlledIndex onExit>`). Element
  rendering in `PresentSlide.tsx` (`PresentElement`, prop-driven).
- **C / static = `SlideThumbnail.tsx`** for sidebar AND speaker view.
- **One bootstrap** `initRuntime()` (fonts + server discovery), both entries.
- Live vs static stay separate by design (can't run live demo iframes in a
  thumbnail grid).

## OPEN / ACTIVE QUESTION (where we left off)
User reported the 2-window "pop then fade" flash; `bf6fc01` fixes it via
useLayoutEffect. User asked "why didn't this hit the 1-window too?" My answer:
**it should have — no code asymmetry** (both controlled + uncontrolled run the
same transition effect). Likely they tested 1-window on a build BEFORE #3
(`c97cd95`) introduced the post-paint effect, so 1-window was still on the old
synchronous `goTo` (no pop). **Needs user to re-test BOTH 1-window and 2-window
on `bf6fc01`** — both should fade with no pop. If 2-window still pops but
1-window doesn't on the same build, the symmetry assumption is wrong and there's
a projector-specific cause (event→setIndex landing a tick later) — gate the
projector's first paint until the index is applied.

## Remaining hardening (proposed, NOT done)
1. **Contain failure**: a failed/un-rendered math element must not overflow the
   slide. `TextElementSvg` uses `overflow:visible` (italic ink overhang) — scope
   the clip so the raw-source fallback can't spill. (Defense for the spillover.)
2. **Pre-render-before-present gate**: render all deck math into the cache when
   entering present (both windows) + surface failures at authoring time, so
   neither window is ever cold. Makes it deterministic vs "usually warm."

## Gotchas / constraints
- **Can't verify the projector headless**: the e2e rig is single-window; opening
  a 2nd Tauri webview / Tauri events don't work there. BUT after #3, single-
  window present uses the SAME `PresentMode`, so verifying 1-window in the rig
  covers the shared code. Projector-only behavior (events, window) needs the Mac.
- **No ffmpeg** in this sandbox (apt + pip blocked) and recordings under
  `gitignore/` don't sync into `/work` — can't extract video frames here.
- Math cache: the editor write-throughs SVGs to SQLite (`math_cache`); the
  projector warms from it. In-memory `pool.cache` is per-webview.
- Debug menu items View → "Test Present (1-window)" / "Test Presenter
  (2-window)" + window events `eigendeck:test-present-single` /
  `eigendeck:test-presenter` ({skipWindow} for speaker-only e2e). **Remove both
  before shipping.**
- e2e rig: `/tmp/run-probe-stable.sh` + probes in `/tmp/cz/` (present.mjs MODE=
  present|speaker, single.mjs, nav.mjs). E2E_DECK=a deck path. Speaker view
  screenshots work; present-mode screenshots hang (use state-check probes).

## Next steps when resuming
1. Get the user's re-test result (1-window vs 2-window on bf6fc01).
2. If clean → optionally do the two hardening items, then merge fix/presenter-view → main.
3. Decide whether to revert the `9932dfd` sync-math commit (harmless) or keep.
4. Remove the temporary "Test …" debug menu items before merge/ship.
