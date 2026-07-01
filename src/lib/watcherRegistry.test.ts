import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared state for the mocked deps gatedExternalRead dynamic-imports.
const { g } = vi.hoisted(() => ({ g: {
  token: undefined as string | undefined,
  trusted: false,
  approved: false,
  gate: { ok: false, kind: null as string | null, reason: 'unreadable' as string | null, bytes: null as Uint8Array | null, canonicalPath: null as string | null },
} }));
vi.mock('../store/presentation', () => ({
  usePresentationStore: { getState: () => ({ presentation: { config: { deckToken: g.token } } }) },
}));
vi.mock('./trustStore', () => ({ isTrusted: async () => g.trusted, isPathApproved: async () => g.approved }));
vi.mock('./assetGate', () => ({ resolveAndGate: async () => g.gate }));

import { deriveRelocateOffset, resolvePosixPath, dirname, gatedExternalRead } from './watcherRegistry';

describe('gatedExternalRead (asset-security read gate)', () => {
  beforeEach(() => { g.token = undefined; g.trusted = false; g.approved = false; g.gate = { ok: false, kind: null, reason: 'unreadable', bytes: null, canonicalPath: null }; });

  it('no deck token → gated (received deck never reads)', async () => {
    expect(await gatedExternalRead('/x.png')).toEqual({ status: 'gated' });
  });
  it('untrusted deck → gated', async () => {
    g.token = 'tok'; g.trusted = false;
    expect(await gatedExternalRead('/x.png')).toEqual({ status: 'gated' });
  });
  it('trusted + gate ok + APPROVED → ok with bytes', async () => {
    g.token = 'tok'; g.trusted = true; g.approved = true;
    const bytes = new Uint8Array([1, 2, 3]);
    g.gate = { ok: true, kind: 'image', reason: null, bytes, canonicalPath: '/real/x.png' };
    expect(await gatedExternalRead('/x.png')).toEqual({ status: 'ok', bytes });
  });
  it('trusted + gate ok but NOT approved → gated (per-path)', async () => {
    g.token = 'tok'; g.trusted = true; g.approved = false;
    g.gate = { ok: true, kind: 'image', reason: null, bytes: new Uint8Array([1]), canonicalPath: '/real/x.png' };
    expect(await gatedExternalRead('/x.png')).toEqual({ status: 'gated' });
  });
  it('trusted + unreadable → unreadable (preserves #74 missing flag upstream)', async () => {
    g.token = 'tok'; g.trusted = true; g.approved = true;
    g.gate = { ok: false, kind: null, reason: 'unreadable', bytes: null, canonicalPath: null };
    expect(await gatedExternalRead('/x.png')).toEqual({ status: 'unreadable' });
  });
  it('trusted + wrong-type (content-mismatch) → gated, not unreadable', async () => {
    g.token = 'tok'; g.trusted = true; g.approved = true;
    g.gate = { ok: false, kind: 'image', reason: 'content-mismatch', bytes: null, canonicalPath: null };
    expect(await gatedExternalRead('/x.png')).toEqual({ status: 'gated' });
  });
});

describe('deriveRelocateOffset (#74 relocate-all by offset)', () => {
  it('derives a one-level directory move (strips the full shared suffix)', () => {
    // shared suffix is images/foo.svg → only the differing dirs remain
    expect(deriveRelocateOffset('/a/b/images/foo.svg', '/a/c/images/foo.svg'))
      .toEqual({ oldPrefix: '/a/b', newPrefix: '/a/c' });
  });

  it('derives a whole-tree move (shared trailing subtree)', () => {
    // common suffix proj/img/foo.svg → only the differing roots remain
    expect(deriveRelocateOffset('/old/proj/img/foo.svg', '/new/home/proj/img/foo.svg'))
      .toEqual({ oldPrefix: '/old', newPrefix: '/new/home' });
  });

  it('returns null when the file was also renamed (no shared suffix)', () => {
    expect(deriveRelocateOffset('/a/foo.svg', '/b/bar.svg')).toBeNull();
  });

  it('returns null when nothing moved (identical path)', () => {
    expect(deriveRelocateOffset('/a/img/x.svg', '/a/img/x.svg')).toBeNull();
  });

  it('handles a sibling-folder move', () => {
    expect(deriveRelocateOffset('/x/img/a.svg', '/y/img/a.svg'))
      .toEqual({ oldPrefix: '/x', newPrefix: '/y' });
  });

  it('the offset remaps a SIBLING asset correctly', () => {
    // simulate applying the derived offset to another missing asset under the tree
    const off = deriveRelocateOffset('/old/deck/images/logo.svg', '/new/deck/images/logo.svg')!;
    expect(off).toEqual({ oldPrefix: '/old', newPrefix: '/new' }); // shared deck/images/logo.svg stripped
    const otherOld = '/old/deck/images/diagram.png';
    const candidate = off.newPrefix + otherOld.slice(off.oldPrefix.length);
    expect(candidate).toBe('/new/deck/images/diagram.png');
  });

  it('the offset remaps a NESTED asset across a tree move', () => {
    const off = deriveRelocateOffset('/old/talks/assets/a.svg', '/Users/dg/talks/assets/a.svg')!;
    // common suffix talks/assets/a.svg → oldPrefix=/old newPrefix=/Users/dg
    expect(off).toEqual({ oldPrefix: '/old', newPrefix: '/Users/dg' });
    const nestedOld = '/old/talks/assets/sub/deep.png';
    expect(off.newPrefix + nestedOld.slice(off.oldPrefix.length)).toBe('/Users/dg/talks/assets/sub/deep.png');
  });

  it('resolvePosixPath + offset compose for a relative external_path', () => {
    const projDir = '/old/deck';
    const oldAbs = resolvePosixPath(projDir, 'images/foo.svg'); // /old/deck/images/foo.svg
    const off = deriveRelocateOffset(oldAbs, '/new/deck/images/foo.svg')!;
    const otherAbs = resolvePosixPath(projDir, 'images/bar.svg');
    expect(off.newPrefix + otherAbs.slice(off.oldPrefix.length)).toBe('/new/deck/images/bar.svg');
    expect(dirname(oldAbs)).toBe('/old/deck/images');
  });
});
