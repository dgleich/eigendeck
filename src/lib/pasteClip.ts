// Paste an internal Eigendeck clip (decoded from the private clipboard flavor,
// clipboardModel.decodeClipHtml) onto the current slide/deck. Platform-agnostic:
// the caller supplies the clip regardless of where the clipboard HTML came from
// (clipboardData on Linux/Windows, the native pasteboard on macOS).
//
// Elements → objects on the current slide, re-resolving cross-slide link/sync
// (pasteElementDelta + docs/sync-and-link.md). Slide → duplicate.

import { usePresentationStore } from '../store/presentation';
import { pasteElementDelta } from './syncLink';
import { offsetElement } from './offsetElement';
import { runCopyHook } from './elementLifecycle';
import type { EigendeckClip } from './clipboardModel';
import type { SlideElement } from '../types/presentation';

/** Create the cross-slide animation LINK between a freshly-pasted element and its
 *  source (shared linkId), IF the source still exists. Shared by the element
 *  paste (pasteInternalClip) and the asset (image) paste. No-op when the source
 *  slide/element is gone. */
export function linkPastedToSource(pastedId: string, fromSlideId: string | undefined, sourceId: string): void {
  const state = usePresentationStore.getState();
  const srcSlideIdx = state.presentation.slides.findIndex((s) => s.id === fromSlideId);
  if (srcSlideIdx < 0) return;
  if (!state.presentation.slides[srcSlideIdx].elements.some((s) => s.id === sourceId)) return;
  state.linkElements(pastedId, srcSlideIdx, sourceId);
}

export function pasteInternalClip(clip: EigendeckClip): void {
  const state = usePresentationStore.getState();

  if (clip.kind === 'slide') {
    // NOTE: preserves today's behavior (duplicate the current slide). The
    // redesign's "insert the COPIED slide, after the current build" semantics
    // (#165-adjacent) is a later stage; here we only move OFF clipboardRef.
    state.duplicateSlide(state.currentSlideIndex);
    return;
  }

  const els = (clip.elements || []) as SlideElement[];
  if (!els.length) return;

  const targetSlide = state.presentation.slides[state.currentSlideIndex];
  // Same slide if pasting back onto the slide we copied from (by id, so slide
  // reordering doesn't fool it).
  const sameSlide = targetSlide?.id === clip.fromSlideId;

  const newIds: string[] = [];
  const toLink: Array<{ pastedId: string; sourceId: string }> = [];
  for (const el of els) {
    // Same slide → independent copy; cross-slide → join the source's sync group
    // (if synced) else link to the source (animation).
    const { delta, link } = pasteElementDelta(el, sameSlide);
    const newEl = { ...JSON.parse(JSON.stringify(el)), id: crypto.randomUUID(), ...delta } as SlideElement;
    if (sameSlide) offsetElement(newEl, 40, 40);
    state.addElement(newEl);
    newIds.push(newEl.id);
    // Carry type-specific state (e.g. a notebook's recording) to the copy.
    void runCopyHook(el, newEl);
    if (link) toLink.push({ pastedId: newEl.id, sourceId: el.id });
  }
  for (const { pastedId, sourceId } of toLink) {
    linkPastedToSource(pastedId, clip.fromSlideId, sourceId);
  }
  if (newIds.length === 1) state.selectObject({ type: 'element', id: newIds[0] });
  else if (newIds.length > 1) state.selectObject({ type: 'multi', ids: newIds });
}
