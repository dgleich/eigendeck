#!/bin/bash
# Structured performance benchmark across a SET of decks. Runs e2e/perf-suite.mjs
# (a fixed set of editor + present-mode activities, PERF_REPS sessions each) on every
# deck below and merges the per-deck stats into ONE tracked JSON: e2e/perf-results.json.
# Commit that file; its git history is the over-time regression record.
#
# Numbers are ENV-RELATIVE (headless WebKitGTK + software GL under xvfb) — compare
# them within one environment / across builds on the SAME machine, not as absolute ms.
#
# Usage:  bash e2e/perf-suite-run.sh            # PERF_REPS=3 (default), all decks
#         PERF_REPS=5 bash e2e/perf-suite-run.sh
# Prereqs: E2E_APP built + dist built with VITE_EIGENDECK_SEAM=1 (see the eigendeck-e2e skill).
#
# ADD A DECK: append "name|path" to DECKS below (a missing file is skipped with a note).
# ADD AN ACTIVITY: edit the ACTIVITIES script in e2e/perf-suite.mjs + the ACT_KEYS list;
#   see docs/perf-report.md.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export E2E_APP="${E2E_APP:-/tmp/el-target/debug/eigendeck}"
export PERF_REPS="${PERF_REPS:-3}"
TMPBASE="$(mktemp -d)"
RESULTS="${PERF_RESULTS:-$ROOT/e2e/perf-results.json}"
# The rig launcher to use — override with RUN_PROBE to serve a DIFFERENT dist (e.g.
# an old build in a worktree: RUN_PROBE=/tmp/el-old/e2e/run-probe.sh serves
# /tmp/el-old/dist). Its own dir's dist is served; E2E_APP picks the binary.
RUNPROBE="${RUN_PROBE:-$ROOT/e2e/run-probe.sh}"

# name|source-deck-path. The REAL decks in active use + light/demo baselines + the
# (gitignored, large) synthetic perf decks. Keep the "used" ones — they're what the
# perf actually needs to hold up on.
DECKS=(
  "intro-slide|$ROOT/examples/intro-slide.eigendeck"            # baseline: light, text only
  "graph-explorer|$ROOT/examples/graph-explorer.eigendeck"     # baseline: demos (#153 tracking)
  "welcome|$ROOT/examples/welcome.eigendeck"                   # USED: the welcome deck
  "magnetic-powers|$ROOT/examples/magnetic-powers.eigendeck"   # USED: heavy mixed — 121 els, images + demo
  "local-networks|$ROOT/examples/local-networks.eigendeck"     # USED: the "local analysis" deck (7 MB)
  "frontend-slides|$ROOT/examples/frontend-slides.eigendeck"   # USED: html-element demos + callouts
  "showcase|$ROOT/example-demos/showcase/showcase.eigendeck"   # USED: the showcase deck
  "perf-medium|$ROOT/gitignore/perf-stress/medium.eigendeck"   # perf: 2.8 MP rasters (generated; see gitignore/perf-stress)
  "perf-stress-20mp|$ROOT/gitignore/perf-stress/perf-stress.eigendeck"  # perf: 20 MP rasters + big PDF + SVG
)

PARTS=()
for entry in "${DECKS[@]}"; do
  name="${entry%%|*}"; src="${entry##*|}"
  if [ ! -f "$src" ]; then echo "SKIP $name — not found: $src"; continue; fi
  # Copy to an isolated HOME so autosave never mutates the committed source deck.
  dir="$TMPBASE/$name"; mkdir -p "$dir"; cp "$src" "$dir/$name.eigendeck"
  out="$dir/result.json"
  echo "== $name ($PERF_REPS reps) =="
  PROBE="$ROOT/e2e/perf-suite.mjs" E2E_DECK="$dir/$name.eigendeck" PERF_OUT="$out" \
    bash "$RUNPROBE" 2>&1 | grep -E "rep [0-9]|PERF_SUITE_FAIL|FATAL" | sed 's/\x1b\[[0-9;]*m//g'
  if [ -f "$out" ]; then PARTS+=("$out"); else echo "  (no result for $name)"; fi
done

# Merge parts + metadata into the tracked results file.
GITREF="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
GITDESC="$(git -C "$ROOT" describe --tags --always 2>/dev/null || echo unknown)"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
WKVER="$(dpkg-query -W -f='${Version}' libwebkit2gtk-4.1-0 2>/dev/null || echo '?')"
ENVDESC="headless WebKitGTK $WKVER / xvfb / software-GL ($(uname -m))"

python3 - "$RESULTS" "$GITREF" "$GITDESC" "$STAMP" "$PERF_REPS" "$ENVDESC" "${PARTS[@]}" <<'PY'
import json, sys
results, gitref, gitdesc, stamp, reps, envdesc, *parts = sys.argv[1:]
decks = {}
for p in parts:
    try:
        d = json.load(open(p)); decks[d["deck"]] = {"slides": d.get("slides"), "reps": d.get("reps"), "activities": d.get("activities", {})}
    except Exception as e:
        print("  merge skip", p, e)
out = {"generatedAt": stamp, "gitRef": gitref, "gitDescribe": gitdesc, "reps": int(reps),
       "env": envdesc, "note": "Env-relative ms (headless rig). Compare within one machine / across builds, not as absolute perf. See docs/perf-report.md.",
       "decks": decks}
json.dump(out, open(results, "w"), indent=2)
open(results, "a").write("\n")
print(f"\nwrote {results}: {len(decks)} decks @ {gitdesc} ({stamp})")
PY
rm -rf "$TMPBASE"
