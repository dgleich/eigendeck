// Minimal in-memory representation of a Jupyter notebook (.ipynb).
// We parse only the fields we render — full nbformat spec is huge,
// and the renderer doesn't care about most of it.
//
// Reference: https://nbformat.readthedocs.io/en/latest/format_description.html
//
// One quirk worth knowing: source/text fields are EITHER a string OR
// an array of strings (Jupyter writes one-line-per-array-entry to keep
// diffs small). The parser normalizes both forms to a single string.

export type MimeBundle = Record<string, string | string[]>;

export interface CodeCell {
  kind: 'code';
  /** Stable index in the original cells[] array — used as a key and
   *  to address the cell when writing outputs/saving. */
  index: number;
  /** Cell source as a single string (newlines preserved). */
  source: string;
  /** Execution count shown in the `In [N]:` prompt. null if never run. */
  executionCount: number | null;
  outputs: CellOutput[];
}

export interface MarkdownCell {
  kind: 'markdown';
  index: number;
  source: string;
}

export interface RawCell {
  kind: 'raw';
  index: number;
  source: string;
}

export type Cell = CodeCell | MarkdownCell | RawCell;

export type CellOutput =
  | { kind: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | { kind: 'display_data'; data: MimeBundle }
  | { kind: 'execute_result'; data: MimeBundle; executionCount: number | null }
  | { kind: 'error'; ename: string; evalue: string; traceback: string[] };

export interface Notebook {
  cells: Cell[];
  /** Kernelspec name as advertised in metadata, e.g. 'python3', 'julia-1.10'.
   *  null when the .ipynb lacks metadata.kernelspec.name. The element-level
   *  kernel field overrides this; we keep it only for sensible defaults. */
  kernelspecName: string | null;
  /** Display name as written by the authoring tool, for UI hints only. */
  kernelDisplayName: string | null;
  /** Language for syntax highlighting — from metadata.language_info.name
   *  when present, otherwise inferred from kernelspecName, otherwise null. */
  language: string | null;
}

/** Coerce nbformat's "string or array of strings" multiline fields to a
 *  single string. */
export function joinMultiline(v: unknown): string {
  if (Array.isArray(v)) return v.join('');
  if (typeof v === 'string') return v;
  return '';
}
