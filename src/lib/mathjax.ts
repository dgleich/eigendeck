/**
 * MathJax integration for Eigendeck.
 *
 * Loads one MathJax bundle at a time (window.MathJax is a singleton). The
 * bundle id is chosen per render call based on the surrounding font. When a
 * different bundle is requested, the loader swaps: unloads the current one
 * and reloads the new bundle's script. Loading takes ~1-2s on cold cache.
 *
 * NOTE on per-preset math fonts: ideally math in a title element would use
 * the title's math font. With the singleton constraint, achieving that
 * requires either (a) bundle-switching per-element with caching of rendered
 * SVGs, or (b) iframe isolation for each font. Neither is implemented yet —
 * for now, all math on a slide uses the bundle currently loaded (effectively
 * the body font). Per-preset rendering tracked in a future issue.
 */

import { resolveFontPackage } from './fonts';

let activeBundleId: string | null = null;
let mathjaxPromise: Promise<any> | null = null;
let mathjaxReady = false;
let workerStubInstalled = false;

function installWorkerStub() {
  if (workerStubInstalled) return;
  workerStubInstalled = true;

  // Suppress blob: URL errors (BrowserAdaptor Worker)
  window.addEventListener('error', (e) => {
    if (e.filename?.startsWith('blob:')) e.preventDefault();
  });

  // Stub blob Workers (BrowserAdaptor / SRE creates one via blob: URL,
  // which Tauri's WebKit blocks).
  const OrigWorker = window.Worker;
  (window as any).Worker = function FakeWorker(url: string | URL) {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      const fake = {
        postMessage(data: any) {
          setTimeout(() => { if (fake.onmessage) fake.onmessage({ data: { id: data?.id, result: '' } } as any); }, 0);
        },
        terminate() {}, onmessage: null as any, onerror: null as any,
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
      };
      return fake;
    }
    return new OrigWorker(url);
  };
}

function unloadCurrentBundle(): void {
  // Remove the previous bundle's <script> tag so reloads work consistently.
  for (const s of Array.from(document.querySelectorAll('script[data-mathjax-bundle]'))) {
    s.remove();
  }
  // Clear MathJax singleton so the new bundle can install fresh state.
  delete (window as any).MathJax;
  // Forget the old promise; next loadMathJax call starts a new one.
  mathjaxPromise = null;
  mathjaxReady = false;
  activeBundleId = null;
  // Clear preamble cache (the next bundle won't have applied it)
  appliedPreamble = '';
}

/**
 * Load a MathJax bundle. If `bundleId` differs from the currently loaded
 * bundle, the previous one is unloaded and the new one is loaded.
 *
 * @param bundleId Font package id (see src/lib/fonts.ts). If omitted, uses
 *   the currently-loaded bundle, or 'ptsans' if none is loaded.
 */
export function loadMathJax(bundleId?: string): Promise<any> {
  const desired = bundleId ?? activeBundleId ?? 'ptsans';

  if (mathjaxReady && activeBundleId === desired) {
    return Promise.resolve((window as any).MathJax);
  }
  if (mathjaxPromise && activeBundleId === desired) return mathjaxPromise;

  // Either no bundle loaded yet, or a different bundle is loaded — (re)load.
  if (activeBundleId && activeBundleId !== desired) {
    unloadCurrentBundle();
  }

  installWorkerStub();
  activeBundleId = desired;

  const pkg = resolveFontPackage(desired);
  const bundleUrl = `/mathjax/${pkg.mathjaxBundle}`;

  mathjaxPromise = new Promise((resolve, reject) => {
    (window as any).MathJax = {
      tex: {
        inlineMath: [['$', '$']],
        displayMath: [['$$', '$$']],
      },
      svg: { fontCache: 'none' },
      startup: {
        typeset: false,
        ready: () => {
          const MJ = (window as any).MathJax;
          MJ.startup.defaultReady();
          MJ.startup.promise.then(() => {
            mathjaxReady = true;
            resolve(MJ);
          });
        },
      },
    };

    const script = document.createElement('script');
    script.src = bundleUrl;
    script.async = true;
    script.setAttribute('data-mathjax-bundle', desired);
    script.onerror = () => reject(new Error(`Failed to load MathJax bundle: ${bundleUrl}`));
    document.head.appendChild(script);
  });

  return mathjaxPromise;
}

/** Get the id of the currently loaded MathJax bundle, or null if none. */
export function activeMathBundleId(): string | null {
  return activeBundleId;
}

/**
 * Render math in an HTML string.
 * Finds $...$ and $$...$$ and converts each to SVG.
 */
// Cache of rendered display math heights: tex string → height string (e.g. "2.5ex")
const displayMathHeights = new Map<string, string>();

export function getDisplayMathHeight(tex: string): string | undefined {
  return displayMathHeights.get(tex);
}

// Track whether preamble has been applied (per loaded bundle)
let appliedPreamble = '';

export async function applyMathPreamble(preamble: string, bundleId?: string): Promise<void> {
  if (!preamble || preamble === appliedPreamble) return;
  const MJ = await loadMathJax(bundleId);
  try {
    MJ.texReset();
    // Render preamble to register \newcommand, \def, etc.
    await Promise.race([
      MJ.tex2svgPromise(`{${preamble}}`, { display: false }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('preamble timeout')), 3000)),
    ]);
    appliedPreamble = preamble;
  } catch (e) {
    console.warn('MathJax preamble error:', e);
  }
}

