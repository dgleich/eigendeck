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
import { TEXT_PRESET_STYLES } from '../types/presentation';
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

interface Props {
  element: TextElement;
  slide: Slide;
  presentationTheme: string;
  presentationConfig: PresentationConfig;
}

export function TextElementSvg({ element, slide, presentationTheme, presentationConfig }: Props) {
  const presetStyle = TEXT_PRESET_STYLES[element.preset];
  const theme = resolveTheme(presentationTheme, slide.theme);
  const themeColor = themeColorForPreset(theme, element.preset);
  const presetFontPkg = fontForPreset(element.preset, slide, presentationConfig);
  const presetFontFamily = fontFamilyForPreset(presetFontPkg, element.preset);

  const fontFamily = element.fontFamily || presetFontFamily;
  const fontSize = element.fontSize || presetStyle.fontSize;
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

  const w = element.position.width;
  const h = element.position.height;

  // overflow="visible" SVG presentation attribute (not just CSS) is required
  // for italic-glyph ink overhang to escape the SVG/foreignObject UA-clip.
  const svgMarkup =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="${w}" height="${h}" overflow="visible" style="display:block;overflow:visible;">` +
      `<foreignObject x="0" y="0" width="${w}" height="${h}" overflow="visible">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;${valignToCss(valign)};overflow:visible;box-sizing:border-box;">` +
          `<div style="width:100%;font-family:${fontFamily};font-size:${fontSize}px;font-weight:${fontWeight};font-style:${fontStyle};color:${color};line-height:1.3;padding:8px 12px;">` +
            (renderedHtml || '') +
          `</div>` +
        `</div>` +
      `</foreignObject>` +
    `</svg>`;

  return (
    <div
      style={{
        position: 'absolute', left: element.position.x, top: element.position.y,
        width: element.position.width, height: element.position.height,
      }}
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}
