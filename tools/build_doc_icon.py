#!/usr/bin/env python3
"""Build the .eigendeck document icon (.iconset + .icns) from TWO masters.

macOS shows a single .icns everywhere a document appears (title-bar proxy,
Finder list/icon/gallery views, Get Info, the Dock), picking the size slot that
matches the display. We author two masters and let the OS switch by size:

  * SMALL master  -> the 16 & 32 pt slots. The "proxy" art (docs/icons-and-logos/
    proxy-icon.svg), drawn to still read at title-bar / list-view size.
  * LARGE master  -> the 128 / 256 / 512 pt slots. The three-slide mark
    (logo-icon-light.svg) composited onto Apple's GenericDocumentIcon template,
    so the document looks native at large sizes. This is also the QuickLook
    thumbnail fallback for files with no baked slide (issue #131).

The crossover is SMALL_SLOTS_PT below (Apple's convention: 16 & 32 pt simplified,
128 pt+ detailed).

Setup (per machine):
    uv venv venv-icons && uv pip install --python venv-icons cairosvg pillow

Apple template (Apple's art, kept OUT of git). Extract once on a Mac:
    iconutil -c iconset \\
      /System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericDocumentIcon.icns \\
      -o gitignore/generic-document-icon/GenericDocumentIcon.iconset

Usage:
    python tools/build_doc_icon.py             # -> src-tauri/icons/document/eigendeck-doc.{iconset,icns}
    python tools/build_doc_icon.py --preview   # also write a slot contact sheet + hero to docs previews
    python tools/build_doc_icon.py --out-dir DIR
"""
import argparse
import io
import pathlib
import platform
import shutil
import subprocess

import cairosvg
from PIL import Image

REPO = pathlib.Path(__file__).resolve().parent.parent
SMALL_MASTER = REPO / "docs/icons-and-logos/proxy-icon.svg"
MARK = REPO / "docs/icons-and-logos/logo-icon-light.svg"
TEMPLATE_DIR = REPO / "gitignore/generic-document-icon/GenericDocumentIcon.iconset"
OUT_DIR = REPO / "src-tauri/icons/document"
NAME = "eigendeck-doc"

SMALL_SLOTS_PT = {16, 32}   # point-size slots drawn from the SMALL (proxy) master
MARK_FRAC = 0.60            # mark width as a fraction of the page-body width
MARK_CY = 0.56              # mark centre-y within the page body (0 top .. 1 bottom)

# (point size, scale) -> the ten slots iconutil expects
ICNS_SLOTS = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1),
              (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)]


def render_svg(path, px):
    png = cairosvg.svg2png(url=str(path), output_width=px, output_height=px)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def render_mark(px_w):
    png = cairosvg.svg2png(url=str(MARK), output_width=px_w)
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    return im.crop(im.getbbox())


def template_reps():
    """px -> Image for every Apple template representation available."""
    reps = {}
    for f in TEMPLATE_DIR.glob("*.png"):
        im = Image.open(f).convert("RGBA")
        reps[im.width] = im  # square reps; equal sizes are equivalent
    return reps


def page_body_bbox(im):
    """Opaque page bounds (alpha>200), so the soft drop shadow is excluded."""
    a = im.split()[3].point(lambda v: 255 if v > 200 else 0)
    return a.getbbox()


def compose_large(px, reps):
    tpl = reps.get(px)
    if tpl is None:  # no exact rep -> take the next larger and downscale
        bigger = min((w for w in reps if w >= px), default=max(reps))
        tpl = reps[bigger].resize((px, px), Image.LANCZOS)
    out = tpl.copy()
    left, top, right, bottom = page_body_bbox(out)
    pw, ph = right - left, bottom - top
    mw = max(1, int(pw * MARK_FRAC))
    mk = render_mark(mw)
    mx = left + (pw - mw) // 2
    my = int(top + ph * MARK_CY - mk.height / 2)
    out.alpha_composite(mk, (mx, my))
    return out


def build_slot(pt, scale, reps):
    px = pt * scale
    if pt in SMALL_SLOTS_PT:
        return render_svg(SMALL_MASTER, px)
    return compose_large(px, reps)


def write_preview(built, reps):
    prev = REPO / "docs/icons-and-logos/previews"
    prev.mkdir(parents=True, exist_ok=True)
    bypx = {pt * scale: img for (pt, scale), img in built.items()}
    order = [16, 32, 64, 128, 256, 512]
    pad = 16
    H = max(order) + 2 * pad
    W = sum(s + pad for s in order) + pad
    sheet = Image.new("RGBA", (W, H), (214, 216, 220, 255))
    x = pad
    for s in order:
        im = bypx.get(s) or build_slot(s, 1, reps)
        sheet.alpha_composite(im.convert("RGBA"), (x, pad + (max(order) - s) // 2))
        x += s + pad
    sheet.convert("RGB").save(prev / "doc-icon-slots.png")
    if 1024 in bypx:
        bypx[1024].save(prev / "doc-icon-hero.png")
    print(f"wrote preview -> {prev}/doc-icon-slots.png (+ hero)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="write a slot contact sheet + hero to docs previews")
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    args = ap.parse_args()

    for p in (SMALL_MASTER, MARK):
        if not p.exists():
            raise SystemExit(f"missing master: {p}")
    if not TEMPLATE_DIR.exists():
        raise SystemExit(
            f"missing Apple template iconset: {TEMPLATE_DIR}\n"
            "extract it once on a Mac (see the module docstring)."
        )

    reps = template_reps()
    outdir = pathlib.Path(args.out_dir)
    iconset = outdir / f"{NAME}.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir(parents=True, exist_ok=True)

    built = {}
    for pt, scale in ICNS_SLOTS:
        img = build_slot(pt, scale, reps)
        suffix = "" if scale == 1 else "@2x"
        img.save(iconset / f"icon_{pt}x{pt}{suffix}.png")
        built[(pt, scale)] = img
    print(f"wrote {iconset} ({len(ICNS_SLOTS)} slots; "
          f"small master @ {sorted(SMALL_SLOTS_PT)} pt)")

    if platform.system() == "Darwin":
        icns = outdir / f"{NAME}.icns"
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(icns)], check=True)
        print(f"wrote {icns}")
    else:
        print("skipping iconutil (not macOS) -> run on a Mac to produce the .icns")

    if args.preview:
        write_preview(built, reps)


if __name__ == "__main__":
    main()
