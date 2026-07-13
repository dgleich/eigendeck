# Print fidelity, scale-mode, arrows, the test matrix, LLM-tools skills, notebook print fix (07-13)

Branch `feat/html-element` (local, unpushed). A long session continuing the html
element + arrow work, then a hard pivot into **export/print fidelity** and a
**tiered test matrix**, and finally the real **notebook-in-print** bug. Commits
`ec3d94d` → `1475919`.

## HTML "scale to fit" — reworked twice
- First shipped `scaleMode` as contain-scale (`2416b36`). Then the user: "scale to
  fit doesn't make sense — clicking it must be idempotent, based on a REFERENCE
  size, not the current box." → **fit the content's NATURAL size** (`780d54b`):
  `HtmlBox` measures the rendered content once (shrink the same-origin body to
  `max-content`, read the scroll extent, restore — no flicker) and stores it as
  `scaleW/scaleH`; the checkbox just toggles (off clears the size → re-measures).
  Chosen "uniform fit (contain)" via AskUserQuestion.
- Inspector cleanup (`84ede5f`): the "locked sandbox…" note + Interactive/Scale
  explanations became hideable `HelpText`; the two toggles merged into one
  "Options" section (plain checkboxes, not their own PropSections).

## Print/PDF fidelity — the real bugs
- **scaleMode clipping** (`114696c`): a scaled html element was sized in inches, but
  an iframe document always renders at 96 CSS-px/in, so its px canvas shrank ~2× and
  clipped. Fixed: size the iframe in CSS-px, contain-scale against `box*S*96`.
- **ALL html elements too big in print** (`e16c54b`): the deeper version — print
  positions elements in inches with NO slide transform (export CSS-scales the whole
  slide), so any html element's content printed ~1.8× too big. Fix: ALWAYS route the
  print html case through `htmlElementScaledIframeHtml` — size the iframe in CSS-px
  (design = natural size for scaleMode, else the box) and scale it down to the inch
  box. `htmlScaleLayout` now rounds output (clean CSS). Verified in a real headless
  print render (a fixed-layout text card matches its export proportions).
- Jupyter status icon/pill now deep-links to Settings → **Jupyter servers** tab
  (`ec3d94d`).

## Arrows — the "+ Point" saga finally settled
Several reverts here; the endpoint tangent HANDLES are a hard invariant.
- The endpoints kept their stored `c1/c2` while interior knots were Catmull-Rom, so
  a waypoint arrow "remembered its original slope." I tried making point-arrows PURE
  Catmull-Rom (derived endpoints, `ca4dbde`) — **user: "did I tell you to change the
  handles?!"** → reverted (`0b48851`).
- Correct fix (`d9f4bea`): `+ Point` just inserts a knot at the MIDPOINT of the
  longest segment (on the current curve, so no jump) and lets the interior re-smooth
  (Catmull-Rom); **c1/c2 handles are left UNCHANGED**. No parallel-tangent search, no
  handle scaling. Discussed C¹ vs a C² clamped spline — kept C¹ (local, predictable,
  less overshoot).
- **`docs/arrows.md`** (`db876ab`) documents the whole model + the INVARIANT: a
  curved arrow ALWAYS exposes its two endpoint tangent handles; never derive/hide/
  change them; only interior knots are handle-less.

## LLM-tools skills + Install LLM Tools rework
- `skills-public/` — a standalone (own `.git`, gitignored) published repo of public
  skills: **eigendeck** (umbrella/router), **eigendeck-cli**, **eigendeck-html-element**,
  **eigendeck-demo**, **frontend-slides-eigendeck**. Drafted in parallel by agents,
  scanned for portability.
