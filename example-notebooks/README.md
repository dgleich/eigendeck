# Example notebooks

Sample `.ipynb` files for testing the notebook element. Drop any of
them onto a slide via Finder drag-drop or the `+ Notebook` toolbar
button, then click ▶ on a code cell to run it live.

All notebooks save with NO outputs / null execution counts — fresh
state, so the presenter populates them live during a talk.

| File | What it shows | Run-it dependencies |
|---|---|---|
| `hello.ipynb` | print, sys.version_info, np.linspace | numpy |
| `matrix-powers.ipynb` | Adjacency matrix powers + spectral radius | numpy |
| `power-iteration.ipynb` | Dominant-eigenvector via power iteration; convergence plot (commented out by default — uncomment after first run) | numpy, matplotlib |
| `pagerank.ipynb` | Damped PageRank on a 6-node graph via power iteration | numpy |
| `bfs-distance.ipynb` | BFS distance from a source on a tiny graph | (stdlib only) |
| `eigenvalue-spectrum.ipynb` | Spectrum of a random symmetric matrix + Wigner semicircle overlay (matplotlib `plt.show()` output) | numpy, matplotlib |

## Regenerating

`_generate.py` is the source-of-truth — edit it and re-run to refresh
the `.ipynb` files:

```
uv run example-notebooks/_generate.py
```

`uv` handles the inline-deps header in the script (no manual venv).
The script itself has no third-party deps; the *notebook code* needs
numpy / matplotlib at run time, which the user's local Jupyter
kernel provides.

## Why no pre-baked outputs?

If an .ipynb ships with cached outputs, the eigendeck renderer
shows them before the user has clicked Run. That's fine for some
flows, but the demo value here is "watch a cell execute live in the
slide" — pre-baked outputs hide what's happening. Leaving outputs
empty makes the first ▶ click visually meaningful.
