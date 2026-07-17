#!/usr/bin/env python3
"""Generate a deck covering the export-matrix style combinations (exportMatrix.test.mjs)
as REAL elements, so the HTML export->import round-trip can be verified to preserve
every style property (not just element counts/assets). Each element carries a
distinct style variation; element-fidelity-probe deep-compares before vs after.

Usage:  python3 make_style_matrix_deck.py <out.json>
"""
import json, sys

W, H = 1920, 1080
els = []
n = 0

def add(el):
    global n
    el.setdefault("position", {"x": (n % 6) * 300 + 20, "y": (n // 6) * 150 + 20, "width": 260, "height": 120})
    el["id"] = el.get("id") or f"{el['type']}-{n}"
    els.append(el); n_local = n
    globals()['n'] = n + 1

def T(**p):  # text
    add({"type": "text", "preset": p.pop("preset", "body"), "html": p.pop("html", "Styled λ Σ"), **p})
def A(**p):  # arrow
    add({"type": "arrow", "x1": 10, "y1": 20, "x2": 200, "y2": 60, "color": "#e53e3e",
         "strokeWidth": 3, "heads": "end", "headSize": 14, **p, "position": {"x": 0, "y": 0, "width": 0, "height": 0}})
def I(**p):  # image (dummy assetId — style DATA round-trips regardless of asset)
    add({"type": "image", "kind": "raster", "assetId": p.pop("assetId", "dummy-asset"), **p})
def C(**p):  # cover
    add({"type": "cover", **p})
def Hh(**p):  # html
    add({"type": "html", "html": p.pop("html", "<b>hi ✦</b>"), **p})
def V(**p):  # video
    add({"type": "video", **p})

# --- text: every style property the matrix exercises ---
for preset in ("title", "body", "textbox", "annotation", "footnote", "hype"):
    T(preset=preset, html=f"{preset} text")
T(backgroundColor="#ff0000", backgroundOpacity=0.5)
T(boxTint="#ff0000")
T(backgroundColor="#eee", boxShadow=True)
for eff in ("glow", "shadow"):
    T(textEffect=eff)
T(padding={"top": 5, "right": 7, "bottom": 9, "left": 11})
for va in ("top", "middle", "bottom"):
    T(verticalAlign=va)
T(borderRadius=16, backgroundColor="#eee")
T(rotation=12)
T(fontSize=77)
T(fontSizeName="footnote")
T(color="accent")
T(color="#3366cc")
T(html="a <b>bold</b> <i>ital</i> <code>x</code> word")

# --- arrow: heads / geometry / color / opacity / splines ---
for heads in ("none", "start", "end", "both"):
    A(heads=heads)
A(headSize=28)
A(strokeWidth=8)
A(color="#2563eb")
A(opacity=0.4)
A(points=[{"x": 60, "y": 40}, {"x": 120, "y": 10}])  # curved

# --- image visuals ---
I(borderRadius=20)
I(opacity=0.6)
I(rotation=8)
I(shadow=True)

# --- cover ---
C(color="#222222")
C(boxTint="#ff0000")
C()  # no color -> slide theme bg

# --- html element ---
Hh(background="#101010")
Hh(scaleMode=True, scaleW=400, scaleH=200)

# --- video ---
V(kind="embed", src="https://www.youtube.com/watch?v=dQw4w9WgXcQ")
V(kind="embed", src="https://vimeo.com/123456")
V(kind="file", assetId="dummy-video", playbackRate=1.5, loop=True)

# spread across a few slides so nothing depends on overlap
per = 12
slides = []
for i in range(0, len(els), per):
    slides.append({"id": f"s{i//per+1}", "layout": "default", "notes": "", "elements": els[i:i+per]})

deck = {"title": "Style Matrix Round-trip λ", "theme": "white",
        "config": {"width": W, "height": H}, "slides": slides}
out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/style-matrix.json"
json.dump(deck, open(out, "w"), indent=1)
print(f"wrote {out}: {len(els)} styled elements across {len(slides)} slides")
