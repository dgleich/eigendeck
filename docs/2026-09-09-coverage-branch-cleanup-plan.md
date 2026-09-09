# Coverage Branch Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-09-09

**Goal:** Make the `feat/coverage-viz` branch (which contains all of `feat/e2e-coverage-spike`) mergeable into `main` by removing committed generated output, making every gated e2e probe able to fail, removing coverage that measures dead code, and fixing the reproducibility gaps found in review.

**Architecture:** The coverage machinery itself stays as designed: `vite-plugin-istanbul` behind `COVERAGE_INSTRUMENT=1`, `src/lib/coverageBeacon.ts` streaming `window.__coverage__` to `e2e/coverage-server.mjs`, `e2e/coverage-merge.mjs` producing the unified report, `cargo llvm-cov` for Rust, and `scripts/gen_coverage_viz.py` for the map. This plan changes what is committed, what can fail, and what is asserted. It does not add new coverage.

**Tech Stack:** Vitest + jsdom, the e2e Tauri rig (tauri-driver + WebKitWebDriver + xvfb; see the `eigendeck-e2e` skill), bash, Node ESM scripts, Python 3 stdlib fixtures.

**Spec:** The review findings this plan implements are summarized in the "Review findings being addressed" section below (there is no separate spec document). Branch under work: `feat/coverage-viz`. Base: `main` at `9ca41fe`.

## Global Constraints

- Work on branch `feat/coverage-viz`. Do not rewrite or squash existing commits on it.
- One task = one commit, made before moving on. Commit messages: conventional header `type(scope): imperative summary`, prose body saying what and why, ending with the `Co-Authored-By:` and `Claude-Session:` trailers the harness provides. Never put backticks in `git commit -m`; use `git commit -F -` with a heredoc.
- Frontend gates before each commit that touches `src/`: `npx tsc --noEmit` and `npx vitest run` both green.
- E2E gates before each commit that touches `e2e/`: the affected probe passes through `e2e/run-all.sh` (see "E2E rig setup" below). Run it three times in a row for any probe whose assertions you tightened.
- No em-dashes in prose or UI copy. Write separate sentences instead.
- Never write scratch files to `/tmp`. Use the repo's `gitignore/` directory or the session scratchpad.
- `cargo` is at `~/.cargo/bin/cargo` and `/work` is a `noexec` mount. Before any cargo command: `export PATH="$HOME/.cargo/bin:$PATH" CARGO_TARGET_DIR="$HOME/el-target"`.

## Review findings being addressed

Numbers refer to tasks below.

1. `coverage-viz/` (about 190 generated HTML files, 5.7 MB) is committed and stale on arrival; the generator hardcodes `/work` and `~/rust-lcov.info`. (Task 1)
2. `*.profraw` and `.nyc_base/` are not gitignored; 19 stray files sit in the working tree. (Task 1)
3. `e2e/coverage-merge.mjs` imports three istanbul packages that are not declared in `package.json`. (Task 2)
4. `e2e/coverage-run.sh` has no `set -e` and ignores the exit code of `e2e/run-all.sh`, so the weekly CI job goes green even when probes fail. `e2e/cli-coverage.sh` never checks that its output lcov contains `cli.rs`. (Task 3)
5. The beacon drops the final 1.5 s window of every page because probes call `quit` without a flush; secondary windows closed inside their first second never report. (Task 4)
6. `user-journey-probe.mjs` and `interaction-exercise-probe.mjs` have no hard behavioural assertions: every check is `soft()`, up to eight may fail, `run-all.sh` retries three times and shows `tail -4`. `asset-layer-probe.mjs` filters `asset|render|load` out of its crash sentinel, which blanks it. Manifest comments claim assertions that do not exist. (Tasks 5, 6)
7. Helper code (`soft()`, sentinel installer, pointer drag, marquee) is copy-pasted across four probes; `interaction-exercise-probe.mjs` reimplements `handles`/`switchTo` with a hardcoded URL and has a stray dynamic import. (Task 7)
8. `e2e/README.md` does not mention any new probe and its "Not yet gated" policy contradicts gating breadth probes. (Task 8)
9. `src/store/presentation.exercise.test.ts:73` is a tautology; lines 109 and 568 assert `>=` where the value is exact; the comment at line 350 describes a branch that is not reached. `src/lib/securityWindow.test.ts` leaks real timers between tests. `src/lib/serverDiscovery.test.ts:159` has a self-contradicting title. (Task 9)
10. `src/store/db.test.ts` (509 lines) covers a module whose only live caller is `dbGcAssets` in `App.tsx`. (Tasks 10, 11)
11. Vitest thresholds were raised to 46/45/45/48 with margins under 0.6 points; removing the dead-code tests will drop below them. (Task 12)
12. No `.claude/logs/` session entry; `docs/e2e-coverage.md` presents run-dependent percentages as fixed. (Task 13)

## E2E rig setup (needed from Task 4 on)

Follow the `eigendeck-e2e` skill to provision tauri-driver, WebKitWebDriver and xvfb if a container reset wiped them. Then:

```bash
export PATH="$HOME/.cargo/bin:$PATH" CARGO_TARGET_DIR="$HOME/el-target"
cd /work
VITE_EIGENDECK_SEAM=1 npm run build
( cd src-tauri && cargo build --bin eigendeck --bin eigendeck-cli )
export E2E_APP="$HOME/el-target/debug/eigendeck" E2E_CLI="$HOME/el-target/debug/eigendeck-cli"
# run one probe (regex on the probe filename):
E2E_FILTER='user-journey' bash e2e/run-all.sh
```

A probe passes when `run-all.sh` prints `ALL E2E PASS`. A probe that passes only on the second or third retry is flaky and must be fixed, not accepted.

---

### Task 1: Stop committing generated coverage output

**Files:**
- Delete from the index (keep the generator): `coverage-viz/` (all of it: `index.html`, `app.js`, `style.css`, `files/`)
- Modify: `.gitignore` (append after the `coverage-e2e-only/` line)
- Modify: `scripts/gen_coverage_viz.py:41-45`
- Modify: `.github/workflows/coverage-e2e.yml` (add a viz step and an upload path)

**Interfaces:**
- Produces: `python3 scripts/gen_coverage_viz.py [rust-lcov]` works from any checkout location and writes to `<repo>/coverage-viz/`, which is now untracked.

- [ ] **Step 1: Remove the generated site from git, keep it on disk**

```bash
cd /work
git rm -r --cached coverage-viz
```

Expected: about 190 `rm 'coverage-viz/...'` lines. The directory still exists on disk.

- [ ] **Step 2: Extend .gitignore**

Append to `/work/.gitignore`:

```gitignore

# generated coverage map (regenerate with: python3 scripts/gen_coverage_viz.py)
coverage-viz/

# LLVM profile output from instrumented app/CLI runs outside the llvm-cov target dir
*.profraw
.nyc_base/
```

- [ ] **Step 3: Make the generator location-independent**

In `scripts/gen_coverage_viz.py`, replace lines 41 to 45:

```python
REPO = os.environ.get("REPO_ROOT", "/work")
OUT = os.path.join(REPO, "coverage-viz")
FILES_DIR = os.path.join(OUT, "files")
FRONT_LCOV = os.path.join(REPO, "coverage-e2e", "lcov.info")
RUST_LCOV = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expanduser("~"), "rust-lcov.info")
```

with:

