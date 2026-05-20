// Shared math expression walker. Mirrors renderMathInHtml in
// src/lib/mathjaxRenderer.ts EXACTLY: skip inside tags, $$..$$ for display
// math, $..$ for inline (with newline guard). The (tex, bundle, display)
// tuple a batch action computes must match what the editor stored —
// that depends on byte-identical tex extraction here.

export function* extractMath(html: string): Generator<[string, boolean]> {
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end !== -1) { i = end + 1; continue; }
    }
    if (html[i] === '$' && html[i + 1] === '$') {
      const end = html.indexOf('$$', i + 2);
      if (end !== -1) { yield [html.slice(i + 2, end), true]; i = end + 2; continue; }
    }
    if (html[i] === '$') {
      const end = html.indexOf('$', i + 1);
      if (end !== -1 && !html.slice(i + 1, end).includes('\n')) {
        yield [html.slice(i + 1, end), false]; i = end + 1; continue;
      }
    }
    i++;
  }
}
