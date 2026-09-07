#!/usr/bin/env python3
# Fixture for user-journey-probe.mjs — a RICH multi-slide deck the journey probe
# walks the native menu/file/present layer over. It carries:
#   - THREE slides (so slide-new / duplicate / delete and present-nav have room),
#   - a slide GROUP (slides 2 + 3 share a groupId → group numbering / group move),
#   - EVERY element type across the slides (text presets, image, arrow ×2, cover,
#     html, notebook, video embed, and a file video if test.webm is present),
# so firing the Insert / Slide / View / Present / Save menu commands exercises the
# real handlers against a non-trivial deck.
#
# Assets (image PNG, notebook ipynb, optional file video) are embedded base64 so
# the deck is self-contained via `eigendeck-cli <deck> import json <this-output>`.
import base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))

# 1x1 transparent PNG
PNG_B64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2"
           "FzhVAAAAAElFTkSuQmCC")

def b64_obj(obj):
    return base64.b64encode(json.dumps(obj).encode()).decode()

def b64_file(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()

IMG_ID, VID_ID, NB_ID = "j-img-1", "j-vid-file-1", "j-nb-1"

ipynb = {
    "cells": [
        {"cell_type": "code", "source": ["y = 2 + 3\n"], "outputs": [],
         "execution_count": None, "metadata": {}},
        {"cell_type": "markdown", "source": ["## journey\n"], "metadata": {}},
    ],
    "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3"},
                 "language_info": {"name": "python"}},
    "nbformat": 4, "nbformat_minor": 5,
}


def deck():
    assets = [
        {"assetId": IMG_ID, "mime": "image/png", "path": "dot.png", "data": PNG_B64},
        {"assetId": NB_ID, "mime": "application/x-ipynb+json", "path": "nb.ipynb",
         "data": b64_obj(ipynb)},
    ]
    webm = os.path.join(HERE, "test.webm")
    have_webm = os.path.exists(webm)
    if have_webm:
        assets.append({"assetId": VID_ID, "mime": "video/webm", "path": "clip.webm",
                       "data": b64_file(webm)})

    # ── slide 1: title + body + textbox + annotation + footnote + arrow ──────
    s1 = [
        {"id": "j-title", "type": "text", "preset": "title", "html": "Journey Title",
         "position": {"x": 60, "y": 40, "width": 1200, "height": 120}},
        {"id": "j-body", "type": "text", "preset": "body", "html": "Body <b>bold</b> text",
         "position": {"x": 60, "y": 180, "width": 520, "height": 160}},
        {"id": "j-textbox", "type": "text", "preset": "textbox", "html": "A text box",
         "backgroundColor": "#eef3fb", "backgroundOpacity": 0.9,
         "position": {"x": 620, "y": 180, "width": 380, "height": 140}},
        {"id": "j-annot", "type": "text", "preset": "annotation", "html": "annotation",
         "position": {"x": 1040, "y": 180, "width": 320, "height": 100}},
        {"id": "j-foot", "type": "text", "preset": "footnote", "html": "a footnote",
         "position": {"x": 60, "y": 360, "width": 400, "height": 80}},
        {"id": "j-arrow", "type": "arrow", "x1": 820, "y1": 380, "x2": 1180, "y2": 460,
         "color": "#e53e3e", "strokeWidth": 4, "heads": "end", "headSize": 16,
         "position": {"x": 0, "y": 0, "width": 0, "height": 0}},
    ]

    # ── slide 2 (group A): image + cover + curved arrow + html ───────────────
    s2 = [
        {"id": "j-image", "type": "image", "assetId": IMG_ID, "borderRadius": 8,
         "position": {"x": 120, "y": 120, "width": 240, "height": 200}},
        {"id": "j-cover", "type": "cover", "color": "#222222",
         "position": {"x": 1240, "y": 360, "width": 300, "height": 200}},
        {"id": "j-arrow-curve", "type": "arrow", "x1": 820, "y1": 520, "x2": 1180, "y2": 600,
         "color": "#2563eb", "strokeWidth": 6, "heads": "both", "headSize": 18,
         "c1x": 900, "c1y": 440, "c2x": 1100, "c2y": 680,
         "points": [{"x": 1000, "y": 560}],
         "position": {"x": 0, "y": 0, "width": 0, "height": 0}},
        {"id": "j-html", "type": "html",
         "html": "<div style=\"font:bold 32px sans-serif;color:#c0f\">HTML block</div>",
         "scaleMode": True, "scaleW": 400, "scaleH": 160,
         "position": {"x": 60, "y": 600, "width": 400, "height": 160}},
    ]

    # ── slide 3 (group A): notebook + video embed (+ file video if present) ──
    s3 = [
        {"id": "j-notebook", "type": "notebook", "assetId": NB_ID,
         "position": {"x": 1020, "y": 120, "width": 800, "height": 400}},
        {"id": "j-video-embed", "type": "video", "kind": "embed",
         "src": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
         "position": {"x": 120, "y": 600, "width": 480, "height": 270}},
    ]
    if have_webm:
        s3.append(
            {"id": "j-video-file", "type": "video", "kind": "file", "assetId": VID_ID,
             "position": {"x": 660, "y": 600, "width": 400, "height": 225}})

    slides = [
        {"id": "s1", "layout": "default", "notes": "journey slide 1", "elements": s1},
        # slides 2 & 3 form group "grp-a" (shared numbering / group move).
        {"id": "s2", "layout": "default", "notes": "journey slide 2",
         "groupId": "grp-a", "elements": s2},
        {"id": "s3", "layout": "default", "notes": "journey slide 3",
         "groupId": "grp-a", "elements": s3},
    ]

    return {
        "title": "User Journey",
        "theme": "white",
        "config": {"width": 1920, "height": 1080, "author": "e2e",
                   "venue": "headless", "customPalette": ["#ff00aa", "#00cc88"]},
        "slides": slides,
        "assets": assets,
    }


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/journey.json"
    with open(out, "w") as f:
        json.dump(deck(), f)
    print(f"wrote {out}")
