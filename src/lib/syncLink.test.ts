import { describe, it, expect } from 'vitest';
import {
  IDENTITY_KEYS, freeDelta, resyncDelta, unlinkDelta, relinkDelta,
  detachDelta, linkPairDeltas, pruneOrphanedGroups, deriveSyncIds, pasteDecision,
} from './syncLink';
import type { Slide } from '../types/presentation';

// Minimal slide/element builder for prune tests.
const slide = (...els: any[]): Slide => ({ id: 's', elements: els, notes: '' } as any);
const el = (id: string, extra: any = {}) =>
  ({ id, type: 'text', preset: 'body', html: '', position: { x: 0, y: 0, width: 1, height: 1 }, ...extra });

describe('syncLink delta helpers', () => {
  it('freeDelta drops syncId and remembers it; no-op when not synced', () => {
    expect(freeDelta({ syncId: 'g1' })).toEqual({ syncId: undefined, _syncId: 'g1' });
    expect(freeDelta({ syncId: undefined })).toEqual({});
  });

  it('resyncDelta restores the remembered syncId; no-op when none', () => {
    expect(resyncDelta({ _syncId: 'g1' })).toEqual({ syncId: 'g1', _syncId: undefined });
    expect(resyncDelta({ _syncId: undefined })).toEqual({});
  });

  it('unlinkDelta ALWAYS remembers the linkId (the forget-bug fix)', () => {
    expect(unlinkDelta({ linkId: 'L1' })).toEqual({ linkId: undefined, _linkId: 'L1' });
    expect(unlinkDelta({ linkId: undefined })).toEqual({});
  });

  it('relinkDelta restores the remembered linkId; no-op when none', () => {
    expect(relinkDelta({ _linkId: 'L1' })).toEqual({ linkId: 'L1', _linkId: undefined });
    expect(relinkDelta({ _linkId: undefined })).toEqual({});
  });

  it('detachDelta clears all four (live + remembered)', () => {
    expect(detachDelta()).toEqual({
      syncId: undefined, _syncId: undefined, linkId: undefined, _linkId: undefined,
    });
  });

  it('free → resync round-trips the syncId', () => {
    const free = freeDelta({ syncId: 'g7' });
    const back = resyncDelta({ _syncId: free._syncId });
    expect(back.syncId).toBe('g7');
  });

  it('unlink → relink round-trips the linkId', () => {
    const un = unlinkDelta({ linkId: 'L7' });
    const re = relinkDelta({ _linkId: un._linkId });
    expect(re.linkId).toBe('L7');
  });
});

describe('linkPairDeltas — animation link only, non-destructive', () => {
  it('mints a fresh shared linkId and clears _linkId; NEVER touches syncId', () => {
    const { sharedLinkId, delta, mergeIds } = linkPairDeltas({}, {}, () => 'NEW');
    expect(sharedLinkId).toBe('NEW');
    // Link-only + symmetric (#30): both sides get the shared linkId and a
    // cleared _linkId. No syncId/_syncId — "L" must not sync/merge.
    expect(delta).toEqual({ linkId: 'NEW', _linkId: undefined });
    expect('syncId' in delta).toBe(false);
    expect('_syncId' in delta).toBe(false);
    expect(mergeIds).toEqual([]);
  });

  it("prefers the SOURCE's existing group so links from an anchor don't strand", () => {
    // anchor (source) already in group L1, target unlinked → keep L1.
    const { sharedLinkId, mergeIds } = linkPairDeltas({ linkId: 'L1' }, {}, () => 'unused');
    expect(sharedLinkId).toBe('L1');
    expect(mergeIds).toEqual([]);
  });

  it("falls back to the target's group when the source has none", () => {
    const { sharedLinkId } = linkPairDeltas({}, { linkId: 'TL' }, () => 'unused');
    expect(sharedLinkId).toBe('TL');
  });

  it('revives a remembered group rather than minting a new one', () => {
    const { sharedLinkId } = linkPairDeltas({ _linkId: 'OLDL' }, {}, () => 'unused');
    expect(sharedLinkId).toBe('OLDL');
  });

  it('merging two live groups reports the other id so all members migrate', () => {
    // source in L1, target in L2 → keep L1, report L2 for migration.
    const { sharedLinkId, mergeIds } = linkPairDeltas({ linkId: 'L1' }, { linkId: 'L2' }, () => 'x');
    expect(sharedLinkId).toBe('L1');
    expect(mergeIds).toEqual(['L2']);
  });
});

describe('IDENTITY_KEYS', () => {
  // Copies of one element are one row, so link and remembered ids are data shared
  // by every copy; only the id and the derived syncId are identity.
  it('is exactly the id and the derived syncId', () => {
    expect([...IDENTITY_KEYS].sort()).toEqual(['id', 'syncId']);
  });
});

