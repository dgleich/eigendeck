# Deck with one image element carrying all visual props (shadow/borderRadius/opacity/
# rotation) + an embedded PNG asset, for the a4-image-visuals WYSIWYG probe.
import json, sys
PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
deck = {
    "title": "a4 image visuals", "theme": "white",
    "slides": [{"id": "s1", "layout": "default", "notes": "", "elements": [
        {"id": "imgVis", "type": "image", "assetId": "img1", "kind": "raster",
         "shadow": True, "borderRadius": 40, "opacity": 0.5, "rotation": 30,
         "position": {"x": 400, "y": 300, "width": 600, "height": 400}}
    ]}],
    "config": {"width": 1920, "height": 1080, "defaultTitleFont": "ptsans", "defaultBodyFont": "ptsans"},
    "assets": [{"assetId": "img1", "mime": "image/png", "path": "img.png", "data": PNG_B64}],
}
json.dump(deck, open(sys.argv[1], "w"))
print("wrote", sys.argv[1])
