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
  ASSET_TIER,
  type AssetKind,
  type AssetCacheEntry,
} from './assetCache';
import { showToast, dismissToast } from './toasts';

/**
 * Show a "still rendering…" toast if a single asset render hasn't
 * completed within this many ms. Threshold picked from stress-test
 * data: typical PDF + SVG renders complete in <2s on release build;
 * 5s is well into the long tail (worst pathological case 41s in
 * pdfium.3 log). Below 5s, the toast would be noise.
 */
const SLOW_RENDER_TOAST_MS = 5000;

/**
 * Promote sub-FULL PDF renders to FULL when the source PDF is at least
 * this large (bytes). Rationale: pdfium's parse cost dominates for big
 * PDFs (single-digit MB+), so paying it once at FULL tier and then
 * server-side downscaling to thumb is cheaper across the lifetime of
 * the asset than two independent parses. Smaller PDFs render fast at
 * either tier; promoting them just wastes cache and first-open latency.
 */
const PDF_PROMOTE_THRESHOLD_BYTES = 500 * 1024;

/**
 * Global pdfium concurrency limit. pdfium binds one process-wide
 * instance and the SQLite write side is a single-mutex connection;
 * three concurrent renders + their multi-MB putAssetCache writes
 * contended badly in stress-test logs (3.5s avg, 45s tail on cache
 * writes vs ~50ms expected). Serialized is predictable: no thundering
 * herd on the connection mutex, no compounding tails. Total wall-time
 * is comparable (the parallel runs lost their speed-up to contention)
 * with a much smoother UX.
 */
