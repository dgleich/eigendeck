/**
 * Display-only renderer for a TextElement: <svg><foreignObject> with the
 * element's HTML composed inside (math pre-rendered via the per-preset
 * iframe pool).
 *
 * Used by:
 *   - SlideElementRenderer's TextContent (display mode, when not editing)
 *   - SlideSidebar thumbnails
 *   - PresentMode and presenter (when wired up)
 *
 * The SVG approach is what makes per-preset math fonts coexist on the same
 * slide (each math expression is rendered with the bundle that matches its
 * surrounding text element's preset).
 */
import { useEffect, useState } from 'react';
import type { TextElement, Slide, PresentationConfig } from '../types/presentation';
import { TEXT_PRESET_STYLES, effectiveFontSize } from '../types/presentation';
import { resolveTheme, themeColorForPreset } from '../lib/themes';
import { fontForPreset, fontFamilyForPreset } from '../lib/fonts';
import {
  renderMathInHtml as renderMathInIframe,
  containsMath as containsMathExpr,
} from '../lib/mathjaxRenderer';

function valignToCss(valign?: string): string {
  if (valign === 'middle') return 'display:flex;flex-direction:column;justify-content:center';
  if (valign === 'bottom') return 'display:flex;flex-direction:column;justify-content:flex-end';
  return '';
}

/**
 * Strip HTML tags but keep math source ($..$ / $$..$$) — produces readable
 * alt-text for accessibility. The result preserves "text $\\alpha + 1$ more"
 * as "text $\alpha + 1$ more" so screen readers can announce the equation
 * source intelligibly.
 */
function altTextFromHtml(html: string): string {
  if (!html) return '';
  // Replace block tags with newlines, then strip remaining tags. Decode
  // common entities. Collapse whitespace.
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Escape XML special characters for use in an attribute value. */
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape XML special characters for use as element text content. */
function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build the SVG/foreignObject markup string for a text element.
 * Pure function — no React, no DOM. The iframe pool must already have
 * pre-rendered math (passed in as `renderedHtml`).
 *
 * Used by:
 *   - TextElementSvg (React display component)
 *   - HTML export (fileOps.ts, via exportCore renderTextElement callback)
 *
 * The output is fully self-contained — math SVGs have inlined glyph paths
 * (fontCache:'none') so they can be moved across documents.
 *
 * Accessibility: the SVG carries role="img" + aria-label with the source
 * text (math marker syntax preserved), and an inner <title> element. Screen
 * readers pick up either; sighted users don't see them as tooltips because
 * we use aria-label instead of relying on title-as-tooltip behavior.
 */
export function buildTextElementSvgMarkup(
  element: TextElement,
  renderedHtml: string,
  ctx: { fontFamily: string; fontSize: number; fontWeight: string; fontStyle: string; color: string; valign?: string },
): string {
  const w = element.position.width;
  const h = element.position.height;
  // Alt text comes from the SOURCE element.html (with $..$), not the
  // post-render html (which would have lost the math source to inline SVGs).
  const alt = altTextFromHtml(element.html);
  // overflow="visible" attribute (not just CSS) — required for italic-glyph
  // ink overhang. WebKit enforces UA-style overflow:hidden on <svg>/
  // <foreignObject> per spec; only the presentation attribute lifts it.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="${w}" height="${h}" overflow="visible" role="img" aria-label="${escAttr(alt)}" style="display:block;overflow:visible;">` +
      `<title>${escText(alt)}</title>` +
      `<foreignObject x="0" y="0" width="${w}" height="${h}" overflow="visible">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;${valignToCss(ctx.valign)};overflow:visible;box-sizing:border-box;">` +
          `<div style="width:100%;font-family:${ctx.fontFamily};font-size:${ctx.fontSize}px;font-weight:${ctx.fontWeight};font-style:${ctx.fontStyle};color:${ctx.color};line-height:1.3;padding:8px 12px;">` +
            (renderedHtml || '') +
          `</div>` +
        `</div>` +
      `</foreignObject>` +
    `</svg>`
  );
}

interface Props {
  element: TextElement;
  slide: Slide;
  presentationTheme: string;
  presentationConfig: PresentationConfig;
  /** Optional CSS class on the wrapper (for hover/preset selectors). */
  className?: string;
  /** Optional z-index on the wrapper (for layering in slide canvases). */
  zIndex?: number;
  /** Optional style override (e.g. interpolated transform from animations). */
  styleOverride?: React.CSSProperties;
}

export function TextElementSvg({
  element, slide, presentationTheme, presentationConfig,
  className, zIndex, styleOverride,
}: Props) {
  const presetStyle = TEXT_PRESET_STYLES[element.preset];
  const theme = resolveTheme(presentationTheme, slide.theme);
  const themeColor = themeColorForPreset(theme, element.preset);
  const presetFontPkg = fontForPreset(element.preset, slide, presentationConfig);
  const presetFontFamily = fontFamilyForPreset(presetFontPkg, element.preset);

  const fontFamily = element.fontFamily || presetFontFamily;
  const fontSize = effectiveFontSize(element, presentationConfig);
  const fontWeight = presetStyle.fontWeight;
  const fontStyle = presetStyle.fontStyle;
  const color = element.color || themeColor;
  const mathBundleId = presetFontPkg.id;

  const valign = element.verticalAlign || (element.preset === 'title' || element.preset === 'footnote' ? 'bottom' : undefined);

  // Pre-render math via per-preset iframe pool. Falls back to raw source
  // while pending so the element doesn't go blank.
  const [renderedHtml, setRenderedHtml] = useState<string>(element.html || '');
  useEffect(() => {
    let cancelled = false;
    if (!containsMathExpr(element.html)) {
      setRenderedHtml(element.html || '');
      return () => { cancelled = true; };
    }
    renderMathInIframe(element.html, mathBundleId, presentationConfig.mathPreamble).then((html) => {
      if (!cancelled) setRenderedHtml(html);
    }).catch(() => {
      if (!cancelled) setRenderedHtml(element.html || '');
    });
    return () => { cancelled = true; };
  }, [element.html, mathBundleId]);

  const svgMarkup = buildTextElementSvgMarkup(element, renderedHtml, {
    fontFamily, fontSize, fontWeight, fontStyle, color, valign,
  });

  return (
    <div
      className={className}
      style={{
        position: 'absolute', left: element.position.x, top: element.position.y,
        width: element.position.width, height: element.position.height,
        ...(zIndex !== undefined ? { zIndex } : {}),
        ...styleOverride,
      }}
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}
