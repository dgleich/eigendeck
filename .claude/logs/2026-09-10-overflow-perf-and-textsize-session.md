# Overflow-badge JIT perf, 26.9.9 release, and text-size storage — 2026-09-10

Worklog / continuation state (a context reset is imminent). Covers three arcs:
a shipped release, a perf regression fully root-caused + fixed, an interrupted
welcome-deck investigation, and the CURRENT task (text-size storage).

## CURRENT TASK (resume here): store text sizes on new decks, like fonts

**Goal:** make new decks carry their text sizes the same way they already carry
fonts, so changing a global default never restyles existing decks. User approved
this. Then (secondary) decide the title default (62 vs 72).

**The gap (facts, verified in code):**
- Fonts ARE stored on every new deck: `createDefaultPresentation()`
  (`src/types/presentation.ts`) hardcodes `config.defaultTitleFont:'lato'` +
  `defaultBodyFont:'lato'` with the comment "so their look is stable if the
  default ever changes."
- Sizes are NOT: `createSeededPresentation()` (`src/store/presentation.ts` ~line
  145) seeds `config.textSizes` ONLY from the localStorage pref
  `eigendeck:pref:textSizes`, storing only non-empty keys. Shipped pref default
  is `{}` (`src/lib/preferences.ts:114`). So out of the box `config.textSizes` is
  left UNDEFINED → titles resolve to `DEFAULT_TEXT_SIZES.title = 72` at render.
- Cascade (`src/lib/textSizes.mjs` `effectiveFontSize`): `element.fontSize` >
  `element.fontSizeName` > deck `config.textSizes[name]` > `DEFAULT_TEXT_SIZES`.
- `DEFAULT_TEXT_SIZES` = {footnote:24, note:32, body:48, title:72, hype:48}.
  `PRESET_SIZE_NAME`: title→title, body→body, textbox→body, annotation→note,
  footnote→footnote, hype→hype.

