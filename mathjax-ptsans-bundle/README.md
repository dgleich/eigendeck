# MathJax PT Sans Font Bundle

Custom MathJax 4 SVG font package using PT Sans with a serifed capital I,
sans-serif Greek from newtxsf, and Computer Modern operators from Latin Modern Math.

## Pre-built bundles

Two bundles are included, ready to use:

- **`tex-mml-svg-mathjax-ptsans.js`** (2.8 MB) — Full bundle with accessibility (SRE, menu, explorer)
- **`tex-mml-svg-mathjax-ptsans-nosre.js`** (2.25 MB) — No accessibility/SRE. Use this for Tauri or environments where Web Workers / blob URLs cause issues.

## Usage

```html
<script>
MathJax = {
  tex: { inlineMath: [['$', '$']] },
  svg: { fontCache: 'global' },
};
</script>
<script src="tex-mml-svg-mathjax-ptsans-nosre.js"></script>
```

For `\bm` / `\boldsymbol` support (included in both bundles):
```html
<script>
MathJax = {
  tex: {
    inlineMath: [['$', '$']],
    macros: { bm: ['\\boldsymbol{#1}', 1] }
  },
  svg: { fontCache: 'global' },
};
</script>
```

## Rebuilding

To rebuild the webpack bundles after modifying font data in `cjs/`:

```bash
npm install
cd build

# Full bundle (with a11y)
npx webpack --config webpack.config.cjs

# No-SRE bundle (for Tauri)
npx webpack --config webpack-nosre.config.cjs
```

The bundles are written to the parent directory.

## Font sources

Three font layers, in priority order:

| Layer | Font | Glyphs | What |
|-------|------|--------|------|
| 1 | **PT Sans** (serifed I) | 191 | Latin A-Z/a-z, digits, punctuation, ± × ÷ |
| 2 | **newtxsf** (zsfmi/zsfmia) | 49 | Greek α-ω, Γ-Ω, variants, ∂, ∇, ℏ, ∀, ∃, ∅ |
| 3 | **Latin Modern Math** | ~615 | Arrows, relations, operators, stretchy delimiters |

Integral/sum/product glyphs (∫ ∑ ∏) use paths from MathJax's default newCM font
with adjusted italic corrections for tighter limit placement.

### Key parameters

- **x_height**: 0.500 (PT Sans's actual x-height in em — controls math/text scaling)
- **Serifed I**: bar_width=290 (regular), 380 (bold); bar_thickness=74/122 (matches T crossbar)
- **Integral IC**: 0.22 (normal), 0.42 (largeop) — controls subscript limit tucking
- **Invisible operators** (U+2061–2064): forced to zero-width (LM Math has visible debug glyphs)

## File structure

```
mathjax-ptsans-bundle/
├── tex-mml-svg-mathjax-ptsans.js         # Full bundle (pre-built)
├── tex-mml-svg-mathjax-ptsans-nosre.js   # No-SRE bundle (pre-built)
├── package.json
├── README.md
├── sre/
│   └── speech-worker.js                  # No-op stub for full bundle
├── build/
│   ├── tex-mml-svg-mathjax-ptsans.js     # Webpack entry (full)
│   ├── tex-mml-svg-mathjax-ptsans-nosre.js  # Webpack entry (no-SRE)
│   ├── webpack.config.cjs                # Webpack config (full)
│   └── webpack-nosre.config.cjs          # Webpack config (no-SRE)
└── cjs/
    ├── common.js                         # Font mixin (x_height, variants)
    ├── svg.js                            # SVG font class
    ├── chtml.js                          # CHTML font class
    ├── svg/
    │   ├── default.js                    # Font registration
    │   ├── normal.js                     # Normal variant (metrics + SVG paths)
    │   ├── bold.js
    │   ├── italic.js
    │   ├── bold-italic.js
    │   ├── monospace.js
    │   ├── delimiters.js                 # Stretchy delimiter assembly data
    │   ├── smallop.js / largeop.js       # Operator size variants
    │   ├── size3.js .. size15.js         # Progressive size variants
    │   ├── lf-tp.js / rt-bt.js / ext.js / mid.js  # Stretchy parts
    │   └── up.js / dup.js
    └── chtml/
        └── (same structure, metrics only)
```

## Modifying font data

Each `cjs/svg/*.js` file contains glyph entries like:
```javascript
0x49: [0.7, 0, 0.32, { p: '15 0 305 0...Z', ic: 0.05 }]
//     h    d   w       SVG path             italic correction
```

- `h` = height above baseline (em)
- `d` = depth below baseline (em)
- `w` = advance width (em)
- `p` = SVG path (leading M stripped — MathJax prepends its own)
- `ic` = italic correction (em) — shifts superscript right, subscript left

After editing, rebuild with webpack (see above).
