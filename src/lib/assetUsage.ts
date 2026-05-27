// Pure helpers for "how many elements / slides currently use this asset?"
//
// One place to express the bound-to-asset predicate (assetId first;
// path-label fallback for legacy elements without an assetId binding).
// Used by AssetSection (for the "Used N times across M slides" caption,
// for the Restore confirm wording, and for deciding whether Restore
// needs a confirm at all) and by assetInsert (for the
// findSlidesUsingAsset helper). Pure functions for easy unit testing.

import type { Presentation, Slide } from '../types/presentation';
import { getSlideNumber } from '../types/presentation';

type AssetBearingElement = { assetId?: string; src?: string; demoSrc?: string };

function isAssetBearing(elType: string): boolean {
  return elType === 'image' || elType === 'demo' || elType === 'demo-piece';
}

/** True if the element is currently bound to (assetId, path). Prefers
 *  the asset_id link when both sides have one; falls back to src /
 *  demoSrc path-label match for legacy elements. */
function elementBoundToAsset(
  el: { type: string } & AssetBearingElement,
  assetId: string,
  path: string | null,
): boolean {
  if (!isAssetBearing(el.type)) return false;
  if (el.assetId) return el.assetId === assetId;
  const elPath = el.demoSrc ?? el.src;
  return elPath != null && elPath === path;
}

export interface AssetUsage {
  /** Total number of elements bound to the asset. The actual blast
   *  radius of asset-scoped actions (e.g. Restore). */
  elementCount: number;
  /** Number of distinct slides containing at least one bound element. */
  slideCount: number;
  /** 1-based slide numbers (per getSlideNumber) of bound slides,
   *  ascending. Useful when callers want to name specific slides
   *  (e.g. the collision dialog). */
  slideNumbers: number[];
}

/** Walk every current element and tally bindings to the given asset.
 *  See AssetUsage for the three returned counts. */
export function computeAssetUsage(
  presentation: Presentation | null | undefined,
  assetId: string,
  path: string | null,
): AssetUsage {
  if (!presentation) return { elementCount: 0, slideCount: 0, slideNumbers: [] };
  let elementCount = 0;
  const slideNumbers: number[] = [];
  presentation.slides.forEach((slide: Slide, idx: number) => {
    let slideHit = false;
    for (const el of slide.elements) {
      if (elementBoundToAsset(el as { type: string } & AssetBearingElement, assetId, path)) {
        elementCount++;
        slideHit = true;
      }
    }
    if (slideHit) slideNumbers.push(getSlideNumber(presentation.slides, idx));
  });
  return { elementCount, slideCount: slideNumbers.length, slideNumbers };
}
