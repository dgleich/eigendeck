#!/bin/bash
# Exercise the `eigendeck-cli` binary through realistic, purpose-driven WORKFLOWS
# and MEASURE its coverage. `cargo llvm-cov --lib` only covers the library, so the
# CLI binary (src-tauri/src/cli.rs) reads 0% even though the app's fixtures invoke
# it constantly. Each block below is a real thing someone does with the CLI, not a
# one-off "touch this line" call — that's what actually drives the branches.
#
# Usage: bash e2e/cli-coverage.sh [out-lcov]      (default: $HOME/rust-lcov.info)
# Fork-bomb safety (docs/e2e-coverage.md): the only `cargo llvm-cov` calls are
# `clean` (before show-env) and `report` (no compile). Everything that compiles is
# a plain `cargo build`/`cargo test` under the show-env env.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/el-target}"
OUT_LCOV="${1:-$HOME/rust-lcov.info}"
S="$(mktemp -d)"

# ── fixtures: a few real asset files + an empty seed + an orphan-link deck ──────
python3 - "$S" <<'PY'
import sys, os, struct, zlib, json
S = sys.argv[1]
def png(path, rgb=(40,120,200)):
    def chunk(t,d): return struct.pack(">I",len(d))+t+d+struct.pack(">I",zlib.crc32(t+d)&0xffffffff)
    w=h=8; raw=b"".join(b"\x00"+bytes(rgb)*w for _ in range(h))
    open(path,"wb").write(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",w,h,8,2,0,0,0))
        +chunk(b"IDAT",zlib.compress(raw))+chunk(b"IEND",b""))
