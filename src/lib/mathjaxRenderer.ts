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
 *
 * # Debugging
 *
 * The iframe (public/mathjax-renderer.html) has a dbg(msg) function that
 * routes log lines back to the parent via postMessage {type:'log'}. We
 * surface those here as console.warn entries prefixed
 * `[mathjaxRenderer/iframe <bundle>]` — so iframe-side issues are visible
 * in the main page's devtools without context-switching.
 *
 * Currently dbg() is only invoked for unexpected events (errors, missing
 * SVG, preamble failures). When debugging a regression, temporarily add
 * dbg() calls in the success paths inside mathjax-renderer.html (look for
 * the comments next to the existing calls).
 */

import { resolveFontPackage } from './fonts';

/**
 * Stable cache key for (tex, bundle, display, preamble). The same string is
 * used both in-memory (pool.cache) and in the SQLite math_cache table, so
 * the CLI exporter can look up SVGs the editor already produced.
 */
export function mathCacheKey(tex: string, bundle: string, display: boolean, preamble: string): string {
  // FNV-1a hash — small, deterministic, good enough for cache keys (collisions
  // are functionally fine because we'd just re-render).
  let h = 0x811c9dc5;
  const s = `${bundle}\x1f${display ? 'd' : 'i'}\x1f${preamble}\x1f${tex}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Tauri invoke is dynamically imported so this module also runs in non-Tauri
// test/CLI contexts. Persistence is best-effort — failures are silenced so
// they don't break rendering.
type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let _invoke: InvokeFn | null | undefined = undefined;
async function getInvoke(): Promise<InvokeFn | null> {
  if (_invoke !== undefined) return _invoke;
  try {
    const mod = await import('@tauri-apps/api/core');
    _invoke = mod.invoke as InvokeFn;
  } catch { _invoke = null; }
  return _invoke;
}

async function persistToSqlite(key: string, tex: string, bundle: string, display: boolean, preamble: string, r: RenderResult) {
  const invoke = await getInvoke();
  if (!invoke) return;
  try {
    await invoke('db_put_math_svg', {
      key, tex, bundle, display, preamble,
      svg: r.svg, width: r.width || null, height: r.height || null, valign: r.valign || null,
    });
  } catch { /* cache write failure shouldn't break rendering */ }
}

/** One-time best-effort: load all cached SVGs from SQLite into the in-memory pool caches. */
let warmCacheLoaded = false;
export async function warmMathCacheFromSqlite(): Promise<number> {
  if (warmCacheLoaded) return 0;
  warmCacheLoaded = true;
  const invoke = await getInvoke();
  if (!invoke) return 0;
  try {
    const rows = await invoke<Array<{ key: string; tex: string; bundle: string; display: boolean; preamble: string; svg: string; width: string | null; height: string | null; valign: string | null }>>(
      'db_load_math_cache'
    );
    for (const row of rows) {
      const pool = getOrCreatePool(row.bundle);
      pool.cache.set(row.key, {
        svg: row.svg,
        width: row.width || '',
        height: row.height || '',
        valign: row.valign || '',
      });
    }
    return rows.length;
  } catch { return 0; }
}

/** Reset the warm-cache flag — call after opening a different .eigendeck file. */
export function resetMathCacheWarmupFlag(): void {
  warmCacheLoaded = false;
  // Also clear in-memory pool caches so they don't bleed across files.
  for (const pool of pools.values()) pool.cache.clear();
}

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
  appliedPreamble: string;           // last preamble we sent to this iframe
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
    if (msg.type === 'log') {
      // Echo iframe-side dbg() messages. Iframe only sends these for
      // unexpected events (errors, missing SVG, preamble failures); they
      // surface here as console warnings so they're visible without opening
      // the iframe context in devtools.
      console.warn(`[mathjaxRenderer/iframe ${msg.bundle}]`, msg.msg);
      return;
    }
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

  const pkg = resolveFontPackage(bundleId);
  const iframe = document.createElement('iframe');
  iframe.src = `/mathjax-renderer.html?bundle=${encodeURIComponent(bundleId)}&file=${encodeURIComponent(pkg.mathjaxBundle)}`;
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
        console.warn('[mathjaxRenderer] bundle load failed:', bundleId, msg.message);
        window.removeEventListener('message', readyHandler);
        reject(new Error(msg.message || 'bundle load failed'));
      }
    };
    window.addEventListener('message', readyHandler);
    iframe.addEventListener('error', (e) => {
      console.warn('[mathjaxRenderer] iframe load error:', bundleId, e);
    });
    setTimeout(() => {
      window.removeEventListener('message', readyHandler);
      reject(new Error(`MathJax bundle '${bundleId}' load timed out`));
    }, 30000);
  });

  pool = { iframe, ready, pending: new Map(), cache: new Map(), appliedPreamble: '' };
  pools.set(bundleId, pool);
  document.body.appendChild(iframe);
  return pool;
}

/**
 * Render a tex string with the given bundle. Returns the SVG markup.
 * Cached by (bundle, tex, display).
 */
/**
 * Set the math preamble for a bundle's iframe. Idempotent — only forwards
 * if it differs from what was last applied.
 */
export async function setMathPreamble(preamble: string, bundleId: string): Promise<void> {
  const pool = getOrCreatePool(bundleId);
  if (pool.appliedPreamble === preamble) return;
  await pool.ready;
  pool.appliedPreamble = preamble;
  pool.iframe.contentWindow?.postMessage({ type: 'preamble', tex: preamble }, '*');
  // NOTE: we do NOT clear pool.cache here. The cache key already includes the
  // preamble (mathCacheKey(tex, bundle, display, preamble)), so entries are
  // namespaced by preamble and can never be served for a different one — a
  // render with a new preamble computes a different key and misses cleanly.
  // The old clear() wiped VALID entries, including the SVGs warmed from SQLite
  // (warmMathCacheFromSqlite) on the cold presenter window — which then
  // re-rendered live, hit the 5s timeout on complex display math, and spilled
  // the raw LaTeX. Keeping the cache means the persisted SVGs are actually used.
}

export async function renderMath(
  tex: string,
  bundleId: string,
  display: boolean = false,
  preamble?: string,
): Promise<RenderResult> {
  const pool = getOrCreatePool(bundleId);
  // Apply preamble before any render call (if needed).
  if (preamble && pool.appliedPreamble !== preamble) {
    await setMathPreamble(preamble, bundleId);
  }
  const effectivePreamble = preamble || '';
  const cacheKey = mathCacheKey(tex, bundleId, display, effectivePreamble);
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
  // Write-through to SQLite so headless tools (CLI export) can find it.
  void persistToSqlite(cacheKey, tex, bundleId, display, effectivePreamble, result);
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
export async function renderMathInHtml(html: string, bundleId: string, preamble?: string): Promise<string> {
  if (!containsMath(html)) return html;
  if (preamble) {
    try { await setMathPreamble(preamble, bundleId); } catch (e) { console.warn('preamble apply failed:', e); }
  }

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
          // Inject inline display styles + overflow="visible" attribute so
          // italic-glyph ink (e.g. \gamma) isn't clipped at the SVG box.
          const svg = r.svg.replace(
            /^<svg/,
            `<svg overflow="visible" style="display:inline;vertical-align:${valign};overflow:visible"`
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
