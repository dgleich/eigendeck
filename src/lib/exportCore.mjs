import { injectDemoThemeIntoHtml } from './demoTheme.mjs';

/**
 * Shared HTML export logic.
 *
 * Pure JavaScript with no runtime dependencies. Both the GUI export
 * (src/store/fileOps.ts) and the CLI tool (tools/eigendeck.mjs) import
 * this module and provide their own filesystem and math renderer.
 *
 * @typedef {Object} ExportOptions
 * @property {Object} presentation - The presentation data
 * @property {(path: string) => Promise<Uint8Array>} readFile - Read binary file
 * @property {(path: string) => Promise<string>} readTextFile - Read text file
 * @property {((html: string) => Promise<string>) | null} renderMath - Optional: pre-render math to SVG
 * @property {((preamble: string) => Promise<void>) | null} applyMathPreamble - Optional: register math macros
 */

// Built-in theme backgrounds. Self-contained mirror of BUILT_IN_THEMES in
// src/lib/themes.ts (this .mjs is shared with the offline export tool and can't
// import the TS module). Keep in sync with that file's `colors.background`.
const THEME_BACKGROUNDS = {
  white: '#ffffff',
  light: '#f5f0e8',
  dark: '#1a1a2e',
  black: '#000000',
};

/** Resolve the effective slide background colour from the slide/deck theme. */
function themeBackground(presentation, slide) {
  const name = (slide && slide.theme) || (presentation && presentation.theme) || 'white';
  return THEME_BACKGROUNDS[name] || THEME_BACKGROUNDS.white;
}

