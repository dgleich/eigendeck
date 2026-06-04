#!/usr/bin/env python3
# Generate eigendeck presentation JSONs (with embedded assets[]) for E2E:
# a notebook whose OVERLAY edits cell 0, so a correct overlay load shows the
# edited text. Two variants:
#   single -> one overlay asset (basic overlay-load test)
#   dup    -> TWO overlay assets for the same element: an empty one + the
#             edited one (reproduces the test-1 corruption; the heal must
#             pick the content-bearing one).
import base64, json, sys

EL = "nb-el-1"
IPYNB_ID = "ipynb-1"
MARKER = "EDITED_OVERLAY_MARKER"

ipynb = {
    "cells": [
        {"cell_type": "code", "source": ["k = 5\n"], "outputs": [],
         "execution_count": None, "metadata": {}},
    ],
    "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3"},
                 "language_info": {"name": "python"}},
    "nbformat": 4, "nbformat_minor": 5,
}

def b64(obj):
    return base64.b64encode(json.dumps(obj).encode()).decode()

def overlay(edit):
    return {"version": 1, "cellEdits": ({"0": edit} if edit else {}),
            "cellOutputs": {}, "cellCounts": {}, "appendedCells": []}

edited_src = f"k = 999  # {MARKER}"

def deck(mode):
    assets = [
        {"assetId": IPYNB_ID, "mime": "application/x-ipynb+json",
         "path": "nb.ipynb", "data": b64(ipynb)},
    ]
    OV = "application/x-eigendeck-overlay+json"
    if mode == "single":
        assets.append({"assetId": "ov-real", "mime": OV, "ownerElementId": EL,
                       "data": b64(overlay(edited_src))})
    else:  # dup: empty + real, same owner (the corruption)
        assets.append({"assetId": "ov-empty", "mime": OV, "ownerElementId": EL,
                       "data": b64(overlay(None))})
        assets.append({"assetId": "ov-real", "mime": OV, "ownerElementId": EL,
                       "data": b64(overlay(edited_src))})
    return {
        "title": f"OV {mode}", "theme": "white", "config": {},
        "slides": [{"id": "s1", "elements": [
            {"id": EL, "type": "notebook", "assetId": IPYNB_ID,
             "position": {"x": 60, "y": 60, "width": 1100, "height": 640}},
        ]}],
        "assets": assets,
    }

mode, out = sys.argv[1], sys.argv[2]
with open(out, "w") as f:
    json.dump(deck(mode), f)
print(f"wrote {out} ({mode})")
