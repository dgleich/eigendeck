#!/usr/bin/env python3
"""Precompute spectral layouts for directed graph demo."""

import json, os, glob, sys
import numpy as np
from scipy import sparse
from scipy.sparse.linalg import eigsh

GRAPHS_DIR = os.path.join(os.path.dirname(__file__), '..', 'graphs')
OUTPUT = os.path.join(os.path.dirname(__file__), 'directed_layouts_data.json')

W, H = 800, 600
MARGIN = 60

def load_graph(path):
    with open(path) as f:
        data = json.load(f)
    if 'nodes' not in data or 'edges' not in data:
        return None
    nodes = data['nodes']
    edges = data['edges']
    n = len(nodes)
    id_to_idx = {node['id']: i for i, node in enumerate(nodes)}
    G = np.zeros((n, n))
    for e in edges:
        si, ti = id_to_idx.get(e['source']), id_to_idx.get(e['target'])
        if si is not None and ti is not None:
            w = abs(e.get('weight', 1))  # use abs for signed graphs
            G[si, ti] += w
    return data, nodes, edges, G, id_to_idx

def normalize(x, y):
    xmin, xmax = x.min(), x.max()
    ymin, ymax = y.min(), y.max()
    if xmax - xmin < 1e-12: xmax = xmin + 1
    if ymax - ymin < 1e-12: ymax = ymin + 1
    xs = MARGIN + (x - xmin) / (xmax - xmin) * (W - 2*MARGIN)
    ys = MARGIN + (y - ymin) / (ymax - ymin) * (H - 2*MARGIN)
    return [[round(float(xs[i]), 1), round(float(ys[i]), 1)] for i in range(len(x))]

def procrustes_align(target_coords, source_coords):
    """Align source_coords to target_coords using orthogonal Procrustes.
    Both are lists of [x,y]. Returns new list of [x,y] for source, re-normalized.
    Solves: min_Q ||X - Y Q||_F where Q is orthogonal (rotation/reflection)."""
    X = np.array(target_coords)  # n x 2
    Y = np.array(source_coords)  # n x 2

    # Center both
    mx, my = X.mean(axis=0), Y.mean(axis=0)
    Xc = X - mx
    Yc = Y - my

    # SVD of X^T Y
    M = Xc.T @ Yc  # 2x2
    U, S, Vt = np.linalg.svd(M)

    # Optimal rotation (allow reflection to minimize distance)
    Q = Vt.T @ U.T  # 2x2

    # Apply rotation to centered Y, then shift to target center
    Yrot = Yc @ Q + mx

    # Re-normalize to fit in view
    x, y = Yrot[:, 0], Yrot[:, 1]
    return normalize(x, y)

# Layout ordering for Procrustes chaining
LAYOUT_ORDER = [
    'original', 'drop_direction', 'symmetrize', 'svd', 'random_walk',
    'chung', 'benson_fft', 'benson_bidir', 'guo_mohar',
] + [f'magnetic_{i*0.05:.2f}' for i in range(11)]

def sym_spectral(A_sym, n):
    """Spectral coords from symmetric adjacency matrix using Laplacian."""
    d = A_sym.sum(axis=1)
    d = np.maximum(d, 1e-10)
    L = np.diag(d) - A_sym
    try:
        vals, vecs = np.linalg.eigh(L)
        idx = np.argsort(vals)
        # Find first non-trivial eigenvector
        start = 0
        while start < n - 2 and vals[idx[start]] < 1e-8:
            start += 1
        if start >= n - 1:
            start = 1
        x = vecs[:, idx[start]]
        y = vecs[:, idx[min(start + 1, n - 1)]]
        return normalize(x, y)
    except Exception as e:
        print(f"  sym_spectral failed: {e}")
        return None

def hermitian_spectral(H_mat, n):
    """Spectral coords from Hermitian matrix using Laplacian.
    Uses real and imaginary parts of the Fiedler eigenvector."""
    d = np.abs(H_mat).sum(axis=1).real
    d = np.maximum(d, 1e-10)
    L = np.diag(d) - H_mat
    try:
        vals, vecs = np.linalg.eigh(L)
        idx = np.argsort(vals.real)
        start = 0
        while start < n - 2 and vals[idx[start]].real < 1e-8:
            start += 1
        if start >= n - 1:
            start = 1
        v = vecs[:, idx[start]]
        x = v.real
        y = v.imag
        # If imaginary part is near zero, use next eigenvector
        if np.max(np.abs(y)) < 1e-8:
            v2 = vecs[:, idx[min(start + 1, n - 1)]]
            y = v2.real if np.max(np.abs(v2.imag)) < 1e-8 else v2.imag
        return normalize(x, y)
    except Exception as e:
        print(f"  hermitian_spectral failed: {e}")
        return None

