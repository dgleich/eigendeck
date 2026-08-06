#!/usr/bin/env python3
# Extra fixture decks for the gating e2e suite (run-all.sh). Each subcommand
# writes a presentation JSON (with embedded assets[]) to the given path; the
# run-all setup step then converts it to a SQLite .eigendeck via:
#     eigendeck-cli out.eigendeck import json this.json
#
# Subcommands:
#   shared   <out.json>   two notebooks on two slides SHARING one asset (INIT_VAL);
#                         for notebook-reload-shared-probe.mjs.
#   copypaste <out.json>  nb1 (MARK_A overlay) on slide 1, EMPTY slide 2;
#                         for copypaste-reload.mjs.
#   export   <out.json>   a notebook with markdown "Hello, eigendeck notebooks"
#                         and code "linspace"; for export-notebook-probe.mjs.
#   watch    <out.json>   nb1 bound to an EXTERNAL nb.ipynb (externalPath) showing
#                         INIT_VAL; for notebook-watch-takecontrol-probe.mjs.
#                         (The probe writes the on-disk nb.ipynb itself via E2E_NB.)
import base64, json, sys

OV = "application/x-eigendeck-overlay+json"
IPY = "application/x-ipynb+json"


def b64(o):
    return base64.b64encode(json.dumps(o).encode()).decode()


def ipynb(src_lines):
    return {
        "cells": [c for c in src_lines],
        "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3"},
                     "language_info": {"name": "python"}},
        "nbformat": 4, "nbformat_minor": 5,
    }


def code_cell(src):
    return {"cell_type": "code", "source": [src], "outputs": [],
            "execution_count": None, "metadata": {}}


def md_cell(src):
    return {"cell_type": "markdown", "source": [src], "metadata": {}}


def overlay(edit):
    return {"version": 1, "cellEdits": ({"0": edit} if edit else {}),
            "cellOutputs": {}, "cellCounts": {}, "appendedCells": []}


def nb_el(eid, asset, **extra):
    e = {"id": eid, "type": "notebook", "assetId": asset,
         "position": {"x": 60, "y": 60, "width": 1100, "height": 640}}
    e.update(extra)
    return e


def make_shared():
    # One shared ipynb asset (INIT_VAL), referenced by a notebook on each slide.
    nb = ipynb([code_cell("k = 'INIT_VAL'\n")])
    return {
        "title": "shared nb", "theme": "white", "config": {},
        "slides": [
            {"id": "s1", "elements": [nb_el("nbA", "ipy")]},
            {"id": "s2", "elements": [nb_el("nbB", "ipy")]},
        ],
        "assets": [
            {"assetId": "ipy", "mime": IPY, "path": "nb.ipynb",
             "externalPath": "nb.ipynb", "data": b64(nb)},
        ],
    }


def make_copypaste():
    # nb1 with a MARK_A overlay on slide 1; slide 2 empty.
    nb = ipynb([code_cell("k = 5\n")])
    return {
        "title": "copypaste", "theme": "white", "config": {},
        "slides": [
            {"id": "s1", "elements": [nb_el("nb1", "ipy1")]},
            {"id": "s2", "elements": []},
        ],
        "assets": [
            {"assetId": "ipy1", "mime": IPY, "path": "a.ipynb", "data": b64(nb)},
            {"assetId": "ovA", "mime": OV, "ownerElementId": "nb1",
             "data": b64(overlay("k = 999  # MARK_A"))},
        ],
    }


def make_export():
    # A notebook whose rendered HTML carries the markers export-notebook checks:
    # markdown "Hello, eigendeck notebooks" + code with "linspace".
    nb = ipynb([
        md_cell("# Hello, eigendeck notebooks\n"),
        code_cell("import numpy as np\nx = np.linspace(0, 1, 11)\n"),
    ])
    return {
        "title": "export nb", "theme": "white", "config": {},
        "slides": [{"id": "s1", "elements": [nb_el("nbx", "ipy")]}],
        "assets": [
            {"assetId": "ipy", "mime": IPY, "path": "hello.ipynb", "data": b64(nb)},
        ],
    }


def make_watch():
    # nb1 bound to an EXTERNAL nb.ipynb (auto-reload on), showing INIT_VAL.
    nb = ipynb([code_cell("k = 'INIT_VAL'\n")])
    return {
        "title": "watch nb", "theme": "white", "config": {},
        "slides": [{"id": "s1", "elements": [nb_el("nb1", "ipy")]}],
        "assets": [
            {"assetId": "ipy", "mime": IPY, "path": "nb.ipynb",
             "externalPath": "nb.ipynb", "data": b64(nb)},
        ],
    }


def make_solo():
    # ONE notebook (nb1, recording MARK_A) on ONE slide — for probes that
    # duplicate the slide themselves (resync-position, free-animate-reload).
    # The link-conflict deck has TWO slides, which breaks their slide-count math.
    nb = ipynb([code_cell("k = 5\n")])
    return {
        "title": "solo nb", "theme": "white", "config": {},
        "slides": [{"id": "s1", "elements": [nb_el("nb1", "ipy1")]}],
        "assets": [
            {"assetId": "ipy1", "mime": IPY, "path": "a.ipynb", "data": b64(nb)},
            {"assetId": "ovA", "mime": OV, "ownerElementId": "nb1",
             "data": b64(overlay("k = 999  # MARK_A"))},
        ],
    }


def make_empty():
    # A single-slide deck with NO elements — for editor probes that assert exact
    # slide[0] contents / slide counts and need a clean canvas.
    return {"title": "empty", "theme": "white", "config": {},
            "slides": [{"id": "s1", "elements": []}]}


