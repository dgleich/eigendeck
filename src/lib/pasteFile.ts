// Paste a copied FILE (from the OS file manager) onto the canvas (#160).
//
// The clipboard carries only a path/URI reference, not bytes — this module holds
// the PURE logic for turning those references into insertable assets: parse the
// platform clipboard shapes (macOS file-url / NSFilenames plist, Linux
// text/uri-list / gnome-copied-files, Windows CF_HDROP paths) into file paths,
// and decide which paths are asset-appropriate + their canonical mime/ext.
// Reading the bytes (readFileNative, gated) and inserting (insertPastedAsset) live
// in the paste handler; this is unit-tested in isolation.

import { detectAssetKind, type AssetKind } from './assetCache';

/** Accepted asset extensions → canonical mime. Anything else is rejected (we
 *  don't paste arbitrary files — only image/vector/pdf the app can render). */
const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  tif: 'image/tiff', tiff: 'image/tiff',
  bmp: 'image/bmp',
  svg: 'image/svg+xml', svgz: 'image/svg+xml',
  pdf: 'application/pdf',
};

export interface PastedFileRef {
  path: string;
  fileName: string;
  ext: string;
  mime: string;
  kind: AssetKind;
}

/** Decode a `file://` URL (or a bare path) to an absolute filesystem path.
 *  Percent-decodes, strips the scheme + host, and normalizes. Returns null for a
 *  non-file scheme (http:, data:, …) so remote refs never reach the disk read. */
export function fileUrlToPath(ref: string): string | null {
  const s = (ref || '').trim();
  if (!s) return null;
  // A Windows drive path (C:\… or C:/…) looks like a scheme — accept it as a bare
  // path before the scheme check below claims `C:` as a scheme.
  if (/^[a-zA-Z]:[\\/]/.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    // Has a scheme — must be file:.
    const m = s.match(/^file:\/\/([^/]*)(\/.*)$/i);
    if (!m) return null;
    // m[1] is an (ignored) host/authority; m[2] is the absolute path.
    try { return decodeURIComponent(m[2]); } catch { return null; }
  }
  // No scheme → treat as a bare absolute path (NSFilenames / CF_HDROP give these).
  return s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s) ? s : null;
}

/** Basename of a path (handles both / and \\ separators). */
function baseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** Turn a resolved file path into an insertable asset ref, or null when the
 *  extension isn't an accepted asset type. */
export function assetRefForPath(path: string): PastedFileRef | null {
  const fileName = baseName(path);
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const mime = EXT_MIME[ext];
  if (!mime) return null;
  return { path, fileName, ext, mime, kind: detectAssetKind(fileName, mime) };
}

/** Parse a `text/uri-list` payload (RFC 2483: CRLF-separated URIs, `#` comment
 *  lines ignored) into file paths. Non-file URIs are dropped. */
export function parseUriList(text: string): string[] {
  return (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(fileUrlToPath)
    .filter((p): p is string => !!p);
}

/** Parse GNOME's `x-special/gnome-copied-files` (first line is `copy`/`cut`, then
 *  file:// URIs) into file paths. */
export function parseGnomeCopiedFiles(text: string): string[] {
  const lines = (text || '').split(/\r?\n/);
  // Drop a leading `copy`/`cut` op line if present.
  const start = /^(copy|cut)$/i.test((lines[0] || '').trim()) ? 1 : 0;
  return lines.slice(start)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(fileUrlToPath)
    .filter((p): p is string => !!p);
}

/** From a list of resolved paths, the asset-appropriate refs (in order, deduped
 *  by path). Non-asset files are silently skipped. */
export function assetRefsFromPaths(paths: readonly string[]): PastedFileRef[] {
  const seen = new Set<string>();
  const out: PastedFileRef[] = [];
  for (const p of paths) {
    if (seen.has(p)) continue;
    seen.add(p);
    const ref = assetRefForPath(p);
    if (ref) out.push(ref);
  }
  return out;
}
