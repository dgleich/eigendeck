# Design — Live-notebook (edit + run + persist) e2e coverage

Status: **agreed 2026-07-07.** Adds the first e2e that boots a real kernel and
runs a cell. Companion to the eigendeck-e2e skill and `e2e/README.md`.

## Problem

The notebook e2e suite (`nb-*`, `notebook-*`, `overlay`, `export-notebook`)
covers storage/UI behavior — overlay load/merge/heal, promote-to-sync, copy,
fs-watch reload, export — but **never boots a kernel or runs a cell**. Fixture
overlays carry pre-baked `cellOutputs: {}`. So the "live" half of notebooks (WS
handshake → `execute_request` → `iopub` output → record into overlay) is
completely untested. Pyodide/lite is NOT the target: it's an unshipped
placeholder (`LiteKernelPlaceholder`); the shipped live backend is an external
Jupyter server (`src/lib/jupyterClient.ts` + `useKernel.ts`).

## Goal (the full round-trip, one scenario)

Boot a live external kernel → open a deck with an `editable` notebook → edit a
cell's source in-app → run it → assert the real computed output renders → save →
quit → reopen → assert the **edited source** and the **live output** both
survived (persisted via the overlay's `cellEdits` + `cellOutputs`).

## Approach: real external Jupyter server (chosen)

Boot an actual `jupyter server` in the rig; the app's real `jupyterClient`
connects over WebSocket. Rejected: a mock WS kernel (defeats the purpose, and
faithfully mocking the Jupyter protocol is itself error-prone) and reviving
Pyodide/lite (that's building an unshipped feature, not a test).

## Components

### 1. `e2e/jupyter-server.sh` (sourced by the runner)
- Ensure a `uv` venv with `jupyter-server` + `ipykernel`.
- Boot (mirrors `spike-tools/setup.sh`, the harness we're harvesting):
  ```
  jupyter server --no-browser --port=8888 --ServerApp.ip=127.0.0.1 \
    --IdentityProvider.token='e2e-token' --ServerApp.allow_origin='*' \
    --ServerApp.disable_check_xsrf=True
  ```
- Poll `http://127.0.0.1:8888/api` (with token) until ready, THEN launch the app.
- `trap` EXIT → kill the server and any child kernels. CORS/xsrf disabled so the
  WebView opaque/localhost origin can connect (spike-proven in WebKit).

### 2. `e2e/fixtures/make_live_nb_deck.py`
- One notebook element, `editable: true`, kernel `{kind:'external',
  kernelName:'python3'}`. **URL + token are deliberately NOT on the element** —
  they come from the per-machine `jupyterServers` registry (see LLM-EDITING).
- One code cell, known starting source (e.g. `k = 5`). Built via
  `eigendeck-cli import json`.

### 3. `e2e/nb-live-run-persist.mjs`
Flow:
1. **Inject server pref** — `XDG_DATA_HOME` is wiped per run, so set the
   `jupyterServers` registry (URL `127.0.0.1:8888`, token `e2e-token`,
   `availableKernels:['python3']`) via the seam / `localStorage` BEFORE the
   kernel connects. (Plan step verifies the exact storage key.)
2. Open deck (launch-arg), wait for seam + notebook render.
3. **Edit** — drive the real editable cell editor to set source to a
   computed-output line: `print("E2E_LIVE_%d" % (6*7))`. Flows through the real
   `onEdit → live.setWorking → overlay.cellEdits`.
4. **Run** — click ▶ (`onRun → kernel.runCell → ov.recordOutput`); lazy WS
   connect happens here.
5. Poll DOM for `E2E_LIVE_42`. No fixture contains it → its presence PROVES the
   kernel executed (not a stale value).
6. **Save** (`window.__eigendeck.save()`), **quit**, **relaunch** same deck.
7. **Assert** both survived: edited source line (`cellEdits`) AND `E2E_LIVE_42`
   (`cellOutputs`).

## Determinism & gotchas (designed-in)
- Computed marker (`6*7`) can't be pre-baked → guards against false green.
- Lazy connect → generous WS-handshake/exec polling + timeout.
- Server-ready gate before app launch; `trap` teardown.
- **Main implementation risk:** driving the editable cell editor (CodeMirror /
  textarea input events) via WebDriver — the plan pins the exact selector +
  input-event sequence. If the in-app editor proves too fragile to drive
  reliably, fall back to setting the source through whatever store/overlay seam
  the editable path exposes — but only as a last resort, since it weakens the
  "edit in-app" claim.

## Files
- New: `e2e/jupyter-server.sh`, `e2e/fixtures/make_live_nb_deck.py`,
  `e2e/nb-live-run-persist.mjs`.
- Edit: `e2e/README.md` (scenario + jupyter/uv prereq), wire into
  `e2e/run-all.sh`.

## spike-tools disposition
Harvest `test_playwright.py`'s server-boot logic into `e2e/jupyter-server.sh`,
THEN delete `spike-tools/` — its value migrates into the live e2e suite instead
of being lost. (`public/notebook-spike/` handled separately/later.)

## Out of scope
- Reviving Pyodide/lite. - In-app editor UX changes. - Wiring this into the
  default gating suite before it's proven stable (add as opt-in first, like
  `relay-fps-probe`).