# ─── Layout methods ──────────────────────────────────

def layout_original(nodes, n):
    """Use the x,y from the graph file."""
    x = np.array([node.get('x', 0) for node in nodes])
    y = np.array([node.get('y', 0) for node in nodes])
    return normalize(x, y)

def layout_drop_direction(G, n):
    """A = max(G, G^T)"""
    A = np.maximum(G, G.T)
    return sym_spectral(A, n)

def layout_symmetrize(G, n):
    """A = G + G^T"""
    A = G + G.T
    return sym_spectral(A, n)

def layout_svd(G, n):
    """Bipartite doubling: B = [[0, G], [G^T, 0]]"""
    B = np.zeros((2*n, 2*n))
    B[:n, n:] = G
    B[n:, :n] = G.T
    coords = sym_spectral(B, 2*n)
    if coords is None:
        return None
    # Take first n coordinates (the "left" nodes)
    x = np.array([c[0] for c in coords[:n]])
    y = np.array([c[1] for c in coords[:n]])
    return normalize(x, y)

def layout_random_walk(G, n):
    """A = G D^{-1} — use eigenvectors of (P+P^T)/2 as an approximation."""
    d_out = G.sum(axis=1)
    d_out = np.maximum(d_out, 1e-10)
    P = G / d_out[:, np.newaxis]
    # Symmetrize for spectral: (P + P^T) / 2
    A_sym = (P + P.T) / 2
    return sym_spectral(A_sym, n)

def layout_chung(G, n):
    """Chung's directed Laplacian using stationary distribution."""
    d_out = G.sum(axis=1)
    d_out_safe = np.maximum(d_out, 1e-10)
    P = G / d_out_safe[:, np.newaxis]

    # Compute stationary distribution via power iteration
    pi = np.ones(n) / n
    for _ in range(500):
        pi_new = pi @ P
        norm = pi_new.sum()
        if norm > 0:
            pi_new /= norm
        if np.max(np.abs(pi_new - pi)) < 1e-12:
            break
        pi = pi_new
    pi = np.maximum(pi, 1e-12)

    # A_chung = (diag(pi) P + P^T diag(pi)) / 2
    Pi = np.diag(pi)
    A_chung = (Pi @ P + P.T @ Pi) / 2
    return sym_spectral(A_chung, n)

def layout_benson_fft(G, n):
    """Benson/Gleich/Leskovec: feed-forward triangle motif a→b, b→c, a→c.
    Build weighted clique projection."""
    W = np.zeros((n, n))
    count = 0
    for a in range(n):
        for b in range(n):
            if a == b or G[a, b] == 0:
                continue
            for c in range(n):
                if c == a or c == b:
                    continue
                if G[b, c] > 0 and G[a, c] > 0:
                    # Feed-forward triangle found
                    W[a, b] += 1; W[b, a] += 1
                    W[a, c] += 1; W[c, a] += 1
                    W[b, c] += 1; W[c, b] += 1
                    count += 1
    print(f"    feed-forward triangles: {count}")
    if count == 0:
        return None
    return sym_spectral(W, n)

def layout_benson_bidir(G, n):
    """Benson: bidirectional-source motif: a↔b, a→c, b→c."""
    W = np.zeros((n, n))
    count = 0
    for a in range(n):
        for b in range(n):
            if a == b:
                continue
            if G[a, b] == 0 or G[b, a] == 0:
                continue  # need a↔b
            for c in range(n):
                if c == a or c == b:
                    continue
                if G[a, c] > 0 and G[b, c] > 0:
                    W[a, b] += 1; W[b, a] += 1
                    W[a, c] += 1; W[c, a] += 1
                    W[b, c] += 1; W[c, b] += 1
                    count += 1
    print(f"    bidir-source motifs: {count}")
    if count == 0:
        return None
    return sym_spectral(W, n)

def layout_guo_mohar(G, n):
    """Guo & Mohar: H[u,v] = 1 if bidirectional, i if u→v only, -i if v→u only."""
    H = np.zeros((n, n), dtype=complex)
    for u in range(n):
        for v in range(n):
            if u == v:
                continue
            fwd = G[u, v] > 0
            bwd = G[v, u] > 0
            if fwd and bwd:
                H[u, v] = 1.0
            elif fwd:
                H[u, v] = 1j
            elif bwd:
                H[u, v] = -1j
    return hermitian_spectral(H, n)

def layout_magnetic(G, n, q):
    """Magnetic: H_q = omega * G + conj(omega) * G^T where omega = e^{i*2*pi*q}."""
    omega = np.exp(2j * np.pi * q)
    omega_bar = np.conj(omega)
    # For weighted graphs, use the weights
    H = omega * G + omega_bar * G.T
    return hermitian_spectral(H, n)

