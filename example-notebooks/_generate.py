#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Generate the example .ipynb files in this directory.

Notebooks are saved with NO outputs / null execution counts — they
look fresh when dropped on a slide so a presenter can click ▶ and
populate them live during a talk.

Re-run to regenerate after editing this script:
    uv run example-notebooks/_generate.py
"""

import json
import pathlib

HERE = pathlib.Path(__file__).parent


def code(*lines: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": _src(lines),
    }


def md(*lines: str) -> dict:
    return {
        "cell_type": "markdown",
        "metadata": {},
        "source": _src(lines),
    }


def _src(lines):
    """nbformat source is conventionally a list of strings (one per
    line); each entry except the last must include the trailing
    newline. We accept any iterable of strings (typically one big
    multi-line string)."""
    text = "\n".join(lines).rstrip() + "\n"
    parts = text.splitlines(keepends=True)
    return parts if parts else [""]


PY_META = {
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python", "version": "3.x"},
}


def write_nb(name: str, cells: list, meta: dict = PY_META) -> None:
    nb = {
        "cells": cells,
        "metadata": meta,
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    path = HERE / name
    path.write_text(json.dumps(nb, indent=1) + "\n")
    print(f"wrote {path}")


# ----------------------------------------------------------------- hello

write_nb("hello.ipynb", [
    md(
        "# Hello, eigendeck notebooks",
        "",
        "A minimal smoke test — markdown, a stdout print, and a numpy",
        "expression that returns a value the cell shows as output.",
    ),
    code(
        "print('hello from a slide')",
    ),
    code(
        "import sys",
        "sys.version_info",
    ),
    code(
        "import numpy as np",
        "np.linspace(0, 1, 5)",
    ),
])


# -------------------------------------------------- matrix powers (graph)

write_nb("matrix-powers.ipynb", [
    md(
        "# Adjacency matrix powers",
        "",
        "Powers of an adjacency matrix count walks of fixed length —",
        "`(A^k)[i, j]` is the number of length-`k` walks from `i` to `j`.",
        "Useful for reachability sketches and for motivating eigenvalue",
        "behavior in spectral methods.",
    ),
    code(
        "import numpy as np",
        "",
        "# Path graph on 4 vertices: 0 — 1 — 2 — 3",
        "A = np.array([",
        "    [0, 1, 0, 0],",
        "    [1, 0, 1, 0],",
        "    [0, 1, 0, 1],",
        "    [0, 0, 1, 0],",
        "])",
        "A",
    ),
    code(
        "A @ A   # walks of length 2",
    ),
    code(
        "A @ A @ A   # walks of length 3 — odd diagonal = bipartite signal",
    ),
    code(
        "# Largest eigenvalue: spectral radius, bounds power-iteration growth",
        "evals = np.linalg.eigvalsh(A)",
        "evals[::-1]",
    ),
])


# ----------------------------------------------------- power iteration

write_nb("power-iteration.ipynb", [
    md(
        "# Power iteration for the dominant eigenvector",
        "",
        "Classic numerical linear algebra. Repeatedly apply `A` to a",
        "random vector, normalize, and the iterates converge to the",
        "eigenvector of the largest-magnitude eigenvalue. The",
        "Rayleigh quotient `xᵀAx / xᵀx` converges to the eigenvalue.",
    ),
    code(
        "import numpy as np",
        "rng = np.random.default_rng(0)",
        "",
        "# Symmetric matrix → real eigenvalues, easy demo",
        "n = 50",
        "M = rng.standard_normal((n, n))",
        "A = (M + M.T) / 2",
    ),
    code(
        "def power_iter(A, steps=80):",
        "    x = rng.standard_normal(A.shape[0])",
        "    x /= np.linalg.norm(x)",
        "    rayleighs = []",
        "    for _ in range(steps):",
        "        y = A @ x",
        "        rayleighs.append(float(x @ y))",
        "        x = y / np.linalg.norm(y)",
        "    return x, rayleighs",
        "",
        "x_pi, rayleighs = power_iter(A)",
        "rayleighs[-5:]",
    ),
    code(
        "# Sanity check vs. exact",
        "evals, evecs = np.linalg.eigh(A)",
        "top = int(np.argmax(np.abs(evals)))",
        "print('exact dominant eigenvalue:', evals[top])",
        "print('|<exact eigenvector, power iterate>|:', abs(evecs[:, top] @ x_pi))",
    ),
    code(
        "# Convergence plot — uncomment after first run to see the figure",
        "# import matplotlib.pyplot as plt",
        "# plt.figure(figsize=(5, 2.5))",
        "# plt.plot(rayleighs); plt.axhline(evals[top], ls='--', color='red')",
        "# plt.xlabel('iteration'); plt.ylabel('Rayleigh quotient')",
        "# plt.title('Power iteration convergence'); plt.tight_layout(); plt.show()",
    ),
])


# ------------------------------------------------------------ PageRank

write_nb("pagerank.ipynb", [
    md(
        "# PageRank on a tiny graph",
        "",
        "Solve `π = α P π + (1 − α) v` by power iteration on the column-",
        "stochastic transition matrix `P`. The `α = 0.85` damping factor",
        "is the historical Google value.",
    ),
    code(
        "import numpy as np",
        "",
        "# 6-node directed graph — a couple of authorities + a sink",
        "edges = [",
        "    (0, 1), (0, 2),",
        "    (1, 2),",
        "    (2, 0),",
        "    (3, 0), (3, 1), (3, 2),",
        "    (4, 1), (4, 2),",
        "    (5, 4),",
        "]",
        "n = 6",
        "A = np.zeros((n, n))",
        "for i, j in edges:",
        "    A[j, i] = 1.0   # column-stochastic convention",
        "out_deg = A.sum(axis=0)",
        "P = A / np.where(out_deg > 0, out_deg, 1)",
        "P",
    ),
    code(
        "alpha = 0.85",
        "v = np.ones(n) / n",
        "pi = v.copy()",
        "for _ in range(50):",
        "    pi = alpha * (P @ pi) + (1 - alpha) * v",
        "print('PageRank:', np.round(pi, 4))",
        "print('rank order:', np.argsort(-pi))",
    ),
])


# --------------------------------------------- graph BFS (HPC-flavored)

write_nb("bfs-distance.ipynb", [
    md(
        "# BFS distance from a source",
        "",
        "Direction-optimizing BFS (the Graph500 backbone) is built on the",
        "frontier expansion shown here in its simplest form. Useful for",
        "talking about graph diameter and as a setup for the",
        "push/pull-frontier optimization.",
    ),
    code(
        "from collections import deque",
        "",
        "def bfs_distances(adj, source):",
        "    dist = {source: 0}",
        "    frontier = deque([source])",
        "    while frontier:",
        "        u = frontier.popleft()",
        "        for v in adj[u]:",
        "            if v not in dist:",
        "                dist[v] = dist[u] + 1",
        "                frontier.append(v)",
        "    return dist",
        "",
        "# Toy graph: cycle of 8 with a chord",
        "adj = {i: [(i - 1) % 8, (i + 1) % 8] for i in range(8)}",
        "adj[0].append(4); adj[4].append(0)",
        "",
        "bfs_distances(adj, 0)",
    ),
    code(
        "# Histogram of distances — the diameter is the max value",
        "from collections import Counter",
        "dist = bfs_distances(adj, 0)",
        "Counter(dist.values())",
    ),
])


# ----------------------------------------------------------------- end

print("done — open any .ipynb in JupyterLab to inspect")