def make_hyphenpiece():
    # Two demo-PIECE elements whose names contain hyphens (#44). The demo reads
    # `piece` from the hash and renders "<NAME> OK" only on an EXACT match — so if
    # a hyphenated name were truncated (the #44 bug, 'force-graph' -> 'force') the
    # matched branch wouldn't fire and the probe's text check fails.
    demo_html = (
        "<!DOCTYPE html><!--eigendeck-demo-v1--><html><head><meta charset=utf-8>"
        "<style>html,body{width:100%;height:100%;margin:0}"
        ".hp{font:bold 40px sans-serif;padding:20px}</style></head><body><script>\n"
        "/* BroadcastChannel marker — reads as a multi-piece demo */\n"
        "var piece = new URLSearchParams(location.hash.slice(1)).get('piece');\n"
        "var d = document.createElement('div'); d.className='hp';\n"
        "if (piece === 'force-graph') d.textContent = 'FORCE-GRAPH-OK';\n"
        "else if (piece === 'bar-chart-2') d.textContent = 'BAR-CHART-2-OK';\n"
        "else d.textContent = 'UNMATCHED piece=' + piece;\n"
        "document.body.appendChild(d);\n"
        "/* opaque origin: the parent can't read our body, so self-report the routed */\n"
        "/* piece — on load AND on request (a walking probe may miss the load report). */\n"
        "function rep(){try{window.parent.postMessage({__eigendeck:1,type:'piece-report',text:d.textContent},'*')}catch(e){}}\n"
        "rep();\n"
        "window.addEventListener('message',function(e){if(e.data&&e.data.__eigendeck===1&&e.data.type==='request-piece-report')rep()});\n"
        "</script></body></html>"
    )
    asset_id = "demohp"
    el = lambda eid, piece, y: {  # noqa: E731
        "id": eid, "type": "demo-piece", "piece": piece, "assetId": asset_id,
        "position": {"x": 40, "y": y, "width": 800, "height": 380},
    }
    return {
        "title": "hyphen pieces", "theme": "white", "config": {},
        "slides": [{"id": "s1", "elements": [
            el("p1", "force-graph", 40), el("p2", "bar-chart-2", 460),
        ]}],
        "assets": [{
            "assetId": asset_id, "mime": "text/html", "path": "demos/hyph.html",
            "data": base64.b64encode(demo_html.encode()).decode(),
        }],
    }


def make_printdemo():
    # #109 print-layer / demo-interference guard. One slide carrying all three
    # things the interactive HTML export puts LIVE (or iframe) content into, so a
    # probe can prove the print layer didn't break them:
    #   - a live `demo` (self-reports DEMO-RAN to the parent on boot) → the
    #     interactive screen-layer iframe must still run;
    #   - an `html` element → renders as a srcdoc <iframe> IN THE PRINT LAYER, the
    #     new iframe the export's global querySelectorAll('iframe') sweeps (font
    #     inject / BroadcastChannel relay) — the interference risk David flagged;
    #   - a `notebook` → baked to a print-layer screenshot (or placeholder).
    # The demo self-reports because its export iframe is sandboxed opaque-origin:
    # the parent can't read its DOM, so a browser-level functional check listens
    # for the postMessage instead.
    demo_html = (
        "<!DOCTYPE html><!--eigendeck-demo-v1--><html><head><meta charset=utf-8>"
        "<style>html,body{width:100%;height:100%;margin:0}"
        ".d{font:bold 32px sans-serif;padding:20px;color:#0a0}</style></head><body>"
        "<div class=d id=out>booting</div><script>\n"
        "var out=document.getElementById('out'); out.textContent='DEMO-RAN';\n"
        "function rep(){try{window.parent.postMessage("
        "{__eigendeck:1,type:'demo-report',text:'DEMO-RAN'},'*')}catch(e){}}\n"
        "rep();\n"
        "window.addEventListener('message',function(e){if(e.data&&e.data.__eigendeck===1"
        "&&e.data.type==='request-demo-report')rep()});\n"
        "</script></body></html>"
    )
    nb = ipynb([md_cell("# print demo notebook\n"), code_cell("x = 1\n")])
    return {
        "title": "print demo", "theme": "white", "config": {},
        "slides": [{"id": "s1", "elements": [
            {"id": "demo1", "type": "demo", "assetId": "dhtml",
             "position": {"x": 40, "y": 40, "width": 700, "height": 360}},
            {"id": "html1", "type": "html",
             "html": "<div style='font:bold 28px sans-serif;color:#036'>HTML-ELEMENT-MARKER</div>",
             "position": {"x": 40, "y": 440, "width": 500, "height": 180}},
            nb_el("nb1", "ipy", position={"x": 780, "y": 40, "width": 460, "height": 580}),
        ]}],
        "assets": [
            {"assetId": "dhtml", "mime": "text/html", "path": "demos/pd.html",
             "data": base64.b64encode(demo_html.encode()).decode()},
            {"assetId": "ipy", "mime": IPY, "path": "pd.ipynb", "data": b64(nb)},
        ],
    }


MAKERS = {
    "shared": make_shared,
    "copypaste": make_copypaste,
    "export": make_export,
    "watch": make_watch,
    "empty": make_empty,
    "solo": make_solo,
    "hyphenpiece": make_hyphenpiece,
    "printdemo": make_printdemo,
}

if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in MAKERS:
        print(f"usage: {sys.argv[0]} <{'|'.join(MAKERS)}> <out.json>", file=sys.stderr)
        sys.exit(2)
    which, out = sys.argv[1], sys.argv[2]
    with open(out, "w") as f:
        json.dump(MAKERS[which](), f)
    print(f"wrote {out} ({which})")
