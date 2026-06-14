---
name: update-fonts
description: Update Eigendeck's bundled MathJax math fonts to the latest builds from the dgleich/mathjax-fonts repo. Use when the user says to update the fonts / font packs, points at a new mathjax-fonts commit, or wants to add a new font. Pulls the font sources, rebuilds the -nosre webpack bundles, copies them into public/mathjax, and verifies.
---

# Update the math font packs

Eigendeck's math rendering uses one MathJax bundle per font, built from the
sibling **dgleich/mathjax-fonts** repo. Updating is **three manual steps** —
pulling alone does NOTHING (there is no auto-build). The user-facing version of
this is `docs/updating-fonts.md`.

## TL;DR
1. `git pull` mathjax-fonts
2. **rebuild** the `-nosre` bundles (webpack) — *this* is what picks up changes
3. `npm run setup` (copies bundles → `public/mathjax/`)
4. verify (checksum + visual screenshot)

## 0. Where things live
- Source repo: `/work/mathjax-fonts` (sibling clone; gitignored in eigendeck).
- 10 packages: `ptsans lato libertinus libertinus-sans lm-sans noto-sans
  source-sans source-code shantell concrete-euler`.
- The app loads `public/mathjax/tex-mml-svg-mathjax-<id>-nosre.js`. **Both
  `public/mathjax/` and the `-nosre.js` bundles are gitignored** → a font update
  commits *nothing* here except registry / setup / doc / new-TTF changes. The
  font bytes don't travel via eigendeck git; each machine rebuilds.
- `~/.cargo` not needed. Use `export HOME=/tmp` for git in `/work`.

## 1. Pull the sources
```bash
cd /work/mathjax-fonts && git pull --ff-only      # note the commit (e.g. a49f41f)
```
A `git pull` updates `cjs/` (tracked) but NOT the `-nosre` bundles (untracked
build artifacts) — so you MUST rebuild.

## 2. Rebuild the -nosre bundles  ← the actual build
```bash
export HOME=/tmp
cd /work/mathjax-fonts
# build deps live in mathjax-shantell/node_modules; every package needs its own
# node_modules. Symlink any that lack one (e.g. a newly-added font):
for p in mathjax-*/; do [ -d "${p}node_modules" ] || ln -sfn ../mathjax-shantell/node_modules "${p}node_modules"; done
node mathjax-shantell/build/build-all-nosre.cjs    # applies the lcGreek patch, webpacks all
```
Every line should print `OK`. If a font is missing from the run, add its id to
the `packages = [...]` array at the top of `build-all-nosre.cjs`.

## 3. Copy into the app
```bash
cd /work && npm run setup        # copies -nosre.js → public/mathjax/ (no build)
```

## 4. Verify
- **Checksum** (prove the bundle actually changed): a changed font's
  `public/mathjax/<id>-nosre.js` md5 should differ from the previous build. To
  get a true before/after for one font: `git -C mathjax-fonts checkout <oldsha>
  -- mathjax-<id>/cjs`, rebuild → old md5; `git checkout <newsha> -- ...cjs`,
  rebuild → new md5; they must differ. (`git pull` alone never changes them.)
- **Build:** `npm run build` (tsc + vite) passes.
- **Visual (best — math is SVG, so headless screenshots work):** build a deck
  with one slide per font (set `slide.bodyFont` / `slide.titleFont` to the id)
  containing math like `$\lambda=\sum_{i=1}^n \alpha_i x_i^2$ $\mathrm{\alpha},\beta$ $\int_0^1 f$ $\sqrt{\frac{a}{b}}$`,
  via `eigendeck-cli <deck> import json <json>`. Open the REAL app through the
  **eigendeck-e2e** rig (tauri-driver + WebKitWebDriver + xvfb), `selectSlide(i)`
  through the `window.__eigendeck` seam (build the dist with
  `VITE_EIGENDECK_SEAM=1`), wait for the SVG to render, and GET
  `/session/<id>/screenshot`. Eyeball that the font + math look right.

## Adding a NEW font (when mathjax-fonts gains one, e.g. Lato)
1. Ensure it's in `build-all-nosre.cjs`'s `packages` list (+ its node_modules
   symlink), and build it (step 2).
2. Add its id to `MATHJAX_FONTS_PACKAGES` in `scripts/setup-fonts.mjs`.
3. Add a `FONT_PACKAGES` entry in `src/lib/fontRegistry.mjs`: `mathjaxBundle:
   'tex-mml-svg-mathjax-<id>-nosre.js'`, `files` = its text-font TTF names
   (mirror an existing `kind: 'static'`/`'variable'` entry).
4. Put the **text-font** TTFs in `public/fonts/<id>/` (these ARE committed). For
   an OFL/Google font: `curl -fsSL github.com/google/fonts/raw/main/ofl/<id>/<Family>-Regular.ttf`
   → `regular.ttf` (+ bold/italic/bold-italic + OFL.txt).
5. `npm run setup`, `npm run build`, screenshot-verify.

## Gotchas (these cost time)
- **NO auto-build.** `npm run setup` only copies. `build-all-nosre.cjs` (webpack)
  is what compiles source changes into the bundles.
- **`-nosre` only** — the full SRE build hangs Tauri's restricted WebKit Worker.
- **lcGreek patch is mandatory** (build-all-nosre applies it, idempotent).
  Without it `\mathrm{\alpha}` renders italic instead of upright Greek.
- **PT Sans** is the default and is sourced from `mathjax-fonts/mathjax-ptsans`
  (migrated off the old in-tree `mathjax-ptsans-bundle/`).
- The `mathjax-fonts` git pointer can lag the working tree; after `git pull`,
  always rebuild rather than trusting the on-disk `-nosre` bundles.

## Commit (eigendeck side)
Only registry / setup / doc / new-TTF changes are committable (bundles are
gitignored). Work on a `fonts/...` branch, commit, fast-forward into `main`,
push. Also commit any `build-all-nosre.cjs` / new-font changes in the
**mathjax-fonts** repo itself (separate repo).