```python
# Repo root = parent of scripts/. REPO_ROOT overrides for out-of-tree runs.
REPO = os.environ.get("REPO_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "coverage-viz")
FILES_DIR = os.path.join(OUT, "files")
FRONT_LCOV = os.path.join(REPO, "coverage-e2e", "lcov.info")
# Rust lcov: argv[1], else the file coverage-run.sh writes at the repo root.
RUST_LCOV = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "coverage-rust-e2e.lcov")
```

Also update the module docstring at the top of the file: replace every `$HOME/rust-lcov.info` with `coverage-rust-e2e.lcov` and every `$HOME/rust-lcov-cli.info` with `gitignore/rust-lcov-cli.info`, and replace the line `Usage: python3 scripts/gen_coverage_viz.py [rust-lcov.info]` with `Usage: python3 scripts/gen_coverage_viz.py [rust-lcov]   (output: coverage-viz/, gitignored)`.

- [ ] **Step 4: Verify the generator runs with and without inputs**

```bash
cd /work && rm -rf coverage-viz && python3 scripts/gen_coverage_viz.py
```

Expected: a `files: N  raw ...` summary line and `coverage-viz/index.html` exists. With no lcov present every file is badged "not instrumented"; that is fine, the point is that it does not crash on missing inputs. Then `git status --short | grep coverage-viz` must print nothing.

- [ ] **Step 5: Produce the map in CI as an artifact**

In `.github/workflows/coverage-e2e.yml`, insert after the `Run instrumented e2e coverage` step and before `Upload coverage reports`:

```yaml
      - name: Generate coverage map (coverage-viz/)
        if: always()
        run: python3 scripts/gen_coverage_viz.py coverage-rust-e2e.lcov
```

and add `coverage-viz/` to the `path:` list of the upload step so it reads:

```yaml
          path: |
            coverage-unified/
            coverage-rust-e2e.lcov
            coverage-viz/
            coverage/
```

- [ ] **Step 6: Commit**

```bash
cd /work
git add -A .gitignore scripts/gen_coverage_viz.py .github/workflows/coverage-e2e.yml
git add -u coverage-viz
git commit -F - <<'EOF'
chore(coverage): stop committing the generated coverage map

coverage-viz/ was about 190 generated HTML files (5.7 MB) that go stale on
every source change and were regenerated with a generator hardcoded to
/work and ~/rust-lcov.info. Untrack the output, gitignore it together with
stray *.profraw files and .nyc_base/, make the generator derive the repo
root from its own location and default the Rust lcov to the file
coverage-run.sh writes, and have the CI job build the map and upload it as
an artifact instead.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

---

### Task 2: Declare the istanbul packages coverage-merge.mjs imports

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `package-lock.json` (via `npm install`)

**Interfaces:**
- Produces: `istanbul-lib-coverage`, `istanbul-lib-report`, `istanbul-reports` resolvable by `e2e/coverage-merge.mjs` without relying on transitive installs.

- [ ] **Step 1: Add the three packages at the versions already in the lockfile**

```bash
cd /work
npm install --save-dev istanbul-lib-coverage@^3.2.2 istanbul-lib-report@^3.0.1 istanbul-reports@^3.2.0
```

Expected: `package.json` gains three lines in `devDependencies`; `package-lock.json` changes only to mark them as direct dependencies (no version bumps).

- [ ] **Step 2: Verify resolution from an ESM script**

```bash
cd /work && node --input-type=module -e "import 'istanbul-lib-coverage'; import 'istanbul-lib-report'; import 'istanbul-reports'; console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Confirm the lockfile diff is small**

```bash
git diff --stat package-lock.json
```

Expected: a handful of lines, not hundreds. If versions moved, run `git checkout package-lock.json` and redo Step 1 with `npm install --save-dev --save-exact` at the exact lockfile versions listed above.

- [ ] **Step 4: Commit**

```bash
cd /work
git add package.json package-lock.json
git commit -F - <<'EOF'
chore(deps): declare the istanbul packages coverage-merge.mjs imports

e2e/coverage-merge.mjs imports istanbul-lib-coverage, istanbul-lib-report
and istanbul-reports directly but they were only present transitively via
@vitest/coverage-v8 and vite-plugin-istanbul. A future bump of either could
remove them silently. Declare them as devDependencies at the versions the
lockfile already resolves.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

---

### Task 3: Make the coverage scripts exit non-zero on failure

**Files:**
- Modify: `e2e/coverage-run.sh:30-66`
- Modify: `e2e/cli-coverage.sh` (unit-test line and the report block at the end)

**Interfaces:**
- Produces: `bash e2e/coverage-run.sh` exits 1 if the Rust unit tests or the e2e suite failed, after still writing every report. `bash e2e/cli-coverage.sh` exits 1 if the resulting lcov lacks `cli.rs`.

- [ ] **Step 1: Capture the unit-test and e2e exit codes in coverage-run.sh**

In `e2e/coverage-run.sh`, change the `cargo test` line inside step 3 from:

```bash
  cargo test --lib -- --include-ignored --test-threads=1
)
```

to:

```bash
  cargo test --lib -- --include-ignored --test-threads=1
); UNIT_RC=$?
```

Change the end of step 4 from:

```bash
  LLVM_PROFILE_FILE="$PROFDIR/e2e-%p%c.profraw" \
  bash e2e/run-all.sh
echo "frontend page maps: ...
```

to:

```bash
  LLVM_PROFILE_FILE="$PROFDIR/e2e-%p%c.profraw" \
  bash e2e/run-all.sh; E2E_RC=$?
echo "frontend page maps: ...
```

(keep the existing `echo` line unchanged after it).

Replace the final two lines of the script:

```bash
echo; echo "==== coverage-run complete ===="
echo "  frontend → coverage-unified/  |  rust → coverage-rust-e2e.lcov"
```

with:

```bash
echo; echo "==== coverage-run complete ===="
echo "  frontend → coverage-unified/  |  rust → coverage-rust-e2e.lcov"
echo "  rust unit tests rc=$UNIT_RC   e2e suite rc=$E2E_RC"
# Reports are written regardless (so CI can upload them), but the job must go
# red when the suite it measured did not pass: a green coverage job over a
# failing suite is worse than no job.
if [ "$UNIT_RC" -ne 0 ] || [ "$E2E_RC" -ne 0 ]; then exit 1; fi
```

- [ ] **Step 2: Make cli-coverage.sh report the unit-test result and check its output**

In `e2e/cli-coverage.sh`, change:

```bash
cargo test --lib -- --include-ignored --test-threads=1 >/dev/null 2>&1 && echo "  unit tests ok" || echo "  unit tests: some failures (continuing)"
```

to:

```bash
if cargo test --lib -- --include-ignored --test-threads=1 >/dev/null 2>&1; then
  echo "  unit tests ok"; UNIT_RC=0
else
  echo "  unit tests: FAILED (continuing to measure; exit code will be non-zero)"; UNIT_RC=1
