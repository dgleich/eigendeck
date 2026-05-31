# Notebook spike findings — 2026-05-31

TL;DR: **both architectures work in WebKit.** The "external kernel
via WebSocket" path is fully validated; "JupyterLite + Pyodide in
iframe" also runs (incl. numpy + matplotlib). Recommendation at the
bottom.

## What was tested

In an aarch64 Linux container (no GUI, no Tauri), using Playwright
to drive headless **Chromium and WebKit**. Playwright's WebKit is
the closest available proxy to what Tauri's macOS WebView uses;
real Tauri compat still needs a manual check, but this de-risks
the big question (does the protocol even work in WebKit's JS
engine + WS implementation).

Driver scripts in `/work/spike-tools/`:
- `test_protocol.py` — python-only protocol round-trip (validates
  the wire format in external-kernel.html)
- `test_png.py` — same, with matplotlib PNG output
- `test_playwright.py` — drives external-kernel.html end-to-end
  in Chromium + WebKit
- `test_lite.py` — loads the built JupyterLite dist headlessly
- `test_lite_numpy.py` — same, with numpy + matplotlib code

## Spike A — external Jupyter kernel: PASS

**Wire protocol (python client):** stream, execute_result,
display_data (incl. `image/png` 11 KB roundtrip), error,
execute_reply all flow correctly through the WS. Mirrors exactly
what external-kernel.html sends/expects.

**Browser end-to-end:** click Refresh → kernelspecs populate; click
Start → REST POST returns, WS handshake completes, status flips to
"connected (idle)"; type `print('hello browser'); import sys; sys.version`
→ output appears in the page in both Chromium and WebKit. Zero JS
console errors in either browser. Screenshots in
`/work/spike-tools/shots/{chromium,webkit}-spike.png`.

**CORS / auth knobs proven sufficient:**
```
jupyter server --no-browser --port=8888 \
  --IdentityProvider.token='spike-token' \
  --ServerApp.allow_origin='*' \
  --ServerApp.disable_check_xsrf=True
```
With these, a page served from a different origin (`127.0.0.1:5173`
in the test) can both POST to `/api/kernels` and open the WS at
`/api/kernels/.../channels`. The `Authorization: token …` header
works for REST; the WS uses `?token=…` query param (browsers can't
set headers on WS handshakes).

**What's still unknown:**
- Real Tauri WebKit (not Playwright's). Probably fine since
  Playwright's WebKit covers the same JS engine; the wildcard is
  whether Tauri's WebKit2GTK (Linux dev builds) or macOS WebKit
  enforces stricter mixed-content / CSP rules. Cheap to verify:
  drop `external-kernel.html` into the running app and load it.
- Julia / R kernels (couldn't install IRkernel / IJulia in this
  container — both need Julia/R toolchains). Protocol is identical
  per Jupyter spec, but verifying with a real non-Python kernel
  before launch would be good.

## Spike B — JupyterLite (Pyodide in iframe): PASS

Built the dist with `jupyter lite build`, served with COOP/COEP
headers (`same-origin` / `require-corp`), loaded in both browsers.

**hello world:** `print('hello from pyodide')` via `?code=` query
param. PASS in Chromium + WebKit. Kernel boots in ~20–30 s
(cold), output appears.

**numpy + matplotlib:** import numpy, build an array, plot with
matplotlib, `plt.show()`. PASS in both browsers. Took ~60–120 s
end-to-end including on-demand wheel fetches.

**One harmless warning** in both browsers:
```
[error] Plugin '@jupyterlab/codemirror-extension:commands' failed
to activate. TypeError: No provider for: @jupyterlab/notebook:INotebookTracker.
```
This is JupyterLite's REPL view declining to wire up a
notebook-only command; doesn't block execution. Goes away if we
embed the `/lab/` view instead of `/repl/`.

**Bundle size — important correction:**
- `jupyter lite build` (default config, no pre-bundled wheels): **65 MB**
- **Without sourcemaps** (`.map` files): **18 MB**
- Sourcemaps account for 44 MB. We absolutely do NOT need to ship
  these — they're a build artifact for debugging JupyterLite itself.
  Easy `npm run setup-jupyterlite` step: rm `**/*.map`.
- Pyodide WASM runtime (~10 MB) + numpy/scipy/matplotlib wheels
  (~25 MB combined) are fetched on demand from PyPI; can be
  pre-bundled with `--piplite-wheels` if we want them offline-ready
  for talks.

So the realistic ship cost is:
- **Cold:** 18 MB (JupyterLab UI + kernel extension)
- **After first run, online:** ~50 MB cached (incl. Pyodide + numpy + matplotlib)
- **Pre-bundled for offline talks:** ~50 MB shipped

That's much better than the 30-MB plan estimate (which counted
sourcemaps inadvertently).

## Recommendation: ship BOTH, with external as the default

This is unambiguously a two-path feature.

```ts
export interface NotebookElement extends BaseElement {
  type: 'notebook';
  assetId: string;
  kernel:
    | { kind: 'external'; baseUrl: string; kernelName: string }
    | { kind: 'lite' };
  // ...preamble, autoRun, etc.
}
```

**External kernel = default** because:
- Any language (Julia, R, Rust kernels, full CPython with the
  user's packages). David's HPC content needs this.
- Tiny eigendeck-side cost (a thousand lines of TS + an iframe).
- Fast — uses the user's existing local Python install.
- ZERO bundle bloat for users who never use a notebook.

**JupyterLite = "Portable Demo" mode** for:
- "I'm presenting on someone else's laptop and don't want to
  install Jupyter."
- Sharing a `.eigendeck` file where the recipient should be able
  to run the demo without setup.
- Self-contained guarantees for archival / posterity.

UX shape (subject to your taste — I won't build this without you
seeing it):
- New element from drag-drop or `+ Notebook` button → default
  `kernel: { kind: 'external' }` with a "connect" panel inside
  the element until the user has named a server.
- One-time "Server settings" entry in app preferences: stored
  `baseUrl` + `token` + per-deck overrides.
- Per-element kernel-kind toggle in the inspector ("External /
  Portable") so a deck can mix-and-match (your big numerical
  demo uses your local CPython with PyTorch; the toy graph
  example uses Lite for portability).

## Open items / risks still real

- **Real Tauri load** — Playwright WebKit is a strong proxy but not
  identical. Drop both spike HTMLs into the live app and load via
  `localhost:1420/notebook-spike/...` (Vite serves `public/` at
  root) for a one-minute final check.
- **External kernel UX when server is down** — clear "start your
  server" placeholder + clickable copy-this-command snippet.
- **Token handling** — token in URL query string is fine for
  same-machine localhost; for any other scenario we need a real
  auth flow. Likely not worth doing in v1.
- **Sourcemap-stripping** in the `npm run setup-jupyterlite` step
  is one line of script, but easy to forget — wire it in from day
  one.
- **Kernel state across slide nav** — both architectures lose
  state when the iframe unmounts. Plan already calls out v1.5
  fix (keep iframes mounted, hidden, across all slides).

## Suggested next moves (you decide which)

1. Drop both spike HTMLs into the actual running Tauri dev app
   tomorrow morning. 5 minutes; confirms the Playwright→Tauri
   gap is zero.
2. If both work in real Tauri, this branch can graduate. Squash
   the spikes into a `docs/notebook-spike-results.md` (or keep
   them under `public/notebook-spike/` as a permanent smoke
   test) and start Phase 2 of the original plan (`NotebookElement`
   type + asset wiring), with the `kernel` discriminator added.
3. If real Tauri WebKit breaks one of them, we drop that path
   and ship the other.
