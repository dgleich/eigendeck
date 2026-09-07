# Frontend E2E coverage (real WebKitGTK)

`npm run test:coverage` (vitest, jsdom) only sees the pure-logic layer — roughly
half the frontend (SlideElementRenderer, PresentMode, App.tsx, SlideEditor,
fileOps Tauri I/O, demoMount, mathjax rasterize) runs only in the real WebKit app
and is exercised by the **e2e probe suite**, which v8 coverage can't observe.

This adds coverage for *that* layer, in the **shipping engine** (WebKitGTK), by
Istanbul-instrumenting the bundle and harvesting hits from the running app.

## How it works

1. **Instrument** — `vite-plugin-istanbul` (behind `COVERAGE_INSTRUMENT=1`, with
   `forceBuildInstrument` since the rig serves a `vite build`, not the dev server)
   rewrites the bundle so every statement bumps `window.__coverage__`. Off by
   default → normal builds and `tauri dev` are untouched.
2. **Harvest** — `src/lib/coverageBeacon.ts` (a no-op unless `__coverage__`
   exists) streams the map to a collector on an interval + on `pagehide`. This is
   engine-agnostic — no V8/CDP dependency — so it works in the real WebKitGTK app.
   Zero per-probe changes: every one of the ~120 probes contributes automatically.
3. **Collect** — `run-probe.sh`, when `COVERAGE_INSTRUMENT=1`, serves dist via
   `e2e/coverage-server.mjs` instead of `python -m http.server`; it accepts the
   beacons and writes one `cov-<page>.json` per page to `$COV_NYC_DIR`
   (`.nyc_output/`, overwrite → latest snapshot, no double-count).
4. **Merge** — `e2e/coverage-merge.mjs` merges all page maps with
   `istanbul-lib-coverage` and emits `coverage-e2e/` (lcov + html). With
   `COV_WITH_VITEST=1` it folds in the jsdom unit coverage
   (`coverage/coverage-final.json`) for one **unified** frontend number.

## Run it

```bash
# 1. build an instrumented + seam bundle
COVERAGE_INSTRUMENT=1 VITE_EIGENDECK_SEAM=1 npm run build

# 2. run the e2e suite with collection on (full suite, or a subset via E2E_FILTER)
export E2E_APP=/tmp/el-target/debug/eigendeck E2E_CLI=/tmp/el-target/debug/eigendeck-cli
export COVERAGE_INSTRUMENT=1 COV_NYC_DIR="$PWD/.nyc_output"
rm -rf .nyc_output && mkdir .nyc_output
bash e2e/run-all.sh                      # or: E2E_FILTER='fontsize|zorder' bash e2e/run-all.sh

# 3. merge → coverage-e2e/ (add COV_WITH_VITEST=1 for the unified number)
npx vitest run --coverage            # only needed for the unified fold (writes coverage-final.json)
COV_WITH_VITEST=1 node e2e/coverage-merge.mjs
```

## Results (full suite)

The full instrumented suite (123 checks: all 121 probes + python + R live kernels)
passed green under instrumentation and produced 167 page maps. Merged:

| Metric | vitest-only (jsdom) | **Unified (unit + e2e)** |
| --- | --- | --- |
| Lines | 48.6% | **62.2%** |
| Statements | 46.6% | **55.0%** |
| Functions | 45.3% | **62.9%** |
| Branches | 45.5% | **49.4%** |

(After the round-2/2b unit push + the store lifecycle exercise test + installing
the coverage beacon in ALL window entries + the **interaction-exercise** and
**user-journey** probes — see below. The multi-window fix alone recovered
SecurityPanel 0→49%, security.tsx 0→94%, presenter.tsx 0→78%, SettingsModal 0→45%,
since those webviews each have their own `window.__coverage__`.) The point is the
render/interaction layer that jsdom can't reach — now measured in the real engine:

| File | vitest | full e2e |
| --- | --- | --- |
| components/SlideElementRenderer.tsx | ~0% | 57% |
| components/PresentMode.tsx | 0% | 50% |
| App.tsx | 2% | 42% |
| components/SlideEditor.tsx | — | 41% |
| components/PropertiesPanel.tsx | 12% | 55% |
| components/notebook/NotebookContent.tsx | — | 82% |
| lib/demoMount.ts | 34% | 82% |
| store/fileOps.ts (Tauri I/O) | 9% | 35% |
| store/presentation.ts | 47% | 79% |

### The interaction-exercise probe

