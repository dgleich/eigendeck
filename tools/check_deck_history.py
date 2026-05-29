#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Check an .eigendeck SQLite file for history state that should be
stripped before committing it.

What counts as "history state":
  - Historical rows in temporal tables: elements, slide_elements,
    slides, assets where valid_to IS NOT NULL.
  - asset_cache rows (rendered PNG cache — populated during use,
    not canonical content).
  - WAL / SHM sidecar files next to the .eigendeck (interrupted
    sessions; should be checkpointed away on clean close).

Exit code: 0 if all checked files are clean, 1 if any has history.

Usage:
  uv run tools/check_deck_history.py examples/foo.eigendeck
  uv run tools/check_deck_history.py examples/*.eigendeck
  uv run tools/check_deck_history.py --json examples/*.eigendeck
  uv run tools/check_deck_history.py --quiet examples/*.eigendeck   # only print dirty

To strip history from a dirty deck: open it in the Eigendeck app
and run Debug → Strip History (or invoke db_compact(keep_all=true)
from the debug console). The tool only DETECTS state; the app does
the actual strip because it owns the GC semantics.
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path


def check_deck(path: Path) -> dict:
    """Open a .eigendeck read-only and report history-state findings.

    Returns a dict with counts. Any non-zero count (or sidecar
    presence) means the file is "dirty" — has state that should be
    stripped before committing.
    """
    findings: dict = {
        "path": str(path),
        "size_bytes": path.stat().st_size,
        "historical_elements": 0,
        "historical_slide_elements": 0,
        "historical_slides": 0,
        "historical_assets": 0,
        "asset_cache_rows": 0,
        "asset_cache_bytes": 0,
        "wal_present": path.with_suffix(path.suffix + "-wal").exists(),
        "shm_present": path.with_suffix(path.suffix + "-shm").exists(),
        "errors": [],
    }

    # Read-only URI mode — sqlite3 won't create WAL/SHM sidecars.
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error as e:
        findings["errors"].append(f"open: {e}")
        return findings

    cur = conn.cursor()

    def safe_count(sql: str) -> int:
        try:
            cur.execute(sql)
            row = cur.fetchone()
            return int(row[0]) if row and row[0] is not None else 0
        except sqlite3.Error as e:
            # Missing table = treat as zero (legacy / pre-schema file).
            if "no such table" in str(e):
                return 0
            findings["errors"].append(f"{sql!r}: {e}")
            return 0

    findings["historical_elements"] = safe_count(
        "SELECT COUNT(*) FROM elements WHERE valid_to IS NOT NULL"
    )
    findings["historical_slide_elements"] = safe_count(
        "SELECT COUNT(*) FROM slide_elements WHERE valid_to IS NOT NULL"
    )
    findings["historical_slides"] = safe_count(
        "SELECT COUNT(*) FROM slides WHERE valid_to IS NOT NULL"
    )
    findings["historical_assets"] = safe_count(
        "SELECT COUNT(*) FROM assets WHERE valid_to IS NOT NULL"
    )
    findings["asset_cache_rows"] = safe_count(
        "SELECT COUNT(*) FROM asset_cache"
    )
    findings["asset_cache_bytes"] = safe_count(
        "SELECT COALESCE(SUM(LENGTH(png)), 0) FROM asset_cache"
    )

    conn.close()
    return findings


def is_clean(f: dict) -> bool:
    return (
        f["historical_elements"] == 0
        and f["historical_slide_elements"] == 0
        and f["historical_slides"] == 0
        and f["historical_assets"] == 0
        and f["asset_cache_rows"] == 0
        and not f["wal_present"]
        and not f["shm_present"]
        and not f["errors"]
    )


def format_findings(f: dict) -> str:
    name = Path(f["path"]).name
    if is_clean(f):
        return f"✓ {name}  ({f['size_bytes']:,}B clean)"

    lines = [f"✗ {name}  ({f['size_bytes']:,}B)"]
    if f["historical_elements"]:
        lines.append(f"    historical elements:        {f['historical_elements']:,}")
    if f["historical_slide_elements"]:
        lines.append(f"    historical slide_elements:  {f['historical_slide_elements']:,}")
    if f["historical_slides"]:
        lines.append(f"    historical slides:          {f['historical_slides']:,}")
    if f["historical_assets"]:
        lines.append(f"    historical asset versions:  {f['historical_assets']:,}")
    if f["asset_cache_rows"]:
        lines.append(f"    asset_cache rows:           {f['asset_cache_rows']:,}  ({f['asset_cache_bytes']:,}B)")
    if f["wal_present"]:
        lines.append(f"    WAL sidecar present (unclean shutdown?)")
    if f["shm_present"]:
        lines.append(f"    SHM sidecar present (unclean shutdown?)")
    if f["errors"]:
        for e in f["errors"]:
            lines.append(f"    error: {e}")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument("paths", nargs="+", type=Path,
                    help=".eigendeck files (or globs the shell already expanded) to check")
    ap.add_argument("--json", action="store_true",
                    help="emit a JSON report instead of human-readable output")
    ap.add_argument("--quiet", action="store_true",
                    help="only print dirty decks; silent on clean ones")
    args = ap.parse_args()

    results = []
    for p in args.paths:
        if not p.exists():
            print(f"⚠  not found: {p}", file=sys.stderr)
            results.append({"path": str(p), "errors": ["not found"]})
            continue
        results.append(check_deck(p))

    all_clean = all(is_clean(r) for r in results)

    if args.json:
        json.dump({"decks": results, "all_clean": all_clean}, sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        dirty = [r for r in results if not is_clean(r)]
        clean = [r for r in results if is_clean(r)]
        if not args.quiet:
            for r in clean:
                print(format_findings(r))
        for r in dirty:
            print(format_findings(r))
        if dirty:
            print(f"\n{len(dirty)} of {len(results)} deck(s) carry history state.",
                  file=sys.stderr)
            print("Strip via the Eigendeck app: Debug → Strip History.",
                  file=sys.stderr)
        elif not args.quiet:
            print(f"\nAll {len(results)} deck(s) clean.")

    return 0 if all_clean else 1


if __name__ == "__main__":
    sys.exit(main())
