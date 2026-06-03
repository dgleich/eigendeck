// The "recording" — eigendeck's record of a live notebook session,
// stored as a SEPARATE eigendeck-owned asset (mime
// application/x-eigendeck-nb-recording+json) bound to a notebook
// element via recordingAssetId. The user's .ipynb asset is NEVER
// mutated; the recording holds everything that happened in eigendeck.
//
// Why a separate asset (not an element overlay):
//   - free versioning + Restore via the temporal asset history
//   - keeps potentially-large outputs (base64 PNGs) out of the
//     presentation JSON, which is re-serialized on every deck save
//
// "eigendeck is not a notebook editor, but it is a recorder":
//   - source authored in JupyterLab → the .ipynb (pristine)
//   - the live session (edits, outputs, live-authored cells) → here

import { Cell, CellOutput, CodeCell, Notebook } from './notebookFormat';

export const RECORDING_MIME = 'application/x-eigendeck-nb-recording+json';

/** A cell authored live inside eigendeck (the live-coding case). Not
 *  present in the .ipynb. Identified by a stable UUID, not an index. */
export interface AppendedCell {
  id: string;
  /** Index in the .ipynb after which this cell renders. null = top.
   *  Appended cells render after their anchor, in array order. */
  afterIndex: number | null;
  cellType: 'code' | 'markdown';
  source: string;
  outputs?: CellOutput[];
  executionCount?: number | null;
}

export interface Recording {
  version: 1;
  /** Source overrides for .ipynb cells, keyed by zero-based index. */
  cellEdits: Record<number, string>;
  /** Recorded outputs for .ipynb cells, keyed by zero-based index.
   *  Precedence over the cell's baked-in outputs. */
  cellOutputs: Record<number, CellOutput[]>;
  /** Per-.ipynb-cell execution count from the recorded run. */
  cellCounts: Record<number, number | null>;
  /** Cells authored live inside eigendeck. */
  appendedCells: AppendedCell[];
}

export function emptyRecording(): Recording {
  return { version: 1, cellEdits: {}, cellOutputs: {}, cellCounts: {}, appendedCells: [] };
}

export function isRecordingEmpty(r: Recording): boolean {
  return Object.keys(r.cellEdits).length === 0
    && Object.keys(r.cellOutputs).length === 0
    && Object.keys(r.cellCounts).length === 0
    && r.appendedCells.length === 0;
}

/** Parse recording-asset bytes. Tolerant: malformed → empty. */
export function parseRecording(bytes: Uint8Array | ArrayBuffer | string): Recording {
  try {
    const text = typeof bytes === 'string'
      ? bytes
      : new TextDecoder('utf-8').decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object') return emptyRecording();
    return {
      version: 1,
      cellEdits: numKeyedStrings(o.cellEdits),
      cellOutputs: numKeyedOutputs(o.cellOutputs),
      cellCounts: numKeyedCounts(o.cellCounts),
      appendedCells: Array.isArray(o.appendedCells)
        ? o.appendedCells.filter(isAppended)
        : [],
    };
  } catch {
    return emptyRecording();
  }
}

export function serializeRecording(r: Recording): string {
  return JSON.stringify(r);
}

// ---- merge: .ipynb + recording → the cells we actually render -------

/** A cell in the merged render list. `origin` drives the visual
 *  distinction between pristine notebook cells and recording content. */
export type MergedCell =
  | { origin: 'ipynb'; cell: Cell; source: string; outputs: CellOutput[];
      executionCount: number | null; edited: boolean; outputRecorded: boolean }
  | { origin: 'appended'; appended: AppendedCell };

/** Merge a parsed notebook with a recording into the ordered render
 *  list. Source precedence: cellEdits → cell.source. Output
 *  precedence: cellOutputs → baked-in cell.outputs → []. Appended
 *  cells splice in after their anchor index. */
export function mergeNotebook(notebook: Notebook | null, rec: Recording): MergedCell[] {
  const out: MergedCell[] = [];
  const appendedByAnchor = new Map<number | null, AppendedCell[]>();
  for (const a of rec.appendedCells) {
    const k = a.afterIndex;
    if (!appendedByAnchor.has(k)) appendedByAnchor.set(k, []);
    appendedByAnchor.get(k)!.push(a);
  }
  // Appended cells anchored to top (afterIndex null) render first.
  for (const a of appendedByAnchor.get(null) ?? []) {
    out.push({ origin: 'appended', appended: a });
  }
  const cells = notebook?.cells ?? [];
  for (const cell of cells) {
    if (cell.kind === 'code') {
      const editKey = cell.index;
      const editedSource = rec.cellEdits[editKey];
      const edited = editedSource !== undefined && editedSource !== cell.source;
      const recOut = rec.cellOutputs[editKey];
      const outputRecorded = recOut !== undefined;
      const codeCell = cell as CodeCell;
      out.push({
        origin: 'ipynb', cell,
        source: editedSource ?? cell.source,
        outputs: recOut ?? codeCell.outputs,
        executionCount: outputRecorded
          ? (rec.cellCounts[editKey] ?? null)
          : codeCell.executionCount,
        edited,
        outputRecorded,
      });
    } else {
      // markdown / raw — source edits apply, no outputs.
      const editedSource = rec.cellEdits[cell.index];
      const edited = editedSource !== undefined && editedSource !== cell.source;
      out.push({
        origin: 'ipynb', cell,
        source: editedSource ?? cell.source,
        outputs: [],
        executionCount: null,
        edited,
        outputRecorded: false,
      });
    }
    // Appended cells anchored after this index.
    for (const a of appendedByAnchor.get(cell.index) ?? []) {
      out.push({ origin: 'appended', appended: a });
    }
  }
  return out;
}

// ---- validation helpers --------------------------------------------

function numKeyedStrings(v: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const n = Number(k);
      if (Number.isInteger(n) && typeof val === 'string') out[n] = val;
    }
  }
  return out;
}

function numKeyedOutputs(v: unknown): Record<number, CellOutput[]> {
  const out: Record<number, CellOutput[]> = {};
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const n = Number(k);
      if (Number.isInteger(n) && Array.isArray(val)) out[n] = val as CellOutput[];
    }
  }
  return out;
}

function numKeyedCounts(v: unknown): Record<number, number | null> {
  const out: Record<number, number | null> = {};
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const n = Number(k);
      if (Number.isInteger(n) && (val === null || typeof val === 'number')) out[n] = val as number | null;
    }
  }
  return out;
}

function isAppended(v: unknown): v is AppendedCell {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string'
    && (o.afterIndex === null || typeof o.afterIndex === 'number')
    && (o.cellType === 'code' || o.cellType === 'markdown')
    && typeof o.source === 'string';
}
