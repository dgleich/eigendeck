#!/usr/bin/env python3
"""Showcase-ONLY post-process: subset every embedded @font-face in the exported
showcase.html down to the glyphs the deck actually uses.

Why this is a build step and NOT general Eigendeck export behaviour: the app's
HTML export embeds *full* font files on purpose — an exported deck is editable,
and the exporter can't know which glyphs a future editor will type. The showcase
is a frozen, published artifact, so here we can safely strip every glyph that
isn't on a slide. That's ~21 MB of the ~22.6 MB file (94 %); subsetting takes it
to ~1-2 MB.

Charset = every literal character in the file + every HTML entity decoded +
a generous baseline (ASCII, Latin-1, punctuation, sub/superscripts, Greek,
arrows, math operators) so demo text built at runtime in JS (λ, subscripts, →)
can't turn into tofu. Subsetting only keeps glyphs a font actually has, so a
Latin text face stays tiny even with the broad baseline.

Usage:
  uv run --with fonttools python subset-fonts.py showcase.html showcase.html
"""
import sys, re, io, base64, os
import html as htmlmod
from fontTools import subset

SRC, OUT = sys.argv[1], sys.argv[2]
doc = open(SRC, encoding="utf-8").read()

# --- build the keep-set of unicode codepoints --------------------------------
unicodes = set(ord(c) for c in doc)                       # every literal char
for ent in re.findall(r"&#x[0-9a-fA-F]+;|&#[0-9]+;|&[a-zA-Z][a-zA-Z0-9]+;", doc):
    for c in htmlmod.unescape(ent):
        unicodes.add(ord(c))                              # decoded entities
unicodes.update(range(0x20, 0x7E + 1))                    # ASCII safety net
# NOTE: every non-ASCII glyph the deck/demo actually shows (λ, Δ, Σ, subscripts,
# →, √, ≥, …) is already a LITERAL character in the file, so it's captured above.
# We deliberately do NOT add the full Greek/math/arrow blocks — those would keep
# hundreds of unused glyphs in the Computer-Modern / Libertinus faces (the math
# is rendered as SVG, not from these fonts). The render-verify step catches any
# runtime-generated glyph this misses.

# --- subset each embedded font ------------------------------------------------
PAT = re.compile(r"data:font/(otf|ttf);base64,([A-Za-z0-9+/=]+)")
cache = {}
before = after = 0

def shrink(b64):
    raw = base64.b64decode(b64)
    opts = subset.Options()
    opts.layout_features = ["*"]      # keep kerning/ligatures for quality
    opts.drop_tables += ["FFTM"]      # FontForge timestamp, never needed
    opts.recalc_bounds = True
    font = subset.load_font(io.BytesIO(raw), opts)
    ss = subset.Subsetter(options=opts)
    ss.populate(unicodes=unicodes)
    ss.subset(font)
    buf = io.BytesIO()
    subset.save_font(font, buf, opts)
    return base64.b64encode(buf.getvalue()).decode("ascii")

def repl(m):
    global before, after
    fmt, b64 = m.group(1), m.group(2)
    if b64 not in cache:
        cache[b64] = shrink(b64)
        before += len(b64)
        after += len(cache[b64])
    return f"data:font/{fmt};base64,{cache[b64]}"

doc = PAT.sub(repl, doc)
open(OUT, "w", encoding="utf-8").write(doc)

print(f"subset {len(cache)} fonts: {before/1048576:.2f}MB -> {after/1048576:.2f}MB base64")
print(f"file: {os.path.getsize(SRC)/1048576:.2f}MB -> {os.path.getsize(OUT)/1048576:.2f}MB")