png(os.path.join(S,"figure.png"))
open(os.path.join(S,"chart.svg"),"w").write('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#c33"/></svg>')
# minimal valid 1-page PDF
objs=[b"<< /Type /Catalog /Pages 2 0 R >>",b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"]
buf=b"%PDF-1.4\n"; offs=[]
for i,o in enumerate(objs,1): offs.append(len(buf)); buf+=("%d 0 obj\n"%i).encode()+o+b"\nendobj\n"
x=len(buf); buf+=("xref\n0 %d\n"%(len(objs)+1)).encode()+b"0000000000 65535 f \n"+b"".join(("%010d 00000 n \n"%o).encode() for o in offs)
buf+=("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF"%(len(objs)+1,x)).encode()
open(os.path.join(S,"diagram.pdf"),"wb").write(buf)
open(os.path.join(S,"widget-demo.html"),"w").write("<!doctype html><h1>demo</h1>")
# empty seed deck (one blank slide) to author into
json.dump({"version":1,"slides":[{"id":"s1","elements":[]}]}, open(os.path.join(S,"seed.json"),"w"))
# a deck with a healthy linked pair (pair1 x2) AND an orphan (solo9 x1) → validate warns
json.dump({"version":1,"slides":[
  {"id":"s1","elements":[
    {"id":"e1","type":"text","preset":"title","html":"Eigenvalue localization","linkId":"pair1","position":{"x":80,"y":80,"width":800,"height":120}},
    {"id":"e2","type":"text","preset":"body","html":"an orphaned mover","linkId":"solo9","position":{"x":80,"y":300,"width":800,"height":120}}]},
  {"id":"s2","elements":[
    {"id":"e3","type":"text","preset":"title","html":"Eigenvalue localization","linkId":"pair1","position":{"x":80,"y":80,"width":800,"height":120}}]}]},
  open(os.path.join(S,"orphan.json"),"w"))
PY

cd "$ROOT/src-tauri"
echo "== clean + build instrumented CLI =="
cargo llvm-cov clean --workspace
eval "$(cargo llvm-cov show-env --export-prefix)"
cargo build --bin eigendeck-cli 2>&1 | tail -1
cargo test --lib -- --include-ignored --test-threads=1 >/dev/null 2>&1 && echo "  unit tests ok" || echo "  unit tests: some failures (continuing)"
BIN="$CARGO_TARGET_DIR/debug/eigendeck-cli"
[ -x "$BIN" ] || { echo "FATAL: CLI not built at $BIN"; exit 2; }

# Helpers. `c` runs a CLI command tolerantly (error paths are coverage too).
c(){ "$BIN" "$@" >/dev/null 2>&1 || true; }
eid_of(){ "$BIN" "$1" export json "$S/_e.json" >/dev/null 2>&1
          python3 -c "import json;d=json.load(open('$S/_e.json'));print(next((e['id'] for s in d['slides'] for e in s.get('elements',[])),''))" 2>/dev/null; }

echo "== WORKFLOW 1: author a talk deck programmatically (the LLM-editing path) =="
D="$S/talk.eigendeck"
c "$D" import json "$S/seed.json"
c "$D" add slide                       # append
c "$D" add slide                       # a third
c "$D" insert slide 2                   # squeeze one in the middle
c "$D" add text 1 'Spectra of graphs'   # title on slide 1
c "$D" add text 1 'The eigenvalues encode connectivity: $\lambda_2$ is the algebraic connectivity.'
c "$D" add text 2 'Cheeger: $h(G)/2 \le \lambda_2 \le 2h(G)$'
c "$D" move slide 3 1                   # reorder
EID="$(eid_of "$D")"
c "$D" move element "$EID" 240 160      # reposition a real element
c "$D" edit element "$EID" '{"id":"'"$EID"'","type":"text","preset":"title","html":"Spectra of graphs (revised)","position":{"x":80,"y":80,"width":1760,"height":160}}'
# review the authored deck
c "$D" outline
c "$D" list slides;  c "$D" list slides --json
c "$D" list elements            # all elements in the deck
c "$D" list elements 1          # just slide 1's
c "$D" show slide 1; c "$D" show slide 1 --json
c "$D" show element "$EID"
c "$D" get-text "$EID"
c "$D" set-text "$EID" 'Spectra of graphs — a working title with $\alpha,\beta$'
c "$D" search eigenvalue                # a term that IS in the deck
c "$D" search connectivity --json
c "$D" info; c "$D" info --json
c "$D" history; c "$D" history --limit 5; c "$D" history --json
c "$D" validate                         # clean deck → no issues

echo "== WORKFLOW 2: hand a finished deck off + extract its figures =="
cp "$ROOT/examples/welcome.eigendeck" "$S/w.eigendeck" 2>/dev/null
c "$S/w.eigendeck" export json --with-assets "$S/self.json"   # self-contained bundle to share
c "$S/re.eigendeck" import json "$S/self.json"                # colleague re-imports it
c "$S/re.eigendeck" outline                                   # asset labels via asset_path_for_element
c "$S/re.eigendeck" unpack --images --output "$S/ex-img"      # pull the figures to disk
c "$S/re.eigendeck" unpack --demos  --output "$S/ex-demo"     # and the demos
c "$S/re.eigendeck" unpack --output "$S/ex-all"               # everything
c "$S/re.eigendeck" unpack                                    # default dir → already-exists guard
c "$S/re.eigendeck" export json "$S/plain.json"               # plain export (stdout branch below)
"$BIN" "$S/re.eigendeck" export json >/dev/null 2>&1 || true  # export to stdout

echo "== WORKFLOW 3: import external figures into a deck =="
c "$D" store-asset "$S/figure.png"                    # → images/figure.png (image/png)
c "$D" store-asset "$S/diagram.pdf"                   # → images/diagram.pdf (octet-stream)
c "$D" store-asset "$S/widget-demo.html"             # → demos/... (text/html)
c "$D" store-asset "$S/chart.svg" --as images/chart.svg   # explicit --as path (svg)
c "$D" compact                                        # compact (all=false)
c "$D" compact --all                                  # and full compaction

echo "== WORKFLOW 4: validate a deck that has a real integrity problem =="
c "$S/orphan.eigendeck" import json "$S/orphan.json"
c "$S/orphan.eigendeck" validate                      # → WARN: orphan linkId
c "$S/orphan.eigendeck" validate --json

echo "== WORKFLOW 5: editing mistakes + cleanup (error paths) =="
EID2="$(eid_of "$D")"
c "$D" remove element "$EID2"          # delete an element by id-prefix
c "$D" remove slide 2                  # delete a slide
"$BIN" "$D" move slide 99 1 >/dev/null 2>&1 || true    # bad slide number → "Slide not found"
"$BIN" "$D" add text 99 'x' >/dev/null 2>&1 || true    # bad slide → error
"$BIN" "$D" edit element zz '{bad json' >/dev/null 2>&1 || true   # invalid JSON
"$BIN" "$D" remove element zzzznotfound >/dev/null 2>&1 || true   # not found
"$BIN" "$D" bogus-verb >/dev/null 2>&1 || true         # unknown command → usage
"$BIN" >/dev/null 2>&1 || true                          # no args → usage
"$BIN" "$D" >/dev/null 2>&1 || true                     # no verb → usage
"$BIN" "$D" add >/dev/null 2>&1 || true                 # missing subcommand
"$BIN" "$D" store-asset /no/such/file.png >/dev/null 2>&1 || true  # missing file
"$BIN" "$S/does-not-exist.eigendeck" info >/dev/null 2>&1 || true  # open a missing deck → error
# subcommand typos (each match's Unknown arm)
for v in list show move remove add insert import export; do
  "$BIN" "$D" "$v" wat >/dev/null 2>&1 || true
done

echo "== report (lib + CLI) -> $OUT_LCOV =="
cargo llvm-cov report --summary-only 2>/dev/null | grep -E 'cli\.rs|storage|lib\.rs|TOTAL' || true
cargo llvm-cov report --lcov --output-path "$OUT_LCOV" 2>/dev/null
echo "lcov written: $OUT_LCOV  ($(grep -c '^SF:' "$OUT_LCOV" 2>/dev/null) files)"
rm -rf "$S"
