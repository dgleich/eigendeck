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

/** Decide how a pasted copy of `el` joins (or doesn't join) a group, by where
 *  it lands:
 *   - SAME slide  → independent copy (detached); you can't animate within a slide.
 *   - DIFFERENT slide, source is SYNCED → JOIN the sync group: keep its
 *     syncId/linkId, drop only the remembered (_*) ids.
 *   - DIFFERENT slide, source NOT synced → detached now, then LINK to the source
 *     (the caller does the actual cross-element link); `link` flags that.
 *  Returns the sync/link delta to merge onto the new element + whether to link. */
export function pasteElementDelta(
  el: Pick<SlideElement, 'syncId'>, sameSlide: boolean,
): { delta: SyncLinkDelta; link: boolean } {
  if (!sameSlide && el.syncId) {
    return { delta: { _syncId: undefined, _linkId: undefined }, link: false };
  }
  return { delta: detachDelta(), link: !sameSlide };
}

/** Shared linkId + the symmetric per-side delta for an ANIMATION link between a
 *  source element and a target on another slide. Link-only and NON-destructive:
 *  it sets a shared linkId (and clears _linkId) on BOTH sides and does NOT touch
 *  syncId — the elements stay SEPARATE (own position, content, recording) so the
 *  presenter animates between them. Sync (collapsing two elements into one
 *  entry) is a different, destructive operation that only the junction model
 *  (duplicate) produces cleanly; "L" must never auto-sync.
 *
 *  The shared linkId prefers the SOURCE's existing/remembered group, then the
 *  target's. This is what makes a link directional+groupable: repeatedly linking
 *  FROM one anchor element to several slides builds ONE group (each new target
 *  joins the anchor's linkId) instead of minting a fresh id that strands the
 *  anchor's earlier partner (#S9). `mergeIds` lists the OTHER live group ids
 *  pulled in (so the caller migrates every member). (#30: both sides cleared
 *  symmetrically.) */
export function linkPairDeltas(
  source: Pick<SlideElement, 'linkId' | '_linkId'>,
  target: Pick<SlideElement, 'linkId' | '_linkId'>,
  newId: () => string = () => crypto.randomUUID(),
): { sharedLinkId: string; delta: SyncLinkDelta; mergeIds: string[] } {
  const sharedLinkId = source.linkId || source._linkId || target.linkId || target._linkId || newId();
  // Distinct live/remembered group ids being merged INTO sharedLinkId — every
  // element carrying one must be re-pointed so no prior partner is stranded.
  const mergeIds = [...new Set(
    [source.linkId, source._linkId, target.linkId, target._linkId]
      .filter((id): id is string => !!id && id !== sharedLinkId),
  )];
  return { sharedLinkId, delta: { linkId: sharedLinkId, _linkId: undefined }, mergeIds };
}
