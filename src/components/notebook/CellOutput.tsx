// Renders a single Jupyter cell output (stream, display_data,
// execute_result, error).
//
// MIME bundle preference order: image/png → image/svg+xml →
// text/html → text/plain. Matches what Jupyter Lab does.
//
// A .eigendeck is UNTRUSTED shared input, so notebook output can't be
// innerHTML'd raw into the privileged window (audit C-1). Routing
// (docs/NOTEBOOK-ISOLATION.md): image/svg+xml and static text/html are
// DOMPurify'd inline; text/html that carries executable content (Plotly etc.)
// is mounted in an opaque-origin sandboxed iframe, kept interactive + contained.

import { useEffect, useState } from 'react';
import { CellOutput as CellOutputT, MimeBundle, joinMultiline } from '../../lib/notebookFormat';
import { sanitizeHtml, sanitizeSvg, outputHasExecutable } from '../../lib/sanitizeHtml';
import { IsolatedOutput } from './IsolatedOutput';

export function CellOutput({ output }: { output: CellOutputT }) {
  switch (output.kind) {
    case 'stream':
      return (
        <pre className={`nb-output nb-stream nb-${output.name}`}>
          {output.text}
        </pre>
      );
    case 'display_data':
    case 'execute_result':
      return <MimeRender bundle={output.data} />;
    case 'error':
      return (
        <pre className="nb-output nb-error">
          <strong>{output.ename}</strong>: {output.evalue}
          {output.traceback.length > 0 && (
            <>{'\n'}{stripAnsi(output.traceback.join('\n'))}</>
          )}
        </pre>
      );
  }
}

function MimeRender({ bundle }: { bundle: MimeBundle }) {
  if (bundle['image/png']) {
    const b64 = typeof bundle['image/png'] === 'string'
      ? bundle['image/png']
      : bundle['image/png'].join('');
    return <img src={`data:image/png;base64,${b64}`} className="nb-output nb-image" alt="" />;
  }
  if (bundle['image/svg+xml']) {
    return <SanitizedBlock raw={joinMultiline(bundle['image/svg+xml'])} kind="svg" className="nb-output nb-image" />;
  }
  if (bundle['text/html']) {
    const html = joinMultiline(bundle['text/html']);
    // Executable output (Plotly etc.) → contained-but-interactive iframe; static
    // output (pandas tables, styled divs) → sanitized inline.
    return outputHasExecutable(html)
      ? <IsolatedOutput html={html} />
      : <SanitizedBlock raw={html} kind="html" className="nb-output nb-html" />;
  }
  if (bundle['text/plain']) {
    return <pre className="nb-output nb-plain">{joinMultiline(bundle['text/plain'])}</pre>;
  }
  return null;
}

/** Render an untrusted HTML/SVG output string, DOMPurify'd. Sanitization is async
 *  (DOMPurify is lazy-loaded), so this shows nothing for a frame then the clean
 *  markup — same async shape the notebook already has. */
function SanitizedBlock({ raw, kind, className }: { raw: string; kind: 'html' | 'svg'; className: string }) {
  const [clean, setClean] = useState('');
  useEffect(() => {
    let alive = true;
    (kind === 'svg' ? sanitizeSvg : sanitizeHtml)(raw).then((c) => { if (alive) setClean(c); });
    return () => { alive = false; };
  }, [raw, kind]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}

// Strip ANSI color codes from tracebacks — Jupyter's tracebacks come
// with ANSI escape sequences (\x1b[...m). Renderers that want color
// can parse these; for v1 we just remove them.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
