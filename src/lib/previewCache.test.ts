import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { previewKey, loadPreviewDataUrl } from './previewCache';

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
