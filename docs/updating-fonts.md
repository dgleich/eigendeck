# Updating the math fonts

How to pull the latest math-font builds into Eigendeck. Math rendering uses
MathJax bundles that embed a specific font; those bundles come from the sibling
**[`dgleich/mathjax-fonts`](https://github.com/dgleich/mathjax-fonts)** repo
(except PT Sans — see below).

## The big picture

- The app loads `public/mathjax/tex-mml-svg-mathjax-<id>.js` at runtime (one
  bundle per font, lazy-loaded by `src/lib/fonts.ts` / `fontRegistry.mjs`).
- Those files are **copied in** by `npm run setup` (`scripts/setup-fonts.mjs`)
  from the sibling `mathjax-fonts/` clone. They are **gitignored** in this repo
  (`public/mathjax/`), so a font update commits **nothing** here — it's a
  per-machine build step. Don't look for the bundles in git; rebuild them.
- The app must use the **`-nosre`** bundles (no SpeechRuleEngine). The full SRE
  build hangs in Tauri's restricted WebKit Worker. `setup-fonts.mjs` copies the
  `…-nosre.js` source to the un-suffixed runtime name.
- **The `-nosre.js` bundles are themselves build artifacts** — they are *not*
  committed in `mathjax-fonts` either. `git pull` updates the font sources
  (`cjs/`, `build.py`) and the *full* bundles, but **not** the nosre bundles.
  You must rebuild them (step 3 below) or the fixes won't reach the app.

## Update procedure

Run on the machine where you can see the result (the Mac) — fonts are visual
and need eyeballing.

```bash
# 1. Pull the latest font sources.
#    setup-fonts.mjs does NOT pull an existing clone (it only clones if the dir
#    is missing), so update it yourself:
cd mathjax-fonts        # sibling of the eigendeck repo (or ./mathjax-fonts)
git pull --ff-only

# 2. (only if you changed a font's build.py / sources) regenerate its cjs/:
#    python3 mathjax-<id>/build.py
#    For upstream fix commits this is already done — the fixes land in the
#    committed cjs/, so you can skip straight to the rebuild.

# 3. Rebuild the nosre bundles (installs @mathjax/src + webpack on first run).
#    build-all-nosre.cjs auto-applies the lcGreek patch (without it,
#    \mathrm{\alpha} renders italic instead of upright Greek).
npm install
node mathjax-shantell/build/build-all-nosre.cjs

# 4. Copy the fresh bundles into the app.
cd ../eigendeck         # back to this repo
npm run setup

# 5. Verify: run the app, switch a slide to each changed font, check the math.
npm run tauri dev
```

To pull a NEW font that didn't exist before, see "Adding a font" below.

## PT Sans (the default) — now sourced from mathjax-fonts

PT Sans is the **default** font. As of 2026-06-14 it is sourced from
`mathjax-fonts/mathjax-ptsans` like every other font (migrated off the old
in-tree `mathjax-ptsans-bundle/`), so it tracks upstream fixes via the normal
pull + `build-all-nosre.cjs` + `npm run setup` flow above. The in-tree
`mathjax-ptsans-bundle/` is no longer used by `setup-fonts.mjs`.

The text-font TTFs still live in `public/fonts/ptsans/` (regular/bold/italic +
the PT Sans Narrow faces) — those are committed and unaffected by the math-bundle
update.

## Adding a font

1. Build it in `mathjax-fonts` (its own `mathjax-<id>/` with a
   `build/webpack-nosre.config.cjs`), and add `<id>` to the `packages` list in
   `mathjax-shantell/build/build-all-nosre.cjs`.
2. Add `<id>` to `MATHJAX_FONTS_PACKAGES` in `scripts/setup-fonts.mjs`.
3. Register the text font + math bundle in `src/lib/fontRegistry.mjs`
   (`FONT_PACKAGES`), and drop the text-font TTFs in `public/fonts/<id>/`
   (these TTFs **are** committed, unlike the math bundles).
4. `npm run setup`, then pick the font in the app to confirm it loads.

All **10** mathjax-fonts packages are now wired: ptsans, lato, libertinus,
libertinus-sans, lm-sans, noto-sans, source-sans, source-code, shantell,
concrete-euler. (Lato was added 2026-06-14 — its nosre bundle is built by
`build-all-nosre.cjs` and its text TTFs live in `public/fonts/lato/`.)

## Reproducibility / pinning

`setup-fonts.mjs` clones `mathjax-fonts` at `--depth 1` (whatever is latest) and
does not pin a commit. If you need a reproducible build, record the
`mathjax-fonts` commit you built from (e.g. in `CHANGELOG.md`) or check out that
commit in the clone before step 3. The currently-integrated builds are from
`mathjax-fonts@a49f41f`.

## Gotchas (these cost hours)

- **`git pull` does not update the nosre bundles** — they're build artifacts.
  Always rerun `build-all-nosre.cjs` after pulling, or the app shows the old
  fonts even though the sources changed.
- **`npm run setup` doesn't pull** an existing clone — pull manually first.
- **lcGreek patch** is mandatory; `build-all-nosre.cjs` applies it to
  `@mathjax/src`'s `ParseMethods.js`. If `node_modules` was reinstalled, the
  patch is re-applied on the next build (it's idempotent).
- **nosre, always** — never ship the full SRE bundle (it hangs the Worker).
- The full `…js` (non-nosre) bundles in `public/mathjax/` are leftovers and
  unused by the app; only the un-suffixed names are loaded.
