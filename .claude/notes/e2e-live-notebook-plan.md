# Live-notebook (edit + run + persist) e2e — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Design: `.claude/notes/e2e-live-notebook-design.md`.

**Goal:** Add the first e2e that boots a real Jupyter kernel, edits a notebook cell in-app, runs it, and asserts the edited source + live output survive save→reopen.

**Architecture:** A sourced `jupyter-server.sh` harness (harvested from `spike-tools`) boots a real `jupyter server`; a fixture deck carries one `editable` external-kernel notebook; a probe injects the `jupyterServers` pref, drives edit+run through the real UI, then quits/reopens and re-asserts persistence.

**Tech Stack:** Bash + `uv` venv (jupyter-server, ipykernel); Python fixture generator + `eigendeck-cli import json`; Node WebDriver probe (`tauri-driver` + WebKitWebDriver + xvfb); the `window.__eigendeck` seam.

**Prereqs (eigendeck-e2e skill):** `E2E_APP` built; `dist/` built with `VITE_EIGENDECK_SEAM=1 npm run build`; `eigendeck-cli` built. Run everything with `~/.cargo/bin/cargo` and `dangerouslyDisableSandbox` where the skill requires.

---

## File structure

- Create `e2e/jupyter-server.sh` — venv + boot + readiness-poll + trap-teardown of a real jupyter server. (Harvest of `spike-tools/test_playwright.py` + `spike-tools/setup.sh`.)
- Create `e2e/fixtures/make_live_nb_deck.py` — emits the deck JSON (one editable external-kernel notebook, one code cell `k = 5`).
- Create `e2e/nb-live-run-persist.mjs` — the probe.
- Modify `e2e/run-probe.sh` — start/stop the jupyter server around a probe when `E2E_JUPYTER=1`.
- Modify `e2e/README.md` — scenario doc + uv/jupyter prereq.
- Modify `e2e/run-all.sh` — add the probe to the MANIFEST (initially commented "opt-in", per design: don't gate until proven stable).
- Delete `spike-tools/` (final task, once the suite is green).

---

## Task 1: Fixture generator

**Files:**
- Create: `e2e/fixtures/make_live_nb_deck.py`

- [ ] **Step 1: Write the fixture generator**

Mirror the shape of `e2e/fixtures/make_e2e_decks.py` (helpers `ipynb`, `code_cell`, `nb_el`, base64 assets; MIME `application/x-ipynb+json`). One slide, one notebook element that is **editable** and uses an **external** kernel. Kernel URL/token live in the pref, NOT the element.

```python
#!/usr/bin/env python3
# Deck for nb-live-run-persist.mjs: ONE editable notebook on ONE external
# python3 kernel, a single code cell `k = 5`. The probe edits the cell to print
# a computed marker, runs it live, then saves/reopens to assert persistence.
import base64, json, sys

IPY = "application/x-ipynb+json"

def b64(o): return base64.b64encode(json.dumps(o).encode()).decode()

def code_cell(src):
    return {"cell_type": "code", "source": [src], "outputs": [],
            "execution_count": None, "metadata": {}}

def ipynb(cells):
    return {"cells": cells,
            "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3"}},
            "nbformat": 4, "nbformat_minor": 5}

def deck():
    nb = ipynb([code_cell("k = 5\n")])
    return {
        "slides": [{
            "id": "s1",
            "elements": [{
                "id": "nb1", "type": "notebook", "assetId": "ipy",
                "position": {"x": 120, "y": 80, "width": 1200, "height": 700},
                "editable": True,
                "kernel": {"kind": "external", "kernelName": "python3"},
            }],
        }],
        "assets": [
            {"assetId": "ipy", "mime": IPY, "path": "nb.ipynb", "data": b64(nb)},
        ],
    }

if __name__ == "__main__":
    out = sys.argv[1]
    with open(out, "w") as f:
        json.dump(deck(), f, indent=2)
    print(f"wrote {out}")
```

- [ ] **Step 2: Verify it builds a deck**

Run:
```bash
cd /work
python3 e2e/fixtures/make_live_nb_deck.py /tmp/live-nb.json
CLI=/tmp/el-target/debug/eigendeck-cli
"$CLI" /tmp/live-nb.eigendeck import json /tmp/live-nb.json
"$CLI" /tmp/live-nb.eigendeck outline
```
Expected: `outline` lists one slide with a notebook element; no import error.

- [ ] **Step 3: Confirm the element shape matches the schema**

Run:
```bash
python3 -c "import sqlite3,json; c=sqlite3.connect('/tmp/live-nb.eigendeck'); \
rows=c.execute(\"select type,data from elements where valid_to is null\").fetchall(); \
[print(t, json.loads(d).get('editable'), json.loads(d).get('kernel')) for t,d in rows]"
```
Expected: `notebook True {'kind': 'external', 'kernelName': 'python3'}`. If `editable`/`kernel` are absent, cross-check field names in `src/types/presentation.ts` `NotebookElement` and fix the fixture.

- [ ] **Step 4: Commit**

```bash
git -c safe.directory=/work add e2e/fixtures/make_live_nb_deck.py
git -c safe.directory=/work commit -m "e2e: fixture deck for live-notebook run+persist"
```

---

## Task 2: Jupyter server harness (harvest spike-tools)

**Files:**
- Create: `e2e/jupyter-server.sh`

- [ ] **Step 1: Write the harness**

```bash
#!/bin/bash
# Boot a REAL jupyter server for the live-notebook e2e, then tear it down.
# Harvested from spike-tools/setup.sh + test_playwright.py. Source this, call
# jupyter_start before launching the app and jupyter_stop on exit.
#
#   source e2e/jupyter-server.sh
#   jupyter_start            # boots on 127.0.0.1:$JUP_PORT, token $JUP_TOKEN
#   trap jupyter_stop EXIT
#
# Requires `uv`. The venv is cached at $JUP_VENV so repeat runs are fast.
JUP_PORT="${JUP_PORT:-8888}"
JUP_TOKEN="${JUP_TOKEN:-e2e-token}"
JUP_VENV="${JUP_VENV:-/tmp/e2e-jupyter-venv}"
JUP_LOG="${JUP_LOG:-/tmp/e2e-jupyter.log}"
_JUP_PID=""

jupyter_ensure_venv() {
  if [ ! -x "$JUP_VENV/bin/jupyter" ]; then
    uv venv "$JUP_VENV" >/dev/null 2>&1
    uv pip install --python "$JUP_VENV/bin/python" jupyter-server ipykernel >/dev/null 2>&1
    "$JUP_VENV/bin/python" -m ipykernel install --prefix "$JUP_VENV" --name python3 >/dev/null 2>&1 || true
  fi
}

jupyter_start() {
  jupyter_ensure_venv
  "$JUP_VENV/bin/jupyter" server --no-browser --port="$JUP_PORT" \
    --ServerApp.ip=127.0.0.1 --IdentityProvider.token="$JUP_TOKEN" \
    --ServerApp.allow_origin='*' --ServerApp.disable_check_xsrf=True \
    >"$JUP_LOG" 2>&1 &
  _JUP_PID=$!
  for i in $(seq 1 40); do
    if curl -s "http://127.0.0.1:$JUP_PORT/api?token=$JUP_TOKEN" | grep -q version; then
      echo "[jupyter] ready on :$JUP_PORT (pid $_JUP_PID)"; return 0
    fi
    sleep 0.5
  done
  echo "[jupyter] FAILED to start; log:"; cat "$JUP_LOG"; return 1
}

jupyter_stop() {
  [ -n "$_JUP_PID" ] && kill "$_JUP_PID" 2>/dev/null
  # kill any leaked kernels this server spawned
  pkill -f "$JUP_VENV/bin/python -m ipykernel_launcher" 2>/dev/null || true
}
```

- [ ] **Step 2: Verify the harness boots and tears down standalone**

Run:
```bash
cd /work
bash -c 'source e2e/jupyter-server.sh; jupyter_start && \
  curl -s "http://127.0.0.1:8888/api/kernelspecs?token=e2e-token" | grep -o python3 | head -1; \
  jupyter_stop'
```
Expected: `[jupyter] ready on :8888 ...` then `python3`. (First run installs the venv — slow; use `dangerouslyDisableSandbox`.)

- [ ] **Step 3: Commit**

```bash
git -c safe.directory=/work add e2e/jupyter-server.sh
git -c safe.directory=/work commit -m "e2e: real-jupyter server harness (harvested from spike-tools)"
```

---

## Task 3: Probe — open, inject pref, render (no run yet)

**Files:**
- Create: `e2e/nb-live-run-persist.mjs`

Copy the WebDriver boilerplate verbatim from `e2e/nb-promote-reload.mjs` (the `post`/`execSync`/`execAsync`/`dom`/`open`/`waitSeam` helpers, `BASE='http://127.0.0.1:4444'`). Build up the probe incrementally.

- [ ] **Step 1: Write the first assertion — deck opens and the cell renders `k = 5`**

```javascript
// e2e/nb-live-run-persist.mjs — live external kernel: edit a cell, run it,
// assert the real output, then save/quit/reopen and assert edit+output persisted.
// (helpers post/execSync/execAsync/dom/open/waitSeam copied from nb-promote-reload.mjs)
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const JUP_URL = process.env.E2E_JUP_URL || 'http://127.0.0.1:8888';
const JUP_TOKEN = process.env.E2E_JUP_TOKEN || 'e2e-token';
const fail = (m) => { console.error('E2E_FAIL ' + m); process.exit(1); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function pollDom(sid, needle, ms = 20000) {
  for (let t = 0; t < ms; t += 500) { if ((await dom(sid)).includes(needle)) return true; await sleep(500); }
  return false;
}

(async () => {
  const sid = await open();
  if (!sid) fail('no session');
  if (!await waitSeam(sid)) fail('no seam');
  // inject the per-machine jupyterServers pref BEFORE the kernel connects
  await execSync(sid, `localStorage.setItem('eigendeck:pref:jupyterServers', JSON.stringify(
    [{ label: 'e2e', baseUrl: ${JSON.stringify(JUP_URL)}, token: ${JSON.stringify(JUP_TOKEN)}, availableKernels: ['python3'] }]));`);
  if (!await pollDom(sid, 'k = 5')) fail('cell source k = 5 not rendered');
  console.log('E2E_OK render');
  process.exit(0);
})();
```

- [ ] **Step 2: Run it (through the harness) and confirm render**

Run:
```bash
cd /work
python3 e2e/fixtures/make_live_nb_deck.py /tmp/live-nb.json
/tmp/el-target/debug/eigendeck-cli /tmp/live-nb.eigendeck import json /tmp/live-nb.json
PROBE=e2e/nb-live-run-persist.mjs E2E_DECK=/tmp/live-nb.eigendeck bash e2e/run-probe.sh
```
Expected: `E2E_OK render`. If the notebook shows a placeholder/parse error instead of `k = 5`, re-check the fixture ipynb shape (Task 1 Step 3).

- [ ] **Step 3: Commit**

```bash
git -c safe.directory=/work add e2e/nb-live-run-persist.mjs
git -c safe.directory=/work commit -m "e2e: live-notebook probe — open + inject pref + render"
```

---

## Task 4: Probe — drive edit + run against the live kernel

**Files:**
- Modify: `e2e/nb-live-run-persist.mjs`
- Modify: `e2e/run-probe.sh` (start/stop jupyter around the probe)

- [ ] **Step 1: Wire the jupyter server into run-probe.sh**

In `e2e/run-probe.sh`, after the env setup and before launching xvfb/driver, add (guarded so non-notebook probes are unaffected):

```bash
if [ "${E2E_JUPYTER:-}" = "1" ]; then
  source "$ROOT/e2e/jupyter-server.sh"
  jupyter_start || exit 1
  trap jupyter_stop EXIT
fi
```

- [ ] **Step 2: Add the edit+run+assert-live-output block to the probe**

Insert before `process.exit(0)` in Task 3's probe. The editable source is a **CodeMirror** editor; the run button is `button.nb-cell-run`; clicking requires the element to be interactive (`captures`). Primary technique: select the notebook to enable capture, focus the CodeMirror content, replace the doc, then click Run. Assert a **computed** marker so a stale value can't pass.

```javascript
  // make the notebook interactive so the cell buttons take clicks
  await execSync(sid, `(document.querySelector('.el-notebook,[data-el-type="notebook"]')||document.querySelector('.nb-body'))?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));`);
  await sleep(500);
  // edit: replace the CodeMirror doc with a computed-output line
  const NEWSRC = 'print("E2E_LIVE_%d" % (6*7))';
  const setOk = await execSync(sid, `(() => {
    const cm = document.querySelector('.cm-content');
    if (!cm) return 'no-cm';
    cm.focus();
    const sel = window.getSelection(); const r = document.createRange();
    r.selectNodeContents(cm); sel.removeAllRanges(); sel.addRange(r);
    document.execCommand('insertText', false, ${JSON.stringify(NEWSRC)});
    return document.querySelector('.cm-content')?.textContent?.includes('E2E_LIVE') ? 'ok' : 'no-set';
  })();`);
  if (setOk !== 'ok') fail('could not set cell source via CodeMirror (' + setOk + ') — see FALLBACK');
  // run the cell (lazy WS connect happens here)
  await execSync(sid, `document.querySelector('.nb-cell-run')?.click();`);
  if (!await pollDom(sid, 'E2E_LIVE_42', 30000)) fail('live kernel output E2E_LIVE_42 not seen');
  console.log('E2E_OK live-run');
```

