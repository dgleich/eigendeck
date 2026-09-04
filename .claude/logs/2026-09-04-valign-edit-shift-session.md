# Text vertical-align shift on double-click to edit — 2026-09-04

Long-running bug: double-clicking a text box with **verticalAlign middle/bottom** shifted
its text vertically (middle up ~2px, bottom up ~4px); top was unaffected. Chased on branch
`fix/valign-edit-shift` (main untouched).

## Wrong theory (mine), and why the evidence misled me
I concluded it was a **macOS-WebKit render-engine** difference (SVG `<foreignObject>` display
vs HTML `contentEditable` edit) and "not fixable without unifying paint paths." Wrong. Three
things fooled me:
- **"Border ruled out"** — I checked the `.slide-element` border was *constant* across modes
  (it is, 2px both). Wrong test: the border shrinks the content box in *both* modes; only the
  bug's asymmetry mattered.
- **"macOS-only / ~1px"** — the e2e probe measured **viewport px** (editor canvas is scaled
  ~0.5, so 2 slide-px read as ~1) and used `THRESH = 8`, so it *passed a real bug* and it
  looked like a sub-pixel macOS-only thing.
- **My structural fix (`67e2ecd`, reverted on main)** — gave the edit CE `height:100%` +
  internal valign; it didn't help, which I misread as "must be the engine." It was actually
  evidence *for* the geometry cause (the box it fills is still the shrunk one).

## Actual root cause (from a macOS-capable agent's diagnosis — engine-independent, repro'd in Chromium)
`* { box-sizing:border-box }` + `.slide-element { border: 2px solid transparent }`, and the
element is sized `w×h` — so its **content box is (w−4)×(h−4)**. Edit puts the contentEditable
in that content box and the valign flex aligns within `h−4`. Display injects an SVG
**hard-authored at exactly `w×h`** (`TextElementSvg.tsx`) and valigns within the full `h` —
a box 4px taller that hangs 2px past the element's bottom. Delta is **border-width only**:
top 0, middle +2, bottom +4 slide-px, independent of font/size/line-height/zoom/platform.
Bonus bug: present/export/print/thumbnails have no chrome border, so display was *also* drawing
middle/bottom text 2/4px lower than they do — display was not a trustworthy reference.

## Fix (App.css) — make the chrome layout-neutral
`.slide-element`: `border: 2px solid transparent` → `outline: 2px solid transparent;
outline-offset: -2px`, and `border-color` → `outline-color` on hover / is-selected /
is-synced / is-dragging. Outline paints in the same place (inset, follows border-radius) but
consumes no layout, so the content box becomes the true `w×h` and display/edit/export/present/
thumbnail all agree. (`.context-target` already used outline.)

## Verification (headless — the bug IS reproducible in the rig once measured right)
Rewrote `e2e/valign-edit-shift-probe.mjs` to measure in **slide coordinates** (÷ canvas
scale) with `THRESH = 1`:
- **Pre-fix:** top 0, middle 2, bottom 4, title/bottom 4 — matches the falsifiable prediction.
- **Post-fix:** all 0; absolute positions also dropped ~2px so display now lands where
  export/present do.
- Editing still types/commits (`_iso-valign-edit-behavior-probe`).

## Status at context reset
- Fix + probe committed on `fix/valign-edit-shift`. The old `docs/valign-edit-shift-handoff.md`
  (which carried the wrong theory) was removed — this worklog supersedes it.
- **Full e2e suite was still RUNNING** as the regression gate for the shared `.slide-element`
  change (every element's content box grows back 4px → converges with export). On resume,
  read `/tmp/testrun/e2e-valign.log` (background task `bq2p5m9xk`): expect `ALL E2E PASS`.
  If any image/arrow/demo/video/cover/html probe fails, check whether it was asserting the
  OLD (border-inset) position vs a real regression before merging to main / a release.
