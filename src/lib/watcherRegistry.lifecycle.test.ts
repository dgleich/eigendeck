// CHARACTERIZATION test for the watcher's filesystem boundary — the `watch` and
// `stat` calls that are about to move from the JS fs-plugin into Rust commands.
// These assertions pin the CURRENT observable behavior so the migration can be
// checked for regressions. After the migration the MOCKS change (Rust invoke /
// events instead of plugin-fs), but the assertions on observable behavior should
// hold; any that must change is a behavior diff to discuss.

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// --- fs-plugin boundary (the surface moving to Rust) -------------------------
const fsState: {
  watchCalls: Array<{ path: string; opts: unknown }>;
  lastCb: ((e: unknown) => void) | null;
  unwatch: Mock;
  statImpl: (p: string) => Promise<{ mtime: Date | null }>;
} = {
  watchCalls: [], lastCb: null, unwatch: vi.fn(),
  statImpl: async () => ({ mtime: new Date('2026-01-01T00:00:00.000Z') }),
};
vi.mock('@tauri-apps/plugin-fs', () => ({
  watch: vi.fn(async (path: string, cb: (e: unknown) => void, opts: unknown) => {
    fsState.watchCalls.push({ path, opts });
    fsState.lastCb = cb;
    return fsState.unwatch;
  }),
  stat: vi.fn((p: string) => fsState.statImpl(p)),
}));

// --- invoke (db_store_asset / db_list_linked_assets) -------------------------
const invokeState: { store: Mock; linked: unknown[] } = {
  store: vi.fn(async () => 'stored-id'), linked: [],
};
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === 'db_store_asset') return invokeState.store();
    if (cmd === 'db_list_linked_assets') return invokeState.linked;
    return undefined;
  }),
}));

// --- gate + trust + side-effect deps -----------------------------------------
const g = { token: 'tok' as string | null, trusted: true, approved: true, gate: {} as any };
vi.mock('../store/presentation', () => ({ getDeckToken: () => g.token }));
vi.mock('./trustStore', () => ({ isTrusted: async () => g.trusted, isPathApproved: async () => g.approved }));
vi.mock('./assetGate', () => ({ resolveAndGate: async () => g.gate }));
const renderer = { invalidate: vi.fn(async (_id: string) => {}) };
vi.mock('./assetRenderer', () => ({ invalidateRenderedAsset: (id: string) => renderer.invalidate(id) }));
const missing = { markMissing: vi.fn(), markFound: vi.fn(), isMissing: vi.fn((_id: string) => false) };
vi.mock('./missingAssets', () => ({
  markAssetMissing: (...a: unknown[]) => missing.markMissing(...a),
  markAssetFound: (...a: unknown[]) => missing.markFound(...a),
  isAssetMissing: (id: string) => missing.isMissing(id),
}));
vi.mock('./preferences', () => ({
  getPreference: () => true,
  effectiveAutoReload: () => true,
}));
vi.mock('./hash', () => ({ sha256Hex: async () => 'HASH-NEW' }));

import { getWatcherRegistry, closeWatcherRegistry, scanForChangedAssets } from './watcherRegistry';

const OK_BYTES = new Uint8Array([1, 2, 3]);
function okGate() { g.gate = { ok: true, bytes: OK_BYTES, canonicalPath: '/real/x.png', reason: null }; }
// The watch callback is fire-and-forget (`void this.handleChange`), so awaiting
// cb() doesn't await the async store; flush microtasks + a macrotask tick.
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fsState.watchCalls = []; fsState.lastCb = null;
  fsState.unwatch = vi.fn();
  fsState.statImpl = async () => ({ mtime: new Date('2026-01-01T00:00:00.000Z') });
  invokeState.store = vi.fn(async () => 'stored-id'); invokeState.linked = [];
  renderer.invalidate.mockClear(); missing.markMissing.mockClear(); missing.markFound.mockClear();
  g.token = 'tok'; g.trusted = true; g.approved = true; okGate();
  for (const id of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) closeWatcherRegistry(id);
});