const PDF_RENDER_CONCURRENCY = 1;
let pdfActive = 0;
const pdfWaiters: Array<() => void> = [];
async function withPdfRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (pdfActive >= PDF_RENDER_CONCURRENCY) {
    await new Promise<void>((resolve) => pdfWaiters.push(resolve));
  }
  pdfActive++;
  try {
    return await fn();
  } finally {
    pdfActive--;
    const next = pdfWaiters.shift();
    if (next) next();
  }
}

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
  /** Stable asset_id binding — the cache row keys off this. */
  assetId: string;
  kind: AssetKind;
  variant?: string;
  /** Maximum width of the rendered PNG — actual output may be narrower. */
  maxWidth: number;
  /** Maximum height of the rendered PNG — actual output may be shorter. */
  maxHeight: number;
  /** Optional pre-fetched source bytes (skips the db_get_asset_by_id round-trip). */
  preFetchedBytes?: Uint8Array;
}): Promise<string> {
  const { assetId, kind, variant = '_', maxWidth, maxHeight, preFetchedBytes } = opts;

  const RENDER_LOG = true;  // perf-parity comparison — every render emits timing lines
  const rlog = (msg: string): void => {
    if (RENDER_LOG) console.log(`[render ${new Date().toISOString().slice(11, 23)}] ${msg}`);
  };
  const T0 = performance.now();

  const tCache = performance.now();
  const cached = await getAssetCache(assetId, variant, maxWidth, maxHeight);
  rlog(`getAssetCache(${assetId.slice(0,8)} ${kind} ${maxWidth}x${maxHeight}): ${(performance.now() - tCache).toFixed(0)}ms → ${cached ? 'HIT' : 'miss'}`);
  if (cached) return pngBytesToBlobUrl(cached.png);

  // Cache miss — share the render+store work across concurrent callers.
  // React.StrictMode double-invokes effects in dev; SidebarImageThumb +
  // ImageBox routinely mount in parallel for the same asset. Without
  // this dedup, every tier (256, 1920, ...) ran pdfium twice AND fired
  // two contending SQLite writes. Now: one pdfium call + one cache
  // write per (assetId, variant, w, h) key, even under StrictMode.
  // Each caller still gets its own blob URL (independent revoke).
  const inflightKey = `${assetId}|${variant}|${maxWidth}x${maxHeight}|${kind}`;
  let pngPromise = renderInflight.get(inflightKey);
  if (!pngPromise) {
    pngPromise = (async () => {
      // Slow-render toast: fires if THIS render hasn't completed within
      // SLOW_RENDER_TOAST_MS. Keyed by inflightKey so multiple callers
      // awaiting the same dedup'd promise see ONE toast, not N. Cleared
      // in finally — fires once per render, never leaks across attempts.
      const toastKey = `slow-render:${inflightKey}`;
      const slowToastTimer = setTimeout(() => {
        const noun = kind === 'pdf' ? 'a complex PDF' : `a complex ${kind.toUpperCase()}`;
        showToast({
          key: toastKey,
          message: `Rendering ${noun}… (cached after first render)`,
          kind: 'info',
          ttl: 0,  // sticky; we dismiss in finally
        });
      }, SLOW_RENDER_TOAST_MS);

      try {
      let png: Uint8Array;
      // Set true when the producer (pdfium / server-side downscale) has
      // already written the target tier to cache — skips the
      // outer putAssetCache to avoid a redundant 1-3 MB IPC round trip.
      let skipCachePut = false;
      switch (kind) {
        case 'pdf': {
          // (A) Downscale-from-cache: if FULL is already cached and we
          // want a smaller tier, ask Rust to decode → resize → encode →
          // cache → return bytes in ONE invoke. Empty Response = miss,
          // fall through to fresh render.
          if (maxWidth < ASSET_TIER.full || maxHeight < ASSET_TIER.full) {
            const tDS = performance.now();
            const dsBuf = await invoke<ArrayBuffer>('db_downscale_asset_cache', {
              sourceId: assetId, variant,
              sourceWidth: ASSET_TIER.full, sourceHeight: ASSET_TIER.full,
              targetWidth: maxWidth, targetHeight: maxHeight,
            });
            if (dsBuf.byteLength > 0) {
              rlog(`db_downscale_asset_cache(${assetId.slice(0,8)} → ${maxWidth}x${maxHeight}): ${(performance.now() - tDS).toFixed(0)}ms HIT`);
              png = new Uint8Array(dsBuf);
              skipCachePut = true;  // server-side write already happened
              break;
            }
            rlog(`db_downscale_asset_cache(${assetId.slice(0,8)}): ${(performance.now() - tDS).toFixed(0)}ms miss → fresh render`);
          }

          png = await withPdfRenderSlot(async () => {
            // (B) Tier promotion: for sub-FULL requests of big PDFs,
            // render at FULL once, cache it, then server-side downscale
            // to the requested tier. Future requests at any tier ≤ FULL
            // hit (A) above (cheap resize from cached PNG vs. re-parse
            // a multi-MB PDF).
            const meta = await invoke<{ size?: number } | null>('db_get_asset_meta_by_id', { assetId });
            const isBig = (meta?.size ?? 0) >= PDF_PROMOTE_THRESHOLD_BYTES;
            const promote = (maxWidth < ASSET_TIER.full || maxHeight < ASSET_TIER.full) && isBig;

            if (promote) {
              const tFull = performance.now();
              const fullBuf = await invoke<ArrayBuffer>('db_render_pdf_page', {
                assetId, page: 0, maxWidth: ASSET_TIER.full, maxHeight: ASSET_TIER.full,
              });
              const fullPng = new Uint8Array(fullBuf);
              rlog(`pdfium render FULL(${assetId.slice(0,8)}): ${(performance.now() - tFull).toFixed(0)}ms → ${fullPng.length}B`);

              const tPutFull = performance.now();
              await putAssetCache(assetId, variant, ASSET_TIER.full, ASSET_TIER.full, fullPng, null);
              rlog(`putAssetCache FULL: ${(performance.now() - tPutFull).toFixed(0)}ms`);

              const tDS = performance.now();
              const dsBuf = await invoke<ArrayBuffer>('db_downscale_asset_cache', {
                sourceId: assetId, variant,
                sourceWidth: ASSET_TIER.full, sourceHeight: ASSET_TIER.full,
                targetWidth: maxWidth, targetHeight: maxHeight,
              });
              rlog(`db_downscale_asset_cache(post-promote): ${(performance.now() - tDS).toFixed(0)}ms`);
              skipCachePut = true;  // FULL cached above; target cached server-side
              return new Uint8Array(dsBuf);
            }

            // Direct render at requested tier (small PDF or FULL request).
            const tPdf = performance.now();
            const pageBuf = await invoke<ArrayBuffer>('db_render_pdf_page', {
              assetId, page: 0, maxWidth, maxHeight,
            });
            const pageBytes = new Uint8Array(pageBuf);
            rlog(`pdfium render(${assetId.slice(0,8)} ${maxWidth}x${maxHeight}): ${(performance.now() - tPdf).toFixed(0)}ms → ${pageBytes.length}B`);
            return pageBytes;
          });
          break;
        }
        case 'svg':
        case 'raster': {
          const bytes = preFetchedBytes
            ?? new Uint8Array(await invoke<ArrayBuffer>('db_get_asset_by_id', { assetId }));
          const mime = kind === 'svg' ? 'image/svg+xml' : (sniffRasterMime(bytes) || 'image/png');
          png = await rasterizeAspectFit(bytes, mime, maxWidth, maxHeight);
          break;
        }
      }
      if (!skipCachePut) {
        const tPut = performance.now();
        await putAssetCache(assetId, variant, maxWidth, maxHeight, png, null);
        rlog(`putAssetCache: ${(performance.now() - tPut).toFixed(0)}ms · render TOTAL ${(performance.now() - T0).toFixed(0)}ms`);
      } else {
        rlog(`render TOTAL ${(performance.now() - T0).toFixed(0)}ms (cache write done server-side)`);
      }
      return png;
      } finally {
        clearTimeout(slowToastTimer);
        dismissToast(toastKey);
      }
    })().finally(() => renderInflight.delete(inflightKey));
    renderInflight.set(inflightKey, pngPromise);
  } else {
    rlog(`render dedup HIT for ${assetId.slice(0,8)} ${maxWidth}x${maxHeight} — awaiting inflight`);
  }

  const png = await pngPromise;
  return pngBytesToBlobUrl(Array.from(png) as number[]);
}