describe('pruneOrphanedGroups', () => {
  it('strips a syncId/linkId left with a single member (duplicate→delete)', () => {
    // One slide whose element kept syncId+linkId after its partner slide was cut.
    const out = pruneOrphanedGroups([slide(el('a', { syncId: 'g', linkId: 'L' }))]);
    expect(out[0].elements[0].syncId).toBeUndefined();
    expect(out[0].elements[0].linkId).toBeUndefined();
  });

  it('keeps a genuine multi-member group intact', () => {
    const before = [
      slide(el('a', { syncId: 'g', linkId: 'L' })),
      slide(el('b', { syncId: 'g', linkId: 'L' })),
    ];
    const out = pruneOrphanedGroups(before);
    expect(out).toBe(before); // unchanged → same reference
    expect(out[0].elements[0].syncId).toBe('g');
  });

  it('counts a REMEMBERED group member (_syncId) as keeping the partner alive', () => {
    // One active (syncId) + one freed-but-remembering (_syncId) = 2 → not orphaned.
    const before = [
      slide(el('a', { syncId: 'g' })),
      slide(el('b', { _syncId: 'g' })),
    ];
    expect(pruneOrphanedGroups(before)).toBe(before);
  });

  it('drops a lone REMEMBERED-only id too (group truly gone)', () => {
    const out = pruneOrphanedGroups([slide(el('a', { _syncId: 'g' }))]);
    expect((out[0].elements[0] as any)._syncId).toBeUndefined();
  });

  it('prunes sync and link INDEPENDENTLY', () => {
    // sync group of 2 (kept), link group of 1 (pruned), on the same element.
    const before = [
      slide(el('a', { syncId: 'g', linkId: 'L' })),
      slide(el('b', { syncId: 'g' })),
    ];
    const out = pruneOrphanedGroups(before);
    expect(out[0].elements[0].syncId).toBe('g');     // sync kept
    expect(out[0].elements[0].linkId).toBeUndefined(); // lone link pruned
  });

  it('returns the same array reference when nothing is orphaned (no churn)', () => {
    const before = [slide(el('a'), el('b'))]; // no sync/link at all
    expect(pruneOrphanedGroups(before)).toBe(before);
  });
});

// Rule 3 of the "SQLite is the source of truth" addendum: synced is derived.
describe('deriveSyncIds', () => {
  const s = (id: string, ids: string[], syncs: (string | undefined)[] = []) =>
    ({ id, layout: 'default', notes: '', elements: ids.map((e, i) => ({
      id: e, type: 'text', preset: 'body', html: e, position: { x: 0, y: 0, width: 1, height: 1 },
      ...(syncs[i] ? { syncId: syncs[i] } : {}),
    })) }) as unknown as Slide;
  it('marks an id synced exactly when it is on more than one slide', () => {
    const out = deriveSyncIds([s('a', ['X', 'Y']), s('b', ['X'])]);
    expect(out[0].elements.map((e) => e.syncId)).toEqual(['X', undefined]);
    expect(out[1].elements[0].syncId).toBe('X');
  });
  it('clears a stale syncId and keeps untouched slides and arrays identical', () => {
    const slides = [s('a', ['X'], ['OLD']), s('b', ['Z'])];
    const out = deriveSyncIds(slides);
    expect(out[0].elements[0].syncId).toBeUndefined();
    expect('syncId' in out[0].elements[0]).toBe(false);
    expect(out[1]).toBe(slides[1]);
    expect(deriveSyncIds(out)).toBe(out);
  });
});

// How a pasted copy lands: the join table (docs/sync-and-link.md), resolved at
// PASTE time, "if it still exists" (copy-and-paste.md).
describe('pasteDecision', () => {
  const sl = (id: string, ids: string[]) =>
    ({ id, layout: 'default', notes: '', elements: ids.map((e) => ({ id: e, type: 'text' })) }) as unknown as Slide;
  const deck = [sl('a', ['X']), sl('b', ['X', 'Y']), sl('c', [])];
  it('joins when the source is synced now and absent from the target', () =>
    expect(pasteDecision('X', 2, deck, true, false)).toBe('join'));
  it('links when the source exists but is not synced', () =>
    expect(pasteDecision('Y', 2, deck, true, false)).toBe('link'));
  it('is independent when the target slide already shows the element', () =>
    expect(pasteDecision('X', 1, deck, true, false)).toBe('independent'));
  it('is independent when the source is gone', () =>
    expect(pasteDecision('Z', 2, deck, true, false)).toBe('independent'));
  it('is independent from another deck even if the id exists here', () =>
    expect(pasteDecision('X', 2, deck, false, false)).toBe('independent'));
  it('is independent on the same slide', () =>
    expect(pasteDecision('X', 0, deck, true, true)).toBe('independent'));
});
