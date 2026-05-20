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

# Pin to current resvg master snapshot. The test-files directory was
# flattened (no more elem/<category>/ subdirs), so older commit pins
# would 404. Using master here — the corpus is fairly stable in shape;
# if a fixture ever 404s, swap the SHA into the URL or drop the entry.
RESVG_REF = "master"

# W3C SVG 1.1 test suite has stable PNG references at this archive root.
W3C_SVG11 = "https://www.w3.org/Graphics/SVG/Test/20110816/svg"
W3C_SVG11_PNG = "https://www.w3.org/Graphics/SVG/Test/20110816/png"

FIXTURES: dict[str, list[dict[str, Any]]] = {
    # ---- Wikimedia Commons (real-world featured SVGs) ----
    # Special:FilePath/<filename> redirects to the actual upload, avoiding
    # the MD5-hash-derived bucket URLs (which we can't construct reliably
    # without computing the hash ourselves). Thumb URLs still need the
    # explicit bucket path, so the additions below typically skip the PNG
    # ref. The first five (kept from original) DO have refs.
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
        # Additional Wikimedia fixtures — academic / science / typography
        # variety. Special:FilePath redirects to the upload bucket.
        {
            "name": "Caffeine molecule (chemistry diagram)",
            "svg": "https://commons.wikimedia.org/wiki/Special:FilePath/Caffeine_structure.svg",
            "license": "Public Domain",
        },
        {
            "name": "Sine wave (math figure with axes)",
            "svg": "https://commons.wikimedia.org/wiki/Special:FilePath/Sine_one_period.svg",
            "license": "Public Domain",
        },
        {
            "name": "Flag of France (simple rectangles)",
            "svg": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_France.svg",
            "license": "Public Domain",
        },
        {
            "name": "Eigenvalue geometric interpretation",
            "svg": "https://commons.wikimedia.org/wiki/Special:FilePath/Eigenvalue_equation.svg",
            "license": "Public Domain",
        },
    ],
    # ---- resvg test corpus (torture cases — current flat layout) ----
    "resvg": [
        {"name": f"resvg torture: {name}",
         "svg": f"https://raw.githubusercontent.com/RazrFalcon/resvg/{RESVG_REF}/crates/usvg/tests/files/{name}.svg",
         "license": "MPL-2.0"}
        for name in [
            "clip-path-with-complex-text",
            "filter-id-with-prefix",
            "text-with-generated-gradients",
            "preserve-id-fe-image-with-opacity",
            "mask-with-object-units-multi-use",
            "preserve-id-for-clip-path-in-pattern",
        ]
    ],
    # ---- W3C SVG 1.1 test suite (spec compliance, PNG refs in the archive) ----
    "w3c": [
        {"name": "Basic shapes (rect)",       "svg": f"{W3C_SVG11}/shapes-rect-01-t.svg",      "png": f"{W3C_SVG11_PNG}/shapes-rect-01-t.png",      "license": "W3C document license"},
        {"name": "Paths (lineto)",            "svg": f"{W3C_SVG11}/paths-data-01-t.svg",       "png": f"{W3C_SVG11_PNG}/paths-data-01-t.png",       "license": "W3C document license"},
        {"name": "Linear gradient",           "svg": f"{W3C_SVG11}/pservers-grad-01-b.svg",    "png": f"{W3C_SVG11_PNG}/pservers-grad-01-b.png",    "license": "W3C document license"},
        {"name": "Coordinate viewport (viewattr)", "svg": f"{W3C_SVG11}/coords-viewattr-01-b.svg", "png": f"{W3C_SVG11_PNG}/coords-viewattr-01-b.png",  "license": "W3C document license"},
        {"name": "Text basic",                "svg": f"{W3C_SVG11}/text-text-01-b.svg",        "png": f"{W3C_SVG11_PNG}/text-text-01-b.png",        "license": "W3C document license"},
        # Additional W3C spec tests for coverage.
        {"name": "Circles",                   "svg": f"{W3C_SVG11}/shapes-circle-01-t.svg",    "png": f"{W3C_SVG11_PNG}/shapes-circle-01-t.png",    "license": "W3C document license"},
        {"name": "Ellipses",                  "svg": f"{W3C_SVG11}/shapes-ellipse-01-t.svg",   "png": f"{W3C_SVG11_PNG}/shapes-ellipse-01-t.png",   "license": "W3C document license"},
        {"name": "Polylines",                 "svg": f"{W3C_SVG11}/shapes-polyline-01-t.svg",  "png": f"{W3C_SVG11_PNG}/shapes-polyline-01-t.png",  "license": "W3C document license"},
        {"name": "Bezier curves",             "svg": f"{W3C_SVG11}/paths-data-04-t.svg",       "png": f"{W3C_SVG11_PNG}/paths-data-04-t.png",       "license": "W3C document license"},
        {"name": "Radial gradient",           "svg": f"{W3C_SVG11}/pservers-grad-02-b.svg",    "png": f"{W3C_SVG11_PNG}/pservers-grad-02-b.png",    "license": "W3C document license"},
        {"name": "Color profiles",            "svg": f"{W3C_SVG11}/color-prop-01-b.svg",       "png": f"{W3C_SVG11_PNG}/color-prop-01-b.png",       "license": "W3C document license"},
        {"name": "Embedded raster (image)",   "svg": f"{W3C_SVG11}/struct-image-01-t.svg",     "png": f"{W3C_SVG11_PNG}/struct-image-01-t.png",     "license": "W3C document license"},
        {"name": "Gaussian blur filter",      "svg": f"{W3C_SVG11}/filters-gauss-01-b.svg",    "png": f"{W3C_SVG11_PNG}/filters-gauss-01-b.png",    "license": "W3C document license"},
        {"name": "Clipping paths",            "svg": f"{W3C_SVG11}/masking-path-01-b.svg",     "png": f"{W3C_SVG11_PNG}/masking-path-01-b.png",     "license": "W3C document license"},
        {"name": "Text fonts",                "svg": f"{W3C_SVG11}/text-fonts-01-t.svg",       "png": f"{W3C_SVG11_PNG}/text-fonts-01-t.png",       "license": "W3C document license"},
    ],
    # ---- Inkscape (real-world tool output, no paired refs).
    # Pinned to master since the 1.3 tag paths shifted; if upstream
    # renames a file, swap the entry. ----
    "inkscape": [
        {"name": "Inkscape About splash",     "svg": "https://gitlab.com/inkscape/inkscape/-/raw/master/share/screens/about.svg",       "license": "CC-BY-SA"},
        {"name": "Inkscape default template", "svg": "https://gitlab.com/inkscape/inkscape/-/raw/master/share/templates/default.svg",   "license": "CC0"},
    ],
    # ---- "Adobe Illustrator style" — entirely synthesized fixtures in
    # Phase 2 below. (Public AI exports are hard to source cleanly; the
    # three synthetic variants cover the relevant Illustrator XML quirks:
    # named layers, embedded base64 raster, stacked-opacity transforms.)
    "illustrator": [],
    # ---- simple-icons: single-color brand logos, pure-path SVG. Stress-
    # tests the minimal-SVG path (no fills beyond currentColor, no text,
    # no nested groups). MIT licensed.
    "simple-icons": [
        {"name": f"simple-icon: {name}",
         "svg": f"https://raw.githubusercontent.com/simple-icons/simple-icons/13.18.0/icons/{name}.svg",
         "license": "MIT"}
        for name in ["python", "rust", "github", "macos", "latex", "plotly", "wikipedia"]
    ],
    # ---- heroicons: Tailwind's UI icon set. Different style from simple-
    # icons (24x24 viewBox, multi-path, stroke or fill variants). MIT.
    "heroicons": [
        {"name": f"heroicon (outline): {name}",
         "svg": f"https://raw.githubusercontent.com/tailwindlabs/heroicons/v2.1.5/optimized/24/outline/{name}.svg",
         "license": "MIT"}
        for name in ["academic-cap", "beaker", "cube-transparent", "presentation-chart-line", "sparkles"]
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


def synthesize_ai_style_svgs() -> list[tuple[str, bytes]]:
    """Synthetic AI-flavored SVGs. Each exercises a different cluster of
    Illustrator quirks; we ship multiple so the renderer is exposed to a
    spread of real-world AI export patterns without license-checking
    actual Adobe-authored files."""
    out: list[tuple[str, bytes]] = []

    # 1. Classic AI: styled groups, xmlns:xlink, named layers, over-precise
    #    floats, ArialMT (often broken in non-Adobe renderers).
    out.append(("Synthetic AI-style: shapes + text", b"""<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg"
 xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
 viewBox="0 0 400 300" style="enable-background:new 0 0 400 300;" xml:space="preserve">
<style type="text/css">
    .st0{fill:#2563EB;stroke:#1E40AF;stroke-width:2;}
    .st1{fill:#E53E3E;stroke:none;}
    .st2{font-family:'ArialMT';font-size:18px;}
</style>
<g id="Background"><rect x="0" y="0" width="400.0000" height="300.00000" style="fill:#F8FAFC;"/></g>
<g id="Shapes">
    <circle class="st0" cx="120.5" cy="150.000" r="60.0000"/>
    <polygon class="st1" points="230,80 320.0,150 230,220 200,150"/>
</g>
<g id="Text"><text x="50" y="270" class="st2">Illustrator-style export</text></g>
</svg>"""))

    # 2. Embedded base64 raster image (very common in real AI output when
    #    a photo is "placed"). Stresses the asset_cache renderer to make
    #    sure embedded data: URIs survive the canvas round-trip.
    out.append(("Synthetic AI-style: embedded base64 raster", b"""<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator 27.5.0 -->
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 200 120">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="200" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fde68a"/>
      <stop offset="1" stop-color="#fb923c"/>
    </linearGradient>
  </defs>
  <rect width="200" height="120" fill="url(#bgGrad)"/>
  <!-- 4x4 red PNG, ~106 bytes encoded -->
  <image x="20" y="20" width="40" height="40"
    xlink:href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVQIW2P8z8AARAxAYHTk/wEAGwYG/zUYP7gAAAAASUVORK5CYII="/>
  <text x="80" y="45" font-family="Helvetica" font-size="14" fill="#7c2d12">Embedded raster</text>
</svg>"""))

    # 3. Heavy opacity + transforms — common in AI when designers stack
    #    semi-transparent shape layers. Catches blending / alpha issues.
    out.append(("Synthetic AI-style: stacked opacity layers", b"""<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator 28.0 -->
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
  <g id="Layer_1" transform="translate(20,20)">
    <g opacity="0.7" transform="rotate(-8 80 80)"><rect x="0" y="0" width="160" height="100" fill="#0ea5e9" rx="8"/></g>
    <g opacity="0.6" transform="rotate(4 100 80)"><rect x="40" y="20" width="160" height="100" fill="#f43f5e" rx="8"/></g>
    <g opacity="0.55" transform="rotate(-2 120 80)"><rect x="80" y="40" width="160" height="100" fill="#22c55e" rx="8"/></g>
    <text x="80" y="170" font-family="Helvetica" font-size="14" fill="#0f172a">stacked opacity</text>
  </g>
</svg>"""))

    return out


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
    ap.add_argument("--source", action="append", default=None,
                    help="only build from this source category (repeatable). "
                         "default: all. Use --list-sources to see options.")
    ap.add_argument("--list-sources", action="store_true",
                    help="print available source categories and exit")
    args = ap.parse_args()

    if args.list_sources:
        print(f"{'source':16s} {'count':>5s}  description")
        total = 0
        for cat, items in FIXTURES.items():
            extra = 3 if cat == "illustrator" else 0  # +3 synthesized
            n = len(items) + extra
            total += n
            print(f"  {cat:14s} {n:>5d}")
        print(f"  {'TOTAL':14s} {total:>5d}")
        return 0

    FIXTURE_ROOT.mkdir(parents=True, exist_ok=True)

    # Phase 1: download (or reuse cached) fixtures.
    sources_filter: set[str] | None = set(args.source) if args.source else None
    downloaded: list[tuple[str, str, dict[str, Any], Path, Path | None]] = []
    for category, items in FIXTURES.items():
        if sources_filter is not None and category not in sources_filter:
            continue
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

    # Add synthetic AI-style fixtures (no network needed). Skipped when
    # --source filters away 'illustrator'.
    if sources_filter is None or "illustrator" in sources_filter:
        synth_dir = FIXTURE_ROOT / "illustrator"
        synth_dir.mkdir(parents=True, exist_ok=True)
        for name, body in synthesize_ai_style_svgs():
            slug = "".join(c if c.isalnum() else "_" for c in name)
            path = synth_dir / f"{slug}.svg"
            if not path.exists():
                path.write_bytes(body)
            downloaded.append((
                "illustrator", name,
                {"license": "synthesized for testing", "svg": "in-script"},
                path, None,
            ))
            print(f"  + illustrator/{name}: svg={path.stat().st_size}b")

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
