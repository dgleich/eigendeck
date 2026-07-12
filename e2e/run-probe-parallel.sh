#!/bin/bash
# PARALLEL-SAFE e2e probe runner. Each instance uses its OWN tauri-driver port + native
# WebKitWebDriver port + a fresh Xvfb display (xvfb-run -a). This lets N rigs run
# concurrently without run-probe.sh's by-name pkill killing siblings: cleanup here is
# scoped to THIS instance's driver port only.
#
# Uses the DEBUG app (loads http://localhost:1420) with ONE SHARED dist server that all
# rigs reuse (static assets — many clients are fine). We do NOT use the release app: its
# tauri:// custom protocol doesn't load under WebKitWebDriver headless (about:blank).
# The shared server is started idempotently (first rig starts it; it lingers) and is
# NEVER killed by cleanup, so parallel rigs don't tear it out from under each other.
# See .claude/notes/parallel-bughunt-plan.md.
#
# Env:
#   PROBE      (required) probe .mjs
#   E2E_DECK   (required) .eigendeck to open (launch arg)
#   E2E_PORT   tauri-driver port (default 4444; agents use 4444+i)
#   E2E_APP    debug app (default /tmp/el-target/debug/eigendeck)
#   PROBE_OUT / E2E_MODE / E2E_NB / E2E_VTT   passed through
# The probe MUST connect to $E2E_BASE (= http://127.0.0.1:$E2E_PORT):
#   const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444';
set -u
export PATH="$HOME/.cargo/bin:$PATH"
E2E_PORT="${E2E_PORT:-4444}"
NATIVE_PORT=$(( E2E_PORT + 1000 ))
export E2E_APP="${E2E_APP:-/tmp/el-target/debug/eigendeck}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE="${PROBE:?set PROBE to the probe .mjs}"
DECK="${E2E_DECK:?set E2E_DECK}"
DECKHOME="$(dirname "$DECK")"
TAURI_DRIVER="$(command -v tauri-driver || echo "$HOME/.cargo/bin/tauri-driver")"

[ -x "$E2E_APP" ] || { echo "FATAL: E2E_APP not executable: $E2E_APP"; exit 2; }
[ -d "$ROOT/dist" ] || { echo "FATAL: dist/ missing — VITE_EIGENDECK_SEAM=1 npm run build"; exit 2; }

# Shared dist server on :1420 — start once (idempotent), leave running. Never killed by
# per-rig cleanup, so concurrent rigs all reuse it.
if ! fuser 1420/tcp >/dev/null 2>&1; then
  setsid python3 -m http.server 1420 --directory "$ROOT/dist" >/tmp/e2e-http-shared.log 2>&1 &
  sleep 1
fi

# Scoped cleanup: ONLY this instance's tauri-driver (matched by its --port). Never the
# shared server, never sibling drivers — that is what makes parallel rigs safe.
cleanup() { pkill -9 -f "tauri-driver.*--port ${E2E_PORT}( |\$)" 2>/dev/null; }
cleanup; sleep 1; trap cleanup EXIT

xvfb-run -a -s "-screen 0 1280x900x24" bash -c "
  export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1
  export XDG_CACHE_HOME=\$(mktemp -d) XDG_DATA_HOME=\$(mktemp -d)
  export HOME='$DECKHOME'
  export E2E_APP='$E2E_APP' E2E_DECK='$DECK' E2E_BASE='http://127.0.0.1:${E2E_PORT}' \
         PROBE_OUT='${PROBE_OUT:-}' E2E_MODE='${E2E_MODE:-}' E2E_NB='${E2E_NB:-}' E2E_VTT='${E2E_VTT:-}'
  '$TAURI_DRIVER' --port ${E2E_PORT} --native-port ${NATIVE_PORT} --native-driver /usr/bin/WebKitWebDriver >/tmp/e2e-td-${E2E_PORT}.log 2>&1 & TD=\$!
  sleep 3
  node '$PROBE'; RC=\$?
  pkill -9 -P \$TD 2>/dev/null
  kill -9 \$TD 2>/dev/null
  exit \$RC
"