Most probes drive state through the `window.__eigendeck` store seam, so the
real *interaction* layer — pointer gestures, per-element-type inspector sections,
context menus, the format toolbar — stayed cold even though the store logic was
covered. `e2e/interaction-exercise-probe.mjs` closes that gap: against the real
app it selects one of each element type (mounting every `PropertiesPanel`
per-type section + `SlideElementRenderer` selection branch), drags/resizes/marquee-
selects via real pointer events, drives arrow control points, fires context-menu
actions through the menu DOM, exercises the inline text toolbar, and clicks through
the Settings + Security windows. That single probe took `PropertiesPanel.tsx` 12→55%,
`SlideElementRenderer.tsx` up to 57%, and lifted the unified line number 60.0→61.6%
(functions 59.7→62.7% — interaction handlers are functions). It asserts a no-crash
invariant rather than pinning every detail, so it's an *exercise*, not a unit spec.

### The user-journey probe

The other giant cold region was `App.tsx` (~900 uncovered lines): the native-menu
command handlers, present/window orchestration, and the save/export flow. The
whole native menu routes through a single `listen('menu-event', e => switch(e.payload))`,
so `e2e/user-journey-probe.mjs` sweeps it by *self-emitting* every dialog-free
menu id and asserting the real effect — slide new/duplicate/delete (count changes),
the insert dispatcher for each element type (count grows), view/panel toggles,
snapshot + gc commands, the present enter→navigate→exit flow, the native-toolbar
`toolbar:action`/`toolbar:field` listeners, and a `save` round-trip through
`fileOps.ts` (file mtime bumps, reopens with the edit intact). This took `App.tsx`
34→42% and `PresentMode.tsx` to 50%, lifting the unified line number to 62.2%.

Two mechanics matter (both cost real debugging):

- **Emitting a menu event from the page.** A probe-side `import('@tauri-apps/api/event')`
  is a bare specifier that doesn't resolve at runtime (the `_ui.mjs` gotcha), so
  `emit()` silently no-ops. The working call is the Tauri event plugin directly —
  `window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event, payload })` —
  and the payload must be the **raw** value the listener expects (a plain string
  for `menu-event`, an object for `toolbar:*`; a `JSON.stringify`'d string won't match).
- **Ordering.** Global-emit delivery to the main window degrades once a pile of
  secondary windows / native pickers has been opened, so the delivery-dependent
  assertions (present, toolbar) run first in a clean single-window state and the
  window-openers / pickers / screen-share run last as guarded no-crash steps.

What stays cold in `App.tsx`/`fileOps.ts` is genuinely native-dialog-gated
(`save-as`, open/import, PDF export, image/video pickers) or macOS-only, so it
can't run in the headless Linux rig.

## Rust: unit coverage is the better metric

Running the instrumented app binary under the e2e suite (LLVM_PROFILE_FILE →
.profraw, merged with the unit-test profraws) does technically cover the command
handlers, but the merged Rust number came out *lower* (56.9% lines) than
unit-only (65%): merging the app + CLI binaries drags in a large amount of
uncovered `lib.rs` — the native menu, `#[cfg(target_os="macos")]` code, and
`setup()`/`run()` glue that the Linux e2e can't exercise — faster than it adds
covered handler lines. So the **unit `cargo llvm-cov --lib` number (65%) over the
testable surface is the truer Rust metric**; the e2e-merge helps the frontend a
lot but not Rust. `e2e/coverage-run.sh` still produces both if you want the full
picture.

## Operational gotchas

- **Never run `cargo llvm-cov <subcmd>` inside a `cargo llvm-cov show-env` shell.**
  show-env installs cargo-llvm-cov's rustc wrapper into the env; a nested
  `cargo llvm-cov` re-installs it recursively → a fork bomb (process count
  explodes, OOM). Use a normal `cargo test`/`cargo build` there — the env already
  makes them emit profraws — and only `cargo llvm-cov report`/`clean` afterward.
  (This is why coverage-run.sh uses `cargo test --lib`, not `cargo llvm-cov --lib`.)
- The container is memory-shared; a `run-probe` SIGKILL means the app's Rust
  profile is flushed via LLVM continuous mode (`%c` in LLVM_PROFILE_FILE).

## Not yet in CI

`.github/workflows/coverage-e2e.yml` is written (manual/weekly, `apt-get update`
first, CARGO_BUILD_JOBS capped) but `workflow_dispatch` can only be triggered once
the workflow file lands on the default branch — so it activates when this branch
merges. The instrumented run is slower than plain e2e, so it stays a dedicated
opt-in job, not per-PR. Other remaining lows are cross-context: `lib/mathjax.ts`
renders in an iframe pool (separate JS context, its own `__coverage__`), so the
main-thread orchestration shows but the render itself doesn't; same for
demo/notebook output iframes.
