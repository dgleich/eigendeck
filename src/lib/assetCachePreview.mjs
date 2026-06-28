/**
 * Pure helpers for resolving an element's cached preview PNG out of the
 * asset_cache table. Shared by the app export (src/store/fileOps.ts) and the
 * headless CLI export (src/export-cli.ts) so the two paths can't drift, and so
 * the logic is unit-testable without a Tauri backend (#85).
 */

/** PNG bytes → base64 data: URL. Inlined into exported HTML, where a blob: URL
 *  wouldn't survive in the written file. Chunked to avoid blowing the argument
 *  limit of String.fromCharCode on large images. */
export function pngBytesToDataUrl(bytes) {
  let binary = '';
  for (let k = 0; k < bytes.length; k += 8192) {
    binary += String.fromCharCode(...bytes.slice(k, k + 8192));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * Map an element to its asset_cache lookup key, or null if the element type has
 * no cached preview. Mirrors fileOps.getElementPreviewDataUrl / previewKey:
 *   - image kind:'pdf' → the pdfium raster, keyed by assetId + snapshotVariant
 *     (default '_');
 *   - notebook / video → the proactively-cached 'preview', keyed by the
 *     element's sync identity (syncId, falling back to id).
 */
export function previewLookupKey(el) {
  if (el.type === 'image' && el.kind === 'pdf') {
    return { sourceId: el.assetId, variant: el.snapshotVariant ?? '_' };
  }
  if (el.type === 'notebook' || el.type === 'video') {
    return { sourceId: el.syncId ?? el.id, variant: 'preview' };
  }
  return null;
}

/**
 * From the asset_cache variant rows for a source, pick the largest render
 * (most pixels) whose variant matches. Returns null if none match. Numeric
 * compare on width*height — not a string sort — so e.g. a 1024² tier beats 512².
 */
export function pickLargestVariant(variants, variant) {
  const matches = (variants || []).filter((v) => v.variant === variant);
  if (!matches.length) return null;
  matches.sort((a, b) => b.width * b.height - a.width * a.height);
  return matches[0];
}
