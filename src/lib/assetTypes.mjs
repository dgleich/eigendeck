// The asset-type allowlist — the 0th-order gate for what Eigendeck may treat as a
// watchable/embeddable asset. See docs/ASSETS-SECURITY.md ("Watchable asset types").
//
// Two independent checks, both applied to the RESOLVED target's bytes/name:
//   1. isAllowedExtension(path)      — is the extension on the allowlist?
//   2. contentMatchesExtension(...)  — do the bytes actually match that type?
//                                      (native magic for interchange formats;
//                                       the eigendeck-demo marker for our .html)
//
// Pure + framework-free (Uint8Array/ArrayBuffer/string in; no DOM, runs in Node too)
// so the same rules serve the app, the CLI, and build tooling — one source of truth.

/** extension (lowercase, no dot) → asset kind. This IS the allowlist. */
export const ASSET_EXTENSIONS = Object.freeze({
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  svg: 'image',
  pdf: 'pdf',
  mp4: 'video', webm: 'video', mov: 'video',
  ipynb: 'notebook',
  html: 'demo',
});

/** Marker that identifies eigendeck's own demo format (see DEMO_AUTHORING.md). */
export const DEMO_MARKER_PREFIX = 'eigendeck-demo-v';
/** Demo-marker format versions this build understands. Unknown → fail closed. */
export const SUPPORTED_DEMO_VERSIONS = Object.freeze(new Set([1]));

/** Lowercased extension of a path/filename, without the dot; '' if none. */
export function extensionOf(path) {
  const base = String(path).split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** The asset kind for a path's extension, or null if not an allowed asset type. */
export function assetKindForPath(path) {
  return ASSET_EXTENSIONS[extensionOf(path)] ?? null;
}

/** Is this path's extension on the asset allowlist? */
export function isAllowedExtension(path) {
  return assetKindForPath(path) !== null;
}

// --- byte helpers -----------------------------------------------------------

/** First `n` bytes of the input (Uint8Array | ArrayBuffer | string) as a byte array. */
function toBytes(input, n) {
  if (typeof input === 'string') {
    const out = new Uint8Array(Math.min(input.length, n));
    for (let i = 0; i < out.length; i++) out[i] = input.charCodeAt(i) & 0xff;
    return out;
  }
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  return u8.subarray(0, n);
}

/** A latin1 (byte-preserving) string of the prefix, BOM stripped, for text sniffs. */
function prefixString(input, n = 512) {
  if (typeof input === 'string') {
    const s = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input; // BOM char
    return s.slice(0, n);
  }
  let b = toBytes(input, n + 3);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3); // UTF-8 BOM
  let s = '';
  for (let i = 0; i < b.length && i < n; i++) s += String.fromCharCode(b[i]);
  return s;
}

function startsWithBytes(input, sig, offset = 0) {
  const b = toBytes(input, offset + sig.length);
  if (b.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[offset + i] !== sig[i]) return false;
  return true;
}

// --- the eigendeck demo marker ----------------------------------------------

/**
 * Sniff the eigendeck-demo marker on a demo `.html` file's bytes.
 * Tolerates a leading BOM, whitespace, and an optional `<!DOCTYPE html>` before
 * the marker (marker sits right after the DOCTYPE to keep standards mode).
 * Returns { ok, version, supported }. `ok` = a well-formed marker was found;
 * `supported` = its version is one this build runs (fail-closed on unknown).
 */
export function isEigendeckDemo(input) {
  let s = prefixString(input, 512).replace(/^\s+/, '');
  const doctype = s.match(/^<!doctype\s+html\s*>/i);
  if (doctype) s = s.slice(doctype[0].length).replace(/^\s+/, '');
  // Canonical version only — no leading zeros ("exact bytes" contract). v01 is not
  // a valid marker, so it fails closed rather than aliasing to v1.
  const m = s.match(/^<!--eigendeck-demo-v([1-9]\d*)-->/);
  if (!m) return { ok: false, version: null, supported: false };
  const version = Number(m[1]);
  return { ok: true, version, supported: SUPPORTED_DEMO_VERSIONS.has(version) };
}

// --- native content identity per interchange format -------------------------

const MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff],
  gif: [0x47, 0x49, 0x46, 0x38], // "GIF8"
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // "%PDF-"
  webm: [0x1a, 0x45, 0xdf, 0xa3], // EBML
};

