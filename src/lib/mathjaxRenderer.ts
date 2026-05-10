/**
 * Multi-bundle MathJax renderer using hidden iframes.
 *
 * Each font package's MathJax bundle is loaded in its own iframe. The iframe
 * has its own window.MathJax (no singleton conflict). The main page sends
 * {tex, bundle} via postMessage; the iframe replies with the rendered SVG.
 *
 * This sidesteps the "only one window.MathJax at a time" limitation in
 * src/lib/mathjax.ts, allowing different math fonts in different elements
 * on the same slide.
 *
 * Each tex render is cached by (bundle, tex, display) so repeated renders
 * are ~free. First load of each bundle takes ~1-2s.
 */

interface PendingRequest {
  resolve: (svg: RenderResult) => void;
  reject: (err: Error) => void;
}

export interface RenderResult {
  svg: string;     // outer HTML of <svg>...
  width: string;   // e.g. "1.234ex"
  height: string;
  valign: string;  // e.g. "-0.025ex"
}

interface Pool {
  iframe: HTMLIFrameElement;
  ready: Promise<void>;
  pending: Map<string, PendingRequest>;
  cache: Map<string, RenderResult>;  // key = `${display}:${tex}`
}

const pools = new Map<string, Pool>();
let nextRequestId = 0;
let messageListenerInstalled = false;

function installMessageListener() {
  if (messageListenerInstalled) return;
  messageListenerInstalled = true;
  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type !== 'rendered' && msg.type !== 'error') return;
    const id = msg.id as string | undefined;
    if (!id) return;
    // Find which pool owns this request id
    for (const pool of pools.values()) {
      const pending = pool.pending.get(id);
      if (!pending) continue;
      pool.pending.delete(id);
      if (msg.type === 'rendered') {
        pending.resolve({
          svg: msg.svg, width: msg.width || '', height: msg.height || '', valign: msg.valign || '',
        });
      } else {
        pending.reject(new Error(msg.message || 'render failed'));
      }
      return;
    }
  });
}

/**
 * Lazy-create a renderer iframe for a given bundle id.
 * Returns a Pool with a ready promise that resolves when the bundle is
 * loaded and ready to accept render requests.
 */
function getOrCreatePool(bundleId: string): Pool {
  let pool = pools.get(bundleId);
  if (pool) return pool;

  installMessageListener();

  const iframe = document.createElement('iframe');
  iframe.src = `/mathjax-renderer.html?bundle=${encodeURIComponent(bundleId)}`;
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;border:0;visibility:hidden;';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('data-mathjax-bundle', bundleId);

  const ready = new Promise<void>((resolve, reject) => {
    const readyHandler = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ready' && msg.bundle === bundleId) {
        window.removeEventListener('message', readyHandler);
        resolve();
      } else if (msg.type === 'error' && !msg.id) {
        // Bundle-load error (no request id)
        window.removeEventListener('message', readyHandler);
        reject(new Error(msg.message || 'bundle load failed'));
      }
    };
    window.addEventListener('message', readyHandler);
    setTimeout(() => {
      window.removeEventListener('message', readyHandler);
      reject(new Error(`MathJax bundle '${bundleId}' load timed out`));
    }, 30000);
  });

  pool = { iframe, ready, pending: new Map(), cache: new Map() };
  pools.set(bundleId, pool);
  document.body.appendChild(iframe);
  return pool;
}

/**
 * Render a tex string with the given bundle. Returns the SVG markup.
 * Cached by (bundle, tex, display).
 */
export async function renderMath(
  tex: string,
  bundleId: string,
  display: boolean = false
): Promise<RenderResult> {
  const pool = getOrCreatePool(bundleId);
  const cacheKey = `${display ? 'd' : 'i'}:${tex}`;
  const hit = pool.cache.get(cacheKey);
  if (hit) return hit;

  await pool.ready;

  const id = `r${++nextRequestId}`;
  const result = await new Promise<RenderResult>((resolve, reject) => {
    pool.pending.set(id, { resolve, reject });
    pool.iframe.contentWindow?.postMessage({ id, type: 'render', tex, display }, '*');
    setTimeout(() => {
      if (pool.pending.has(id)) {
        pool.pending.delete(id);
        reject(new Error(`render timeout (${bundleId}): ${tex.slice(0, 40)}`));
      }
    }, 5000);
  });

  pool.cache.set(cacheKey, result);
  return result;
}

/** Returns true if any non-trivial math marker is present. */
export function containsMath(text: string): boolean {
  return /\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$/.test(text);
}

/**
 * Walk an HTML string, find $..$ and $$..$$ math expressions, render each
 * with the given bundle, and splice the resulting SVG markup back in.
 * Skips inside HTML tags (matching renderMathInHtml in src/lib/mathjax.ts).
 */
export async function renderMathInHtml(html: string, bundleId: string): Promise<string> {
  if (!containsMath(html)) return html;

  const parts: string[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const tagEnd = html.indexOf('>', i);
      if (tagEnd !== -1) {
        parts.push(html.slice(i, tagEnd + 1));
        i = tagEnd + 1;
        continue;
      }
    }

    // Display math $$..$$
    if (html[i] === '$' && html[i + 1] === '$') {
      const end = html.indexOf('$$', i + 2);
      if (end !== -1) {
        const tex = html.slice(i + 2, end);
        try {
          const { svg } = await renderMath(tex, bundleId, true);
          parts.push(`<div style="text-align:center;">${svg}</div>`);
        } catch (e) {
          console.warn('Display math render failed:', e);
          parts.push(`$$${tex}$$`);
        }
        i = end + 2;
        continue;
      }
    }

    // Inline math $..$
    if (html[i] === '$') {
      const end = html.indexOf('$', i + 1);
      if (end !== -1 && !html.slice(i + 1, end).includes('\n')) {
        const tex = html.slice(i + 1, end);
        try {
          const r = await renderMath(tex, bundleId, false);
          // Match the inline-math styling from the existing renderer
          // (vertical-align baseline tweak so it sits on the text line)
          const valign = r.valign || '-0.025ex';
          // Inject style="display:inline;vertical-align:..." into the <svg> tag
          const svg = r.svg.replace(
            /^<svg/,
            `<svg style="display:inline;vertical-align:${valign}"`
          );
          parts.push(svg);
        } catch (e) {
          console.warn('Inline math render failed:', e);
          parts.push(`$${tex}$`);
        }
        i = end + 1;
        continue;
      }
    }

    parts.push(html[i]);
    i++;
  }

  return parts.join('');
}

/** For debugging / dev: list which bundles have been loaded. */
export function loadedBundles(): string[] {
  return [...pools.keys()];
}