fi
```

and change the final block from:

```bash
cargo llvm-cov report --lcov --output-path "$OUT_LCOV" 2>/dev/null
echo "lcov written: $OUT_LCOV  ($(grep -c '^SF:' "$OUT_LCOV" 2>/dev/null) files)"
rm -rf "$S"
```

to:

```bash
cargo llvm-cov report --lcov --output-path "$OUT_LCOV" 2>/dev/null
echo "lcov written: $OUT_LCOV  ($(grep -c '^SF:' "$OUT_LCOV" 2>/dev/null) files)"
rm -rf "$S"
# This script exists to measure cli.rs. If the binary was not instrumented or
# the workflows never ran it, the lcov has no cli.rs record and the number is
# meaningless; fail loudly instead of writing an empty report.
if ! grep -q '^SF:.*cli\.rs$' "$OUT_LCOV" 2>/dev/null; then
  echo "FATAL: $OUT_LCOV has no cli.rs record"; exit 1
fi
exit "$UNIT_RC"
```

Also change the default output path on the `OUT_LCOV=` line from `$HOME/rust-lcov.info` to `$ROOT/gitignore/rust-lcov-cli.info`, and add `mkdir -p "$ROOT/gitignore"` on the line after it. Update the `# Usage:` comment in the header to match.

- [ ] **Step 3: Syntax-check both scripts**

```bash
bash -n e2e/coverage-run.sh && bash -n e2e/cli-coverage.sh && echo syntax-ok
```

Expected: `syntax-ok`.

- [ ] **Step 4: Run cli-coverage.sh end to end**

```bash
export PATH="$HOME/.cargo/bin:$PATH" CARGO_TARGET_DIR="$HOME/el-target"
cd /work && bash e2e/cli-coverage.sh; echo "rc=$?"
```

Expected: `lcov written: /work/gitignore/rust-lcov-cli.info (N files)`, no `FATAL`, and `rc=0` (or `rc=1` only if a Rust unit test genuinely fails; if so, report it, do not mask it). This builds the instrumented CLI and takes several minutes.

- [ ] **Step 5: Commit**

```bash
cd /work
git add e2e/coverage-run.sh e2e/cli-coverage.sh
git commit -F - <<'EOF'
fix(coverage): make the coverage scripts fail when the suite they measure fails

coverage-run.sh ran without set -e and ignored the exit codes of cargo test
and run-all.sh, so the weekly CI job would report success over a red suite.
Capture both codes, still write every report so CI can upload them, then
exit non-zero. cli-coverage.sh now fails if its lcov has no cli.rs record
(the one thing it exists to measure), propagates the unit-test result, and
writes its default output under gitignore/ instead of $HOME.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

---

### Task 4: Flush the coverage beacon before a probe quits

**Files:**
- Modify: `src/lib/coverageBeacon.ts`
- Create: `src/lib/coverageBeacon.test.ts`
- Modify: `e2e/_ui.mjs:31` (the `quit` helper)

**Interfaces:**
- Produces: `window.__covFlush?: () => Promise<void>` on instrumented pages, resolving when the POST has completed. `quit(sid)` in `_ui.mjs` awaits it (bounded by 3 s) before deleting the session.

- [ ] **Step 1: Write the failing unit test**

Create `src/lib/coverageBeacon.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installCoverageBeacon } from './coverageBeacon';

type CovWindow = Window & {
  __coverage__?: unknown;
  __covBeaconInstalled?: boolean;
  __covFlush?: () => Promise<void>;
};
const w = window as unknown as CovWindow;

describe('installCoverageBeacon', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete w.__coverage__;
    delete w.__covBeaconInstalled;
    delete w.__covFlush;
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is a no-op when the page is not instrumented', () => {
    installCoverageBeacon();
    expect(w.__covBeaconInstalled).toBeUndefined();
    expect(w.__covFlush).toBeUndefined();
    vi.advanceTimersByTime(5000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('exposes __covFlush that POSTs the current coverage map', async () => {
    w.__coverage__ = { 'src/a.ts': { s: { 0: 1 } } };
    installCoverageBeacon();
    expect(typeof w.__covFlush).toBe('function');
    await w.__covFlush!();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url.startsWith('/__coverage__?id=')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ 'src/a.ts': { s: { 0: 1 } } });
  });

  it('__covFlush resolves even when the collector is unreachable', async () => {
    w.__coverage__ = {};
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    installCoverageBeacon();
    await expect(w.__covFlush!()).resolves.toBeUndefined();
  });

  it('installs only once per page', () => {
    w.__coverage__ = {};
    installCoverageBeacon();
    const first = w.__covFlush;
    installCoverageBeacon();
    expect(w.__covFlush).toBe(first);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /work && npx vitest run src/lib/coverageBeacon.test.ts
```

Expected: the `__covFlush` tests fail with `expected 'undefined' to be 'function'`.

- [ ] **Step 3: Implement the flush**

Replace the body of `src/lib/coverageBeacon.ts` with:

```ts
// E2E coverage beacon. Active ONLY in Istanbul-instrumented builds
// (COVERAGE_INSTRUMENT=1 → vite-plugin-istanbul → window.__coverage__ exists).
// It periodically POSTs the coverage map to the e2e collector server
// (e2e/coverage-server.mjs), so EVERY e2e probe contributes its real-WebKitGTK
// line hits with zero per-probe changes. A no-op in normal builds (no
// __coverage__), so calling it unconditionally from main is free.
//
// It also exposes window.__covFlush() so a probe can await one final POST
// before it tears the session down. Without that, the last interval window
// (up to 1.5 s of hits) is lost on every page, and a secondary window closed
// inside its first second never reports at all. e2e/_ui.mjs quit() calls it.
export function installCoverageBeacon(): void {
  const w = window as unknown as {
    __coverage__?: unknown;
    __covBeaconInstalled?: boolean;
    __covFlush?: () => Promise<void>;
  };
  if (!w.__coverage__ || w.__covBeaconInstalled) return;
  w.__covBeaconInstalled = true;

  // One stable id per page → the collector overwrites cov-<id>.json each POST,
  // keeping only the latest cumulative snapshot (so re-posting never double-counts).
  const id = 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const url = `/__coverage__?id=${id}`;

  const send = (): Promise<void> => {
    try {
      // Plain fetch (NOT keepalive): the coverage body far exceeds the 64KB
      // keepalive/sendBeacon cap, so a keepalive request would be silently dropped.
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(w.__coverage__),
      }).then(() => undefined, () => undefined);
    } catch {
      return Promise.resolve();
    }
  };

  // Coverage is cumulative; snapshot early (short probes) then on an interval so we
  // capture hits even if the rig hard-closes the session without a clean teardown.
  setTimeout(() => { void send(); }, 1000);
  setInterval(() => { void send(); }, 1500);
  // Best-effort final flush on unload (usually truncated; the explicit
  // __covFlush from the probe is the reliable path).
  window.addEventListener('pagehide', () => { void send(); });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void send();
  });
  w.__covFlush = send;
}
```

- [ ] **Step 4: Run the test again**

```bash
cd /work && npx vitest run src/lib/coverageBeacon.test.ts && npx tsc --noEmit
```

Expected: 4 passed, tsc clean.

- [ ] **Step 5: Await the flush in quit()**

In `e2e/_ui.mjs`, replace line 31:

```js
export async function quit(sid) { await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {}); }
```

with:

```js
// Flush the coverage beacon (instrumented builds only; a no-op otherwise) for
// the CURRENT window before tearing the session down, so the final <=1.5 s of
// hits is not dropped. Bounded: a hung collector must not hang the probe.
export async function flushCoverage(sid) {
  try {
    await Promise.race([
      execA(sid, "const d=arguments[arguments.length-1];(window.__covFlush?window.__covFlush():Promise.resolve()).then(()=>d(true),()=>d(false))"),
      sleep(3000),
    ]);
  } catch { /* session may already be gone */ }
}
export async function quit(sid) {
  await flushCoverage(sid);
  await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
}
```

- [ ] **Step 6: Verify one probe still passes with and without instrumentation**

Using the rig setup above:

```bash
cd /work && E2E_FILTER='zorder' bash e2e/run-all.sh
```

Expected: `ALL E2E PASS`. Then an instrumented run of the same probe:

```bash
COVERAGE_INSTRUMENT=1 VITE_EIGENDECK_SEAM=1 npm run build
rm -rf .nyc_output && mkdir .nyc_output
COVERAGE_INSTRUMENT=1 COV_NYC_DIR="$PWD/.nyc_output" E2E_FILTER='zorder' bash e2e/run-all.sh
ls .nyc_output
```

Expected: `ALL E2E PASS` and at least one `cov-p*.json` in `.nyc_output/`. Rebuild without `COVERAGE_INSTRUMENT` afterwards (`VITE_EIGENDECK_SEAM=1 npm run build`) so later tasks run the plain seam build.

- [ ] **Step 7: Commit**

```bash
cd /work
git add src/lib/coverageBeacon.ts src/lib/coverageBeacon.test.ts e2e/_ui.mjs
git commit -F - <<'EOF'
fix(coverage): flush the beacon before a probe quits its session

