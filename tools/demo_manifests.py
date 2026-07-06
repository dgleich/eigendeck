#!/usr/bin/env python3
"""Ensure every embedded demo that loads a CDN declares it in a manifest.

Since the per-demo CSP gates remote <script src>/<link> (offline unless declared),
a demo that loads e.g. D3 from a CDN but has no eigendeck-manifest+json block is
BROKEN (its library can't load). This tool finds such demos in .eigendeck files and:

  check  — list them, exit non-zero if any exist (CI / commit guard).
  fix    — inject a manifest declaring the hosts each demo actually loads from.

Usage:
  uv run tools/demo_manifests.py check <deck.eigendeck> [more...]
  uv run tools/demo_manifests.py fix   <deck.eigendeck> [more...]
"""
import hashlib, json, re, sqlite3, sys

MARKER = 'eigendeck-demo-v'
PURPOSE = {
    'd3js.org': 'D3 visualization library',
    'cdn.jsdelivr.net': 'JavaScript libraries (e.g. topojson-client)',
    'cdn.plot.ly': 'Plotly charting library',
    'unpkg.com': 'JavaScript libraries',
    'cdnjs.cloudflare.com': 'JavaScript libraries',
}
# Match a remote script/link/iframe/img load on either quote style, capturing
# host[:port] (so a non-default-port CDN is declared correctly, not silently dropped).
HOST_RE = re.compile(r'''<(?:script|link|iframe|img)[^>]*(?:src|href)=["']https?://([a-zA-Z0-9.\-]+(?::\d+)?)''', re.I)
CHARSET_RE = re.compile(r'(<meta[^>]*charset[^>]*>)', re.I)
HEAD_RE = re.compile(r'(<head[^>]*>)', re.I)


def demo_hosts(html: str):
    """Distinct CDN hosts a marked demo loads, or [] if not a demo / no CDN."""
    if MARKER not in html[:300]:
        return []
    return sorted(set(HOST_RE.findall(html)))


def make_manifest(hosts) -> str:
    net = [{"host": h, "purpose": PURPOSE.get(h, f"{h} (library/CDN)")} for h in hosts]
    body = json.dumps({"network": net})
    return f'<script type="application/eigendeck-manifest+json">\n{body}\n</script>\n'


def inject(html: str, manifest: str) -> str:
    m = CHARSET_RE.search(html) or HEAD_RE.search(html)
    if not m:  # no <head>/charset — put it right after the marker line
        return re.sub(r'(<!--eigendeck-demo-v[0-9]+-->\n?)', r'\1' + manifest, html, count=1)
    return html[:m.end()] + '\n' + manifest + html[m.end():]


def scan(path):
    """-> list of (asset_id, hosts) for demos that load a CDN but declare no manifest."""
    db = sqlite3.connect(path)
    out = []
    for aid, data in db.execute("select asset_id,data from assets where valid_to is null and mime_type='text/html'"):
        s = data.decode('utf-8', 'replace') if isinstance(data, (bytes, bytearray)) else str(data)
        if 'eigendeck-manifest' in s:
            continue
        hosts = demo_hosts(s)
        if hosts:
            out.append((aid, hosts))
    db.close()
    return out


def fix(path):
    db = sqlite3.connect(path)
    n = 0
    for aid, hosts in scan(path):
        data = db.execute("select data from assets where asset_id=? and valid_to is null", (aid,)).fetchone()[0]
        s = data.decode('utf-8')
        new = inject(s, make_manifest(hosts)).encode('utf-8')
        db.execute("update assets set data=?, size=?, hash=? where asset_id=? and valid_to is null",
                   (new, len(new), hashlib.sha256(new).hexdigest(), aid))
        n += 1
        print(f"    {aid[:8]}: declared {hosts}")
    db.commit(); db.close()
    return n


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ('check', 'fix'):
        print(__doc__); sys.exit(2)
    mode, decks = sys.argv[1], sys.argv[2:]
    total = 0
    for d in decks:
        found = scan(d)
        if not found:
            continue
        total += len(found)
        print(f"{d}: {len(found)} demo(s) load a CDN with no manifest")
        if mode == 'fix':
            fix(d)
        else:
            for aid, hosts in found:
                print(f"    {aid[:8]}: {hosts}")
    if mode == 'check':
        if total:
            print(f"\n✗ {total} demo(s) would be blocked (CDN load, no manifest). Run `fix`.")
            sys.exit(1)
        print("✓ every CDN-loading demo declares a manifest")
    else:
        print(f"\nfixed {total} demo(s)")


if __name__ == '__main__':
    main()