const TEXT_PRESET_STYLES = {
  title:      { fontSize: 72, fontFamily: "'PT Sans', sans-serif", fontWeight: '700', fontStyle: 'normal', color: '#222' },
  body:       { fontSize: 48, fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#222' },
  textbox:    { fontSize: 48, fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#222' },
  annotation: { fontSize: 32, fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'italic', color: '#2563eb' },
  footnote:   { fontSize: 24, fontFamily: "'PT Sans Narrow', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#888' },
};

// Effective text-element background (colour + opacity → rgba), or '' when none.
// Kept self-contained so the CLI exporter can use it without the TS module.
// Mirrors textBackgroundCss() in types/presentation.ts.
function textBgCss(el) {
  if (!el || !el.backgroundColor) return '';
  const a = el.backgroundOpacity == null ? 1 : el.backgroundOpacity;
  if (a >= 1) return el.backgroundColor;
  const hex = el.backgroundColor.replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return el.backgroundColor;
}

// Text legibility effect (#73): drop shadow or high-contrast glow. Self-
// contained mirror of textEffectCss() in types/presentation.ts (this .mjs is
// shared with the offline export tool and can't import the TS module).
function textEffectCss(el, color) {
  const fx = el && el.textEffect;
  if (fx === 'shadow') return '0 2px 4px rgba(0,0,0,0.45)';
  if (fx === 'glow') {
    const hex = (color || '').replace('#', '');
    let halo = '#ffffff';
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
      halo = (0.299 * r + 0.587 * g + 0.114 * b) < 140 ? '#ffffff' : '#000000';
    }
    return `0 0 3px ${halo}, 0 0 6px ${halo}, 0 0 10px ${halo}`;
  }
  return '';
}

// Text-shadow for the TEXT (the Effect control). Mirrors textShadowCss().
function textShadowCss(el, color) {
  return textEffectCss(el, color);
}

// Box-shadow for the text BOX panel (the explicit boxShadow toggle + a
// background). Mirrors textBoxShadowCss().
function textBoxShadowCss(el) {
  return el && el.boxShadow && el.backgroundColor ? '0 4px 14px rgba(0,0,0,0.28)' : '';
}

/**
 * HTML-escape a string for use in a srcdoc attribute.
 */
export function htmlEscapeForSrcdoc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build the provider iframe `src` for an embed-kind video element. Self-
 * contained mirror of buildEmbedSrc() in src/lib/videoEmbed.ts (this .mjs is
 * shared with the offline export tool and can't import the TS module). Keep in
 * sync with that file. Returns null when the URL isn't a recognized provider.
 */
export function videoEmbedUrl(el) {
  if (!el || !el.url) return null;
  let u;
  try { u = new URL(String(el.url).trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  let provider = null, id = null, origin = null;
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v');
    if (v) { provider = 'youtube'; id = v; }
    else { const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/); if (m) { provider = 'youtube'; id = m[1]; } }
  } else if (host === 'youtu.be') {
    const i = u.pathname.slice(1).split('/')[0]; if (i) { provider = 'youtube'; id = i; }
  } else if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = u.pathname.match(/(\d+)/); if (m) { provider = 'vimeo'; id = m[1]; }
  } else {
    const pt = u.pathname.match(/\/(?:w|videos\/(?:watch|embed))\/([\w-]+)/);
    if (pt) { provider = 'peertube'; id = pt[1]; origin = u.origin; }
  }
  if (!provider || !id) return null;

  const p = new URLSearchParams();
  const showControls = !!el.controls || !el.autoplay;
  if (provider === 'youtube') {
    if (el.autoplay) p.set('autoplay', '1');
    if (el.muted) p.set('mute', '1');
    if (el.loop) { p.set('loop', '1'); p.set('playlist', id); }
    p.set('controls', showControls ? '1' : '0');
    if (el.captions) p.set('cc_load_policy', '1');
    p.set('rel', '0');
    return `https://www.youtube-nocookie.com/embed/${id}?${p.toString()}`;
  }
  if (provider === 'vimeo') {
    if (el.autoplay) p.set('autoplay', '1');
    if (el.muted) p.set('muted', '1');
    if (el.loop) p.set('loop', '1');
    if (!showControls) p.set('controls', '0');
    if (el.captions) p.set('texttrack', 'en');
    return `https://player.vimeo.com/video/${id}?${p.toString()}`;
  }
  // PeerTube
  const base = origin || u.origin;
  if (!base) return null;
  if (el.autoplay) p.set('autoplay', '1');
  if (el.muted) p.set('muted', '1');
  if (el.loop) p.set('loop', '1');
  if (!showControls) p.set('controls', '0');
  if (el.captions) p.set('subtitle', 'en');
  return `${base}/videos/embed/${id}?${p.toString()}`;
}

/**
 * Inject role/piece hash AND a unique channel key into a demo HTML.
 * In srcdoc iframes, location.pathname is empty, so demos that derive their
 * BroadcastChannel name from pathname would all collide. We override the
 * BroadcastChannel constructor to inject a unique prefix per slide+demo.
 */
export function injectDemoBootstrap(html, hash, channelKey) {
  // Parse the hash to extract params (e.g. "#piece=lattice" -> {piece: "lattice"})
  const hashParams = {};
  if (hash) {
    const qs = hash.startsWith('#') ? hash.slice(1) : hash;
    for (const part of qs.split('&')) {
      const [k, v] = part.split('=');
      if (k) hashParams[k] = v || '';
    }
  }
  const bootstrap = `<script>
(function(){
  var __ch = ${JSON.stringify(channelKey)};
  var __hp = ${JSON.stringify(hashParams)};
  // Set location.hash (works in normal iframes, may fail in srcdoc)
  try { window.location.hash = ${JSON.stringify(hash || '')}; } catch(e) {}
  // Patch URLSearchParams so demos reading location.hash get injected values
  var _USP = window.URLSearchParams;
  window.URLSearchParams = function(init) {
    var inst = new _USP(init);
    if (!init || init === '' || init === '#') {
      for (var k in __hp) inst.set(k, __hp[k]);
    }
    return inst;
  };
  window.URLSearchParams.prototype = _USP.prototype;
  // Replace BroadcastChannel with postMessage relay via parent.
  // srcdoc iframes may have opaque origins where BroadcastChannel won't work.
  window.BroadcastChannel = function(name) {
    this._name = __ch + ':' + name;
    this.onmessage = null;
    var self = this;
    window.addEventListener('message', function(e) {
      if (!e.data || !self.onmessage) return;
      // Enveloped message from relay
      if (e.data.__bc === self._name) {
        self.onmessage({ data: e.data.payload });
      }
      // Raw request-state from parent (slide navigation re-request)
      if (e.data.type === 'request-state' && !e.data.__bc) {
        self.onmessage({ data: e.data });
      }
    });
  };
  window.BroadcastChannel.prototype.postMessage = function(msg) {
    // Send to parent, which relays to all sibling iframes
    try {
      window.parent.postMessage({ __bc: this._name, payload: msg }, '*');
    } catch(e) {}
  };
  window.BroadcastChannel.prototype.close = function() { this.onmessage = null; };
})();
</script>`;
  if (html.includes('<head>')) {
    return html.replace('<head>', '<head>' + bootstrap);
  }
  return bootstrap + html;
}

/**
 * Convert bytes to a base64 data URL.
 * Encodes in chunks to avoid stack overflow on large images.
 */
export function bytesToDataUrl(bytes, ext) {
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  // Universal base64 encoding (works in browser and Node)
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.slice(i, i + chunkSize)));
  }
  // btoa exists in browsers and modern Node
  const base64 = (typeof btoa !== 'undefined')
    ? btoa(binary)
    : Buffer.from(binary, 'binary').toString('base64');
  return `data:${mime};base64,${base64}`;
}

