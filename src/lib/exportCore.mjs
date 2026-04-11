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

const TEXT_PRESET_STYLES = {
  title:      { fontSize: 72, fontFamily: "'PT Sans', sans-serif", fontWeight: '700', fontStyle: 'normal', color: '#222' },
  body:       { fontSize: 48, fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#222' },
  textbox:    { fontSize: 48, fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#222' },
  annotation: { fontSize: 32, fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'italic', color: '#2563eb' },
  footnote:   { fontSize: 24, fontFamily: "'PT Sans Narrow', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#888' },
};

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
 * Inject role/piece hash AND a unique channel key into a demo HTML.
 * In srcdoc iframes, location.pathname is empty, so demos that derive their
 * BroadcastChannel name from pathname would all collide. We override the
 * BroadcastChannel constructor to inject a unique prefix per slide+demo.
 */
export function injectDemoBootstrap(html, hash, channelKey) {
  const bootstrap = `<script>
(function(){
  var __ch = ${JSON.stringify(channelKey)};
  try { window.location.hash = ${JSON.stringify(hash)}; } catch(e) {}
  var _BC = window.BroadcastChannel;
  if (_BC) {
    window.BroadcastChannel = function(name) {
      return new _BC(__ch + ':' + name);
    };
    window.BroadcastChannel.prototype = _BC.prototype;
  }
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
  const { presentation, readFile, readTextFile, renderMath, applyMathPreamble } = opts;

  const W = presentation.config?.width || 1920;
  const H = presentation.config?.height || 1080;
  const meta = [presentation.config?.author, presentation.config?.venue]
    .filter(Boolean)
    .join(' \u00B7 ');

  // Image cache (data URLs)
  const imageCache = new Map();
  async function getImageDataUrl(src) {
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
  let hasUnrenderedMath = false;

  for (let i = 0; i < presentation.slides.length; i++) {
    const slide = presentation.slides[i];
    let inner = '';
    const demoPieceSrcs = new Set();

    for (const el of slide.elements || []) {
      const p = el.position;
      switch (el.type) {
        case 'text': {
          const ps = TEXT_PRESET_STYLES[el.preset] || TEXT_PRESET_STYLES.body;
          let textHtml = el.html || '';
          // Pre-render math to SVG if a renderer is available
          if (renderMath && /\$[^$]+\$|\$\$[\s\S]+?\$\$/.test(textHtml)) {
            try { textHtml = await renderMath(textHtml); }
            catch (e) { console.warn('Math render failed:', e); hasUnrenderedMath = true; }
          } else if (/\$[^$]+\$|\$\$[\s\S]+?\$\$/.test(textHtml)) {
            hasUnrenderedMath = true;
          }
          inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;font-family:${el.fontFamily || ps.fontFamily};font-weight:${ps.fontWeight};font-style:${ps.fontStyle};font-size:${el.fontSize || ps.fontSize}px;color:${el.color || ps.color};line-height:1.3;padding:8px 12px;overflow:hidden;">${textHtml}</div>`;
          break;
        }
        case 'image': {
          const imgSrc = await getImageDataUrl(el.src);
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
            const demoHtml = await readTextFile(el.src);
            const escaped = htmlEscapeForSrcdoc(demoHtml);
            inner += `<iframe srcdoc="${escaped}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;border:none;" sandbox="allow-scripts allow-same-origin"></iframe>`;
          } catch (e) { console.error('Demo export failed:', e); }
          break;
        case 'demo-piece':
          demoPieceSrcs.add(el.demoSrc);
          try {
            const demoHtml = await readTextFile(el.demoSrc);
            const channelKey = `slide${i}-${el.demoSrc.replace(/[^a-z0-9]/gi, '')}`;
            const pieceHtml = injectDemoBootstrap(demoHtml, `#piece=${el.piece}`, channelKey);
            const escaped = htmlEscapeForSrcdoc(pieceHtml);
            inner += `<iframe srcdoc="${escaped}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;border:none;" sandbox="allow-scripts allow-same-origin"></iframe>`;
          } catch (e) { console.error('Demo piece export failed:', e); }
          break;
        case 'cover':
          inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;background:${el.color || '#ffffff'};"></div>`;
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
    slideHtml.push(`<div class="slide" data-index="${i}">${inner}</div>`);
  }

  // If math wasn't pre-rendered, include MathJax CDN as a fallback
  const mathjaxCDN = hasUnrenderedMath ? `<script>
window.MathJax = {
  tex: { inlineMath: [['$', '$']], displayMath: [['$$', '$$']] },
  svg: { fontCache: 'global' },
  startup: { typeset: true }
};
</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js" async></script>` : '';

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
@import url('https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400&family=PT+Sans+Narrow:wght@400;700&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #000; overflow: hidden; font-family: 'PT Sans', sans-serif; }
#viewport { width: 100vw; height: 100vh; display: flex; justify-content: center; align-items: flex-start; }
.slide {
  width: ${W}px; height: ${H}px; background: #fff; position: relative; overflow: hidden;
  transform-origin: top left; display: none;
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
</style>
${mathjaxCDN}
</head>
<body>
<div id="viewport">
${slideHtml.join('\n')}
</div>
<!-- eigendeck-source: ${sourceB64} -->
<script>
const slides = document.querySelectorAll('.slide');
let current = 0;
const W = ${W}, H = ${H};
function show(i) {
  slides.forEach((s, idx) => s.classList.toggle('active', idx === i));
  resize();
  current = i;
}
function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(vw / W, vh / H);
  const s = slides[current];
  if (!s) return;
  s.style.transform = 'scale(' + scale + ')';
  const wrapper = document.getElementById('viewport');
  wrapper.style.paddingTop = Math.max(0, (vh - H * scale) / 2) + 'px';
}
show(0);
window.addEventListener('resize', resize);
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault(); if (current < slides.length - 1) show(current + 1);
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault(); if (current > 0) show(current - 1);
  }
  if (e.key === 'Home') { e.preventDefault(); show(0); }
  if (e.key === 'End') { e.preventDefault(); show(slides.length - 1); }
});
</script>
</body>
</html>`;
}
