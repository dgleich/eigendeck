// Parse an .ipynb JSON blob into the in-memory shape we render.
// Forgiving — we ignore unknown fields rather than throwing, so future
// nbformat additions or quirky authoring tools don't break the slide.

import {
  Cell, CodeCell, CellOutput, MarkdownCell, RawCell, Notebook,
  joinMultiline,
} from './notebookFormat';

// nbformat is loosely typed; using `unknown` + narrowing rather than `any`.
function asObj(v: unknown): Record<string, unknown> | null {
  return (typeof v === 'object' && v !== null && !Array.isArray(v))
    ? v as Record<string, unknown>
    : null;
}

function parseOutput(raw: unknown): CellOutput | null {
  const o = asObj(raw);
  if (!o) return null;
  const type = String(o.output_type ?? '');
  switch (type) {
    case 'stream': {
      const name = (o.name === 'stderr') ? 'stderr' : 'stdout';
      return { kind: 'stream', name, text: joinMultiline(o.text) };
    }
    case 'display_data':
      return { kind: 'display_data', data: parseMimeBundle(o.data) };
    case 'execute_result':
      return {
        kind: 'execute_result',
        data: parseMimeBundle(o.data),
        executionCount: typeof o.execution_count === 'number' ? o.execution_count : null,
      };
    case 'error':
      return {
        kind: 'error',
        ename: String(o.ename ?? 'Error'),
        evalue: String(o.evalue ?? ''),
        traceback: Array.isArray(o.traceback) ? o.traceback.map(String) : [],
      };
    default:
      return null;
  }
}

function parseMimeBundle(raw: unknown): Record<string, string | string[]> {
  const o = asObj(raw);
  if (!o) return {};
  const out: Record<string, string | string[]> = {};
  for (const [mime, value] of Object.entries(o)) {
    // Jupyter stores text mimes as string or string[]; binary mimes (image/png,
    // application/pdf, etc.) as base64 strings. We keep both shapes — renderers
    // call joinMultiline() or use the string directly per mime type.
    if (Array.isArray(value)) out[mime] = value.map(String);
    else if (typeof value === 'string') out[mime] = value;
  }
  return out;
}

function parseCell(raw: unknown, index: number): Cell | null {
  const c = asObj(raw);
  if (!c) return null;
  const cellType = String(c.cell_type ?? '');
  const source = joinMultiline(c.source);
  switch (cellType) {
    case 'code': {
      const cell: CodeCell = {
        kind: 'code',
        index,
        source,
        executionCount: typeof c.execution_count === 'number' ? c.execution_count : null,
        outputs: Array.isArray(c.outputs)
          ? c.outputs.map(parseOutput).filter((o): o is CellOutput => o !== null)
          : [],
      };
      return cell;
    }
    case 'markdown': {
      const cell: MarkdownCell = { kind: 'markdown', index, source };
      return cell;
    }
    case 'raw': {
      const cell: RawCell = { kind: 'raw', index, source };
      return cell;
    }
    default:
      return null;
  }
}

/** Parse a .ipynb JSON document into our in-memory shape. Throws on
 *  unparseable JSON; returns a best-effort Notebook for malformed-but-
 *  JSON content (e.g. drops unknown cell types). */
export function parseNotebook(json: string | object): Notebook {
  const root = typeof json === 'string' ? JSON.parse(json) : json;
  const o = asObj(root);
  if (!o) throw new Error('notebook: top-level JSON is not an object');

  const cells = Array.isArray(o.cells)
    ? o.cells.map((c, i) => parseCell(c, i)).filter((c): c is Cell => c !== null)
    : [];

  const meta = asObj(o.metadata) ?? {};
  const kernelspec = asObj(meta.kernelspec) ?? {};
  const langInfo = asObj(meta.language_info) ?? {};
  const kernelspecName = typeof kernelspec.name === 'string' ? kernelspec.name : null;
  const kernelDisplayName = typeof kernelspec.display_name === 'string' ? kernelspec.display_name : null;
  const language =
    (typeof langInfo.name === 'string' && langInfo.name) ||
    (kernelspecName && kernelspecName.startsWith('python') ? 'python' : null) ||
    (kernelspecName === 'ir' ? 'r' : null) ||
    (kernelspecName?.startsWith('julia') ? 'julia' : null) ||
    null;

  return { cells, kernelspecName, kernelDisplayName, language };
}

/** Parse bytes (Uint8Array from db_get_asset_by_id) as a notebook. */
export function parseNotebookBytes(bytes: Uint8Array | ArrayBuffer): Notebook {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = new TextDecoder('utf-8').decode(buf);
  return parseNotebook(text);
}
