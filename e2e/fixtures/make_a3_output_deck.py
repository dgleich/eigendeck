#!/usr/bin/env python3
# a3 bug-hunt fixture: a notebook with STORED outputs of EVERY renderable kind,
# so CellOutput/MarkdownCell render WITHOUT a kernel. The deck theme is a CLI arg
# (white|dark|black) so a probe can assert computed output colors per theme.
#
#   python3 make_a3_output_deck.py <theme> <out.json>
import base64, json, sys

EL = "nb-el-1"
IPYNB_ID = "ipynb-1"

# Distinct text markers per output type so the probe can locate each element.
ipynb = {
    "cells": [
        {"cell_type": "markdown",
         "source": ["# MD_HEADING\n", "\n", "prose MD_BODY with `MD_INLINE_CODE` and\n",
                    "\n", "```python\nMD_FENCED_CODE = 1\n```\n"],
         "metadata": {}},
        {"cell_type": "code", "execution_count": 1, "metadata": {},
         "source": ["print('STDOUT_LINE')\n"],
         "outputs": [
             {"output_type": "stream", "name": "stdout", "text": ["STDOUT_LINE\n"]},
             {"output_type": "stream", "name": "stderr", "text": ["STDERR_LINE\n"]},
         ]},
        {"cell_type": "code", "execution_count": 2, "metadata": {},
         "source": ["x\n"],
         "outputs": [
             {"output_type": "execute_result", "execution_count": 2,
              "data": {"text/plain": ["TEXTPLAIN_VALUE"]}, "metadata": {}},
         ]},
        {"cell_type": "code", "execution_count": 3, "metadata": {},
         "source": ["df\n"],
         "outputs": [
             # Static (non-executable) HTML -> SanitizedBlock inline (pandas table).
             {"output_type": "execute_result", "execution_count": 3,
              "data": {"text/html": [
                  "<table border=\"1\" class=\"dataframe\">\n",
                  "<thead><tr><th>col</th></tr></thead>\n",
                  "<tbody><tr><td>PANDAS_CELL</td></tr></tbody>\n",
                  "</table>\n"]},
              "metadata": {}},
         ]},
        {"cell_type": "code", "execution_count": 4, "metadata": {},
         "source": ["raise ValueError('boom')\n"],
         "outputs": [
             {"output_type": "error", "ename": "ERR_NAME", "evalue": "ERR_VALUE",
              "traceback": ["Traceback (most recent call last):",
                            "  \x1b[0;31mERR_NAME\x1b[0m: TRACEBACK_LINE"]},
         ]},
        {"cell_type": "code", "execution_count": 5, "metadata": {},
         "source": ["svg\n"],
         "outputs": [
             {"output_type": "display_data", "metadata": {},
              "data": {"image/svg+xml": [
                  "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"40\" height=\"20\">",
                  "<text x=\"0\" y=\"15\">SVG_TEXT</text></svg>"]}},
         ]},
    ],
    "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3"},
                 "language_info": {"name": "python"}},
    "nbformat": 4, "nbformat_minor": 5,
}


def b64(obj):
    return base64.b64encode(json.dumps(obj).encode()).decode()


def deck(theme):
    return {
        "title": f"a3 outputs {theme}", "theme": theme, "config": {},
        "slides": [{"id": "s1", "theme": theme, "elements": [
            {"id": EL, "type": "notebook", "assetId": IPYNB_ID,
             "position": {"x": 40, "y": 40, "width": 1200, "height": 900}},
        ]}],
        "assets": [
            {"assetId": IPYNB_ID, "mime": "application/x-ipynb+json",
             "path": "nb.ipynb", "data": b64(ipynb)},
        ],
    }


theme, out = sys.argv[1], sys.argv[2]
with open(out, "w") as f:
    json.dump(deck(theme), f)
print(f"wrote {out} (theme={theme})")
