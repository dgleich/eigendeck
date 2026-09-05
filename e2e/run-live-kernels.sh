#!/bin/bash
# Standalone live-kernel e2e across languages (python + R). This is the SAME set
# that runs as part of the default e2e/run-all.sh — this wrapper runs JUST the
# live-kernel part (faster feedback while working on the notebook/kernel path).
#
# Boots a REAL jupyter (via uv) per language and drives nb-live-run-persist.mjs.
# A language is skipped if its kernel tooling isn't installed. To enable R:
#   sudo R -e 'install.packages("IRkernel")'
#   then register a kernelspec named `ir` under
#   $JUP_VENV/share/jupyter/kernels/ir  (see e2e/README.md).
set -u
export PATH="$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${E2E_APP:=/tmp/el-target/debug/eigendeck}"
: "${E2E_CLI:=/tmp/el-target/debug/eigendeck-cli}"
export E2E_APP E2E_CLI
# shellcheck source=/dev/null
source "$ROOT/e2e/_live-kernels.sh"

pass=0; fail=0; ran=0; skipped=()
for cfg in "${LIVE_KERNEL_CONFIGS[@]}"; do
  IFS='|' read -r lang kernel disp src expect <<< "$cfg"
  if ! live_kernel_available "$kernel"; then
    echo "SKIP $lang — '$kernel' tooling not installed"; skipped+=("$lang"); continue
  fi
  echo "──── live-kernel: $lang ($kernel) ────"
  ran=$((ran+1))
  if run_live_kernel "$lang" "$kernel" "$disp" "$src" "$expect"; then
    echo "  ✓ $lang"; pass=$((pass+1))
  else
    echo "  ✗ $lang"; fail=$((fail+1))
  fi
done
echo "════════════════════════════"
echo "live-kernel: $pass passed, $fail failed (of $ran run); skipped: ${skipped[*]:-none}"
[ "$fail" -eq 0 ] && [ "$ran" -gt 0 ]