/**
 * Build the standalone HTML export of a presentation.
 *
 * @param {ExportOptions} opts
 * @returns {Promise<string>} The HTML string
 */
export async function buildExportHtml(opts) {
  const {
    presentation, readFile, readTextFile, renderMath, applyMathPreamble,
    /**
     * Optional: per-element font resolver. Returns the CSS font-family string
     * to use for an element on a given slide. If omitted, falls back to
     * preset.fontFamily (PT Sans).
     */
    resolveFont,
    /**
     * Optional: per-element math bundle resolver. Returns the bundle id
     * (e.g. 'shantell') to use for math in an element with the given preset
     * on the given slide. When set, renderMath is called as
     * `renderMath(html, bundleId)` so each element renders math in its own
     * preset's font. If omitted, renderMath is called as `renderMath(html)`
     * and uses whatever bundle is loaded.
     */
    resolveMathBundle,
    /**
     * Optional: per-element override that returns the COMPLETE inner HTML
     * for a text element (typically the SVG/foreignObject markup with math
     * pre-rendered). When set, exportCore uses it instead of building HTML
     * divs around the element's html. The returned string is wrapped in an
     * absolutely-positioned div at the element's coordinates.
     *
     * Signature: (element, slide) => Promise<string> | string
     */
    renderTextElement,
    /**
     * Optional: pre-built @font-face CSS block (typically with data URLs)
     * to embed in <head>. If omitted, uses Google Fonts CDN for PT Sans only.
     */
    fontFacesCss,
    /**
     * Optional: per-element preview-PNG fetcher. Returns a base64 `data:` URL
     * for the element's cached/rasterized preview image (the SAME bytes the
     * static on-screen renderer shows), or null on a miss. Used for element
     * types that can't be rendered statically from their source bytes in a
     * plain `<img>`:
     *   - notebook  → the proactively-cached preview PNG (asset_cache 'preview')
     *   - video (file) → poster/preview frame
     *   - image kind:'pdf' → the pdfium-rasterized PNG (asset_cache '_')
     * Signature: (element, slide) => Promise<string | null> | string | null
     */
    getElementPreview,
    /**
     * Optional: per-notebook-element renderer that returns the COMPLETE
     * inner HTML (typically a srcdoc <iframe>) for a notebook element —
     * scrollable, full-fidelity cells/outputs rendered through the same
     * React components as the live view. When provided (app export) and it
     * returns HTML, it's used in preference to the preview PNG. The
     * CLI/headless paths pass nothing → preview PNG / placeholder.
     *
     * Signature: (element, slide) => Promise<string | null> | string | null
     */
    renderNotebookElement,
    /**
     * Optional: per-slide demo theme vars (#86). Returns the
     * `:root{--eigendeck-*}` block for a slide's resolved theme + fonts, which
     * is spliced (with `fontFacesCss`) into each demo's srcdoc so demos match
     * the deck. App export supplies this; the headless CLI omits it (demos then
     * get fonts only). Signature: (slide) => string | undefined
     */
    demoThemeVarsCss,
  } = opts;

  const W = presentation.config?.width || 1920;
  const H = presentation.config?.height || 1080;
  const meta = [presentation.config?.author, presentation.config?.venue]
    .filter(Boolean)
    .join(' \u00B7 ');

  // Image cache (data URLs)
  const imageCache = new Map();
  async function getImageDataUrl(src) {
    if (!src) return null;   // unresolved asset (no path) — caller emits a placeholder, never crash
    if (src.startsWith('data:')) return src;
    if (imageCache.has(src)) return imageCache.get(src);
    try {
      const bytes = await readFile(src);
      const ext = src.split('.').pop()?.toLowerCase() || 'png';
      const dataUrl = bytesToDataUrl(bytes, ext);
      imageCache.set(src, dataUrl);
      return dataUrl;
    } catch (e) {
      console.error(`Failed to inline image ${src}:`, e);
      return src;
    }
  }

  // Apply math preamble if available
  if (presentation.config?.mathPreamble && applyMathPreamble) {
    try { await applyMathPreamble(presentation.config.mathPreamble); }
    catch (e) { console.warn('Failed to apply math preamble:', e); }
  }

  const slideHtml = [];

  for (let i = 0; i < presentation.slides.length; i++) {
    const slide = presentation.slides[i];
    let inner = '';
    const demoPieceSrcs = new Set();

    for (const el of slide.elements || []) {
      const p = el.position;
      switch (el.type) {
        case 'text': {
          // Preferred path: caller pre-renders the entire SVG (math already
          // composited via the iframe pool, per-preset font fully resolved).
          // We just wrap it in a positioned div.
          if (renderTextElement) {
            const svgMarkup = await renderTextElement(el, slide);
            const bg = textBgCss(el);
            const sh = textBoxShadowCss(el);
            const rot = el.rotation ? `transform:rotate(${el.rotation}deg);` : '';
            inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;${bg ? `background:${bg};` : ''}${sh ? `box-shadow:${sh};` : ''}${rot}">` +
              svgMarkup + `</div>`;
            break;
          }
          // Legacy fallback: build HTML divs in-line. Used by the CLI
          // exporter (export-cli.ts) which doesn't have access to React/
          // browser context and has to live with body-font math.
          const ps = TEXT_PRESET_STYLES[el.preset] || TEXT_PRESET_STYLES.body;
          let textHtml = el.html || '';
          if (renderMath && /\$[^$]+\$|\$\$[\s\S]+?\$\$/.test(textHtml)) {
            const bundleId = resolveMathBundle ? resolveMathBundle(el.preset, slide) : undefined;
            try { textHtml = await renderMath(textHtml, bundleId); }
            catch (e) { console.warn('Math render failed:', e); }
          }
          const valign = el.verticalAlign || (el.preset === 'title' || el.preset === 'footnote' ? 'bottom' : undefined);
          const valignStyle = valign === 'middle' ? 'display:flex;flex-direction:column;justify-content:center;' :
                             valign === 'bottom' ? 'display:flex;flex-direction:column;justify-content:flex-end;' : '';
          const resolvedFont = resolveFont ? resolveFont(el.preset, slide) : ps.fontFamily;
          const fontFamily = el.fontFamily || resolvedFont;
          const bgLegacy = textBgCss(el);
          const fxLegacy = textShadowCss(el, el.color || ps.color);
          const shLegacy = textBoxShadowCss(el);
          const rotLegacy = el.rotation ? `transform:rotate(${el.rotation}deg);` : '';
          inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;overflow:hidden;${bgLegacy ? `background:${bgLegacy};` : ''}${shLegacy ? `box-shadow:${shLegacy};` : ''}${rotLegacy}">` +
            `<div style="width:100%;height:100%;${valignStyle}">` +
            `<div style="font-family:${fontFamily};font-weight:${ps.fontWeight};font-style:${ps.fontStyle};font-size:${el.fontSize || ps.fontSize}px;color:${el.color || ps.color};line-height:1.3;padding:8px 12px;${fxLegacy ? `text-shadow:${fxLegacy};` : ''}">${textHtml}</div>` +
            `</div></div>`;
          break;
        }
        case 'image': {
          // PDF-kind images can't render as data:application/pdf in <img>; the
          // editor shows the pdfium-rasterized PNG from asset_cache. Inline that
          // same preview PNG. If no preview is available (cold export, never
          // rasterized) emit a visible placeholder rather than the raw PDF
          // bytes — a data:image/pdf in <img> ships a broken/blank image.
          let imgSrc;
          if (el.kind === 'pdf') {
            imgSrc = getElementPreview ? await getElementPreview(el, slide) : null;
            if (!imgSrc) {
              inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;display:flex;align-items:center;justify-content:center;background:#f0f0f0;color:#aaa;font-size:24px;font-family:sans-serif;border:1px solid #ddd;">PDF</div>`;
              break;
            }
          } else {
            imgSrc = await getImageDataUrl(el.src);
            if (!imgSrc) {
              // Unresolved/missing asset — emit a visible placeholder instead of
              // a broken <img src="null"> (or crashing the whole export).
              inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;display:flex;align-items:center;justify-content:center;background:#f0f0f0;color:#aaa;font-size:24px;font-family:sans-serif;border:1px solid #ddd;">image</div>`;
              break;
            }
          }
          const imgStyles = [
            `position:absolute`, `left:${p.x}px`, `top:${p.y}px`,
            `width:${p.width}px`, `height:${p.height}px`, `object-fit:contain`,
          ];
          if (el.shadow) imgStyles.push(`filter:drop-shadow(4px 8px 16px rgba(0,0,0,0.3))`);
          if (el.borderRadius) imgStyles.push(`border-radius:${el.borderRadius}px`);
          if (el.opacity != null && el.opacity < 1) imgStyles.push(`opacity:${el.opacity}`);
          if (el.rotation) imgStyles.push(`transform:rotate(${el.rotation}deg)`);
          inner += `<img src="${imgSrc}" style="${imgStyles.join(';')};" />`;
          break;
        }
        case 'demo':
          try {
            let demoHtml = await readTextFile(el.src);
            demoHtml = injectDemoThemeIntoHtml(demoHtml, fontFacesCss || '', demoThemeVarsCss ? (demoThemeVarsCss(slide) || '') : '');
            const escaped = htmlEscapeForSrcdoc(demoHtml);
            inner += `<iframe srcdoc="${escaped}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;border:none;" sandbox="allow-scripts allow-same-origin"></iframe>`;
          } catch (e) { console.error('Demo export failed:', e); }
          break;
        case 'demo-piece':
          demoPieceSrcs.add(el.demoSrc);
          try {
            const demoHtml = await readTextFile(el.demoSrc);
            const channelKey = `slide${i}-${el.demoSrc.replace(/[^a-z0-9]/gi, '')}`;
            let pieceHtml = injectDemoBootstrap(demoHtml, `#piece=${el.piece}`, channelKey);
            pieceHtml = injectDemoThemeIntoHtml(pieceHtml, fontFacesCss || '', demoThemeVarsCss ? (demoThemeVarsCss(slide) || '') : '');
            const escaped = htmlEscapeForSrcdoc(pieceHtml);
            inner += `<iframe srcdoc="${escaped}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;border:none;" sandbox="allow-scripts allow-same-origin"></iframe>`;
          } catch (e) { console.error('Demo piece export failed:', e); }
          break;
        case 'notebook': {
          // Three-tier, full-fidelity → preview → placeholder:
          //   1. renderNotebookElement (app export): a scrollable,
          //      explorable render of the actual cells/outputs through the
          //      same React components as the live view (no kernel needed —
          //      recorded outputs are shown). Wrapped in an absolutely-
          //      positioned box at the element's coordinates.
          //   2. the proactively-cached preview PNG (warm cache / CLI).
          //   3. a visible "NB" placeholder (cold export).
          let nbHtml = null;
          if (renderNotebookElement) {
            try { nbHtml = await renderNotebookElement(el, slide); }
            catch (e) { console.error('Notebook export render failed:', e); }
          }
          if (nbHtml) {
            inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;overflow:hidden;">${nbHtml}</div>`;
            break;
          }
          // Static snapshot: the proactively-cached preview PNG (the same
          // bytes SlideThumbnail shows).
          const previewSrc = getElementPreview ? await getElementPreview(el, slide) : null;
          if (previewSrc) {
            inner += `<img src="${previewSrc}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;object-fit:contain;" />`;
          } else {
            // No cached preview (deck never opened / exported cold). Emit a
            // visible placeholder so the element isn't silently dropped.
            inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;display:flex;align-items:center;justify-content:center;background:#eef7ee;color:#86c986;font-size:64px;font-family:sans-serif;">NB</div>`;
          }
          break;
        }
        case 'video': {
          if (el.kind === 'embed' && el.url) {
            // Hosted embed (YouTube/Vimeo/PeerTube): emit the provider iframe so
            // the video is playable in the exported HTML.
            const embedSrc = videoEmbedUrl(el);
            if (embedSrc) {
              inner += `<iframe src="${embedSrc}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;border:none;" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
            } else {
              inner += `<a href="${el.url}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font-size:24px;font-family:sans-serif;text-decoration:none;">&#9654; Video</a>`;
            }
          } else if (el.kind === 'file' && el.src) {
            // Local file: inline the asset as a playable <video>.
            try {
              const videoSrc = await getImageDataUrl(el.src);
              const attrs = [];
              if (el.controls) attrs.push('controls');
              if (el.loop) attrs.push('loop');
              if (el.autoplay) attrs.push('autoplay');
              if (el.muted || el.autoplay) attrs.push('muted');
              inner += `<video src="${videoSrc}" ${attrs.join(' ')} style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;object-fit:contain;background:#000;"></video>`;
            } catch (e) { console.error('Video export failed:', e); }
          } else {
            // Unknown/poster-only: try a cached preview, else a placeholder.
            const previewSrc = getElementPreview ? await getElementPreview(el, slide) : null;
            if (previewSrc) {
              inner += `<img src="${previewSrc}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;object-fit:contain;background:#000;" />`;
            } else {
              inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font-size:24px;font-family:sans-serif;">&#9654; Video</div>`;
            }
          }
          break;
        }
        case 'cover':
          inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;background:${el.color || themeBackground(presentation, slide)};"></div>`;
          break;
        case 'arrow': {
          const { x1, y1, x2, y2, color = '#2563eb', strokeWidth = 4, headSize = 16 } = el;
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const ha = Math.PI / 6;
          inner += `<svg style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;">`;
          inner += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}"/>`;
          inner += `<polygon points="${x2},${y2} ${x2 - headSize * Math.cos(angle - ha)},${y2 - headSize * Math.sin(angle - ha)} ${x2 - headSize * Math.cos(angle + ha)},${y2 - headSize * Math.sin(angle + ha)}" fill="${color}"/>`;
          inner += `</svg>`;
          break;
        }
      }
    }

    // Hidden controller iframes for demo-pieces
    for (const demoSrc of demoPieceSrcs) {
      try {
        const demoHtml = await readTextFile(demoSrc);
        const channelKey = `slide${i}-${demoSrc.replace(/[^a-z0-9]/gi, '')}`;
        const ctrlHtml = injectDemoBootstrap(demoHtml, '#role=controller', channelKey);
        const escaped = htmlEscapeForSrcdoc(ctrlHtml);
        inner += `<iframe srcdoc="${escaped}" style="position:absolute;width:1px;height:1px;border:none;opacity:0;pointer-events:none;" sandbox="allow-scripts allow-same-origin"></iframe>`;
      } catch (e) { console.error('Controller iframe failed:', e); }
    }

    inner += `<div class="slide-footer"><span class="slide-footer-meta">${meta}</span><span class="slide-footer-number">${i + 1}</span></div>`;
    // P0-1: emit the per-slide theme background on the wrapper so dark/black/
    // light themes don't export white-on-white. CSS no longer forces #fff.
    const slideBg = themeBackground(presentation, slide);
    slideHtml.push(`<div class="slide" data-index="${i}" style="background:${slideBg};">${inner}</div>`);
  }

  // Math is composited to SVG before it reaches here: the app pre-renders every
  // text box via the iframe pool, and the CLI/headless paths consult the
  // math_cache (and render any miss themselves). Exports are therefore
  // self-contained SVG — no MathJax runtime, no CDN. A genuine cache miss in a
  // never-opened deck ships its $tex$ source verbatim (rare, and honest) rather
  // than pulling a wrong-font, network-dependent MathJax off a CDN.

  // Embed source JSON for round-trip import
  const sourceB64 = (typeof btoa !== 'undefined')
    ? btoa(unescape(encodeURIComponent(JSON.stringify(presentation))))
    : Buffer.from(JSON.stringify(presentation)).toString('base64');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${presentation.title || 'Presentation'}</title>
