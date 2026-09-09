#!/usr/bin/env python3
# Fixture for interaction-exercise-probe.mjs — a single slide carrying EVERY
# element type (text of several presets, image, arrow ×2, cover, html, video
# embed, video file, notebook) so the probe can select each in turn and mount
# its PropertiesPanel per-type inspector section + SlideElementRenderer branch,
# then drive real pointer gestures / context menus / toolbar on them.
#
# Assets (image PNG, file video webm, notebook ipynb) are embedded base64 so the
# deck is self-contained via `eigendeck-cli <deck> import json <this-output>`.
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

IMG_ID, VID_ID, NB_ID = "img-1", "vid-file-1", "nb-1"

ipynb = {
    "cells": [
        {"cell_type": "code", "source": ["x = 1 + 1\n"], "outputs": [],
         "execution_count": None, "metadata": {}},
        {"cell_type": "markdown", "source": ["# hi\n"], "metadata": {}},
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
    if os.path.exists(webm):
        assets.append({"assetId": VID_ID, "mime": "video/webm", "path": "clip.webm",
                       "data": b64_file(webm)})

    elements = [
        {"id": "e-title", "type": "text", "preset": "title", "html": "Interaction Title",
         "position": {"x": 60, "y": 40, "width": 1200, "height": 120}},
        {"id": "e-body", "type": "text", "preset": "body", "html": "Body <b>bold</b> text",
         "position": {"x": 60, "y": 180, "width": 520, "height": 160}},
        {"id": "e-textbox", "type": "text", "preset": "textbox", "html": "A text box",
         "backgroundColor": "#eef3fb", "backgroundOpacity": 0.9,
         "position": {"x": 620, "y": 180, "width": 380, "height": 140}},
        {"id": "e-annot", "type": "text", "preset": "annotation", "html": "annotation",
         "position": {"x": 1040, "y": 180, "width": 320, "height": 100}},
        {"id": "e-foot", "type": "text", "preset": "footnote", "html": "a footnote",
         "position": {"x": 60, "y": 360, "width": 400, "height": 80}},
        {"id": "e-image", "type": "image", "assetId": IMG_ID, "borderRadius": 8,
         "position": {"x": 520, "y": 360, "width": 240, "height": 200}},
        {"id": "e-arrow", "type": "arrow", "x1": 820, "y1": 380, "x2": 1180, "y2": 460,
         "color": "#e53e3e", "strokeWidth": 4, "heads": "end", "headSize": 16,
         "position": {"x": 0, "y": 0, "width": 0, "height": 0}},
        {"id": "e-arrow-curve", "type": "arrow", "x1": 820, "y1": 520, "x2": 1180, "y2": 600,
         "color": "#2563eb", "strokeWidth": 6, "heads": "both", "headSize": 18,
         "c1x": 900, "c1y": 440, "c2x": 1100, "c2y": 680,
         "points": [{"x": 1000, "y": 560}],
         "position": {"x": 0, "y": 0, "width": 0, "height": 0}},
        {"id": "e-cover", "type": "cover", "color": "#222222",
         "position": {"x": 1240, "y": 360, "width": 300, "height": 200}},
        {"id": "e-html", "type": "html",
         "html": "<div style=\"font:bold 32px sans-serif;color:#c0f\">HTML block</div>",
         "scaleMode": True, "scaleW": 400, "scaleH": 160,
         "position": {"x": 60, "y": 600, "width": 400, "height": 160}},
        {"id": "e-video-embed", "type": "video", "kind": "embed",
         "src": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
         "position": {"x": 500, "y": 600, "width": 480, "height": 270}},
        {"id": "e-notebook", "type": "notebook", "assetId": NB_ID,
         "position": {"x": 1020, "y": 600, "width": 800, "height": 400}},
    ]
    if os.path.exists(webm):
        elements.append(
            {"id": "e-video-file", "type": "video", "kind": "file", "assetId": VID_ID,
             "position": {"x": 60, "y": 800, "width": 400, "height": 225}})

    return {
        "title": "Interaction Exercise",
        "theme": "white",
        "config": {"width": 1920, "height": 1080, "customPalette": ["#ff00aa", "#00cc88"]},
        "slides": [{"id": "s1", "layout": "default", "notes": "interaction fixture",
                    "elements": elements}],
        "assets": assets,
    }

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/interaction.json"
    with open(out, "w") as f:
        json.dump(deck(), f)
    print(f"wrote {out}")
