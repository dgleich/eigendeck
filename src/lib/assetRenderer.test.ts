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
});

// The SVG/raster branches use canvas rasterization (loadImage → drawImage
// → toBlob). jsdom doesn't fire <img>.onload for blob URLs, so the
// rasterize step hangs in this test environment. Skipping that here;
// the PDF-branch tests above are the primary coverage. End-to-end SVG
// + raster verification happens on the user's Mac via the manual paste
// flow.
