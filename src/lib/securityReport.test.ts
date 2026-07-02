import { describe, it, expect, beforeEach, vi } from 'vitest';

// Exercises securityReport's two-step model against the REAL trust ledger (in-memory),
// with disk (invoke / resolveAndGate / the store) mocked. Confirms: trust ≠ approve,
// approve requires prior trust, per-folder bulk approve, forbidden rows.

const { fx, files } = vi.hoisted(() => ({
  fx: {
    linked: [] as Array<{ asset_id: string; external_path: string }>,
    forbidden: new Set<string>(),
    deckToken: 'tok' as string | undefined,
  },
  files: new Map<string, string>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string) => {
    if (cmd === 'db_list_linked_assets') return fx.linked;
    throw new Error(`unexpected invoke ${cmd}`);
  },
}));
vi.mock('./assetGate', () => ({
  resolveAndGate: async (abs: string) => (fx.forbidden.has(abs)
    ? { ok: false, reason: 'bad-extension', canonicalPath: null, bytes: null }
    : { ok: true, reason: null, canonicalPath: abs, bytes: new Uint8Array([1]), kind: 'image' }),
}));
vi.mock('../lib/watcherRegistry', () => ({
  resolvePosixPath: (dir: string, rel: string) => (rel.startsWith('/') ? rel : `${dir}/${rel}`),
  dirname: (p: string) => p.slice(0, p.lastIndexOf('/')) || '/',
}));
vi.mock('./assetUsage', () => ({ computeAssetUsage: () => ({ elementCount: 1, slideCount: 1 }) }));
vi.mock('../store/presentation', () => ({
  usePresentationStore: {
    getState: () => ({
      presentation: { config: { deckToken: fx.deckToken } },
      projectPath: '/deck/d.eigendeck',
      updateConfig: (c: { deckToken?: string }) => { if (c.deckToken) fx.deckToken = c.deckToken; },
    }),
  },
}));
// In-memory ledger persistence (so the REAL trustStore/trustLedger run without Tauri).
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: async () => '/appdata', join: async (...p: string[]) => p.join('/') }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: async (p: string) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p)!; },
  writeTextFile: async (p: string, s: string) => { files.set(p, s); },
  mkdir: async () => {},
  exists: async (p: string) => files.has(p),
}));

import * as report from './securityReport';
import * as trustStore from './trustStore';

const A = '/deck/figs/a.png', B = '/deck/figs/b.png', C = '/deck/other/c.png';
const stateOf = (r: report.DeckSecurityReport, id: string) => r.rows.find((x) => x.assetId === id)?.state;

describe('securityReport — two-step trust model', () => {
  beforeEach(() => {
    files.clear();
    trustStore._resetForTests();
    fx.deckToken = 'tok';
    fx.forbidden.clear();
    fx.linked = [
      { asset_id: 'ia', external_path: 'figs/a.png' },
      { asset_id: 'ib', external_path: 'figs/b.png' },
      { asset_id: 'ic', external_path: 'other/c.png' },
    ];
  });

  it('untrusted deck → all linked files are Eligible, deck not trusted', async () => {
    const r = await report.buildDeckSecurityReport();
    expect(r.trusted).toBe(false);
    expect([stateOf(r, 'ia'), stateOf(r, 'ib'), stateOf(r, 'ic')]).toEqual(['eligible', 'eligible', 'eligible']);
  });

  it('approveOne BEFORE trust is a no-op (approve requires prior trust)', async () => {
    const r = await report.approveOne('ia', 'figs/a.png');
    expect(r.trusted).toBe(false);
    expect(stateOf(r, 'ia')).toBe('eligible');
  });

  it('trustThisDeck trusts the deck but approves NOTHING (trust ≠ approve)', async () => {
    const r = await report.trustThisDeck();
    expect(r.trusted).toBe(true);
    expect(r.rows.every((x) => x.state === 'eligible')).toBe(true);
  });

  it('approveDirectory approves only the eligible files in that folder', async () => {
    await report.trustThisDeck();
    const r = await report.approveDirectory('/deck/figs');
    expect(stateOf(r, 'ia')).toBe('approved');
    expect(stateOf(r, 'ib')).toBe('approved');
    expect(stateOf(r, 'ic')).toBe('eligible');   // other/ untouched
  });

  it('approveOne (after trust) approves that one file', async () => {
    await report.trustThisDeck();
    const r = await report.approveOne('ic', 'other/c.png');
    expect(stateOf(r, 'ic')).toBe('approved');
  });

  it('a forbidden (wrong-type) target is shown Forbidden and never approvable', async () => {
    fx.forbidden.add(C);
    await report.trustThisDeck();
    const r0 = await report.buildDeckSecurityReport();
    expect(stateOf(r0, 'ic')).toBe('forbidden');
    // approving it is a no-op — stays forbidden
    const r1 = await report.approveOne('ic', 'other/c.png');
    expect(stateOf(r1, 'ic')).toBe('forbidden');
  });

  it('approvals bind to the resolved target (approved path stays approved across rebuilds)', async () => {
    await report.trustThisDeck();
    await report.approveOne('ia', 'figs/a.png');
    expect(await trustStore.isPathApproved('tok', A)).toBe(true);
    expect(await trustStore.isPathApproved('tok', B)).toBe(false);
  });
});
