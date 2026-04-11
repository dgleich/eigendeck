# Demo Style Guide

Reference for building interactive HTML demos for eigendeck presentations. Distilled from corrections and choices during the magnetic-powers talk build.

## Fonts

- **Font family**: `'PT Sans', Arial, sans-serif` — always PT Sans. Use `'PT Sans Narrow'` for dense tables.
- **No bold by default** on tabular data (asked to drop bold after trying it).
- **Unicode superscripts** for math in labels: `ω² ω³ ω⁴` — NOT `omega^2` or `omega4`.

### Font sizes — bigger than you think

The repeated feedback was "bigger, even bigger". Demos render inside slide pieces that get scaled/moved, so err large. Starting points:

| Element | Size |
|---|---|
| Matrix cells / primary data | 30–44 px |
| Section headers / labels | 24–28 px |
| Control labels | 24–26 px bold |
| Value displays (sliders) | 22–24 px |
| Pills / buttons | 22–26 px |
| Walks list / graph nodes (data) | 22–26 px |
| Description text | 18–22 px |
| Tick labels on plots | 16–20 px |

The dataset table went through: 22 → 26 → 30 → 36 → **44 px** before it was big enough. The matrix in walk_profiles_matrix went 24 → **32 px**.

## Layout and structure

- **Clean visual pieces**: never embed sliders, dropdowns, or checkboxes in a visualization piece. Controls go in a **separate `controls` piece** so the visual piece stays clean when scaled/placed on a slide.
- **Always have a controls piece** if there's interactivity — graph selector, sliders, checkboxes, toggles all go there.
- **Pieces communicate via BroadcastChannel** following the controller/viewport pattern in `DEMO_AUTHORING.md`.
- **Multi-panel demos** (motif projection, harper electron): controller computes shared state once; each panel piece renders its own view of the same data.

## Colors and background

- **White background** always (`#fff`). Slides are white.
- **Per-demo color palettes** — not enforced globally — but favor:
  - Light gray `#cbd5e1` / `#94a3b8` for non-highlighted structure
  - Indigo/purple `#6366f1` / `#4f46e5` for primary highlight
  - Cyan `#0891b2` for secondary highlight
  - Red `#dc2626` / pink `#e11d48` for field/inverse direction
  - Orange `#f97316` for target/destination
  - Node fills: `#475569` dark slate, with white stroke
- **Diverging colormap for signed errors**: PuOr (purple ↔ orange, white at zero). Used in walk compressibility heatmap.

## Graph drawing

- **SVG `<defs><marker>` for arrowheads**, NOT custom polygons. Pattern:
  ```js
  svg.append('defs').append('marker')
     .attr('id','arrow').attr('viewBox','0 0 10 10')
     .attr('refX',18).attr('refY',5)  // refX pulls tip back from node edge
     .attr('markerWidth',6).attr('markerHeight',6).attr('orient','auto')
     .append('path').attr('d','M0 0L10 5L0 10z');
  ```
  Then `line.attr('marker-end','url(#arrow)')`. Match this across demos.
- **Force-directed layout** via D3 as the default. Seeded for reproducibility.
- **Same node layout across multi-panel views** — compute layout once in controller, share via broadcast.
- **Procrustes alignment** between precomputed layouts (orthogonal rotation + scale + center) so switching layouts animates smoothly with minimal jumps. `scipy` on the Python side, then `d3.transition().duration(600)` on the JS side.
- **Light gray non-highlighted edges**, bold primary-color highlighted edges.
- **Node highlights adjust to current selection** (not sticky). E.g., in walk_profiles_matrix, the source/target nodes on the graph highlight based on the selected matrix cell, not based on node clicks. The highlight style matches the walks-list node borders (light fill, colored stroke).

## Labels

- **Labels on hover always**: every node has a hover handler that shows a label above it with white stroke. Works even when persistent labels are off.
- **Checkbox for persistent labels**: off by default for graphs where labels are long (e.g., Fauci names). Goes in the controls piece.
- Persistent labels can be drawn inside node circles (white text) or outside (dark text) depending on node size.

## Plots and error metrics

- **Log scale** for error/decay plots (`plt.yscale('log')` in Python, canvas manual log in JS).
- **Y-axis label placement**: rotate -90°, position with `textAlign='center'` and `textBaseline='middle'`.
- **Plot padding**: tight bottom padding has to still leave room for the axis label. I kept getting caught by:
  - `textBaseline='top'` + text near `H-10` → text bleeds off canvas. Use `textBaseline='bottom'` near `H-4` instead.
  - Canvas internal resolution via `getBoundingClientRect() * dpr` for retina.
