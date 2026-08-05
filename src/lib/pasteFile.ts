// Paste a copied FILE (from the OS file manager) onto the canvas (#160).
//
// PURE parsing of the platform clipboard shapes (macOS file-url / NSFilenames
// plist, Linux text/uri-list / gnome-copied-files, Windows CF_HDROP paths) into
// file PATHS. The paths are then inserted by the SAME insertFileFromPath that
// drag-drop uses (SlideEditor), so copy-from-Finder paste and drag are equivalent.
// This module is unit-tested in isolation.

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

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&'); // last, so &amp;lt; doesn't double-decode
}

/** Parse macOS `NSFilenamesPboardType` (a plist `<array>` of `<string>` POSIX
 *  paths or file:// URLs) into file paths. This is what Finder populates with the
 *  REAL path on a file copy — `public.file-url` there is a /.file/id= reference
 *  URL with no usable extension. Being an array, this also covers multi-file. */
export function parseNSFilenames(plistXml: string): string[] {
  const out: string[] = [];
  const re = /<string>([\s\S]*?)<\/string>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plistXml || ''))) {
    const val = decodeXmlEntities(m[1].trim());
    if (!val) continue;
    const p = fileUrlToPath(val);
    if (p) out.push(p);
  }
  return out;
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