// Module-level inflight tracker — keys outlive renderAsset invocations
// so concurrent callers share one render. Promise gets deleted in finally
// so a failed render doesn't poison subsequent attempts.
const renderInflight = new Map<string, Promise<Uint8Array>>();

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

/** POSIX-style path resolution: 'base/../foo/./bar' -> '/foo/bar' (rooted on base). */
function resolvePosixPath(baseDir: string, relative: string): string {
  if (relative.startsWith('/')) return relative;
  const parts = (baseDir + '/' + relative).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return '/' + out.join('/');
}

/** Detect MIME for an embedded file from its extension. */
function mimeFromExt(href: string): string {
  const ext = (href.split('.').pop() || '').toLowerCase();
  return ext === 'png' ? 'image/png'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'gif' ? 'image/gif'
    : ext === 'webp' ? 'image/webp'
    : ext === 'svg' ? 'image/svg+xml'
    : 'application/octet-stream';
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(s);
}

/**
 * Read each external <image href> in `svgBytes` from disk (resolving
 * relative paths against the source SVG's folder), base64-encode the
 * file, and rewrite the SVG with embedded `data:` URIs in place. HTTP(S)
 * refs are not auto-embedded in v1 — reported in `httpUnsupported` so
 * the caller can surface them.
 *
 * Returns null when nothing changed (no refs, or every ref failed).
 */
