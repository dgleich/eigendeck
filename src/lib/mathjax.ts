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

    // Stub Worker so MathJax's blob worker creation doesn't fail.
    // MathJax's SRE creates a Worker via blob: URL. Tauri blocks blob workers.
    // The fake Worker immediately responds to any postMessage with an
    // empty result so MathJax's promise chain resolves.
    const OrigWorker = window.Worker;
    (window as any).Worker = function FakeWorker(url: string | URL) {
      if (typeof url === 'string' && url.startsWith('blob:')) {
        console.log('Intercepted blob Worker, using auto-reply stub');
        const fake = {
          postMessage(data: any) {
            // Auto-reply to any message so MathJax's task queue resolves
            console.log('Fake Worker got message:', JSON.stringify(data)?.slice(0, 100));
            setTimeout(() => {
              if (fake.onmessage) {
                fake.onmessage({ data: { id: data?.id, result: '' } } as any);
              }
            }, 0);
          },
          terminate() {},
          onmessage: null as any,
          onerror: null as any,
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() { return false; },
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

  console.log('renderMathInHtml: loading MathJax...');
  const MJ = await loadMathJax();
  console.log('renderMathInHtml: MathJax loaded, parsing html');
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
          const container = await Promise.race([
            MJ.tex2svgPromise(tex, { display: true }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('tex2svg timeout')), 2000)),
          ]);
          const svg = (container as HTMLElement).querySelector('svg');
          if (svg) {
            parts.push(`<div style="text-align:center;margin:16px 0;">${svg.outerHTML}</div>`);
          } else {
            parts.push(`$$${tex}$$`);
          }
        } catch (e) {
          console.error('MathJax display error:', e);
          try {
            const mml = MJ.tex2mml(tex, { display: true });
            parts.push(`<div style="text-align:center;margin:16px 0;">${mml}</div>`);
          } catch {
            parts.push(`$$${tex}$$`);
          }
        }
        i = end + 2;
        continue;
      }
    }

    // Inline math $...$
    if (html[i] === '$') {
      const end = html.indexOf('$', i + 1);
      console.log('Found $ at', i, 'closing $ at', end, 'content:', JSON.stringify(html.slice(i, Math.min(i + 40, html.length))));
      if (end !== -1 && !html.slice(i + 1, end).includes('\n')) {
        const tex = html.slice(i + 1, end);
        console.log('renderMathInHtml: calling tex2svgPromise for:', JSON.stringify(tex));
        try {
          // Race tex2svgPromise against a timeout since SRE Worker may hang
          const container = await Promise.race([
            MJ.tex2svgPromise(tex, { display: false }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('tex2svg timeout')), 2000)),
          ]);
          console.log('renderMathInHtml: tex2svgPromise resolved, tex was:', tex);
          const svg = (container as HTMLElement).querySelector('svg');
          if (svg) {
            // Use the MathJax-computed vertical-align for proper baseline
            const vAlign = svg.style.verticalAlign || '-0.025ex';
            svg.style.display = 'inline';
            svg.style.verticalAlign = vAlign;
            const svgWidth = svg.getAttribute('width');
            const svgViewBox = svg.getAttribute('viewBox');
            console.log('SVG width:', svgWidth, 'viewBox:', svgViewBox, 'outerHTML preview:', svg.outerHTML.slice(0, 300));
            parts.push(svg.outerHTML);
          } else {
            parts.push(`$${tex}$`);
          }
        } catch (e) {
          console.error('MathJax inline error:', e);
          // On timeout/error, try tex2mml as fallback (MathML → browser renders)
          try {
            const mml = MJ.tex2mml(tex, { display: false });
            console.log('Falling back to MathML');
            parts.push(mml);
          } catch {
            parts.push(`$${tex}$`);
          }
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
  console.log('typesetElement: starting renderMathInHtml');
  try {
    const rendered = await renderMathInHtml(rawHtml);
    console.log('typesetElement: rendered, length=', rendered.length);
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
