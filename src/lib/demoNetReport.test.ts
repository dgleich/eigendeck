import { describe, it, expect, vi } from 'vitest';

const { fx } = vi.hoisted(() => ({
  fx: {
    slides: [] as Array<{ elements: Array<{ type: string; assetId?: string }> }>,
    assets: new Map<string, string>(),  // assetId -> HTML text
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: { assetId?: string }) => {
    if (cmd === 'db_get_asset_by_id') {
      const html = fx.assets.get(args!.assetId!);
      if (html == null) throw new Error('no asset');
      return new TextEncoder().encode(html).buffer;
    }
    throw new Error(`unexpected invoke ${cmd}`);
  },
}));
vi.mock('../store/presentation', () => ({
  usePresentationStore: { getState: () => ({ presentation: { slides: fx.slides } }) },
}));

import { buildDemoNetReport } from './demoNetReport';

const manifest = (net: Array<{ host: string; purpose: string }>) =>
  `<html><head><script type="application/eigendeck-manifest+json">${JSON.stringify({ network: net })}</script></head><body></body></html>`;

describe('buildDemoNetReport', () => {
  it('lists demos with a manifest, grouped by asset, with the slides they appear on', async () => {
    fx.slides = [
      { elements: [{ type: 'demo', assetId: 'stock' }] },
      { elements: [{ type: 'text' }, { type: 'demo-piece', assetId: 'stock' }] },  // same asset, 2nd slide
      { elements: [{ type: 'demo', assetId: 'offline' }] },
    ];
    fx.assets.set('stock', manifest([{ host: 'api.x', purpose: 'quotes' }]));
    fx.assets.set('offline', '<html><body>no manifest</body></html>');

    const rep = await buildDemoNetReport();
    expect(rep).toHaveLength(1);                       // only the declaring demo
    expect(rep[0].assetId).toBe('stock');
    expect(rep[0].slides).toEqual([1, 2]);             // deduped + sorted
    expect(rep[0].hosts).toEqual([{ host: 'api.x', purpose: 'quotes' }]);
  });

  it('returns [] when no demo declares a manifest', async () => {
    fx.slides = [{ elements: [{ type: 'demo', assetId: 'offline' }] }];
    fx.assets.set('offline', '<html><body>plain</body></html>');
    expect(await buildDemoNetReport()).toEqual([]);
  });

  it('dedupes repeated host declarations within one demo', async () => {
    fx.slides = [{ elements: [{ type: 'demo', assetId: 'dup' }] }];
    fx.assets.set('dup', manifest([{ host: 'a.x', purpose: 'first' }, { host: 'a.x', purpose: 'second' }]));
    const rep = await buildDemoNetReport();
    expect(rep[0].hosts).toEqual([{ host: 'a.x', purpose: 'first' }]);
  });
});
