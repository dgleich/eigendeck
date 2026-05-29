// Pure-logic tests for renderAsset's branching. Doesn't exercise the
// canvas rasterization path (jsdom can't load <img> or run getContext
// usefully) — that's the SVG/raster branches. The PDF branch IS
// fully covered because rendering happens in Rust; JS just round-trips
// invoke calls and a put-into-cache.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { renderAsset } from './assetRenderer';

const mockedInvoke = vi.mocked(invoke);

// jsdom doesn't implement URL.createObjectURL / revokeObjectURL by default.
// Stub them so renderAsset (and the assetCache helpers it uses) don't trip
// when they convert PNG bytes to a blob: URL for the consumer.
beforeEach(() => {
  let counter = 0;
  global.URL.createObjectURL = vi.fn(() => `blob:fake-${++counter}`);
  global.URL.revokeObjectURL = vi.fn();
  mockedInvoke.mockReset();
});

describe('renderAsset — pdf branch', () => {
  it('routes kind=pdf through db_render_pdf_page (Rust-side fetch + render)', async () => {
    // Cache miss; then a fake PNG comes back from pdfium.
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_cache_bytes') return new ArrayBuffer(0);                 // miss
      if (cmd === 'db_downscale_asset_cache') return new ArrayBuffer(0);                 // miss (no FULL cached)
      if (cmd === 'db_get_asset_meta_by_id') return { size: 1024 };                      // small PDF, no promotion
      if (cmd === 'db_render_pdf_page') return fakePng.buffer.slice(0) as ArrayBuffer;   // pdfium output (binary IPC)
      if (cmd === 'db_put_asset_cache') return undefined;                                // store result
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    // Request at FULL tier so neither (A) downscale-from-cache nor (B)
    // tier-promotion fires — pure direct pdfium render path.
    const url = await renderAsset({
      assetId: 'asset-pdf-1', kind: 'pdf',
      maxWidth: 1920, maxHeight: 1920,
    });

    // Caller sees a blob URL it can drop into <img src>.
    expect(url).toMatch(/^blob:/);

    // Right Tauri command with the args (passes maxWidth/maxHeight straight
    // through; v1 always page 0 since multi-page picker is deferred).
    expect(mockedInvoke).toHaveBeenCalledWith('db_render_pdf_page', {
      assetId: 'asset-pdf-1', page: 0, maxWidth: 1920, maxHeight: 1920,
    });

    // PDF branch must NOT double-fetch bytes via db_get_asset_by_id — the
    // whole point of routing through Rust is to avoid marshalling multi-MB
    // PDF bytes through invoke twice.
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'db_get_asset_by_id',
      expect.anything(),
    );

    // Rendered PNG goes into the cache under the assetId key + default
    // variant '_'. Bytes travel as Uint8Array (binary IPC), not
    // an Array.from() copy.
    expect(mockedInvoke).toHaveBeenCalledWith('db_put_asset_cache', {
      sourceId: 'asset-pdf-1', variant: '_', width: 1920, height: 1920,
      png: fakePng, sourceHash: null,
    });
  });

  it('cache hit short-circuits — pdfium is not invoked', async () => {
    const cachedPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_cache_bytes') {
        return cachedPng.buffer.slice(0);
      }
      throw new Error(`unexpected invoke on cache hit: ${cmd}`);
    });

    const url = await renderAsset({
      assetId: 'asset-pdf-1', kind: 'pdf',
      maxWidth: 1000, maxHeight: 800,
    });

    expect(url).toMatch(/^blob:/);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith(
      'db_get_asset_cache_bytes',
      expect.objectContaining({ sourceId: 'asset-pdf-1' }),
    );
  });

  it('propagates pdfium errors to the caller', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_cache_bytes') return new ArrayBuffer(0);
      if (cmd === 'db_downscale_asset_cache') return new ArrayBuffer(0);
      if (cmd === 'db_get_asset_meta_by_id') return { size: 1024 };
      if (cmd === 'db_render_pdf_page') throw 'pdfium: load_pdf_from_byte_slice failed';
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await expect(
      renderAsset({ assetId: 'asset-broken', kind: 'pdf', maxWidth: 100, maxHeight: 100 }),
    ).rejects.toBeDefined();

    // On error, no cache write happens — next call retries cleanly
    // rather than caching a broken render.
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'db_put_asset_cache',
      expect.anything(),
    );
  });

  it('big PDF (>= 500KB) follows tier-promotion path B', async () => {
    // Sub-FULL request + big asset → renders at FULL, caches FULL,
    // server-side downscales to target. The user-visible benefit
    // is that subsequent thumbs hit (A) downscale-from-cache
    // instead of re-parsing the PDF — for Asset 2.pdf that's the
    // difference between a 40s reparse and a 30ms downscale.
    const fullPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 1, 1]);
    const downscaledPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2, 2]);
    let rendered1920 = false;
    let cachedFull = false;
    let downscaledFromCache = false;
    mockedInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'db_get_asset_cache_bytes') return new ArrayBuffer(0);
      if (cmd === 'db_downscale_asset_cache') {
        // First probe (pre-slot): no FULL cached yet → miss.
        // Post-promote: FULL is cached now → return target bytes.
        if (cachedFull) {
          downscaledFromCache = true;
          return downscaledPng.buffer.slice(0) as ArrayBuffer;
        }
        return new ArrayBuffer(0);
      }
      if (cmd === 'db_get_asset_meta_by_id') return { size: 5_000_000 };  // big PDF
      if (cmd === 'db_render_pdf_page') {
        const a = args as { maxWidth: number; maxHeight: number };
        rendered1920 = a.maxWidth === 1920 && a.maxHeight === 1920;
        return fullPng.buffer.slice(0) as ArrayBuffer;
      }
      if (cmd === 'db_put_asset_cache') {
        const a = args as { width: number; height: number };
        if (a.width === 1920 && a.height === 1920) cachedFull = true;
        return undefined;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const url = await renderAsset({
      assetId: 'asset-big-pdf', kind: 'pdf',
      maxWidth: 256, maxHeight: 256,  // sub-FULL request triggers promotion
    });
    expect(url).toMatch(/^blob:/);

    // pdfium ran exactly once, at FULL dimensions — NOT at 256.
    expect(rendered1920).toBe(true);
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'db_render_pdf_page',
      expect.objectContaining({ maxWidth: 256, maxHeight: 256 }),
    );
    // FULL was cached, then server-side downscaled to target.
    expect(cachedFull).toBe(true);
    expect(downscaledFromCache).toBe(true);
  });

  it('small PDF (< 500KB) skips tier promotion and renders direct', async () => {
    // Inverse of above — guards against the threshold getting
    // accidentally lowered, which would balloon cache size for
    // small PDFs that don't benefit from promotion.
    const directPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 3, 3]);
    let rendered256 = false;
    let rendered1920 = false;
    mockedInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'db_get_asset_cache_bytes') return new ArrayBuffer(0);
      if (cmd === 'db_downscale_asset_cache') return new ArrayBuffer(0);  // always miss
      if (cmd === 'db_get_asset_meta_by_id') return { size: 100_000 };  // small PDF
      if (cmd === 'db_render_pdf_page') {
        const a = args as { maxWidth: number; maxHeight: number };
        if (a.maxWidth === 256) rendered256 = true;
        if (a.maxWidth === 1920) rendered1920 = true;
        return directPng.buffer.slice(0) as ArrayBuffer;
      }
      if (cmd === 'db_put_asset_cache') return undefined;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await renderAsset({
      assetId: 'asset-small-pdf', kind: 'pdf',
      maxWidth: 256, maxHeight: 256,
    });

    // Direct render at requested 256, no FULL render.
    expect(rendered256).toBe(true);
    expect(rendered1920).toBe(false);
  });

  it('post-queue race: 256 thumb behind 1920 render skips pdfium when FULL gets cached', async () => {
    // Two parallel renderAsset calls for the same asset, different tiers.
    // 1920 grabs the pdfium slot first; 256 queues. While 1920 is in
    // flight, 256 can't do anything. When 1920 finishes and its in-slot
    // putAssetCache(FULL) commits, the slot releases. 256 acquires,
    // re-probes db_downscale_asset_cache, and HITs because FULL is now
    // cached — so 256 never calls pdfium itself.
    //
    // This guards against a previously-observed regression where 256
    // re-parsed the same PDF for 44s (Asset 2.pdf log). If anyone moves
    // the in-slot put outside withPdfRenderSlot, the race window opens
    // again and this test fails.
    const fullPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 1, 1]);
    const downscaledPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2, 2]);

    let resolve1920: () => void;
    const block1920 = new Promise<void>((r) => { resolve1920 = r; });

    let cachedFull = false;
    let renderCalls256 = 0;
    let renderCalls1920 = 0;

    mockedInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'db_get_asset_cache_bytes') return new ArrayBuffer(0);
      if (cmd === 'db_downscale_asset_cache') {
        return cachedFull ? (downscaledPng.buffer.slice(0) as ArrayBuffer) : new ArrayBuffer(0);
      }
      if (cmd === 'db_get_asset_meta_by_id') return { size: 5_000_000 };
      if (cmd === 'db_render_pdf_page') {
        const a = args as { maxWidth: number; maxHeight: number };
        if (a.maxWidth === 1920) {
          renderCalls1920++;
          await block1920;  // pause until the test releases
          return fullPng.buffer.slice(0) as ArrayBuffer;
        }
        if (a.maxWidth === 256) {
          renderCalls256++;
          return fullPng.buffer.slice(0) as ArrayBuffer;
        }
        throw new Error(`unexpected render size ${a.maxWidth}`);
      }
      if (cmd === 'db_put_asset_cache') {
        const a = args as { width: number; height: number };
        if (a.width === 1920 && a.height === 1920) cachedFull = true;
        return undefined;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    // Start both renders in parallel. Use distinct assetIds for the
    // inflightKey-dedup test invariant; promotion logic doesn't share
    // state across assetIds anyway. We want both renders racing for
    // the *same* asset's pdfium slot, so SAME assetId.
    const p256 = renderAsset({ assetId: 'race-asset', kind: 'pdf', maxWidth: 256, maxHeight: 256 });
    const p1920 = renderAsset({ assetId: 'race-asset', kind: 'pdf', maxWidth: 1920, maxHeight: 1920 });

    // Let microtasks settle: both IIFEs have run far enough that 1920
    // is in `db_render_pdf_page` (blocked on block1920) and 256 is
    // queued in withPdfRenderSlot.
    await new Promise((r) => setTimeout(r, 10));

    // Release 1920. After this:
    //   - 1920 IIFE: gets fullPng, in-slot putAssetCache(FULL), returns
    //   - slot releases → 256's waiter fires
    //   - 256's post-queue re-probe HITs (cachedFull is true now)
    //   - 256 returns the downscaled bytes without calling pdfium
    resolve1920!();
    const [url256, url1920] = await Promise.all([p256, p1920]);

    expect(url256).toMatch(/^blob:/);
    expect(url1920).toMatch(/^blob:/);

    // The whole point: 256 never called pdfium.
    expect(renderCalls256).toBe(0);
    expect(renderCalls1920).toBe(1);
  });

  it('downscale-from-cache (A) short-circuits when FULL is already cached', async () => {
    // First (A) probe HITs → no pdfium call, no meta fetch.
    // Guards against anyone "fixing" the IPC by always re-checking
    // meta, which would reintroduce cold-path latency on every
    // thumb request even when FULL is cached.
    const downscaledPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_cache_bytes') return new ArrayBuffer(0);   // target tier not cached
      if (cmd === 'db_downscale_asset_cache') return downscaledPng.buffer.slice(0) as ArrayBuffer;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const url = await renderAsset({
      assetId: 'asset-A-hit', kind: 'pdf',
      maxWidth: 256, maxHeight: 256,
    });
    expect(url).toMatch(/^blob:/);

    // Critically: never reached pdfium and never touched meta.
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'db_render_pdf_page',
      expect.anything(),
    );
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'db_get_asset_meta_by_id',
      expect.anything(),
    );
    // skipCachePut=true → no outer put.
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'db_put_asset_cache',
      expect.anything(),
    );
  });
});

// The SVG/raster branches use canvas rasterization (loadImage → drawImage
// → toBlob). jsdom doesn't fire <img>.onload for blob URLs, so the
// rasterize step hangs in this test environment. Skipping that here;
// the PDF-branch tests above are the primary coverage. End-to-end SVG
// + raster verification happens on the user's Mac via the manual paste
// flow.
