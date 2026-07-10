#!/usr/bin/env python3
"""Build a macOS .icns iconset from an SVG document icon.

Renders the SVG once at high resolution, then Lanczos-downsamples to all
ten icns slots (16..512 at @1x and @2x). On macOS it will also invoke
iconutil to produce the final .icns.

Setup (per-machine venv with uv):
    uv venv venv-mac-studio
    source venv-mac-studio/bin/activate
    uv pip install cairosvg pillow

Usage:
    python build_icns.py doc-icon-final.svg --name eigendeck-doc
"""

import argparse
import pathlib
import platform
import shutil
import subprocess

import cairosvg
from PIL import Image

# (point size, scale) pairs required by iconutil
ICNS_SLOTS = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2),
              (256, 1), (256, 2), (512, 1), (512, 2)]


def render_master(svg_path, px=2048):
    """Rasterize the SVG once at high resolution."""
    out = pathlib.Path(f"/tmp/{svg_path.stem}-master.png")
    cairosvg.svg2png(url=str(svg_path), write_to=str(out),
                     output_width=px, output_height=px)
    return Image.open(out).convert("RGBA")


def build_iconset(master, name, outdir):
    """Write all icns slots into <name>.iconset using Lanczos downsampling."""
    iconset = outdir / f"{name}.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir(parents=True)
    for pt, scale in ICNS_SLOTS:
        px = pt * scale
        suffix = "" if scale == 1 else f"@{scale}x"
        img = master.resize((px, px), Image.LANCZOS)
        img.save(iconset / f"icon_{pt}x{pt}{suffix}.png")
    return iconset


def run_iconutil(iconset):
    """Produce the .icns via iconutil (macOS only)."""
    icns = iconset.with_suffix(".icns")
    if platform.system() == "Darwin" and shutil.which("iconutil"):
        subprocess.run(["iconutil", "-c", "icns", str(iconset),
                        "-o", str(icns)], check=True)
        return icns
    print(f"Not on macOS; run this on your Mac:\n"
          f"  iconutil -c icns {iconset} -o {icns}")
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("svg", type=pathlib.Path, help="Source SVG icon")
    ap.add_argument("--name", default="eigendeck-doc", help="Iconset base name")
    ap.add_argument("--outdir", type=pathlib.Path, default=pathlib.Path("."),
                    help="Output directory")
    ap.add_argument("--master-px", type=int, default=2048,
                    help="Master rasterization size")
    args = ap.parse_args()

    master = render_master(args.svg, args.master_px)
    iconset = build_iconset(master, args.name, args.outdir)
    print(f"Wrote {iconset} ({len(ICNS_SLOTS)} sizes)")
    icns = run_iconutil(iconset)
    if icns:
        print(f"Wrote {icns}")


if __name__ == "__main__":
    main()
