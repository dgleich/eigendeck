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
