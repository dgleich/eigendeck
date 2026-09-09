// Pure-logic tests for renderAsset's branching. Doesn't exercise the
// canvas rasterization path (jsdom can't load <img> or run getContext
// usefully) — that's the SVG/raster branches. The PDF branch IS
// fully covered because rendering happens in Rust; JS just round-trips
// invoke calls and a put-into-cache.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { invoke, type InvokeArgs } from '@tauri-apps/api/core';
import {
  renderAsset,
  inlineSvgExternalRefsFromDisk,
  invalidateRenderedAsset,
  handleSvgExternalRefs,
  useRenderedAsset,
} from './assetRenderer';

// The three exported helpers below reach into other modules via dynamic
// import(); mock those boundaries so we exercise the parse / path-resolve /
// branch logic without touching disk, dialogs, or blob caches.
vi.mock('./assetGate', () => ({ resolveAndGate: vi.fn() }));
vi.mock('./demoAssets', () => ({ invalidateAsset: vi.fn() }));
vi.mock('./demoMount', () => ({ invalidateDemoDoc: vi.fn() }));
// setup.ts mocks plugin-dialog with open/save/message but not `ask`, which
// handleSvgExternalRefs needs — re-declare the module here with both.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
}));

import { resolveAndGate } from './assetGate';
import { invalidateAsset } from './demoAssets';
import { invalidateDemoDoc } from './demoMount';
import { ask, message } from '@tauri-apps/plugin-dialog';