The beacon only posted on a 1.5 s interval plus a pagehide handler whose
fetch is cancelled on unload, so every page lost its final window of hits
and a secondary window closed inside its first second never reported. The
measured percentages therefore varied run to run. Expose window.__covFlush
(a no-op outside instrumented builds) and await it, bounded to 3 s, from
the shared quit() helper. Unit-tested in jsdom with a stubbed fetch.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

---

### Task 5: Give the three tolerant probes hard assertions

Each sub-task edits one probe. Read the whole probe first; line numbers are as of commit `88c7af9` and shift as you edit.

**Files:**
- Modify: `e2e/user-journey-probe.mjs`
- Modify: `e2e/interaction-exercise-probe.mjs`
- Modify: `e2e/asset-layer-probe.mjs`
- Modify: `e2e/fixtures/make_asset_layer_deck.py:83-86`
- Modify: `e2e/run-all.sh` (the `| tail -4` in the retry loop and the four manifest comments)

**Interfaces:**
- Consumes: `fail(msg)` already defined in each probe (`process.exit(1)` after printing `<PREFIX>_FAIL:`).
- Produces: probes whose load-bearing checks call `fail()` directly; `soft()` remains only for steps that are documented as optional.

- [ ] **Step 1: user-journey-probe.mjs, promote the load-bearing checks**

Make these edits:

1. Lines 101 and 103 (`soft('debug-console fired (no crash)', true)` and `soft('toggle-decorations fired (no crash)', true)`): replace each with a `console.log('  · debug-console fired')` / `console.log('  · toggle-decorations fired')`. A check that passes `true` is not a check.
2. Line 119, 123, 126 (slide new / duplicate / delete): change `soft(` to a hard check. Pattern:
   ```js
   if (!await waitFor(sid, 's.presentation.slides.length', n + 1)) fail(`slide-new did not add a slide (stayed ${await nSlides(sid)})`);
   console.log('  ✓ slide-new added a slide');
   ```
   Apply the same shape to duplicate (`n + 1`) and delete (`n - 1`).
3. Line 141: replace `soft(\`majority of dialog-free inserts worked ...\`, grew >= inserts.length - 1)` with `if (grew !== inserts.length) fail(\`only ${grew}/${inserts.length} dialog-free inserts added an element\`);`. All ten ids resolve in `App.tsx`'s `runInsert`; there is no reason for slack. If one insert genuinely fails, that is an app bug to report, not to tolerate.
4. Lines 161, 167, 171 (present enter / advance / exit): promote to hard `fail()` with the same pattern as item 2.
5. Line 231: delete the line `await exec(sid, "return window.__eigendeck.save();"); await sleep(1200);` and its comment. The step is titled "save round-trip through the menu"; a seam save afterwards makes the menu path unobservable. Keep `await menu(sid, 'save'); await sleep(1500);`.
6. Line 233: change the mtime check to strict and hard:
   ```js
   if (!(mtimeAfter > mtimeBefore)) fail(`menu save did not write the deck (mtime before=${mtimeBefore} after=${mtimeAfter})`);
   console.log('  ✓ save updated the deck file mtime');
   ```
7. Lines 251 to 254 (reopened slides, elements, title, slide count): promote all four to hard `fail()` calls with the existing detail text.
8. Line 271: change `if (problems.length > 8)` to `if (problems.length > 3)` and add a comment above it listing which soft steps may legitimately skip: the window-opener ids in section 7, the picker/dialog ids in section 8, and the screen-share ids in section 9 (each is guarded because global-emit delivery degrades once secondary windows are open, per the header comment).

- [ ] **Step 2: Run user-journey three times**

```bash
cd /work && for i in 1 2 3; do E2E_FILTER='user-journey' bash e2e/run-all.sh | tail -3; done
```

Expected: `ALL E2E PASS` three times, each on the first attempt (no `retry` line). If the menu-save mtime check fails while everything else passes, do not re-add the seam save. Move section 10 to run immediately after section 3 (before any secondary window has been opened) and run three times again. If it still fails, stop and report: that would mean the `save` menu id does not write the deck, which is an app bug.

- [ ] **Step 3: interaction-exercise-probe.mjs, promote the load-bearing checks**

1. Line 156 (`drag e-body moved it`), line 175 (`resize e-image changed w/h`), line 287 (`Delete removed the element`), line 301 (`Add Body inserted an element`): promote each to a hard `fail()` with its existing detail string.
2. Line 275: change `soft('Bring to Front raised z-order', zAfter >= zBefore)` to
   ```js
   if (!(zAfter > zBefore)) fail(`Bring to Front did not raise z-order (${zBefore} -> ${zAfter})`);
   console.log('  ✓ Bring to Front raised z-order');
   ```
   The fixture must have `e-cover` below at least one other element for this to be meaningful; check `e2e/fixtures/make_interaction_deck.py` and, if `e-cover` is already last in slide 0's element array, pick an element that is not last (adjust both the `selectObject` and `rightClick` calls on lines 267 and 268 and the two `findIndex` lookups).
3. Line 413: change `> 8` to `> 3` with a comment naming the allowed soft steps: optional inspector buttons (arrow heads/size, valign), the text toolbar (edit mode may not open on a cover), Settings and Security window content.

- [ ] **Step 4: Run interaction-exercise three times**

```bash
cd /work && for i in 1 2 3; do E2E_FILTER='interaction-exercise' bash e2e/run-all.sh | tail -3; done
```

Expected: `ALL E2E PASS` three times on the first attempt.

- [ ] **Step 5: asset-layer-probe.mjs, repair the sentinel and the pre-failed steps**

1. Line 159: replace the filter regex with the narrow one the other probes use:
   ```js
   const realErrs = errs.filter((e) => !/network|Failed to fetch|ERR_/i.test(e));
   ```
   Then run the probe once (Step 6). If a real exception now appears in `realErrs`, read it. If it is the expected fetch failure for the deliberately missing asset `amiss`, extend the regex with a pattern that matches that exact message (for example `/asset amiss not found/`), never with a bare word like `asset` or `render`.
