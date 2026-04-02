/**
 * MathJax integration for Eigendeck.
 *
 * Uses the custom mathjax-ptsans-font build which matches PT Sans.
 * Renders LaTeX as inline SVG via MathJax's tex2svg API.
 *
 * Approach: we do NOT use MathJax's DOM typesetting (typesetPromise).
 * Instead, we find $...$ and $$...$$ in the text, convert each to SVG
 * using tex2svgPromise, and build the HTML ourselves. This avoids
 * MathJax's internal DOM state tracking which breaks on re-typesetting.
 *
 * Conventions:
 *   $...$   — inline math
 *   $$...$$ — display (block) math
 */

let mathjaxPromise: Promise<any> | null = null;
let mathjaxReady = false;

export function loadMathJax(): Promise<any> {
  if (mathjaxReady) return Promise.resolve((window as any).MathJax);
  if (mathjaxPromise) return mathjaxPromise;

  mathjaxPromise = new Promise((resolve, reject) => {
    (window as any).MathJax = {
      tex: {
        inlineMath: [['$', '$']],
        displayMath: [['$$', '$$']],
      },
      svg: {
        fontCache: 'local',
      },
      startup: {
        typeset: false,
        ready: () => {
          const MJ = (window as any).MathJax;
          MJ.startup.defaultReady();
          MJ.startup.promise.then(() => {
            mathjaxReady = true;
            console.log('MathJax ready');
            resolve(MJ);
          });
        },
      },
    };

    const script = document.createElement('script');
    script.src = '/mathjax/tex-mml-svg-mathjax-ptsans.js';
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load MathJax'));
    document.head.appendChild(script);
  });

  return mathjaxPromise;
}

/**
 * Process an HTML string: find $...$ and $$...$$ segments,
 * convert each to SVG, return new HTML with math replaced by SVGs.
 */
export async function renderMathInHtml(html: string): Promise<string> {
  if (!containsMath(html)) return html;

  try {
    const MJ = await loadMathJax();
    let result = '';
    let i = 0;

    while (i < html.length) {
      // Check for display math $$...$$
      if (html[i] === '$' && html[i + 1] === '$') {
        const end = html.indexOf('$$', i + 2);
        if (end !== -1) {
          const tex = html.slice(i + 2, end);
          try {
            const node = await MJ.tex2svgPromise(tex, { display: true });
            const svg = node.querySelector('svg');
            if (svg) {
              result += `<div style="text-align:center;margin:16px 0;">${svg.outerHTML}</div>`;
            } else {
              result += html.slice(i, end + 2);
            }
          } catch {
            result += html.slice(i, end + 2);
          }
          i = end + 2;
          continue;
        }
      }

      // Check for inline math $...$
      if (html[i] === '$' && html[i + 1] !== '$') {
        // Don't match inside HTML tags
        const end = html.indexOf('$', i + 1);
        if (end !== -1 && !html.slice(i + 1, end).includes('\n')) {
          const tex = html.slice(i + 1, end);
          try {
            const node = await MJ.tex2svgPromise(tex, { display: false });
            const svg = node.querySelector('svg');
            if (svg) {
              // Inline: set vertical-align to match text baseline
              svg.style.verticalAlign = 'middle';
              result += svg.outerHTML;
            } else {
              result += html.slice(i, end + 1);
            }
          } catch {
            result += html.slice(i, end + 1);
          }
          i = end + 1;
          continue;
        }
      }

      // Regular character — but skip inside HTML tags
      if (html[i] === '<') {
        const tagEnd = html.indexOf('>', i);
        if (tagEnd !== -1) {
          result += html.slice(i, tagEnd + 1);
          i = tagEnd + 1;
          continue;
        }
      }

      result += html[i];
      i++;
    }

    return result;
  } catch (e) {
    console.error('MathJax renderMathInHtml failed:', e);
    return html;
  }
}

/**
 * Render math in a DOM element by replacing its innerHTML.
 * Safe to call multiple times — processes from the raw source each time.
 */
export async function typesetElement(element: HTMLElement): Promise<void> {
  // Store raw HTML on first call, use it for subsequent calls
  if (!element.hasAttribute('data-raw-html')) {
    element.setAttribute('data-raw-html', element.innerHTML);
  }
  const raw = element.getAttribute('data-raw-html') || element.innerHTML;
  const rendered = await renderMathInHtml(raw);
  element.innerHTML = rendered;
}

/**
 * Reset an element so typesetElement will re-process from scratch.
 */
export function resetMathElement(element: HTMLElement, rawHtml: string): void {
  element.removeAttribute('data-raw-html');
  element.innerHTML = rawHtml;
}

export function containsMath(text: string): boolean {
  return /\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$/.test(text);
}
