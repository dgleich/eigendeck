#!/usr/bin/env python3
"""Stamp the eigendeck-demo marker into a deck's embedded demo assets.

Asset-security (docs/ASSETS-SECURITY.md) requires every demo to carry
`<!--eigendeck-demo-v1-->` right after the DOCTYPE. The add + watch gates enforce
this for NEW demos, and the demo-MOUNT gate now refuses to render unmarked HTML as a
demo — so any deck whose stored demo bytes predate the marker must be re-stamped.

For each current (valid_to IS NULL) HTML demo asset lacking the marker, this inserts
the marker after the DOCTYPE and updates the row's data / size / hash (sha256 hex — the
same hash the app + storage layer compute). Edits the CURRENT row in place (no new
temporal history), then checkpoints + truncates the WAL so the .eigendeck stays a
single self-contained file (no -wal/-shm sidecar left behind).

With --clean it also drops rendered-preview cache + temporal history rows (safe — this
is NOT asset garbage-collection; current asset rows are untouched) so the deck commits
lean/deterministic, per the commit-presentations skill.

Usage:
  python3 tools/stamp_demo_markers.py [--clean] deck1.eigendeck [deck2.eigendeck ...]
  python3 tools/stamp_demo_markers.py --check deck.eigendeck   # report only, no writes
"""
import sys, os, re, hashlib, sqlite3

DOCTYPE_RE = re.compile(rb'<!doctype\s+html\s*>', re.I)
MARKER = b'<!--eigendeck-demo-v1-->'
# Mirror isEigendeckDemo: marker after optional BOM/whitespace/DOCTYPE/whitespace.
ALREADY_RE = re.compile(rb'^(?:\xef\xbb\xbf)?\s*(?:<!doctype\s+html\s*>\s*)?<!--eigendeck-demo-v[1-9]\d*-->', re.I)


def stamp_bytes(data: bytes):
    """Return stamped bytes, or None if already marked."""
    if ALREADY_RE.match(data):
        return None
    m = DOCTYPE_RE.search(data)
    if m:
        i = m.end()
        return data[:i] + b'\n' + MARKER + data[i:]
    # No DOCTYPE — put the marker at the very top (isEigendeckDemo allows this).
    return MARKER + b'\n' + data


def process(path: str, check_only: bool, clean: bool) -> int:
    con = sqlite3.connect(path)
    con.execute("PRAGMA busy_timeout=5000")
    cur = con.cursor()
    rows = cur.execute(
        "SELECT asset_id, path, data FROM assets "
        "WHERE valid_to IS NULL AND (mime_type LIKE '%html%' OR path LIKE '%.html')"
    ).fetchall()
    changed = 0
    for asset_id, apath, data in rows:
        if data is None:
            continue
        stamped = stamp_bytes(bytes(data))
        if stamped is None:
            continue
        changed += 1
        label = apath or asset_id[:8]
        if check_only:
            print(f"    would stamp: {label}")
            continue
        h = hashlib.sha256(stamped).hexdigest()
        cur.execute(
            "UPDATE assets SET data=?, size=?, hash=? WHERE asset_id=? AND valid_to IS NULL",
            (stamped, len(stamped), h, asset_id),
        )
        print(f"    stamped: {label} ({len(stamped)} bytes, {h[:12]}…)")
    if check_only:
        con.close()
        return changed
    if clean:
        # Rendered-preview cache is keyed off the old bytes — drop it (regenerates on
        # open). Also drop temporal history so the committed deck is lean + deterministic.
        # NOT asset-GC: current (valid_to IS NULL) asset rows are never touched.
        for stmt in (
            "DELETE FROM asset_cache",
            "DELETE FROM elements WHERE valid_to IS NOT NULL",
            "DELETE FROM slide_elements WHERE valid_to IS NOT NULL",
            "DELETE FROM slides WHERE valid_to IS NOT NULL",
            "DELETE FROM assets WHERE valid_to IS NOT NULL",
        ):
            try:
                cur.execute(stmt)
            except sqlite3.OperationalError:
                pass
    con.commit()
    # Merge the WAL into the main file, then VACUUM, so the committed .eigendeck is a
    # single self-contained file (the -wal/-shm sidecars are removed after close).
    try:
        cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        if clean:
            cur.execute("VACUUM")
    except sqlite3.Error:
        pass
    con.close()
    for suffix in ('-wal', '-shm'):
        try:
            os.remove(path + suffix)
        except OSError:
            pass
    return changed


def main():
    args = sys.argv[1:]
    check_only = '--check' in args
    clean = '--clean' in args
    decks = [a for a in args if not a.startswith('--')]
    if not decks:
        print(__doc__)
        return 2
    total = 0
    for d in decks:
        print(f"{d}:")
        try:
            n = process(d, check_only, clean)
        except Exception as e:  # noqa: BLE001 — report + continue to the next deck
            print(f"    ERROR: {e}")
            continue
        total += n
        if n == 0:
            print("    (nothing to stamp)")
    verb = "would stamp" if check_only else "stamped"
    print(f"== {verb} {total} demo asset(s) across {len(decks)} deck(s)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
