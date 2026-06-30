/** SHA-256 hex digest of a byte buffer (Web Crypto). Single source shared by the
 *  asset-versioning paths (assetInsert, watcherRegistry) that compare on-disk
 *  bytes to the stored asset — they must hash identically or change-detection
 *  silently breaks. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', buf as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
