/**
 * MathJax integration for Eigendeck.
 *
 * Uses tex2svgPromise with the custom PT Sans math font.
 * SRE (speech rule engine) is disabled because it uses web workers
 * loaded via blob: URLs which Tauri's webview blocks.
 */

let mathjaxPromise: Promise<any> | null = null;
let mathjaxReady = false;

export function loadMathJax(): Promise<any> {
  if (mathjaxReady) return Promise.resolve((window as any).MathJax);
  if (mathjaxPromise) return mathjaxPromise;

  mathjaxPromise = new Promise((resolve, reject) => {
    // Suppress blob: URL errors from MathJax SRE worker
    window.addEventListener('error', (e) => {
      if (e.filename?.startsWith('blob:')) {
        e.preventDefault();
      }
    });

    (window as any).MathJax = {
      tex: {
        inlineMath: [['$', '$']],
        displayMath: [['$$', '$$']],
      },
      svg: {
        fontCache: 'none',
      },
      options: {
        enableAssistiveMml: false,
        enableEnrichment: false,  // disable SRE enrichment (uses blob worker)
        enableSpeech: false,      // disable SRE speech (uses blob worker)
        sre: {
          speech: 'none',
        },
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
 * Render math in an HTML string using tex2svgPromise.
 */
export async function renderMathInHtml(html: string): Promise<string> {
  if (!containsMath(html)) return html;

  const MJ = await loadMathJax();
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
        const tex = html.slice(i + 2, end);
        try {
          const container = await MJ.tex2svgPromise(tex, { display: true });
          const svg = container.querySelector('svg');
          if (svg) {
            parts.push(`<div style="text-align:center;margin:16px 0;">${svg.outerHTML}</div>`);
          } else {
            parts.push(`$$${tex}$$`);
          }
        } catch (e) {
          console.error('MathJax display error:', e);
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
          console.error('MathJax inline error:', e);
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

export async function typesetElement(element: HTMLElement): Promise<void> {
  const rawHtml = element.getAttribute('data-raw') || element.innerHTML;
  try {
    const rendered = await renderMathInHtml(rawHtml);
    element.setAttribute('data-raw', rawHtml);
    element.innerHTML = rendered;
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
