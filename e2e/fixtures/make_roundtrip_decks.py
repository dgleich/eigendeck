#!/usr/bin/env python3
# Decks for roundtrip-probe.mjs (sync/link/promote survive flush→export).
# Convert each to SQLite:  eigendeck-cli out.eigendeck import json this.json
import json, sys
def el(eid, x):
    return {"id": eid, "type": "text", "preset": "title", "html": eid,
            "position": {"x": x, "y": 100, "width": 300, "height": 80}}
decks = {
    # two independent elements on two slides → link A↔B, then promote A.
    "ab": {"title": "AB", "theme": "white", "config": {}, "slides": [
        {"id": "s1", "elements": [el("A", 100)]},
        {"id": "s2", "elements": [el("B", 600)]}]},
    # one element, one slide → duplicate the slide.
    "a": {"title": "A", "theme": "white", "config": {}, "slides": [
        {"id": "s1", "elements": [el("A", 100)]}]},
}
which, out = sys.argv[1], sys.argv[2]
json.dump(decks[which], open(out, "w"))
print(f"wrote {out} ({which})")
