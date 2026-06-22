---
name: update-fonts
description: Update Eigendeck's bundled MathJax math fonts to the latest builds from the dgleich/mathjax-fonts repo. Use when the user says to update the fonts / font packs, points at a new mathjax-fonts commit, or wants to add a new font. mathjax-fonts now ships PREBUILT -nosre bundles, so the eigendeck side is just pull (or clone at the pinned commit) + npm run setup — no local rebuild.
---

# Update the math font packs

Eigendeck's math rendering uses one MathJax bundle per font, from the sibling
**dgleich/mathjax-fonts** repo. That repo now **commits the prebuilt `-nosre`
bundles at its repo root**, so on the eigendeck side there is **no build step** —
just pull + copy. (Rebuilding lives in the mathjax-fonts repo now; see the bottom
section, only needed when you change a font's *sources*.) The user-facing version
is `docs/updating-fonts.md`.

## TL;DR (eigendeck side)
1. `git pull` mathjax-fonts (or let `npm run setup` clone it at the pinned commit)
2. `npm run setup` — copies the prebuilt `-nosre` bundles → `public/mathjax/`
3. verify (`npm run build` + a visual screenshot)

## 0. Where things live
- Source repo: `/work/mathjax-fonts` (sibling clone; gitignored in eigendeck).
- 10 packages: `ptsans lato libertinus libertinus-sans lm-sans noto-sans
  source-sans source-code shantell concrete-euler`.
- mathjax-fonts **commits the prebuilt `-nosre` bundles at its repo root**
  (`tex-mml-svg-mathjax-<id>-nosre.js`; older checkouts also keep per-package
  copies under `mathjax-<id>/`). `scripts/setup-fonts.mjs` reads from the root
  (falls back to the subdir) and **pins** a fresh clone to `MATHJAX_FONTS_COMMIT`.
- In eigendeck, `public/mathjax/` is gitignored → a font update commits *nothing*
  here except registry / setup / doc / new-TTF changes. The font bytes don't
  travel via eigendeck git.
- `~/.cargo` not needed. Use `export HOME=/tmp` for git in `/work`.

## 1. Get the fonts (pull, or let setup clone at the pin)
```bash
cd /work/mathjax-fonts && git pull --ff-only    # brings the updated prebuilt bundles
```
If there's no sibling clone, `npm run setup` clones it at `MATHJAX_FONTS_COMMIT`.
To move to a newer build: pull, then bump `MATHJAX_FONTS_COMMIT` in
`scripts/setup-fonts.mjs` to the new SHA. (An existing clone is used as-is; setup
warns if its HEAD differs from the pin.)

> **Each release should ship the latest fonts** — refresh the pin (pull + bump
> `MATHJAX_FONTS_COMMIT` + `npm run setup`) as part of cutting a release. See the
> **release** skill.

## 2. Copy into the app
```bash
cd /work && npm run setup        # copies -nosre.js → public/mathjax/ (no build)
```

## 3. Verify
- **Build:** `npm run build` (tsc + vite) passes.
- **Visual (best — math is SVG, so headless screenshots work):** build a deck
  with one slide per font (set `slide.bodyFont` / `slide.titleFont` to the id)
  containing math like `$\lambda=\sum_{i=1}^n \alpha_i x_i^2$ $\mathrm{\alpha},\beta$ $\int_0^1 f$ $\sqrt{\frac{a}{b}}$`,
  via `eigendeck-cli <deck> import json <json>`. Open the REAL app through the
  **eigendeck-e2e** rig (tauri-driver + WebKitWebDriver + xvfb), `selectSlide(i)`
  through the `window.__eigendeck` seam (dist built with `VITE_EIGENDECK_SEAM=1`),
  wait for the SVG to render, and GET `/session/<id>/screenshot`. Eyeball the font.

## Adding a NEW font
1. **In mathjax-fonts:** add it (`mathjax-<id>/` with a `build/webpack-nosre.config.cjs`),
   add `<id>` to `build-all-nosre.cjs`'s `packages` list, rebuild, and **commit
   the prebuilt `-nosre` bundle** (see below).
2. Add its id to `MATHJAX_FONTS_PACKAGES` in `scripts/setup-fonts.mjs`.
3. Add a `FONT_PACKAGES` entry in `src/lib/fontRegistry.mjs` (`mathjaxBundle:
   'tex-mml-svg-mathjax-<id>-nosre.js'`, `files` = its text-font TTF names; mirror
   an existing `kind: 'static'`/`'variable'` entry), and a label.
4. Put the **text-font** TTFs in `public/fonts/<id>/` (these ARE committed). For
   an OFL/Google font: `curl -fsSL github.com/google/fonts/raw/main/ofl/<id>/<Family>-Regular.ttf`
   → `regular.ttf` (+ bold/italic/bold-italic + OFL.txt).
5. `npm run setup`, `npm run build`, screenshot-verify.

## Rebuilding in mathjax-fonts (only when you change a font's sources)
This is **not** an eigendeck-side step — only do it when you edit a font's
`cjs/` / sources in the mathjax-fonts repo, then commit the rebuilt bundle there.
```bash
export HOME=/tmp
cd /work/mathjax-fonts
# every package needs its own node_modules; symlink any that lack one:
for p in mathjax-*/; do [ -d "${p}node_modules" ] || ln -sfn ../mathjax-shantell/node_modules "${p}node_modules"; done
node mathjax-shantell/build/build-all-nosre.cjs    # applies the lcGreek patch, webpacks all
git add tex-mml-svg-mathjax-*-nosre.js && git commit -m "rebuild nosre bundles"
```
- **`-nosre` only** — the full SRE build hangs Tauri's restricted WebKit Worker.
- **lcGreek patch is mandatory** (build-all-nosre applies it, idempotent). Without
  it `\mathrm{\alpha}` renders italic instead of upright Greek.

## Gotchas
- **No build on the eigendeck side** — `npm run setup` only *copies* the prebuilt
  bundles. Don't run webpack here.
- **PT Sans** is the default, sourced from `mathjax-fonts/mathjax-ptsans` (migrated
  off the old in-tree `mathjax-ptsans-bundle/`).
- The full `…js` (non-nosre) bundles are unused by the app; only `-nosre` loads.

## Commit (eigendeck side)
Only registry / setup / doc / new-TTF changes are committable (`public/mathjax/`
bundles are gitignored). Work on a `fonts/...` branch, commit, fast-forward into
`main`, push. Rebuilt bundles + build-script changes are committed in the
**mathjax-fonts** repo itself (separate repo).