function isWebp(input) {
  const b = toBytes(input, 12);
  return b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50; // WEBP
}

function isMp4(input) {
  // ....ftyp at offset 4 (ISO base media / QuickTime)
  return startsWithBytes(input, [0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
}

function isSvg(input) {
  // Text/XML: a *leading* <svg root — after only an optional BOM/xml-decl/comments,
  // matching the spec's "<svg> root" (not merely an <svg somewhere in the file).
  return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(prefixString(input, 512));
}

/** Upper bound on a notebook we'll parse. Notebooks with embedded plot/image
 *  outputs get large, so this is generous; it only caps the one whole-file-parse
 *  path against a pathological input. */
export const NOTEBOOK_MAX_BYTES = 128 * 1024 * 1024;

function byteLength(input) {
  if (typeof input === 'string') return input.length;
  return input instanceof Uint8Array ? input.length : input.byteLength;
}

function isNotebookJson(input) {
  if (byteLength(input) > NOTEBOOK_MAX_BYTES) return false;
  try {
    const o = JSON.parse(prefixStringFull(input));
    return !!o && typeof o === 'object' && ('nbformat' in o || Array.isArray(o.cells));
  } catch { return false; }
}

// Notebooks need the whole file to JSON.parse, not just a prefix.
function prefixStringFull(input) {
  if (typeof input === 'string') return input;
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  return new TextDecoder('utf-8').decode(u8);
}

/** Interchange (non-demo) content identity by native magic / structural parse. */
function matchesInterchangeMagic(input, e) {
  switch (e) {
    case 'png': return startsWithBytes(input, MAGIC.png);
    case 'jpg': case 'jpeg': return startsWithBytes(input, MAGIC.jpg);
    case 'gif': return startsWithBytes(input, MAGIC.gif);
    case 'webp': return isWebp(input);
    case 'pdf': return startsWithBytes(input, MAGIC.pdf);
    case 'webm': return startsWithBytes(input, MAGIC.webm);
    case 'mp4': case 'mov': return isMp4(input);
    case 'svg': return isSvg(input);
    case 'ipynb': return isNotebookJson(input);
    default: return false;
  }
}

/**
 * Content-identity check → `{ ok, reason }`. THE single place the per-type content
 * rules live: our demo `.html` via the eigendeck marker (with the distinct
 * `unsupported-demo-version` reason), everything else via native magic. Both
 * `contentMatchesExtension()` and `assetTypeGate()` route through this, so the
 * rules can never diverge. `reason` is null on success, else `content-mismatch` |
 * `unsupported-demo-version`.
 */
export function checkContent(input, ext) {
  const e = String(ext).toLowerCase();
  if (e === 'html') {
    const d = isEigendeckDemo(input);
    if (!d.ok) return { ok: false, reason: 'content-mismatch' };
    if (!d.supported) return { ok: false, reason: 'unsupported-demo-version' };
    return { ok: true, reason: null };
  }
  return matchesInterchangeMagic(input, e)
    ? { ok: true, reason: null }
    : { ok: false, reason: 'content-mismatch' };
}

/** Boolean form of {@link checkContent}: do the bytes match the type its
 *  extension claims? (Interchange → native magic; demo `.html` → the marker.) */
export function contentMatchesExtension(input, ext) {
  return checkContent(input, ext).ok;
}

/**
 * The full 0th-order gate: allowed extension AND content that matches it.
 * Returns { ok, kind, reason }; `reason` is a short machine tag for the UI
 * ("bad-extension" | "content-mismatch" | "unsupported-demo-version").
 *
 * SECURITY CONTRACT — `resolvedRealPath` MUST be the fully `realpath`-resolved
 * target, never a deck-supplied reference name. The extension gate is judged on
 * this path, so the entire symlink defense (`a.png → id_rsa` must be judged as
 * `id_rsa`) depends on the caller resolving symlinks first. `input` must be the
 * bytes actually read from that resolved target. Passing an unresolved reference
 * is a security bug, not a convenience.
 */
export function assetTypeGate(input, resolvedRealPath) {
  const ext = extensionOf(resolvedRealPath);
  const kind = ASSET_EXTENSIONS[ext] ?? null;
  if (!kind) return { ok: false, kind: null, reason: 'bad-extension' };
  const c = checkContent(input, ext); // one code path; no per-site re-implementation
  return { ok: c.ok, kind, reason: c.reason };
}