<style>
${fontFacesCss || `@import url('https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400&family=PT+Sans+Narrow:wght@400;700&display=swap');`}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #000; overflow: hidden; font-family: 'PT Sans', sans-serif; }
#viewport { width: 100vw; height: 100vh; position: relative; }
.slide {
  width: ${W}px; height: ${H}px; position: absolute;
  top: 50%; left: 50%; transform-origin: center center; display: none; overflow: hidden;
}
.slide.active { display: block; }
ul, ol { padding-left: 0; margin: 0; list-style-type: none; }
ul li::before { content: '- '; }
ol { counter-reset: ol-counter; }
ol li::before { counter-increment: ol-counter; content: counter(ol-counter) '. '; }
li { margin-bottom: 0.15em; list-style-position: inside; }
.slide-footer {
  position: absolute; bottom: 20px; right: 40px;
  display: flex; align-items: baseline; gap: 16px;
  font-family: 'PT Sans', sans-serif; color: #999; font-size: 18px;
}
.slide-footer-number { font-size: 24px; }
/* Navigation bar */
#nav-bar {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center; gap: 16px;
  padding: 8px 20px; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
  font-family: 'PT Sans', sans-serif; font-size: 14px; color: #ccc;
  opacity: 0; transition: opacity 0.3s; pointer-events: none;
  -webkit-backdrop-filter: blur(8px);
}
#nav-bar.visible { opacity: 1; pointer-events: auto; }
#nav-bar button {
  background: none; border: 1px solid rgba(255,255,255,0.2); color: #ccc;
  border-radius: 4px; padding: 4px 12px; font-size: 14px; cursor: pointer;
  font-family: inherit; min-width: 36px;
}
#nav-bar button:hover { background: rgba(255,255,255,0.1); color: #fff; }
#nav-bar button:disabled { opacity: 0.3; cursor: default; }
#nav-bar .nav-pos { min-width: 60px; text-align: center; }
#nav-bar input[type=range] { width: 120px; accent-color: #888; }
@media (max-width: 768px) {
  #nav-bar { padding: 12px 16px; font-size: 16px; }
  #nav-bar button { padding: 8px 16px; font-size: 16px; min-width: 44px; }
}
</style>
</head>
<body>
<div id="viewport">
${slideHtml.join('\n')}
</div>
<!-- eigendeck-source: ${sourceB64} -->
<div id="nav-bar">
  <button id="nb-prev">&lsaquo;</button>
  <span class="nav-pos"><span id="nb-cur">1</span> / <span id="nb-total"></span></span>
  <button id="nb-next">&rsaquo;</button>
