#!/usr/bin/env python3
# Generate a presentation JSON with TWO independent notebooks on two slides,
# each holding a DIFFERENT recording (MARK_A on slide 1, MARK_B on slide 2).
# Linking them must raise the "which recording to keep?" chooser. Drive it with
# link-smoke.mjs.
#
# NOTE: the launch-open path (take_launch_file → db_open) expects a SQLITE
# .eigendeck, so convert this JSON first:
#   eigendeck-cli out.eigendeck import json this.json
import base64, json, sys

def b64(o): return base64.b64encode(json.dumps(o).encode()).decode()

def ipynb():
    return {"cells": [{"cell_type": "code", "source": ["k = 5\n"], "outputs": [],
                       "execution_count": None, "metadata": {}}],
            "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3"},
                         "language_info": {"name": "python"}},
            "nbformat": 4, "nbformat_minor": 5}

def ov(mark):
    return {"version": 1, "cellEdits": {"0": f"k = 999  # {mark}"},
            "cellOutputs": {}, "cellCounts": {}, "appendedCells": []}

OV = "application/x-eigendeck-overlay+json"
deck = {
    "title": "link conflict", "theme": "white", "config": {},
    "slides": [
        {"id": "s1", "elements": [{"id": "nb1", "type": "notebook", "assetId": "ipy1",
            "position": {"x": 60, "y": 60, "width": 1100, "height": 640}}]},
        {"id": "s2", "elements": [{"id": "nb2", "type": "notebook", "assetId": "ipy2",
            "position": {"x": 60, "y": 60, "width": 1100, "height": 640}}]},
    ],
    "assets": [
        {"assetId": "ipy1", "mime": "application/x-ipynb+json", "path": "a.ipynb", "data": b64(ipynb())},
        {"assetId": "ipy2", "mime": "application/x-ipynb+json", "path": "b.ipynb", "data": b64(ipynb())},
        {"assetId": "ovA", "mime": OV, "ownerElementId": "nb1", "data": b64(ov("MARK_A"))},
        {"assetId": "ovB", "mime": OV, "ownerElementId": "nb2", "data": b64(ov("MARK_B"))},
    ],
}

out = sys.argv[1]
with open(out, "w") as f:
    json.dump(deck, f)
print(f"wrote {out}")
