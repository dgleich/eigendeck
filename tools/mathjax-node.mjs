/**
 * Node MathJax renderer using @mathjax/src.
 *
 * Produces SVG output for use in the CLI export, matching what the
 * GUI editor produces (but with MathJax's default font, not PT Sans —
 * the custom font would require running the webpack bundle in Node
 * which adds significant complexity).
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let mjxPromise = null;

async function getMathJax() {
  if (mjxPromise) return mjxPromise;
  mjxPromise = (async () => {
    // MathJax 4 node entry point — sets up adaptor, handler, components
    const MathJax = require('@mathjax/src');
    const mjx = await MathJax.init({
      loader: { load: ['input/tex', 'output/svg', 'adaptors/liteDOM'] },
      tex: {
        inlineMath: [['$', '$']],
        displayMath: [['$$', '$$']],
        packages: ['base', 'ams', 'newcommand', 'configmacros', 'noundefined'],
      },
      svg: { fontCache: 'none' },
      startup: { typeset: false },
    });
    // Return both init result (has tex2svgPromise) and global (has adaptor)
    return { mjx, adaptor: MathJax.startup.adaptor };
  })();
  return mjxPromise;
}

/** Apply a math preamble (\newcommand, \def, etc.) */
export async function applyPreamble(preamble) {
  if (!preamble) return;
  const { mjx } = await getMathJax();
  try {
    await mjx.tex2svgPromise(`{${preamble}}`, { display: false });
  } catch (e) {
    console.warn('  ! Preamble registration failed:', e.message);
  }
}

/** Replace $...$ and $$...$$ in HTML with rendered SVG */
export async function renderMathInHtml(html) {
  if (!/\$/.test(html)) return html;
  const { mjx, adaptor } = await getMathJax();

  const parts = [];
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

    // Display math $$...$$
    if (html[i] === '$' && html[i + 1] === '$') {
      const end = html.indexOf('$$', i + 2);
      if (end !== -1) {
        const tex = unescapeHtml(html.slice(i + 2, end));
        try {
          const node = await mjx.tex2svgPromise(`{${tex}}`, { display: true });
          const svgHtml = adaptor.outerHTML(node);
          // Extract just the SVG (strip the mjx-container wrapper)
          const svgMatch = svgHtml.match(/<svg[\s\S]*?<\/svg>/);
          if (svgMatch) {
            parts.push(`<div style="text-align:center;">${svgMatch[0]}</div>`);
          } else {
            parts.push(`$$${tex}$$`);
          }
        } catch (e) {
          console.warn('Math render failed for:', tex.slice(0, 60), e.message);
          parts.push(`<div style="color:#dc2626;font-family:monospace;">$$${tex}$$ (error)</div>`);
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
          const node = await mjx.tex2svgPromise(`{${tex}}`, { display: false });
          const svgHtml = adaptor.outerHTML(node);
          const svgMatch = svgHtml.match(/<svg[\s\S]*?<\/svg>/);
          if (svgMatch) {
            // Make inline-friendly
            const svg = svgMatch[0].replace(/<svg /, '<svg style="display:inline;vertical-align:-0.025ex" ');
            parts.push(svg);
          } else {
            parts.push(`$${tex}$`);
          }
        } catch (e) {
          console.warn('Inline math render failed for:', tex.slice(0, 60), e.message);
          parts.push(`<span style="color:#dc2626;font-family:monospace;">$${tex}$</span>`);
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

function unescapeHtml(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
