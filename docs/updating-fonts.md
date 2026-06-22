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
- **The `-nosre.js` bundles are now committed in `mathjax-fonts`** — prebuilt at
  the repo **root** (`tex-mml-svg-mathjax-<id>-nosre.js`; older checkouts also
  keep per-package copies under `mathjax-<id>/`). So `git pull` brings the
  updated bundles directly, and on this side you just `npm run setup` — **no
  webpack rebuild**. (The rebuild now happens *in* the `mathjax-fonts` repo when
  you change a font's sources; you commit the rebuilt bundle there — see
  "Rebuilding in mathjax-fonts" below.)

## Update procedure

Run on the machine where you can see the result (the Mac) — fonts are visual
and need eyeballing.

```bash
# 1. Pull the latest fonts. mathjax-fonts ships the prebuilt -nosre bundles, so
#    a pull is all that's needed — no rebuild on this side. (setup-fonts.mjs
#    does NOT pull an existing clone, so update it yourself.)
cd mathjax-fonts        # sibling of the eigendeck repo (or ./mathjax-fonts)
git pull --ff-only

# 2. Copy the bundles into the app (reads the -nosre bundles from the
#    mathjax-fonts repo root; falls back to the per-package subdir).
cd ../eigendeck
npm run setup

# 3. Verify: run the app, switch a slide to each changed font, check the math.
npm run tauri dev
```

### Rebuilding in mathjax-fonts (only when you change a font's sources)

If you edited a font's `cjs/`/`build.py` (not just pulling upstream), rebuild and
**commit the bundle in the mathjax-fonts repo** so the pull-+-setup flow above
keeps working:

```bash
cd mathjax-fonts
npm install
node mathjax-shantell/build/build-all-nosre.cjs   # applies the lcGreek patch
git add tex-mml-svg-mathjax-*-nosre.js && git commit -m "rebuild nosre bundles"
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

`setup-fonts.mjs` **pins** the mathjax-fonts commit it clones (the
`MATHJAX_FONTS_COMMIT` constant), so a fresh clone is reproducible. To move to a
newer build: pull mathjax-fonts (rebuild + commit there only if you changed a
font's sources), then bump `MATHJAX_FONTS_COMMIT` to that SHA. An existing
sibling clone is used as-is — setup just warns if its HEAD differs from the pin.

## Gotchas

- **No build step on this side.** mathjax-fonts ships the prebuilt `-nosre`
  bundles; `npm run setup` only *copies* them into `public/mathjax/` (gitignored).
  Rebuilding (webpack + the mandatory lcGreek patch for upright `\mathrm{\alpha}`)
  happens in the mathjax-fonts repo — see "Rebuilding in mathjax-fonts" above.
- **`-nosre` only** — the app uses the `-nosre` bundles; the full SRE build hangs
  Tauri's restricted WebKit Worker. (mathjax-fonts also has full `…js` bundles;
  those aren't used here.)
- **`npm run setup` doesn't `git pull`** an existing sibling clone — it uses
  what's checked out (and warns if that isn't the pinned commit).