**Chosen fix:** stamp sizes into new decks like fonts. Two implementation routes
(pick one):
  (a) Hardcode `config.textSizes` in `createDefaultPresentation` (mirrors
      `defaultTitleFont`). Guaranteed; simplest.
  (b) Give `DEFAULTS.textSizes` a non-empty value AND make
      `createSeededPresentation` fall back to `DEFAULTS.textSizes` when the
      localStorage pref is absent (it currently only reads localStorage and
      writes nothing when empty — so (b) alone won't seed).
  Recommend (a) for the guaranteed baseline, optionally + the pref still
  overriding it. MUST keep `DEFAULT_TEXT_SIZES` = 72 as the floor and NOT change
  it (existing size-less decks resolve through it and must stay 72).

**Secondary decision (title 62 vs 72):** default title BOX height is 180px
(`createTextElement` defaults in `presentation.ts`); line-height 1.3, padY 8
(`src/lib/textBox.mjs`). Two lines of 72px = 2×1.3×72=187.2 > content area
(180−16=164) → overflows ~23px (this is why a 2-line Lato title triggers the
overflow badge — the badge is CORRECT). Largest font that fits two lines in 180px
= 164/2.6 ≈ 63px. User floated title=62 (161.2<164, ~3px slack). Whether to set
title=62 in the new stored default is still open; keep it a small, new-deck-only
change (existing decks untouched).

Verify after: `npx tsc --noEmit`, `npx vitest run`, and that a File→New deck's
`config.textSizes` is populated while an opened OLD deck is unchanged.

## Arc 1 — 26.9.9 RELEASED (done)
- feat/coverage-viz + feat/e2e-coverage-spike merged to main (e2e coverage
  pipeline, whole-tree coverage map, CLI/pdf/fscmds coverage, 13-task cleanup).
- Bumped to 26.9.9, tagged, built (Linux job flaked once on font-setup — transient,
  log not retained; targeted rerun passed), **published** (draft=false,
  prerelease=false; releases/latest = v26.9.9). All 9 assets present.

## Arc 2 — overflow-badge perf regression: ROOT-CAUSED + FIXED (fix committed, patch pending)
- **Symptom:** intro-slide `rapidSlideNav` ~doubled 16→28ms. Bisected (built
  26.8.31 vs 26.9.9 on one machine) to commit **532a3ef** (the #95 overflow
  detector's `+1` → `+ Math.max(2,round(fontSize*0.2))` change) in
  `SlideElementRenderer.tsx`.
- **Root cause (proven):** a JavaScriptCore JIT deopt. Comparing the live
  `scrollHeight`/`clientHeight` getters against a RUNTIME threshold deopts
  `TextContent`'s render path. NOT arithmetic/type(`|0`)/closure-capture/function-
  location/inlining/`fontSize`-specifically. Two independent cliffs: (1) any
  non-literal value in the getter comparison (captured var, dataset read — all
  slow; box.clientHeight-self-derived is fast), and (2) a branch-count budget —
  measured **≤3 buckets fast (16-17ms), 4+ slow (29-30ms)**, ternary or if/else
  alike. (This corrected the earlier agent's wrong "3 buckets fails" claim.)
- **Fix (committed `051c465`, pushed to main):** 3-bucket LITERAL ladder in the
  #95 measure effect — `fontSize>=64?(+13):fontSize>=40?(+9):(+5)`, fontSize only
  in the branch conditions, comparisons literal. rapidSlideNav back to 16;
  text-overflow probe passes; vitest 1878. Guard comment added (PERF-CRITICAL:
  no variable in the comparison, ≤3 buckets).
- **PENDING for a 26.9.10 patch** (NOT yet done):
  1. Add a `rapidSlideNav` assertion to the perf suite (regression guard for both
     cliffs).
  2. Correct commit **ffa5249**'s wrong "environmental variance" note (a
     follow-up commit; the regression was real, not variance).
  3. File an issue documenting both JIT cliffs (NOT on github per an earlier
     instruction? — actually this one is a normal code issue; confirm with user).
  4. Bump 26.9.10, tag, build, publish — only after user finishes reviewing decks.
- User is reviewing decks; the 2-line-title overflow (Arc's tail → the text-size
  task above) surfaced during that review. The 3-bucket fix is NOT the cause of
  the 2-line overflow (23px overflow exceeds both old ~14 and new 13 slop).

## Arc 3 — welcome.eigendeck "lost demo": REVISIT (flag, not on github) — INTERRUPTED
- User: a demo appears lost in `examples/welcome.eigendeck`; asked if our editing
  caused it. Demos are EMBEDDED assets ("always included" — user corrected my
  wrong "external refs" gloss).
- Findings so far: demo ELEMENTS are intact — 11 demo/demo-piece elements,
  byte-identical before (792b47b^) and at HEAD; our welcome edit **792b47b**
  ("chore(welcome): strip history + fix serif fallback") did NOT delete a demo
  element. Committed HEAD deck (3.3M) `export json --with-assets` succeeds.
- **Caution:** during THIS session my WORKING copy of examples/welcome.eigendeck
  got mutated to 5.3M and SQLite-malformed ("database disk image is malformed");
  NOT committed; restored via `git checkout`. Something mutated the tracked file
  (autosave / an un-isolated app/CLI run?) — worth understanding so a corrupt deck
  never ships.
- **UNRESOLVED / next:** actually diff the embedded demo-asset BYTES (via
  `export json --with-assets`) before(792b47b^) vs HEAD for the 5 demo assetIds
  (ab925bb6, c60fbd06, 52d1aa5b, 123b8278, 93c6569c) — my earlier parse of the
  `assets` container was wrong (found only 1). `unpack --demos` extracts 0 because
  its filter is `path.starts_with("demos/")` but welcome's demo assets have path
  labels like `../example-demos/.../demos/*.html` — a FILTER MISMATCH, not proof
  of loss (this is itself possibly a bug in `unpack --demos`).

## Key files
- `src/types/presentation.ts`: `createTextElement` (title box default 180h),
  `createDefaultPresentation` (hardcodes fonts, NOT sizes), `config.textSizes`
  type (~line 451).
- `src/store/presentation.ts`: `createSeededPresentation` (~145) seeds
  `config.textSizes` from localStorage pref.
- `src/lib/preferences.ts`: `DEFAULTS.textSizes={}` (114); textSizes pref doc (28-35).
- `src/lib/textSizes.mjs`: `DEFAULT_TEXT_SIZES`, `effectiveFontSize`,
  `resolveNamedSize`, `PRESET_SIZE_NAME`.
- `src/lib/textPresets.mjs`: `TEXT_PRESET_STYLES`. `src/lib/textBox.mjs`:
  lineHeight 1.3 / padY 8 / padX 12.
- `src/components/SlideElementRenderer.tsx`: #95 overflow effect (~753) + the fix.
- `PropertiesPanel.tsx` (~1072) edits `config.textSizes`; `SettingsModal.tsx`
  (~370) `usePreference('textSizes')`.

## State
main HEAD = 051c465 (pushed). Working tree: only pre-existing
`examples/graph-algorithms.eigendeck` (M) + `examples/genslm-argonne-native.eigendeck`
(untracked) — unrelated, leave alone. Rig/toolchain provisioned this container
(cargo at ~/.cargo/bin, CARGO_TARGET_DIR=$HOME/el-target, app+cli at
$HOME/el-target/debug). Perf single-deck loop:
`VITE_EIGENDECK_SEAM=1 npm run build` then
`PROBE=e2e/perf-suite.mjs E2E_DECK=<copy> PERF_OUT=x.json PERF_REPS=3 bash e2e/run-probe.sh`.
