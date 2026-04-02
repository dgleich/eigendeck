/**
 * MathJax integration for Eigendeck.
 *
 * Uses tex2svgPromise to convert LaTeX to SVG nodes directly,
 * avoiding typesetPromise which hangs due to blob URL font loading
 * issues in Tauri's webview.
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
        fontCache: 'none', // disable blob font cache — causes NetworkError in Tauri
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
    script.onerror = () => {
      console.error('MathJax script failed to load');
      reject(new Error('Failed to load MathJax'));
    };
    document.head.appendChild(script);
  });

  return mathjaxPromise;
}

/**
 * Render math in an HTML string by finding $...$ and $$...$$ and
 * converting each to SVG via tex2svgPromise.
 */
export async function renderMathInHtml(html: string): Promise<string> {
  if (!containsMath(html)) return html;

  const MJ = await loadMathJax();
  const parts: string[] = [];
  let i = 0;

  while (i < html.length) {
    // Skip HTML tags entirely
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
        const tex = html.slice(i + 2, end);
        console.log('Rendering display math:', tex);
        try {
          const container = await MJ.tex2svgPromise(tex, { display: true });
          const svg = container.querySelector('svg');
          if (svg) {
            parts.push(`<div style="text-align:center;margin:16px 0;">${svg.outerHTML}</div>`);
          } else {
            parts.push(`$$${tex}$$`);
          }
        } catch (e) {
          console.error('MathJax display math error:', e);
          parts.push(`$$${tex}$$`);
        }
        i = end + 2;
        continue;
      }
    }

    // Inline math $...$
    if (html[i] === '$') {
      const end = html.indexOf('$', i + 1);
      if (end !== -1 && !html.slice(i + 1, end).includes('\n')) {
        const tex = html.slice(i + 1, end);
        console.log('Rendering inline math:', tex);
        try {
          const container = await MJ.tex2svgPromise(tex, { display: false });
          const svg = container.querySelector('svg');
          if (svg) {
            svg.style.display = 'inline';
            svg.style.verticalAlign = 'middle';
            parts.push(svg.outerHTML);
          } else {
            parts.push(`$${tex}$`);
          }
        } catch (e) {
          console.error('MathJax inline math error:', e);
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

/**
 * Typeset math in a DOM element.
 * Sets innerHTML to rendered version, stores raw in data-raw.
 */
export async function typesetElement(element: HTMLElement): Promise<void> {
  const rawHtml = element.getAttribute('data-raw') || element.innerHTML;
  console.log('typesetElement called, rawHtml:', rawHtml.slice(0, 80));

  try {
    const rendered = await renderMathInHtml(rawHtml);
    element.setAttribute('data-raw', rawHtml);
    element.innerHTML = rendered;
    console.log('typesetElement complete');
  } catch (e) {
    console.error('typesetElement error:', e);
  }
}

export function resetMathElement(element: HTMLElement, rawHtml: string): void {
  element.removeAttribute('data-raw');
  element.innerHTML = rawHtml;
}

export function containsMath(text: string): boolean {
  return /\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$/.test(text);
}
