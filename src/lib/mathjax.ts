/**
 * MathJax integration for Eigendeck.
 *
 * Uses tex2svgPromise with the custom PT Sans math font (nosre build).
 * Renders $...$ as inline SVG and $$...$$ as display SVG.
 */

let mathjaxPromise: Promise<any> | null = null;
let mathjaxReady = false;

export function loadMathJax(): Promise<any> {
  if (mathjaxReady) return Promise.resolve((window as any).MathJax);
  if (mathjaxPromise) return mathjaxPromise;

  mathjaxPromise = new Promise((resolve, reject) => {
    // Suppress blob: URL errors (BrowserAdaptor Worker)
    window.addEventListener('error', (e) => {
      if (e.filename?.startsWith('blob:')) e.preventDefault();
    });

    // Stub blob Workers (BrowserAdaptor creates one)
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

    (window as any).MathJax = {
      tex: {
        inlineMath: [['$', '$']],
        displayMath: [['$$', '$$']],
      },
      svg: {
        fontCache: 'none',
      },
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
    script.src = '/mathjax/tex-mml-svg-mathjax-ptsans.js';
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load MathJax'));
    document.head.appendChild(script);
  });

  return mathjaxPromise;
}

/**
 * Render math in an HTML string.
 * Finds $...$ and $$...$$ and converts each to SVG.
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
          MJ.texReset();
          const container = await Promise.race([
            MJ.tex2svgPromise(`{${tex}}`, { display: true }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
          ]);
          const svg = (container as HTMLElement).querySelector('svg');
          if (svg) {
            parts.push(`<div style="text-align:center;">${svg.outerHTML}</div>`);
          } else {
            parts.push(`$$${tex}$$`);
          }
        } catch {
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
          MJ.texReset();
          const container = await Promise.race([
            MJ.tex2svgPromise(`{${tex}}`, { display: false }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
          ]);
          const svg = (container as HTMLElement).querySelector('svg');
          if (svg) {
            const vAlign = svg.style.verticalAlign || '-0.025ex';
            svg.style.display = 'inline';
            svg.style.verticalAlign = vAlign;
            parts.push(svg.outerHTML);
          } else {
            parts.push(`$${tex}$`);
          }
        } catch {
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
