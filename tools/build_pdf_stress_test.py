#!/usr/bin/env python3
"""
Build a PDF rendering stress-test deck.

Walks /work/gitignore/test-pdfs/*.pdf, stores each in the .eigendeck's
temporal `assets` table, and emits one slide per PDF whose ImageElement
has `kind:'pdf'` and `assetId` bound to the asset row. The `asset_cache`
table is intentionally LEFT EMPTY so opening the deck triggers fresh
PDF.js renders for every page — that's the workload we want to measure.

Schema follows src-tauri/src/storage.rs::create_schema (v3 with the
phase-3 promoted `elements.asset_id` column). The data-side `assetId`
JSON field is stripped before insert (same as db_import_json does).

Output: /work/test-presentations/pdf-stress-test.eigendeck
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

PDF_DIR = Path("/work/gitignore/test-pdfs")
OUTPUT = Path("/work/test-presentations/pdf-stress-test.eigendeck")
SCHEMA_VERSION = "3"

# Mirrors src-tauri/src/storage.rs::create_schema. Reproduced verbatim
# (minus the pre-phase-3 migration ALTERs, which only matter when
# opening an OLD file — we're creating fresh).
SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS presentation (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS slides (
    id TEXT NOT NULL,
    position INTEGER,
    notes TEXT,
    group_id TEXT,
    config TEXT,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    PRIMARY KEY (id, valid_from)
);

CREATE TABLE IF NOT EXISTS elements (
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    link_id TEXT,
    asset_id TEXT,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    PRIMARY KEY (id, valid_from)
);

CREATE TABLE IF NOT EXISTS slide_elements (
    slide_id TEXT NOT NULL,
    element_id TEXT NOT NULL,
    z_order INTEGER NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    PRIMARY KEY (slide_id, element_id, valid_from)
);

CREATE TABLE IF NOT EXISTS math_cache (
    key TEXT PRIMARY KEY,
    tex TEXT NOT NULL,
    bundle TEXT NOT NULL,
    display INTEGER NOT NULL,
    preamble TEXT NOT NULL,
    svg TEXT NOT NULL,
    width TEXT,
    height TEXT,
    valign TEXT,
    rendered_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS asset_cache (
    source_id TEXT NOT NULL,
    variant TEXT NOT NULL DEFAULT '_',
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    png BLOB NOT NULL,
    source_hash TEXT,
    rendered_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (source_id, variant, width, height)
);
CREATE INDEX IF NOT EXISTS idx_asset_cache_source ON asset_cache(source_id);

CREATE INDEX IF NOT EXISTS idx_el_current   ON elements(valid_to)        WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_el_id        ON elements(id)              WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_se_slide     ON slide_elements(slide_id)  WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_se_element   ON slide_elements(element_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_slides_current ON slides(valid_to)        WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_el_link      ON elements(link_id)         WHERE valid_to IS NULL AND link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_el_asset     ON elements(asset_id)        WHERE valid_to IS NULL AND asset_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS assets (
    asset_id TEXT NOT NULL,
    data BLOB NOT NULL,
    mime_type TEXT,
    size INTEGER,
    hash TEXT,
    path TEXT,
    external_path TEXT,
    external_mtime TEXT,
    auto_reload TEXT,
    created_at TEXT,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    PRIMARY KEY (asset_id, valid_from)
);
CREATE INDEX IF NOT EXISTS idx_assets_current ON assets(asset_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_assets_path    ON assets(path)     WHERE valid_to IS NULL;
"""


def now_iso() -> str:
    """Match storage.rs timestamp format: YYYY-MM-DDTHH:MM:SS.fffZ (ms precision)."""
    s = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")
    # Trim microseconds to milliseconds, append Z.
    return s[:-3] + "Z"


def new_id() -> str:
    return uuid.uuid4().hex


def title_text_element(text: str) -> dict:
    """Small title at the top of the slide showing the PDF filename."""
    return {
        "id": new_id(),
        "type": "text",
        "preset": "title",
        "html": text,
        # Title preset defaults are bottom-aligned at y:20 h:200; we want
        # the title compact so the PDF gets the rest of the slide.
        "position": {"x": 80, "y": 20, "width": 1760, "height": 140},
        "verticalAlign": "bottom",
        "fontSize": 56,
    }


def pdf_image_element(asset_id: str) -> dict:
    """Image element with kind:'pdf'. assetId is NOT included in the
    data JSON — it's promoted to the asset_id column at insert."""
    return {
        "id": new_id(),
        "type": "image",
        "kind": "pdf",
        "position": {"x": 100, "y": 180, "width": 1720, "height": 850},
        # NOTE: no assetId here — see insert site.
        "_asset_id": asset_id,  # carried through, stripped before serialize
    }


