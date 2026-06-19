// Pure planner for the present-mode slide transition. Given the previous and
// current slide, it classifies every CURRENT element with its TRUE z-order and
// transition role, plus the elements that are LEAVING. PresentMode renders
// straight from this plan — one stable list, keyed by element id, in z-order —
// which is what keeps iframes from remounting and z-order correct across the
// transition (see docs/presenter-architecture.md).
//
// No React, no DOM, no store — trivially unit-tested (presentTransition.test.ts).

import type { Slide, SlideElement } from '../types/presentation';

export type PresentRole =
  | 'static'  // cover mask, or an element carried over from the prev slide (same
              // id) — appears instantly, no fade (fading would flicker it).
  | 'fade'    // genuinely new on this slide — fades in.
  | 'linked'; // has a linkId matched on the prev slide — animates position/size
              // from its partner (`from`).

export interface PresentPlanItem {
  element: SlideElement;
  /** True z-order = index in currentSlide.elements. z-index MUST come from here,
   *  never a per-role counter, or stacking is wrong mid-transition (#z-jump). */
  z: number;
  role: PresentRole;
  /** The matched partner on the previous slide (role === 'linked' only). */
  from?: SlideElement;
}

export interface PresentPlan {
  /** Current-slide elements, in z-order. */
  items: PresentPlanItem[];
  /** Elements only on the previous slide (linked, no match here) — fade out. */
  fadeOut: { element: SlideElement; z: number }[];
}

export function planPresentTransition(
  prevSlide: Slide | null,
  currentSlide: Slide,
): PresentPlan {
  const prevByLinkId = new Map<string, SlideElement>();
  const prevIds = new Set<string>();
  if (prevSlide) {
    for (const el of prevSlide.elements) {
      prevIds.add(el.id);
      if (el.linkId) prevByLinkId.set(el.linkId, el);
    }
  }

  const matchedPrevLinkIds = new Set<string>();
  const items: PresentPlanItem[] = currentSlide.elements.map((element, z) => {
    const from = element.linkId ? prevByLinkId.get(element.linkId) : undefined;
    if (from) {
      matchedPrevLinkIds.add(element.linkId!);
      return { element, z, role: 'linked', from };
    }
    // Cover masks are instant; an element carried over from the prev slide (same
    // id — a synced element across build steps) stays put. Both → static.
    if (element.type === 'cover' || prevIds.has(element.id)) {
      return { element, z, role: 'static' };
    }
    return { element, z, role: 'fade' };
  });

  const fadeOut = !prevSlide ? [] : prevSlide.elements
    .map((element, z) => ({ element, z }))
    .filter(({ element }) => element.linkId && !matchedPrevLinkIds.has(element.linkId));

  return { items, fadeOut };
}