# ─── Main ────────────────────────────────────────────

def compute_all(graph_path):
    result = load_graph(graph_path)
    if result is None:
        return None
    data, nodes, edges, G, id_to_idx = result
    n = len(nodes)
    name = os.path.splitext(os.path.basename(graph_path))[0]
    print(f"\n{name} ({n} nodes, {len(edges)} edges)")

    layouts = {}

    # Original layout from file
    print("  original")
    layouts['original'] = layout_original(nodes, n)

    # Drop direction
    print("  drop_direction")
    layouts['drop_direction'] = layout_drop_direction(G, n)

    # Symmetrize
    print("  symmetrize")
    layouts['symmetrize'] = layout_symmetrize(G, n)

    # SVD bipartite
    if n <= 500:  # skip for very large graphs
        print("  svd")
        layouts['svd'] = layout_svd(G, n)

    # Random walk
    print("  random_walk")
    layouts['random_walk'] = layout_random_walk(G, n)

    # Chung
    print("  chung")
    layouts['chung'] = layout_chung(G, n)

    # Benson - feed-forward triangle
    if n <= 300:
        print("  benson_fft")
        layouts['benson_fft'] = layout_benson_fft(G, n)

    # Benson - bidir source
    if n <= 300:
        print("  benson_bidir")
        layouts['benson_bidir'] = layout_benson_bidir(G, n)

    # Guo-Mohar
    print("  guo_mohar")
    layouts['guo_mohar'] = layout_guo_mohar(G, n)

    # Magnetic at various q
    q_values = [round(i * 0.05, 2) for i in range(11)]  # 0.0, 0.05, ..., 0.50
    for q in q_values:
        key = f"magnetic_{q:.2f}"
        print(f"  {key}")
        layouts[key] = layout_magnetic(G, n, q)

    # ─── Procrustes alignment ────────────────────────
    # Chain through layouts: align each to its predecessor in LAYOUT_ORDER.
    # Use 'original' as the anchor (first in chain).
    print("  procrustes alignment...")
    order = [k for k in LAYOUT_ORDER if k in layouts]
    if len(order) >= 2:
        for i in range(1, len(order)):
            prev_key = order[i - 1]
            cur_key = order[i]
            layouts[cur_key] = procrustes_align(layouts[prev_key], layouts[cur_key])

    # Build compact node list
    node_list = []
    for node in nodes:
        entry = {'id': node['id'], 'label': node.get('label', str(node['id']))}
        if 'faction' in node:
            entry['group'] = node['faction']
        if 'org' in node:
            entry['group'] = node['org']
        node_list.append(entry)

    # Build edge list with indices
    edge_list = []
    for e in edges:
        si = id_to_idx.get(e['source'])
        ti = id_to_idx.get(e['target'])
        if si is not None and ti is not None:
            edge_list.append([si, ti])

    return {
        'name': name,
        'description': data.get('description', ''),
        'n': n,
        'nodes': node_list,
        'edges': edge_list,
        'layouts': {k: v for k, v in layouts.items() if v is not None}
    }

HTML_TEMPLATE = os.path.join(os.path.dirname(__file__), 'directed_layouts.html')
PLACEHOLDER = '/*__LAYOUT_DATA_PLACEHOLDER__*/'
# Also match previously injected data (DATA = {...};\nDATA_LOADED = true;)
import re
DATA_INJECTED_RE = re.compile(r'DATA = \{.*?\};\nDATA_LOADED = true;', re.DOTALL)

def main():
    results = {}
    graph_dir = os.path.abspath(GRAPHS_DIR)
    for path in sorted(glob.glob(os.path.join(graph_dir, '*.json'))):
        name = os.path.splitext(os.path.basename(path))[0]
        if name == 'fauci-email-data':
            continue  # not a graph file
        r = compute_all(path)
        if r:
            results[name] = r

    # Write standalone JSON
    out_path = os.path.abspath(OUTPUT)
    with open(out_path, 'w') as f:
        json.dump(results, f)
    print(f"\nWrote {out_path} ({os.path.getsize(out_path)} bytes)")

    # Embed data into HTML
    html_path = os.path.abspath(HTML_TEMPLATE)
    with open(html_path) as f:
        html = f.read()
    data_js = 'DATA = ' + json.dumps(results) + ';\nDATA_LOADED = true;'
    if PLACEHOLDER in html:
        html = html.replace(PLACEHOLDER, data_js)
    elif DATA_INJECTED_RE.search(html):
        html = DATA_INJECTED_RE.sub(data_js, html)
    else:
        print("WARNING: could not find injection point in HTML")
        return
    with open(html_path, 'w') as f:
        f.write(html)
    print(f"Embedded data into {html_path} ({os.path.getsize(html_path)} bytes)")

if __name__ == "__main__":
    main()
