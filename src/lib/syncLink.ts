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

/** Grey S badge: resync is possible only while the remembered element is shown on
 *  ANOTHER slide and not already on this one (DESIGN_DECISIONS.md, "Sync badge
 *  visibility"). Computed from the slides; deletes never rewrite _syncId, so an
 *  undone deletion brings the badge back. */
export function canResync(slides: Slide[], slideIndex: number, el: Pick<SlideElement, '_syncId'>): boolean {
  const row = el._syncId;
  if (!row) return false;
  if (slides[slideIndex]?.elements.some((e) => e.id === row)) return false;
  return slides.some((s, i) => i !== slideIndex && s.elements.some((e) => e.id === row));
}

/** Grey A badge: relink is possible only while another slide still carries the
 *  remembered link. */
export function canRelink(slides: Slide[], slideIndex: number, el: Pick<SlideElement, '_linkId'>): boolean {
  const l = el._linkId;
  if (!l) return false;
  return slides.some((s, i) => i !== slideIndex && s.elements.some((e) => e.linkId === l));
}

/** A live link has a partner: a DIFFERENT element on another slide with the same
 *  link (a synced copy of the same element is not a partner). */
export function hasLinkPartner(slides: Slide[], slideIndex: number, el: Pick<SlideElement, 'id' | 'linkId'>): boolean {
  const l = el.linkId;
  if (!l) return false;
  return slides.some((s, i) => i !== slideIndex && s.elements.some((e) => e.linkId === l && e.id !== el.id));
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
