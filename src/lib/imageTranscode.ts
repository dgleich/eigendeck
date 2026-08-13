// Transcode arbitrary image bytes to PNG via the WebView's own decoder.
//
// The clipboard/paste path stores PNG/JPEG/SVG/PDF directly, but macOS apps
// (Preview especially) put HEIC / TIFF on the pasteboard for a copied image —
// formats the deck can't render everywhere (a raw HEIC/TIFF asset would only
// display in Mac WebKit, and would break export + non-Mac viewers). WebKit CAN
// decode HEIC and TIFF into an <img>, so we round-trip through a canvas to get a
// universally-renderable PNG (#178).
//
// Returns null if the running WebView can't decode the input (e.g. HEIC on a
// platform without the system codec) — the caller then falls through to the next
// paste candidate rather than storing an unrenderable blob.

/** Decode `bytes` (of MIME `sourceMime`) and re-encode as PNG. null on failure. */
export async function transcodeImageToPng(bytes: Uint8Array, sourceMime: string): Promise<Uint8Array | null> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: sourceMime }));
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'));
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null; // WebView couldn't decode this format
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = src;
  });
}
