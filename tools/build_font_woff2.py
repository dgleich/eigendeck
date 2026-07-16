#!/usr/bin/env python3
"""Generate WOFF2 siblings for every bundled TTF/OTF under public/fonts.

WOFF2 (Brotli-compressed) is ~40% the size of the raw TTF, which matters most
for the DEMO font embed: opaque-origin demo iframes can't fetch app-origin
/fonts, so the deck's fonts are inlined as base64 data: @font-face into every
demo document and re-parsed on each mount (docs/perf-report.md, "Demos"). Serving
WOFF2 cuts that payload ~60%.

App-wide font serving + MathJax are untouched (they keep the TTFs). Only the
embed path (src/lib/fonts.ts buildEmbeddedFontFacesCSS) prefers the .woff2.

Run: uv run --with fonttools --with brotli tools/build_font_woff2.py
Idempotent; skips a .woff2 that is newer than its source.
"""
import glob
import os
import sys

try:
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit("needs fonttools+brotli: uv run --with fonttools --with brotli tools/build_font_woff2.py")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "public", "fonts")

made = skipped = 0
tot_src = tot_out = 0
for src in sorted(glob.glob(os.path.join(FONTS, "**", "*.ttf"), recursive=True) +
                  glob.glob(os.path.join(FONTS, "**", "*.otf"), recursive=True)):
    out = os.path.splitext(src)[0] + ".woff2"
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src):
        skipped += 1
        continue
    f = TTFont(src)
    f.flavor = "woff2"
    f.save(out)
    made += 1
    tot_src += os.path.getsize(src)
    tot_out += os.path.getsize(out)
    print(f"  {os.path.relpath(out, ROOT)}  {os.path.getsize(src)//1024}KB -> {os.path.getsize(out)//1024}KB")

print(f"woff2: made {made}, skipped {skipped} up-to-date"
      + (f"; {tot_src//1024}KB -> {tot_out//1024}KB ({100*tot_out//tot_src if tot_src else 0}%)" if made else ""))
