# 2026-07-16 — Release-issue push, clipboard research, perf benchmark + regression hunt

Long session. Three arcs: (1) fix/triage release-labeled issues, (2) research
clipboard paste + document it, (3) build a structured perf benchmark and start
chasing a real perf regression. Everything below is pushed to `main` unless noted.

## Release issues — fixed & closed (all pushed)
- **#88** link-picker slide numbers — now build/group-adjusted via `getSlideNumber`
  AND shows the offset from the "link origin" ("Slide X of Y · Z before/after")
  per dgleich's comment. LinkOverlay.tsx.
- **#95** editor cut-off badge — placed OUTSIDE the box, counter-scaled; + valign
  fix (measure content vs box, not scroll offset) + font-load re-measure + e2e probe.
- **#136** right-click menu on every element type — verified + e2e coverage
  (context-menu-elements-probe); interact-mode cross-origin iframe = documented limit.
- **#159** the "long note" WYSIWYG wrap bug — root cause was `-webkit-nbsp-mode:space`
  on the edit contentEditable vs `normal` on the SVG display; fixed by normalizing
  ` `→space in `sanitizeRichText` (the single ingest chokepoint: commit+paste+load).
- **#140** stale-theme notebook PDF — theme salt stored as a READABLE prefix on the
  preview `source_hash`; `printToPdf` treats a theme-mismatch as a miss → re-captures.
- **#134** present-mode `/screenshot` hang — seam-capture workaround
  (`captureElement('.present-slide')`) + present-visual-probe; documented in the skill.
- **#94** Linux image paste — fixed BOTH gaps (clipboard generation via arboard content
  hash so the internal clip goes stale; `clip_read_system_image` arboard fallback).
  **Verified under xvfb (real arboard tests). LEFT OPEN for dgleich's real-Linux sign-off.**
- **#158** Google Slides image paste — `extractPastedDataUrlImage` pulls the embedded
  `<img data:>` out of `text/html`. Unit-tested + rig-verified.

## Release issues — filed
- **#160 (release)** paste a copied FILE (Finder/Explorer/Nautilus) → read bytes.
- **#161 (release)** plain/styled text paste onto canvas → make a text element
  (keep toolbar style+color, NOT font-size). We ARE shipping Windows.
- **#162** Slides multi-image paste inserts only the first (low pri).
- **#163 (release)** text-label/arrow annotations over a demo block its buttons —
  send them behind the demo in z-order (repro: first 2 slides of frontend-slides).
- **#159 filed earlier this arc.** G2 (remote-`<img>`→blank) declined by dgleich.
- **#63** watcher warnings — assessed benign/macOS-only, left as-is (don't suppress).