</div>
<script>
// BroadcastChannel relay for demo-piece iframes
window.addEventListener('message', function(e) {
  if (!e.data || !e.data.__bc) return;
  var allIframes = document.querySelectorAll('iframe');
  for (var i = 0; i < allIframes.length; i++) {
    if (allIframes[i].contentWindow !== e.source) {
      try { allIframes[i].contentWindow.postMessage(e.data, '*'); } catch(ex) {}
    }
  }
});

const slides = document.querySelectorAll('.slide');
let current = 0;
const W = ${W}, H = ${H};
const nb = document.getElementById('nav-bar');
const nbCur = document.getElementById('nb-cur');
const nbPrev = document.getElementById('nb-prev');
const nbNext = document.getElementById('nb-next');
document.getElementById('nb-total').textContent = slides.length;

function show(i) {
  i = Math.max(0, Math.min(i, slides.length - 1));
  slides.forEach((s, idx) => s.classList.toggle('active', idx === i));
  resize();
  current = i;
  nbCur.textContent = i + 1;
  nbPrev.disabled = i === 0;
  nbNext.disabled = i === slides.length - 1;
  // Re-request state for demo iframes (retry as they may still be loading)
  function requestState(slide, attempt) {
    var iframes = slide.querySelectorAll('iframe');
    for (var j = 0; j < iframes.length; j++) {
      try { iframes[j].contentWindow.postMessage({ type: 'request-state' }, '*'); } catch(ex) {}
    }
    if (attempt < 3) setTimeout(function() { requestState(slide, attempt + 1); }, 500);
  }
  setTimeout(function() { requestState(slides[i], 0); }, 200);
}
function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(vw / W, vh / H);
  slides.forEach(function(s) {
    s.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
  });
}
function next() { if (current < slides.length - 1) show(current + 1); }
function prev() { if (current > 0) show(current - 1); }