def cover_slide() -> dict:
    return {
        "id": new_id(),
        "elements": [
            {
                "id": new_id(),
                "type": "text",
                "preset": "title",
                "html": "PDF Rendering Stress Test",
                "position": {"x": 80, "y": 400, "width": 1760, "height": 160},
                "verticalAlign": "middle",
            },
            {
                "id": new_id(),
                "type": "text",
                "preset": "body",
                "html": (
                    "One slide per PDF in <code>gitignore/test-pdfs/</code>. "
                    "The <code>asset_cache</code> table is empty — opening this "
                    "deck triggers a fresh PDF.js render for every page so the "
                    "pipeline cost is measurable."
                ),
                "position": {"x": 80, "y": 580, "width": 1760, "height": 300},
            },
        ],
        "notes": "",
    }


def insert_asset(conn: sqlite3.Connection, *, pdf_path: Path, ts: str) -> str:
    """Read PDF bytes, insert one asset row, return its asset_id."""
    data = pdf_path.read_bytes()
    asset_id = new_id()
    conn.execute(
        "INSERT INTO assets (asset_id, data, mime_type, size, hash, path, "
        "external_path, external_mtime, auto_reload, created_at, valid_from, valid_to) "
        "VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL)",
        (
            asset_id,
            data,
            "application/pdf",
            len(data),
            hashlib.sha256(data).hexdigest(),
            pdf_path.name,
            ts,
            ts,
        ),
    )
    return asset_id


def insert_element(conn: sqlite3.Connection, el: dict, ts: str) -> None:
    """Insert one element row. Strips the same fields db_import_json does
    (linkId, syncId, _syncId, _linkId, assetId, src, demoSrc) plus our
    internal `_asset_id` carrier — and promotes asset_id to its column."""
    data = dict(el)  # shallow copy
    asset_id = data.pop("_asset_id", None) or data.pop("assetId", None)
    link_id = data.pop("linkId", None)
    for k in ("syncId", "_syncId", "_linkId", "src", "demoSrc"):
        data.pop(k, None)
    conn.execute(
        "INSERT INTO elements (id, type, data, link_id, asset_id, valid_from, valid_to) "
        "VALUES (?, ?, ?, ?, ?, ?, NULL)",
        (el["id"], el["type"], json.dumps(data, sort_keys=True), link_id, asset_id, ts),
    )


def insert_slide(conn: sqlite3.Connection, slide: dict, position: int, ts: str) -> None:
    cfg = slide.get("config")
    conn.execute(
        "INSERT INTO slides (id, position, notes, group_id, config, valid_from, valid_to) "
        "VALUES (?, ?, ?, ?, ?, ?, NULL)",
        (
            slide["id"],
            position,
            slide.get("notes", ""),
            slide.get("groupId"),
            json.dumps(cfg, sort_keys=True) if cfg else None,
            ts,
        ),
    )
    for z, el in enumerate(slide["elements"]):
        insert_element(conn, el, ts)
        conn.execute(
            "INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from, valid_to) "
            "VALUES (?, ?, ?, ?, NULL)",
            (slide["id"], el["id"], z, ts),
        )


def main() -> int:
    pdfs = sorted(p for p in PDF_DIR.iterdir() if p.suffix.lower() == ".pdf" and p.is_file())
    if not pdfs:
        print(f"No PDFs found in {PDF_DIR}", file=sys.stderr)
        return 1
    print(f"Found {len(pdfs)} PDFs.")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        OUTPUT.unlink()
    # WAL sidecars from prior runs would confuse a fresh-create.
    for sidecar in (OUTPUT.with_suffix(".eigendeck-wal"), OUTPUT.with_suffix(".eigendeck-shm")):
        if sidecar.exists():
            sidecar.unlink()

    conn = sqlite3.connect(str(OUTPUT))
    try:
        conn.executescript(SCHEMA_SQL)

        ts = now_iso()
        # _meta + presentation rows
        conn.execute("INSERT OR REPLACE INTO _meta VALUES ('schema_version', ?)", (SCHEMA_VERSION,))
        conn.execute("INSERT OR REPLACE INTO _meta VALUES ('schema_built_at', ?)", (ts,))
        config = {
            "author": "",
            "venue": "",
            "transition": "slide",
            "backgroundTransition": "fade",
            "width": 1920,
            "height": 1080,
            "showSlideNumber": True,
        }
        for k, v in [
            ("title", "PDF Rendering Stress Test"),
            ("theme", "white"),
            ("config", json.dumps(config, sort_keys=True)),
        ]:
            conn.execute("INSERT OR REPLACE INTO presentation VALUES (?, ?)", (k, v))

        # Cover slide
        slides = [cover_slide()]

        # One slide per PDF (alphabetical order from sorted() above)
        for pdf in pdfs:
            asset_id = insert_asset(conn, pdf_path=pdf, ts=ts)
            slides.append({
                "id": new_id(),
                "elements": [
                    title_text_element(pdf.name),
                    pdf_image_element(asset_id),
                ],
                "notes": f"Source file: {pdf} ({pdf.stat().st_size:,} bytes)",
            })
            print(f"  + {pdf.name}: {pdf.stat().st_size:,} bytes")

        for pos, slide in enumerate(slides):
            insert_slide(conn, slide, pos, ts)

        conn.commit()
    finally:
        conn.close()

    size_mb = OUTPUT.stat().st_size / (1024 * 1024)
    print(f"\n=> {OUTPUT}  ({size_mb:.1f} MB, {len(slides)} slides)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