- Reworked **File → Install LLM Tools** (`e245517` → `33eb93e` → `254e326`): the kit
  now ships the distilled **skills/** as the front door + **reference/** docs +
  an `AGENTS.md` ROUTER (not a doc dump). Canonical skills live at **`docs/skills/`**
  (committed, versioned with the app); `build.rs` assembles `skills/` + `reference/`
  into `resources/llm-tools/`; `llmtools.rs` copies the kit tree RECURSIVELY;
  `tauri.conf.json` bundles `**/*`. Only the 3 AUTHORING docs ship (LLM-EDITING,
  DEMO_AUTHORING, DEMO_SPEC) — **SPEC.md dropped** (broad product spec, not authoring).
  Skills ship WITH the app, not fetched. `skills-public` is now the mirror of `docs/skills`.
- Issues filed: **#137** (audit SPEC.md for staleness), **#138** (html-element feature
  tracker — the session's `(#137)`-tagged commits actually refer to #138).

## Export/print verification + the tiered TEST MATRIX (big)
- A background agent audited every element type × style across both export paths;
  found + fixed **F1** (CLI export dropped `fontFacesCss`, `d4d595d`, #85 class) and
  **F2** (print scaleMode clip). Report: `.claude/notes/export-print-verification-findings.md`.
- **Got the tests out of gitignore** (`8798262`): `exportMatrix.test.mjs` (80-cell
  type×style matrix, tier 1 = one-per-option, ALL element types) + `exportRender.test.mjs`
  (headless-Chromium rasterize, opt-in `EIGENDECK_RENDER=1`, self-skips) now run in
  the committed suite.
- **Three-tier generator** (`bf09639`): `pairwise.mjs` (`single`/`allPairs` greedy
  set-cover/`full`, unit-proven) + `exportMatrixGenerated.test.mjs` — a spec-driven
  runner: tier 2 (pairwise) in the default suite, tier 3 (full cartesian) via
  `EIGENDECK_FULL_MATRIX=1`. Seeded with **text** (7 options → 9 pairwise / 192 full).
  **Open:** tiers 2/3 only cover text so far; no font sweep; no openable test decks yet.

## Notebook cell output wrong in print — the actual bug
The user's key clue: **fine in editor/present/HTML-export, wrong ONLY in print HTML
export.** My first theory (rich outputs assume light bg, in `renderNotebookElementHtml`)
was WRONG — that's the HTML-export renderer, which is fine — reverted (`695bec4` →
`d148694`; also caught myself putting a repro test in gitignore again).
- **Root cause:** print BAKES notebooks as a raster SCREENSHOT (a cached preview
  PNG); the `capturePreview` effects in `NotebookContent` keyed on `[element]` /
  `[overlay]` but NOT the theme — and the theme is CSS vars on `.nb-frame`, so a
  theme switch never re-fired the capture → print served the STALE (light-theme)
  preview.
- **Fix** (`703fd17`): thread the deck theme into `capturePreview`'s salt + backdrop
  + both effects' deps (exactly how demos already do it); plumbed `themeSalt`/`previewBg`
  into `ExternalKernelBody`. **Guard** (`6ae594b`): `NotebookContent.preview.test.tsx`
  renders the shallow lite path with a `capturePreview` spy, asserts the theme is
  passed + a different theme → different salt. User confirmed via Mac smoke test.

## Capabilities doc (so I stop underclaiming)
- `docs/headless-verification.md` + AGENTS.md pointer (`1475919`) + a `feedback`
  memory: what CAN be checked headlessly here (vitest/jsdom → Playwright/Chromium →
  the **e2e Tauri rig = the real app headless** → eigendeck-cli → cargo). Only
  macOS-native code, the macOS clipboard, and pixel-perfect WebKit sign-off are
  genuinely Mac-only. "Runs in the live app" ≠ "can't test."

## Open / paused
- **Mac toolbar gap-shrink**: reverted (`8a069bf`) — flexible constraints made
  NSToolbar overflow items instead of compress. User chose a resize-driven dynamic
  gap; open decision = resize signal source (native `NSWindowDidResizeNotification`
  vs frontend `onResized` → Rust command). Title scale-up (320) kept. Needs the Mac.
- Test tiers 2/3 → expand past text (image/arrow/cover/html/live) + a font sweep;
  the openable all-elements/all-pairs/all-fonts test DECKS (discussed, not built).
- `skills-public` ↔ `docs/skills` are two committed copies (manual sync).
- Install LLM Tools `**` glob bundling + the notebook print fix's end-to-end both
  want a packaged Mac smoke (the latter already passed).
- Branch `feat/html-element` is local + unpushed (never push without an explicit ask).
