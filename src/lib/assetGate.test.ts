import { describe, it, expect, beforeEach, vi } from 'vitest';

const { state } = vi.hoisted(() => ({ state: { impl: null as null | ((cmd: string, args: unknown) => Promise<unknown>) } }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown) => {
    if (!state.impl) throw new Error('no invoke impl');
    return state.impl(cmd, args);
  },
}));

import { resolveAndGate } from './assetGate';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const DEMO = '<!DOCTYPE html>\n<!--eigendeck-demo-v1-->\n<html></html>';

/** Fake resolve_and_read: maps referencePath → { canonicalPath, bytes }. */
function fakeFs(map: Record<string, { canonical: string; bytes: number[] | string }>) {
  state.impl = async (cmd, args) => {
    expect(cmd).toBe('resolve_and_read');
    const path = (args as { path: string }).path;
    const hit = map[path];
    if (!hit) throw new Error(`cannot resolve ${path}`);
    const bytes = typeof hit.bytes === 'string'
      ? [...hit.bytes].map((c) => c.charCodeAt(0) & 0xff)
      : hit.bytes;
    return { canonicalPath: hit.canonical, bytes };
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
