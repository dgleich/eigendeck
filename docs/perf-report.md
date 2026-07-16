# Performance benchmark & report

A structured, repeatable performance benchmark for Eigendeck — a fixed set of
**editor-mode and present-mode activities**, timed and repeated N times for
statistics, run across **several real decks + the perf-stress decks**, and merged
into **tracked JSON** (`e2e/perf-results/<version>.json`, one per build) whose git history is the
over-time regression record.

> **Numbers are ENV-RELATIVE.** The rig is headless WebKitGTK + software GL under
> xvfb — much slower than a real GPU Mac. Compare numbers **within one machine /
> across builds**, never as absolute perf. On a Mac the same suite runs far faster;
> regenerate the JSON there if you want a Mac baseline (note the `env` field).

## Files

| File | Role |
|---|---|
| `e2e/perf-suite.mjs` | The benchmark for ONE deck: runs the activity set, repeats `PERF_REPS` sessions (fresh app open each), emits per-activity stats (median / mean / stdev / min / max + raw reps). |
| `e2e/perf-suite-run.sh` | Runs the suite across the deck set (copying each deck to an isolated HOME so autosave can't mutate the committed originals) and merges into `e2e/perf-results/<git-describe>.json` with git ref + timestamp + env. |
| `e2e/perf-results/<version>.json` | The tracked results, **one file per build version** (named by `git describe --tags`, e.g. `v26.7.15.json` at a release, `v26.6.24.json` for the pre-security baseline). Commit them; diff two files to compare versions, or `git log -p` one to see re-runs of the same version. |

Prereqs are the usual e2e ones (see the **eigendeck-e2e** skill): `E2E_APP` built,
and `dist/` built with **`VITE_EIGENDECK_SEAM=1 npm run build`** (a plain build
strips the seam and every session times out — see that skill's gotcha #11).

## Running it

```bash
# whole suite, 3 reps/deck (default); writes e2e/perf-results/<git-describe>.json
bash e2e/perf-suite-run.sh
# more reps for tighter stats
PERF_REPS=5 bash e2e/perf-suite-run.sh

# one deck, ad hoc (prints JSON; PERF_OUT writes it to a file)
PROBE=e2e/perf-suite.mjs E2E_DECK=/abs/path/deck.eigendeck PERF_OUT=/tmp/r.json \
  bash e2e/run-probe.sh
```

## The activities

Both modes are exercised. Loop activities report the **median per-op** (robust to
one-off jank); each op is followed by a double-rAF so the number includes the paint.

**Open / build**
- `openToSeam` — app launch → the `__eigendeck` seam is live (deck structure loaded).
- `seamToFirstRender` — seam → the first slide canvas is painted.
- `thumbnailsBuild` — all sidebar thumbnails rendered (imgs decoded / render-div present).

**Editor mode**
- `rapidSlideNav` — `selectSlide` cycling forward through every slide (twice), per-switch.
- `addText`, `addImage`, `addSlide` — add each element/slide type.
- `moveElements` — nudge the current slide's elements.
- `undoRedo` — one undo+redo cycle.

**Present mode**
- `enterPresent` — `setPresenting(true)` → the `.present-slide` stage is up.
- `presentAdvance` — repeatedly "next slide" (dispatched `ArrowRight`, present's own
  window listener); only advances that actually change the slide are timed. This is
  the "rapid next-slide in a presentation" case.
- `presentPrev` — the same, backward.
- `exitPresent` — `setPresenting(false)` → back to the editor.

## Reading the results

```jsonc
{
  "generatedAt": "2026-07-16T…Z",
  "gitRef": "8ff7734", "gitDescribe": "v26.7.15-…",
  "reps": 3,
  "env": "headless WebKitGTK 2.50.6 / xvfb / software-GL",
  "decks": {
    "graph-explorer": {
      "slides": 8, "reps": 3,
      "activities": {
        "presentAdvance": { "median": 73, "mean": 74.1, "stdev": 5.2, "min": 68, "max": 81, "reps": [73, 68, 81] }
        // …one entry per activity
      }
    }
    // …one entry per deck
  }
}
```

**Study a regression** two ways:
1. **Over time / across versions (same machine):** diff two `e2e/perf-results/*.json`
   files (e.g. `v26.6.24.json` vs `v26.7.15-…json`), or `git log -p` one file for re-runs. Watch `median` per activity/deck; `stdev` tells you if a
   change is real or noise.
2. **Before/after a change (or vs an old release):** build the other version in a
   throwaway worktree and diff. E.g. to check whether work regressed demos:
   ```bash
   git worktree add /tmp/el-old <tag>
   ( cd /tmp/el-old && npm install && cp -r /work/public/mathjax public/ \
       && VITE_EIGENDECK_SEAM=1 npm run build \
       && CARGO_TARGET_DIR=/tmp/el-old-target ~/.cargo/bin/cargo build --bin eigendeck )
   # run the SAME e2e/perf-suite.mjs against E2E_APP=/tmp/el-old-target/debug/eigendeck
   ```
   (This is exactly how #153 — demos ~2.7× slower after the security isolation — was
   pinned against the pre-security tag `v26.6.24`.)

## Adding to the suite

**A new activity** — edit `e2e/perf-suite.mjs`:
1. Add a timed block inside the `ACTIVITIES` in-page script, writing `out.myThing = …`.
   Use `timeEach(n, fn)` for a loop op (returns median per-op), or `performance.now()`
   around a one-shot (poll a DOM condition with `await raf()` for the paint). Wrap it
   in `try/catch` returning `null` so one failing activity can't sink the rep.
2. Add its name to the `ACT_KEYS` array (controls order + which keys get stats).
3. It flows into the per-version results JSON automatically. Keep it deterministic and
   side-effect-bounded (don't leave the deck in a state that skews later activities).

**A new deck** — append `"name|/abs/path.eigendeck"` to `DECKS` in
`e2e/perf-suite-run.sh`. Missing files are skipped with a note. The perf-stress decks
are generated (not committed — too large); regenerate with
`gitignore/perf-stress/build_perf_deck.py <out.json> [scale]` (needs Pillow +
reportlab; see that dir).

## Domain-specific perf you should know about (where the real costs live)

- **PDF (pdfium).** PDFs rasterize via `db_render_pdf_page` (pdfium). Big PDFs
  (> `PDF_PROMOTE_THRESHOLD_BYTES` = 500 KB, `src/lib/assetRenderer.ts`) run a
  **tier-promotion** pipeline: render at FULL tier **once**, then downscale to the
  smaller thumb tiers from that cache — because pdfium's parse cost dominates for
  multi-MB PDFs, so you pay it once instead of per tier. Small PDFs render per tier
  directly. Renders are coalesced by an in-flight key so the sidebar-thumb + canvas
  tiers don't double-parse. This was the perf work done when PDFs were added; a
  benchmark that stresses PDFs should include a **big multi-page PDF** deck
  (`perf-stress-20mp` has one) and watch cold `thumbnailsBuild` / first `switchSlide`.
- **Large rasters (20 MP).** Cost is the **cold first-open** decode+downscale into
  `asset_cache` (`seamToFirstRender` cold ≫ warm; ~0.5 s per 20 MP image in the rig);
  warm re-opens are cached. Not a security regression (#115) — same mechanism pre/post.
  Levers: decode-at-scale, off-main-thread decode, or persisting the thumb cache.
- **Demos (security isolation).** Switching to a demo slide re-creates the
  opaque-origin `blob:` iframe + re-runs the injected-bridge handshake + parent-driven
  rAF — ~2.7× the pre-security cost (#153). `presentAdvance` / `rapidSlideNav` on a
  demo deck (`graph-explorer`, `magnetic-powers`) surface it.
- **Math (MathJax).** Text with `$…$` renders through a per-preset MathJax iframe
  pool; a deck heavy in math pays the pool warm-up on first open. Not in the current
  activity set — add a math-heavy deck if you want to track it.
