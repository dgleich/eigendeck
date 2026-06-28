import { describe, it, expect } from 'vitest';
import { pngBytesToDataUrl, previewLookupKey, pickLargestVariant } from './assetCachePreview.mjs';

describe('previewLookupKey', () => {
  it('maps a PDF image to assetId + snapshotVariant', () => {
    expect(previewLookupKey({ type: 'image', kind: 'pdf', assetId: 'a1', snapshotVariant: 'pg3' }))
      .toEqual({ sourceId: 'a1', variant: 'pg3' });
  });

  it("defaults a PDF image's variant to '_' when none is set", () => {
    expect(previewLookupKey({ type: 'image', kind: 'pdf', assetId: 'a1' }))
      .toEqual({ sourceId: 'a1', variant: '_' });
  });

  it('maps a notebook to its syncId with the preview variant', () => {
    expect(previewLookupKey({ type: 'notebook', id: 'el9', syncId: 'sync9' }))
      .toEqual({ sourceId: 'sync9', variant: 'preview' });
  });

  it('falls back to id when a notebook/video has no syncId', () => {
    expect(previewLookupKey({ type: 'video', id: 'el9' }))
      .toEqual({ sourceId: 'el9', variant: 'preview' });
  });

  it('returns null for a non-PDF image', () => {
    expect(previewLookupKey({ type: 'image', kind: 'png', assetId: 'a1' })).toBeNull();
  });

  it('returns null for element types without cached previews', () => {
    expect(previewLookupKey({ type: 'text', id: 't1' })).toBeNull();
    expect(previewLookupKey({ type: 'arrow', id: 'a1' })).toBeNull();
    expect(previewLookupKey({ type: 'demo', id: 'd1' })).toBeNull();
  });
});

describe('pickLargestVariant', () => {
  const rows = [
    { variant: 'preview', width: 256, height: 256 },
    { variant: 'preview', width: 1024, height: 768 },
    { variant: 'preview', width: 512, height: 512 },
    { variant: '_', width: 4096, height: 4096 }, // different variant — must be ignored
  ];

  it('picks the most-pixels render matching the variant', () => {
    expect(pickLargestVariant(rows, 'preview')).toEqual({ variant: 'preview', width: 1024, height: 768 });
  });

  it('ignores rows of a different variant even if larger', () => {
    // The 4096² '_' row has far more pixels but must not win for 'preview'.
    expect(pickLargestVariant(rows, 'preview').width).toBe(1024);
  });

  it('selects the only matching variant', () => {
    expect(pickLargestVariant(rows, '_')).toEqual({ variant: '_', width: 4096, height: 4096 });
  });

  it('returns null when no variant matches', () => {
    expect(pickLargestVariant(rows, 'missing')).toBeNull();
  });

  it('returns null for an empty / nullish list', () => {
    expect(pickLargestVariant([], 'preview')).toBeNull();
    expect(pickLargestVariant(null, 'preview')).toBeNull();
    expect(pickLargestVariant(undefined, 'preview')).toBeNull();
  });

  it('compares by area numerically, not by width string', () => {
    // A tall-thin 10×1000 (10k px) beats a square 90×90 (8.1k px) despite a
    // smaller width — a string/width-only sort would get this wrong.
    const r = [
      { variant: 'preview', width: 90, height: 90 },
      { variant: 'preview', width: 10, height: 1000 },
    ];
    expect(pickLargestVariant(r, 'preview')).toEqual({ variant: 'preview', width: 10, height: 1000 });
  });
});

describe('pngBytesToDataUrl', () => {
  it('encodes bytes as a base64 PNG data URL', () => {
    const bytes = new Uint8Array([72, 105]); // "Hi"
    expect(pngBytesToDataUrl(bytes)).toBe(`data:image/png;base64,${btoa('Hi')}`);
  });

  it('round-trips through atob back to the original bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 200, 255]);
    const url = pngBytesToDataUrl(bytes);
    const b64 = url.slice('data:image/png;base64,'.length);
    const decoded = atob(b64);
    const out = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it('handles an empty buffer', () => {
    expect(pngBytesToDataUrl(new Uint8Array([]))).toBe('data:image/png;base64,');
  });

  it('handles a buffer larger than the 8192 chunk boundary without corruption', () => {
    const n = 20000;
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = i % 256;
    const url = pngBytesToDataUrl(bytes);
    const decoded = atob(url.slice('data:image/png;base64,'.length));
    expect(decoded.length).toBe(n);
    expect(decoded.charCodeAt(0)).toBe(0);
    expect(decoded.charCodeAt(8192)).toBe(8192 % 256);
    expect(decoded.charCodeAt(n - 1)).toBe((n - 1) % 256);
  });
});