## Clipboard research → docs/clipboard-paste-research.md (pushed)
Multi-agent research on how source apps ship clipboard data + how mature editors
(ProseMirror/TipTap, Lexical, Slate, Excalidraw, tldraw, CKEditor) handle paste.
Key: our 7-step chain matches best practice; do NOT adopt Web Custom Formats
(Chromium-only, we're WebKit). Gaps → issues #160/#161/#162. Full cited doc committed.

## Perf benchmark (pushed) — e2e/perf-suite.mjs + perf-suite-run.sh + docs/perf-report.md
- **perf-suite.mjs**: editor activities (rapidSlideNav, add text/image/slide, move,
  undoRedo) + PRESENT activities (enterPresent, presentAdvance="rapid next slide",
  presentPrev, exitPresent) + open/thumbnail timing. N reps → median/mean/stdev/min/max.
  Loop counts CAPPED (NAV=min(24,max(8,N*2))) so big decks don't overrun the exec timeout.
- **perf-suite-run.sh**: runs across real used decks (welcome, magnetic-powers,
  local-networks=the "local analysis" deck, frontend-slides, showcase) + baselines +
  perf decks; copies each to an isolated HOME (autosave can't touch originals);
  env overrides `RUN_PROBE` (serve a different dist, e.g. old build) + `PERF_RESULTS`.
- **Results tracked per version**: `e2e/perf-results/<git-describe>.json` — committed
  `v26.6.24.json` (pre-security) + `v26.7.15-24-g8ff7734.json` (current).
- **release skill step 7**: "Grab a performance snapshot" each release.
- Perf stress decks: `gitignore/perf-stress/` (generator `build_perf_deck.py`, +
  `perf-stress.eigendeck` 20MP/big-PDF/SVG = also a good "pop"-artifact repro).

## e2e infra fix (pushed) — the seam-check trap (cost real debugging time)
A plain `npm run build` strips the `window.__eigendeck` seam but leaves stray
`.__eigendeck` reads; the old `grep -rq __eigendeck` FALSE-POSITIVED → suite ran
seam-less → every deck "won't open" (waitSeam times out). **Misdiagnosed this as
"software GL can't load images" — WRONG.** Fix: `run-all.sh` + `run-probe.sh` now
grep the ASSIGNMENT `__eigendeck={`; skill gotcha #11 documents it. After ANY plain
build, rebuild with `VITE_EIGENDECK_SEAM=1`.

## PERF REGRESSION HUNT — IN PROGRESS (not committed; investigation state)
Pre-security (`v26.6.24`) built in worktree `/tmp/el-old` (+ dist) and
`/tmp/el-old-target/debug/eigendeck` (LOST ON RESET — rebuild via the docs/perf-report.md
worktree recipe: npm install + cp mathjax + seam build + cargo build).

**Established (this is the real finding):**
- Demo decks regress; **plain-text and image decks do NOT** (text-dense 20-text/slide:
  16ms both builds; perf image decks: 17ms both). So NOT a general per-element cost.
- On a FRESH graph-explorer (same elements old vs new — the earlier "old drops
  elements" confound was actually my autosave-POLLUTED copy), per-slide advance is
  **31/12/17 ms (old) → 75/79/52 ms (new)**, 2–6× slower. REAL, same elements.
- It's demo-deck-WIDE: slow even advancing TO a text slide within a demo deck.
- **NOT the rAF pump** — disabled `installRafPump` (demoMount.ts), rebuilt, presentAdvance
  unchanged (~97). Reverted.
- **Hypothesis (was about to test):** the present TRANSITION composites the
  opaque-origin demo iframes of BOTH the leaving + entering slides during the 300ms
  cross-fade. PresentMode.tsx renders `plan.fadeOut` (leaving els) + `plan.items`
  with iframes DELIBERATELY never remounted (to avoid the #flash). So during a fade,
  both slides' opaque-origin demo iframes are live + composited — expensive under
  software GL. Security era changed demos same-origin → opaque-origin (docs/DEMO-PLATFORM.md).
- **CAVEAT:** the rig is software-GL — it AMPLIFIES iframe compositing, so the rig
  magnitude may not equal the Mac. dgleich says it's noticeable in real use, so real.
  Next clean test: disable the transition (TRANSITION_MS/animating) and re-measure;
  if that removes it, the fix is rendering leaving-slide demos as their cached
  preview PNG during the fade (not the live iframe). NEEDS MAC VALIDATION.
- Confounds learned: (1) autosave can pollute a deck copy across perf-suite reps
  (addText/addSlide) — use fresh copies / strip; (2) the old app opening a current
  deck can drop element types it lacks (verify element counts match before comparing).

**Diagnostic probe:** `e2e/perf-advance-diag.mjs` (per-slide advance time + demo count;
NOT committed — scratch). #153 updated with the (partly-confounded) cross-version
table; the CLEAN story is "demo transition compositing," pending the transition-off test.

## Environment note
The rig accumulated ~16.7k unreapable zombies from all the perf sessions (PID 1 =
claude doesn't reap; the e2e rig leaks child processes on teardown). Single-deck
probe runs still work; the full multi-deck runner started wedging. A container
restart clears it. Worth fixing the rig teardown to reap (separate task).

## Background agent
A clipboard-research agent + subagents completed (findings folded into the doc).

## Resume pointers
- Finish the perf regression: test with present transition disabled on fresh
  graph-explorer (old vs new). If confirmed, implement "leaving-slide demos render as
  cached preview during the fade" and validate on the Mac.
- Push nothing new is pending except the perf-regression fix.
- v26.7.15 was the last release; a v26.7.16 could bundle the release-issue fixes.
