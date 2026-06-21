#!/usr/bin/env python3
"""
build_export_stress.py — Build the export audit stress-test deck.

Output: /work/test-presentations/export-stress.eigendeck  (schema v3)

Exercises the full export matrix:
  - All 4 themes (white/light/dark/black) as per-slide overrides + covers on each
  - All 9 font packages, each applied per-preset at deck level on its own slide
  - Every element type: text (5 presets + hype), image (raster/svg/pdf),
    demo, demo-piece, notebook, video (YouTube embed), cover, arrow
  - Math in text per-preset (inline + display), custom \\newcommand preamble

Schema mirrors src-tauri/src/storage.rs::create_schema (v3, promoted
elements.asset_id column). Asset bytes are copied from existing example
decks / repo fixtures. Image/demo/demo-piece elements keep BOTH the
promoted asset_id column AND the legacy src/demoSrc field in data JSON,
matching how real saved decks look today (and what exportCore reads).
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("/work/test-presentations/export-stress.eigendeck")
SCHEMA_VERSION = "3"

SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS presentation (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS slides (
    id TEXT NOT NULL, position INTEGER, notes TEXT, group_id TEXT, config TEXT,
    valid_from TEXT NOT NULL, valid_to TEXT, PRIMARY KEY (id, valid_from));
CREATE TABLE IF NOT EXISTS elements (
    id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, link_id TEXT,
    asset_id TEXT, valid_from TEXT NOT NULL, valid_to TEXT, PRIMARY KEY (id, valid_from));
CREATE TABLE IF NOT EXISTS slide_elements (
    slide_id TEXT NOT NULL, element_id TEXT NOT NULL, z_order INTEGER NOT NULL,
    valid_from TEXT NOT NULL, valid_to TEXT, PRIMARY KEY (slide_id, element_id, valid_from));
CREATE TABLE IF NOT EXISTS math_cache (
    key TEXT PRIMARY KEY, tex TEXT NOT NULL, bundle TEXT NOT NULL, display INTEGER NOT NULL,
    preamble TEXT NOT NULL, svg TEXT NOT NULL, width TEXT, height TEXT, valign TEXT,
    rendered_at INTEGER DEFAULT (strftime('%s','now')));
CREATE TABLE IF NOT EXISTS asset_cache (
    source_id TEXT NOT NULL, variant TEXT NOT NULL DEFAULT '_', width INTEGER NOT NULL,
    height INTEGER NOT NULL, png BLOB NOT NULL, source_hash TEXT,
    rendered_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (source_id, variant, width, height));
CREATE INDEX IF NOT EXISTS idx_asset_cache_source ON asset_cache(source_id);
CREATE INDEX IF NOT EXISTS idx_el_current   ON elements(valid_to)         WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_el_id        ON elements(id)               WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_se_slide     ON slide_elements(slide_id)   WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_se_element   ON slide_elements(element_id)  WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_slides_current ON slides(valid_to)         WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_el_link      ON elements(link_id)          WHERE valid_to IS NULL AND link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_el_asset     ON elements(asset_id)         WHERE valid_to IS NULL AND asset_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS assets (
    asset_id TEXT NOT NULL, data BLOB NOT NULL, mime_type TEXT, size INTEGER, hash TEXT,
    path TEXT, external_path TEXT, external_mtime TEXT, auto_reload TEXT, created_at TEXT,
    valid_from TEXT NOT NULL, valid_to TEXT, PRIMARY KEY (asset_id, valid_from));
CREATE INDEX IF NOT EXISTS idx_assets_current ON assets(asset_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_assets_path    ON assets(path)     WHERE valid_to IS NULL;
"""

THEMES = ["white", "light", "dark", "black"]
FONTS = [
    ("ptsans", "PT Sans"), ("libertinus", "Libertinus Serif"),
    ("libertinus-sans", "Libertinus Sans"), ("lm-sans", "CMU Sans"),
    ("noto-sans", "Noto Sans"), ("source-sans", "Source Sans"),
    ("source-code", "Source Code"), ("shantell", "Shantell Sans"),
    ("concrete-euler", "CMU Concrete + Euler"),
]

