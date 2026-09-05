#!/bin/bash
# Run ONE bespoke e2e probe headlessly (Linux only) under xvfb + an http server
# for dist/ + tauri-driver + WebKitWebDriver. Generalizes run.sh (which only runs
# the parameterized check.mjs) to any probe.
#
# Env:
#   PROBE     (required) path to the probe .mjs
#   E2E_DECK  (required) .eigendeck to open via launch arg
#   E2E_APP   app binary (default /tmp/el-target/debug/eigendeck — see eigendeck-e2e skill)
#   PROBE_OUT / E2E_NB / E2E_VTT / E2E_PDF / E2E_MODE /
#   E2E_ASSET_SETTLE_MS  optional, passed through to the probe
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

# Guard against a seam-LESS dist. A plain `npm run build` (no VITE_EIGENDECK_SEAM=1)
# strips the window.__eigendeck seam but leaves stray `.__eigendeck` reads, so it's
# easy to run against a dist that has no seam — every probe then times out on
# waitSeam while the frontend loads fine (looks like "the deck won't open"). Match
# the ASSIGNMENT `.__eigendeck={`, not any occurrence. (This bit us; see the skill.)
[ -d "$ROOT/dist" ] || { echo "FATAL: dist/ missing — VITE_EIGENDECK_SEAM=1 npm run build"; exit 2; }
grep -rq "__eigendeck={" "$ROOT/dist/assets" 2>/dev/null || {
  echo "FATAL: dist/ has no __eigendeck seam ASSIGNMENT — a plain 'npm run build' strips it."
  echo "       Rebuild with: VITE_EIGENDECK_SEAM=1 npm run build"; exit 2; }

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
  type jupyter_stop >/dev/null 2>&1 && jupyter_stop
}
cleanup_rig
sleep 1
trap cleanup_rig EXIT

# Live-kernel probes (E2E_JUPYTER=1) need a real jupyter server on 127.0.0.1:8888.
# Start it on the host BEFORE the app launches (localhost is shared into xvfb).
if [ "${E2E_JUPYTER:-}" = "1" ]; then
  # shellcheck disable=SC1090
  source "$ROOT/e2e/jupyter-server.sh"
  jupyter_start || exit 1
fi

xvfb-run -a -s "-screen 0 1280x900x24" bash -c "
  export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1
  # Throwaway cache/data per run — WebKitGTK caches the JS bundle and would serve
  # stale frontend code otherwise.
  export XDG_CACHE_HOME=\$(mktemp -d) XDG_DATA_HOME=\$(mktemp -d)
  export HOME='$DECKHOME'
  export E2E_APP='$E2E_APP' E2E_DECK='$DECK' \
         PROBE_OUT='${PROBE_OUT:-}' E2E_NB='${E2E_NB:-}' E2E_VTT='${E2E_VTT:-}' \
         E2E_PDF='${E2E_PDF:-}' E2E_MODE='${E2E_MODE:-}' \
         E2E_ASSET_SETTLE_MS='${E2E_ASSET_SETTLE_MS:-}' \
         COVERAGE_INSTRUMENT='${COVERAGE_INSTRUMENT:-}'
  # Serve dist/ on :1420. With COVERAGE_INSTRUMENT=1 the collector server also
  # accepts the instrumented app's coverage beacons and writes them to COV_NYC_DIR.
  if [ \"\$COVERAGE_INSTRUMENT\" = '1' ]; then
    COV_DIST='$ROOT/dist' COV_PORT=1420 COV_NYC_DIR='${COV_NYC_DIR:-$ROOT/.nyc_output}' \
      node '$ROOT/e2e/coverage-server.mjs' >/tmp/e2e-http.log 2>&1 & HS=\$!
  else
    python3 -m http.server 1420 --directory '$ROOT/dist' >/tmp/e2e-http.log 2>&1 & HS=\$!
  fi
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
