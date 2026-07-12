# Parallel e2e bug-hunt — plan

Goal: stop finding bugs by hand. Fan out N bug-hunter agents that each own a slice of
the app, AUTHOR e2e probes for that slice's invariants, RUN them on an isolated rig,
and report CONFIRMED bugs (a probe that fails) + the probe scripts. Confirmed failures
become fixes; passing probes become permanent regression gates in run-all.sh.

## The rig-isolation problem (must solve first)
The debug rig can't run in parallel:
- the debug app loads `devUrl http://localhost:1420` → needs a global :1420 dist server;
- `run-probe.sh` `cleanup_rig` pkills tauri-driver / WebKitWebDriver / `http.server 1420`
  BY NAME → parallel rigs kill each other.

Fix: run against a SELF-CONTAINED RELEASE build (embeds dist, no :1420 server) with a
per-instance tauri-driver port.
- Build once: `VITE_EIGENDECK_SEAM=1 npm run build` then
  `CARGO_TARGET_DIR=/tmp/el-target cargo build --release --bin eigendeck` (+ cli).
  (Release still installs the __eigendeck seam because the flag is baked into dist.)
- New runner `e2e/run-probe-parallel.sh`: takes `E2E_PORT` (tauri-driver, 4444+i) +
  `--native-port` (9515+i), uses `xvfb-run -a` (auto-free display), a throwaway
  XDG_*_HOME, the RELEASE `E2E_APP`, and scopes cleanup to ITS port only (never a global
  pkill). No http server. Each agent gets its own port i∈{0..3}.

## Phase 0 — harness (I build, ~10 min)
1. Release build (seam) of eigendeck + eigendeck-cli.
2. run-probe-parallel.sh (port-param, release, scoped cleanup, no :1420).
3. Smoke: run an existing probe on port 4445 to prove isolation.

## Phase 1 — 4 bug-hunter agents (parallel, worktree-isolated)
Each agent: own git worktree, own rig port, a target invariant set. Deliver: (a) a
ranked list of CONFIRMED bugs (probe + observed vs expected), (b) the probe .mjs +
fixtures, (c) SUSPECTED-but-unconfirmed notes. Areas (chosen by where bugs cluster):

- **A1 Present / projector / lifecycle** — present↔editor mount/unmount (HUD overlap,
  white-bar came from here), transitions, zoom, dual-monitor, escape, theme in present.
- **A2 Persistence / save / reopen** — round-trip EVERY field + element type through
  save→reopen (theme-save bug); autosave vs explicit save; WAL/atomic; undo+save.
- **A3 Notebook** — output theme (just fixed), overlay save/discard/reload race (#123),
  kernel remount, math/markdown, promote/free/resync, isolation.
- **A4 Editor / elements / inspector** — the 7 render paths WYSIWYG per element type +
  property (editing-slide-elements skill), color controls, undo/redo, clipboard, groups,
  snap/align, arrow/cover/card.

Each agent works from the editing-slide-elements + eigendeck-e2e skills, drives via the
seam, and ASSERTS against the saved file / computed DOM (not the live store only).

## Phase 2 — triage (me)
Collect all confirmed failures, dedup, verify each reproduces, rank by severity.

## Phase 3 — fix + gate
Fix confirmed bugs (smallest slices), add each green probe to run-all.sh, commit per fix.

## Notes / risks
- Cost: many app launches. Release build is a one-time ~min cost; each probe ~10-30s.
- Concurrency cap: 4 rigs ≈ fine on this box; more risks OOM/CPU (WebKit is heavy).
- Agents author in worktrees so their probe files don't collide; fixtures namespaced.
- Non-determinism: agents must make probes deterministic (build decks via cli import
  json, assert saved file) — flaky probes are worse than none.
