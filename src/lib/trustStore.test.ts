import { describe, it, expect, beforeEach, vi } from 'vitest';

// The trust ledger now persists via the Rust read_trust_ledger / write_trust_ledger
// commands (the webview has no fs-plugin access). Back them with one JSON slot.
const { led } = vi.hoisted(() => ({ led: { json: null as string | null } }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: { json?: string }) => {
    if (cmd === 'read_trust_ledger') return led.json;
    if (cmd === 'write_trust_ledger') { led.json = args!.json!; return undefined; }
    throw new Error(`unexpected invoke ${cmd}`);
  },
}));

import * as store from './trustStore';

const P = '/deck/figs/a.png';
const Q = '/deck/figs/b.png';
const A1 = 'asset-1';
const A2 = 'asset-2';

describe('trustStore (persistence + accessors)', () => {
  beforeEach(() => {
    led.json = null;
    store._resetForTests();
  });

  it('unknown deck is untrusted', async () => {
    expect(await store.isTrusted('tok')).toBe(false);
    expect(await store.isPathApproved('tok', P)).toBe(false);
  });

  it('createTrustedDeck persists — survives a cache reset (reload from disk)', async () => {
    await store.createTrustedDeck('tok');
    expect(await store.isTrusted('tok')).toBe(true);
    // a ledger was written
    expect(led.json).not.toBeNull();
    // drop the in-memory cache → must reload from the persisted file
    store._resetForTests();
    expect(await store.isTrusted('tok')).toBe(true);
  });

  it('approvePath(asset, path) adds to an already-trusted deck', async () => {
    await store.createTrustedDeck('tok');
    expect(await store.approvePath('tok', A1, P, 'add')).toBe(true);
    expect(await store.isPathApproved('tok', P)).toBe(true);
  });

  it('re-approving an asset re-points it (relocate) — old path dropped, persists', async () => {
    await store.createTrustedDeck('tok');
    await store.approvePath('tok', A1, P, 'add');
    await store.approvePath('tok', A1, Q, 'add');   // relocate the same asset
    expect(await store.isPathApproved('tok', Q)).toBe(true);
    expect(await store.isPathApproved('tok', P)).toBe(false);
    store._resetForTests();
    expect(await store.isPathApproved('tok', P)).toBe(false); // survived the reload
  });

  it('reconcileApprovals drops approvals for unreferenced assets, keeps referenced ones', async () => {
    await store.createTrustedDeck('tok');
    await store.approvePath('tok', A1, P, 'add');
    await store.approvePath('tok', A2, Q, 'add');
    const removed = await store.reconcileApprovals('tok', [A2]);   // A1 no longer linked
    expect(removed).toBe(1);
    expect(await store.isPathApproved('tok', P)).toBe(false);
    expect(await store.isPathApproved('tok', Q)).toBe(true);
    store._resetForTests();
    expect(await store.isPathApproved('tok', P)).toBe(false);      // persisted
  });

  it('revokeDeck removes trust + approvals and persists', async () => {
    await store.createTrustedDeck('tok');
    await store.approvePath('tok', A1, P, 'add');
    await store.revokeDeck('tok');
    expect(await store.isTrusted('tok')).toBe(false);
    store._resetForTests();
    expect(await store.deckState('tok')).toMatchObject({ status: 'untrusted-new' });
  });

  it('a corrupt ledger file starts clean (fail-safe: untrusted)', async () => {
    led.json = '{not json';
    store._resetForTests();
    expect(await store.isTrusted('tok')).toBe(false);
  });

  it('per-deck internet block persists and works on an untrusted deck', async () => {
    expect(await store.isDeckInternetBlocked('tok')).toBe(false); // default: allowed
    await store.setDeckInternetBlocked('tok', true);              // block (deck not trusted)
    expect(await store.isDeckInternetBlocked('tok')).toBe(true);
    store._resetForTests();                                       // reload from persisted json
    expect(await store.isDeckInternetBlocked('tok')).toBe(true);  // survived
    await store.setDeckInternetBlocked('tok', false);
    expect(await store.isDeckInternetBlocked('tok')).toBe(false);
  });

  it('per-demo internet block is independent per assetId, persists, and toggles off', async () => {
    expect(await store.isDeckDemoBlocked('tok', 'demoA')).toBe(false); // default allowed
    await store.setDeckDemoBlocked('tok', 'demoA', true);              // deny just demoA
    expect(await store.isDeckDemoBlocked('tok', 'demoA')).toBe(true);
    expect(await store.isDeckDemoBlocked('tok', 'demoB')).toBe(false); // others unaffected
    store._resetForTests();                                            // reload from persisted json
    expect(await store.isDeckDemoBlocked('tok', 'demoA')).toBe(true);  // survived
    await store.setDeckDemoBlocked('tok', 'demoA', false);             // re-allow
    expect(await store.isDeckDemoBlocked('tok', 'demoA')).toBe(false);
  });

  it('internet block (deck + per-demo) SURVIVES trusting the deck', async () => {
    await store.setDeckInternetBlocked('tok', true);          // block on an untrusted deck
    await store.setDeckDemoBlocked('tok', 'demoZ', true);
    await store.createTrustedDeck('tok');                     // now trust it
    expect(await store.isTrusted('tok')).toBe(true);
    expect(await store.isDeckInternetBlocked('tok')).toBe(true);   // block NOT wiped by trust
    expect(await store.isDeckDemoBlocked('tok', 'demoZ')).toBe(true);
  });
});
