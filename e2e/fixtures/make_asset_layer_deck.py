#!/usr/bin/env python3
# Fixture for asset-layer-probe.mjs — a single slide exercising the asset layer:
#   • ap   raster image w/ a real embedded PNG AND an externalPath (drives the
#          AssetSection "linked source" / watch-toggle / Reload / version-history
#          branches, and — since the linked file doesn't exist on disk — the
#          missing-source detection path).
#   • asvg SVG image w/ a real embedded SVG (drives assetRenderer's svg render
#          path via the sidebar thumbnail + the canvas svg blob path).
#   • apdf PDF image w/ a tiny embedded 1-page PDF (drives assetRenderer's pdf
#          render path via pdfium — only rendered when the pdfium dylib is present
#          in the rig; the probe soft-guards that).
#   • amiss raster image referencing an assetId that has NO row in the DB — drives
#          assetRenderer's fetch-failure fallback (placeholder tile) AND
#          AssetSection's null-meta "Not yet stored" branch.
import base64, json, sys

# 1x1 transparent PNG
PNG_B64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2"
           "FzhVAAAAAElFTkSuQmCC")

SVG_STR = ('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90">'
           '<rect width="120" height="90" fill="#4488cc"/>'
           '<circle cx="60" cy="45" r="30" fill="#ffcc00"/></svg>')

PNG_ID, SVG_ID, PDF_ID = "al-png-1", "al-svg-1", "al-pdf-1"
MISSING_ID = "al-missing-does-not-exist"


def b64(s):
    return base64.b64encode(s.encode() if isinstance(s, str) else s).decode()


def minimal_pdf():
    """Build a valid single-page PDF (with correct xref byte offsets) so pdfium
    can rasterize it. Self-contained — no dependency on gitignore test files."""
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        None,  # content stream — filled below
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    stream = b"BT /F1 24 Tf 40 100 Td (Eigendeck PDF) Tj ET"
    objs[3] = b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream)

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref_pos = len(out)
    n = len(objs) + 1
    out += b"xref\n0 %d\n" % n
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\n" % n
    out += b"startxref\n%d\n%%%%EOF\n" % xref_pos
    return bytes(out)


def deck():
    elements = [
        {"id": "ap", "type": "image", "kind": "raster", "assetId": PNG_ID,
         "position": {"x": 80, "y": 80, "width": 300, "height": 240}},
        {"id": "asvg", "type": "image", "kind": "svg", "assetId": SVG_ID,
         "position": {"x": 460, "y": 80, "width": 300, "height": 240}},
        {"id": "apdf", "type": "image", "kind": "pdf", "assetId": PDF_ID,
         "position": {"x": 840, "y": 80, "width": 300, "height": 240}},
        {"id": "amiss", "type": "image", "kind": "raster", "assetId": MISSING_ID,
         "position": {"x": 1220, "y": 80, "width": 300, "height": 240}},
    ]
    return {
        "title": "Asset Layer",
        "theme": "white",
        "config": {"width": 1920, "height": 1080},
        "slides": [{"id": "s1", "layout": "default", "notes": "asset layer fixture",
                    "elements": elements}],
        "assets": [
            {"assetId": PNG_ID, "mime": "image/png", "path": "images/dot.png",
             "data": PNG_B64,
             # An externalPath whose file does NOT exist on disk — exercises the
             # linked-source UI + the missing-source detection branch (#74).
             "externalPath": "images/dot.png",
             "externalMtime": "2026-01-01T00:00:00.000Z"},
            {"assetId": SVG_ID, "mime": "image/svg+xml", "path": "images/shape.svg",
             "data": b64(SVG_STR)},
            {"assetId": PDF_ID, "mime": "application/pdf", "path": "images/mini.pdf",
             "data": b64(minimal_pdf())},
            # MISSING_ID intentionally absent → no DB row.
        ],
    }


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/asset_layer.json"
    with open(out, "w") as f:
        json.dump(deck(), f)
    print(f"wrote {out}")
