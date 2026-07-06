// Render a script-bearing notebook output (Plotly, bokeh, any self-contained
// interactive text/html) in an OPAQUE-ORIGIN sandboxed iframe
// (docs/NOTEBOOK-ISOLATION.md). It stays interactive but has no line to Tauri, so
// a crafted deck's "output" can't reach the filesystem. Static output is
// sanitized inline instead (CellOutput); only executable output reaches here.
//
// The iframe carries `el-demo-frame`, so the parent rAF pump + relay armed by
// useDemoHost (SlideEditor / PresentMode) drive it at full framerate, and it
// reports its content height back so the box grows to fit.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildIsolatedOutputUrl, invalidateIsolatedOutput, useDeckFontFacesCss, useDemoInternetBlocked } from '../../lib/demoMount';
import { demoVarsCssForSlide } from '../../lib/demoThemeInject';
import { usePresentationStore } from '../../store/presentation';

export function IsolatedOutput({ html }: { html: string }) {
  const channelKey = `nbout-${useId()}`;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(24);

  const fontFacesCss = useDeckFontFacesCss();
  const config = usePresentationStore((s) => s.presentation.config);
  const theme = usePresentationStore((s) => s.presentation.theme);
  const slide = usePresentationStore((s) => s.presentation.slides[s.currentSlideIndex]);
  // demoVarsCssForSlide resolves the theme + font packages; memoize so it doesn't
  // recompute (and re-hash into the blob key) on every unrelated store re-render.
  const varsCss = useMemo(
    () => (slide ? demoVarsCssForSlide(config, theme, slide) : ''),
    [config, theme, slide],
  );

  const blockInternet = useDemoInternetBlocked();
  const src = useMemo(
    () => buildIsolatedOutputUrl(html, { channelKey, varsCss, fontFacesCss, blockInternet }),
    [html, channelKey, varsCss, fontFacesCss, blockInternet],
  );

  // Revoke this instance's blob(s) on unmount — channelKey is unique per mount,
  // so nothing else supersedes them.
  useEffect(() => () => invalidateIsolatedOutput(channelKey), [channelKey]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __eigendeck?: number; type?: string; h?: number } | undefined;
      if (!d || d.__eigendeck !== 1 || d.type !== 'iso-size') return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (typeof d.h === 'number' && d.h > 0) setHeight(Math.min(d.h, 20000));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      src={src}
      sandbox="allow-scripts"
      className="el-demo-frame nb-output nb-html-interactive"
      title="notebook output"
      style={{ width: '100%', height, border: 'none', display: 'block' }}
    />
  );
}
