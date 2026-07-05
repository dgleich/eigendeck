// CHARACTERIZATION test for the trust ledger's filesystem boundary — the
// readTextFile/writeTextFile/mkdir/exists calls that move into Rust commands.
// Pins the behaviors most likely to drift in the migration: the on-disk JSON
// shape, mkdir-recursive-before-write, and persist-failure-is-swallowed. After
// migration these mocks swap to `invoke`, but the assertions should still hold.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { files, rec } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  rec: { mkdir: [] as Array<{ dir: string; opts: unknown }>, writeFail: false },
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: async () => '/appdata',
  join: async (...p: string[]) => p.join('/'),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: async (p: string) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p)!; },
  writeTextFile: async (p: string, s: string) => { if (rec.writeFail) throw new Error('EACCES'); files.set(p, s); },
  mkdir: async (dir: string, opts: unknown) => { rec.mkdir.push({ dir, opts }); },
  exists: async (p: string) => files.has(p),
}));

import * as store from './trustStore';

const LEDGER = '/appdata/asset-trust-ledger.json';

describe('trustStore fs-boundary characterization', () => {
  beforeEach(() => { files.clear(); rec.mkdir = []; rec.writeFail = false; store._resetForTests(); });

  it('writes the ledger with the expected on-disk JSON shape', async () => {
    await store.createTrustedDeck('tok');
    await store.approvePath('tok', 'asset-1', '/real/x.png', 'add');
    const raw = files.get(LEDGER);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    // keyed by deck token → { trusted, approvals: { [assetId]: { resolved, ... } } }
    expect(parsed.tok.trusted).toBe(true);
    expect(parsed.tok.approvals['asset-1'].resolved).toBe('/real/x.png');
    expect(typeof parsed.tok.trustedAt).toBe('number');
  });

  it('creates the ledger directory recursively before the first write', async () => {
    await store.createTrustedDeck('tok');
    expect(rec.mkdir).toContainEqual({ dir: '/appdata', opts: { recursive: true } });
  });

  it('swallows a persist failure — no throw, decision holds in-memory this session', async () => {
    rec.writeFail = true;
    await expect(store.createTrustedDeck('tok')).resolves.toBeUndefined();
    // in-memory cache still reflects the decision even though the write failed
    expect(await store.isTrusted('tok')).toBe(true);
    // but nothing was persisted
    expect(files.has(LEDGER)).toBe(false);
  });

  it('missing ledger file → untrusted (fail-safe), no throw', async () => {
    expect(await store.isTrusted('whatever')).toBe(false);
  });

  it('corrupt ledger JSON → untrusted (fail-safe), no throw', async () => {
    files.set(LEDGER, '{ this is not json');
    store._resetForTests();
    expect(await store.isTrusted('tok')).toBe(false);
  });
});
