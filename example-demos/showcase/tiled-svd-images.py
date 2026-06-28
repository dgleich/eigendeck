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
from skimage.util import img_as_float, img_as_ubyte

SRC = [("camera", data.camera, "Cameraman"),
       ("text",   data.text,   "Text"),
       ("moon",   data.moon,   "Moon")]
SIZE = 384   # larger than 128 so low-rank compression artifacts are actually visible
out = {}
for name, fn, label in SRC:
    # img_as_float normalizes uint8 [0,255] → [0,1] regardless of skimage version
    # (newer transform.resize preserves the input range, so the old "*255" turned
    # a [0,255] image all-white). img_as_ubyte then maps [0,1] back to [0,255].
    im = img_as_float(fn())
    h, w = im.shape[:2]; s = min(h, w)
    im = im[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s]
    g = img_as_ubyte(transform.resize(im, (SIZE, SIZE), anti_aliasing=True).clip(0, 1))
    out[name] = {"w": SIZE, "h": SIZE, "label": label,
                 "data": base64.b64encode(g.tobytes()).decode()}
print(json.dumps(out))
