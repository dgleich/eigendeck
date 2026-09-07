#!/usr/bin/env python3
# Fixture for deep-editor-gestures-probe.mjs — a single slide with several text
# elements at clean 80-grid positions plus one embedded-image element. The probe
# drives the COLD editor-gesture paths the interaction probe leaves untouched:
# keyboard nudge (1px / 10px) in all four directions, keyboard z-order
# (Cmd+] / Cmd+[ / Cmd+Shift+] / Cmd+Shift+[), keyboard delete (single + multi),
# Cmd+A select-all → real-pointer GROUP drag (moveElementsBy path in
# DraggableBox), group nudge, shift-click additive selection, Escape deselect,
# resize handle, and a snap-to-grid drag.
#
# Elements sit at deterministic grid coordinates so snap / group-move deltas are
# exactly predictable.
import base64, json, sys

# 1x1 transparent PNG
PNG_B64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2"
           "FzhVAAAAAElFTkSuQmCC")

IMG_ID = "de-img-1"


def deck():
    elements = [
        {"id": "d1", "type": "text", "preset": "body", "html": "Element one",
         "position": {"x": 80, "y": 80, "width": 300, "height": 120}},
        {"id": "d2", "type": "text", "preset": "body", "html": "Element two",
         "position": {"x": 480, "y": 80, "width": 300, "height": 120}},
        {"id": "d3", "type": "text", "preset": "body", "html": "Element three",
         "position": {"x": 80, "y": 280, "width": 300, "height": 120}},
        {"id": "d4", "type": "text", "preset": "body", "html": "Element four",
         "position": {"x": 480, "y": 280, "width": 300, "height": 120}},
        {"id": "d5", "type": "text", "preset": "title", "html": "Deep Editor",
         "position": {"x": 80, "y": 480, "width": 600, "height": 120}},
        {"id": "dimg", "type": "image", "kind": "raster", "assetId": IMG_ID,
         "borderRadius": 6,
         "position": {"x": 960, "y": 80, "width": 240, "height": 200}},
    ]
    return {
        "title": "Deep Editor Gestures",
        "theme": "white",
        "config": {"width": 1920, "height": 1080},
        "slides": [{"id": "s1", "layout": "default", "notes": "deep editor fixture",
                    "elements": elements}],
        "assets": [
            {"assetId": IMG_ID, "mime": "image/png", "path": "images/dot.png",
             "data": PNG_B64},
        ],
    }


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/deep_editor.json"
    with open(out, "w") as f:
        json.dump(deck(), f)
    print(f"wrote {out}")
