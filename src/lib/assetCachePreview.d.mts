export interface CacheVariant {
  variant: string;
  width: number;
  height: number;
}

export interface PreviewLookupKey {
  sourceId: string;
  variant: string;
}

export interface PreviewableElement {
  type: string;
  kind?: string;
  assetId?: string;
  snapshotVariant?: string;
  syncId?: string;
  id?: string;
}

export function pngBytesToDataUrl(bytes: Uint8Array): string;
export function previewLookupKey(el: PreviewableElement): PreviewLookupKey | null;
export function pickLargestVariant(
  variants: CacheVariant[] | null | undefined,
  variant: string,
): CacheVariant | null;
