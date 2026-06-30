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
import { textBackgroundCss, textBoxShadowCss, textShadowCss } from './textStyle.mjs';
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
export function textElementHtml(el, { color, fontFamily, fontSize, content, len, fsize }) {
  const ps = TEXT_PRESET_STYLES[el.preset] || TEXT_PRESET_STYLES.body;
  const p = el.position;
  const box = textPresetBoxCss(el.preset);

  const valign = el.verticalAlign || (el.preset === 'title' || el.preset === 'footnote' ? 'bottom' : undefined);
  const valignStyle = valign === 'middle' ? 'display:flex;flex-direction:column;justify-content:center;' :
                      valign === 'bottom' ? 'display:flex;flex-direction:column;justify-content:flex-end;' : '';

  const pad = el.padding
    ? `${len(el.padding.top)} ${len(el.padding.right)} ${len(el.padding.bottom)} ${len(el.padding.left)}`
    : `${len(box.padY)} ${len(box.padX)}`;

  const bg = textBackgroundCss(el);
  const sh = textBoxShadowCss(el);
  const fx = textShadowCss(el, color);
  const rot = el.rotation ? `transform:rotate(${el.rotation}deg);` : '';
  const rad = el.borderRadius ? `border-radius:${len(el.borderRadius)};` : '';

  return `<div style="position:absolute;left:${len(p.x)};top:${len(p.y)};width:${len(p.width)};height:${len(p.height)};overflow:hidden;${bg ? `background:${bg};` : ''}${sh ? `box-shadow:${sh};` : ''}${rad}${rot}">` +
    `<div style="width:100%;height:100%;${valignStyle}">` +
    `<div style="font-family:${fontFamily};font-weight:${ps.fontWeight};font-style:${ps.fontStyle};font-size:${fsize(fontSize)};color:${color};line-height:${box.lineHeight};padding:${pad};${fx ? `text-shadow:${fx};` : ''}">${content}</div>` +
    `</div></div>`;
}