- **Error metric for walk compressibility**: per-pair relative L2, averaged over non-zero pairs:
  ```
  rel_err(i,j) = ||phi_ij - phi_hat_ij||_2 / ||phi_ij||_2
  error(Q) = mean over (i,j) with ||phi_ij|| > 0
  ```
  This mirrors the reference paper (`Graph-COM/Walk_Profiles/main_inverse.py`). Drops cleanly across many orders of magnitude on log scale.

## Heatmap rendering

- **Canvas with `image-rendering: pixelated`** and internal resolution equal to matrix size.
- **Dynamic sizing via `ResizeObserver`**: wrap canvas in a flex container, compute the largest square that fits, set `canvas.style.width/height` explicitly. Don't rely on pure CSS — canvas sizing is fiddly.
- **Reorder by degree** (descending) when displaying error matrices — reveals block structure the user cares about. Applied symmetrically to rows and columns.

## Interactive controls

- **Checkboxes**: 18–22 px boxes, accent-color matches theme.
- **Pill selectors** for small discrete choices (m, k, motif type): circle/rounded rect with clear selected state.
- **Dropdowns** for graph selection: large font, `padding:8px 12px`, rounded border.
- **Sliders**: `height:8px`, themed `accent-color`. Always show current value next to the slider.

## Data and files

- **Embed data directly in HTML** — the demos run from `file://` so `fetch()` doesn't work. Use a Python build script with a placeholder comment (`/*__GRAPH_DATA_PLACEHOLDER__*/`) and regex to re-inject when data changes.
- **Build scripts** (`build_compressibility.py`, `precompute_layouts.py`) handle both initial injection and re-injection. Keep them idempotent.
- **Reproducibility**: seeded random graphs (LCG in JS, `np.random.seed` + `random.seed` in Python).

## Naming

- Demo files in `demos/`, named with `_` separator, no `demo_` prefix:
  - `harper_electron.html`, `walk_profiles_matrix.html`, `directed_layouts.html`, `walk_compressibility.html`, `motif_projection.html`, `dataset_table.html`.
- Python build scripts alongside the HTML they build.

## Python environment

- Use `uv` to manage venvs: `uv venv .venv && uv pip install --python .venv/bin/python numpy scipy`.
- Run scripts as `.venv/bin/python demos/…`. Don't rely on system Python.

## Things to watch for

These all came up as corrections during the build:

- **Plot cutoff**: bottom axis label gets clipped if padding is too tight. Check with the piece shrunk to its final slide size.
- **Heatmap too small**: default canvas sizing defaults to internal pixel size (e.g., 50×50). Always use JS to size the displayed canvas.
- **Controls clutter**: if a visual piece has controls on it, move them to a separate controls piece.
- **Label spam on large graphs**: hide persistent labels for n > ~40 by default; hover still works.
- **Sticky highlights**: if the graph panel highlights nodes permanently, the user will mistake it for "nodes 1 and 4 are special". Make highlights reactive to the current selection.
- **Isometric/perspective rendering**: Canvas 2D `setTransform` is only affine (parallelogram), not perspective (trapezoid). For isometric probability heatmaps, render cell-by-cell as isometric quads — don't try to `drawImage` with a perspective transform.
- **Expensive computations**: exclude graphs that take too long (e.g., celegans for walk profiles). Gate the dropdown by size (`n <= 200`).

## Math conventions

- Walk profile reconstruction uses `q_j = j/(2(m+1))` for `j = 0 .. ceil(m/2)`. That's `ceil(m/2)+1` unique frequencies (16 for m=30) — enough for exact recovery of the m+1 real walk profile matrices.
- `ω(q) = exp(2πi q)`. The "magnetic adjacency" uses `A_q = ωA + ω̄A^T`.
- Walk profile recurrence: `Φ(m,k) = Φ(m-1,k-1)·P + Φ(m-1,k)·Pᵀ` where `P = D⁻¹A` for the random-walk normalized version.
- Truncated reconstruction kernel (the one I got wrong initially): `P_Q(k,l) = (1/(m+1))[1 + 2·Σ_{j=1}^{Q-1} cos(2πj(k-l)/(m+1))]`. Note **`d = k - l`** (Dirichlet kernel), not `d = m - k - l`. The wrong index gave the anti-identity instead of the identity at full Q.
