// Decide which renderer hook fetches an image element's bytes for
// display, based on its `kind`. Single source of truth shared by
// ImageBox (editor), PresentImage (presenter), and PresenterImage
// (speaker view). DRYing the branch up means the PDF path can grow
// (multi-page picker, snapshotVariant routing) without 3-way drift.

import { useAssetUrl } from './demoAssets';
import { useRenderedAsset } from './assetRenderer';
import { ASSET_TIER } from './assetCache';

/**
 * Resolve an image element to a renderable URL. Branching:
 *
 * - `kind === 'pdf'` → goes through useRenderedAsset (pdfium-rasterized
 *   PNG cached in asset_cache). PDFs can't render as `<img src="blob:application/pdf">`
 *   — WebKit doesn't natively rasterize PDF inline.
 * - everything else (raster/svg/undefined) → useAssetUrl returns a raw
 *   blob URL the browser renders natively.
 */
export function useImageSrc(
  assetId: string,
  kind?: 'raster' | 'svg' | 'pdf',
  snapshotVariant?: string,
): string | undefined {
  const isPdf = kind === 'pdf';
  // Always call both hooks (rules-of-hooks) but feed one of them an
  // undefined assetId so it no-ops. The unused branch returns undefined.
  const blobUrl = useAssetUrl(isPdf ? undefined : assetId);
  const pdfUrl = useRenderedAsset(
    isPdf ? assetId : undefined,
    isPdf ? 'pdf' : undefined,
    ASSET_TIER.full, ASSET_TIER.full,
    snapshotVariant,
  );
  return isPdf ? pdfUrl : blobUrl;
}
