#!/bin/bash
# Run one notebook E2E scenario headlessly (Linux only).
# Env: E2E_DECK (required), E2E_EXPECT (required), E2E_ABSENT (optional),
#      E2E_APP (default /tmp/el-target/debug/eigendeck).
# A debug build loads devUrl, so we serve dist/ on :1420; a release build
# is self-contained — drop the http.server line for CI.
set -u
export E2E_APP="${E2E_APP:-/tmp/el-target/debug/eigendeck}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DRIVER="$(command -v tauri-driver || echo "$HOME/.cargo/bin/tauri-driver")"

xvfb-run -a -s "-screen 0 1280x900x24" bash -c "
  export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1
  # Fresh WebKit cache/data per run — WebKitGTK caches the JS bundle across
  # runs, which silently serves STALE frontend code (debug this once, never
  # again). A throwaway XDG_CACHE_HOME guarantees the latest dist loads.
  export XDG_CACHE_HOME=\$(mktemp -d) XDG_DATA_HOME=\$(mktemp -d)
  export E2E_APP='$E2E_APP' E2E_DECK='${E2E_DECK}' E2E_EXPECT='${E2E_EXPECT}' E2E_ABSENT='${E2E_ABSENT:-}'
  python3 -m http.server 1420 --directory '$ROOT/dist' >/tmp/e2e-http.log 2>&1 & HS=\$!
  '$TAURI_DRIVER' --native-driver /usr/bin/WebKitWebDriver >/tmp/e2e-td.log 2>&1 & TD=\$!
  sleep 3
  node '$ROOT/e2e/check.mjs'; RC=\$?
  kill \$TD \$HS 2>/dev/null
  exit \$RC
"
