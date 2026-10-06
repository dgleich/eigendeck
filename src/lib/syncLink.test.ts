import { describe, it, expect } from 'vitest';
import {
  IDENTITY_KEYS, freeDelta, resyncDelta, unlinkDelta, relinkDelta,
  detachDelta, linkPairDeltas, deriveSyncIds, pasteDecision, canResync, canRelink, hasLinkPartner,
} from './syncLink';
import type { Slide } from '../types/presentation';


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

// Badge visibility is computed from the current slides (DESIGN_DECISIONS.md, "Sync
// badge visibility"), never by rewriting the remembered ids on delete.
describe('badge helpers', () => {
  const e = (id: string, extra: Record<string, string> = {}) => ({ id, type: 'text', ...extra });
  const sl = (id: string, els: Record<string, string>[]) => ({ id, layout: 'default', notes: '', elements: els }) as unknown as Slide;

  it('canResync: only while the remembered element is on ANOTHER slide and not on this one', () => {
    const freed = e('F', { _syncId: 'G' });
    expect(canResync([sl('a', [freed]), sl('b', [e('G')])], 0, freed as never)).toBe(true);
    expect(canResync([sl('a', [freed]), sl('b', [])], 0, freed as never)).toBe(false);          // every other copy deleted
    expect(canResync([sl('a', [freed, e('G')]), sl('b', [e('G')])], 0, freed as never)).toBe(false); // already here
    expect(canResync([sl('a', [e('F')])], 0, e('F') as never)).toBe(false);                     // nothing remembered
  });
  it('canRelink: only while another slide still carries the remembered link', () => {
    const un = e('U', { _linkId: 'L' });
    expect(canRelink([sl('a', [un]), sl('b', [e('V', { linkId: 'L' })])], 0, un as never)).toBe(true);
    expect(canRelink([sl('a', [un]), sl('b', [e('V')])], 0, un as never)).toBe(false);
  });
  it('hasLinkPartner: a different element on another slide shares the link', () => {
    const a = e('A', { linkId: 'L' });
    expect(hasLinkPartner([sl('a', [a]), sl('b', [e('B', { linkId: 'L' })])], 0, a as never)).toBe(true);
    // the same element on another slide (a synced copy) is not a partner
    expect(hasLinkPartner([sl('a', [a]), sl('b', [a])], 0, a as never)).toBe(false);
  });
});
