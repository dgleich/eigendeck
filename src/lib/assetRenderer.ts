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
}): Promise<string> {
  const { sourceId, kind, variant = '_', maxWidth, maxHeight } = opts;

  const cached = await getAssetCache(sourceId, variant, maxWidth, maxHeight);
  if (cached) return pngBytesToBlobUrl(cached.png);

  const bytes = new Uint8Array(await invoke<number[]>('db_get_asset', { path: sourceId }));

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
 * React hook: lazy cache-or-render an asset at the requested tier, returning
 * a blob URL the consumer can drop into <img src>. URL is revoked when the
 * component unmounts or the inputs change.
 *
 * Returns undefined while the first render is in flight. PDF sources return
 * undefined permanently until the pdfium path lands; callers should fall
 * back to raw source display in that case.
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
    renderAsset({ sourceId, kind, variant, maxWidth, maxHeight })
      .then((u) => {
        if (cancelled) { URL.revokeObjectURL(u); return; }
        current = u;
        setUrl(u);
      })
      .catch(() => { if (!cancelled) setUrl(undefined); });
    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [sourceId, kind, variant, maxWidth, maxHeight]);

  return url;
}