const mockedInvoke = vi.mocked(invoke);
const mockedGate = vi.mocked(resolveAndGate);
const mockedAsk = vi.mocked(ask);
const mockedMessage = vi.mocked(message);

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

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
    mockedInvoke.mockImplementation(async (cmd: string, args?: InvokeArgs) => {
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
    mockedInvoke.mockImplementation(async (cmd: string, args?: InvokeArgs) => {
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
    // 1920 ends up holding the slot (256's IIFE awaits its (A)
    // db_downscale_asset_cache probe first — by the time it reaches
    // withPdfRenderSlot, 1920 already has it). 256 queues. When 1920
    // finishes and its in-slot putAssetCache(FULL) commits, the slot
    // releases. 256 acquires, re-probes db_downscale_asset_cache,
    // HITs because FULL is now cached — so 256 never calls pdfium.
    //
    // This guards the in-slot put + race-recheck contract: if anyone
    // moves the put outside withPdfRenderSlot, the race window opens
    // and 256 would re-parse the PDF (the 44s Asset 2.pdf regression
    // documented in the assetRenderer.ts:319 comment). It does NOT
    // test FIFO ordering of withPdfRenderSlot itself — that's a
    // separate invariant covered by its own comment, not by a test.
    const fullPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 1, 1]);
    const downscaledPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2, 2]);

    let resolve1920: () => void;
    const block1920 = new Promise<void>((r) => { resolve1920 = r; });

    let cachedFull = false;
    let renderCalls256 = 0;
    let renderCalls1920 = 0;

    mockedInvoke.mockImplementation(async (cmd: string, args?: InvokeArgs) => {
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

// ---------------------------------------------------------------------------
// inlineSvgExternalRefsFromDisk — <image> ref scan + path resolve + gate + rewrite
// ---------------------------------------------------------------------------
describe('inlineSvgExternalRefsFromDisk', () => {
  beforeEach(() => { mockedGate.mockReset(); });

  const okImage = (bytes: Uint8Array) => ({
    ok: true as const, kind: 'image' as const, reason: null,
    canonicalPath: '/resolved', bytes,
  });

  it('returns null for an SVG with no <image> references', async () => {
    const svg = enc('<svg><rect x="0" y="0" width="10" height="10"/></svg>');
    expect(await inlineSvgExternalRefsFromDisk(svg, '/deck/fig.svg')).toBeNull();
    expect(mockedGate).not.toHaveBeenCalled();
  });

  it('ignores data: and fragment (#) hrefs — they are not external', async () => {
    const svg = enc(
      '<svg><image href="data:image/png;base64,AAAA"/>' +
      '<image xlink:href="#gradient"/></svg>',
    );
    // Both refs are non-external → findExternalImageRefs returns [] → null.
    expect(await inlineSvgExternalRefsFromDisk(svg, '/deck/fig.svg')).toBeNull();
    expect(mockedGate).not.toHaveBeenCalled();
  });

  it('reports http(s) refs as unsupported without gating or inlining them', async () => {
    const svg = enc('<svg><image href="https://example.com/pic.png"/></svg>');
    const res = await inlineSvgExternalRefsFromDisk(svg, '/deck/fig.svg');
    // Only an http ref, nothing inlined → overall null, but the gate is
    // never consulted for an http ref.
    expect(res).toBeNull();
    expect(mockedGate).not.toHaveBeenCalled();
  });

  it('resolves relative refs against the source folder and inlines a gated image', async () => {
    mockedGate.mockResolvedValue(okImage(new Uint8Array([1, 2, 3, 4])));
    const svg = enc('<svg><image xlink:href="../img/pic.png" x="0"/></svg>');
    const res = await inlineSvgExternalRefsFromDisk(svg, '/home/u/deck/fig.svg');

    expect(res).not.toBeNull();
    // '../img/pic.png' resolved against '/home/u/deck' → '/home/u/img/pic.png'.
    expect(mockedGate).toHaveBeenCalledWith('/home/u/img/pic.png');
    expect(res!.inlined).toBe(1);
    expect(res!.failed).toEqual([]);
    expect(res!.httpUnsupported).toEqual([]);
    // Rewritten SVG carries a data: URI with the png mime (from extension).
    const out = dec(res!.bytes);
    expect(out).toContain('data:image/png;base64,');
    expect(out).not.toContain('../img/pic.png');
  });

  it('records a failed ref (non-image gate) and returns null when nothing inlines', async () => {
    mockedGate.mockResolvedValue({
      ok: false, kind: null, reason: 'content-mismatch',
      canonicalPath: '/resolved', bytes: null,
    });
    const svg = enc('<svg><image href="secret.pem"/></svg>');
    const res = await inlineSvgExternalRefsFromDisk(svg, '/deck/fig.svg');
    // Every ref failed the gate → replacements empty → null.
    expect(res).toBeNull();
  });

  it('mixes success and failure across multiple refs, reporting each', async () => {
    mockedGate.mockImplementation(async (p: string) =>
      p.endsWith('good.jpg')
        ? okImage(new Uint8Array([9, 9]))
        : { ok: false, kind: null, reason: 'unreadable', canonicalPath: p, bytes: null },
    );
    const svg = enc(
      '<svg><image href="good.jpg"/><image href="bad.png"/>' +
      '<image href="http://x/y.png"/></svg>',
    );
    const res = await inlineSvgExternalRefsFromDisk(svg, '/deck/fig.svg');
    expect(res).not.toBeNull();
    expect(res!.inlined).toBe(1);
    expect(res!.failed).toHaveLength(1);
    expect(res!.failed[0]).toContain('bad.png');
    expect(res!.failed[0]).toContain('unreadable'); // reason appended
    expect(res!.httpUnsupported).toEqual(['http://x/y.png']);
    const out = dec(res!.bytes);
    expect(out).toContain('data:image/jpeg;base64,'); // good.jpg → jpeg mime
    expect(out).toContain('bad.png');                  // untouched (failed gate)
  });
});

// ---------------------------------------------------------------------------
// invalidateRenderedAsset — cache clear + blob-cache drop + change event
// ---------------------------------------------------------------------------
describe('invalidateRenderedAsset', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    vi.mocked(invalidateAsset).mockReset();
    vi.mocked(invalidateDemoDoc).mockReset();
  });

  it('clears the SQLite cache, drops blob caches, and dispatches the change event', async () => {
    mockedInvoke.mockResolvedValue(undefined);
    const events: string[] = [];
    const listener = (e: Event) => {
      events.push((e as CustomEvent).detail.assetId);
    };
    window.addEventListener('eigendeck:asset-changed', listener);
    try {
      await invalidateRenderedAsset('asset-42');
    } finally {
      window.removeEventListener('eigendeck:asset-changed', listener);
    }

    expect(mockedInvoke).toHaveBeenCalledWith('db_clear_asset_cache', { sourceId: 'asset-42' });
    expect(vi.mocked(invalidateAsset)).toHaveBeenCalledWith('asset-42');
    expect(vi.mocked(invalidateDemoDoc)).toHaveBeenCalledWith('asset-42');
    expect(events).toEqual(['asset-42']);
  });

  it('still dispatches the change event even when db_clear_asset_cache rejects', async () => {
    // Best-effort contract: a failed clear must not swallow the notify.
    mockedInvoke.mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fired = false;
    const listener = () => { fired = true; };
    window.addEventListener('eigendeck:asset-changed', listener);
    try {
      await invalidateRenderedAsset('asset-err');
    } finally {
      window.removeEventListener('eigendeck:asset-changed', listener);
      warn.mockRestore();
    }
    // The blob-cache invalidation still ran, and the event still fired.
    expect(vi.mocked(invalidateAsset)).toHaveBeenCalledWith('asset-err');
    expect(fired).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleSvgExternalRefs — dialog-driven embed flow
// ---------------------------------------------------------------------------
describe('handleSvgExternalRefs', () => {
  beforeEach(() => {
    mockedGate.mockReset();
    mockedAsk.mockReset();
    mockedMessage.mockReset();
  });

  it('returns null immediately when the SVG has no external refs', async () => {
    const svg = enc('<svg><rect/></svg>');
    expect(await handleSvgExternalRefs(svg, 'plain.svg', '/deck/plain.svg')).toBeNull();
    expect(mockedAsk).not.toHaveBeenCalled();
    expect(mockedMessage).not.toHaveBeenCalled();
  });

  it('warns (no prompt) and returns null for a pasted SVG with no source path', async () => {
    const svg = enc('<svg><image href="pic.png"/></svg>');
    const res = await handleSvgExternalRefs(svg, 'pasted.svg', null);
    expect(res).toBeNull();
    expect(mockedMessage).toHaveBeenCalledTimes(1);
    // No embed prompt when there's no folder to resolve against.
    expect(mockedAsk).not.toHaveBeenCalled();
  });

  it('returns null when the user declines the embed prompt', async () => {
    mockedAsk.mockResolvedValue(false);
    const svg = enc('<svg><image href="pic.png"/></svg>');
    const res = await handleSvgExternalRefs(svg, 'fig.svg', '/deck/fig.svg');
    expect(res).toBeNull();
    expect(mockedAsk).toHaveBeenCalledTimes(1);
    expect(mockedGate).not.toHaveBeenCalled();
  });

  it('shows an error and returns null when accepted but nothing could be embedded', async () => {
    mockedAsk.mockResolvedValue(true);
    mockedGate.mockResolvedValue({
      ok: false, kind: null, reason: 'unreadable', canonicalPath: null, bytes: null,
    });
    const svg = enc('<svg><image href="missing.png"/></svg>');
    const res = await handleSvgExternalRefs(svg, 'fig.svg', '/deck/fig.svg');
    expect(res).toBeNull();
    // ask + the "No images embedded" error message.
    expect(mockedMessage).toHaveBeenCalledTimes(1);
  });

  it('returns rewritten bytes and reports success when an image embeds', async () => {
    mockedAsk.mockResolvedValue(true);
    mockedGate.mockResolvedValue({
      ok: true, kind: 'image', reason: null,
      canonicalPath: '/deck/pic.png', bytes: new Uint8Array([7, 7, 7]),
    });
    const svg = enc('<svg><image href="pic.png"/></svg>');
    const res = await handleSvgExternalRefs(svg, 'fig.svg', '/deck/fig.svg');
    expect(res).not.toBeNull();
    expect(dec(res as Uint8Array)).toContain('data:image/png;base64,');
    // Success info message is shown.
    expect(mockedMessage).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// useRenderedAsset — SVG native fast-path + guard branches
// ---------------------------------------------------------------------------
describe('useRenderedAsset', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    let counter = 0;
    global.URL.createObjectURL = vi.fn(() => `blob:hook-${++counter}`);
    global.URL.revokeObjectURL = vi.fn();
  });

  it('stays undefined when assetId is missing', () => {
    const { result } = renderHook(() => useRenderedAsset(undefined, 'svg', 256, 256));
    expect(result.current).toBeUndefined();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('stays undefined when kind is missing', () => {
    const { result } = renderHook(() => useRenderedAsset('a1', undefined, 256, 256));
    expect(result.current).toBeUndefined();
  });

  it('serves a small SVG natively as a blob URL without rasterizing', async () => {
    // Small SVG (< 200KB) → native fast path: no renderAsset, no cache
    // invoke, just createObjectURL over the (normalized) bytes.
    const svg = enc('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_by_id') return svg.buffer.slice(0) as ArrayBuffer;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useRenderedAsset('svg-1', 'svg', 256, 256));
    await waitFor(() => expect(result.current).toMatch(/^blob:hook-/));

    // Native path never touches the asset_cache or pdfium.
    expect(mockedInvoke).not.toHaveBeenCalledWith('db_put_asset_cache', expect.anything());
    expect(mockedInvoke).not.toHaveBeenCalledWith('db_render_pdf_page', expect.anything());
  });

  it('rewrites <image xlink:href> to href on the native SVG path (WebKit secure-static shim)', async () => {
    // normalizeSvgForImg must convert Illustrator-style xlink:href on
    // <image> to plain href so WebKit renders the embedded photo.
    const svg = enc(
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<image xlink:href="data:image/png;base64,AAAA"/></svg>',
    );
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_by_id') return svg.buffer.slice(0) as ArrayBuffer;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    // Capture the Blob handed to createObjectURL so we can read back the
    // (normalized) SVG bytes and assert the xlink:href → href rewrite.
    let capturedBlob: Blob | null = null;
    global.URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      capturedBlob = blob as Blob;
      return 'blob:hook-captured';
    }) as unknown as typeof URL.createObjectURL;

    const { result } = renderHook(() => useRenderedAsset('svg-x', 'svg', 256, 256));
    await waitFor(() => expect(result.current).toBe('blob:hook-captured'));

    expect(capturedBlob).not.toBeNull();
    const text = await (capturedBlob as unknown as Blob).text();
    expect(text).toContain('<image href=');
    expect(text).not.toContain('xlink:href');
  });
});
