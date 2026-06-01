// Renders a single Jupyter cell output (stream, display_data,
// execute_result, error).
//
// MIME bundle preference order: image/png → image/svg+xml →
// text/html → text/plain. Matches what Jupyter Lab does.
//
// HTML output is rendered with dangerouslySetInnerHTML for now.
// Real notebook HTML output (pandas DataFrames, plotly, etc.) is
// fully trusted in JupyterLab itself; our user is choosing to
// embed THEIR notebook, so the threat model isn't "arbitrary HTML
// from a stranger." A sanitization layer can be added later if we
// ever embed notebooks from untrusted sources.

import { CellOutput as CellOutputT, MimeBundle, joinMultiline } from '../../lib/notebookFormat';

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
    const svg = joinMultiline(bundle['image/svg+xml']);
    return <div className="nb-output nb-image" dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  if (bundle['text/html']) {
    const html = joinMultiline(bundle['text/html']);
    return <div className="nb-output nb-html" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  if (bundle['text/plain']) {
    return <pre className="nb-output nb-plain">{joinMultiline(bundle['text/plain'])}</pre>;
  }
  return null;
}

// Strip ANSI color codes from tracebacks — Jupyter's tracebacks come
// with ANSI escape sequences (\x1b[...m). Renderers that want color
// can parse these; for v1 we just remove them.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
