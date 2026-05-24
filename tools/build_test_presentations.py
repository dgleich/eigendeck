#!/usr/bin/env python3
"""
build_test_presentations.py — Generate a suite of .eigendeck test files.

Each output file under /work/test-presentations/ exercises a specific axis
of the new multi-font + per-preset math + theme features. The intent is
that the user (David) opens each in the Eigendeck app, saves once (which
populates math_cache), and exports to HTML to verify rendering.

We write SQLite directly using the same temporal schema as
src-tauri/src/storage.rs (schema version 2).

Per-slide overrides (theme, titleFont, bodyFont, hypeFont) live in a
single `slides.config` JSON column. Absent = inherit from presentation
defaults. NULL when the slide has no overrides at all (most slides).

Presentation-level config (defaultTitleFont, defaultBodyFont,
defaultHypeFont, theme, etc.) lives in the `presentation` key/value
table as the 'config' row's JSON value.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import sqlite3
import sys
import threading
import uuid
from pathlib import Path
from typing import Any

OUT_DIR = Path("/work/test-presentations")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Schema (mirrors src-tauri/src/storage.rs::create_schema)
# ---------------------------------------------------------------------------

SCHEMA_SQL = """
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
    -- v2: per-slide overrides as JSON (theme, titleFont, bodyFont, hypeFont).
    -- NULL when the slide has no overrides; absent keys = inherit.
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

-- Temporal assets table (see src-tauri/src/storage.rs for details).
-- asset_id is the stable identity; path is a non-unique display label.
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
CREATE INDEX IF NOT EXISTS idx_assets_path ON assets(path) WHERE valid_to IS NULL;

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

