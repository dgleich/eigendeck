import { describe, it, expect } from 'vitest';
import {
  IDENTITY_KEYS, freeDelta, resyncDelta, unlinkDelta, relinkDelta,
  detachDelta, linkPairDeltas,
} from './syncLink';

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

describe('linkPairDeltas (#30 symmetry)', () => {
  it('mints fresh shared ids for two independent elements and clears both groups', () => {
    const { sharedLinkId, sharedSyncId, delta } = linkPairDeltas({}, () => 'NEW');
    expect(sharedLinkId).toBe('NEW');
    expect(sharedSyncId).toBe('NEW');               // syncId falls back to the link id
    // The delta is symmetric — applied to BOTH source and target, it sets the
    // shared ids and clears the remembered group on each (the #30 fix).
    expect(delta).toEqual({
      linkId: 'NEW', syncId: 'NEW', _linkId: undefined, _syncId: undefined,
    });
  });

  it("joins the target's existing group when it has one", () => {
    const { sharedLinkId, sharedSyncId } = linkPairDeltas(
      { linkId: 'TL', syncId: 'TS' }, () => 'unused');
    expect(sharedLinkId).toBe('TL');
    expect(sharedSyncId).toBe('TS');
  });

  it("revives the target's remembered group rather than minting a new one", () => {
    const { sharedLinkId, sharedSyncId } = linkPairDeltas(
      { _linkId: 'OLDL', _syncId: 'OLDS' }, () => 'unused');
    expect(sharedLinkId).toBe('OLDL');
    expect(sharedSyncId).toBe('OLDS');
  });
});

describe('IDENTITY_KEYS', () => {
  it('covers exactly the id + sync/link linkage fields', () => {
    expect([...IDENTITY_KEYS].sort()).toEqual(
      ['_linkId', '_syncId', 'id', 'linkId', 'syncId']);
  });
});