PREAMBLE = (
    "\\newcommand{\\R}{\\mathbb{R}}\n"
    "\\newcommand{\\veca}[1]{\\boldsymbol{#1}}\n"
)

_ctr = 0
def ts() -> str:
    global _ctr
    s = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    _ctr += 1
    return f"{s}-{_ctr:08d}"

def uid() -> str:
    return uuid.uuid4().hex

# ---- asset harvesting --------------------------------------------------------

def harvest_demo(src_deck: str, path: str) -> bytes:
    db = sqlite3.connect(src_deck)
    row = db.execute(
        "SELECT data FROM assets WHERE path=? AND valid_to IS NULL LIMIT 1", (path,)
    ).fetchone()
    db.close()
    if not row:
        raise SystemExit(f"asset {path} not found in {src_deck}")
    return row[0]

def harvest_image(src_deck: str) -> tuple[str, bytes]:
    db = sqlite3.connect(src_deck)
    row = db.execute(
        "SELECT path, data FROM assets WHERE mime_type='image/png' AND valid_to IS NULL "
        "ORDER BY size ASC LIMIT 1"
    ).fetchone()
    db.close()
    return row[0], row[1]

# ---- element factories -------------------------------------------------------

PRESET_POS = {
    "title": {"x": 80, "y": 20, "width": 1760, "height": 200},
    "body": {"x": 80, "y": 215, "width": 1760, "height": 600},
    "textbox": {"x": 200, "y": 300, "width": 800, "height": 300},
    "annotation": {"x": 80, "y": 840, "width": 1200, "height": 120},
    "footnote": {"x": 80, "y": 1020, "width": 1400, "height": 44},
    "hype": {"x": 200, "y": 400, "width": 1520, "height": 280},
}

def text(preset: str, html: str, **kw) -> dict:
    pos = dict(PRESET_POS[preset])
    for k in ("x", "y", "width", "height"):
        if k in kw and kw[k] is not None:
            pos[k] = kw.pop(k)
    el = {"id": uid(), "type": "text", "preset": preset, "html": html, "position": pos}
    for k in ("verticalAlign", "fontSize", "color", "fontFamily"):
        if kw.get(k) is not None:
            el[k] = kw[k]
    return el

def cover(color: str, x=300, y=350, w=1320, h=420) -> dict:
    return {"id": uid(), "type": "cover", "color": color,
            "position": {"x": x, "y": y, "width": w, "height": h}}

def arrow(x1, y1, x2, y2, color="#2563eb") -> dict:
    return {"id": uid(), "type": "arrow", "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            "color": color, "strokeWidth": 6, "headSize": 24,
            "position": {"x": 0, "y": 0, "width": 0, "height": 0}}

def image(asset_id: str, src_path: str, kind: str, x=200, y=240, w=1520, h=720) -> dict:
    el = {"id": uid(), "type": "image", "src": src_path,
          "position": {"x": x, "y": y, "width": w, "height": h},
          "_asset_id": asset_id}
    if kind != "raster":
        el["kind"] = kind
    return el

def demo(asset_id: str, src_path: str, x=80, y=220, w=1760, h=760) -> dict:
    return {"id": uid(), "type": "demo", "src": src_path,
            "position": {"x": x, "y": y, "width": w, "height": h},
            "_asset_id": asset_id}

def demo_piece(asset_id: str, src_path: str, piece: str, x=80, y=220, w=860, h=760) -> dict:
    return {"id": uid(), "type": "demo-piece", "piece": piece, "demoSrc": src_path,
            "position": {"x": x, "y": y, "width": w, "height": h},
            "_asset_id": asset_id}

def notebook(asset_id: str, x=200, y=240, w=1520, h=720) -> dict:
    return {"id": uid(), "type": "notebook",
            "position": {"x": x, "y": y, "width": w, "height": h},
            "_asset_id": asset_id}

def video_embed(url: str, x=400, y=240, w=1120, h=630) -> dict:
    return {"id": uid(), "type": "video", "kind": "embed", "provider": "youtube",
            "url": url, "controls": True,
            "position": {"x": x, "y": y, "width": w, "height": h}}

