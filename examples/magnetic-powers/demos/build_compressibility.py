#!/usr/bin/env python3
"""Extract graph edge lists and embed into compressibility demo HTML."""
import json, os, glob, re

GRAPHS_DIR = os.path.join(os.path.dirname(__file__), '..', 'graphs')
HTML_FILES = [
    os.path.join(os.path.dirname(__file__), 'walk_compressibility.html'),
    os.path.join(os.path.dirname(__file__), 'motif_projection.html'),
]
PLACEHOLDER = '/*__GRAPH_DATA_PLACEHOLDER__*/'
DATA_RE = re.compile(r'GRAPH_DB = \{.*?\};\nGRAPH_DB_LOADED = true;', re.DOTALL)

def main():
    graphs = {}
    for path in sorted(glob.glob(os.path.join(os.path.abspath(GRAPHS_DIR), '*.json'))):
        name = os.path.splitext(os.path.basename(path))[0]
        if name == 'fauci-email-data':
            continue
        with open(path) as f:
            data = json.load(f)
        if 'nodes' not in data or 'edges' not in data:
            continue
        nodes = data['nodes']
        n = len(nodes)
        id_to_idx = {node['id']: i for i, node in enumerate(nodes)}
        labels = [node.get('label', str(node['id'])) for node in nodes]
        edges = []
        for e in data['edges']:
            si = id_to_idx.get(e['source'])
            ti = id_to_idx.get(e['target'])
            if si is not None and ti is not None:
                edges.append([si, ti])
        graphs[name] = {'n': n, 'edges': edges, 'labels': labels, 'desc': data.get('description', '')}
        print(f"  {name}: {n} nodes, {len(edges)} edges")

    data_js = 'GRAPH_DB = ' + json.dumps(graphs) + ';\nGRAPH_DB_LOADED = true;'

    for html_file in HTML_FILES:
        if not os.path.exists(html_file):
            print(f"  skipping (not found): {html_file}")
            continue
        with open(html_file) as f:
            html = f.read()
        if PLACEHOLDER in html:
            html = html.replace(PLACEHOLDER, data_js)
        elif DATA_RE.search(html):
            html = DATA_RE.sub(data_js, html)
        else:
            print(f"  WARNING: no injection point in {html_file}")
            continue
        with open(html_file, 'w') as f:
            f.write(html)
        print(f"  wrote {html_file} ({os.path.getsize(html_file)} bytes)")

if __name__ == '__main__':
    main()
