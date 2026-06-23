#!/bin/bash
# Gating e2e suite (Linux only). Runs each probe in the MANIFEST via run-probe.sh
# and exits non-zero if ANY probe fails — so `npm run test:e2e` is one command
# the release gate (and CI) can call. Each probe gets a FRESH temp copy of its
# source deck (probes that self-build slides just need any small base deck).
#
# Prereqs (see the eigendeck-e2e skill):
#   - E2E_APP built (default /tmp/el-target/debug/eigendeck)
#   - dist/ built with VITE_EIGENDECK_SEAM=1 npm run build
#
# Adding a probe: append "probe.mjs|source-deck|EXTRA_ENV" to MANIFEST. Audit-only
# probes (e.g. overflow-hunt.mjs — reports, no pass/fail) are intentionally NOT here.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export E2E_APP="${E2E_APP:-/tmp/el-target/debug/eigendeck}"

[ -x "$E2E_APP" ] || { echo "FATAL: E2E_APP not executable: $E2E_APP — build it (see eigendeck-e2e skill)"; exit 2; }
[ -d "$ROOT/dist" ] || { echo "FATAL: dist/ missing — run: VITE_EIGENDECK_SEAM=1 npm run build"; exit 2; }
# Guard against a plain (seam-less) build: every probe would hang on waitSeam.
grep -rq "__eigendeck" "$ROOT/dist/assets" 2>/dev/null || {
  echo "FATAL: dist/ has no __eigendeck seam — rebuild with VITE_EIGENDECK_SEAM=1 npm run build"; exit 2; }

# "probe.mjs | source-deck (copied per run) | extra env (KEY=val ...)"
MANIFEST=(
  "present-clip-probe.mjs|examples/intro-slide.eigendeck|"
  "present-theme-parity-probe.mjs|examples/intro-slide.eigendeck|"
  "demo-theme-verify.mjs|examples/graph-explorer.eigendeck|"
  "demo-theme-scenario.mjs|examples/intro-slide.eigendeck|"
  "demo-theme-deck-verify.mjs|test-presentations/font-theme-matrix.eigendeck|"
)

pass=0; fail=0; failed=()
for entry in "${MANIFEST[@]}"; do
  IFS='|' read -r probe deck extra <<< "$entry"
  [ -f "$ROOT/e2e/$probe" ] || { echo "✗ $probe — probe file missing"; fail=$((fail+1)); failed+=("$probe"); continue; }
  [ -f "$ROOT/$deck" ]      || { echo "✗ $probe — source deck missing: $deck"; fail=$((fail+1)); failed+=("$probe"); continue; }
  tmpdir="$(mktemp -d)"; tmp="$tmpdir/$(basename "$deck")"
  cp "$ROOT/$deck" "$tmp"; rm -f "$tmp-wal" "$tmp-shm"
  echo "──── $probe  ($deck) ────"
  env $extra PROBE="$ROOT/e2e/$probe" E2E_DECK="$tmp" bash "$ROOT/e2e/run-probe.sh" 2>&1 | tail -4
  rc=${PIPESTATUS[0]}
  rm -rf "$tmpdir"
  if [ "$rc" -eq 0 ]; then echo "  ✓ $probe"; pass=$((pass+1)); else echo "  ✗ $probe (rc=$rc)"; fail=$((fail+1)); failed+=("$probe"); fi
done

echo "════════════════════════════"
echo "e2e: $pass passed, $fail failed (of $((pass+fail)))"
if [ "$fail" -ne 0 ]; then printf '  FAILED: %s\n' "${failed[@]}"; exit 1; fi
echo "ALL E2E PASS"
