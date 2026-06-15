import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  markAssetMissing, markAssetFound, isAssetMissing,
  getMissingAssets, clearAllMissing, subscribeMissing,
} from './missingAssets';

describe('missingAssets registry (#74)', () => {
  beforeEach(() => clearAllMissing());

  it('marks and reports a missing asset', () => {
    expect(isAssetMissing('a1')).toBe(false);
    markAssetMissing('a1', 'images/foo.svg');
    expect(isAssetMissing('a1')).toBe(true);
    expect(getMissingAssets()).toEqual([{ assetId: 'a1', path: 'images/foo.svg' }]);
  });

  it('markAssetFound clears the flag', () => {
    markAssetMissing('a1', 'p');
    markAssetFound('a1');
    expect(isAssetMissing('a1')).toBe(false);
    expect(getMissingAssets()).toEqual([]);
  });

  it('notifies subscribers on change, with the current set', () => {
    const seen: number[] = [];
    const unsub = subscribeMissing((ids) => seen.push(ids.size));
    // immediate call on subscribe (size 0)
    expect(seen).toEqual([0]);
    markAssetMissing('a1', 'p');
    markAssetMissing('a2', 'q');
    markAssetFound('a1');
    expect(seen).toEqual([0, 1, 2, 1]);
    unsub();
    markAssetMissing('a3', 'r');
    expect(seen).toEqual([0, 1, 2, 1]); // no more after unsub
  });

  it('is idempotent — re-marking the same path does not re-notify', () => {
    const seen: number[] = [];
    subscribeMissing(() => seen.push(1));
    seen.length = 0;
    markAssetMissing('a1', 'p');
    markAssetMissing('a1', 'p'); // same → no notify
    expect(seen.length).toBe(1);
    markAssetFound('a1');
    markAssetFound('a1'); // already gone → no notify
    expect(seen.length).toBe(2);
  });

  it('updates the path label when the same asset goes missing at a new path', () => {
    markAssetMissing('a1', 'old');
    markAssetMissing('a1', 'new');
    expect(getMissingAssets()).toEqual([{ assetId: 'a1', path: 'new' }]);
  });

  it('dispatches window events for loose coupling', () => {
    const onMissing = vi.fn();
    const onFound = vi.fn();
    window.addEventListener('eigendeck:asset-missing', onMissing);
    window.addEventListener('eigendeck:asset-found', onFound);
    markAssetMissing('a1', 'p');
    markAssetFound('a1');
    expect(onMissing).toHaveBeenCalledOnce();
    expect((onMissing.mock.calls[0][0] as CustomEvent).detail).toEqual({ assetId: 'a1', path: 'p' });
    expect(onFound).toHaveBeenCalledOnce();
    window.removeEventListener('eigendeck:asset-missing', onMissing);
    window.removeEventListener('eigendeck:asset-found', onFound);
  });

  it('clearAllMissing empties the registry', () => {
    markAssetMissing('a1', 'p');
    markAssetMissing('a2', 'q');
    clearAllMissing();
    expect(getMissingAssets()).toEqual([]);
  });
});
