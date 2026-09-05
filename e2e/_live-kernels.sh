#!/bin/bash
# Shared live-kernel config + helpers — sourced by run-all.sh (default suite) and
# run-live-kernels.sh (standalone). ONE parametrized probe (nb-live-run-persist.mjs)
# drives every language: edit a cell → run against a REAL kernel → assert the
# computed output + [N] prompt → save/reopen → assert persistence. The client is
# language-neutral, so only the fixture kernel + cell source + expected marker vary.
#
# Each config: lang | kernelspec name | display | cell source (one line; \n is the
# in-language newline escape) | expected output substring.
LIVE_KERNEL_CONFIGS=(
  'python|python3|Python 3|print("E2E_LIVE_%d" % (6*7))|E2E_LIVE_42'
  'R|ir|R|cat(sprintf("E2E_LIVE_%d\n", 6*7))|E2E_LIVE_42'
)
LIVE_KERNEL_VENV="${JUP_VENV:-/tmp/e2e-jupyter-venv}"

# A language is runnable if uv is present (python3 kernel is auto-provisioned) and,
# for non-python kernels, its kernelspec is registered in the jupyter venv. To add
# R: sudo R -e 'install.packages("IRkernel")' then register a kernelspec named `ir`
# under $LIVE_KERNEL_VENV/share/jupyter/kernels/ir (see e2e/README.md).
live_kernel_available() {
  local kernel="$1"
  command -v uv >/dev/null 2>&1 || return 1
  [ "$kernel" = "python3" ] && return 0
  [ -d "$LIVE_KERNEL_VENV/share/jupyter/kernels/$kernel" ]
}

# Run ONE language end-to-end (fresh deck each call — the probe mutates it via the
# overlay's autosave). Echoes the probe tail; returns the probe's exit code.
# Requires ROOT, E2E_APP, E2E_CLI in the environment.
run_live_kernel() {
  local lang="$1" kernel="$2" disp="$3" src="$4" expect="$5"
  local D; D="$(mktemp -d)"
  python3 "$ROOT/e2e/fixtures/make_live_nb_deck.py" "$D/live.json" "$kernel" "$disp" >/dev/null
  if ! "$E2E_CLI" "$D/live.eigendeck" import json "$D/live.json" >/dev/null 2>&1; then
    echo "  deck import failed"; rm -rf "$D"; return 3
  fi
  E2E_LANG="$lang" E2E_KERNEL_NAME="$kernel" E2E_CELL_SRC="$src" E2E_EXPECT="$expect" \
    E2E_JUPYTER=1 PROBE="$ROOT/e2e/nb-live-run-persist.mjs" E2E_DECK="$D/live.eigendeck" \
    bash "$ROOT/e2e/run-probe.sh" 2>&1 | tail -8
  local rc=${PIPESTATUS[0]}
  rm -rf "$D"
  return "$rc"
}