// Nav bar buttons
nbPrev.onclick = prev;
nbNext.onclick = next;

// Keyboard
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault(); next();
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault(); prev();
  }
  if (e.key === 'Home') { e.preventDefault(); show(0); }
  if (e.key === 'End') { e.preventDefault(); show(slides.length - 1); }
});

// Show nav bar on mouse move / touch, auto-hide after 3s
var hideTimer = null;
function showNav() {
  nb.classList.add('visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(function() { nb.classList.remove('visible'); }, 3000);
}
document.addEventListener('mousemove', showNav);
document.addEventListener('touchstart', showNav, { passive: true });

// Touch: swipe left/right to navigate
var touchStartX = 0, touchStartY = 0;
document.addEventListener('touchstart', function(e) {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', function(e) {
  // Don't swipe-navigate if the touch started inside an iframe area
  var startEl = document.elementFromPoint(touchStartX, touchStartY);
  if (startEl && (startEl.tagName === 'IFRAME' || startEl.closest('iframe'))) return;
  var dx = e.changedTouches[0].clientX - touchStartX;
  var dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) {
    if (dx < 0) next(); else prev();
  }
});

// No click-to-navigate — it interferes with interactive demos.
// Use swipe on mobile, keyboard/nav bar on desktop.

show(0);
window.addEventListener('resize', resize);
// Show nav briefly on load
setTimeout(function() { showNav(); }, 500);
</script>
</body>
</html>`;
}
