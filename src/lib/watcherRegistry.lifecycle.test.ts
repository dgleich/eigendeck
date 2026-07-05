// CHARACTERIZATION test for the watcher's filesystem boundary. Post-migration the
// watch is the Rust watch_path/unwatch_path pair (events over `fs-watch-event`)
// and stat is path_stat, so this mocks `invoke` + `@tauri-apps/api/event` instead
// of the fs plugin. The observable behavior is unchanged EXCEPT one intended diff,
// noted below: there's no longer a delayMs:100 passed at watch time — Rust emits
// raw notify events and the COALESCE_MS window in handleChange collapses the burst
// (it always did; delayMs never truly coalesced). mtime is now epoch-ms → the same
// millisecond-precision ISO string as the old plugin-fs stat.

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

const rig: {
  watchPaths: Array<{ id: number; path: string }>;
  unwatched: number[];
  nextId: number;
  eventHandler: ((e: { payload: { id: number; path: string } }) => void) | null;
  statImpl: (p: string) => Promise<{ mtimeMs: number | null; size: number; isFile: boolean; isDir: boolean }>;
  store: Mock;
  linked: unknown[];
} = {
  watchPaths: [], unwatched: [], nextId: 1, eventHandler: null,
  statImpl: async () => ({ mtimeMs: Date.parse('2026-01-01T00:00:00.000Z'), size: 3, isFile: true, isDir: false }),
  store: vi.fn(async () => 'stored-id'), linked: [],
};

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, handler: (e: { payload: { id: number; path: string } }) => void) => {
    if (name === 'fs-watch-event') rig.eventHandler = handler;
    return () => {};
  },
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: any) => {
    if (cmd === 'watch_path') { const id = rig.nextId++; rig.watchPaths.push({ id, path: args.path }); return id; }
    if (cmd === 'unwatch_path') { rig.unwatched.push(args.id); return undefined; }
    if (cmd === 'path_stat') return rig.statImpl(args.path);
    if (cmd === 'db_store_asset') return rig.store();
    if (cmd === 'db_list_linked_assets') return rig.linked;
    return undefined;
  },
}));

// gate + trust + side-effect deps
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
vi.mock('./preferences', () => ({ getPreference: () => true, effectiveAutoReload: () => true }));
vi.mock('./hash', () => ({ sha256Hex: async () => 'HASH-NEW' }));

import { getWatcherRegistry, closeWatcherRegistry, scanForChangedAssets } from './watcherRegistry';

const OK_BYTES = new Uint8Array([1, 2, 3]);
function okGate() { g.gate = { ok: true, bytes: OK_BYTES, canonicalPath: '/real/x.png', reason: null }; }
const flush = () => new Promise((r) => setTimeout(r, 0));
/** Simulate a disk event on the most-recently-registered watch. */
async function fireLast() {
  const w = rig.watchPaths[rig.watchPaths.length - 1];
  rig.eventHandler?.({ payload: { id: w.id, path: w.path } });
  await flush();
}

beforeEach(() => {
  rig.watchPaths = []; rig.unwatched = [];
  rig.statImpl = async () => ({ mtimeMs: Date.parse('2026-01-01T00:00:00.000Z'), size: 3, isFile: true, isDir: false });
  rig.store = vi.fn(async () => 'stored-id'); rig.linked = [];
  renderer.invalidate.mockClear(); missing.markMissing.mockClear(); missing.markFound.mockClear();
  g.token = 'tok'; g.trusted = true; g.approved = true; okGate();
  for (const id of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) closeWatcherRegistry(id);
});