**FALLBACK (only if Step 3 shows the CodeMirror drive is flaky):** add a seam hook. In `src/App.tsx` where `window.__eigendeck` is assembled (search `__eigendeck`), expose a test-only `setNotebookCellSource(elId, cellIndex, src)` that calls the same `live.setWorking`/overlay path, and have the probe call it instead of the `execCommand` block. Keep it behind the existing `VITE_EIGENDECK_SEAM` gate. Re-run Step 3.

- [ ] **Step 3: Run and confirm live execution**

Run:
```bash
cd /work
PROBE=e2e/nb-live-run-persist.mjs E2E_DECK=/tmp/live-nb.eigendeck E2E_JUPYTER=1 bash e2e/run-probe.sh
```
Expected: `E2E_OK live-run`. `E2E_LIVE_42` can only appear if the kernel actually ran `6*7`. If it times out, check `/tmp/e2e-jupyter.log` and that the pref `baseUrl`/`token` match the server.

- [ ] **Step 4: Commit**

```bash
git -c safe.directory=/work add e2e/nb-live-run-persist.mjs e2e/run-probe.sh
git -c safe.directory=/work commit -m "e2e: live-notebook probe — drive edit + run against real kernel"
```

---

## Task 5: Probe — persist across save/quit/reopen

**Files:**
- Modify: `e2e/nb-live-run-persist.mjs`

