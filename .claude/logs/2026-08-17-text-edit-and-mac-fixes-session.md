# 2026-08-17 — Critical text-edit loss + two Mac fixes (#177 / #178 / #179)

A run of three bug fixes off v26.8.10, all merged to main. Two of the three
(HEIC, wake lock) are macOS-runtime behaviors that can't be asserted in the Linux
e2e rig and are pending a Mac spot-check.

## #177 — CRITICAL: text edit lost when clicking New Slide (`ba1b542`)

**Symptom:** editing a text box (contentEditable, cursor still inside — not clicked
away), then clicking **New Slide** silently discarded the edit. Data loss.

**Root cause:** text edits aren't committed per keystroke (`onInput` only does
arrow/dash auto-replace); the typed text lives in the DOM until a commit fires
(outside-click / Escape / the commit-on-unmount in `SlideElementRenderer`).
`addSlide` moves `currentSlideIndex` to the new blank slide FIRST; React then
unmounts the old text element, and its commit-on-unmount calls
`updateElement(id, {html})` — but `updateElement` looked for the element only on
`slides[currentSlideIndex]` (now the NEW slide), didn't find it, and no-op'd
(`presentation.ts:526`). The edit was dropped.

**Fix:** `updateElement` now finds the element on its **own** slide (ids are unique
across the deck) instead of assuming the current index, so a commit that fires
after the slide changed still lands. Only the not-on-current-slide path changed.
Tests: unit (`presentation.test.ts` — fails before, passes after) + e2e
(`text-edit-newslide-probe` drives edit→New-Slide in real WebKit for BOTH the
store/keyboard path and the "+ Add Slide" button). Full e2e 117/117.

## #178 — Can't paste an HEIC image copied from Preview (`b1d8bd8`)

**Symptom (macOS):** copy an HEIC in Preview → paste into Eigendeck → nothing.

**Root cause:** the paste handler (`SlideEditor` native NSPasteboard path
`NATIVE_PREFER` + the clipboardData items path) only recognized PNG/JPEG/GIF/WebP/
SVG/PDF. Preview offers a copied image as **HEIC** (`public.heic`) and/or **TIFF**
(`public.tiff`); neither matched, it isn't a copied file, so the paste no-op'd.
(The comment even claimed "SVG/PNG/TIFF are untouched" but TIFF was never in the
list.)

**Fix:** added `public.heic`/`heif` + `public.tiff` to the native paste
preferences, **transcoded to PNG via the WebView** (new `src/lib/imageTranscode.ts`:
`<img>` → canvas → `toBlob('image/png')`) so the stored asset renders everywhere
(present, export, non-Mac), not just Mac WebKit. `ext:'png'` keeps the existing
`preferOwnRender` skip applying. Falls through gracefully if the WebView can't
decode. Also: a paste that matches NOTHING now `console.warn`s the available native
UTIs + clipboard item types — so any future unhandled format is diagnosable
without a rebuild. Verified the canvas transcode mechanism in a real browser
(JPEG→PNG). HEIC decode is Mac-WebKit-only → Mac spot-check pending.

## #179 — Present mode doesn't keep the display awake (`972782a`)

**Symptom (macOS):** the screen dims / screensaver starts mid-talk. David thought
there was old wake code — there wasn't (confirmed: no wakeLock / caffeinate /
IOPMAssertion anywhere in the tree OR git history; `git log -S` found nothing). A
genuine gap, not a regression.

**Fix:** `useScreenWakeLock` (`src/lib/useWakeLock.ts`) requests a Screen Wake Lock
while active, releases on exit, re-acquires on `visibilitychange` (the OS drops the
lock when the doc hides). Wired into `PresentMode` — which BOTH the main present
view and the projector window (`presenter.tsx`) render, so both stay awake.
Feature-detected + best-effort (no-ops where `navigator.wakeLock` is missing).
Tests: unit (acquire/release/re-acquire/no-op, mocked) + present-visual e2e still
renders. Actual display-stays-on is a WKWebView runtime thing → Mac spot-check
pending. If WKWebView ignores the web API, fallback is a native power assertion /
`caffeinate`.

## State

- main = `972782a`. Three fixes stacked since v26.8.10; no new beta cut yet.
- Also this arc (earlier): #165 addSlide-after-build, #110 footer e2e, SPEC audit,
  website review + manual updates + favicon + LLM-generated marker.
- Paused: the live-Korean-captions feature (brainstorm reached "throwaway prototype,
  Python captions sidecar → Rust bridge → Present-mode caption bar"; two confirms
  still owed — English→Korean, Korean-only vs bilingual).
