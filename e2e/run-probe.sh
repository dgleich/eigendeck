#!/bin/bash
# Run ONE bespoke e2e probe headlessly (Linux only) under xvfb + an http server
# for dist/ + tauri-driver + WebKitWebDriver. Generalizes run.sh (which only runs
# the parameterized check.mjs) to any probe.
#
# Env:
#   PROBE     (required) path to the probe .mjs
#   E2E_DECK  (required) .eigendeck to open via launch arg
#   E2E_APP   app binary (default /tmp/el-target/debug/eigendeck — see eigendeck-e2e skill)
#   PROBE_OUT / E2E_NB / E2E_VTT / E2E_MODE  optional, passed through to the probe
#
# HOME is set to the deck's directory so the deck + watched sidecars fall under
# the app's fs:allow-watch (scope-home-recursive) scope.
#
# NOTE: dist/ MUST be built with `VITE_EIGENDECK_SEAM=1 npm run build` — probes
# drive the app through window.__eigendeck, which is tree-shaken out of a plain build.
set -u
export PATH="$HOME/.cargo/bin:$PATH"          # tauri-driver isn't on PATH in subshells
export E2E_APP="${E2E_APP:-/tmp/el-target/debug/eigendeck}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE="${PROBE:?set PROBE to the probe .mjs}"
DECK="${E2E_DECK:?set E2E_DECK}"
DECKHOME="$(dirname "$DECK")"
TAURI_DRIVER="$(command -v tauri-driver || echo "$HOME/.cargo/bin/tauri-driver")"

xvfb-run -a -s "-screen 0 1280x900x24" bash -c "
  export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1
  # Throwaway cache/data per run — WebKitGTK caches the JS bundle and would serve
  # stale frontend code otherwise.
  export XDG_CACHE_HOME=\$(mktemp -d) XDG_DATA_HOME=\$(mktemp -d)
  export HOME='$DECKHOME'
  export E2E_APP='$E2E_APP' E2E_DECK='$DECK' \
         PROBE_OUT='${PROBE_OUT:-}' E2E_NB='${E2E_NB:-}' E2E_VTT='${E2E_VTT:-}' E2E_MODE='${E2E_MODE:-}'
  python3 -m http.server 1420 --directory '$ROOT/dist' >/tmp/e2e-http.log 2>&1 & HS=\$!
  '$TAURI_DRIVER' --native-driver /usr/bin/WebKitWebDriver >/tmp/e2e-td.log 2>&1 & TD=\$!
  sleep 3
  node '$PROBE'; RC=\$?
  kill \$TD \$HS 2>/dev/null
  exit \$RC
"