describe('watch lifecycle (Rust watch_path/unwatch_path)', () => {
  it('first subscriber registers exactly one watch for the abs path (no delayMs — Rust emits raw)', async () => {
    const r = getWatcherRegistry('p1', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    expect(rig.watchPaths).toHaveLength(1);
    expect(rig.watchPaths[0].path).toBe('/proj/img/x.png');
  });

  it('a second asset on the same path does NOT open a second watch', async () => {
    const r = getWatcherRegistry('p2', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    await r.addRef('img/x.png', 'a2', 'el2', 'img/x.png', 'image/png');
    expect(rig.watchPaths).toHaveLength(1);
  });

  it('unwatch fires only when the LAST asset on a path unsubscribes (ref-counted)', async () => {
    const r = getWatcherRegistry('p3', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    await r.addRef('img/x.png', 'a2', 'el2', 'img/x.png', 'image/png');
    const id = rig.watchPaths[0].id;
    r.removeRef('img/x.png', 'a1', 'el1');
    expect(rig.unwatched).not.toContain(id);
    r.removeRef('img/x.png', 'a2', 'el2');
    expect(rig.unwatched).toContain(id);
  });

  it('closeWatcherRegistry unwatches everything', async () => {
    const r = getWatcherRegistry('p4', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    const id = rig.watchPaths[0].id;
    closeWatcherRegistry('p4');
    expect(rig.unwatched).toContain(id);
  });
});

describe('handleChange (disk event → gate → path_stat mtime → store)', () => {
  it('ok read → stats for mtime and stores each asset + invalidates', async () => {
    const r = getWatcherRegistry('p5', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    await fireLast();
    expect(rig.store).toHaveBeenCalledTimes(1);
    expect(renderer.invalidate).toHaveBeenCalledWith('a1');
    expect(missing.markFound).toHaveBeenCalledWith('a1');
  });

  it('gated read → no store (snapshot stays)', async () => {
    g.approved = false;
    const r = getWatcherRegistry('p5', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    await fireLast();
    expect(rig.store).not.toHaveBeenCalled();
  });

  it('unreadable read → marks the asset missing (#74), no store', async () => {
    g.gate = { ok: false, bytes: null, canonicalPath: null, reason: 'unreadable' };
    const r = getWatcherRegistry('p5', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    await fireLast();
    expect(rig.store).not.toHaveBeenCalled();
    expect(missing.markMissing).toHaveBeenCalledWith('a1', 'img/x.png');
  });

  it('two events within COALESCE_MS (250ms) collapse to a single store', async () => {
    const r = getWatcherRegistry('p6', '/proj');
    await r.addRef('img/x.png', 'a1', 'el1', 'img/x.png', 'image/png');
    await fireLast();
    await fireLast(); // immediately again — coalesced
    expect(rig.store).toHaveBeenCalledTimes(1);
  });
});

describe('scanForChangedAssets (path_stat mtime compare on open)', () => {
  const row = {
    asset_id: 'a1', path: 'img/x.png', external_path: 'img/x.png',
    external_mtime: '2025-01-01T00:00:00.000Z', auto_reload: null,
    mime_type: 'image/png', hash: 'HASH-OLD',
  };

  it('untrusted deck performs ZERO disk access (checked 0)', async () => {
    g.trusted = false;
    rig.linked = [row];
    expect(await scanForChangedAssets('/proj', null)).toEqual({ checked: 0, reloaded: 0 });
  });

  it('mtime moved + bytes changed (hash differs) → store + invalidate + reloaded:1', async () => {
    rig.linked = [row];
    rig.statImpl = async () => ({ mtimeMs: Date.parse('2026-06-01T00:00:00.000Z'), size: 3, isFile: true, isDir: false });
    const res = await scanForChangedAssets('/proj', null);
    expect(res.reloaded).toBe(1);
    expect(rig.store).toHaveBeenCalled();
    expect(renderer.invalidate).toHaveBeenCalledWith('a1');
  });

  it('mtime moved but bytes identical (hash same) → store (mtime update) but NO invalidate/reload', async () => {
    rig.linked = [{ ...row, hash: 'HASH-NEW' }];
    rig.statImpl = async () => ({ mtimeMs: Date.parse('2026-06-01T00:00:00.000Z'), size: 3, isFile: true, isDir: false });
    const res = await scanForChangedAssets('/proj', null);
    expect(res.reloaded).toBe(0);
    expect(rig.store).toHaveBeenCalled();
    expect(renderer.invalidate).not.toHaveBeenCalled();
  });

  it('source missing (path_stat rejects) → marks missing, no store', async () => {
    rig.linked = [row];
    rig.statImpl = async () => { throw new Error('ENOENT'); };
    const res = await scanForChangedAssets('/proj', null);
    expect(missing.markMissing).toHaveBeenCalledWith('a1', 'img/x.png');
    expect(res.reloaded).toBe(0);
  });
});
