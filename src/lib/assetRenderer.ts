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
 * Render (or fetch from cache) a rasterized PNG for an asset at the
 * requested tier size. Returns a blob URL the caller can drop into <img>.
 * Caller owns the URL and should revoke when the element unmounts.
 *
 * Cache hit: zero re-render, just unwrap the stored PNG.
 * Cache miss: rasterize, persist, return.
 */
export async function renderAsset(opts: {
  sourceId: string;
  kind: AssetKind;
  variant?: string;
  width: number;
  height: number;
}): Promise<string> {
  const { sourceId, kind, variant = '_', width, height } = opts;

  const cached = await getAssetCache(sourceId, variant, width, height);
  if (cached) return pngBytesToBlobUrl(cached.png);

  // Cache miss — read source bytes from the assets table.
  const bytes = new Uint8Array(await invoke<number[]>('db_get_asset', { path: sourceId }));

  let png: Uint8Array;
  switch (kind) {
    case 'svg':
      png = await rasterizeSvg(bytes, width, height);
      break;
    case 'pdf':
      // pdfium-render path lands in a later commit. For now signal the
      // miss to the caller so it can show source-as-is until then.
      throw new Error('PDF rasterization not yet implemented');
    case 'raster':
      // Raster sources don't need caching at the asset_cache layer for
      // display (the bytes ARE the display form), but caching at the
      // tier size yields a smaller blob for sidebar use.
      png = await downscaleRaster(bytes, width, height);
      break;
  }

  await putAssetCache(sourceId, variant, width, height, png, null);
  return pngBytesToBlobUrl(Array.from(png) as number[]);
}

/**
 * Rasterize SVG bytes to a transparent PNG at exact (width, height).
 * The SVG's intrinsic viewBox is mapped to fill the requested box.
 */
async function rasterizeSvg(svgBytes: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const blob = new Blob([svgBytes as BlobPart], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    // Transparent background: do NOT fillRect. Canvas starts transparent.
    ctx.drawImage(img, 0, 0, width, height);
    return canvasToPngBytes(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Re-encode a raster source at a target size — used for sidebar thumbs. */
async function downscaleRaster(bytes: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  // Detect by magic bytes for a more accurate MIME than just defaulting.
  const mime = sniffRasterMime(bytes) || 'image/png';
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.drawImage(img, 0, 0, width, height);
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
  width: number,
  height: number,
  variant: string = '_',
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!sourceId || !kind) { setUrl(undefined); return; }
    let cancelled = false;
    let current: string | undefined;
    renderAsset({ sourceId, kind, variant, width, height })
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
  }, [sourceId, kind, variant, width, height]);

  return url;
}
