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

  it('trustDeck approves the reviewed paths and persists', async () => {
    await store.trustDeck('tok', [P]);
    expect(await store.isPathApproved('tok', P)).toBe(true);
    store._resetForTests();
    expect(await store.isPathApproved('tok', P)).toBe(true);
  });

  it('approvePath adds to an already-trusted deck', async () => {
    await store.createTrustedDeck('tok');
    expect(await store.approvePath('tok', P)).toBe(true);
    expect(await store.isPathApproved('tok', P)).toBe(true);
  });

  it('revokeDeck removes trust + approvals and persists', async () => {
    await store.trustDeck('tok', [P]);
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