CREATE INDEX IF NOT EXISTS idx_el_current ON elements(valid_to) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_el_id ON elements(id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_se_slide ON slide_elements(slide_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_se_element ON slide_elements(element_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_slides_current ON slides(valid_to) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_el_link ON elements(link_id) WHERE valid_to IS NULL AND link_id IS NOT NULL;
"""

SCHEMA_VERSION = "2"

# ---------------------------------------------------------------------------
# Timestamp generator (matches storage.rs format: ISO8601-ms + 8-digit counter)
# ---------------------------------------------------------------------------

_ts_counter = 0
_ts_lock = threading.Lock()
_ts_base: str | None = None


def _now_iso_ms() -> str:
    n = _dt.datetime.utcnow()
    return n.strftime("%Y-%m-%dT%H:%M:%S.") + f"{n.microsecond // 1000:03d}Z"


def make_timestamp(base: str | None = None) -> str:
    """Generate a unique ordered timestamp string."""
    global _ts_counter
    with _ts_lock:
        seq = _ts_counter
        _ts_counter += 1
    iso = base or _now_iso_ms()
    return f"{iso}-{seq:08d}"


# ---------------------------------------------------------------------------
# Element factories
# ---------------------------------------------------------------------------

# Default positions per preset (mirrors src/types/presentation.ts)
PRESET_DEFAULTS: dict[str, dict[str, int]] = {
    "title":      {"x": 80,  "y": 20,   "width": 1760, "height": 200},
    "body":       {"x": 80,  "y": 215,  "width": 1760, "height": 765},
    "textbox":    {"x": 200, "y": 300,  "width": 800,  "height": 300},
    "annotation": {"x": 200, "y": 700,  "width": 600,  "height": 150},
    "footnote":   {"x": 80,  "y": 1020, "width": 1000, "height": 44},
    "hype":       {"x": 200, "y": 400,  "width": 1520, "height": 280},
}

VALID_PRESETS = set(PRESET_DEFAULTS.keys())


def new_uuid() -> str:
    return str(uuid.uuid4())


def text_element(
    preset: str,
    html: str,
    *,
    x: int | None = None,
    y: int | None = None,
    width: int | None = None,
    height: int | None = None,
    vertical_align: str | None = None,
    font_size: int | None = None,
    color: str | None = None,
    font_family: str | None = None,
    link_id: str | None = None,
    sync_id: str | None = None,
    elem_id: str | None = None,
) -> dict[str, Any]:
    """Build a TextElement dict suitable for storage in elements.data JSON."""
    if preset not in VALID_PRESETS:
        raise ValueError(f"unknown preset: {preset!r}")
    pos = dict(PRESET_DEFAULTS[preset])
    if x is not None: pos["x"] = x
    if y is not None: pos["y"] = y
    if width is not None: pos["width"] = width
    if height is not None: pos["height"] = height

    el: dict[str, Any] = {
        "id": elem_id or new_uuid(),
        "type": "text",
        "preset": preset,
        "html": html,
        "position": pos,
    }
    if vertical_align is not None:
        el["verticalAlign"] = vertical_align
    if font_size is not None:
        el["fontSize"] = font_size
    if color is not None:
        el["color"] = color
    if font_family is not None:
        el["fontFamily"] = font_family
    if link_id is not None:
        el["linkId"] = link_id
    if sync_id is not None:
        el["syncId"] = sync_id
    return el


# ---------------------------------------------------------------------------
# Slide builder
# ---------------------------------------------------------------------------

def make_slide(
    *,
    elements: list[dict[str, Any]] | None = None,
    notes: str = "",
    group_id: str | None = None,
    theme: str | None = None,
    title_font: str | None = None,
    body_font: str | None = None,
    hype_font: str | None = None,
    slide_id: str | None = None,
) -> dict[str, Any]:
    """Build a slide dict for the v2 schema.

    Per-slide theme/font overrides become a `config` JSON blob written to
    the slides.config column. Absent fields = inherit (cascade through
    presentation defaults). Most slides will have config = NULL.
    """
    overrides: dict[str, Any] = {}
    if theme is not None:        overrides["theme"] = theme
    if title_font is not None:   overrides["titleFont"] = title_font
    if body_font is not None:    overrides["bodyFont"] = body_font
    if hype_font is not None:    overrides["hypeFont"] = hype_font

    return {
        "id": slide_id or new_uuid(),
        "elements": elements or [],
        "notes": notes,
        "groupId": group_id,
        "config": overrides if overrides else None,
    }


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------

def _strip_link_sync(el: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
    """Strip linkId/syncId from element payload (they live in junction/cols)."""
    cleaned = {k: v for k, v in el.items() if k not in ("syncId", "_syncId", "linkId", "_linkId")}
    return cleaned, el.get("linkId")


def write_eigendeck(
    path: str | os.PathLike,
    *,
    title: str,
    theme: str = "white",
    config: dict[str, Any] | None = None,
    slides: list[dict[str, Any]],
) -> None:
    """Write a presentation to a .eigendeck SQLite file."""
    p = Path(path)
    if p.exists():
        p.unlink()

    cfg = {
        "transition": "slide",
        "backgroundTransition": "fade",
        "width": 1920,
        "height": 1080,
        "showSlideNumber": True,
        "author": "",
        "venue": "",
    }
    if config:
        cfg.update(config)

    conn = sqlite3.connect(str(p))
    try:
        conn.executescript(SCHEMA_SQL)
        conn.execute(
            "INSERT OR REPLACE INTO _meta(key, value) VALUES ('schema_version', ?)",
            (SCHEMA_VERSION,),
        )

        # Presentation rows
        conn.execute("INSERT INTO presentation(key, value) VALUES ('title', ?)", (title,))
        conn.execute("INSERT INTO presentation(key, value) VALUES ('theme', ?)", (theme,))
        conn.execute(
            "INSERT INTO presentation(key, value) VALUES ('config', ?)",
            (json.dumps(cfg, separators=(",", ":"), sort_keys=True),),
        )

        ts_base = _now_iso_ms()

        # Track elements we've already inserted (sync handling)
        inserted_elements: set[str] = set()
        sync_map: dict[str, str] = {}

        for pos, slide in enumerate(slides):
            slide_ts = make_timestamp(ts_base)
            cfg = slide.get("config")
            cfg_json = json.dumps(cfg, sort_keys=True) if cfg else None
            conn.execute(
                "INSERT INTO slides(id, position, notes, group_id, config, valid_from, valid_to) "
                "VALUES (?, ?, ?, ?, ?, ?, NULL)",
                (
                    slide["id"],
                    pos,
                    slide.get("notes", ""),
                    slide.get("groupId"),
                    cfg_json,
                    slide_ts,
                ),
            )

            for z, el in enumerate(slide.get("elements", [])):
                el_id: str = el["id"]
                el_type: str = el["type"]
                sync_id = el.get("syncId")
                link_id = el.get("linkId")

                element_id = el_id

                if sync_id and sync_id in sync_map:
                    # Already inserted; just add junction row pointing to existing element
                    existing_id = sync_map[sync_id]
                    je_ts = make_timestamp(ts_base)
                    conn.execute(
                        "INSERT INTO slide_elements(slide_id, element_id, z_order, valid_from, valid_to) "
                        "VALUES (?, ?, ?, ?, NULL)",
                        (slide["id"], existing_id, z, je_ts),
                    )
                    continue

                if sync_id:
                    sync_map[sync_id] = element_id

                if element_id not in inserted_elements:
                    cleaned, _ = _strip_link_sync(el)
                    el_ts = make_timestamp(ts_base)
                    conn.execute(
                        "INSERT INTO elements(id, type, data, link_id, valid_from, valid_to) "
                        "VALUES (?, ?, ?, ?, ?, NULL)",
                        (
                            element_id,
                            el_type,
                            json.dumps(cleaned, separators=(",", ":"), sort_keys=True),
                            link_id,
                            el_ts,
                        ),
                    )
                    inserted_elements.add(element_id)

                je_ts = make_timestamp(ts_base)
                conn.execute(
                    "INSERT INTO slide_elements(slide_id, element_id, z_order, valid_from, valid_to) "
                    "VALUES (?, ?, ?, ?, NULL)",
                    (slide["id"], element_id, z, je_ts),
                )

        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    finally:
        conn.close()


# ===========================================================================
# Test presentation generators
# ===========================================================================

# Convenience helpers for boilerplate slides

def make_title_body(
    title_html: str,
    body_html: str,
    *,
    theme: str | None = None,
    title_font: str | None = None,
    body_font: str | None = None,
    hype_font: str | None = None,
    notes: str = "",
    group_id: str | None = None,
    extras: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    elements = [
        text_element("title", title_html),
        text_element("body", body_html),
    ]
    if extras:
        elements.extend(extras)
    return make_slide(
        elements=elements,
        notes=notes,
        group_id=group_id,
        theme=theme,
        title_font=title_font,
        body_font=body_font,
        hype_font=hype_font,
    )


# ---------------------------------------------------------------------------
# 1. single-font-baseline: default PT Sans throughout
# ---------------------------------------------------------------------------

def gen_single_font_baseline() -> None:
    slides = [
        # Slide 1 — cover
        make_slide(

            elements=[
                text_element(
                    "title",
                    "Single Font Baseline",
                    x=80, y=400, width=1760, height=160,
                    vertical_align="middle",
                ),
                text_element(
                    "body",
                    "Default PT Sans throughout. No font overrides.",
                    x=80, y=580, width=1760, height=120,
                    vertical_align="top",
                ),
            ],
            notes="Verify that with no font overrides everything renders in PT Sans.",
        ),
        # Slide 2 — body with inline math
        make_title_body(
            "Inline Math",
            "Einstein's classic identity is $E = mc^2$, while sums look like "
            "$\\sum_{i=1}^{n} x_i$ and integrals like $\\int_0^1 f(x)\\,dx$.",
        ),
        # Slide 3 — display math
        make_slide(
            elements=[
                text_element("title", "Display Math"),
                text_element(
                    "body",
                    "$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$"
                    "<br>The Gaussian integral.",
                ),
            ],
        ),
        # Slide 4 — annotation + footnote
        make_slide(
            elements=[
                text_element("title", "Annotations and Footnotes"),
                text_element(
                    "body",
                    "Body text with <b>bold</b> and <i>italic</i> styling.",
                ),
                text_element(
                    "annotation",
                    "An italic blue annotation with $\\lambda$ inline.",
                ),
                text_element(
                    "footnote",
                    "Source: PT Sans Narrow footnote, $O(n \\log n)$ complexity.",
                ),
            ],
        ),
        # Slide 5 — bullet list with math
        make_slide(
            elements=[
                text_element("title", "Lists With Math"),
                text_element(
                    "body",
                    "<ul>"
                    "<li>Eigenvalue $\\lambda_1 \\geq \\lambda_2 \\geq \\ldots$</li>"
                    "<li>Trace identity $\\operatorname{tr}(AB) = \\operatorname{tr}(BA)$</li>"
                    "<li>Spectral radius $\\rho(A) = \\max_i |\\lambda_i|$</li>"
                    "</ul>",
                ),
                text_element(
                    "footnote",
                    "Five-slide PT Sans baseline.",
                ),
            ],
        ),
    ]
    write_eigendeck(
        OUT_DIR / "single-font-baseline.eigendeck",
        title="Single Font Baseline",
        theme="white",
        slides=slides,
    )


# ---------------------------------------------------------------------------
# 2. mixed-fonts-presentation: shantell body + libertinus title (default)
# ---------------------------------------------------------------------------

def gen_mixed_fonts_presentation() -> None:
    slides = []

    slides.append(make_slide(

        elements=[
            text_element("title", "Mixed Fonts",
                         x=80, y=400, width=1760, height=160,
                         vertical_align="middle"),
            text_element("body", "Title: Libertinus Serif &nbsp;|&nbsp; Body: Shantell Sans",
                         x=80, y=580, width=1760, height=120),
        ],
    ))

    slides.append(make_title_body(
        "Section One",
        "Each title uses Libertinus Serif (a classical serif). "
        "The body and bullets are typeset in Shantell Sans, "
        "a hand-drawn casual variable font. Math should follow the "
        "surrounding font: $\\alpha + \\beta = \\gamma$.",
    ))

    slides.append(make_slide(elements=[
        text_element("title", "Display Equations"),
        text_element("body",
            "Maxwell's equations in flat space:<br><br>"
            "$$\\nabla \\cdot E = \\frac{\\rho}{\\varepsilon_0}, \\quad "
            "\\nabla \\times B - \\mu_0 \\varepsilon_0 \\frac{\\partial E}{\\partial t} "
            "= \\mu_0 J$$"),
    ]))

    slides.append(make_slide(elements=[
        text_element("title", "Lists in Shantell"),
        text_element("body",
            "<ul>"
            "<li>The hand-drawn vibe is most obvious in long body text.</li>"
            "<li>Boldness comes from variable axis, not a separate weight.</li>"
            "<li>Italic is a separate file: $f(x) = ax^2 + bx + c$.</li>"
            "</ul>"),
    ]))

    slides.append(make_slide(elements=[
        text_element("title", "Mixed Fonts: Annotation"),
        text_element("body", "Body text with an annotation below."),
        text_element("annotation",
                     "Annotations also use the body font ($\\Rightarrow$ Shantell).",
                     y=850),
    ]))

    slides.append(make_slide(elements=[
        text_element("title", "Hype Preset"),
        text_element("hype", "BIG IDEA: $E = mc^2$"),
    ]))

    # Per-slide override: body font → Source Code (title stays Libertinus).
    # Exercises the slides.config bodyFont override path.
    slides.append(make_slide(body_font="source-code", elements=[
        text_element("title", "Code-ish Body"),
        text_element("body",
            "This slide overrides the body font to Source Code "
            "(the title is still Libertinus). "
            "Define $T(n) = T(n/2) + 1$. "
            "By the master theorem $T(n) \\in \\Theta(\\log n)$."),
    ]))

    slides.append(make_slide(

        elements=[
            text_element("title", "End", x=80, y=400, width=1760, height=160,
                         vertical_align="middle"),
            text_element("footnote", "Eight-slide mixed-font test.",
                         x=80, y=1020, width=1760, height=44),
        ],
    ))

    write_eigendeck(
        OUT_DIR / "mixed-fonts-presentation.eigendeck",
        title="Mixed Fonts Presentation",
        theme="white",
        config={
            "defaultTitleFont": "libertinus",
            "defaultBodyFont": "shantell",
        },
        slides=slides,
    )


# ---------------------------------------------------------------------------
# 3. per-slide-font-overrides: each slide overrides a different slot
# ---------------------------------------------------------------------------

def gen_per_slide_font_overrides() -> None:
    """Each slide has a per-slide font override on a different slot.

    NOTE: per-slide font overrides are NOT yet round-tripped by the
    storage layer (no columns in the slides table). The override is
    embedded in the notes column as a JSON sidecar so it's preserved
    in the file and visible to humans / future readers.
    """
    slides = [
        make_title_body(
            "Slide 1: Libertinus Title",
            "Title only is overridden to Libertinus Serif. "
            "Body remains presentation default (PT Sans). "
            "Math: $\\Gamma(z+1) = z\\,\\Gamma(z)$.",
            title_font="libertinus",
            notes="title font overridden to libertinus",
        ),
        make_title_body(
            "Slide 2: Concrete-Euler Body",
            "Body is overridden to CMU Concrete + Euler math. "
            "Title remains the presentation default. "
            "Math: $\\sum_{k=0}^{\\infty} \\frac{x^k}{k!} = e^x$.",
            body_font="concrete-euler",
            notes="body font overridden to concrete-euler",
        ),
        make_slide(
            elements=[
                text_element("title", "Slide 3: Noto-Sans Hype"),
                text_element("body",
                    "The hype callout below uses Noto Sans. "
                    "Title and body are presentation default."),
                text_element("hype", "$\\nabla^2 \\phi = 0$",
                             x=200, y=700, width=1520, height=200),
            ],
            hype_font="noto-sans",
            notes="hype font overridden to noto-sans",
        ),
        make_title_body(
            "Slide 4: Source-Sans Body",
            "Body is set to Source Sans 3, a workhorse sans. "
            "Adobe's Source family, variable. "
            "$P(\\text{rain}) = 0.42$.",
            body_font="source-sans",
        ),
        make_title_body(
            "Slide 5: Source-Code Body",
            "Body is set to Source Code Pro (monospace). "
            "Useful for code-heavy slides. "
            "Inline: $\\texttt{f(x) = x*2}$ vs $f(x) = 2x$.",
            body_font="source-code",
        ),
        make_title_body(
            "Slide 6: Shantell Title",
            "Title only is overridden to Shantell Sans. "
            "Body stays default. "
            "$\\zeta(s) = \\sum_n n^{-s}$.",
            title_font="shantell",
        ),
        make_title_body(
            "Slide 7: lm-sans Body",
            "Body uses CMU Sans Serif (lm-sans). "
            "Pairs with NewCM Sans Math. "
            "$\\binom{n}{k} = \\frac{n!}{k!(n-k)!}$.",
            body_font="lm-sans",
        ),
        make_title_body(
            "Slide 8: All Three Overridden",
            "Title=Libertinus Sans, Body=Concrete-Euler, Hype=Shantell.",
            title_font="libertinus-sans",
            body_font="concrete-euler",
            hype_font="shantell",
            extras=[
                text_element("hype", "WOW $\\pi \\approx 3.14$",
                             x=200, y=750, width=1520, height=200),
            ],
        ),
    ]
    write_eigendeck(
        OUT_DIR / "per-slide-font-overrides.eigendeck",
        title="Per-Slide Font Overrides",
        theme="white",
        slides=slides,
    )


# ---------------------------------------------------------------------------
# 4. math-heavy: lots of math, with mathPreamble custom commands
# ---------------------------------------------------------------------------

def gen_math_heavy() -> None:
    preamble = (
        "\\newcommand{\\R}{\\mathbb{R}}\n"
        "\\newcommand{\\E}{\\mathbb{E}}\n"
        "\\newcommand{\\N}{\\mathbb{N}}\n"
        "\\newcommand{\\veca}[1]{\\boldsymbol{#1}}\n"
    )
    slides = [
        make_slide(

            elements=[
                text_element("title", "Math Heavy",
                             x=80, y=400, width=1760, height=160,
                             vertical_align="middle"),
                text_element("body",
                    "Display, inline, fractions, integrals, Greek, "
                    "$\\boldsymbol{}$, $\\mathrm{}$, custom commands.",
                    x=80, y=580, width=1760, height=120),
            ],
        ),
        make_slide(elements=[
            text_element("title", "Display Math"),
            text_element("body",
                "$$\\int_{-\\infty}^{\\infty} \\frac{1}{\\sqrt{2\\pi}\\sigma}"
                " e^{-(x-\\mu)^2/(2\\sigma^2)}\\,dx = 1$$<br>"
                "$$\\sum_{k=0}^{\\infty} \\frac{x^k}{k!} = e^x$$"),
        ]),
        make_slide(elements=[
            text_element("title", "Inline Math Density"),
            text_element("body",
                "We have $a^2 + b^2 = c^2$, $\\frac{d}{dx} e^x = e^x$, "
                "$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$, "
                "$\\lim_{x\\to 0}\\frac{\\sin x}{x} = 1$, "
                "and $\\det(A - \\lambda I) = 0$ for eigenvalues."),
        ]),
        make_slide(elements=[
            text_element("title", "Greek (lower & upper)"),
            text_element("body",
                "Lowercase: $\\alpha\\beta\\gamma\\delta\\epsilon"
                "\\zeta\\eta\\theta\\iota\\kappa\\lambda\\mu\\nu"
                "\\xi\\pi\\rho\\sigma\\tau\\upsilon\\phi\\chi\\psi\\omega$<br><br>"
                "Uppercase: $\\Gamma\\Delta\\Theta\\Lambda\\Xi\\Pi\\Sigma"
                "\\Upsilon\\Phi\\Psi\\Omega$<br><br>"
                "Display: $$\\Gamma(\\alpha) = \\int_0^\\infty t^{\\alpha-1} e^{-t}\\,dt$$"),
        ]),
        make_slide(elements=[
            text_element("title", "Boldsymbol & mathrm"),
            text_element("body",
                "Plain: $\\alpha$ vs bold: $\\boldsymbol{\\alpha}$<br>"
                "Roman alpha: $\\mathrm{\\alpha}$ vs "
                "bold roman: $\\boldsymbol{\\mathrm{\\alpha}}$<br><br>"
                "$$\\boldsymbol{x} \\cdot \\boldsymbol{y} = \\sum_i x_i y_i$$"
                "$$\\mathrm{tr}(\\boldsymbol{A}\\boldsymbol{B}) = "
                "\\mathrm{tr}(\\boldsymbol{B}\\boldsymbol{A})$$"),
        ]),
        make_slide(elements=[
            text_element("title", "Custom Commands from Preamble"),
            text_element("body",
                "Functions $f: \\R \\to \\R$, expectations $\\E[X]$, "
                "naturals $\\N$.<br><br>"
                "$$\\E[X] = \\int_\\R x\\,p(x)\\,dx, \\qquad "
                "\\veca{v} \\in \\R^n$$<br>"
                "Use $\\veca{u}$ to denote a vector."),
            text_element("footnote",
                "All four custom commands defined in mathPreamble."),
        ]),
        make_slide(elements=[
            text_element("title", "Fractions and Roots"),
            text_element("body",
                "$$\\sqrt{1 + \\sqrt{1 + \\sqrt{1 + \\sqrt{1 + \\cdots}}}} "
                "= \\frac{1 + \\sqrt{5}}{2}$$<br>"
                "$$\\frac{\\partial^2 u}{\\partial t^2} = c^2 \\nabla^2 u$$"),
        ]),
        make_slide(elements=[
            text_element("title", "Matrices"),
            text_element("body",
                "$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} "
                "\\begin{pmatrix} x \\\\ y \\end{pmatrix} "
                "= \\begin{pmatrix} ax + by \\\\ cx + dy \\end{pmatrix}$$"),
        ]),
    ]
    write_eigendeck(
        OUT_DIR / "math-heavy.eigendeck",
        title="Math Heavy",
        theme="white",
        config={
            "mathPreamble": preamble,
        },
        slides=slides,
    )


# ---------------------------------------------------------------------------
# 5. all-themes: white, light, dark, black
# ---------------------------------------------------------------------------

def gen_all_themes() -> None:
    """One slide per built-in theme.

    Each slide overrides the theme. Per-slide theme overrides aren't
    persisted by the current SQLite schema, so this presentation is
    most useful for testing the *presentation*-level theme. To exercise
    each theme individually, set the file's top-level `theme` to the
    one you want to test, or split into four files.
    """
    slides = []
    for tname, label in [("white", "White"), ("light", "Light"),
                          ("dark", "Dark"), ("black", "Black")]:
        slides.append(make_slide(
            theme=tname,
            elements=[
                text_element("title", f"Theme: {label}"),
                text_element(
                    "body",
                    f"Theme background, text, headings tested. "
                    f"Math sample: $\\sum_{{i=1}}^{{n}} x_i = \\bar{{x}} \\cdot n$. "
                    f"Annotation color is the theme accent.",
                ),
                text_element(
                    "annotation",
                    f"This is the accent color in the {label.lower()} theme.",
                    y=850,
                ),
                text_element(
                    "footnote",
                    f"Footnote in the {label.lower()} theme's muted color.",
                ),
            ],
            notes=(f"Per-slide theme override = '{tname}'. Currently "
                   "the schema does not persist this; set presentation "
                   "theme to test."),
        ))
    write_eigendeck(
        OUT_DIR / "all-themes.eigendeck",
        title="All Themes",
        theme="white",  # presentation default; slides try to override
        slides=slides,
    )

    # Also produce 4 single-theme files so we can actually test each one
    for tname, label in [("white", "White"), ("light", "Light"),
                          ("dark", "Dark"), ("black", "Black")]:
        slides_t = [make_slide(elements=[
            text_element("title", f"Theme: {label}"),
            text_element(
                "body",
                f"Math sample: $$\\sum_{{i=1}}^{{n}} x_i^2 \\geq "
                f"\\frac{{1}}{{n}}\\left(\\sum_{{i=1}}^{{n}} x_i\\right)^2.$$"
                f"<br>Body, $\\alpha$, $\\boldsymbol{{v}}$, "
                f"and an inline integral $\\int_0^1 x\\,dx = \\tfrac12$.",
            ),
            text_element("annotation", "Accent color sample.", y=850),
            text_element("footnote", "Muted footnote sample."),
        ])]
        write_eigendeck(
            OUT_DIR / f"theme-{tname}.eigendeck",
            title=f"Theme: {label}",
            theme=tname,
            slides=slides_t,
        )


# ---------------------------------------------------------------------------
# 6. all-fonts-showcase: one slide per font package
# ---------------------------------------------------------------------------

FONT_INFO = [
    ("ptsans", "PT Sans"),
    ("libertinus", "Libertinus Serif"),
    ("libertinus-sans", "Libertinus Sans"),
    ("lm-sans", "CMU Sans"),
    ("noto-sans", "Noto Sans"),
    ("source-sans", "Source Sans"),
    ("source-code", "Source Code"),
    ("shantell", "Shantell Sans"),
    ("concrete-euler", "CMU Concrete + Euler"),
]

LOREM = (
    "The quick brown fox jumps over the lazy dog. "
    "Pack my box with five dozen liquor jugs. "
    "Sphinx of black quartz, judge my vow."
)

MATH_SAMPLES = [
    "$E = mc^2$",
    "$\\int_a^b f(x)\\,dx$",
    "$\\sum_{i=1}^n i^2$",
    "$\\lim_{x\\to 0}\\frac{\\sin x}{x} = 1$",
    "$\\forall \\varepsilon > 0, \\exists \\delta > 0$",
]


def gen_all_fonts_showcase() -> None:
    """One slide per font package — set both titleFont and bodyFont.

    Per-slide font overrides are noted but the current schema does not
    persist them, so to truly test each font in isolation, also produce
    one tiny standalone .eigendeck per font (using presentation defaults).
    """
    slides = []
    for i, (fid, label) in enumerate(FONT_INFO):
        math = MATH_SAMPLES[i % len(MATH_SAMPLES)]
        slides.append(make_slide(
            title_font=fid,
            body_font=fid,
            hype_font=fid,
            elements=[
                text_element("title", f"Font: {label}"),
                text_element(
                    "body",
                    f"<b>id:</b> <i>{fid}</i><br><br>{LOREM}<br><br>"
                    f"Math: {math}<br>Display: $$\\boldsymbol{{x}}^T A \\boldsymbol{{x}} = "
                    f"\\sum_{{i,j}} a_{{ij}} x_i x_j$$",
                ),
                text_element("annotation", f"All slots set to '{fid}'.", y=900),
                text_element("footnote", f"Slide {i+1}/9 — font showcase."),
            ],
            notes=f"per-slide overrides set to {fid}",
        ))
    write_eigendeck(
        OUT_DIR / "all-fonts-showcase.eigendeck",
        title="All Fonts Showcase",
        theme="white",
        slides=slides,
    )

    # Also produce one standalone file per font (presentation defaults
    # — these will actually take effect when loaded).
    for i, (fid, label) in enumerate(FONT_INFO):
        math = MATH_SAMPLES[i % len(MATH_SAMPLES)]
        slides_f = [make_slide(elements=[
            text_element("title", f"Font: {label}"),
            text_element(
                "body",
                f"<b>id:</b> <i>{fid}</i><br><br>{LOREM}<br><br>"
                f"Inline: {math}<br>"
                f"Display: $$\\boldsymbol{{A}}\\boldsymbol{{x}} = \\lambda \\boldsymbol{{x}}$$",
            ),
            text_element("annotation", f"Font: {label} (presentation default)", y=900),
            text_element("footnote", f"Single-font showcase: {fid}."),
        ]),
        make_slide(elements=[
            text_element("title", "Greek + Math"),
            text_element(
                "body",
                "$\\alpha\\beta\\gamma\\delta\\epsilon\\zeta\\eta\\theta$ "
                "$\\iota\\kappa\\lambda\\mu\\nu\\xi\\pi\\rho\\sigma\\tau$ "
                "$\\Gamma\\Delta\\Theta\\Lambda\\Xi\\Pi\\Sigma\\Phi\\Psi\\Omega$"
                "<br><br>"
                "Custom math fonts shine on Greek letters, $\\boldsymbol{\\alpha}$, "
                "$\\mathrm{\\alpha}$, $\\boldsymbol{\\mathrm{\\alpha}}$.",
            ),
        ]),
        ]
        write_eigendeck(
            OUT_DIR / f"font-{fid}.eigendeck",
            title=f"Font: {label}",
            theme="white",
            config={
                "defaultTitleFont": fid,
                "defaultBodyFont": fid,
                "defaultHypeFont": fid,
            },
            slides=slides_f,
        )


# ---------------------------------------------------------------------------
# 7. hype-preset: large red callouts with math
# ---------------------------------------------------------------------------

def gen_hype_preset() -> None:
    slides = [
        make_slide(

            elements=[
                text_element("title", "Hype Preset",
                             x=80, y=120, width=1760, height=160,
                             vertical_align="middle"),
                text_element("hype",
                    "$E = mc^2$",
                    x=80, y=400, width=1760, height=280),
                text_element("footnote",
                    "Hype preset = 96px, bold, red default."),
            ],
        ),
        make_slide(elements=[
            text_element("title", "Hype With Punctuation"),
            text_element("hype", "BIG O OF $n \\log n$",
                         x=200, y=400, width=1520, height=280),
        ]),
        make_slide(elements=[
            text_element("title", "Hype Multiline"),
            text_element("hype",
                "$\\nabla \\cdot E = \\rho/\\varepsilon_0$<br>"
                "$\\nabla \\cdot B = 0$",
                x=80, y=350, width=1760, height=400),
        ]),
        make_slide(
            elements=[
                text_element("title", "Hype + Custom Font"),
                text_element("hype",
                    "WOW $\\sqrt{2}$",
                    x=200, y=400, width=1520, height=280),
            ],
            hype_font="shantell",
            notes="Hype overridden to Shantell.",
        ),
        make_slide(

            elements=[
                text_element("hype",
                    "$\\boldsymbol{A}\\boldsymbol{x} = \\boldsymbol{b}$",
                    x=80, y=400, width=1760, height=280),
            ],
        ),
    ]
    write_eigendeck(
        OUT_DIR / "hype-preset.eigendeck",
        title="Hype Preset",
        theme="white",
        slides=slides,
    )


# ---------------------------------------------------------------------------
# 8. groups-and-builds: progressive reveal via groupId
# ---------------------------------------------------------------------------

def gen_groups_and_builds() -> None:
    slides = []

    # Slide 1 — solo intro
    slides.append(make_slide(

        elements=[
            text_element("title", "Groups and Builds",
                         x=80, y=400, width=1760, height=160,
                         vertical_align="middle"),
            text_element("body",
                "Slides with the same groupId share a slide number "
                "and form a build sequence.",
                x=80, y=580, width=1760, height=200),
        ],
    ))

    # Group A — three slides, progressive reveal
    group_a = new_uuid()
    title_link = new_uuid()
    bullet1_link = new_uuid()
    bullet2_link = new_uuid()
    bullet3_link = new_uuid()

    # Slide 2 — group A, just title + bullet 1
    slides.append(make_slide(
        group_id=group_a,
        elements=[
            text_element("title", "Three Reasons",
                         link_id=title_link, sync_id=title_link),
            text_element("body",
                "<ul><li>Reason 1: it's elegant ($\\sqrt{2}$ irrational).</li></ul>",
                link_id=bullet1_link, sync_id=bullet1_link),
        ],
    ))

    # Slide 3 — group A, two bullets
    slides.append(make_slide(
        group_id=group_a,
        elements=[
            text_element("title", "Three Reasons",
                         link_id=title_link, sync_id=title_link),
            text_element("body",
                "<ul>"
                "<li>Reason 1: it's elegant ($\\sqrt{2}$ irrational).</li>"
                "<li>Reason 2: it's deep ($\\zeta(2) = \\pi^2/6$).</li>"
                "</ul>",
                link_id=bullet1_link, sync_id=bullet1_link),
        ],
    ))

    # Slide 4 — group A, all three bullets
    slides.append(make_slide(
        group_id=group_a,
        elements=[
            text_element("title", "Three Reasons",
                         link_id=title_link, sync_id=title_link),
            text_element("body",
                "<ul>"
                "<li>Reason 1: it's elegant ($\\sqrt{2}$ irrational).</li>"
                "<li>Reason 2: it's deep ($\\zeta(2) = \\pi^2/6$).</li>"
                "<li>Reason 3: it's beautiful ($e^{i\\pi} + 1 = 0$).</li>"
                "</ul>",
                link_id=bullet1_link, sync_id=bullet1_link),
        ],
    ))

    # Slide 5 — between groups
    slides.append(make_title_body(
        "Between Groups",
        "This single slide breaks the group sequence.",
    ))

    # Group B — two slides, animation via linkId only
    group_b = new_uuid()
    moving_id = new_uuid()
    slides.append(make_slide(
        group_id=group_b,
        elements=[
            text_element("title", "Animated Position"),
            text_element("body", "Watch $\\lambda$ move on the next slide."),
            text_element(
                "textbox",
                "$\\lambda$",
                x=200, y=500, width=200, height=200,
                font_size=128,
                link_id=moving_id,
            ),
        ],
    ))
    slides.append(make_slide(
        group_id=group_b,
        elements=[
            text_element("title", "Animated Position"),
            text_element("body", "Watch $\\lambda$ move on the next slide."),
            text_element(
                "textbox",
                "$\\lambda$",
                x=1500, y=700, width=200, height=200,
                font_size=128,
                link_id=moving_id,
                elem_id=new_uuid(),  # different element id, same linkId
            ),
        ],
    ))

    # Final summary
    slides.append(make_slide(elements=[
        text_element("title", "End"),
        text_element("body",
            "Group A had 3 slides sharing one number. "
            "Group B had 2 slides with a linked animation. "
            "Inline math should still render in each."),
        text_element("footnote", "groups-and-builds test."),
    ]))

    write_eigendeck(
        OUT_DIR / "groups-and-builds.eigendeck",
        title="Groups and Builds",
        theme="white",
        slides=slides,
    )


# ---------------------------------------------------------------------------
# 9. stress: 30+ slides, mixed everything, ~2 math expressions per slide
# ---------------------------------------------------------------------------

def gen_stress() -> None:
    fonts = [f[0] for f in FONT_INFO]
    themes = ["white", "light", "dark", "black"]

    # A small math vocabulary for variety (each slide picks 2)
    math_pool = [
        "$E = mc^2$",
        "$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$",
        "$\\int_0^1 x^2\\,dx = \\tfrac{1}{3}$",
        "$\\frac{d}{dx} \\sin x = \\cos x$",
        "$\\lim_{n\\to\\infty} (1 + 1/n)^n = e$",
        "$\\nabla \\cdot \\boldsymbol{E} = \\rho/\\varepsilon_0$",
        "$\\det(A - \\lambda I) = 0$",
        "$\\binom{n}{k} = \\frac{n!}{k!(n-k)!}$",
        "$\\pi \\approx 3.14159$",
        "$\\zeta(2) = \\pi^2/6$",
        "$e^{i\\pi} + 1 = 0$",
        "$\\sqrt{2} \\notin \\mathbb{Q}$",
        "$\\forall \\varepsilon > 0, \\exists \\delta > 0$",
        "$\\sum_{k=0}^\\infty \\frac{x^k}{k!} = e^x$",
        "$f \\circ g = g \\circ f$",
        "$\\operatorname{tr}(AB) = \\operatorname{tr}(BA)$",
        "$\\rho(A) = \\max_i |\\lambda_i|$",
        "$P(A \\cap B) = P(A) P(B|A)$",
        "$\\Gamma(z+1) = z\\,\\Gamma(z)$",
        "$\\boldsymbol{x} \\cdot \\boldsymbol{y} = x_1 y_1 + x_2 y_2$",
    ]

    display_pool = [
        "$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$",
        "$$\\sum_{n=1}^\\infty \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$",
        "$$\\nabla \\times \\boldsymbol{B} = \\mu_0\\boldsymbol{J} + \\mu_0\\varepsilon_0 \\frac{\\partial \\boldsymbol{E}}{\\partial t}$$",
        "$$\\boldsymbol{A}\\boldsymbol{x} = \\lambda \\boldsymbol{x}$$",
        "$$\\frac{\\partial u}{\\partial t} = \\alpha \\nabla^2 u$$",
        "$$\\binom{n}{k} = \\binom{n-1}{k-1} + \\binom{n-1}{k}$$",
    ]

    slides = []
    # Cover
    slides.append(make_slide(

        elements=[
            text_element("title", "Stress Test",
                         x=80, y=400, width=1760, height=160,
                         vertical_align="middle"),
            text_element("body",
                "30+ slides exercising fonts, themes, presets, math.",
                x=80, y=580, width=1760, height=200),
        ],
    ))

    # 30 content slides
    for i in range(30):
        m1 = math_pool[i % len(math_pool)]
        m2 = math_pool[(i * 3 + 1) % len(math_pool)]
        d  = display_pool[i % len(display_pool)]

        # Pick a font + theme deterministically; some slides have nothing
        fid = fonts[i % len(fonts)] if i % 2 == 0 else None
        theme = themes[i % len(themes)] if i % 5 == 0 else None

        # Sometimes hype, sometimes annotation, sometimes neither
        extras = []
        if i % 4 == 1:
            extras.append(text_element("hype", f"Big {m1}",
                                       x=200, y=750, width=1520, height=200))
        elif i % 4 == 2:
            extras.append(text_element("annotation",
                                       f"Note: {m2}", y=900))

        title_html = f"Slide {i+1}: Topic #{i+1}"
        body_html = (
            f"Inline math everywhere: {m1} and {m2}.<br><br>{d}"
        )

        # Group every 5 slides with the next two
        group_id = None
        if i % 5 in (1, 2):
            group_id = f"stress-group-{i // 5}"
            # ensure same id across the group window
            group_id = f"stress-group-{(i - (i % 5)) + 1}"

        slides.append(make_slide(
            theme=theme,
            title_font=fid if i % 8 == 0 else None,
            body_font=fid if i % 8 == 4 else None,
            hype_font=fid if i % 8 == 6 else None,
            group_id=group_id,
            elements=[
                text_element("title", title_html),
                text_element("body", body_html),
                *extras,
                text_element("footnote", f"stress-{i+1}/30"),
            ],
        ))

    # Closer
    slides.append(make_slide(

        elements=[
            text_element("title", "End", x=80, y=400, width=1760, height=160,
                         vertical_align="middle"),
            text_element("footnote",
                "Stress test complete.",
                x=80, y=1020, width=1760, height=44),
        ],
    ))

    write_eigendeck(
        OUT_DIR / "stress.eigendeck",
        title="Stress Test",
        theme="white",
        config={
            "mathPreamble": "\\newcommand{\\R}{\\mathbb{R}}",
        },
        slides=slides,
    )


# ===========================================================================
# Main
# ===========================================================================

def main() -> int:
    builders = [
        ("single-font-baseline", gen_single_font_baseline),
        ("mixed-fonts-presentation", gen_mixed_fonts_presentation),
        ("per-slide-font-overrides", gen_per_slide_font_overrides),
        ("math-heavy", gen_math_heavy),
        ("all-themes (+ 4 single-theme files)", gen_all_themes),
        ("all-fonts-showcase (+ 9 single-font files)", gen_all_fonts_showcase),
        ("hype-preset", gen_hype_preset),
        ("groups-and-builds", gen_groups_and_builds),
        ("stress", gen_stress),
    ]

    for name, fn in builders:
        try:
            fn()
            print(f"  OK  {name}")
        except Exception as e:  # noqa: BLE001
            print(f"  ERR {name}: {e}", file=sys.stderr)
            raise

    # Smoke test: open a few back and assert basic invariants
    print("\nSmoke test:")
    smoke_test(OUT_DIR / "math-heavy.eigendeck", expected_min_slides=6)
    smoke_test(OUT_DIR / "stress.eigendeck", expected_min_slides=30)
    smoke_test(OUT_DIR / "single-font-baseline.eigendeck", expected_min_slides=5)

    print("\nAll done. Files in:", OUT_DIR)
    return 0


def smoke_test(path: Path, *, expected_min_slides: int) -> None:
    conn = sqlite3.connect(str(path))
    try:
        # schema version
        v = conn.execute("SELECT value FROM _meta WHERE key='schema_version'").fetchone()
        assert v and v[0] == SCHEMA_VERSION, f"{path.name}: bad schema version {v}"

        # presentation rows
        rows = dict(conn.execute("SELECT key, value FROM presentation").fetchall())
        assert "title" in rows and "theme" in rows and "config" in rows, \
            f"{path.name}: missing presentation rows"

        # config is JSON
        config = json.loads(rows["config"])
        assert config.get("width") == 1920, f"{path.name}: width wrong"

        # slides
        ns = conn.execute("SELECT COUNT(*) FROM slides WHERE valid_to IS NULL").fetchone()[0]
        assert ns >= expected_min_slides, \
            f"{path.name}: expected >= {expected_min_slides} slides, got {ns}"

        # elements parse as JSON
        bad = 0
        for row in conn.execute(
            "SELECT id, data FROM elements WHERE valid_to IS NULL"
        ):
            try:
                d = json.loads(row[1])
                assert "id" in d and "type" in d
            except Exception:  # noqa: BLE001
                bad += 1
        assert bad == 0, f"{path.name}: {bad} elements failed to parse"

        # slide_elements integrity: every slide has at least one element
        cur = conn.execute(
            "SELECT s.id, COUNT(se.element_id) FROM slides s "
            "LEFT JOIN slide_elements se ON se.slide_id = s.id AND se.valid_to IS NULL "
            "WHERE s.valid_to IS NULL GROUP BY s.id"
        )
        empty = [sid for sid, n in cur.fetchall() if n == 0]
        # Some slides may legitimately have no elements; allow but warn.
        if empty:
            print(f"    ! {path.name}: {len(empty)} slide(s) with no elements")

        print(f"    OK  {path.name}: {ns} slides, "
              f"{conn.execute('SELECT COUNT(*) FROM elements WHERE valid_to IS NULL').fetchone()[0]} elements")
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
