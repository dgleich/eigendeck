import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory fake filesystem shared with the mocked Tauri modules (hoisted so the
// vi.mock factories can close over it).
const { files } = vi.hoisted(() => ({ files: new Map<string, string>() }));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: async () => '/appdata',
  join: async (...p: string[]) => p.join('/'),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: async (p: string) => {
    if (!files.has(p)) throw new Error('ENOENT');
    return files.get(p)!;
  },
  writeTextFile: async (p: string, s: string) => { files.set(p, s); },
  mkdir: async () => {},
  exists: async (p: string) => files.has(p),
}));

import * as store from './trustStore';

const P = '/deck/figs/a.png';
const Q = '/deck/figs/b.png';
const A1 = 'asset-1';
const A2 = 'asset-2';

describe('trustStore (persistence + accessors)', () => {
  beforeEach(() => {
    files.clear();
    store._resetForTests();
  });

  it('unknown deck is untrusted', async () => {
    expect(await store.isTrusted('tok')).toBe(false);
    expect(await store.isPathApproved('tok', P)).toBe(false);
  });

  it('createTrustedDeck persists — survives a cache reset (reload from disk)', async () => {
    await store.createTrustedDeck('tok');
    expect(await store.isTrusted('tok')).toBe(true);
    // a file was written
    expect([...files.keys()]).toContain('/appdata/asset-trust-ledger.json');
    // drop the in-memory cache → must reload from the persisted file
    store._resetForTests();
    expect(await store.isTrusted('tok')).toBe(true);
  });

  it('trustDeck approves the reviewed assets and persists', async () => {
    await store.trustDeck('tok', { [A1]: P });
    expect(await store.isPathApproved('tok', P)).toBe(true);
    store._resetForTests();
    expect(await store.isPathApproved('tok', P)).toBe(true);
  });

  it('approvePath(asset, path) adds to an already-trusted deck', async () => {
    await store.createTrustedDeck('tok');
    expect(await store.approvePath('tok', A1, P)).toBe(true);
    expect(await store.isPathApproved('tok', P)).toBe(true);
  });

  it('re-approving an asset re-points it (relocate) — old path dropped, persists', async () => {
    await store.createTrustedDeck('tok');
    await store.approvePath('tok', A1, P);
    await store.approvePath('tok', A1, Q);   // relocate the same asset
    expect(await store.isPathApproved('tok', Q)).toBe(true);
    expect(await store.isPathApproved('tok', P)).toBe(false);
    store._resetForTests();
    expect(await store.isPathApproved('tok', P)).toBe(false); // survived the reload
  });

  it('reconcileApprovals drops approvals for unreferenced assets, keeps referenced ones', async () => {
    await store.createTrustedDeck('tok');
    await store.approvePath('tok', A1, P);
    await store.approvePath('tok', A2, Q);
    const removed = await store.reconcileApprovals('tok', [A2]);   // A1 no longer linked
    expect(removed).toBe(1);
    expect(await store.isPathApproved('tok', P)).toBe(false);
    expect(await store.isPathApproved('tok', Q)).toBe(true);
    store._resetForTests();
    expect(await store.isPathApproved('tok', P)).toBe(false);      // persisted
  });

  it('revokeDeck removes trust + approvals and persists', async () => {
    await store.trustDeck('tok', { [A1]: P });
    await store.revokeDeck('tok');
    expect(await store.isTrusted('tok')).toBe(false);
    store._resetForTests();
    expect(await store.deckState('tok')).toMatchObject({ status: 'untrusted-new' });
  });

  it('a corrupt ledger file starts clean (fail-safe: untrusted)', async () => {
    files.set('/appdata/asset-trust-ledger.json', '{not json');
    store._resetForTests();
    expect(await store.isTrusted('tok')).toBe(false);
  });
});
