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

/**
 * Load MathJax if not already loaded.
 * Returns a promise that resolves when MathJax is ready.
 */
export function loadMathJax(): Promise<any> {
  if (mathjaxReady) return Promise.resolve((window as any).MathJax);
  if (mathjaxPromise) return mathjaxPromise;

  mathjaxPromise = new Promise((resolve, reject) => {
    // Configure MathJax before loading the script
    (window as any).MathJax = {
      tex: {
        inlineMath: [['$', '$']],
        displayMath: [['$$', '$$']],
      },
      svg: {
        fontCache: 'local',
      },
      startup: {
        typeset: false, // We'll typeset manually
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
    script.src = '/mathjax/tex-mml-svg-mathjax-ptsans.js';
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load MathJax'));
    document.head.appendChild(script);
  });

  return mathjaxPromise;
}

/**
 * Typeset all math in a DOM element.
 * Call this after updating innerHTML that might contain $...$ or $$...$$.
 */
export async function typesetElement(element: HTMLElement): Promise<void> {
  try {
    const MJ = await loadMathJax();
    // Clear MathJax's internal document state for this element
    MJ.typesetClear([element]);
    await MJ.typesetPromise([element]);
  } catch (e) {
    console.error('MathJax typeset failed:', e);
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
