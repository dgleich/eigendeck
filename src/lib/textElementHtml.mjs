// The positioned HTML for ONE text element — the 3-div structure (outer box →
// vertical-align wrapper → styled content) shared by the HTML export (exportCore,
// px units) and the PDF export (printSlideHtml, inches/points). The ONLY
// difference between those two was the unit, so units are injected as formatters
// (`len`: px→CSS length, `fsize`: px→CSS font-size) and everything else — which
// styles, their order, footnote-tight line-height, padding overrides, fill /
// box-shadow / border-radius / rotation, font weight/style — lives here once so
// the two exports can't drift.
//
// The caller pre-computes the parts that genuinely differ per target and passes
// them in: the resolved `color` and `fontFamily`, the px `fontSize`, and the
// inner `content` HTML (the HTML export math-renders + code-fonts it; the PDF
// export marks it as eigendeck-origin — neither concern belongs here).

import { textPresetBoxCss } from './textBox.mjs';
import { textBackgroundResolved, textBoxShadowCss, textShadowCss } from './textStyle.mjs';
import { TEXT_PRESET_STYLES } from './textPresets.mjs';

/**
 * @param el  text element ({ preset, position, verticalAlign?, padding?,
 *            borderRadius?, rotation?, backgroundColor?, backgroundOpacity?,
 *            boxShadow?, textEffect? })
 * @param o.color       resolved text color
 * @param o.fontFamily  resolved font family
 * @param o.fontSize    px font size (already resolved via effectiveFontSize)
 * @param o.content     inner HTML (already math-rendered / code-fonted / marked)
 * @param o.len    (px:number) => string  length formatter, e.g. n=>`${n}px` or px2in
 * @param o.fsize  (px:number) => string  font-size formatter, e.g. n=>`${n}px` or px2pt
 */
export function textElementHtml(el, { color, fontFamily, fontSize, content, len, fsize, theme }) {
  const ps = TEXT_PRESET_STYLES[el.preset] || TEXT_PRESET_STYLES.body;
  const p = el.position;
  const box = textPresetBoxCss(el.preset);

  const valign = el.verticalAlign || (el.preset === 'title' || el.preset === 'footnote' ? 'bottom' : undefined);
  const valignStyle = valign === 'middle' ? 'display:flex;flex-direction:column;justify-content:center;' :
                      valign === 'bottom' ? 'display:flex;flex-direction:column;justify-content:flex-end;' : '';

  // Escape every dynamic value spliced into the style/attribute strings — neutralize
  // " < > & so a crafted property (padding/rotation/borderRadius/color/fontFamily/
  // geometry, or a size from an unvalidated config.textSizes) can't break out of the
  // quoted attribute and inject markup. This builder feeds BOTH the HTML export (a
  // possibly-hosted artifact) and the PDF path (audit C-2). `content` is the already-
  // sanitized inner HTML and is intentionally NOT escaped. Legit values have none of
  // these chars, so output is byte-identical (WYSIWYG). Mirrors escAttr in TextElementSvg.
  const e = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const pad = el.padding
    ? `${e(len(el.padding.top))} ${e(len(el.padding.right))} ${e(len(el.padding.bottom))} ${e(len(el.padding.left))}`
    : `${e(len(box.padY))} ${e(len(box.padX))}`;

  const bg = textBackgroundResolved(el, theme);   // theme-aware (boxTint) fill; falls back to the fixed color
  const sh = textBoxShadowCss(el);
  const fx = textShadowCss(el, color);
  const rot = el.rotation ? `transform:rotate(${e(el.rotation)}deg);` : '';
  const rad = el.borderRadius ? `border-radius:${e(len(el.borderRadius))};` : '';

  return `<div style="position:absolute;left:${e(len(p.x))};top:${e(len(p.y))};width:${e(len(p.width))};height:${e(len(p.height))};overflow:hidden;${bg ? `background:${e(bg)};` : ''}${sh ? `box-shadow:${e(sh)};` : ''}${rad}${rot}">` +
    `<div style="width:100%;height:100%;${valignStyle}">` +
    `<div style="font-family:${e(fontFamily)};font-weight:${e(ps.fontWeight)};font-style:${e(ps.fontStyle)};font-size:${e(fsize(fontSize))};color:${e(color)};line-height:${e(box.lineHeight)};padding:${pad};${fx ? `text-shadow:${e(fx)};` : ''}">${content}</div>` +
    `</div></div>`;
}
