// Decide which renderer hook fetches an image element's bytes for
// display, based on its `kind`. Single source of truth shared by
// ImageBox (editor), PresentImage (presenter), and PresenterImage
// (speaker view). DRYing the branch up means the PDF path can grow
// (multi-page picker, snapshotVariant routing) without 3-way drift.

import { useAssetUrl } from './demoAssets';
import { useRenderedAsset } from './assetRenderer';
import { ASSET_TIER } from './assetCache';

/** Snap a display dimension up to the next power-of-2-ish render tier.
 *  Tier (not exact element dims) so the cache stays sticky during a
 *  resize-handle drag — every animation-frame size would otherwise be
 *  a fresh cache key + fresh pdfium render. */
function pdfRenderTier(displayWidth: number, displayHeight: number): number {
  const max = Math.max(displayWidth, displayHeight);
  // Tiers chosen to cover typical slide-element sizes: small inset (256),
  // quarter-slide (512), half-slide (1024), near-full (1920). PNG encode
  // cost is roughly quadratic in tier so picking the smallest tier that
  // covers display dims is a real perf win.
  if (max <= 256) return 256;
  if (max <= 512) return 512;
  if (max <= 1024) return 1024;
  return ASSET_TIER.full;
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
