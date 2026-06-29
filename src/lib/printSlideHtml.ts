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
import { markAsEigendeck } from './clipboard';
import { arrowGeometry, arrowSvgInner } from './arrowGeometry.mjs';
import { TEXT_PRESET_STYLES, effectiveFontSize, textShadowCss } from '../types/presentation';
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
 */
export function buildPrintSlideHtml(
  slide: Slide,
  presentation: Presentation,
  imageCache: Map<string, string>,
  demoScreenshots: Map<string, string>,
): string {
  const theme = resolveTheme(presentation.theme, slide.theme);
  let inner = '';
  for (const el of slide.elements) {
    const p = el.position;
    if (el.type === 'text') {
      const ps = TEXT_PRESET_STYLES[el.preset] || TEXT_PRESET_STYLES.body;
      const valign = el.verticalAlign || (el.preset === 'title' || el.preset === 'footnote' ? 'bottom' : undefined);
      const valignStyle = valign === 'middle' ? 'display:flex;flex-direction:column;justify-content:center;' :
                         valign === 'bottom' ? 'display:flex;flex-direction:column;justify-content:flex-end;' : '';
      const color = el.color || themeColorForPreset(theme, el.preset);
      const fontSize = effectiveFontSize(el, presentation.config);
      const presetFontFamily = fontFamilyForPreset(fontForPreset(el.preset, slide, presentation.config), el.preset);
      const _fx2 = textShadowCss(el, color);
      const _rot2 = el.rotation ? `transform:rotate(${el.rotation}deg);` : '';
      inner += `<div style="position:absolute;left:${px2in(p.x)};top:${px2in(p.y)};width:${px2in(p.width)};height:${px2in(p.height)};overflow:hidden;${_rot2}">` +
        `<div style="width:100%;height:100%;${valignStyle}">` +
        `<div style="font-family:${el.fontFamily || presetFontFamily};font-weight:${ps.fontWeight};font-style:${ps.fontStyle};font-size:${px2pt(fontSize)};color:${color};line-height:1.3;padding:${px2in(8)} ${px2in(12)};${_fx2 ? `text-shadow:${_fx2};` : ''}">${markAsEigendeck(el.html || '')}</div>` +
        `</div></div>`;
    } else if (el.type === 'image') {
      const src = imageCache.get(el.assetId);
      if (src) {
        const styles = [`position:absolute`, `left:${px2in(p.x)}`, `top:${px2in(p.y)}`, `width:${px2in(p.width)}`, `height:${px2in(p.height)}`, `object-fit:contain`];
        if ((el as any).shadow) styles.push('filter:drop-shadow(2px 4px 8px rgba(0,0,0,0.3))');
        if ((el as any).borderRadius) styles.push(`border-radius:${px2in((el as any).borderRadius)}`);
        if ((el as any).opacity != null && (el as any).opacity < 1) styles.push(`opacity:${(el as any).opacity}`);
        // P2-7: honor image rotation (was lost in the print path).
        if ((el as any).rotation) styles.push(`transform:rotate(${(el as any).rotation}deg)`);
        inner += `<img src="${src}" style="${styles.join(';')};" />`;
      }
    } else if (el.type === 'arrow') {
      const { x1, y1, x2, y2, color = '#2563eb', strokeWidth = 4, headSize = 16 } = el;
      const geo = arrowGeometry(x1, y1, x2, y2, headSize, el.heads);   // inset line + head triangle(s)
      // SVG uses viewBox in original coordinates, scaled by the container
      inner += `<svg viewBox="0 0 ${W} ${H}" style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;">${arrowSvgInner(geo, color, strokeWidth, el.opacity)}</svg>`;
    } else if (el.type === 'cover') {
      inner += `<div style="position:absolute;left:${px2in(p.x)};top:${px2in(p.y)};width:${px2in(p.width)};height:${px2in(p.height)};background:${el.color || theme.background};"></div>`;
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
  return `<div class="slide" style="background:${theme.background};">${inner}</div>`;
}
