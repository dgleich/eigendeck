// Render an asset (SVG today; PDF + demo snapshots in later commits) to a
// transparent PNG at a requested size, persisting the result to the SQLite
// asset_cache. Cache-first: existing entries are returned without re-render.
//
// Source bytes live in the `assets` table (db_store_asset / db_get_asset).
// This module reads them via Tauri invoke, rasterizes in-browser via canvas
// for SVG, and writes the PNG back through putAssetCache. The PDF path
// dispatches to a Rust-side renderer (pdfium) that will land in a later
// commit; until then it throws so callers fall back to source.

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  getAssetCache,
  putAssetCache,
  pngBytesToBlobUrl,
  type AssetKind,
  type AssetCacheEntry,
} from './assetCache';

/**
 * Render (or fetch from cache) a rasterized PNG for an asset, fitting the
 * source into a (maxWidth, maxHeight) box while preserving aspect ratio.
 * Returns a blob URL the caller drops into <img>; caller owns the URL and
 * should revoke when the element unmounts.
 *
 * Cache key uses the REQUESTED max dimensions — the stored PNG's actual
 * pixel dimensions may be smaller (aspect-preserved fit). Lookups by the
 * same (sourceId, variant, maxWidth, maxHeight) hit consistently.
 */
export async function renderAsset(opts: {
  sourceId: string;
  kind: AssetKind;
  variant?: string;
  /** Maximum width of the rendered PNG — actual output may be narrower. */
  maxWidth: number;
  /** Maximum height of the rendered PNG — actual output may be shorter. */
  maxHeight: number;
  /** Optional pre-fetched source bytes (skips the db_get_asset round-trip). */
  preFetchedBytes?: Uint8Array;
}): Promise<string> {
  const { sourceId, kind, variant = '_', maxWidth, maxHeight, preFetchedBytes } = opts;

  const cached = await getAssetCache(sourceId, variant, maxWidth, maxHeight);
  if (cached) return pngBytesToBlobUrl(cached.png);

  const bytes = preFetchedBytes
    ?? new Uint8Array(await invoke<number[]>('db_get_asset', { path: sourceId }));

  let png: Uint8Array;
  switch (kind) {
    case 'svg':
      png = await rasterizeAspectFit(bytes, 'image/svg+xml', maxWidth, maxHeight);
      break;
    case 'pdf':
      // pdfium-render path lands in a later commit. For now signal the
      // miss to the caller so it can show source-as-is until then.
      throw new Error('PDF rasterization not yet implemented');
    case 'raster': {
      const mime = sniffRasterMime(bytes) || 'image/png';
      png = await rasterizeAspectFit(bytes, mime, maxWidth, maxHeight);
      break;
    }
  }

  await putAssetCache(sourceId, variant, maxWidth, maxHeight, png, null);
  return pngBytesToBlobUrl(Array.from(png) as number[]);
}

/**
 * Load source as <img>, then rasterize to PNG fitted into (maxW, maxH)
 * preserving aspect ratio. Canvas starts transparent (no fillRect) so SVG
 * with no background stays transparent. Used by SVG and raster paths;
 * works identically for both modulo the blob MIME type.
 */
async function rasterizeAspectFit(bytes: Uint8Array, mime: string, maxW: number, maxH: number): Promise<Uint8Array> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    // naturalWidth/Height === SVG viewBox dims for SVG, intrinsic pixels for raster.
    const nw = img.naturalWidth || maxW;
    const nh = img.naturalHeight || maxH;
    const scale = Math.min(maxW / nw, maxH / nh, 1);  // never upscale past natural size
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    return canvasToPngBytes(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${src.slice(0, 80)}`));
    img.src = src;
  });
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas toBlob produced null'))), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function sniffRasterMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'image/webp';
  return null;
}

/**
 * Re-export cached PNG bytes as a blob URL for callers that already
 * have an AssetCacheEntry in hand.
 */
export function entryToBlobUrl(entry: AssetCacheEntry): string {
  return pngBytesToBlobUrl(entry.png);
}

/**
 * Scan an SVG for `<image>` references that point at external resources
 * (anything other than a `data:` URI). When the SVG is rendered as an
 * image, the browser's secure-static mode can't fetch external sub-
 * resources, so those references appear blank. Returns the offending
 * href values in document order (de-duped).
 *
 * Catches both `href=` and the legacy `xlink:href=` forms.
 */
export function findExternalImageRefs(bytes: Uint8Array): string[] {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(0, Math.min(bytes.length, 16384)),
  );
  // Fast skip when no <image> in the head and the file is small enough
  // that there can't be one elsewhere.
  if (!/<image\b/i.test(head) && bytes.length <= 16384) return [];
  const text = bytes.length <= 16384
    ? head
    : new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const seen = new Set<string>();
  const out: string[] = [];
  const IMAGE_TAG_RE = /<image\b[^>]*>/gi;
  const HREF_RE = /\b(?:xlink:href|href)\s*=\s*["']([^"']+)["']/i;
  for (const m of text.matchAll(IMAGE_TAG_RE)) {
    const h = HREF_RE.exec(m[0]);
    if (!h) continue;
    const href = h[1];
    if (href.startsWith('data:') || href.startsWith('#')) continue;
    if (!seen.has(href)) { seen.add(href); out.push(href); }
  }
  return out;
}

/**
 * Show a native warning dialog when an SVG references external <image>
 * subresources that won't render. Called after insertion (drag/drop,
 * paste, file picker) for SVG kind. No-op when the SVG is self-contained.
 *
 * Non-blocking: the element is already added; this is just an FYI so the
 * user can decide whether to fix the source or accept the missing images.
 */
export async function warnIfSvgHasExternalRefs(svgBytes: Uint8Array, filename: string): Promise<void> {
  const refs = findExternalImageRefs(svgBytes);
  if (refs.length === 0) return;
  const { message } = await import('@tauri-apps/plugin-dialog');
  const sample = refs.slice(0, 5).map((r) => `  • ${r}`).join('\n');
  const more = refs.length > 5 ? `\n  …and ${refs.length - 5} more` : '';
  await message(
    `${filename} references ${refs.length} external image${refs.length === 1 ? '' : 's'} ` +
    `that won't load when the SVG is rendered in a slide:\n\n${sample}${more}\n\n` +
    `To fix: re-export with the images embedded.\n` +
    `  • Inkscape: File → Save As → Inkscape SVG, check "Embed images".\n` +
    `  • Illustrator: File → Export → SVG, choose "Embed" instead of "Link" for images.\n\n` +
    `The SVG was still added; only the external images will appear blank.`,
    { title: 'SVG references external images', kind: 'warning' },
  );
}

