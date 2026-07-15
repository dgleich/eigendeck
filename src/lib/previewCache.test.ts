import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('modern-screenshot', () => ({
  domToDataUrl: vi.fn(async () => 'data:image/png;base64,AAAA'),
}));
import { invoke } from '@tauri-apps/api/core';
import { domToDataUrl } from 'modern-screenshot';
import { previewKey, loadPreviewDataUrl, capturePreview, isPreviewThemeStale } from './previewCache';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47]; // \x89PNG

describe('previewKey', () => {
  it('is the sync identity (syncId ?? id)', () => {
    expect(previewKey({ id: 'a', syncId: 'g' })).toBe('g');
    expect(previewKey({ id: 'a', syncId: undefined })).toBe('a');
  });
});

describe('loadPreviewDataUrl', () => {
  beforeEach(() => (invoke as any).mockReset());

  it('returns a base64 PNG data URL for a cache hit', async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'db_list_asset_cache_variants')
        return Promise.resolve([{ variant: 'preview', width: 4, height: 4 }]);
      if (cmd === 'db_get_asset_cache_bytes')
        return Promise.resolve(new Uint8Array(PNG_SIG).buffer);
      return Promise.resolve(null);
    });
    const url = await loadPreviewDataUrl('k');
    expect(url).toMatch(/^data:image\/png;base64,/);
    // round-trips back to the PNG signature
    const b64 = url!.split(',')[1];
    const bytes = [...atob(b64)].map((c) => c.charCodeAt(0));
    expect(bytes).toEqual(PNG_SIG);
  });

  it('returns null when there is no preview variant (cache miss)', async () => {
    (invoke as any).mockImplementation((cmd: string) =>
      cmd === 'db_list_asset_cache_variants' ? Promise.resolve([]) : Promise.resolve(null));
    expect(await loadPreviewDataUrl('k')).toBeNull();
  });

  it('returns null on an empty byte response (variant listed but no bytes)', async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'db_list_asset_cache_variants')
        return Promise.resolve([{ variant: 'preview', width: 4, height: 4 }]);
      return Promise.resolve(new Uint8Array(0).buffer);
    });
    expect(await loadPreviewDataUrl('k')).toBeNull();
  });
});

describe('isPreviewThemeStale (#140)', () => {
  const SEP = '␞';
  beforeEach(() => (invoke as any).mockReset());
  const withHash = (source_hash: string | null) =>
    (invoke as any).mockImplementation((cmd: string) =>
      cmd === 'db_list_asset_cache_variants'
        ? Promise.resolve([{ variant: 'preview', width: 4, height: 4, source_hash }])
        : Promise.resolve(null));

  it('is stale when the stored salt prefix differs from the current theme', async () => {
    withHash(`#fff|#222|l${SEP}abc123`);
    expect(await isPreviewThemeStale('k', '#000|#fff|d')).toBe(true);
  });

  it('is fresh when the stored salt prefix matches', async () => {
    withHash(`#000|#fff|d${SEP}abc123`);
    expect(await isPreviewThemeStale('k', '#000|#fff|d')).toBe(false);
  });

  it('is fresh (no false eviction) for a pre-prefix signature with no separator', async () => {
    withHash('legacyhashonly');
    expect(await isPreviewThemeStale('k', '#000|#fff|d')).toBe(false);
  });

  it('is fresh when there is no cached preview at all', async () => {
    (invoke as any).mockImplementation((cmd: string) =>
      cmd === 'db_list_asset_cache_variants' ? Promise.resolve([]) : Promise.resolve(null));
    expect(await isPreviewThemeStale('k', '#000|#fff|d')).toBe(false);
  });
});

describe('capturePreview source_hash skip', () => {
  beforeEach(() => {
    (invoke as any).mockReset();
    (domToDataUrl as any).mockClear();
    // No persisted preview → always falls through to (re)capture unless skipped
    // by the in-session lastHash.
    (invoke as any).mockImplementation((cmd: string) =>
      cmd === 'db_list_asset_cache_variants' ? Promise.resolve([]) : Promise.resolve(null));
  });

  const elFor = (id: string) => ({
    id, type: 'demo', assetId: 'a',
    position: { x: 0, y: 0, width: 10, height: 10 },
  } as any);

  it('captures once, then SKIPS an identical re-capture (no second rasterize)', async () => {
    document.body.innerHTML = '<div data-element-id="x"><p>hi</p></div>';
    await capturePreview(elFor('x'));
    await capturePreview(elFor('x'));
    expect((domToDataUrl as any).mock.calls.length).toBe(1);
    const puts = (invoke as any).mock.calls.filter((c: any[]) => c[0] === 'db_put_asset_cache');
    expect(puts.length).toBe(1);
    expect(puts[0][1].sourceHash).toBeTruthy();   // a real hash, not null
  });

  it('re-captures when the content changes', async () => {
    document.body.innerHTML = '<div data-element-id="y"><p>one</p></div>';
    await capturePreview(elFor('y'));
    document.querySelector('[data-element-id="y"]')!.innerHTML = '<p>two</p>';
    await capturePreview(elFor('y'));
    expect((domToDataUrl as any).mock.calls.length).toBe(2);
  });

  it('re-captures when only the cacheSalt changes (theme switch — #86)', async () => {
    // Same node HTML; the theme lives outside it (CSS vars in the iframe <head>),
    // so a salt change must still bust the skip and recapture.
    document.body.innerHTML = '<div data-element-id="z"><p>same</p></div>';
    await capturePreview(elFor('z'), undefined, 'theme:dark');
    await capturePreview(elFor('z'), undefined, 'theme:dark');  // unchanged → skip
    expect((domToDataUrl as any).mock.calls.length).toBe(1);
    await capturePreview(elFor('z'), undefined, 'theme:light'); // new theme → recapture
    expect((domToDataUrl as any).mock.calls.length).toBe(2);
  });

  it('passes backgroundColor to the rasterizer and re-captures when it changes', async () => {
    // A transparent demo iframe must bake the slide bg into the PNG, else the
    // thumbnail reads as the app's grey. The bg is part of the cache key too.
    document.body.innerHTML = '<div data-element-id="w"><p>same</p></div>';
    await capturePreview(elFor('w'), undefined, undefined, '#1a1a2e');
    expect((domToDataUrl as any).mock.calls[0][1].backgroundColor).toBe('#1a1a2e');
    await capturePreview(elFor('w'), undefined, undefined, '#1a1a2e'); // unchanged → skip
    expect((domToDataUrl as any).mock.calls.length).toBe(1);
    await capturePreview(elFor('w'), undefined, undefined, '#ffffff'); // bg change → recapture
    expect((domToDataUrl as any).mock.calls.length).toBe(2);
    expect((domToDataUrl as any).mock.calls[1][1].backgroundColor).toBe('#ffffff');
  });
});
