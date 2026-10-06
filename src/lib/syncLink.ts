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

import type { Slide, SlideElement } from '../types/presentation';

export type SyncLinkDelta = Partial<
  Pick<SlideElement, 'syncId' | '_syncId' | 'linkId' | '_linkId'>
>;

/** The keys of an element that are not its data. Copies of one synced element are
 *  the SAME element (one row; docs/sync-and-link.md, "SQLite is the source of
 *  truth"), so only its id and the derived syncId are identity; linkId and the
 *  remembered _syncId/_linkId belong to the element and are shared by every copy. */
export const IDENTITY_KEYS = ['id', 'syncId'] as const;

/** Rule 3 of the addendum: an element is synced exactly when its id appears on more
 *  than one slide. Sets syncId = id for those and clears it for the rest. Returns
 *  the SAME array, slide and element objects when nothing changes, so callers can
 *  compare by reference. */
export function deriveSyncIds(slides: Slide[]): Slide[] {
  const count = new Map<string, number>();
  for (const s of slides) for (const el of s.elements) count.set(el.id, (count.get(el.id) ?? 0) + 1);
  let changed = false;
  const next = slides.map((s) => {
    let slideChanged = false;
    const elements = s.elements.map((el) => {
      const want = (count.get(el.id) ?? 0) > 1 ? el.id : undefined;
      if (el.syncId === want) return el;
      slideChanged = true;
      const copy = { ...el } as SlideElement;
      if (want) copy.syncId = want;
      else delete copy.syncId;
      return copy;
    });
    if (!slideChanged) return s;
    changed = true;
    return { ...s, elements };
  });
  return changed ? next : slides;
}

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

/** After elements are removed (a slide or element is deleted), a sync or link
 *  group can be left with a SINGLE member — there's nothing to sync or animate
 *  with anymore. That lone id is an orphan: it still lights the "synced" border
 *  and the inspector's sync UI even though the element is effectively standalone
 *  (e.g. duplicate a slide, then delete the copy — the original kept its syncId).
 *
 *  This strips the orphaned id — sync and link independently — from every lone
 *  group across the deck, leaving genuine multi-member groups untouched. A group
 *  is counted by its identity (`syncId ?? _syncId`, `linkId ?? _linkId`) so a
 *  member that's only *remembering* the group still keeps a partner alive — the
 *  SAME membership the sync badge uses, so border + badge stay consistent.
 *
 *  Pure; returns a NEW slides array only when something changed (so the store's
 *  referential-equality checks don't see spurious updates). */
export function pruneOrphanedGroups(slides: Slide[]): Slide[] {
  const syncCount = new Map<string, number>();
  const linkCount = new Map<string, number>();
  for (const s of slides) for (const el of s.elements) {
    const sid = el.syncId ?? el._syncId;
    if (sid) syncCount.set(sid, (syncCount.get(sid) ?? 0) + 1);
    const lid = el.linkId ?? el._linkId;
    if (lid) linkCount.set(lid, (linkCount.get(lid) ?? 0) + 1);
  }
  let changed = false;
  const next = slides.map((s) => {
    let slideChanged = false;
    const elements = s.elements.map((el) => {
      const sid = el.syncId ?? el._syncId;
      const lid = el.linkId ?? el._linkId;
      const dropSync = sid != null && syncCount.get(sid) === 1;
      const dropLink = lid != null && linkCount.get(lid) === 1;
      if (!dropSync && !dropLink) return el;
      slideChanged = true;
      const copy: SlideElement = { ...el };
      if (dropSync) { delete copy.syncId; delete copy._syncId; }
      if (dropLink) { delete copy.linkId; delete copy._linkId; }
      return copy;
    });
    if (slideChanged) { changed = true; return { ...s, elements }; }
    return s;
  });
  return changed ? next : slides;
}

/** How a pasted copy of element `sourceId` lands on slide `targetSlideIndex`
 *  (docs/sync-and-link.md join table; copy-and-paste.md resolves references at
 *  PASTE time, "if it still exists"):
 *   - same slide, or from another deck → an independent copy;
 *   - the target slide already shows the element → an independent copy (one
 *     element appears at most once per slide);
 *   - the source is synced now (on more than one slide) → JOIN: the same element;
 *   - the source exists but is not synced → LINK to it (animation);
 *   - the source is gone → an independent copy. */
export function pasteDecision(
  sourceId: string, targetSlideIndex: number, slides: Slide[], sameDeck: boolean, sameSlide: boolean,
): 'join' | 'link' | 'independent' {
  if (sameSlide || !sameDeck) return 'independent';
  if (slides[targetSlideIndex]?.elements.some((e) => e.id === sourceId)) return 'independent';
  const onSlides = slides.filter((s) => s.elements.some((e) => e.id === sourceId)).length;
  if (onSlides > 1) return 'join';
  if (onSlides === 1) return 'link';
  return 'independent';
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
