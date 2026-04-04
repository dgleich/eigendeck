# Eigendeck — Single File Format Plan

## Current Format

Eigendeck presentations are directories:

```
my-presentation/
  presentation.json       # All slide data
  demos/                  # Self-contained HTML demos
  images/                 # Image files
  presentation.backup-*.json  # Auto-save backups
```

This is great for development, hand-editing, and Claude Code editing. The JSON is human-readable and assets are normal files you can open directly.

## Goal

Support **both** a directory and a single `.eigendeck` file (ZIP with custom extension). The app should seamlessly open either format.

## Why ZIP

- Proven pattern: `.docx`, `.xlsx`, `.pptx`, `.key`, `.sketch` all use ZIP
- Apple switched `.pages` from macOS bundles to ZIP around 2013 — bundles didn't survive email/cloud/cross-platform transfer
- macOS bundles (`LSTypeIsPackage`) are macOS-only and break on FAT32, email attachments, cloud sync
- SQLite is robust but opaque — can't peek inside or hand-edit
- ZIP is universally supported and users can rename to `.zip` to inspect

## Design

### Open
- If path is a directory → open directly (current behavior)
- If path is a `.eigendeck` file → unzip to a temp directory, work with it
- Auto-detect based on filesystem: `fs.stat()` → directory or file

### Save
- If opened from a directory → save to directory (current behavior)
- If opened from a `.eigendeck` file → save back to the ZIP file
- Auto-save still writes to the temp directory; explicit Save repacks the ZIP

### New Project
- Default to `.eigendeck` (single file) for new projects
- "Save As Directory" option for power users / dev workflow

### Export
- "Export as .eigendeck" from a directory project (ZIP it up)
- "Export as Directory" from a single-file project (unzip it)

## Implementation Notes

### ZIP Library
- Use `@tauri-apps/plugin-fs` for file operations
- For ZIP packing/unpacking, options:
  - Rust-side: `zip` crate (most reliable, native speed)
  - JS-side: `fflate` or `jszip` (simpler, but slower for large assets)
- Rust-side recommended — add a Tauri command for pack/unpack

### Temp Directory
- On open `.eigendeck`: unzip to OS temp dir (`std::env::temp_dir()`)
- Track the original `.eigendeck` path and the temp working dir
- On Save: repack temp dir → original path
- On close: clean up temp dir (unless there are unsaved changes — prompt)

### File Association
- Register `.eigendeck` extension in Tauri config
- macOS: `Info.plist` file association
- Windows: registry association via installer
- Linux: `.desktop` file with MIME type

### Backup Strategy
- Backups stay in the working directory (temp dir for ZIP projects)
- On repack, exclude `presentation.backup-*.json` from the ZIP
- Or include them — TBD based on file size impact

### Migration
- Existing directory projects continue to work unchanged
- No format version bump needed — the JSON inside is identical

## Open Questions

1. Should auto-save repack the ZIP on every save, or only on explicit Cmd+S? (Repacking could be slow for large presentations with many images)
2. Should backups be included in the ZIP?
3. Default format for new projects: `.eigendeck` or directory?
4. Should we support drag-and-drop of `.eigendeck` files onto the app to open them?
