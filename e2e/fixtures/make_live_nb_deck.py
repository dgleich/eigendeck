#!/usr/bin/env python3
# Deck for nb-live-run-persist.mjs: ONE editable notebook on ONE external
# kernel, a single code cell `k = 5`. The probe edits the cell to print a
# computed marker, runs it live, then saves/reopens to assert persistence.
#
# Usage: make_live_nb_deck.py <out.json> [kernel_name] [display_name]
# Defaults to python3 so existing callers are unchanged; run-live-kernels.sh
# passes e.g. `ir "R"` to build the same deck for a different language. The
# initial cell is `k = 5` (valid in every language we test and only a
# placeholder — the probe replaces it before running).
import base64, json, sys

IPY = "application/x-ipynb+json"


def b64(o):
    return base64.b64encode(json.dumps(o).encode()).decode()


def code_cell(src):
    return {"cell_type": "code", "source": [src], "outputs": [],
            "execution_count": None, "metadata": {}}


def ipynb(cells, kname, kdisp):
    return {"cells": cells,
            "metadata": {"kernelspec": {"name": kname, "display_name": kdisp}},
            "nbformat": 4, "nbformat_minor": 5}


def deck(kname, kdisp):
    nb = ipynb([code_cell("k = 5\n")], kname, kdisp)
    return {
        "slides": [{
            "id": "s1",
            "elements": [{
                "id": "nb1", "type": "notebook", "assetId": "ipy",
                "position": {"x": 120, "y": 80, "width": 1200, "height": 700},
                "editable": True,
                "kernel": {"kind": "external", "kernelName": kname},
            }],
        }],
        "assets": [
            {"assetId": "ipy", "mime": IPY, "path": "nb.ipynb", "data": b64(nb)},
        ],
    }


if __name__ == "__main__":
    out = sys.argv[1]
    kname = sys.argv[2] if len(sys.argv) > 2 else "python3"
    kdisp = sys.argv[3] if len(sys.argv) > 3 else "Python 3"
    with open(out, "w") as f:
        json.dump(deck(kname, kdisp), f, indent=2)
    print(f"wrote {out} (kernel={kname})")
