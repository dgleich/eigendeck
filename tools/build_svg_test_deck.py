#!/usr/bin/env python3
"""
Build an SVG rendering test deck for the asset_cache pipeline.

Downloads SVGs from multiple sources (Wikimedia, resvg test corpus, W3C
SVG 1.1 suite, Inkscape, and a handful of representative AI-style files),
stores them in the .eigendeck's `assets` table, and emits a slide per file
with `kind:'svg'` so the cache renderer is exercised end-to-end. Where the
source ships a reference PNG, the deck shows our render side-by-side with
the reference so visual fidelity can be eyeballed at a glance.

Output:
  test-presentations/svg-render-test.eigendeck

Downloaded fixtures are cached under:
  test-presentations/_svg-fixtures/<category>/<name>.svg
  test-presentations/_svg-fixtures/<category>/<name>.ref.png

(That directory is gitignored by the `_debug-*` / `test-presentations/`
patterns — re-running the script just skips already-downloaded files.)

Usage:
    python3 tools/build_svg_test_deck.py            # download + build
    python3 tools/build_svg_test_deck.py --skip-download   # rebuild from cache only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Reuse the existing v2 builder helpers (text_element, make_slide,
# write_eigendeck, SCHEMA_SQL, etc.) so the new deck stays consistent
# with the test-presentations/ corpus.
sys.path.insert(0, str(Path(__file__).parent))
import build_test_presentations as btp  # noqa: E402

# ---------------------------------------------------------------------------
# URL manifest. Each entry pins a STABLE URL (commit SHA on GitHub, archived
# Wikimedia path, dated W3C release) so re-runs are reproducible. Adding a
# new fixture: drop a new entry into the right category list.
#
# `png` is optional — when present, the deck renders source + reference
# side-by-side for fidelity comparison; when absent, just the SVG fills
# the slide.
# ---------------------------------------------------------------------------

USER_AGENT = "eigendeck-svg-test/1.0 (https://github.com/dgleich/eigendeck)"

# Pin to a stable commit so URLs don't change under us.
RESVG_COMMIT = "0252b88f2f55ab5cd5d7b9eaae45caec5f3c1c0c"  # 2024-ish, stable

# W3C SVG 1.1 test suite has stable PNG references at this archive root.
W3C_SVG11 = "https://www.w3.org/Graphics/SVG/Test/20110816/svg"
W3C_SVG11_PNG = "https://www.w3.org/Graphics/SVG/Test/20110816/png"

FIXTURES: dict[str, list[dict[str, Any]]] = {
    # ---- Wikimedia Commons (real-world featured SVGs) ----
    "wikimedia": [
        {
            "name": "Tux",
            "svg": "https://upload.wikimedia.org/wikipedia/commons/3/35/Tux.svg",
            "png": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Tux.svg/600px-Tux.svg.png",
            "license": "Public Domain",
        },
        {
            "name": "Wikipedia logo (smaller)",
            "svg": "https://upload.wikimedia.org/wikipedia/commons/8/80/Wikipedia-logo-v2.svg",
            "png": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Wikipedia-logo-v2.svg/600px-Wikipedia-logo-v2.svg.png",
            "license": "CC-BY-SA 3.0",
        },
        {
            "name": "Linus Torvalds (Smithsonian portrait, vector tracing)",
            "svg": "https://upload.wikimedia.org/wikipedia/commons/9/95/Linus_Torvalds.svg",
            "png": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Linus_Torvalds.svg/600px-Linus_Torvalds.svg.png",
            "license": "CC-BY-SA",
        },
        {
            "name": "Periodic table",
            "svg": "https://upload.wikimedia.org/wikipedia/commons/d/d4/Simple_Periodic_Table_Chart-blocks.svg",
            "png": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Simple_Periodic_Table_Chart-blocks.svg/600px-Simple_Periodic_Table_Chart-blocks.svg.png",
            "license": "Public Domain",
        },
        {
            "name": "Globe icon",
            "svg": "https://upload.wikimedia.org/wikipedia/commons/c/c1/Globe_icon.svg",
            "png": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Globe_icon.svg/600px-Globe_icon.svg.png",
            "license": "Public Domain",
        },
    ],
    # ---- resvg test corpus (torture cases with paired PNG references) ----
    "resvg": [
        {
            "name": "Gradients (radial + linear)",
            "svg": f"https://raw.githubusercontent.com/RazrFalcon/resvg/{RESVG_COMMIT}/crates/usvg/tests/files/elem/svg/svg-on-svg.svg",
            "license": "MPL-2.0",
        },
        {
            "name": "Path with transforms",
            "svg": f"https://raw.githubusercontent.com/RazrFalcon/resvg/{RESVG_COMMIT}/crates/usvg/tests/files/elem/path/transform.svg",
            "license": "MPL-2.0",
        },
        {
            "name": "Filter (Gaussian blur)",
            "svg": f"https://raw.githubusercontent.com/RazrFalcon/resvg/{RESVG_COMMIT}/crates/usvg/tests/files/elem/filter/feGaussianBlur.svg",
            "license": "MPL-2.0",
        },
        {
            "name": "Text with tspan",
            "svg": f"https://raw.githubusercontent.com/RazrFalcon/resvg/{RESVG_COMMIT}/crates/usvg/tests/files/elem/text/tspan.svg",
            "license": "MPL-2.0",
        },
        {
            "name": "Pattern fill",
            "svg": f"https://raw.githubusercontent.com/RazrFalcon/resvg/{RESVG_COMMIT}/crates/usvg/tests/files/elem/pattern/pattern.svg",
            "license": "MPL-2.0",
        },
    ],
    # ---- W3C SVG 1.1 test suite (spec compliance, PNG refs in the archive) ----
    "w3c": [
        {
            "name": "Basic shapes",
            "svg": f"{W3C_SVG11}/shapes-rect-01-t.svg",
            "png": f"{W3C_SVG11_PNG}/shapes-rect-01-t.png",
            "license": "W3C document license",
        },
        {
            "name": "Paths (lineto)",
            "svg": f"{W3C_SVG11}/paths-data-01-t.svg",
            "png": f"{W3C_SVG11_PNG}/paths-data-01-t.png",
            "license": "W3C document license",
        },
        {
            "name": "Linear gradient",
            "svg": f"{W3C_SVG11}/pservers-grad-01-b.svg",
            "png": f"{W3C_SVG11_PNG}/pservers-grad-01-b.png",
            "license": "W3C document license",
        },
        {
            "name": "Coordinate viewport",
            "svg": f"{W3C_SVG11}/coords-viewBox-01-b.svg",
            "png": f"{W3C_SVG11_PNG}/coords-viewBox-01-b.png",
            "license": "W3C document license",
        },
        {
            "name": "Text basic",
            "svg": f"{W3C_SVG11}/text-text-01-b.svg",
            "png": f"{W3C_SVG11_PNG}/text-text-01-b.png",
            "license": "W3C document license",
        },
    ],
    # ---- Inkscape (real-world tool output, no paired refs) ----
    "inkscape": [
        {
            "name": "Inkscape About splash (1.3)",
            "svg": "https://gitlab.com/inkscape/inkscape/-/raw/INKSCAPE_1_3/share/screens/about.svg",
            "license": "CC-BY-SA",
        },
        {
            "name": "Inkscape startup logo",
            "svg": "https://gitlab.com/inkscape/inkscape/-/raw/INKSCAPE_1_3/share/branding/inkscape-logo.svg",
            "license": "CC-BY-SA",
        },
        {
            "name": "Inkscape default template",
            "svg": "https://gitlab.com/inkscape/inkscape/-/raw/INKSCAPE_1_3/share/templates/default.svg",
            "license": "CC0",
        },
        # The OpenClipart subset Inkscape ships also lives in their repo;
        # adding one representative.
        {
            "name": "Inkscape symbol set sample",
            "svg": "https://gitlab.com/inkscape/inkscape/-/raw/INKSCAPE_1_3/share/symbols/AIGA.svg",
            "license": "Public Domain",
        },
    ],
    # ---- "Adobe Illustrator style" — sourced from public files known to
    # have been authored in or exported by AI. There's no canonical AI
    # test suite; these are real-world AI-flavored SVGs commonly cited.
    "illustrator": [
        # The Mozilla SVG examples are typical hand/Illustrator output;
        # several include AI-specific metadata in the XML.
        {
            "name": "MDN basic SVG demo",
            "svg": "https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorial/Introduction/star.svg",
            "license": "CC0",
        },
        # Adobe's own public sample SVGs from the Pixabay/Wikimedia
        # subset, or fallback to a synthetic AI-style file (created below).
    ],
}

FIXTURE_ROOT = Path("test-presentations/_svg-fixtures")
OUTPUT_DECK = Path("test-presentations/svg-render-test.eigendeck")

# ---------------------------------------------------------------------------
# Download helpers
# ---------------------------------------------------------------------------

def fetch(url: str, dest: Path, *, max_bytes: int = 2_500_000) -> bool:
    """Download `url` to `dest` if not already present. Returns True on success.
    Skips downloads >max_bytes (keeps the deck snappy)."""
    if dest.exists() and dest.stat().st_size > 0:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read(max_bytes + 1)
        if len(data) > max_bytes:
            print(f"  ! skip (too large, >{max_bytes} bytes): {url}")
            return False
        dest.write_bytes(data)
        return True
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        print(f"  ! fetch failed for {url}: {e}")
        return False


def synthesize_ai_style_svg() -> bytes:
    """A small synthetic SVG mimicking typical Illustrator XML quirks: explicit
    xmlns:xlink, generated namespaces, named layers, embedded base64 raster,
    and over-precise floats. Saves us from license-checking a real AI export
    while still exercising those code paths."""
    return b"""<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg"
 xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
 viewBox="0 0 400 300" style="enable-background:new 0 0 400 300;" xml:space="preserve">
