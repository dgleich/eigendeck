#!/usr/bin/env python3
"""Mutate a .ipynb on disk — to test Eigendeck's file-watching / auto-reload.

Each run makes a real byte change (so the hash differs and the watcher
actually reloads, not just an mtime touch). By default it bumps a
`MUTATION = N` counter line at the top of the first code cell, so you can
see the reload land and the value tick up.

  python3 tools/mutate_notebook.py deck-assets/demo.ipynb
  python3 tools/mutate_notebook.py demo.ipynb --cell 2 --set "k = 10"
  python3 tools/mutate_notebook.py demo.ipynb --append "print('hi')"
  python3 tools/mutate_notebook.py demo.ipynb --add-cell "import numpy as np"
  python3 tools/mutate_notebook.py demo.ipynb --loop 3        # every 3s, Ctrl-C to stop
  python3 tools/mutate_notebook.py --new demo.ipynb           # create a starter notebook

Notebook to watch must be LINKED to this file on disk (created/inserted
from the file, so it has an external_path) and READ-ONLY with auto-reload
on. Editable notebooks intentionally disable watching — toggle editing off
(or use the global default) to test reloads.
"""
import argparse, datetime, json, sys, time

def load(path):
    with open(path) as f:
        return json.load(f)

def save(path, nb):
    with open(path, "w") as f:
        json.dump(nb, f, indent=1)
        f.write("\n")

def as_lines(text):
    # nbformat stores source as a list of lines (each keeping its newline).
    lines = text.splitlines(keepends=True)
    return lines or [""]

def code_cells(nb):
    return [c for c in nb.get("cells", []) if c.get("cell_type") == "code"]

def first_or_index(nb, idx):
    cells = nb.get("cells", [])
    if idx is not None:
        if idx < 0 or idx >= len(cells):
            sys.exit(f"cell {idx} out of range (0..{len(cells)-1})")
        return cells[idx]
    cc = code_cells(nb)
    if not cc:
        sys.exit("no code cells; use --add-cell or --new")
    return cc[0]

def src_text(cell):
    s = cell.get("source", "")
    return "".join(s) if isinstance(s, list) else s

def bump_counter(cell):
    text = src_text(cell)
    n = 0
    out = []
    found = False
    for line in text.splitlines():
        if line.startswith("MUTATION ="):
            try: n = int(line.split("=", 1)[1].strip()) + 1
            except ValueError: n = 1
            out.append(f"MUTATION = {n}")
            found = True
        else:
            out.append(line)
    if not found:
        out.insert(0, "MUTATION = 1"); n = 1
    cell["source"] = as_lines("\n".join(out))
    return n

def starter_notebook():
    return {
        "cells": [
            {"cell_type": "markdown", "source": ["# Watch test\n"], "metadata": {}},
            {"cell_type": "code", "source": ["MUTATION = 0\n", "print('hello')\n"],
             "outputs": [], "execution_count": None, "metadata": {}},
        ],
        "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3"},
                     "language_info": {"name": "python"}},
        "nbformat": 4, "nbformat_minor": 5,
    }

def mutate(path, args):
    nb = load(path)
    if args.add_cell is not None:
        nb.setdefault("cells", []).append({
            "cell_type": "code", "source": as_lines(args.add_cell),
            "outputs": [], "execution_count": None, "metadata": {}})
        desc = f"added code cell ({len(nb['cells'])-1})"
    else:
        cell = first_or_index(nb, args.cell)
        if args.set is not None:
            cell["source"] = as_lines(args.set); desc = "set source"
        elif args.append is not None:
            cell["source"] = as_lines(src_text(cell).rstrip("\n") + "\n" + args.append)
            desc = "appended line"
        else:
            n = bump_counter(cell); desc = f"MUTATION = {n}"
    save(path, nb)
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {path}: {desc}")

def main():
    ap = argparse.ArgumentParser(description="Mutate a .ipynb to test file-watching.")
    ap.add_argument("path")
    ap.add_argument("--new", action="store_true", help="create a starter notebook at PATH")
    ap.add_argument("--cell", type=int, help="target cell index (default: first code cell)")
    ap.add_argument("--set", help="replace the cell's source with this text")
    ap.add_argument("--append", help="append this as a new line to the cell")
    ap.add_argument("--add-cell", dest="add_cell", help="append a new code cell with this source")
    ap.add_argument("--loop", type=float, metavar="SECONDS", help="mutate repeatedly every SECONDS")
    args = ap.parse_args()

    if args.new:
        save(args.path, starter_notebook())
        print(f"created {args.path}")
        return
    if args.loop:
        print(f"mutating {args.path} every {args.loop}s — Ctrl-C to stop")
        try:
            while True:
                mutate(args.path, args); time.sleep(args.loop)
        except KeyboardInterrupt:
            print("\nstopped")
    else:
        mutate(args.path, args)

if __name__ == "__main__":
    main()