- [ ] **Step 1: Add save → quit → reopen → re-assert**

Replace the final `console.log('E2E_OK live-run'); process.exit(0)` with:

```javascript
  // persist, close, reopen, re-assert BOTH the edit and the live output survived
  await execSync(sid, `window.__eigendeck.save();`);
  await sleep(1500);
  await post(`/session/${sid}/window`, {}).catch(() => {});  // best-effort; then delete session
  await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
  await sleep(1000);
  const sid2 = await open();
  if (!sid2) fail('no reopen session');
  if (!await waitSeam(sid2)) fail('no seam on reopen');
  if (!await pollDom(sid2, 'E2E_LIVE_42')) fail('live output did NOT persist across reopen');
  if (!await pollDom(sid2, 'E2E_LIVE_%d')) fail('edited source did NOT persist across reopen');
  console.log('E2E_PASS live edit+run+persist');
  process.exit(0);
```

Note: the edited-source assertion looks for the literal `E2E_LIVE_%d` (the source text `print("E2E_LIVE_%d" % (6*7))`), distinct from the output `E2E_LIVE_42`, so the two checks can't alias.

- [ ] **Step 2: Run the full round-trip**

Run:
```bash
cd /work
PROBE=e2e/nb-live-run-persist.mjs E2E_DECK=/tmp/live-nb.eigendeck E2E_JUPYTER=1 bash e2e/run-probe.sh
```
Expected: `E2E_PASS live edit+run+persist`.

