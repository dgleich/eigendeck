// The PRINT layer: the inch-based, screenshot-baked slide HTML that both the
// standalone Print export (printToPdf) and the interactive HTML export embed
// (the latter behind @media print, so a posted .html is viewable AND printable —
// #109). Extracted from printToPdf so there is ONE print-realization path.
//
// This produces the per-slide `<div class="slide">` strings via buildPrintSlideHtml
// (render-path #6). The async prep it owns: gather each live element's screenshot
// (cached preview, or a live flip-through capture when liveCapture is set — the
// GUI can, the headless CLI can't), build the image data-URL cache, and pre-render
// math to inline SVG. Fonts + the document wrapper stay with each caller.

import type { Presentation, SlideElement, Slide } from '../types/presentation';
import { usePresentationStore } from '../store/presentation';
import { buildPrintSlideHtml } from './printSlideHtml';
import { previewKey, loadPreviewDataUrl, isPreviewThemeStale } from './previewCache';
import { resolveTheme, previewThemeSalt } from './themes';
import { bytesToBase64 } from './base64';
import { fontForPreset } from './fonts';
import { renderMathInHtml, containsMath } from './mathjaxRenderer';

/** Element types baked to a static screenshot for print (can't be live on paper). */
export const isLivePrintElement = (t: string): boolean =>
  t === 'demo' || t === 'demo-piece' || t === 'video' || t === 'notebook';

export interface PreparePrintLayerOpts {
  /** GUI: flip through slides to capture live elements with no cached preview.
   *  Headless CLI: false — use only cached previews (no editor to flip). */
  liveCapture?: boolean;
  /** Pre-render math for one element's html. Defaults to the live iframe-pool
   *  renderer; the CLI passes its cache-only renderer. */
  renderMath?: (html: string, bundleId: string, preamble: string) => Promise<string>;
  /** Called (and awaited) when at least one uncached live element needs a
   *  flip-through capture — the caller can warn about the brief slide flicker
   *  before it happens. */
  onNeedsLiveCapture?: () => void | Promise<void>;
}

/** Gather slideId:elementId → screenshot data-URL for every live element:
 *  cached previews first, then (if liveCapture) a flip-through capture of the misses. */
async function gatherScreenshots(
  presentation: Presentation, liveCapture: boolean, onNeedsLiveCapture?: () => void,
): Promise<Map<string, string>> {
  const shots = new Map<string, string>();
  const hasLive = presentation.slides.some((s) => s.elements.some((e) => isLivePrintElement(e.type)));
  if (!hasLive) return shots;
  for (const slide of presentation.slides) {
    for (const el of slide.elements) {
      if (!isLivePrintElement(el.type)) continue;
      // A notebook's cached preview goes theme-stale for OTHER slides on a theme
      // switch — skip a stale one so it re-captures live below (#140).
      if (el.type === 'notebook') {
        const salt = previewThemeSalt(resolveTheme(presentation.theme, slide.theme));
        if (await isPreviewThemeStale(previewKey(el), salt)) continue;
      }
      const cached = await loadPreviewDataUrl(previewKey(el));
      if (cached) shots.set(`${slide.id}:${el.id}`, cached);
    }
  }
  const needsLive = presentation.slides.some((s) =>
    s.elements.some((e) => isLivePrintElement(e.type) && !shots.has(`${s.id}:${e.id}`)));
  if (!needsLive) return shots;
  await onNeedsLiveCapture?.();
  if (!liveCapture) return shots; // CLI: leave the misses to placeholder rendering

  const { domToDataUrl } = await import('modern-screenshot');
  const store = usePresentationStore.getState();
  const originalSlideIndex = store.currentSlideIndex;
  usePresentationStore.getState().selectObject({ type: 'slide' });
  document.body.classList.add('pdf-capturing');
  try {
    for (let i = 0; i < presentation.slides.length; i++) {
      const slide = presentation.slides[i];
      const demoEls = slide.elements.filter((e) => isLivePrintElement(e.type) && !shots.has(`${slide.id}:${e.id}`));
      if (demoEls.length === 0) continue;
      usePresentationStore.getState().selectSlide(i);
      await new Promise((r) => setTimeout(r, 500)); // let demos render
      for (const el of demoEls) {
        const domEl = document.querySelector(`[data-element-id="${el.id}"]`) as HTMLElement | null;
        if (!domEl) continue;
        try {
          shots.set(`${slide.id}:${el.id}`,
            await domToDataUrl(domEl, { width: el.position.width, height: el.position.height, scale: 1 }));
        } catch (e) { console.warn(`Failed to capture live element ${el.id}:`, e); }
      }
    }
  } finally {
    document.body.classList.remove('pdf-capturing');
    usePresentationStore.getState().selectSlide(originalSlideIndex);
  }
  return shots;
}

