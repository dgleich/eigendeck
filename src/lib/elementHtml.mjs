// Export HTML builders for the simple element types (cover / arrow / image),
// shared by the HTML export (exportCore.mjs, px units) and the PDF export
// (printSlideHtml.ts, inches/points). Like textElementHtml.mjs, the box position
// is unit-parameterized via `len` so the two exports can't drift on geometry or
// visual styling. (Text has its own richer builder in textElementHtml.mjs.)

import { describeCover, describeArrow, imageVisuals } from './elementDescriptor.mjs';
import { arrowSvgInner } from './arrowGeometry.mjs';

/** cover — a reveal mask filled with the slide background (explicit color wins). */
export function coverHtml(el, resolvedSlideBg, len, theme) {
  const d = describeCover(el, resolvedSlideBg, theme);
  const b = d.box;
  return `<div style="position:absolute;left:${len(b.x)};top:${len(b.y)};width:${len(b.width)};height:${len(b.height)};background:${d.background};"></div>`;
}

/** arrow — inset line + head triangle(s) as an absolute 100% SVG overlay.
 *  `opts.viewBox` is set by inch-scaled targets (the PDF export) so the px arrow
 *  coordinates map into the inch container; px targets (HTML export) omit it.
 *  pointer-events:none so the overlay never blocks the elements beneath it. */
export function arrowSvgHtml(el, opts = {}) {
  const a = describeArrow(el, opts.theme);
  const vb = opts.viewBox ? `viewBox="${opts.viewBox}" ` : '';
  return `<svg ${vb}style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;">${arrowSvgInner(a.geo, a.color, a.strokeWidth, a.opacity)}</svg>`;
}

/** image — a positioned <img> with the shared visual styles (drop-shadow / corner
 *  radius / opacity / rotation from imageVisuals — IDENTICAL across targets). The
 *  `src` is already resolved (data URL / cached PNG); `len` formats the box. */
export function imageHtml(src, el, len, extraAttrs = '') {
  const p = el.position;
  const iv = imageVisuals(el);
  const styles = [
    `position:absolute`, `left:${len(p.x)}`, `top:${len(p.y)}`,
    `width:${len(p.width)}`, `height:${len(p.height)}`, `object-fit:contain`,
  ];
  if (iv.shadow) styles.push(`filter:${iv.shadow}`);
  if (iv.borderRadius) styles.push(`border-radius:${iv.borderRadius}px`);
  if (iv.opacity != null) styles.push(`opacity:${iv.opacity}`);
  if (iv.transform) styles.push(`transform:${iv.transform}`);
  // `src` may be omitted for the single-store export path: the image is emitted as
  // a `data-asset-id` placeholder (via extraAttrs) and painted by the in-body
  // loader from the embedded #eigendeck-deck block, so its bytes aren't inlined twice.
  const srcAttr = src ? ` src="${src}"` : '';
  const extra = extraAttrs ? ` ${extraAttrs}` : '';
  return `<img${srcAttr}${extra} style="${styles.join(';')};" />`;
}
