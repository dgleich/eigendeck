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
/** The effective vertical alignment of a text element. `verticalAlign` is a
 *  STORED property now — stamped from the preset at creation (createTextElement)
 *  and back-filled onto older decks on open (ensureStoredValign) — so the render
 *  paths just read it, with a 'top' floor for anything that predates the stamp.
 *  The SINGLE resolver used by every render path (SVG markup, the editor DOM's
 *  data-valign, the #95 overflow detector, the inspector). */
export function elementValign(el) {
  return el.verticalAlign || 'top';
}

/** Back-fill: stamp `verticalAlign` onto text elements that predate stored valign,
 *  from their preset default (TEXT_PRESET_STYLES[preset].valign), so the render
 *  resolver can stay preset-agnostic and old titles keep their 'bottom' alignment.
 *  Mutates the presentation in place; returns the count stamped. Idempotent. */
export function ensureStoredValign(presentation) {
  let n = 0;
  for (const s of presentation?.slides || []) {
    for (const el of s?.elements || []) {
      if (el && el.type === 'text' && el.verticalAlign == null) {
        el.verticalAlign = TEXT_PRESET_STYLES[el.preset]?.valign || 'top';
        n++;
      }
    }
  }
  return n;
}

export function textElementHtml(el, { color, fontFamily, fontSize, content, len, fsize, theme }) {
  const ps = TEXT_PRESET_STYLES[el.preset] || TEXT_PRESET_STYLES.body;
  const p = el.position;
  const box = textPresetBoxCss(el.preset);

  const valign = elementValign(el);
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
