// Lazy-loaded syntax highlighter for notebook code cells.
//
// highlight.js is imported via its 'common' subset (~75 KB
// minified), which covers Python / Julia / R / JS / TS / C / C++ /
// Rust / Bash / Go / SQL / Java / Kotlin / Swift / etc. — every
// kernel a CS/HPC professor is realistically going to demo. Niche
// languages render as plain text rather than fail.
//
// The module-level promise is shared across every notebook cell in
// the app so the lib loads exactly once on the first highlight call.

type HighlightFn = (code: string, lang: string) => string;

let highlighterPromise: Promise<HighlightFn> | null = null;

function loadHighlighter(): Promise<HighlightFn> {
  if (!highlighterPromise) {
    highlighterPromise = import('highlight.js/lib/common').then((mod) => {
      const hljs = mod.default;
      return (code: string, lang: string): string => {
        const language = mapKernelLanguage(lang);
        if (language && hljs.getLanguage(language)) {
          try {
            return hljs.highlight(code, { language, ignoreIllegals: true }).value;
          } catch {
            // fall through to plain text on highlighter errors
          }
        }
        // No known grammar — escape and return as-is so the cell
        // still renders, just unhighlighted.
        return escapeHtml(code);
      };
    });
  }
  return highlighterPromise;
}

/** Map a kernelspec language to a highlight.js grammar id. */
function mapKernelLanguage(lang: string): string | null {
  if (!lang) return null;
  const l = lang.toLowerCase();
  // Direct hits — highlight.js's id matches the kernelspec field.
  if (['python', 'julia', 'r', 'javascript', 'typescript', 'java',
       'kotlin', 'swift', 'rust', 'go', 'cpp', 'c', 'sql', 'bash',
       'json', 'yaml', 'xml', 'css', 'scss', 'php', 'ruby'].includes(l)) {
    return l;
  }
  // Common alternate names.
  if (l === 'shell' || l === 'sh') return 'bash';
  if (l === 'c++' || l === 'cxx') return 'cpp';
  if (l === 'js') return 'javascript';
  if (l === 'ts') return 'typescript';
  // R kernels sometimes report 'R' uppercase or 'ir' (IRkernel).
  if (l === 'ir') return 'r';
  // Julia kernels are usually 'julia'; nothing extra to do.
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Highlight `code` for the given kernel language. Lazy-loads the
 *  highlighter on first call. Returns a Promise of HTML; render
 *  with dangerouslySetInnerHTML. */
export async function highlightCode(code: string, kernelLanguage: string | null): Promise<string> {
  if (!kernelLanguage) return escapeHtml(code);
  const fn = await loadHighlighter();
  return fn(code, kernelLanguage);
}
