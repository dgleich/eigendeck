#!/usr/bin/env python3
# Deck for nb-live-run-persist.mjs: ONE editable notebook on ONE external
# python3 kernel, a single code cell `k = 5`. The probe edits the cell to print
# a computed marker, runs it live, then saves/reopens to assert persistence.
import base64, json, sys

IPY = "application/x-ipynb+json"


def b64(o):
    return base64.b64encode(json.dumps(o).encode()).decode()


def code_cell(src):
    return {"cell_type": "code", "source": [src], "outputs": [],
            "execution_count": None, "metadata": {}}


def ipynb(cells):
    return {"cells": cells,
            "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3"}},
            "nbformat": 4, "nbformat_minor": 5}


def deck():
    nb = ipynb([code_cell("k = 5\n")])
    return {
        "slides": [{
            "id": "s1",
            "elements": [{
                "id": "nb1", "type": "notebook", "assetId": "ipy",
                "position": {"x": 120, "y": 80, "width": 1200, "height": 700},
                "editable": True,
                "kernel": {"kind": "external", "kernelName": "python3"},
            }],
        }],
        "assets": [
            {"assetId": "ipy", "mime": IPY, "path": "nb.ipynb", "data": b64(nb)},
        ],
    }


if __name__ == "__main__":
    out = sys.argv[1]
    with open(out, "w") as f:
        json.dump(deck(), f, indent=2)
    print(f"wrote {out}")
