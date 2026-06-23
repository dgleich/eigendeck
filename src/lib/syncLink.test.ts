import { describe, it, expect } from 'vitest';
import {
  IDENTITY_KEYS, freeDelta, resyncDelta, unlinkDelta, relinkDelta,
  detachDelta, linkPairDeltas, pasteElementDelta, pruneOrphanedGroups,
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

describe('pasteElementDelta (copy/paste join rules)', () => {
  it('same slide → independent copy (fully detached, no link)', () => {
    const r = pasteElementDelta({ syncId: 'g' }, true);
    expect(r.link).toBe(false);
    expect(r.delta).toEqual(detachDelta());   // even a synced source detaches on same-slide paste
  });

  it('different slide + synced source → JOIN the sync group (keep syncId, drop _ids)', () => {
    const r = pasteElementDelta({ syncId: 'g' }, false);
    expect(r.link).toBe(false);
    expect(r.delta).toEqual({ _syncId: undefined, _linkId: undefined });
    expect('syncId' in r.delta).toBe(false);   // syncId left intact on the copy → joins the group
  });

  it('different slide + un-synced source → detach now, LINK to source', () => {
    const r = pasteElementDelta({ syncId: undefined }, false);
    expect(r.link).toBe(true);
    expect(r.delta).toEqual(detachDelta());
  });
});

describe('IDENTITY_KEYS', () => {
  it('covers exactly the id + sync/link linkage fields', () => {
    expect([...IDENTITY_KEYS].sort()).toEqual(
      ['_linkId', '_syncId', 'id', 'linkId', 'syncId']);
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
