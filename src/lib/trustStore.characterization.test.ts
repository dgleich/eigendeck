// CHARACTERIZATION test for the trust ledger's persistence boundary. Post-migration
// the ledger persists via the Rust read_trust_ledger / write_trust_ledger commands
// (the webview has no fs-plugin access), so this mocks `invoke`. The on-disk JSON
// shape, persist-failure-swallowed, and fail-safe-untrusted behaviors are unchanged.
//
// BEHAVIOR DIFF vs the pre-migration version: the "mkdir the app-data dir
// recursively before writing" step is no longer observable from JS — it moved
// into the Rust write_trust_ledger command (std::fs::create_dir_all). The
// directory is still created before the write; it's just Rust's responsibility now
// (covered by the fscmds Rust tests). So the old JS-side mkdir assertion is gone.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { led } = vi.hoisted(() => ({ led: { json: null as string | null, failWrite: false } }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: { json?: string }) => {
    if (cmd === 'read_trust_ledger') return led.json;
    if (cmd === 'write_trust_ledger') {
      if (led.failWrite) throw new Error('EACCES');
      led.json = args!.json!;
      return undefined;
    }
    throw new Error(`unexpected invoke ${cmd}`);
  },
}));

import * as store from './trustStore';

describe('trustStore persistence characterization', () => {
  beforeEach(() => { led.json = null; led.failWrite = false; store._resetForTests(); });

  it('writes the ledger with the expected on-disk JSON shape', async () => {
    await store.createTrustedDeck('tok');
    await store.approvePath('tok', 'asset-1', '/real/x.png', 'add');
    expect(led.json).toBeTruthy();
    const parsed = JSON.parse(led.json!);
    // keyed by deck token → { trusted, approvals: { [assetId]: { resolved, ... } } }
    expect(parsed.tok.trusted).toBe(true);
    expect(parsed.tok.approvals['asset-1'].resolved).toBe('/real/x.png');
    expect(typeof parsed.tok.trustedAt).toBe('number');
  });

  it('swallows a persist failure — no throw, decision holds in-memory this session', async () => {
    led.failWrite = true;
    await expect(store.createTrustedDeck('tok')).resolves.toBeUndefined();
    // in-memory cache still reflects the decision even though the write failed
    expect(await store.isTrusted('tok')).toBe(true);
    // but nothing was persisted
    expect(led.json).toBeNull();
  });

  it('missing ledger → untrusted (fail-safe), no throw', async () => {
    expect(await store.isTrusted('whatever')).toBe(false);
  });

  it('corrupt ledger JSON → untrusted (fail-safe), no throw', async () => {
    led.json = '{ this is not json';
    store._resetForTests();
    expect(await store.isTrusted('tok')).toBe(false);
  });
});
