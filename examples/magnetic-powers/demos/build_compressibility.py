#!/usr/bin/env python3
"""Extract graph edge lists and embed into compressibility demo HTML."""
import json, os, glob, re

GRAPHS_DIR = os.path.join(os.path.dirname(__file__), '..', 'graphs')
HTML_FILE = os.path.join(os.path.dirname(__file__), 'walk_compressibility.html')
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
        edges = []
        for e in data['edges']:
            si = id_to_idx.get(e['source'])
            ti = id_to_idx.get(e['target'])
            if si is not None and ti is not None:
                edges.append([si, ti])
        graphs[name] = {'n': n, 'edges': edges, 'desc': data.get('description', '')}
        print(f"  {name}: {n} nodes, {len(edges)} edges")

    data_js = 'GRAPH_DB = ' + json.dumps(graphs) + ';\nGRAPH_DB_LOADED = true;'

    with open(HTML_FILE) as f:
        html = f.read()

    if PLACEHOLDER in html:
        html = html.replace(PLACEHOLDER, data_js)
    elif DATA_RE.search(html):
        html = DATA_RE.sub(data_js, html)
    else:
        print("WARNING: no injection point found")
        return

    with open(HTML_FILE, 'w') as f:
        f.write(html)
    print(f"Wrote {HTML_FILE} ({os.path.getsize(HTML_FILE)} bytes)")

if __name__ == '__main__':
    main()
