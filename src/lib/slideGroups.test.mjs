import { describe, it, expect } from 'vitest';
import { getSlideNumber, isGroupChild, getGroupIndices } from './slideGroups.mjs';

// A 4-slide deck whose slides 2 & 3 form one build (shared groupId). The editor,
// present view, and both export paths all number this 1, 2, 2, 3 (#187).
const deck = [
  { groupId: undefined },
  { groupId: 'build-a' },
  { groupId: 'build-a' },
  { groupId: undefined },
];

describe('slideGroups', () => {
  it('getSlideNumber: grouped build-slides share one number', () => {
    expect(deck.map((_, i) => getSlideNumber(deck, i))).toEqual([1, 2, 2, 3]);
  });

  it('getSlideNumber: ungrouped deck numbers sequentially', () => {
    const plain = [{}, {}, {}];
    expect(plain.map((_, i) => getSlideNumber(plain, i))).toEqual([1, 2, 3]);
  });

  it('getSlideNumber: two adjacent groups do not merge', () => {
    const d = [{ groupId: 'a' }, { groupId: 'a' }, { groupId: 'b' }, { groupId: 'b' }];
    expect(d.map((_, i) => getSlideNumber(d, i))).toEqual([1, 1, 2, 2]);
  });

  it('isGroupChild: only non-first members of a group are children', () => {
    expect(deck.map((_, i) => isGroupChild(deck, i))).toEqual([false, false, true, false]);
  });

  it('getGroupIndices: returns all indices sharing the group (or self)', () => {
    expect(getGroupIndices(deck, 1)).toEqual([1, 2]);
    expect(getGroupIndices(deck, 2)).toEqual([1, 2]);
    expect(getGroupIndices(deck, 0)).toEqual([0]);
  });
});
