import { describe, it, expect, beforeEach, vi } from 'vitest';

const { state } = vi.hoisted(() => ({ state: { impl: null as null | ((cmd: string, args: unknown) => Promise<unknown>) } }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown) => {
    if (!state.impl) throw new Error('no invoke impl');
    return state.impl(cmd, args);
  },
}));

import { resolveAndGate, resolveAndGateDecision } from './assetGate';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const DEMO = '<!DOCTYPE html>\n<!--eigendeck-demo-v1-->\n<html></html>';

/** Fake resolve_and_read: maps referencePath → { canonicalPath, bytes }. Honors the
 *  maxBytes bound (returns a prefix) and always reports the FULL size, like the Rust
 *  primitive — so the decision/sniff path is exercised faithfully. */
function fakeFs(map: Record<string, { canonical: string; bytes: number[] | string }>) {
  state.impl = async (cmd, args) => {
    expect(cmd).toBe('resolve_and_read');
    const { path, maxBytes } = args as { path: string; maxBytes: number | null };
    const hit = map[path];
    if (!hit) throw new Error(`cannot resolve ${path}`);
    const full = typeof hit.bytes === 'string'
      ? [...hit.bytes].map((c) => c.charCodeAt(0) & 0xff)
      : hit.bytes;
    const bytes = maxBytes == null ? full : full.slice(0, maxBytes);
    return { canonicalPath: hit.canonical, bytes, size: full.length };
  };
}

describe('resolveAndGate', () => {
  beforeEach(() => { state.impl = null; });

  it('accepts a genuine png, returning resolved path + bytes', async () => {
    fakeFs({ 'figs/a.png': { canonical: '/deck/figs/a.png', bytes: PNG } });
    const r = await resolveAndGate('figs/a.png');
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('image');
    expect(r.canonicalPath).toBe('/deck/figs/a.png');
    expect(r.bytes).toBeInstanceOf(Uint8Array);
  });

  it('gates on the RESOLVED target — a symlink to a secret is rejected by extension', async () => {
    // reference ends .png but resolves to id_rsa (no allowed extension)
    fakeFs({ 'figs/a.png': { canonical: '/home/u/.ssh/id_rsa', bytes: 'PRIVATE KEY' } });
    const r = await resolveAndGate('figs/a.png');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad-extension');
    expect(r.bytes).toBeNull();               // rejected bytes not handed back
    expect(r.canonicalPath).toBe('/home/u/.ssh/id_rsa'); // shown for the UI (destination-forward)
  });

  it('rejects a secret misnamed .png (content mismatch)', async () => {
    fakeFs({ 'a.png': { canonical: '/deck/a.png', bytes: 'not an image' } });
    const r = await resolveAndGate('a.png');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('content-mismatch');
  });

  it('accepts a marked demo', async () => {
    fakeFs({ 'd.html': { canonical: '/deck/d.html', bytes: DEMO } });
    expect((await resolveAndGate('d.html')).ok).toBe(true);
  });

  it('read failure → reason "unreadable", never throws', async () => {
    fakeFs({}); // nothing resolves
    const r = await resolveAndGate('missing.png');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unreadable');
    expect(r.error).toBeTruthy();
  });
});

// The bounded "sniff" read must reach the SAME verdict as the full read, or the report
// would classify a file differently from the actual read gate. All inputs here are
// LARGER than the 4 KB sniff bound, so the equivalence is genuinely exercised (incl. the
// .ipynb full re-read fallback).
describe('resolveAndGateDecision matches resolveAndGate (no divergence)', () => {
  const bigValidPng = [...PNG, ...Array(6000).fill(0)];                 // magic ok, big
  const bigNotPng = 'X'.repeat(6000);                                   // magic fail, big
  const bigDemo = DEMO + '\n' + '<!-- pad -->'.repeat(600);             // marker in prefix, big
  const bigNotebook = JSON.stringify({ nbformat: 4, cells: [{ cell_type: 'code', source: 'x'.repeat(6000) }] }); // valid, > sniff
  const brokenNotebook = '{ not valid json '.repeat(500);              // .ipynb but unparseable, > sniff

  const cases: Array<[string, string, number[] | string]> = [
    ['big.png', '/deck/big.png', bigValidPng],
    ['bad.png', '/deck/bad.png', bigNotPng],
    ['d.html', '/deck/d.html', bigDemo],
    ['nb.ipynb', '/deck/nb.ipynb', bigNotebook],
    ['broken.ipynb', '/deck/broken.ipynb', brokenNotebook],
  ];
  beforeEach(() => { state.impl = null; });
  for (const [ref, canon, bytes] of cases) {
    it(`${ref}: decision verdict == full verdict`, async () => {
      fakeFs({ [ref]: { canonical: canon, bytes } });
      const full = await resolveAndGate(ref);
      const dec = await resolveAndGateDecision(ref);
      expect(dec.ok).toBe(full.ok);
      expect(dec.reason).toBe(full.reason);
      expect(dec.canonicalPath).toBe(full.canonicalPath);
      expect(dec.bytes).toBeNull();  // decision never hands back (possibly partial) bytes
    });
  }
});
