# `.eigendeck` document icon

Source assets for the macOS document icon shown on `.eigendeck` files (title-bar
proxy + Finder). Wiring it into the bundle is tracked in
[issue #130](https://github.com/dgleich/eigendeck/issues/130).

- `eigendeck-doc.svg` — the canonical source artwork.
- `eigendeck-doc-1024.png` — a 1024px raster (preview / master).
- `eigendeck-doc.iconset/` — the ten `iconutil` slots (16–512 @1x/@2x),
  Lanczos-downsampled from the SVG. This is the direct input to `iconutil`.

## Building the `.icns`

**No-deps path (macOS, uses the committed iconset):**

```bash
iconutil -c icns src-tauri/icons/document/eigendeck-doc.iconset \
  -o src-tauri/icons/document/eigendeck-doc.icns
```

**From the SVG (regenerate the iconset first — needs cairosvg + pillow):**

```bash
uv venv venv && source venv/bin/activate && uv pip install cairosvg pillow
python tools/build_doc_icns.py src-tauri/icons/document/eigendeck-doc.svg \
  --name eigendeck-doc --outdir src-tauri/icons/document
# on macOS this also runs iconutil and writes eigendeck-doc.icns
```

**Commit the built `eigendeck-doc.icns`** alongside these sources (like
`icons/icon.icns`) — it's referenced from `tauri.conf.json` `bundle.resources`, so
the bundle needs it present. Rebuild + recommit when the SVG changes.

Remaining wiring (see #130): the doc icon still needs `CFBundleTypeIconFile` set
for the `.eigendeck` type. Tauri generates `CFBundleDocumentTypes` from
`fileAssociations` (no icon field), so this needs a custom `Info.plist` or a
post-build `PlistBuddy` patch — verify on a Mac `tauri build`.
