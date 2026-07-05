#!/usr/bin/env python3
# Fixture for the notebook-output isolation e2e (docs/NOTEBOOK-ISOLATION.md).
# A notebook whose RECORDED outputs (baked into the .ipynb, no kernel needed)
# carry the attack + interactivity payloads:
#   - an INTERACTIVE text/html output (has <script>) → must mount in an
#     opaque-origin iframe; its script runs (proves interactivity) but must NOT
#     be able to read window.top.__TAURI_INTERNALS__ (proves containment).
#   - a STATIC text/html output (a table) → must render inline, sanitized.
#   - a MARKDOWN cell with <img onerror=…> → must be sanitized so the handler
#     never fires.
# The payloads self-report to the parent via postMessage({__nbprobe:1, …}); the
# probe (e2e/nb-security-probe.mjs) collects and asserts.
import base64, json, sys

EL = "nb-el-1"
IPYNB_ID = "ipynb-sec-1"

INTERACTIVE_HTML = (
    '<div id="nbx">plot</div><script>'
    'function rep(){'
    'var t;'
    'try{t=(window.top&&window.top.__TAURI_INTERNALS__)?"REACHED":"absent";}catch(e){t="blocked:"+e.name;}'
    'try{parent.postMessage({__nbprobe:1,ran:true,origin:(location.origin||"null"),tauri:t},"*");}catch(e){}'
    '}'
    'window.addEventListener("load",rep);[100,400,1000].forEach(function(ms){setTimeout(rep,ms);});'
    '</script>'
)
STATIC_HTML = '<table class="df"><tbody><tr><td>STATICMARK</td></tr></tbody></table>'
MD_SOURCE = '## MDTitle\n\n<img src=x onerror="parent.postMessage({__nbprobe:1,mdpwn:true},\'*\')">'

ipynb = {
    "cells": [
        {"cell_type": "code", "source": ["plot()\n"], "execution_count": 1, "metadata": {},
         "outputs": [
            {"output_type": "display_data", "data": {"text/html": [INTERACTIVE_HTML]}, "metadata": {}},
            {"output_type": "display_data", "data": {"text/html": [STATIC_HTML]}, "metadata": {}},
         ]},
        {"cell_type": "markdown", "source": [MD_SOURCE], "metadata": {}},
    ],
    "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3"},
                 "language_info": {"name": "python"}},
    "nbformat": 4, "nbformat_minor": 5,
}

def b64(obj):
    return base64.b64encode(json.dumps(obj).encode()).decode()

deck = {
    "title": "NB security", "theme": "white", "config": {},
    "slides": [{"id": "s1", "elements": [
        {"id": EL, "type": "notebook", "assetId": IPYNB_ID,
         "position": {"x": 40, "y": 40, "width": 1200, "height": 700}},
    ]}],
    "assets": [
        {"assetId": IPYNB_ID, "mime": "application/x-ipynb+json", "path": "nb.ipynb", "data": b64(ipynb)},
    ],
}

out = sys.argv[1]
with open(out, "w") as f:
    json.dump(deck, f)
print(f"wrote {out}")
