# Live Jupyter kernel: first cell run silently dropped — 2026-09-04

## Symptom
Re-enabling the live-kernel e2e (`nb-live-run-persist.mjs`, the only probe that
boots a REAL jupyter kernel) showed the first cell run producing **no output**:
the cell stuck at `[*]`, `E2E_LIVE_42` never appeared. Suspicion (mine and the
maintainer's) initially fell on the Tauri-side security hardening "blocking
communication."

## Diagnosis — it is NOT a Tauri/security block
Ruled out layer by layer, all against the CURRENT binary:
- **Raw WebSocket from the app's OWN webview** → full kernel round-trip works
  (`RAWWS_42`, execute_reply, parentMatch). So the webview/Tauri layer is not
  blocking WS or HTTP egress.
- The app's **exact message shape** (`buffers:[]`, `username:'eigendeck'`, dashed
  ids) replayed from a raw WS → works. So the message is fine.
- Frontend **bisect**: July-green frontend (`e3b5315`) built against the current
  binary still failed → not a frontend regression either.
- Instrumented `JupyterClient` (temp `__jclog`): `startKernel` POST 201 → WS open
  → `execute-send` fires, then only jupyter's handshake `status` frames arrive
  (`parentMatch:false`), **never our execute's reply**.
- jupyter `--log-level=DEBUG` was decisive: jupyter_server runs a connection
  **"Nudge"** (a `kernel_info` handshake) on every new `/channels` WebSocket and
  does not reliably deliver shell messages that arrive before it completes. The
  app sends `execute_request` **synchronously in `ws.onopen`**, racing the nudge,
  so the first shell message is dropped. (DEBUG logging slowed the server enough
  to win the race → passed — classic heisenbug.)

## Fix (`src/lib/jupyterClient.ts`)
Gate readiness on a real handshake, like JupyterLab does: on `ws.onopen` send our
own `kernel_info_request` and resolve `connect()/startKernel()` only when the
matching `kernel_info_reply` returns (5s fallback so it never hangs; reject on
early close). `execute()` is unchanged but now only runs after the channel is
provably wired. Refactored the shared header into `buildHeader()`.

Result: the live probe passes reliably WITHOUT any DEBUG timing help — 3/3 fresh
runs `E2E_PASS live edit+run+persist`, and the robust diag shows `OUTPUT_SEEN=true`
every run (was false pre-fix).

## Tests
- New hermetic unit test `src/lib/jupyterClient.test.ts` (mock fetch + WebSocket):
  asserts (1) only a `kernel_info_request` is sent on open and `startKernel` stays
  pending until the reply, then `execute` emits `execute_request`; (2) the 5s
  fallback resolves if no reply arrives. Guards the race in CI without jupyter.
- Re-enabled `nb-live-run-persist` in `e2e/run-all.sh`, **conditionally**: appended
  to the manifest only when `uv` is on PATH (or `E2E_LIVE_JUPYTER=1`), skipped with
  a note otherwise, so the hermetic suite still runs green on a box without jupyter.
- Gates: `tsc` clean, vitest 1570 pass / 1 skip.

## Still open — the Mac CORS symptom is SEPARATE
The maintainer's earlier macOS devtools error was `.../api/kernelspecs … blocked by
access control checks` — a **CORS** rejection, a different failure than this WS
race. Our e2e jupyter sets `--ServerApp.allow_origin='*'`, so headless never hit
it. A user's default `jupyter server` does NOT send `Access-Control-Allow-Origin`,
so the browser blocks kernelspecs/POST-kernels/WS at the CORS layer. Options if we
want the app to work against an unconfigured server: document the required
`allow_origin` (quick), or route kernel HTTP/WS through the Rust backend to bypass
browser CORS (bigger). Flagged, not yet done.