// Unescape HTML entities in tex strings extracted from innerHTML
function unescapeHtml(s: string): string {
  return s.replace(/&nbsp;/g, ' ').replace(/ /g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export async function renderMathInHtml(html: string, bundleId?: string): Promise<string> {
  if (!containsMath(html)) return html;

  const MJ = await loadMathJax(bundleId);
  const parts: string[] = [];
  let i = 0;

  while (i < html.length) {
    // Skip HTML tags
    if (html[i] === '<') {
      const tagEnd = html.indexOf('>', i);
      if (tagEnd !== -1) {
        parts.push(html.slice(i, tagEnd + 1));
        i = tagEnd + 1;
        continue;
      }
    }

    // Display math $$...$$
    if (html[i] === '$' && html[i + 1] === '$') {
      const end = html.indexOf('$$', i + 2);
      if (end !== -1) {
        const tex = unescapeHtml(html.slice(i + 2, end));
        try {
          MJ.texReset();
          const container = await Promise.race([
            MJ.tex2svgPromise(`{${tex}}`, { display: true }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
          ]);
          const container2 = container as HTMLElement;
          // Check for MathJax errors (undefined commands, syntax errors)
          const errNode = container2.querySelector('mjx-container [data-mjx-error]') || container2.querySelector('[data-mml-node="merror"]');
          if (errNode) {
            const errMsg = errNode.getAttribute('data-mjx-error') || errNode.textContent || 'LaTeX error';
            console.warn(`MathJax error in display math: ${errMsg}\nTeX: ${tex}`);
            parts.push(`<div style="text-align:center;color:#dc2626;background:#fef2f2;border:1px solid #fca5a5;border-radius:4px;padding:8px;font-size:16px;font-family:monospace;">MathJax: ${errMsg}</div>`);
          } else {
            const svg = container2.querySelector('svg');
            if (svg) {
              const svgHeight = svg.getAttribute('height') || '';
              if (svgHeight) displayMathHeights.set(tex, svgHeight);
              parts.push(`<div style="text-align:center;">${svg.outerHTML}</div>`);
            } else {
              parts.push(`$$${tex}$$`);
            }
          }
        } catch (e) {
          console.warn('MathJax render failed for display math:', tex, e);
          parts.push(`<div style="color:#dc2626;font-size:14px;font-family:monospace;">$$${tex}$$ (render failed)</div>`);
        }
        i = end + 2;
        continue;
      }
    }

    // Inline math $...$
    if (html[i] === '$') {
      const end = html.indexOf('$', i + 1);
      if (end !== -1 && !html.slice(i + 1, end).includes('\n')) {
        const tex = unescapeHtml(html.slice(i + 1, end));
        try {
          MJ.texReset();
          const container = await Promise.race([
            MJ.tex2svgPromise(`{${tex}}`, { display: false }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
          ]);
          const container2 = container as HTMLElement;
          const errNode = container2.querySelector('mjx-container [data-mjx-error]') || container2.querySelector('[data-mml-node="merror"]');
          if (errNode) {
            const errMsg = errNode.getAttribute('data-mjx-error') || errNode.textContent || 'LaTeX error';
            console.warn(`MathJax error in inline math: ${errMsg}\nTeX: ${tex}`);
            parts.push(`<span style="color:#dc2626;background:#fef2f2;border:1px solid #fca5a5;border-radius:2px;padding:1px 4px;font-size:0.8em;font-family:monospace;" title="${tex}">MathJax: ${errMsg}</span>`);
          } else {
            const svg = container2.querySelector('svg');
            if (svg) {
              const vAlign = svg.style.verticalAlign || '-0.025ex';
              svg.style.display = 'inline';
              svg.style.verticalAlign = vAlign;
              parts.push(svg.outerHTML);
            } else {
              parts.push(`$${tex}$`);
            }
          }
        } catch (e) {
          console.warn('MathJax render failed for inline math:', tex, e);
          parts.push(`<span style="color:#dc2626;font-family:monospace;">$${tex}$ (error)</span>`);
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

export async function typesetElement(element: HTMLElement, preamble?: string, bundleId?: string): Promise<void> {
  if (preamble) await applyMathPreamble(preamble, bundleId);

  const rawHtml = element.getAttribute('data-raw') || element.innerHTML;
  try {
    // Immediately hide $$...$$ blocks to prevent wrapping flash
    element.setAttribute('data-raw', rawHtml);
    element.innerHTML = rawHtml
      .replace(/\$\$([\s\S]+?)\$\$/g, '<div style="text-align:center;color:#999;font-style:italic;white-space:nowrap;overflow:hidden;">⋯</div>')
      .replace(/\$([^\$\n]+?)\$/g, '<span style="color:#999;font-style:italic;">⋯</span>');

    const rendered = await renderMathInHtml(rawHtml, bundleId);
    element.innerHTML = rendered;
  } catch (e) {
    console.error('typesetElement error:', e);
    element.innerHTML = rawHtml;
  }
}

export function resetMathElement(element: HTMLElement, rawHtml: string): void {
  element.removeAttribute('data-raw');
  element.innerHTML = rawHtml;
}

export function containsMath(text: string): boolean {
  return /\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$/.test(text);
}