export async function inlineSvgExternalRefsFromDisk(
  svgBytes: Uint8Array,
  sourceSvgPath: string,
): Promise<{ bytes: Uint8Array; inlined: number; failed: string[]; httpUnsupported: string[] } | null> {
  const refs = findExternalImageRefs(svgBytes);
  if (refs.length === 0) return null;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(svgBytes);
  const sourceDir = sourceSvgPath.substring(0, sourceSvgPath.lastIndexOf('/'));

  const { readFile } = await import('@tauri-apps/plugin-fs');
  const replacements: Array<[string, string]> = [];
  const failed: string[] = [];
  const httpUnsupported: string[] = [];

  for (const ref of refs) {
    if (/^https?:\/\//i.test(ref)) { httpUnsupported.push(ref); continue; }
    const absolute = resolvePosixPath(sourceDir, ref);
    try {
      const fileBytes = await readFile(absolute);
      const dataUri = `data:${mimeFromExt(ref)};base64,${bytesToBase64(fileBytes)}`;
      replacements.push([ref, dataUri]);
    } catch (e) {
      failed.push(`${ref} (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  if (replacements.length === 0) return null;

  // Apply each replacement in-place. Limit to <image> tags so we don't
  // accidentally rewrite the same string elsewhere in the SVG (CSS,
  // comments, etc.).
  let modified = text;
  for (const [ref, dataUri] of replacements) {
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `(<image\\b[^>]*\\b(?:xlink:href|href)\\s*=\\s*["'])${escaped}(["'])`,
      'g',
    );
    modified = modified.replace(re, `$1${dataUri}$2`);
  }

  return {
    bytes: new TextEncoder().encode(modified),
    inlined: replacements.length,
    failed,
    httpUnsupported,
  };
}

/**
 * Notify any mounted `useRenderedAsset` hook that an asset's bytes have
 * changed (e.g. after auto-embedding external refs). Triggers a re-fetch
 * + re-render without requiring a manual UI refresh. Also clears the
 * SQLite asset_cache PNG rows that were derived from the old bytes.
 */
export async function invalidateRenderedAsset(assetId: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('db_clear_asset_cache', { sourceId: assetId });
  } catch { /* best-effort */ }
  // Also drop the demoAssets blob cache so any consumer using useAssetUrl
  // / getAssetUrl re-fetches the new bytes instead of handing out a stale
  // URL. The custom event below still fires for hook-based listeners.
  try {
    const { invalidateAsset } = await import('./demoAssets');
    invalidateAsset(assetId);
  } catch { /* best-effort */ }
  window.dispatchEvent(new CustomEvent('eigendeck:asset-changed', { detail: { assetId } }));
}

/**
 * Handle SVG-with-external-refs at insertion time. If the SVG has any
 * external <image> refs:
 *   - When `sourceSvgPath` is known (drag/drop, file picker), ask the
 *     user whether to embed them; on yes, fetch local files and rewrite
 *     the SVG. Returns the rewritten bytes for the caller to re-store.
 *   - When `sourceSvgPath` is null (pasted SVG), just warn — there's no
 *     source folder to resolve relative refs against.
 *
 * Returns null when nothing changed; the caller can keep the original
 * bytes. When non-null, caller should db_store_asset(returned bytes)
 * and call invalidateRenderedAsset(path) so the UI picks up the change.
 */
export async function handleSvgExternalRefs(
  svgBytes: Uint8Array,
  filename: string,
  sourceSvgPath: string | null,
): Promise<Uint8Array | null> {
  const refs = findExternalImageRefs(svgBytes);
  if (refs.length === 0) return null;
  const { ask, message } = await import('@tauri-apps/plugin-dialog');
  const sample = refs.slice(0, 5).map((r) => `  • ${r}`).join('\n');
  const more = refs.length > 5 ? `\n  …and ${refs.length - 5} more` : '';

  if (!sourceSvgPath) {
    await message(
      `${filename} references ${refs.length} external image${refs.length === 1 ? '' : 's'} ` +
      `that won't load when the SVG is rendered:\n\n${sample}${more}\n\n` +
      `Pasted SVGs can't be auto-embedded (no source folder). Save the SVG with images ` +
      `embedded and re-paste, or drop the file in instead so we can try embedding.`,
      { title: 'SVG references external images', kind: 'warning' },
    );
    return null;
  }

  const accepted = await ask(
    `${filename} references ${refs.length} external image${refs.length === 1 ? '' : 's'} ` +
    `that won't load as-is:\n\n${sample}${more}\n\n` +
    `Embed them now? Files will be read from the SVG's folder and base64-encoded into the SVG.\n\n` +
    `⚠ Embedding captures a SNAPSHOT of each file's current contents. The embedded copies ` +
    `won't auto-update if you later change the source files — you'd need to re-embed.`,
    {
      title: 'Embed external images?',
      kind: 'warning',
      okLabel: 'Embed Snapshot of SVG and References',
      cancelLabel: 'Insert SVG with missing References',
    },
  );
  if (!accepted) return null;

  const result = await inlineSvgExternalRefsFromDisk(svgBytes, sourceSvgPath);
  if (!result) {
    await message(
      `Couldn't embed any of the ${refs.length} external image${refs.length === 1 ? '' : 's'}. ` +
      `They may be HTTP refs (not auto-embeddable in v1), missing files, or outside the readable scope.`,
      { title: 'No images embedded', kind: 'error' },
    );
    return null;
  }

  const lines: string[] = [
    `Embedded ${result.inlined} of ${refs.length} image${refs.length === 1 ? '' : 's'} as ` +
    `snapshots — the SVG no longer references the source files. ` +
    `Re-import or re-embed if the source files change later.`,
  ];
  if (result.failed.length > 0) {
    lines.push('', 'Failed:');
    for (const f of result.failed.slice(0, 5)) lines.push(`  • ${f}`);
    if (result.failed.length > 5) lines.push(`  …and ${result.failed.length - 5} more`);
  }
  if (result.httpUnsupported.length > 0) {
    lines.push('', 'HTTP(S) refs (not auto-embeddable — download manually and re-link):');
    for (const u of result.httpUnsupported.slice(0, 5)) lines.push(`  • ${u}`);
  }
  await message(lines.join('\n'), {
    title: 'External images embedded',
    kind: result.failed.length || result.httpUnsupported.length ? 'warning' : 'info',
  });
  return result.bytes;
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
  assetId: string | undefined,
  kind: AssetKind | undefined,
  maxWidth: number,
  maxHeight: number,
  variant: string = '_',
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  // Bumped by invalidateRenderedAsset() so this hook refetches after the
  // underlying asset bytes change (e.g. embedding external SVG refs).
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!assetId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { assetId?: string } | undefined;
      if (detail?.assetId === assetId) setRefreshKey((k) => k + 1);
    };
    window.addEventListener('eigendeck:asset-changed', handler);
    return () => window.removeEventListener('eigendeck:asset-changed', handler);
  }, [assetId]);

  useEffect(() => {
    if (!assetId || !kind) { setUrl(undefined); return; }
    let cancelled = false;
    let current: string | undefined;

    const fetchBytes = async (): Promise<Uint8Array> =>
      new Uint8Array(await invoke<ArrayBuffer>('db_get_asset_by_id', { assetId }));

    if (kind === 'svg') {
      // Fetch source bytes once; decide native vs cache by size.
      fetchBytes()
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
            // preFetchedBytes avoids the second db_get_asset_by_id round-trip.
            try {
              const u = await renderAsset({ assetId, kind, variant, maxWidth, maxHeight, preFetchedBytes: bytes });
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
      renderAsset({ assetId, kind, variant, maxWidth, maxHeight })
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
  }, [assetId, kind, variant, maxWidth, maxHeight, refreshKey]);

  return url;
}
