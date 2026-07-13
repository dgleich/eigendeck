// Print/PDF per-slide HTML builder — the element switch lifted out of
// App.tsx's printToPdf so it becomes a PURE, testable seam (render-path #6).
// printToPdf still owns the async I/O (dialogs, invoke, screenshots, font
// embedding); this owns only the deterministic HTML-in-inches string for one
// slide, given the resolved image data-URLs (imageCache) and baked live-element
// screenshots (demoScreenshots).
//
// NOTE: this path deliberately DIVERGES from exportCore.mjs / the React
// renderers — positions/sizes are in INCHES (letter-landscape print), the image
// drop-shadow is smaller (2px/4px/8px vs 4px/8px/16px), border-radius is in
// inches, and the arrow default color is #2563eb (vs #e53e3e elsewhere). Those
// are real print-target specializations; the snapshot gate pins them so they
// can't drift silently before this target is unified onto the descriptor path.

import { resolveTheme, themeColorForPreset } from './themes';
import { coverHtml, arrowSvgHtml, imageHtml } from './elementHtml.mjs';
import { htmlElementScaledIframeHtml, htmlIsScaled, htmlScaleLayout } from './htmlElement.mjs';
import { resolveColor } from './textStyle.mjs';
import { textElementHtml } from './textElementHtml.mjs';
import { markAsEigendeck } from './clipboard';
import { effectiveFontSize } from '../types/presentation';
import { fontForPreset, fontFamilyForPreset } from './fontRegistry.mjs';
import type { Presentation, Slide } from '../types/presentation';

const W = 1920, H = 1080;
const S = 11 / 1920; // inches per pixel (11in-wide letter-landscape slide)
const px2in = (px: number) => (px * S).toFixed(4) + 'in';
const px2pt = (px: number) => (px * S * 72).toFixed(1) + 'pt'; // for font sizes

// "Live" element types baked into the PDF as static screenshots (they can't be
// interactive in print).
const isLiveElement = (t: string) =>
  t === 'demo' || t === 'demo-piece' || t === 'video' || t === 'notebook';

/**
 * One slide as a print `<div class="slide">…</div>`, all positions in inches.
 * @param imageCache       assetId → data-URL for raster/pdf images
 * @param demoScreenshots  `${slide.id}:${el.id}` → data-URL for baked live elements
 * @param mathHtmlByKey    `${slide.id}:${el.id}` → math-rendered text HTML (inline
 *   SVG). The caller pre-renders math (async, via the iframe pool) since this
 *   builder is pure/sync. Keyed by slide+element (not just element id) because one
 *   element can appear on several slides with a different font each; falls back to
 *   el.html for elements with no math.
 */
export function buildPrintSlideHtml(
  slide: Slide,
  presentation: Presentation,
  imageCache: Map<string, string>,
  demoScreenshots: Map<string, string>,
  mathHtmlByKey?: Map<string, string>,
  slideNumber?: number,
): string {
  const theme = resolveTheme(presentation.theme, slide.theme);
  let inner = '';
  for (const el of slide.elements) {
    const p = el.position;
    if (el.type === 'text') {
      // Same shared box/style assembly as the HTML export — only the units differ
      // (inches for lengths via px2in, points for font-size via px2pt).
      const presetFontFamily = fontFamilyForPreset(fontForPreset(el.preset, slide, presentation.config), el.preset);
      inner += textElementHtml(el, {
        color: resolveColor(el.color, theme, themeColorForPreset(theme, el.preset)),
        fontFamily: el.fontFamily || presetFontFamily,
        fontSize: effectiveFontSize(el, presentation.config),
        content: markAsEigendeck(mathHtmlByKey?.get(`${slide.id}:${el.id}`) ?? el.html ?? ''),
        len: px2in,
        fsize: px2pt,
        theme,
      });
    } else if (el.type === 'image') {
      const src = imageCache.get(el.assetId);
      // Same shared visual styles as the HTML export (one drop-shadow + radius);
      // only the box position is inch-scaled (px2in).
      if (src) inner += imageHtml(src, el, px2in);
    } else if (el.type === 'arrow') {
      // viewBox maps the px arrow coords into the inch-scaled container.
      inner += arrowSvgHtml(el, { viewBox: `0 0 ${W} ${H}`, theme });
    } else if (el.type === 'cover') {
      inner += coverHtml(el, theme.background, px2in, theme);
    } else if (el.type === 'html') {
      // Static + locked (no script/network) → the srcdoc iframe renders in the
      // browser's print output directly, no screenshot bake needed.
      //
      // The iframe CONTENT is authored in CSS px (slide-px == CSS-px in the
      // editor). Print positions elements in INCHES with NO slide-level transform,
      // and an iframe's document always renders at 96 CSS-px/in regardless of the
      // parent — so a slide-px is only S*96 CSS-px here. Without compensating, the
      // content renders ~1/(S*96) ≈ 1.8× too big for its shrunken box. So ALWAYS
      // size the iframe in CSS px (its design size) and scale it DOWN to the inch
      // box. (HTML export scales the whole slide via a CSS transform, so its
      // iframes scale for free — this only bites the inch-positioned print path.)
      //   • scaleMode → design = the content's natural size (contain-fit + the shrink);
      //   • otherwise → design = the box itself (content fills it, then shrinks).
      const designW = htmlIsScaled(el) ? el.scaleW! : p.width;
      const designH = htmlIsScaled(el) ? el.scaleH! : p.height;
      const L = htmlScaleLayout(p.width * S * 96, p.height * S * 96, designW, designH);
      const box = `position:absolute;left:${px2in(p.x)};top:${px2in(p.y)};width:${px2in(p.width)};height:${px2in(p.height)}`;
      inner += htmlElementScaledIframeHtml(el, box, L, 'px', undefined, theme);
    } else if (isLiveElement(el.type)) {
      // P0-2: notebook joins demo/demo-piece/video as a baked screenshot.
      const screenshot = demoScreenshots.get(`${slide.id}:${el.id}`);
      if (screenshot) {
        inner += `<img src="${screenshot}" style="position:absolute;left:${px2in(p.x)};top:${px2in(p.y)};width:${px2in(p.width)};height:${px2in(p.height)};" />`;
      } else {
        const label = el.type === 'notebook' ? 'Notebook' : el.type === 'video' ? 'Video' : 'Interactive Demo';
        inner += `<div style="position:absolute;left:${px2in(p.x)};top:${px2in(p.y)};width:${px2in(p.width)};height:${px2in(p.height)};background:#f8f8f8;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#999;font-size:${px2pt(24)};font-family:system-ui;">${label}</div>`;
      }
    }
  }
  // Slide footer (author · venue + slide number), mirroring the HTML export.
  const meta = [presentation.config?.author, presentation.config?.venue].filter(Boolean).join(' · ');
  if (meta || slideNumber != null) {
    inner += `<div class="slide-footer" style="position:absolute;bottom:${px2in(20)};right:${px2in(40)};display:flex;align-items:baseline;gap:${px2in(16)};font-family:'PT Sans',sans-serif;color:#888;font-size:${px2pt(18)};">` +
      `<span class="slide-footer-meta">${meta}</span><span class="slide-footer-number" style="font-size:${px2pt(24)};">${slideNumber ?? ''}</span></div>`;
  }
  return `<div class="slide" style="background:${theme.background};">${inner}</div>`;
}
