# Notebook spike

Two parallel experiments to validate the architecture choices for
embedding a live Jupyter notebook in a slide. Findings here feed back
into `/work/.claude/notes/notebook-plan.md`.

## Spike A — external Jupyter kernel (`external-kernel.html`)

Plain HTML page that talks to a user-run `jupyter server` via REST +
WebSocket. Any installed kernel works (Python, Julia, R, Rust, ...) —
no eigendeck-side runtime to ship.

**Run it:**
1. Start a Jupyter server (in a terminal):
   ```
   jupyter server --no-browser --port=8888 \
     --IdentityProvider.token='spike-token' \
     --ServerApp.allow_origin='*' \
     --ServerApp.disable_check_xsrf=True
   ```
2. Start eigendeck dev (`npm run tauri dev`) and visit
   `http://localhost:1420/notebook-spike/external-kernel.html` in
   the Tauri window (or in any browser — protocol works the same).
3. Click "Refresh list" → "Start kernel" → "Run cell".

**What this proves / disproves:**
- WS execute_request round-trips in Tauri WebKit (the compatibility
  question we actually care about; pure-browser test is just a baseline).
- CORS knobs needed (`allow_origin`, `disable_check_xsrf`, token in
  query string — currently `Authorization` header doesn't reach
  the WS handshake, so the URL-token form is the practical default).
- Output rendering for the common bundle types (`text/plain`,
  `text/html`, `image/png`).

**What it doesn't cover yet:**
- Display widgets (ipywidgets / comms protocol)
- File upload / notebook save (we just execute ad-hoc code)
- Reconnect on WS drop
- Auth scheme beyond the toy token

## Spike B — JupyterLite / Pyodide (TODO)

Bundled kernel running in-WebView. Self-contained but Python-only
and ~30 MB bundle. Defer the build until Spike A's compatibility
question is settled — if a kernel WS *doesn't* work in Tauri WebKit,
Spike B is the fallback path; if it does, Spike B becomes the
"portable demo for someone who doesn't have a kernel running" mode.

To bootstrap when we're ready:
```
mkdir jupyterlite-bundle && cd jupyterlite-bundle
uv venv && source .venv/bin/activate
uv pip install jupyterlite-core jupyterlite-pyodide-kernel
jupyter lite build --output-dir ../public/notebook-spike/lite
```

## Open design question (after spikes)

Element model — one path or two?
- **One path, kernel-agnostic**: `NotebookElement.kernel` is either
  `{ kind: 'external', baseUrl, kernelName }` or
  `{ kind: 'lite' }`. UI picks per-deck or per-element.
- **Two element types**: `notebook` vs `jupyterlite` — different
  iframes, different code paths. Simpler but more surface area.

Recommend the first form (one element type with a `kernel` discriminator)
unless Spike B's iframe ergonomics turn out radically different from
Spike A's, which they shouldn't.
