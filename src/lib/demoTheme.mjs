// Demo theme inheritance (#86) — single source of truth for the CSS that lets a
// demo iframe match the deck's fonts + theme.
//
// Demos render in isolated iframes (blob: in editor/present, srcdoc in export),
// so they don't see the app's @font-face or theme. We inject:
//   1. @font-face for the deck's fonts (data: URLs) so font-family:'PT Sans'
//      resolves inside the iframe — this fixes existing demos automatically,
//      since they already name the deck fonts.
//   2. The resolved theme as CSS custom properties (--eigendeck-*). VARS ONLY —
//      we do NOT set body{} defaults, so existing demos are untouched; a demo
//      opts in by using var(--eigendeck-bg) etc.
//
// This module is plain .mjs (no React/DOM-only deps in the pure parts) so the
// app (TS) AND the node HTML exporter share ONE source — the value CSS can't
// drift between editor, present, and export. Only the *delivery* differs:
// in-app injects into the live contentDocument; export splices a <style> into
// the static srcdoc (no live DOM there).

export const DEMO_FONTS_STYLE_ID = 'eigendeck-demo-fonts';
export const DEMO_VARS_STYLE_ID = 'eigendeck-demo-vars';

/**
 * Build the `:root { --eigendeck-* }` custom-property block for a resolved
 * theme. `colors` is a ThemeColors ({background,text,heading,accent,muted});
 * the font names are bare CSS family names (e.g. 'PT Sans').
 */
export function demoThemeVarsCss(colors, opts = {}) {
  const { font, narrow, mono, baseSize } = opts;
  const lines = [
    `--eigendeck-bg: ${colors.background};`,
    `--eigendeck-fg: ${colors.text};`,
    `--eigendeck-heading: ${colors.heading};`,
    `--eigendeck-accent: ${colors.accent};`,
    `--eigendeck-muted: ${colors.muted};`,
  ];
  if (font) lines.push(`--eigendeck-font: '${font}';`);
  if (narrow) lines.push(`--eigendeck-narrow: '${narrow}';`);
  if (mono) lines.push(`--eigendeck-mono: '${mono}';`);
  if (baseSize) lines.push(`--eigendeck-base-size: ${baseSize}px;`);
  return `:root{\n  ${lines.join('\n  ')}\n}`;
}

/**
 * A self-contained `<style>` string carrying the font faces + theme vars, for
 * splicing into a static demo srcdoc (export). Empty parts are omitted.
 */
export function demoThemeStyleTag(fontFacesCss, varsCss) {
  const css = [fontFacesCss, varsCss].filter(Boolean).join('\n');
  if (!css) return '';
  return `<style id="${DEMO_VARS_STYLE_ID}">\n${css}\n</style>`;
}

/**
 * Splice the demo-theme <style> into a demo HTML string (export path). Inserted
 * right after <head> when present, else prepended so it still applies.
 */
export function injectDemoThemeIntoHtml(html, fontFacesCss, varsCss) {
  const tag = demoThemeStyleTag(fontFacesCss, varsCss);
  if (!tag) return html;
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + '\n' + tag + html.slice(at);
  }
  return tag + '\n' + html;
}

/**
 * Inject (or update) the demo-theme styles in a LIVE iframe document
 * (editor/present). Idempotent and split so the heavy font-face block is set
 * once while the cheap vars block updates on theme change with no reflow churn.
 * Silently no-ops if the document isn't reachable/ready (cross-origin or not
 * yet loaded) — mirrors previewCache.ts's contentDocument guard.
 *
 * @param doc  the iframe's contentDocument
 * @param fontFacesCss  @font-face block (data: URLs); may be '' to skip
 * @param varsCss  the :root{--eigendeck-*} block
 */
export function injectDemoThemeIntoDoc(doc, fontFacesCss, varsCss) {
  if (!doc) return;
  const head = doc.head || doc.documentElement;
  if (!head) return;
  // Fonts: set once (or when the css changes) — keyed by content length+head
  // so we don't re-parse a megabyte of base64 on every theme switch.
  if (fontFacesCss) {
    let fs = doc.getElementById(DEMO_FONTS_STYLE_ID);
    if (!fs) {
      fs = doc.createElement('style');
      fs.id = DEMO_FONTS_STYLE_ID;
      head.appendChild(fs);
    }
    if (fs.textContent !== fontFacesCss) fs.textContent = fontFacesCss;
  }
  // Vars: cheap, update freely.
  let vs = doc.getElementById(DEMO_VARS_STYLE_ID);
  if (!vs) {
    vs = doc.createElement('style');
    vs.id = DEMO_VARS_STYLE_ID;
    head.appendChild(vs);
  }
  if (vs.textContent !== varsCss) vs.textContent = varsCss;
}