describe('watch lifecycle (fs boundary → Rust)', () => {
  it('first subscriber registers exactly one watch with delayMs:100 for the abs path', async () => {
    const r = getWatcherRegistry('p1', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    expect(fsState.watchCalls).toHaveLength(1);
    expect(fsState.watchCalls[0].path).toBe('/proj/img/x.png');
    expect(fsState.watchCalls[0].opts).toEqual({ delayMs: 100 });
  });

  it('a second asset on the same path does NOT open a second watch', async () => {
    const r = getWatcherRegistry('p2', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    await r.addRef('img/x.png', 'a2', 'el2', 'img/x.png', 'image/png');
    expect(fsState.watchCalls).toHaveLength(1);
  });

  it('unwatch fires only when the LAST asset on a path unsubscribes (ref-counted)', async () => {
    const r = getWatcherRegistry('p3', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    await r.addRef('img/x.png', 'a2', 'el2', 'img/x.png', 'image/png');
    r.removeRef('img/x.png', 'a1', 'el1');
    expect(fsState.unwatch).not.toHaveBeenCalled();
    r.removeRef('img/x.png', 'a2', 'el2');
    expect(fsState.unwatch).toHaveBeenCalledTimes(1);
  });

  it('closeWatcherRegistry unwatches everything', async () => {
    const r = getWatcherRegistry('p4', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    closeWatcherRegistry('p4');
    expect(fsState.unwatch).toHaveBeenCalledTimes(1);
  });
});

describe('handleChange (disk event → gate → stat mtime → store)', () => {
  it('ok read → stats for mtime and stores each asset + invalidates', async () => {
    const r = getWatcherRegistry('p5', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    await fsState.lastCb!({}); await flush();
    expect(invokeState.store).toHaveBeenCalledTimes(1);
    expect(renderer.invalidate).toHaveBeenCalledWith('a1');
    expect(missing.markFound).toHaveBeenCalledWith('a1');
  });

  it('gated read → no store (snapshot stays)', async () => {
    g.approved = false; // trusted but path not approved → gated
    const r = getWatcherRegistry('p5', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    await fsState.lastCb!({}); await flush();
    expect(invokeState.store).not.toHaveBeenCalled();
  });

  it('unreadable read → marks the asset missing (#74), no store', async () => {
    g.gate = { ok: false, bytes: null, canonicalPath: null, reason: 'unreadable' };
    const r = getWatcherRegistry('p5', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    await fsState.lastCb!({}); await flush();
    expect(invokeState.store).not.toHaveBeenCalled();
    expect(missing.markMissing).toHaveBeenCalledWith('a1', 'img/x.png');
  });

  it('two events within COALESCE_MS (250ms) collapse to a single store', async () => {
    const r = getWatcherRegistry('p6', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    const cb = fsState.lastCb!;
    await cb({}); await flush();
    await cb({}); await flush(); // immediately again — coalesced
    expect(invokeState.store).toHaveBeenCalledTimes(1);
  });
});

describe('scanForChangedAssets (mtime compare on open)', () => {
  const row = {
    asset_id: 'a1', path: 'img/x.png', external_path: 'img/x.png',
    external_mtime: '2025-01-01T00:00:00.000Z', auto_reload: null,
    mime_type: 'image/png', hash: 'HASH-OLD',
  };

  it('untrusted deck performs ZERO disk access (no stat, checked 0)', async () => {
    g.trusted = false;
    invokeState.linked = [row];
    const res = await scanForChangedAssets('/proj', null);
    expect(res).toEqual({ checked: 0, reloaded: 0 });
    // stat must not have been called for the scan
  });

  it('mtime moved + bytes changed (hash differs) → store + invalidate + reloaded:1', async () => {
    invokeState.linked = [row];
    fsState.statImpl = async () => ({ mtime: new Date('2026-06-01T00:00:00.000Z') }); // moved
    const res = await scanForChangedAssets('/proj', null);
    expect(res.reloaded).toBe(1);
    expect(invokeState.store).toHaveBeenCalled();
    expect(renderer.invalidate).toHaveBeenCalledWith('a1');
  });

  it('mtime moved but bytes identical (hash same) → store (mtime update) but NO invalidate/reload', async () => {
    invokeState.linked = [{ ...row, hash: 'HASH-NEW' }]; // matches sha256Hex mock
    fsState.statImpl = async () => ({ mtime: new Date('2026-06-01T00:00:00.000Z') });
    const res = await scanForChangedAssets('/proj', null);
    expect(res.reloaded).toBe(0);
    expect(invokeState.store).toHaveBeenCalled();
    expect(renderer.invalidate).not.toHaveBeenCalled();
  });

  it('source missing (stat throws) → marks missing, no store', async () => {
    invokeState.linked = [row];
    fsState.statImpl = async () => { throw new Error('ENOENT'); };
    const res = await scanForChangedAssets('/proj', null);
    expect(missing.markMissing).toHaveBeenCalledWith('a1', 'img/x.png');
    expect(res.reloaded).toBe(0);
  });
});