/**
 * Pre-process SVG bytes before handing them to <img src=blob:>. WebKit
 * (and to a lesser extent other browsers) loads SVG-as-image in "secure
 * static mode" — embedded `<image xlink:href="data:...">` subresources
 * are often silently dropped, while plain `href` on the same element is
 * honored. Adobe Illustrator exports overwhelmingly use the legacy
 * `xlink:href`, so without this shim every Illustrator SVG with an
 * embedded placed-photo renders without the photo.
 *
 * Rewrites `xlink:href=` -> `href=` only inside <image> tags (avoiding
 * <use xlink:href=...> and other SVG idioms that may genuinely depend on
 * the xlink namespace). Idempotent and fast: regex on the text, no DOM
 * parse. Returns the input unchanged when no <image xlink:href> match.
 */
function normalizeSvgForImg(bytes: Uint8Array): Uint8Array {
  // Only inspect the leading window — large SVGs almost never have
  // <image> tags in the first few KB if not at all; a full UTF-8 decode
  // for a 5 MB icon is wasteful otherwise. If the head shows xlink:href
  // inside an <image>, fall through to the full rewrite.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, 16384)));
  if (!/<image\b[^>]*\bxlink:href\b/i.test(head) && bytes.length <= 16384) {
    return bytes;
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const rewritten = text.replace(/(<image\b[^>]*?\s)xlink:href(=)/gi, '$1href$2');
  if (rewritten === text) return bytes;
  return new TextEncoder().encode(rewritten);
}

/**
 * SVG fast-path threshold (bytes). SVG sources under this size are served as
 * raw blob URLs so the browser renders them natively at any CSS size
 * (vector-perfect anti-aliasing, no pixelation in scaled-down sidebar
 * thumbs). Above this we rasterize to the asset_cache because re-parsing
 * a million-point path on every paint is expensive — accepting some sidebar
 * pixelation in exchange for stable per-paint cost.
 *
 * 200 KB is empirically the right cutoff for our corpus: every icon / spec
 * test / simple wikimedia diagram lands below, the only fixture above is
 * the Inkscape About splash (~400 KB) which legitimately benefits from
 * caching.
 */
export const SVG_NATIVE_THRESHOLD_BYTES = 200_000;

/**
 * React hook: lazy cache-or-render an asset at the requested tier, returning
 * a blob URL the consumer can drop into <img src>. URL is revoked when the
 * component unmounts or the inputs change.
 *
 * - SVG (<= SVG_NATIVE_THRESHOLD_BYTES): native browser SVG render, no cache.
 *   Crisp at any size, ideal for icons and small diagrams.
 * - SVG (> threshold): rasterized to cache to avoid per-paint parse cost on
 *   complex/large files.
 * - raster: always cached at requested tier (cheap thumbs vs. re-decoding
 *   a multi-MB JPEG every paint).
 * - pdf: returns undefined permanently until the pdfium path lands.
 *
 * Returns undefined while the first render is in flight.
 */
export function useRenderedAsset(
  sourceId: string | undefined,
  kind: AssetKind | undefined,
  maxWidth: number,
  maxHeight: number,
  variant: string = '_',
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!sourceId || !kind) { setUrl(undefined); return; }
    let cancelled = false;
    let current: string | undefined;

    if (kind === 'svg') {
      // Fetch source bytes once; decide native vs cache by size.
      invoke<number[]>('db_get_asset', { path: sourceId })
        .then(async (data) => {
          if (cancelled) return;
          const bytes = normalizeSvgForImg(new Uint8Array(data));
          if (bytes.length <= SVG_NATIVE_THRESHOLD_BYTES) {
            // Fast path: hand raw SVG to <img>; browser scales it perfectly.
            const blob = new Blob([bytes as BlobPart], { type: 'image/svg+xml' });
            current = URL.createObjectURL(blob);
            setUrl(current);
          } else {
            // Slow path: rasterize once into asset_cache, reuse forever.
            // preFetchedBytes avoids the second db_get_asset round-trip.
            try {
              const u = await renderAsset({ sourceId, kind, variant, maxWidth, maxHeight, preFetchedBytes: bytes });
              if (cancelled) { URL.revokeObjectURL(u); return; }
              current = u;
              setUrl(u);
            } catch {
              if (!cancelled) setUrl(undefined);
            }
          }
        })
        .catch(() => { if (!cancelled) setUrl(undefined); });
    } else {
      renderAsset({ sourceId, kind, variant, maxWidth, maxHeight })
        .then((u) => {
          if (cancelled) { URL.revokeObjectURL(u); return; }
          current = u;
          setUrl(u);
        })
        .catch(() => { if (!cancelled) setUrl(undefined); });
    }

    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [sourceId, kind, variant, maxWidth, maxHeight]);

  return url;
}