<style type="text/css">
    .st0{fill:#2563EB;stroke:#1E40AF;stroke-width:2;}
    .st1{fill:#E53E3E;stroke:none;}
    .st2{font-family:'ArialMT';font-size:18px;}
</style>
<g id="Background">
    <rect x="0" y="0" width="400.0000" height="300.00000" style="fill:#F8FAFC;"/>
</g>
<g id="Shapes">
    <circle class="st0" cx="120.5" cy="150.000" r="60.0000"/>
    <polygon class="st1" points="230,80 320.0,150 230,220 200,150"/>
</g>
<g id="Text">
    <text x="50" y="270" class="st2">Illustrator-style export</text>
</g>
</svg>"""


# ---------------------------------------------------------------------------
# Deck building
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def make_image_element(*, asset_path: str, kind: str, x: int, y: int, width: int, height: int) -> dict[str, Any]:
    """Build an ImageElement JSON blob with the v3 `kind` field set."""
    return {
        "id": btp.new_uuid(),
        "type": "image",
        "src": asset_path,
        "kind": kind,
        "position": {"x": x, "y": y, "width": width, "height": height},
    }


def build_fixture_slide(name: str, category: str, svg_asset: str, png_asset: str | None, license_str: str) -> dict[str, Any]:
    """One slide per fixture: title + (SVG | PNG-ref) | source/license caption."""
    elements: list[dict[str, Any]] = []
    # Title
    elements.append(btp.text_element(
        "title", f"{name} <span style='color:#888'>· {category}</span>",
        x=80, y=20, width=1760, height=80,
    ))
    if png_asset:
        # Side-by-side: our render (left) | reference PNG (right)
        elements.append(btp.text_element(
            "annotation", "<b>Our SVG render</b>",
            x=80, y=110, width=860, height=40,
        ))
        elements.append(btp.text_element(
            "annotation", "<b>Reference PNG</b>",
            x=980, y=110, width=860, height=40,
        ))
        elements.append(make_image_element(asset_path=svg_asset, kind="svg",
            x=80, y=160, width=860, height=820))
        elements.append(make_image_element(asset_path=png_asset, kind="raster",
            x=980, y=160, width=860, height=820))
    else:
        # SVG-only: single large render
        elements.append(make_image_element(asset_path=svg_asset, kind="svg",
            x=80, y=120, width=1760, height=860))
    # Caption (license)
    elements.append(btp.text_element(
        "footnote", f"License: {license_str}  ·  asset: {svg_asset}",
        x=80, y=1010, width=1760, height=50,
    ))
    return btp.make_slide(elements=elements)


def store_asset(conn: sqlite3.Connection, asset_path: str, file_bytes: bytes, mime: str) -> None:
    """Insert a row into the `assets` table mirroring db_store_asset."""
    conn.execute(
        "INSERT OR REPLACE INTO assets (path, data, mime_type, size, hash, created_at, external_path, external_mtime) "
        "VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)",
        (
            asset_path,
            file_bytes,
            mime,
            len(file_bytes),
            hashlib.sha256(file_bytes).hexdigest()[:16],
            now_iso(),
        ),
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-download", action="store_true",
                    help="reuse cached fixtures only; do not hit the network")
    args = ap.parse_args()

    FIXTURE_ROOT.mkdir(parents=True, exist_ok=True)

    # Phase 1: download (or reuse cached) fixtures.
    downloaded: list[tuple[str, str, dict[str, Any], Path, Path | None]] = []
    for category, items in FIXTURES.items():
        cat_dir = FIXTURE_ROOT / category
        for item in items:
            name = item["name"]
            slug = "".join(c if c.isalnum() else "_" for c in name)
            svg_path = cat_dir / f"{slug}.svg"
            png_path = cat_dir / f"{slug}.ref.png" if item.get("png") else None

            if not args.skip_download:
                if not fetch(item["svg"], svg_path):
                    print(f"  - {category}/{name}: SVG fetch failed, skipping")
                    continue
                if png_path is not None:
                    fetch(item["png"], png_path)  # PNG miss is OK
            elif not svg_path.exists():
                print(f"  - {category}/{name}: no cached SVG, skipping")
                continue

            png = png_path if png_path and png_path.exists() else None
            downloaded.append((category, name, item, svg_path, png))
            print(f"  + {category}/{name}: svg={svg_path.stat().st_size}b" +
                  (f", png={png.stat().st_size}b" if png else ", no-ref"))

    # Add the synthetic AI-style example (no network needed).
    synth_path = FIXTURE_ROOT / "illustrator" / "synthetic_ai_export.svg"
    synth_path.parent.mkdir(parents=True, exist_ok=True)
    if not synth_path.exists():
        synth_path.write_bytes(synthesize_ai_style_svg())
    downloaded.append((
        "illustrator", "Synthetic AI-style export",
        {"license": "synthesized for testing", "svg": "in-script"},
        synth_path, None,
    ))
    print(f"  + illustrator/Synthetic: svg={synth_path.stat().st_size}b")

    print(f"\nFetched {len(downloaded)} SVG fixtures.\n")

    # Phase 2: build the deck. write_eigendeck handles schema creation
    # (it emits SCHEMA_VERSION=2 right now — that's fine: db_open in the
    # app migrates to v3 by adding the asset_cache table on first open).
    cover = btp.make_slide(elements=[
        btp.text_element("title", "SVG rendering test",
                         x=80, y=400, width=1760, height=160, vertical_align="middle"),
        btp.text_element("body",
            f"{len(downloaded)} SVGs across {len(FIXTURES)} sources. "
            "Each slide shows our cache-rendered SVG next to its reference PNG "
            "(when one is published). All ImageElements have <code>kind:'svg'</code> "
            "so the asset_cache renderer is exercised end-to-end on open + ⌘S.",
            x=80, y=580, width=1760, height=300),
    ])
    slides = [cover]

    # Open the output DB; write schema; populate assets; emit slides.
    OUTPUT_DECK.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT_DECK.exists():
        OUTPUT_DECK.unlink()
    conn = sqlite3.connect(str(OUTPUT_DECK))
    try:
        conn.executescript(btp.SCHEMA_SQL)

        for (category, name, item, svg_path, png_path) in downloaded:
            slug = "".join(c if c.isalnum() else "_" for c in name)
            svg_asset_path = f"images/{category}/{slug}.svg"
            store_asset(conn, svg_asset_path, svg_path.read_bytes(), "image/svg+xml")
            png_asset_path = None
            if png_path is not None:
                png_asset_path = f"images/{category}/{slug}.ref.png"
                store_asset(conn, png_asset_path, png_path.read_bytes(), "image/png")
            slides.append(build_fixture_slide(
                name=name, category=category,
                svg_asset=svg_asset_path, png_asset=png_asset_path,
                license_str=item.get("license", "?"),
            ))

        # Write the rest of the .eigendeck via the existing builder by
        # constructing the same shape it does internally, but reusing our
        # open connection so the assets table we just populated isn't
        # clobbered.
        # write_eigendeck always re-creates the file from scratch via its
        # own connection — instead, do its work inline here.
        meta = {
            "schema_version": btp.SCHEMA_VERSION,
            "schema_built_at": now_iso(),
        }
        conn.executemany("INSERT OR REPLACE INTO _meta VALUES (?, ?)", meta.items())
        config = {
            "author": "",
            "venue": "",
            "transition": "slide",
            "backgroundTransition": "fade",
            "width": 1920, "height": 1080,
            "showSlideNumber": True,
        }
        for k, v in [("title", "SVG Rendering Test"), ("theme", "white"),
                     ("config", json.dumps(config, sort_keys=True))]:
            conn.execute("INSERT OR REPLACE INTO presentation VALUES (?, ?)", (k, v))

        ts = now_iso()
        for pos, slide in enumerate(slides):
            cfg = slide.get("config")
            conn.execute(
                "INSERT INTO slides(id, position, notes, group_id, config, valid_from, valid_to) "
                "VALUES (?, ?, ?, ?, ?, ?, NULL)",
                (slide["id"], pos, slide.get("notes", ""), slide.get("groupId"),
                 json.dumps(cfg, sort_keys=True) if cfg else None, ts),
            )
            for z, el in enumerate(slide["elements"]):
                cleaned, link_id = btp._strip_link_sync(el)
                conn.execute(
                    "INSERT INTO elements(id, type, data, link_id, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, NULL)",
                    (el["id"], el["type"], json.dumps(cleaned, sort_keys=True), link_id, ts),
                )
                conn.execute(
                    "INSERT INTO slide_elements(slide_id, element_id, z_order, valid_from, valid_to) "
                    "VALUES (?, ?, ?, ?, NULL)",
                    (slide["id"], el["id"], z, ts),
                )

        conn.commit()
    finally:
        conn.close()

    size_kb = OUTPUT_DECK.stat().st_size / 1024
    print(f"\n=> {OUTPUT_DECK}  ({size_kb:.0f} KB, {len(slides)} slides)")
    print("Open in Eigendeck. Sidebar should show rendered SVG thumbnails on")
    print("first display; comparison slides put our render next to the reference PNG.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