2. Line 139 (pdf render): make it conditional and hard. At the top of the file add
   ```js
   import { existsSync } from 'node:fs';
   import { fileURLToPath } from 'node:url';
   import { dirname, join } from 'node:path';
   const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
   const HAVE_PDFIUM = existsSync(join(ROOT, 'src-tauri', 'resources', 'pdfium', 'libpdfium.so'));
   ```
   and replace the line with
   ```js
   if (HAVE_PDFIUM) {
     if (!await exec(sid, "return !!document.querySelector('[data-element-id=\"apdf\"] img')")) fail('pdf canvas element did not render an <img> although pdfium is present');
     console.log('  ✓ pdf element rendered via pdfium');
   } else {
     console.log('  · pdf render skipped (no libpdfium.so in this rig)');
   }
   ```
3. Line 127 (missing-source banner): the fixture sets `externalPath: "images/dot.png"`, a relative path, and the probe then accepts that the missing-source scan does not fire. Make the fixture produce a path that is unambiguously absent: in `e2e/fixtures/make_asset_layer_deck.py` lines 83 to 86, set `externalPath` to `os.path.join(os.path.dirname(os.path.abspath(out)), "vanished", "dot.png")` where `out` is the output JSON path the script already receives (read the script's `main` to find the variable name). Then promote line 127 to a hard `fail('missing-source banner not shown for a dangling linked file')`. If the banner still does not appear, stop and report it as a probable app bug in the missing-source scan (issue #74 area); do not soften the check.
4. Line 171: change `> 7` to `> 2` with a comment naming the allowed soft steps (hover preview popover, resize-to-image box change).

- [ ] **Step 6: Run asset-layer three times**

```bash
cd /work && for i in 1 2 3; do E2E_FILTER='asset-layer' bash e2e/run-all.sh | tail -3; done
```

Expected: `ALL E2E PASS` three times on the first attempt.

- [ ] **Step 7: Let the soft-problem report survive run-all.sh's truncation**

In `e2e/run-all.sh`, in the retry loop, change

```bash
    env $extra_expanded PROBE="$ROOT/e2e/$probe" E2E_DECK="$DECK" bash "$ROOT/e2e/run-probe.sh" 2>&1 | tail -4
```

to `| tail -30`. Then rewrite the four manifest comments (lines 136, 137 to 143, 144 to 150, 151 to 157) so each states only what the probe asserts hard. For example replace the user-journey comment block with:

```bash
  # user-journey: fires the REAL native-menu router via emitted menu-events and
  # asserts hard: slide new/dup/delete change the count, all 10 dialog-free
  # inserts add an element, present enter/advance/exit, toolbar:action/field
  # listeners, and a menu `save` that bumps the file mtime and round-trips
  # title + slide count through a fresh session. Window-openers, pickers and
  # screen-share are soft (delivery degrades once secondary windows exist).
```

Write the other three in the same style from what you promoted in Steps 1, 3 and 5. Remove the words "coverage spike" from all four.

- [ ] **Step 8: Run the whole editor band once**

```bash
cd /work && E2E_FILTER='user-journey|interaction-exercise|asset-layer|deep-editor|editor-paste' bash e2e/run-all.sh | tail -8
```

Expected: `e2e: 5 passed, 0 failed (of 5)` and `ALL E2E PASS`.

- [ ] **Step 9: Commit**

```bash
cd /work
git add e2e/user-journey-probe.mjs e2e/interaction-exercise-probe.mjs e2e/asset-layer-probe.mjs e2e/fixtures/make_asset_layer_deck.py e2e/run-all.sh
git commit -F - <<'EOF'
test(e2e): make the journey, interaction and asset-layer probes able to fail

All three were gated but every behavioural check was soft, up to eight
could fail before the exit code changed, and asset-layer's crash sentinel
filtered out any error mentioning asset, render or load. Promote the
load-bearing checks to hard failures (slide count changes, all ten inserts,
present enter/advance/exit, menu save bumping the mtime and round-tripping,
drag/resize/delete/add-body, Bring to Front strictly raising z-order,
AssetSection rendering, pdf render when pdfium is present), drop the
seam-save fallback so the menu save path is what is observed, narrow the
sentinel filters, make the dangling-link fixture unambiguous, lower the soft
budgets to the documented optional steps, and let run-all.sh show the soft
report instead of the last four lines.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

---

### Task 6: Remove the debugging leftovers in interaction-exercise-probe.mjs

**Files:**
- Modify: `e2e/interaction-exercise-probe.mjs:12, 344-345, 373`

**Interfaces:**
- Consumes: `handles(sid)`, `switchTo(sid, h)`, `findMainHandle(sid)`, `openSecurityWindow`, `waitForText`, `closeSecurityWindow` already exported from `e2e/_ui.mjs`.

- [ ] **Step 1: Import the shared helpers statically**

Change line 12 to:

```js
import { openApp, waitSeam, exec, post, quit, sleep, handles as uiHandles, switchTo as uiSwitchTo, findMainHandle, openSecurityWindow, waitForText, closeSecurityWindow } from './_ui.mjs';
```

- [ ] **Step 2: Replace the local reimplementations**

Delete lines 344 and 345 (the local `handles()` with the hardcoded `http://127.0.0.1:4444` and the local `switchTo(h)`), and replace them with:

```js
const handles = () => uiHandles(sid);
const switchTo = (h) => uiSwitchTo(sid, h);
```

Change line 346 from `const mainH = (await handles())[0];` to `const mainH = await findMainHandle(sid);` (handle order is not stable; the main window is the one carrying the seam).

Delete line 373 (`const { openSecurityWindow, waitForText, closeSecurityWindow } = await import('./_ui.mjs');`).

- [ ] **Step 3: Run the probe**

```bash
cd /work && E2E_FILTER='interaction-exercise' bash e2e/run-all.sh | tail -3
```

Expected: `ALL E2E PASS` on the first attempt.

- [ ] **Step 4: Commit**

```bash
cd /work
git add e2e/interaction-exercise-probe.mjs
git commit -F - <<'EOF'
refactor(e2e): use the shared window helpers in interaction-exercise

The probe reimplemented handles() and switchTo() with a hardcoded WebDriver
URL and a guard that never triggered, picked the main window by handle
index, and dynamically re-imported a module it already imported statically.
Use handles/switchTo/findMainHandle and the security-window helpers from
_ui.mjs.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

---

### Task 7: Move the copy-pasted probe helpers into _ui.mjs

**Files:**
- Modify: `e2e/_ui.mjs` (append)
- Modify: `e2e/interaction-exercise-probe.mjs`, `e2e/deep-editor-gestures-probe.mjs`, `e2e/asset-layer-probe.mjs`, `e2e/user-journey-probe.mjs`, `e2e/editor-paste-probe.mjs` (replace local copies with imports)

**Interfaces:**
- Produces, in `e2e/_ui.mjs`:
  - `installErrorSentinel(sid, key)`: injects `window.<key> = []` plus `error` and `unhandledrejection` listeners that push `String(message or reason)`. Returns nothing.
  - `readErrorSentinel(sid, key)`: returns the array (parsed).
  - `makeSoft(prefix)`: returns `{ soft, problems }` where `soft(label, ok, detail)` logs `✓`/`SKIP` and pushes to `problems` on failure, matching the existing per-probe implementations.
  - `pointerDrag(sid, elementId, dx, dy)`: pointerdown on `[data-element-id=...]` centre, six pointermoves, pointerup at `(+dx, +dy)` screen px. Returns the element's position after the drag or a string reason.
  - `marqueeDrag(sid, x0, y0, x1, y1)`: the same gesture on `.slide-canvas` (from empty canvas space), returns the selection object after.

- [ ] **Step 1: Read the five local implementations side by side**

```bash
cd /work && grep -n 'function soft\|__deepErrors\|__jErrors\|__ixErrs\|__pasteErrs\|__alErrs\|pointerdown\|slide-canvas' e2e/interaction-exercise-probe.mjs e2e/deep-editor-gestures-probe.mjs e2e/asset-layer-probe.mjs e2e/user-journey-probe.mjs e2e/editor-paste-probe.mjs
```

Note the differences (sentinel key names, the number of pointermove steps, whether moves are dispatched on `window` or the node). The shared version must dispatch `pointermove`/`pointerup` on `window`, as `dragElementToX` in `_ui.mjs` already does, because that is where `SlideElementRenderer` listens.

- [ ] **Step 2: Append the shared helpers to _ui.mjs**

```js
// ── shared exercise helpers (used by the breadth probes) ─────────────────────
// Crash sentinel: collect uncaught errors + unhandled rejections into window[key].
export async function installErrorSentinel(sid, key = '__e2eErrors') {
  await exec(sid, `
    window[${JSON.stringify(key)}] = window[${JSON.stringify(key)}] || [];
    window.addEventListener('error', (e) => window[${JSON.stringify(key)}].push(String(e && (e.message || e.error) || e)));
    window.addEventListener('unhandledrejection', (e) => window[${JSON.stringify(key)}].push(String(e && (e.reason && (e.reason.message || e.reason)) || e)));
  `);
}
export async function readErrorSentinel(sid, key = '__e2eErrors') {
  const raw = await exec(sid, `return JSON.stringify(window[${JSON.stringify(key)}] || [])`);
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}
// Soft check: logs and records, never exits. Pair with a small budget + a hard
// fail() for the load-bearing steps.
export function makeSoft() {
  const problems = [];
  const soft = (label, ok, detail = '') => {
    if (ok) console.log(`  ✓ ${label}`);
    else { problems.push(`${label}${detail ? ' — ' + detail : ''}`); console.log(`  · SKIP ${label}${detail ? ' (' + detail + ')' : ''}`); }
    return !!ok;
  };
  return { soft, problems };
}
// Real pointer drag of an element by (dx, dy) SCREEN px. Returns the element's
// position afterwards, or a string reason.
export async function pointerDrag(sid, elementId, dx, dy) {
  return exec(sid, `
    const node = document.querySelector('[data-element-id=${JSON.stringify(elementId)}]');
    if (!node) return 'no-node';
    const r = node.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const opt = (x, y) => ({ clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0 });
    node.dispatchEvent(new PointerEvent('pointerdown', opt(x0, y0)));
    const N = 6;
    for (let i = 1; i <= N; i++) window.dispatchEvent(new PointerEvent('pointermove', opt(x0 + dx * i / N, y0 + dy * i / N)));
    window.dispatchEvent(new PointerEvent('pointerup', opt(x0 + dx, y0 + dy)));
    const s = window.__eigendeck.store.getState();
    const el = s.presentation.slides[s.currentSlideIndex]?.elements.find(e => e.id === ${JSON.stringify(elementId)});
    return el ? el.position : 'gone';
  `);
}
// Marquee from empty canvas space (x0,y0) to (x1,y1) in canvas-relative SCREEN px.
// Returns the selection object afterwards.
export async function marqueeDrag(sid, x0, y0, x1, y1) {
  return exec(sid, `
    const canvas = document.querySelector('.slide-canvas');
    if (!canvas) return 'no-canvas';
    const r = canvas.getBoundingClientRect();
    const opt = (x, y) => ({ clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerId: 1, button: 0 });
    canvas.dispatchEvent(new PointerEvent('pointerdown', opt(${x0}, ${y0})));
    const N = 6;
    for (let i = 1; i <= N; i++) window.dispatchEvent(new PointerEvent('pointermove', opt(${x0} + (${x1} - ${x0}) * i / N, ${y0} + (${y1} - ${y0}) * i / N)));
    window.dispatchEvent(new PointerEvent('pointerup', opt(${x1}, ${y1})));
    return window.__eigendeck.store.getState().selectedObject;
  `);
}
```

If a probe's existing marquee dispatches on a different element than `.slide-canvas` (check Step 1), keep that probe's target by adding an optional `selector = '.slide-canvas'` parameter rather than diverging copies.

- [ ] **Step 3: Replace the local copies, one probe at a time, running each after**

For each of the five probes: import the helpers you need from `./_ui.mjs`, delete the local `soft`/`problems`, sentinel injection, drag and marquee scripts, and call the shared ones. Keep each probe's sentinel key name so the log lines stay recognisable. After each probe:

```bash
cd /work && E2E_FILTER='<probe-name>' bash e2e/run-all.sh | tail -3
```

Expected: `ALL E2E PASS` on the first attempt each time.

- [ ] **Step 4: Confirm no local copies remain**

```bash
cd /work && grep -c 'const problems = \[\]' e2e/*.mjs | grep -v ':0'
```

Expected: only `e2e/_ui.mjs` (inside `makeSoft`), or nothing.

- [ ] **Step 5: Commit**

```bash
cd /work
git add e2e/_ui.mjs e2e/interaction-exercise-probe.mjs e2e/deep-editor-gestures-probe.mjs e2e/asset-layer-probe.mjs e2e/user-journey-probe.mjs e2e/editor-paste-probe.mjs
git commit -F - <<'EOF'
refactor(e2e): share the sentinel, soft-check and pointer-gesture helpers

The five breadth probes each carried their own copy of the crash sentinel
installer, the soft() recorder, a pointer drag and a marquee gesture, with
small drifts between them. Move one implementation of each into _ui.mjs
next to dragElementToX and pasteInto and import it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

---

### Task 8: Document the new probes and the gating rule in e2e/README.md

**Files:**
- Modify: `e2e/README.md` (the gated list and the "Not yet gated" section around line 35)

- [ ] **Step 1: Add the five probes to the gated list**

Find where `README.md` lists the gated probes (search for `paste-file-probe` or `keyboard-shortcuts-probe`) and add, in the same style, one entry each for `editor-paste-probe.mjs`, `interaction-exercise-probe.mjs`, `user-journey-probe.mjs`, `deep-editor-gestures-probe.mjs` and `asset-layer-probe.mjs`. Each entry names its fixture builder and states what it asserts hard (copy from the manifest comments you wrote in Task 5 Step 7).

- [ ] **Step 2: State the gating rule**

In the "Not yet gated (intentionally excluded)" section, after the intro sentence `These live in e2e/ but are NOT in run-all.sh, by design:`, add a paragraph:

```markdown
The rule is about assertions, not breadth. A broad probe is gated once its
load-bearing steps call `fail()` directly and any `soft()` budget covers only
steps that are documented as optional (window openers, dialog-gated ids,
optional inspector controls). The build-hunt probes below stay out because
they are exploratory and have no such hard core.
```

- [ ] **Step 3: Point to the coverage doc**

Add a short section at the end of the README:

```markdown
### Coverage

The instrumented run (`COVERAGE_INSTRUMENT=1`) collects real-WebKit line hits
from every probe through `src/lib/coverageBeacon.ts`. How it works, how to run
it, and what stays cold headlessly: `docs/e2e-coverage.md`.
```

- [ ] **Step 4: Commit**

```bash
cd /work
git add e2e/README.md
git commit -F - <<'EOF'
docs(e2e): list the five new gated probes and state the gating rule

The README did not mention editor-paste, interaction-exercise, user-journey,
deep-editor-gestures or asset-layer, and its "Not yet gated" rationale read
as if breadth alone excluded a probe. Document each new probe with what it
asserts hard, state that gating depends on hard assertions rather than
scope, and point to docs/e2e-coverage.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

---

### Task 9: Fix the weak unit-test assertions

**Files:**
- Modify: `src/store/presentation.exercise.test.ts:73, 109, 350, 568`
- Modify: `src/lib/securityWindow.test.ts` (top-level `beforeEach`/`afterEach`)
- Modify: `src/lib/serverDiscovery.test.ts:159`

- [ ] **Step 1: Replace the tautology at line 73**

Replace:

```ts
    expect(allIds.has(selectedObject.id) || true).toBe(true);
```

with:

```ts
    // The store must never leave a selection pointing at an element that no
    // longer exists: deletes reset to { type: 'slide' } and freeElement remaps
    // the selection with the id.
    expect(allIds.has(selectedObject.id), `${label}: selection ${selectedObject.id} names a live element`).toBe(true);
```

Run `npx vitest run src/store/presentation.exercise.test.ts`. If a test now fails, read which action left a dangling selection. That is either a real store bug (report it with the action name and stop; do not loosen the assertion) or the test deleting a selected element through a path that legitimately leaves the selection to the caller. In the second case, add `store.selectSlide(store.currentSlideIndex)` in the test right after that delete with a comment saying why.

- [ ] **Step 2: Tighten the two `>=` assertions**

Line 109: change `toBeGreaterThanOrEqual(6)` to `toBe(7)` (the setup adds exactly seven slides; count them in the lines above and adjust the literal if the count differs).

Line 568: change `expect(n).toBeGreaterThanOrEqual(1);` to `expect(n).toBe(2);` (three timestamps, latest dropped, two seeded, as the existing comment says).

- [ ] **Step 3: Make the same-slide comment at line 350 true**

The call `store.linkElements('A', 0, 'B')` exits at the `!target` guard because `B` is not on slide 0. Read the fixture at lines 330 to 348, pick an element that IS on slide 0 alongside `A` (call it `X`), and change the line to `store.linkElements('A', 0, 'X');` with the comment `// same slide → guard no-op`. Add after the three no-op calls:

```ts
    const unchanged = usePresentationStore.getState().presentation.slides.flatMap((s) => s.elements).map((e) => [e.id, (e as { linkId?: string }).linkId]);
    expect(unchanged.find(([id]) => id === 'A')?.[1]).toBeUndefined();
```

so the three guards are observed rather than merely executed.

- [ ] **Step 4: Stop the timer leak in securityWindow.test.ts**

Add a top-level `beforeEach`/`afterEach` pair after the mocks (before the first `describe`):

```ts
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
```

Run `npx vitest run src/lib/securityWindow.test.ts`. If a test hangs or times out because `openSecurityWindow` awaits a timer, replace that test's bare `await openSecurityWindow()` with:

```ts
    const p = openSecurityWindow();
    await vi.advanceTimersByTimeAsync(0);
    await p;
```

and, for the tests that assert the 1500 ms fallback emit, drive it explicitly with `await vi.advanceTimersByTimeAsync(1500)` before the `expect(h.emitTo)` line.

- [ ] **Step 5: Rename the contradictory test title**

Line 159 of `src/lib/serverDiscovery.test.ts`: change the title to `'writes when only lastSeenAt refreshes (a successful probe always bumps it)'`.

- [ ] **Step 6: Run the three files and the full suite**

```bash
cd /work && npx vitest run src/store/presentation.exercise.test.ts src/lib/securityWindow.test.ts src/lib/serverDiscovery.test.ts && npx vitest run && npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd /work
git add src/store/presentation.exercise.test.ts src/lib/securityWindow.test.ts src/lib/serverDiscovery.test.ts
git commit -F - <<'EOF'
test: tighten the exercise assertions and stop a timer leak

presentation.exercise.test.ts asserted (x || true) for the selection
invariant, accepted >= where the value is exact, and described a same-slide
guard its call never reached. Assert the real invariant, pin the exact
counts, observe the three linkElements guards, and make the comment true.
securityWindow.test.ts left real 1.5 s and 15 s timers running across tests
that assert emitTo call counts; run it under fake timers. Rename a
serverDiscovery title that contradicted itself.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

---

### Task 10: Cut db.test.ts to the code the app actually uses

**Files:**
- Modify: `src/store/db.test.ts` (keep the scaffolding at lines 1 to about 100 and the `write ops that parse a JSON return payload` describe at lines 481 to 509; delete the rest)

- [ ] **Step 1: Confirm the live call surface**

```bash
cd /work && grep -rn "store/db'" src --include=*.ts --include=*.tsx | grep -v '\.test\.'
```

Expected: exactly one hit, `src/App.tsx` importing `dbGcAssets`. If there are more hits, keep the tests for those exports as well and list them in the commit body.

- [ ] **Step 2: Rewrite the file**

Keep: the file header comment (rewrite it as below), the imports (trim the named import list to `dbGcAssets, dbCompact`), `mockInvoke`, `callAt`/`lastCall`, the `beforeEach`/`afterEach` that reset the mock, and the `describe('write ops that parse a JSON return payload', ...)` block. Delete every other `describe`. New header:

```ts
// Unit tests for the parts of src/store/db.ts the app still calls.
//
// db.ts is a vestigial SQLite facade: the Zustand store in presentation.ts is
// authoritative, and the only live caller is App.tsx's "GC assets" command
// (dbGcAssets). Tests here cover that path and dbCompact, which shares its
// JSON-payload shape. Do not add tests for the unused hooks/setters; delete
// them from db.ts instead (see Task 11 of docs/2026-09-09-coverage-branch-cleanup-plan.md).
```

- [ ] **Step 3: Run it**

```bash
cd /work && npx vitest run src/store/db.test.ts && npx tsc --noEmit
```

Expected: 3 passed, tsc clean.

- [ ] **Step 4: Commit**

```bash
cd /work
git add src/store/db.test.ts
git commit -F - <<'EOF'
test(store): cut db.test.ts to the dbGcAssets/dbCompact paths the app uses

db.ts is a vestigial facade; presentation.ts is the authoritative store and
App.tsx's GC command is the only live importer. Five hundred lines of tests
over unused hooks and setters raised the coverage number without protecting
anything and made deleting the dead module harder. Keep the payload-parsing
tests for the two functions with a caller.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

---

### Task 11: Delete the dead exports from db.ts

**Files:**
- Modify: `src/store/db.ts`

- [ ] **Step 1: Remove everything without a caller**

Delete from `src/store/db.ts`: the event bus (`listeners`, `emit`, `subscribe`), the app-state block and `useUIState`, the five setters, `toggleSelectElement`, `SelectedObject` (check first with `grep -rn "SelectedObject" src | grep -v db.ts` that nothing imports it from `db`; the store has its own), `dbOpen`, `dbClose`, `dbImportJson`, `dbExportJson`, `useSlides`, `useSlideElements`, `usePresentationConfig`, `dbUpdateElement`, `dbAddElement`, `dbRemoveElementFromSlide`, `dbAddSlide`, `dbDeleteSlide`, `dbDuplicateSlide`, `dbMoveSlide`, `dbUpdateSlide`, `dbUpdateZOrder`, `dbFreeElement`, `dbStoreAsset`, `dbGetAsset`, `dbUpdatePresentation`. Keep `dbCompact` and `dbGcAssets`. Drop the now-unused `react` and type imports. Replace the header docblock with:

```ts
/**
 * Thin invoke() wrappers for the two maintenance commands App.tsx calls
 * (Compact and GC assets). All other deck state goes through the Zustand
 * store in ./presentation.ts; the SQLite facade that used to live here was
 * never wired in and was removed on 2026-09-09.
 */
```

- [ ] **Step 2: Prove nothing else depended on it**

```bash
cd /work && npx tsc --noEmit && npx vitest run && npm run build
```

Expected: all green. `npm run build` is included because `tsc` alone does not follow dynamic imports' string paths; a successful Vite build confirms `App.tsx`'s `import('./store/db')` still resolves and exports `dbGcAssets`.

- [ ] **Step 3: Commit**

```bash
cd /work
git add src/store/db.ts
git commit -F - <<'EOF'
refactor(store): delete the unused SQLite facade from db.ts

Every export except dbCompact and dbGcAssets had no caller outside its own
test file; the header claimed it replaced the Zustand store, which it never
did. Remove the dead hooks, setters and write helpers so the module states
what it is: two invoke wrappers for the maintenance commands.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

---

### Task 12: Re-ratchet the vitest thresholds honestly

**Files:**
- Modify: `vite.config.ts` (the `thresholds` block)

- [ ] **Step 1: Measure**

```bash
cd /work && npx vitest run --coverage 2>&1 | grep -E '^All files|ERROR'
```

Note the four numbers (statements, branches, functions, lines). Before this plan they were 46.58 / 45.52 / 45.32 / 48.62 against 46 / 45 / 45 / 48. Removing `db.test.ts` and the dead code in `db.ts` moves both numerator and denominator, so the result is not predictable; measure it.

- [ ] **Step 2: Set each threshold to the measured value rounded down to a whole number, minus one**

Example: measured `45.9` becomes `44`. Edit the four values in `vite.config.ts` and update the comment above them to read:

```ts
      // Ratchet: each floor is the measured value at the last ratchet (see the
      // commit that set it) rounded down minus one point, so an unrelated
      // refactor does not trip it while a real coverage drop does. Raise them
      // when a coverage push lands; never lower them without saying why.
```

- [ ] **Step 3: Verify the gate passes**

```bash
cd /work && npx vitest run --coverage 2>&1 | grep -E 'ERROR|threshold' ; echo "rc=${PIPESTATUS[0]}"
```

Expected: no `ERROR` lines and `rc=0`.

- [ ] **Step 4: Commit**

```bash
cd /work
git add vite.config.ts
git commit -F - <<'EOF'
chore(coverage): re-ratchet the vitest floors after removing dead-code tests

The floors were set within 0.6 points of the measured value, so any
refactor tripped them, and part of the margin came from tests over an
unused module. Set each floor to the measured value rounded down minus one
point (measured: <fill in the four numbers>).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

Fill in the four measured numbers in the commit body before committing.

---

### Task 13: Update docs/e2e-coverage.md and add the session log

**Files:**
- Modify: `docs/e2e-coverage.md`
- Create: `.claude/logs/2026-09-09-coverage-cleanup-session.md`

- [ ] **Step 1: Correct the doc**

In `docs/e2e-coverage.md`:

1. In "How it works", after the Harvest item, add: `Probes call quit() from e2e/_ui.mjs, which awaits window.__covFlush() so the final interval window is not lost.`
2. Above the "Results (full suite)" table, add one sentence: `These numbers are from one run on one machine; expect a point or two of variation between runs (secondary windows and timing), so compare trends, not decimals.`
3. In "Run it", add a fourth step: `python3 scripts/gen_coverage_viz.py coverage-rust-e2e.lcov   # interlinked source map → coverage-viz/ (gitignored)`.
4. Replace the "Not yet in CI" heading and paragraph with a "CI" section that says the workflow runs weekly and on dispatch, exits non-zero when the suite fails, uploads `coverage-unified/`, `coverage-rust-e2e.lcov`, `coverage-viz/` and `coverage/` as artifacts, and that its first run after this branch merges must be watched because it has never executed on a runner.
5. Search the doc for `interaction-exercise` and `user-journey` and adjust the sentences that say they assert only a no-crash invariant: they now assert the steps listed in Task 5 hard, with a small soft budget for the documented optional steps.

- [ ] **Step 2: Write the session log**

Create `.claude/logs/2026-09-09-coverage-cleanup-session.md` in the style of `2026-09-04-valign-edit-shift-session.md` (read it first). Cover, in prose: what the review of `feat/e2e-coverage-spike` and `feat/coverage-viz` found, what this cleanup changed (untracked the generated map, declared deps, honest exit codes, beacon flush, hard assertions in the three probes, shared helpers, unit-test fixes, db.ts deletion, re-ratchet), what was deliberately left (cli-coverage.sh remains a measurement driver with tolerant commands, the CI workflow is unverified until its first run, the macOS and dialog-gated code stays cold headlessly), and the final measured numbers.

- [ ] **Step 3: Commit**

```bash
cd /work
git add docs/e2e-coverage.md .claude/logs/2026-09-09-coverage-cleanup-session.md
git commit -F - <<'EOF'
docs(coverage): reflect the cleanup in e2e-coverage.md and log the session

Describe the beacon flush, mark the reported percentages as run-dependent,
add the map generation step, replace the stale "not yet in CI" note with
what the job now does and that its first run must be watched, and stop
describing the journey and interaction probes as no-crash-only. Add the
session log the repo convention asks for.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y9D5AxEo2guAQ22NQnstL3
EOF
```

---

## Final verification before handing back

- [ ] `git status --short` shows nothing untracked except pre-existing local files unrelated to this branch (`examples/genslm-argonne-native.eigendeck` and the modified `examples/graph-algorithms.eigendeck` predate this work; leave them alone).
- [ ] `npx tsc --noEmit && npx vitest run --coverage` green.
- [ ] `E2E_FILTER='user-journey|interaction-exercise|asset-layer|deep-editor|editor-paste|zorder|undo-probe' bash e2e/run-all.sh` prints `ALL E2E PASS` with no retry lines.
- [ ] `export PATH="$HOME/.cargo/bin:$PATH" CARGO_TARGET_DIR="$HOME/el-target"; cd src-tauri && cargo check && cargo clippy -- -D warnings && cargo fmt --check` green (no Rust source changed in this plan, so this is a sanity check only).
- [ ] `git log --oneline main..HEAD | wc -l` equals the previous count plus 13 (one commit per task).
- [ ] Report back with the final four coverage numbers, the e2e summary line, and anything a task told you to stop and report (a dangling selection in Task 9 Step 1, a missing-source banner in Task 5 Step 5, or a menu save that does not write in Task 5 Step 2).
