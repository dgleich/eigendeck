// Decide which renderer hook fetches an image element's bytes for
// display, based on its `kind`. Single source of truth shared by
// ImageBox (editor), PresentImage (presenter), and PresenterImage
// (speaker view). DRYing the branch up means the PDF path can grow
// (multi-page picker, snapshotVariant routing) without 3-way drift.

import { useAssetUrl } from './demoAssets';
import { useRenderedAsset } from './assetRenderer';
import { ASSET_TIER } from './assetCache';

/** Snap a display dimension up to the next render tier.
 *
 *  Tier (not exact element dims) so the cache stays sticky during a
 *  resize-handle drag — every animation-frame size would otherwise be
 *  a fresh cache key + fresh pdfium render.
 *
 *  2x for retina sharpness — on an Apple-Silicon display a 1200px
 *  slide-space element is ~2400 actual pixels at 100% editor zoom,
 *  so rendering at slide-space dims means immediate blur. 256px
 *  step granularity keeps typical element sizes from over-shooting
 *  the next tier (PNG encode cost is roughly quadratic). Cap at
 *  slide width — past 1920 we'd be rendering more pixels than the
 *  slide is ever shown at. */
function pdfRenderTier(displayWidth: number, displayHeight: number): number {
  const max = Math.max(displayWidth, displayHeight);
  const stepped = Math.ceil((max * 2) / 256) * 256;
  return Math.min(stepped, ASSET_TIER.full);
}

/**
 * Resolve an image element to a renderable URL. Branching:
 *
 * - `kind === 'pdf'` → goes through useRenderedAsset (pdfium-rasterized
 *   PNG cached in asset_cache). PDFs can't render as `<img src="blob:application/pdf">`
 *   — WebKit doesn't natively rasterize PDF inline.
 * - everything else (raster/svg/undefined) → useAssetUrl returns a raw
 *   blob URL the browser renders natively.
 *
 * `displayWidth/Height` size the PDF render. SVG/raster ignore them
 * (browser scales those for free). Pass element.position.{width,height}.
 */
export function useImageSrc(
  assetId: string,
  kind?: 'raster' | 'svg' | 'pdf',
  opts?: { displayWidth?: number; displayHeight?: number; snapshotVariant?: string },
): string | undefined {
  const isPdf = kind === 'pdf';
  // Always call both hooks (rules-of-hooks) but feed one of them an
  // undefined assetId so it no-ops. The unused branch returns undefined.
  const blobUrl = useAssetUrl(isPdf ? undefined : assetId);
  const tier = isPdf
    ? pdfRenderTier(opts?.displayWidth ?? ASSET_TIER.full, opts?.displayHeight ?? ASSET_TIER.full)
    : ASSET_TIER.full;
  const pdfUrl = useRenderedAsset(
    isPdf ? assetId : undefined,
    isPdf ? 'pdf' : undefined,
    tier, tier,
    opts?.snapshotVariant,
  );
  return isPdf ? pdfUrl : blobUrl;
}
