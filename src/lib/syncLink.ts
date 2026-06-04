// Pure delta helpers for the two element relationships:
//   - sync  (syncId)  — "the same element shown on several slides"
//   - link  (linkId)  — "animate between two elements across slides"
// plus the remembered-group fields (_syncId/_linkId) used to re-join after a
// temporary free/unlink.
//
// These return a Partial<SlideElement> describing ONLY the four
// sync/link/identity fields. They are the single source of truth for the
// remember/restore dance, replacing ~10 hand-built `{ syncId, _syncId, ... }`
// literals scattered across components (which had diverged — see the
// link-asymmetry bug #30 and the PropertiesPanel "Unlink" that forgot to
// remember _linkId). No store, no side effects: trivially unit-testable.

import type { SlideElement } from '../types/presentation';

export type SyncLinkDelta = Partial<
  Pick<SlideElement, 'syncId' | '_syncId' | 'linkId' | '_linkId'>
>;

/** Identity / linkage keys that must NEVER propagate from one synced instance
 *  to its peers (each instance keeps its own ids; only data syncs). Consumed
 *  by the store's sync-propagation strip. */
export const IDENTITY_KEYS = ['id', 'syncId', '_syncId', 'linkId', '_linkId'] as const;

/** Free a synced element: drop its syncId but remember it so the element can
 *  re-sync later. `{}` (no change) when it isn't synced. */
export function freeDelta(el: Pick<SlideElement, 'syncId'>): SyncLinkDelta {
  return el.syncId ? { syncId: undefined, _syncId: el.syncId } : {};
}

/** Re-sync a freed element: restore the remembered syncId. `{}` when there's
 *  nothing remembered. */
export function resyncDelta(el: Pick<SlideElement, '_syncId'>): SyncLinkDelta {
  return el._syncId ? { syncId: el._syncId, _syncId: undefined } : {};
}

/** Unlink an animated element: drop its linkId but remember it for re-linking.
 *  Always remembers (the old PropertiesPanel "Unlink" forgot, stranding the
 *  element with no way back). `{}` when it isn't linked. */
export function unlinkDelta(el: Pick<SlideElement, 'linkId'>): SyncLinkDelta {
  return el.linkId ? { linkId: undefined, _linkId: el.linkId } : {};
}

/** Re-link a previously-unlinked element: restore the remembered linkId. */
export function relinkDelta(el: Pick<SlideElement, '_linkId'>): SyncLinkDelta {
  return el._linkId ? { linkId: el._linkId, _linkId: undefined } : {};
}

/** Fully detach a copy from all groups — live AND remembered — so it stands
 *  alone (Cmd+D duplicate / paste). */
export function detachDelta(): SyncLinkDelta {
  return { syncId: undefined, _syncId: undefined, linkId: undefined, _linkId: undefined };
}

/** Shared ids + the symmetric per-side delta for linking a source element to a
 *  target on another slide. BOTH sides get the same delta — the shared ids and
 *  a cleared remembered-group — which is the structural fix for #30 (the old
 *  LinkOverlay cleared _syncId/_linkId on the source only). The shared ids
 *  prefer the target's existing group so re-linking rejoins it. */
export function linkPairDeltas(
  target: Pick<SlideElement, 'syncId' | '_syncId' | 'linkId' | '_linkId'>,
  newId: () => string = () => crypto.randomUUID(),
): { sharedLinkId: string; sharedSyncId: string; delta: SyncLinkDelta } {
  const sharedLinkId = target.linkId || target._linkId || newId();
  const sharedSyncId = target.syncId || target._syncId || sharedLinkId;
  return {
    sharedLinkId,
    sharedSyncId,
    delta: { linkId: sharedLinkId, syncId: sharedSyncId, _linkId: undefined, _syncId: undefined },
  };
}
