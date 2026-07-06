#!/usr/bin/env python3
# Build an openable example deck around the live-crypto demo (declares a manifest
# for api.coingecko.com). Usage:
#   python3 example-demos/live-crypto/build.py /tmp/live-crypto.json
#   eigendeck-cli /tmp/live-crypto.eigendeck import json /tmp/live-crypto.json
import base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
html = open(os.path.join(HERE, 'live-crypto.html'), 'rb').read()

deck = {
    "title": "Live data demo (manifest)", "theme": "white", "config": {},
    "slides": [
        {"id": "s0", "elements": [
            {"id": "t0", "type": "text", "preset": "title",
             "text": "Live data, declared", "position": {"x": 120, "y": 200, "width": 840, "height": 90}},
            {"id": "t1", "type": "text", "preset": "body",
             "text": "The next slide's demo fetches live prices from api.coingecko.com. "
                     "It DECLARES that host in a manifest, so Eigendeck lets it reach only "
                     "that host and shows it in Security → Internet. Block it and the demo "
                     "keeps running, just offline.",
             "position": {"x": 120, "y": 310, "width": 840, "height": 160}},
        ]},
        {"id": "s1", "elements": [
            {"id": "d1", "type": "demo", "assetId": "crypto",
             "position": {"x": 90, "y": 90, "width": 900, "height": 460}}]},
    ],
    "assets": [{"assetId": "crypto", "mime": "text/html", "path": "live-crypto.html",
                "data": base64.b64encode(html).decode()}],
}
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/live-crypto.json'
json.dump(deck, open(out, "w")); print("wrote", out)
