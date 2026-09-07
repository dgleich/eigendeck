#!/bin/bash
# Full frontend + Rust coverage via the instrumented e2e suite — one pass that
# harvests both. Builds an Istanbul-instrumented dist AND an LLVM-instrumented app
# binary, runs the whole e2e suite (frontend window.__coverage__ beacons + Rust
# .profraw), then merges. Used by .github/workflows/coverage-e2e.yml and runnable
# locally. Assumes the toolchain is present: node deps, cargo + llvm-tools-preview,
# cargo-llvm-cov, tauri-driver, WebKitWebDriver, xvfb (CI installs these first).
#
#   bash e2e/coverage-run.sh
#
# Env: CARGO_TARGET_DIR (set to an exec-capable dir when /work is a noexec mount);
# E2E_CLI/E2E_APP are set by this script to the instrumented binaries.
set -uo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"

# A modest job cap (harmless; this host has 4 CPUs anyway). The real OOM culprit
# was NOT parallelism but a fork bomb from nesting `cargo llvm-cov` inside a
# show-env context — see step 3.
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"

step() { echo; echo "==== $* ===="; }

step "1/6  vitest unit coverage (jsdom) + fold data (coverage/coverage-final.json)"
npx vitest run --coverage

step "2/6  instrumented + seam frontend dist"
COVERAGE_INSTRUMENT=1 VITE_EIGENDECK_SEAM=1 npm run build

step "3/6  instrumented app binary + unit-test profraws"
( cd src-tauri
  cargo llvm-cov clean --workspace
  eval "$(cargo llvm-cov show-env --export-prefix)"
  cargo build --bin eigendeck --bin eigendeck-cli
  # Unit-test profraws so the Rust report merges unit + e2e handler coverage.
  # MUST be a NORMAL cargo command here: the show-env eval above installed
  # cargo-llvm-cov's rustc wrapper, and running `cargo llvm-cov <subcmd>` inside
  # that context re-installs the wrapper recursively → a fork bomb (cargo-llvm-cov
  # even warns about this). `cargo test` under the show-env env emits profraws
  # directly, which `cargo llvm-cov report` (step 6) then collects.
  cargo test --lib -- --test-threads=1
)

step "4/6  full e2e suite (instrumented dist + binary)"
PROFDIR="$(cd src-tauri && eval "$(cargo llvm-cov show-env --export-prefix)" && dirname "$LLVM_PROFILE_FILE")"
BIN_DIR="$(cd src-tauri && eval "$(cargo llvm-cov show-env --export-prefix)" && echo "${CARGO_LLVM_COV_TARGET_DIR:-${CARGO_TARGET_DIR:-target}}")"
rm -rf .nyc_output coverage-unified; mkdir -p .nyc_output
rm -f "$PROFDIR"/e2e-*.profraw
E2E_APP="$BIN_DIR/debug/eigendeck" E2E_CLI="$BIN_DIR/debug/eigendeck-cli" \
  COVERAGE_INSTRUMENT=1 COV_NYC_DIR="$ROOT/.nyc_output" \
  LLVM_PROFILE_FILE="$PROFDIR/e2e-%p%c.profraw" \
  bash e2e/run-all.sh
echo "frontend page maps: $(ls .nyc_output 2>/dev/null | wc -l)   rust e2e profraw: $(ls "$PROFDIR"/e2e-*.profraw 2>/dev/null | wc -l)"

step "5/6  FRONTEND unified coverage (unit + real-WebKit e2e)"
COV_NYC_DIR="$ROOT/.nyc_output" COV_WITH_VITEST=1 COV_REPORT_DIR="$ROOT/coverage-unified" \
  node e2e/coverage-merge.mjs

step "6/6  RUST coverage (unit + e2e handlers)"
( cd src-tauri
  eval "$(cargo llvm-cov show-env --export-prefix)"
  cargo llvm-cov report --summary-only 2>/dev/null | grep -E 'lib.rs|storage|fscmds|clip.rs|TOTAL'
  cargo llvm-cov report --lcov --output-path "$ROOT/coverage-rust-e2e.lcov" 2>/dev/null
)
echo; echo "==== coverage-run complete ===="
echo "  frontend → coverage-unified/  |  rust → coverage-rust-e2e.lcov"