def slide(elements: list[dict], *, theme=None, title_font=None, body_font=None,
          hype_font=None, notes="", group_id=None) -> dict:
    cfg = {}
    if theme: cfg["theme"] = theme
    if title_font: cfg["titleFont"] = title_font
    if body_font: cfg["bodyFont"] = body_font
    if hype_font: cfg["hypeFont"] = hype_font
    return {"id": uid(), "elements": elements, "notes": notes,
            "groupId": group_id, "config": cfg or None}

# ---- writer ------------------------------------------------------------------

STRIP = ("syncId", "_syncId", "_linkId", "src", "demoSrc")

def insert_asset(conn, *, data: bytes, mime: str, path: str, t: str) -> str:
    aid = uid()
    conn.execute(
        "INSERT INTO assets (asset_id, data, mime_type, size, hash, path, external_path, "
        "external_mtime, auto_reload, created_at, valid_from, valid_to) "
        "VALUES (?,?,?,?,?,?,NULL,NULL,NULL,?,?,NULL)",
        (aid, data, mime, len(data), hashlib.sha256(data).hexdigest(), path, t, t))
    return aid

def insert_element(conn, el: dict, t: str) -> None:
    # Keep src/demoSrc IN the data JSON (real decks do today, and exportCore
    # reads them) while ALSO promoting asset_id to its column.
    data = dict(el)
    asset_id = data.pop("_asset_id", None) or data.pop("assetId", None)
    link_id = data.pop("linkId", None)
    data.pop("syncId", None); data.pop("_syncId", None); data.pop("_linkId", None)
    conn.execute(
        "INSERT INTO elements (id, type, data, link_id, asset_id, valid_from, valid_to) "
        "VALUES (?,?,?,?,?,?,NULL)",
        (el["id"], el["type"], json.dumps(data, sort_keys=True), link_id, asset_id, t))

def write_deck(slides: list[dict], *, title: str, theme: str, config: dict) -> None:
    for sc in (OUT, OUT.with_suffix(".eigendeck-wal"), OUT.with_suffix(".eigendeck-shm")):
        if sc.exists():
            sc.unlink()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(OUT))
    try:
        conn.executescript(SCHEMA_SQL)
        t = ts()
        conn.execute("INSERT OR REPLACE INTO _meta VALUES ('schema_version', ?)", (SCHEMA_VERSION,))
        cfg = {"transition": "slide", "backgroundTransition": "fade", "width": 1920,
               "height": 1080, "showSlideNumber": True, "author": "David Gleich",
               "venue": "Export Audit"}
        cfg.update(config)
        conn.execute("INSERT INTO presentation VALUES ('title', ?)", (title,))
        conn.execute("INSERT INTO presentation VALUES ('theme', ?)", (theme,))
        conn.execute("INSERT INTO presentation VALUES ('config', ?)",
                     (json.dumps(cfg, separators=(",", ":"), sort_keys=True),))
        # placeholder for assets inserted by callers below (we pass conn out)
        return conn, t  # type: ignore
    except Exception:
        conn.close()
        raise

