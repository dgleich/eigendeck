#!/bin/bash
# Exercise the `eigendeck-cli` binary across its whole subcommand surface and
# MEASURE its coverage. `cargo llvm-cov --lib` only covers the library, so the CLI
# binary (src-tauri/src/cli.rs) always reads 0% even though fixtures invoke it
# constantly. This instruments the binary, drives a realistic pipeline through it
# (new deck -> add/edit elements + mathjax text -> store a PDF asset -> export ->
# compact/unpack -> read commands -> error paths), and emits a Rust lcov that
# INCLUDES cli.rs (merged with the --lib unit profraws for a complete picture).
#
# Usage: bash e2e/cli-coverage.sh [out-lcov]      (default: $HOME/rust-lcov.info)
# Fork-bomb safety (see docs/e2e-coverage.md): the only `cargo llvm-cov` calls are
# `clean` (before show-env) and `report` (no compile) — everything that compiles
# is a plain `cargo build`/`cargo test` under the show-env env, never a nested
# `cargo llvm-cov <subcmd>`.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/el-target}"
OUT_LCOV="${1:-$HOME/rust-lcov.info}"
SCRATCH="$(mktemp -d)"
DECK="$SCRATCH/deck.eigendeck"

# A tiny but valid 1-page PDF for store-asset (exercises the asset-store path).
python3 - "$SCRATCH/tiny.pdf" <<'PY'
import sys
objs=[b"<< /Type /Catalog /Pages 2 0 R >>",
      b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"]
buf=b"%PDF-1.4\n"; offs=[]
for i,o in enumerate(objs,1):
    offs.append(len(buf)); buf+=("%d 0 obj\n"%i).encode()+o+b"\nendobj\n"
xref=len(buf); buf+=("xref\n0 %d\n"%(len(objs)+1)).encode()+b"0000000000 65535 f \n"
for o in offs: buf+=("%010d 00000 n \n"%o).encode()
buf+=("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF"%(len(objs)+1,xref)).encode()
open(sys.argv[1],"wb").write(buf)
PY

cd "$ROOT/src-tauri"
echo "== clean + build instrumented CLI =="
cargo llvm-cov clean --workspace
eval "$(cargo llvm-cov show-env --export-prefix)"      # sets RUSTFLAGS + LLVM_PROFILE_FILE
cargo build --bin eigendeck-cli 2>&1 | tail -1
# Unit-test profraws too, so the report merges lib + CLI coverage.
cargo test --lib -- --test-threads=1 >/dev/null 2>&1 && echo "  unit tests ok" || echo "  unit tests: some failures (continuing)"

BIN="$CARGO_TARGET_DIR/debug/eigendeck-cli"
[ -x "$BIN" ] || { echo "FATAL: CLI not built at $BIN"; exit 2; }
run(){ "$BIN" "$DECK" "$@" >/dev/null 2>&1 || true; }        # tolerate nonzero (error-path coverage is the point)

echo "== drive the CLI pipeline =="
# New presentation from a rich deck (every element type).
run import json "$ROOT/e2e/fixtures/all-elements-deck.json"
# Read surface.
run info;            run --json info
run list slides;     run list elements;   run list slides --json
run outline;         run validate;        run history;   run history --limit 3
run search "the";    run search "zzz-no-match-zzz"
# Pull a real element id + slide id from the exported json for the mutation surface.
run export json "$SCRATCH/exp.json"
EID="$(python3 -c "import json;d=json.load(open('$SCRATCH/exp.json'));print(d['slides'][0]['elements'][0]['id'])" 2>/dev/null || echo "")"
if [ -n "$EID" ]; then
  run get-text "$EID";  run show element "$EID"
  run set-text "$EID" 'Updated <b>text</b> with $\\alpha + \\beta$ mathjax'
  run move element "$EID" 240 160
  run edit element "$EID" '{"x":42,"y":42}'
fi
run show slide 0
# Mutations that add structure + a mathjax-bearing text element.
run add slide --after 0
run add text 1 'New slide title with $\\gamma$'
run insert slide 1
run move slide 1 0
# Store the PDF asset (asset pipeline), then export/compact/unpack.
run store-asset "$SCRATCH/tiny.pdf"
run export json "$SCRATCH/out.json"
run compact --all
( cd "$SCRATCH" && "$BIN" "$DECK" unpack --demos --images >/dev/null 2>&1 || true )
[ -n "$EID" ] && run remove element "$EID" 0
run remove slide 1
# Error / usage paths.
"$BIN" >/dev/null 2>&1 || true
"$BIN" "$DECK" >/dev/null 2>&1 || true
"$BIN" "$DECK" not-a-real-command >/dev/null 2>&1 || true
"$BIN" "$DECK" add >/dev/null 2>&1 || true
"$BIN" "$DECK" show >/dev/null 2>&1 || true

echo "== report (lib + CLI) -> $OUT_LCOV =="
cargo llvm-cov report --summary-only 2>/dev/null | grep -E 'cli\.rs|storage|lib\.rs|TOTAL' || true
cargo llvm-cov report --lcov --output-path "$OUT_LCOV" 2>/dev/null
echo "lcov written: $OUT_LCOV  ($(grep -c '^SF:' "$OUT_LCOV" 2>/dev/null) files)"
rm -rf "$SCRATCH"