/** Image assetId → data-URL (pdf-kind uses the pdfium-rasterized cache PNG). */
async function gatherImageCache(presentation: Presentation): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  const { invoke } = await import('@tauri-apps/api/core');
  for (const slide of presentation.slides) {
    for (const el of slide.elements) {
      if (el.type !== 'image' || cache.has(el.assetId)) continue;
      try {
        if (el.kind === 'pdf') {
          const { renderAsset } = await import('./assetRenderer');
          const { ASSET_TIER } = await import('./assetCache');
          await renderAsset({ assetId: el.assetId, kind: 'pdf', variant: el.snapshotVariant ?? '_', maxWidth: ASSET_TIER.full, maxHeight: ASSET_TIER.full });
          const buf = await invoke<ArrayBuffer>('db_get_asset_cache_bytes', { sourceId: el.assetId, variant: el.snapshotVariant ?? '_', width: ASSET_TIER.full, height: ASSET_TIER.full });
          const cbytes = new Uint8Array(buf);
          if (cbytes.length) cache.set(el.assetId, `data:image/png;base64,${bytesToBase64(cbytes)}`);
          continue;
        }
        const meta = await invoke<{ mime_type: string | null; path: string | null } | null>('db_get_asset_meta_by_id', { assetId: el.assetId });
        const data = await invoke<ArrayBuffer>('db_get_asset_by_id', { assetId: el.assetId });
        const bytes = new Uint8Array(data);
        const ext = (meta?.path ?? '').split('.').pop()?.toLowerCase() || 'png';
        const mime = meta?.mime_type ?? (ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`);
        cache.set(el.assetId, `data:${mime};base64,${bytesToBase64(bytes)}`);
      } catch { /* skip */ }
    }
  }
  return cache;
}

/**
 * Build the print layer: the per-slide inch-based `<div class="slide">` strings.
 * Deterministic given its async inputs; the caller owns fonts + the document
 * wrapper (see printPageCss in printSlideHtml.ts for the matching @page CSS).
 */
export async function preparePrintLayer(
  presentation: Presentation, opts: PreparePrintLayerOpts = {},
): Promise<{ slideHtmls: string[] }> {
  const renderMath = opts.renderMath ?? renderMathInHtml;
  const demoScreenshots = await gatherScreenshots(presentation, !!opts.liveCapture, opts.onNeedsLiveCapture);
  const imageCache = await gatherImageCache(presentation);

  // Pre-render math per text element to inline SVG (the print path emits plain
  // HTML, not the live render). Key by slideId:elementId — a shared element can
  // appear on multiple slides with a different preset font.
  const mathHtmlByKey = new Map<string, string>();
  for (const slide of presentation.slides) {
    for (const el of slide.elements as SlideElement[]) {
      if (el.type === 'text' && el.html && containsMath(el.html)) {
        const bundleId = fontForPreset(el.preset, slide as Slide, presentation.config).id;
        const rendered = await renderMath(el.html, bundleId, presentation.config.mathPreamble || '').catch(() => el.html as string);
        mathHtmlByKey.set(`${slide.id}:${el.id}`, rendered);
      }
    }
  }

  const slideHtmls = presentation.slides.map((slide, i) =>
    buildPrintSlideHtml(slide, presentation, imageCache, demoScreenshots, mathHtmlByKey, i + 1));
  return { slideHtmls };
}