- [ ] **Step 3: Verify persistence in the SAVED FILE (skill gotcha 7)**

Run:
```bash
python3 -c "import sqlite3; c=sqlite3.connect('/tmp/live-nb.eigendeck'); \
print(c.execute(\"select count(*) from assets where mime like '%overlay%' and valid_to is null\").fetchone())"
```
Expected: a non-zero overlay count (the run+edit recorded an overlay). If zero, the save didn't flush the overlay — investigate before proceeding.

- [ ] **Step 4: Commit**

```bash
git -c safe.directory=/work add e2e/nb-live-run-persist.mjs
git -c safe.directory=/work commit -m "e2e: live-notebook probe — assert edit+output persist across reopen"
```

---

## Task 6: Document + wire in (opt-in, not gated yet)

**Files:**
- Modify: `e2e/README.md`
- Modify: `e2e/run-all.sh`

- [ ] **Step 1: Document the scenario + prereq in e2e/README.md**

Add under the notebook scenarios: name `nb-live-run-persist.mjs`, what it proves (real kernel edit+run+persist), and the prereq — needs `uv` + `E2E_JUPYTER=1` (boots a real jupyter server via `e2e/jupyter-server.sh`). Note it is NOT in the gating MANIFEST yet (non-hermetic: needs network for the first `uv pip install`), matching the `relay-fps-probe` "not yet gated" precedent.

