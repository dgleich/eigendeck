/**
 * MathJax integration for Eigendeck.
 *
 * Uses the custom mathjax-ptsans-font build which matches PT Sans.
 * Uses typesetPromise for DOM-based rendering (tex2svg not available
 * in this bundle).
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
            console.log('MathJax ready, available methods:', Object.keys(MJ).join(', '));
            resolve(MJ);
          });
        },
      },
    };

    const script = document.createElement('script');
    script.src = '/mathjax/tex-mml-svg-mathjax-ptsans.js';
    script.async = true;
    script.onload = () => console.log('MathJax script loaded');
    script.onerror = (e) => {
      console.error('MathJax script failed to load', e);
      reject(new Error('Failed to load MathJax'));
    };
    document.head.appendChild(script);
  });

  return mathjaxPromise;
}

/**
 * Typeset math in an element using MathJax's typesetPromise.
 *
 * To handle re-typesetting reliably:
 * 1. Create a fresh inner wrapper div
 * 2. Copy the raw HTML into it
 * 3. Replace the element's children with the wrapper
 * 4. Typeset the wrapper (MathJax has never seen it before)
 */
export async function typesetElement(element: HTMLElement): Promise<void> {
  const rawHtml = element.getAttribute('data-raw') || element.innerHTML;
  console.log('typesetElement called, rawHtml length:', rawHtml.length, 'preview:', rawHtml.slice(0, 80));

  try {
    const MJ = await loadMathJax();

    // Create a brand new div that MathJax hasn't seen
    const wrapper = document.createElement('div');
    wrapper.innerHTML = rawHtml;
    wrapper.style.cssText = 'display:contents'; // doesn't affect layout

    // Replace element's content with the fresh wrapper
    element.innerHTML = '';
    element.appendChild(wrapper);

    // Store raw for next time
    element.setAttribute('data-raw', rawHtml);

    console.log('Calling MathJax.typesetPromise...');
    await MJ.typesetPromise([wrapper]);
    console.log('MathJax typeset complete');
  } catch (e) {
    console.error('MathJax typeset error:', e);
    // Restore raw HTML on failure
    element.innerHTML = rawHtml;
  }
}

/**
 * Reset element state for re-typesetting.
 */
export function resetMathElement(element: HTMLElement, rawHtml: string): void {
  element.removeAttribute('data-raw');
  element.innerHTML = rawHtml;
}

export function containsMath(text: string): boolean {
  return /\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$/.test(text);
}
