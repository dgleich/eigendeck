/**
 * MathJax integration for Eigendeck.
 *
 * Uses the custom mathjax-ptsans-font build which matches PT Sans.
 * Renders LaTeX as inline SVG via MathJax's SVG output.
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
 * Typeset all math in a DOM element.
 *
 * Strategy: wipe the element, insert a fresh inner div with the raw HTML,
 * and typeset that. This avoids MathJax's internal state tracking issues
 * when re-typesetting the same element.
 */
export async function typesetElement(element: HTMLElement): Promise<void> {
  try {
    const MJ = await loadMathJax();
    const rawHtml = element.getAttribute('data-raw-html');
    if (rawHtml !== null) {
      // Re-render from stored raw source
      element.innerHTML = rawHtml;
    }

    // Store the raw HTML before MathJax modifies it
    element.setAttribute('data-raw-html', element.innerHTML);

    // Clear any previous MathJax state
    MJ.typesetClear([element]);

    // Typeset
    await MJ.typesetPromise([element]);
  } catch (e) {
    console.error('MathJax typeset error:', e);
  }
}

/**
 * Convert a LaTeX string to SVG HTML string (for export).
 */
export async function tex2svg(tex: string, display = false): Promise<string> {
  try {
    const MJ = await loadMathJax();
    const node = await MJ.tex2svgPromise(tex, { display });
    return node.outerHTML;
  } catch (e) {
    console.error('MathJax tex2svg failed:', e);
    return tex;
  }
}

/**
 * Check if a string contains LaTeX math delimiters.
 */
export function containsMath(text: string): boolean {
  return /\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$/.test(text);
}
