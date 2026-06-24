#!/usr/bin/env python3
"""Regenerate the grayscale test images embedded in tiled-svd.html.

The demo (a live, interactive version of Figure 1 from
  David F. Gleich, "Better than best low-rank approximation with the
  singular value decomposition", arXiv:2402.18427)
ships three public-domain 128x128 grayscale photos from scikit-image
(camera, text, moon), embedded as raw bytes (base64) so the SVDs can be
computed live in JS with no external fetch.

Run:  uv run --with numpy --with scikit-image --with pillow tiled-svd-images.py
Then paste the printed JSON into tiled-svd.html in place of __IMAGES__.
"""
import base64, json
import numpy as np
from skimage import data, transform
from PIL import Image  # noqa: F401  (kept for parity with the build)

SRC = [("camera", data.camera, "Cameraman"),
       ("text",   data.text,   "Text"),
       ("moon",   data.moon,   "Moon")]
out = {}
for name, fn, label in SRC:
    im = np.asarray(fn(), dtype=float)
    h, w = im.shape[:2]; s = min(h, w)
    im = im[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s]
    g = (transform.resize(im, (128, 128), anti_aliasing=True) * 255).clip(0, 255).astype(np.uint8)
    out[name] = {"w": 128, "h": 128, "label": label,
                 "data": base64.b64encode(g.tobytes()).decode()}
print(json.dumps(out))
