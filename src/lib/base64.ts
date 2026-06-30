/**
 * Uint8Array → base64 string. Chunked to stay under the argument-count limit of
 * String.fromCharCode on large buffers. Extracted to dedup the identical inline
 * loops that were scattered across App.tsx / previewCache.ts (and friends).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.slice(i, i + 8192));
  return btoa(s);
}
