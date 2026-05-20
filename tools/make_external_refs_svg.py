#!/usr/bin/env python3
"""
Build a tiny SVG-with-external-image-refs test case.

Writes three files into
    test-presentations/_svg-fixtures/external-refs-demo/

  red.png      — small solid red square
  blue.png     — small solid blue square
  diagram.svg  — references both via ./red.png and ./blue.png

Drag diagram.svg into Eigendeck. You should see the
'Embed Snapshot of SVG and References' confirm dialog naming red.png
and blue.png. Accepting should rewrite the SVG with both PNGs inlined
as data: URIs and the sidebar thumbnail should re-render with the two
squares visible. Declining (Insert with missing References) should add
the element with both squares blank.

No deps: PNGs are constructed by hand with stdlib zlib/struct.
"""
import struct
import zlib
from pathlib import Path

OUT_DIR = Path("test-presentations/_svg-fixtures/external-refs-demo")


def solid_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Minimal solid-color RGB PNG (no alpha) — ~80 bytes for 64x64."""
    def chunk(typ: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(typ + data)
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", crc)
    # IHDR: width, height, bit_depth=8, color_type=2 (RGB), the rest = 0.
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    # IDAT: each scanline prefixed with filter byte 0 (no filter).
    scanline = b"\x00" + bytes(rgb) * width
    idat = zlib.compress(scanline * height)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )


SVG = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">
  <rect width="320" height="200" fill="#f8fafc"/>
  <text x="160" y="28" text-anchor="middle"
        font-family="Helvetica" font-size="16" fill="#0f172a">
    External refs — drag me in
  </text>
  <image x="40"  y="50" width="100" height="100" href="./red.png"/>
  <image x="180" y="50" width="100" height="100" href="./blue.png"/>
  <text x="90"  y="170" text-anchor="middle" font-family="Helvetica" font-size="11" fill="#475569">./red.png</text>
  <text x="230" y="170" text-anchor="middle" font-family="Helvetica" font-size="11" fill="#475569">./blue.png</text>
</svg>
"""

def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "red.png").write_bytes(solid_png(64, 64, (220, 40, 40)))
    (OUT_DIR / "blue.png").write_bytes(solid_png(64, 64, (40, 80, 220)))
    (OUT_DIR / "diagram.svg").write_text(SVG, encoding="utf-8")
    print(f"wrote {OUT_DIR}/")
    for p in sorted(OUT_DIR.iterdir()):
        print(f"  {p.name}  ({p.stat().st_size} bytes)")
    print()
    print(f"Drag {OUT_DIR/'diagram.svg'} into Eigendeck:")
    print("  - You should be offered to embed red.png and blue.png.")
    print("  - 'Embed Snapshot...': both squares visible, SVG self-contained after.")
    print("  - 'Insert SVG with missing References': both squares blank.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
