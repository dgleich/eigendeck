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

# PRE-CLEAN: a crashed prior probe can leave tauri-driver holding :4444 (and a
# stale app/WebKitWebDriver), so the next probe's session creation hits the OLD
# driver → "invalid session id" / wrong-app failures. Kill any leftovers first.
# Patterns are ANCHORED (^) to the real binaries' argv — an UNanchored pkill -f
# would match this wrapper's own command line (it embeds the strings
# "tauri-driver", "WebKitWebDriver", "http.server 1420", "$E2E_APP") and kill
# itself (rc=137). SERIAL USE ONLY (run-all runs probes one at a time).
cleanup_rig() {
  pkill -9 -f "^${TAURI_DRIVER}" 2>/dev/null
  pkill -9 -f "^/usr/bin/WebKitWebDriver" 2>/dev/null
  pkill -9 -f "^python3 -m http.server 1420" 2>/dev/null
  [ -n "$E2E_APP" ] && pkill -9 -f "^${E2E_APP}" 2>/dev/null
}
cleanup_rig
sleep 1
trap cleanup_rig EXIT

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
  # Best-effort in-subshell teardown (PID-based, safe): kill the driver + its
  # children (WebKitWebDriver/app) + the http server. The outer 'trap cleanup_rig
  # EXIT' then does the thorough anchored global sweep so nothing is orphaned.
  pkill -9 -P \$TD 2>/dev/null
  kill -9 \$TD \$HS 2>/dev/null
  exit \$RC
"
