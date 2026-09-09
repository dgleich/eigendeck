# Coverage branch cleanup before merge — 2026-09-09

Two branches had built up a lot of coverage machinery: `feat/e2e-coverage-spike`
(the Istanbul-instrumented e2e pipeline plus interaction/journey/asset/gesture
probes and several unit-test rounds) and `feat/coverage-viz` stacked on top of it
(the whole-tree coverage map, plus fixes that raised Rust coverage by closing
measurement gaps: the CLI binary 0→90%, `pdf.rs` 0→44% via the ignored pdfium
test, the app invoke-handlers via `coverage-run.sh`, and the SlideEditor paste
block 41→57%). A review of both branches produced a 13-task plan
(`docs/2026-09-09-coverage-branch-cleanup-plan.md`); this session implemented it.

## What the review found

The machinery was sound but the branch was not mergeable as-is. The generated map
(`coverage-viz/`, about 190 files, 5.7 MB) was committed and went stale on every
source change, and its generator hard-coded `/work` and `~/rust-lcov.info`. Three
istanbul packages were imported by `coverage-merge.mjs` but only present
transitively. `coverage-run.sh` ran without checking the exit codes of the tests
it measured, so the weekly CI job would go green over a red suite. The beacon
dropped each page's final interval window because probes quit without flushing.
The three broad probes (`user-journey`, `interaction-exercise`, `asset-layer`) had
no hard assertions at all: every check was `soft()`, up to eight could fail before
the exit code changed, and `asset-layer`'s crash sentinel filtered out any error
mentioning asset/render/load. Helper code was copy-pasted across probes. Several
unit assertions were tautologies or `>=` where the value was exact, one test
leaked real timers, and 500-plus lines of `db.test.ts` (plus a second, tsconfig-
excluded `__tests__/db-store.test.ts`) covered a vestigial facade with one live
caller. The vitest floors sat within 0.6 points of the measured value.

## What changed

- **Stopped committing the map.** `coverage-viz/` is untracked and gitignored
  (with `*.profraw` and `.nyc_base/`); the generator derives the repo root from
  its own location and defaults the Rust lcov to `coverage-rust-e2e.lcov`; CI
  builds the map and uploads it as an artifact.
- **Declared** `istanbul-lib-coverage`/`-report`/`-reports` at the locked versions.
- **Honest exit codes.** `coverage-run.sh` still writes every report but exits
  non-zero when the unit tests or the e2e suite failed; `cli-coverage.sh` fails if
  its lcov has no `cli.rs` record and writes under `gitignore/`.
- **Beacon flush.** `coverageBeacon.ts` exposes `window.__covFlush()` (a no-op
  outside instrumented builds); `_ui.mjs` `quit()` awaits it, bounded to 3 s, so
  the last window of hits is not lost. Unit-tested in jsdom.
- **Hard assertions.** The three probes now `fail()` on their load-bearing steps
  (slide count changes, all ten dialog-free inserts, present enter/advance/exit,
  a menu `save` that persists, drag/resize/delete/z-order), with a small soft
  budget only for documented-optional steps, and the sentinel filters narrowed.
- **Shared helpers.** The sentinel installer, `makeSoft`, `pointerDrag`, and
  `marqueeDrag` moved into `_ui.mjs`; the five breadth probes import them.
- **Tighter unit tests.** Real selection invariant, exact counts, observed
  `linkElements` guards, fake timers in `securityWindow.test.ts`, a renamed
  self-contradicting `serverDiscovery` title.
- **Deleted the dead facade.** `db.ts` is now two invoke wrappers (`dbCompact`,
  `dbGcAssets`); both db test files were cut or removed.
- **Re-ratcheted floors** to the measured value rounded down minus one: statements
  45, branches 44, functions 43, lines 47 (measured 46.08 / 45.35 / 44.42 / 48.16).

## What was deliberately left

- `cli-coverage.sh` stays a *measurement driver*: its workflow commands are run
  tolerantly (error paths are coverage too), and the loud failure is only the
  missing-`cli.rs` guard. It is not a pass/fail integration test.
- The CI workflow is written and now fails honestly, but has never executed on a
  runner. Its first run after merge must be watched.
- Two probe checks are genuine floors, not bugs, and are documented as such: the
  menu-save mtime check is WAL-aware (a save-in-place lands in the `-wal` sidecar,
  so the check takes the newest of the file and its `-wal`/`-shm` siblings) and
  stays hard; the #74 missing-source banner is left a `soft` with a `// TODO(#74)`
  because an untrusted deck never reads its linked files by design, so it cannot
  detect one missing (a trusted-and-approved variant would exercise it).
- The macOS `NSPasteboard` paste paths, `lib.rs` native-menu closures, `clip.rs`
  pasteboard, the `lib/mathjax.ts` iframe render, and multi-monitor code stay cold:
  they need a real Mac or real displays, not the headless Linux rig.

## Numbers

Vitest jsdom unit coverage after the cleanup: statements 46.08%, branches 45.35%,
functions 44.42%, lines 48.16%. The unified frontend number (jsdom + real-WebKit
e2e) is about 62.8% lines; the whole-tree map (frontend statements plus Rust
lines, CLI and pdf and app handlers folded in) reads about 69% combined. These are
one run on one machine and drift a point or two between runs.

## Process note for future rig work

The e2e rig is a single shared resource: each `run-probe.sh` START-cleanup does
`pkill -9 -f "^tauri-driver"`, so two agents (or an agent and a manual run)
driving probes at once SIGKILL each other's drivers, producing `ECONNREFUSED` /
"other side closed" failures that look like probe bugs but are not. Only ever run
one probe driver against the rig at a time.
