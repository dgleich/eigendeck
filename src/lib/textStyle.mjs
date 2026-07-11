// Text visual-style helpers (element fill, legibility effect, box shadow) — the
// SINGLE SOURCE shared by the live render (TextElementSvg / SlideElementRenderer
// via the types/presentation re-export) and the static HTML exports
// (exportCore.mjs CLI + printSlideHtml.ts PDF). Pure `.mjs` so it crosses the
// .mjs/.ts boundary; exportCore previously kept its own copies of all of these.

/** Halo color for the glow effect: dark text → light halo, light → dark. */
function haloFor(color) {
  const hex = (color || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '#ffffff';
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b; // Rec. 601
  return luma < 140 ? '#ffffff' : '#000000';
}

/** Effective text-element background (color + opacity → rgba), or undefined when none. */
export function textBackgroundCss(el) {
  if (!el || !el.backgroundColor) return undefined;
  const a = el.backgroundOpacity ?? 1;
  if (a >= 1) return el.backgroundColor;
  const hex = el.backgroundColor.replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return el.backgroundColor; // non-hex color: opacity not applied
}

/** Mix two #rrggbb colors: result = a*(1-t) + b*t. Falls back to `a` on bad input. */
export function mixHex(a, b, t) {
  const pa = (a || '').replace('#', ''), pb = (b || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(pa) || !/^[0-9a-fA-F]{6}$/.test(pb)) return a;
  const ch = (h, i) => parseInt(h.slice(i, i + 2), 16);
  const m = (i) => Math.round(ch(pa, i) * (1 - t) + ch(pb, i) * t);
  return '#' + [m(0), m(2), m(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Effective text-element background, honoring a themed tint (#132 "card"): when
 *  `el.boxTint` is set, tint the slide theme's background toward the tint base
 *  ('accent' → theme.accent, else the given hex) by ~15% so the fill stays
 *  colored AND contrasting on ANY theme; otherwise the fixed backgroundColor.
 *  `theme` is the resolved ThemeColors ({ background, accent, ... }). */
export function textBackgroundResolved(el, theme) {
  if (el && el.boxTint && theme) {
    const base = el.boxTint === 'accent' ? (theme.accent || '#3b82f6') : el.boxTint;
    return mixHex(theme.background || '#ffffff', base, 0.15);
  }
  return textBackgroundCss(el);
}

/** Text legibility effect (#73): drop shadow or high-contrast glow. */
export function textEffectCss(effect, color) {
  if (effect === 'shadow') return '0 2px 4px rgba(0,0,0,0.45)';
  if (effect === 'glow') {
    const h = haloFor(color);
    return `0 0 3px ${h}, 0 0 6px ${h}, 0 0 10px ${h}`;
  }
  return undefined;
}

/** Text-shadow for the TEXT itself (the Effect control). */
export function textShadowCss(el, color) {
  return textEffectCss(el && el.textEffect, color);
}

/** Box-shadow for the text BOX panel (the boxShadow toggle + a background). */
export function textBoxShadowCss(el) {
  return el && el.boxShadow && (el.backgroundColor || el.boxTint) ? '0 4px 14px rgba(0,0,0,0.28)' : undefined;
}

/** Give `<code>` runs the deck's mono family by splicing font-family into each
 *  code tag's style. No-op when `mono` is empty. Shared by the live render
 *  (TextElementSvg) and the HTML export (exportCore). */
export function applyCodeFont(html, mono) {
  if (!mono || !html) return html || '';
  return html.replace(/<code\b([^>]*)>/gi, (_m, attrs) =>
    /\bstyle\s*=/.test(attrs)
      ? `<code${attrs.replace(/style\s*=\s*"([^"]*)"/i, (_s, c) => `style="${c};font-family:${mono}"`)}>`
      : `<code${attrs} style="font-family:${mono}">`);
}