- [ ] **Step 2: Add a commented MANIFEST entry in run-all.sh**

Add to `run-all.sh`, commented out, with a one-line note that enabling it requires `uv` and sets `E2E_JUPYTER=1`:

```bash
# Live kernel — opt-in (needs uv + network for first venv build). Enable when the
# CI image ships jupyter. Setup builds the fixture deck like the other nb probes.
# "nb-live-run-persist.mjs | live-nb.eigendeck | E2E_JUPYTER=1 | python3 $ROOT/e2e/fixtures/make_live_nb_deck.py $DECKDIR/live.json && $CLI $DECK import json $DECKDIR/live.json"
```

- [ ] **Step 3: Commit**

```bash
git -c safe.directory=/work add e2e/README.md e2e/run-all.sh
git -c safe.directory=/work commit -m "e2e: document + stage (opt-in) the live-notebook probe"
```

---

## Task 7: Retire spike-tools (value now migrated)

**Files:**
- Delete: `spike-tools/`

- [ ] **Step 1: Confirm nothing references spike-tools**

Run:
```bash
cd /work
grep -rn "spike-tools" --include="*.mjs" --include="*.ts" --include="*.sh" e2e/ src/ 2>/dev/null | grep -v "jupyter-server.sh"
```
Expected: no output (the harness is self-contained; the boot logic was harvested, not imported).

- [ ] **Step 2: Delete and reclaim the gitignored venv**

```bash
cd /work
git -c safe.directory=/work rm -r spike-tools
rm -rf spike-tools   # removes the gitignored .venv/lite-build too
```

- [ ] **Step 3: Commit**

```bash
git -c safe.directory=/work commit -m "chore: retire spike-tools (kernel harness migrated into e2e/jupyter-server.sh)"
```

---

## Self-review notes

- **Spec coverage:** boot real kernel (Task 2), editable external notebook fixture (Task 1), inject pref (Task 3), edit-in-app (Task 4, CodeMirror + documented seam fallback), live run + computed marker (Task 4), save/quit/reopen persist (Task 5), harvest-then-delete spike-tools (Tasks 2+7), opt-in not gated (Task 6). All covered.
- **Determinism:** `E2E_LIVE_42` is computed (`6*7`) so no fixture can pre-bake it; edited-source check uses the distinct literal `E2E_LIVE_%d`.
- **Known risk carried from the design:** driving CodeMirror via WebDriver (Task 4 Step 2) — the seam fallback is spelled out inline, not deferred.
- **Open detail the implementer must confirm at runtime, not guess:** the exact selector to toggle notebook `captures`/interact (Task 4 Step 2 tries `.el-notebook`/`[data-el-type=notebook]`/`.nb-body` dblclick) and the DELETE-session reopen dance (Task 5 Step 1) — both verified by the run steps that immediately follow.