def main() -> int:
    # --- harvest assets we'll need ---
    img_path, img_bytes = harvest_image("/work/examples/local-networks.eigendeck")
    demo_bytes = harvest_demo("/work/examples/huda-demo.eigendeck", "demos/bfs-demo.html")
    piece_bytes = harvest_demo("/work/examples/huda-demo.eigendeck", "demos/demo_block_model.html")
    svg_bytes = Path("/work/logo.svg").read_bytes()
    pdf_bytes = Path("/work/gitignore/examples/eigendeck-test-asset.pdf").read_bytes()
    nb_bytes = Path("/work/example-notebooks/hello.ipynb").read_bytes()

    conn, t = write_deck([], title="Export Stress Test", theme="white",
                         config={"mathPreamble": PREAMBLE})
    try:
        # Insert assets, capture ids + the display path each element references.
        a_img = insert_asset(conn, data=img_bytes, mime="image/png", path=img_path, t=t)
        a_demo = insert_asset(conn, data=demo_bytes, mime="text/html",
                              path="demos/bfs-demo.html", t=t)
        a_piece = insert_asset(conn, data=piece_bytes, mime="text/html",
                               path="demos/demo_block_model.html", t=t)
        a_svg = insert_asset(conn, data=svg_bytes, mime="image/svg+xml",
                             path="images/logo.svg", t=t)
        a_pdf = insert_asset(conn, data=pdf_bytes, mime="application/pdf",
                             path="images/test.pdf", t=t)
        a_nb = insert_asset(conn, data=nb_bytes, mime="application/x-ipynb+json",
                            path="notebooks/hello.ipynb", t=t)

        slides: list[dict] = []

        # 1. Cover / title slide
        slides.append(slide([
            text("title", "Export Stress Test", x=80, y=380, width=1760, height=160,
                 verticalAlign="middle"),
            text("body", "Auditing HTML / PDF / Print export across every theme, font, "
                 "preset, element type, and math. $E = mc^2$ &middot; $\\int_0^1 x\\,dx = "
                 "\\tfrac12$", x=80, y=560, width=1760, height=160),
            text("footnote", "test-presentations/export-stress.eigendeck"),
        ]))

        # 2-5. One slide per theme, with title/body/annotation/footnote + math.
        for th in THEMES:
            slides.append(slide([
                text("title", f"Theme: {th.capitalize()}"),
                text("body", "Background, body text, headings, accent, muted should all "
                     "follow the theme. Inline $\\sum_{i=1}^n \\lambda_i$ and display:<br>"
                     "$$\\veca{A}\\veca{x} = \\lambda \\veca{x}$$"),
                text("annotation", "Accent-colored annotation (theme accent)."),
                text("footnote", f"Footnote, muted color, {th} theme."),
            ], theme=th, notes=f"per-slide theme override = {th}"))

        # 6-9. Cover-over-content on each theme background (cover must match bg).
        for th in THEMES:
            bg = {"white": "#ffffff", "light": "#f5f0e8",
                  "dark": "#1a1a2e", "black": "#000000"}[th]
            slides.append(slide([
                text("title", f"Cover on {th.capitalize()}"),
                text("body", "This body text sits UNDER the cover rectangle. If the cover "
                     "matches the slide background it hides this until revealed.<br><br>"
                     "Hidden line A.<br>Hidden line B.<br>Hidden line C."),
                # Cover whose color is set to the theme background; export must
                # honor the same bg so the cover blends. A bare-color cover (no
                # explicit color) should fall back to the slide bg.
                cover(bg, x=80, y=215, w=1760, h=600),
                cover("", x=80, y=850, w=900, h=120),  # color-less cover -> theme bg
                text("footnote", f"Cover color={bg} on {th} theme; plus a color-less cover."),
            ], theme=th, notes=f"cover over content, {th} theme"))

        # 10-18. One slide per font package (all presets use that font deck-wide
        #         via per-slide title/body/hype overrides).
        for fid, label in FONTS:
            slides.append(slide([
                text("title", f"Font: {label}"),
                text("body", f"id <i>{fid}</i>. The quick brown fox jumps over the lazy "
                     "dog. Math should follow this font: inline $\\alpha + \\beta = "
                     "\\gamma$, $f(x)=ax^2+bx+c$.<br><br>Display: "
                     "$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$"),
                text("hype", f"HYPE $\\pi \\approx 3.14$"),
                text("footnote", f"All presets in {fid}."),
            ], title_font=fid, body_font=fid, hype_font=fid, notes=f"font {fid}"))

        # 19. All 5 text presets + hype on one slide (default font).
        slides.append(slide([
            text("title", "All Text Presets"),
            text("body", "Body preset with <b>bold</b>, <i>italic</i>, and a "
                 "<ul><li>bullet $a^2+b^2=c^2$</li><li>second bullet</li></ul>",
                 x=80, y=200, width=900, height=500),
            text("textbox", "Textbox preset $\\lambda$", x=1020, y=220, width=800, height=200),
            text("annotation", "Annotation preset (italic, accent)."),
            text("hype", "HYPE!", x=1020, y=460, width=800, height=200),
            text("footnote", "Footnote preset (narrow, muted)."),
        ]))

        # 20. Image: raster PNG + arrow annotation.
        slides.append(slide([
            text("title", "Image: Raster PNG"),
            image(a_img, img_path, "raster", x=300, y=220, w=1320, h=680),
            arrow(200, 600, 480, 480, "#e11d48"),
            text("footnote", f"Raster image from {img_path}."),
        ]))

        # 21. Image: SVG (vector).
        slides.append(slide([
            text("title", "Image: SVG (vector)"),
            image(a_svg, "images/logo.svg", "svg", x=560, y=240, w=800, h=640),
            text("footnote", "SVG image — exported as data:image/svg+xml."),
        ]))

        # 22. Image: PDF (vector, kind=pdf).
        slides.append(slide([
            text("title", "Image: PDF (kind=pdf)"),
            image(a_pdf, "images/test.pdf", "pdf", x=560, y=240, w=800, h=640),
            text("footnote", "PDF image — editor rasterizes via asset_cache; "
                 "HTML export inlines raw bytes."),
        ]))

        # 23. Full interactive demo.
        slides.append(slide([
            text("title", "HTML Demo (full)", x=80, y=20, width=1760, height=120),
            demo(a_demo, "demos/bfs-demo.html", x=80, y=160, w=1760, h=820),
        ]))

        # 24. Demo-piece pair (two pieces of the same demo, BroadcastChannel).
        slides.append(slide([
            text("title", "Demo Pieces (BroadcastChannel)", x=80, y=20, width=1760, height=120),
            demo_piece(a_piece, "demos/demo_block_model.html", "graph",
                       x=80, y=160, w=860, h=820),
            demo_piece(a_piece, "demos/demo_block_model.html", "heatmap",
                       x=980, y=160, w=860, h=820),
        ]))

        # 25. Notebook.
        slides.append(slide([
            text("title", "Notebook", x=80, y=20, width=1760, height=120),
            notebook(a_nb, x=200, y=160, w=1520, h=820),
            text("footnote", "Jupyter/ipynb element."),
        ]))

        # 26. Video (YouTube embed).
        slides.append(slide([
            text("title", "Video (YouTube embed)"),
            video_embed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            text("footnote", "Embed-kind video element."),
        ]))

        # 27. Math-dense slide with custom preamble commands.
        slides.append(slide([
            text("title", "Math: Preamble Commands"),
            text("body", "Custom commands from the deck preamble: $f:\\R\\to\\R$, "
                 "vectors $\\veca{v}\\in\\R^n$.<br><br>"
                 "$$\\veca{x}\\cdot\\veca{y} = \\sum_i x_i y_i, \\qquad "
                 "\\Gamma(z+1) = z\\,\\Gamma(z)$$"
                 "Matrix: $\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$"),
            text("footnote", "Custom \\R and \\veca defined in mathPreamble."),
        ]))

        # 28. Closer with arrow + cover on dark theme.
        slides.append(slide([
            text("title", "End", x=80, y=380, width=1760, height=160,
                 verticalAlign="middle"),
            arrow(400, 700, 1500, 700, "#60a5fa"),
            text("footnote", "Export stress test complete."),
        ], theme="dark"))

        # Write all slides.
        for pos, s in enumerate(slides):
            cfg = s.get("config")
            conn.execute(
                "INSERT INTO slides (id, position, notes, group_id, config, valid_from, valid_to) "
                "VALUES (?,?,?,?,?,?,NULL)",
                (s["id"], pos, s.get("notes", ""), s.get("groupId"),
                 json.dumps(cfg, sort_keys=True) if cfg else None, t))
            for z, el in enumerate(s["elements"]):
                insert_element(conn, el, t)
                conn.execute(
                    "INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from, valid_to) "
                    "VALUES (?,?,?,?,NULL)", (s["id"], el["id"], z, t))

        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        nslides = conn.execute("SELECT COUNT(*) FROM slides WHERE valid_to IS NULL").fetchone()[0]
        nels = conn.execute("SELECT COUNT(*) FROM elements WHERE valid_to IS NULL").fetchone()[0]
        nass = conn.execute("SELECT COUNT(*) FROM assets WHERE valid_to IS NULL").fetchone()[0]
        print(f"=> {OUT} ({OUT.stat().st_size/1024:.0f} KB): "
              f"{nslides} slides, {nels} elements, {nass} assets")
    finally:
        conn.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
