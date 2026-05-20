// Batch round-trip save test: for every .eigendeck in a chosen directory,
// open it, save-as to a temp copy, reopen the copy, and assert the exported
// JSON is byte-identical (after canonicalisation).
//
// This is the only way to verify per-slide config overrides survive a real
// save round-trip from the UI's perspective, end-to-end through the schema.

import { invoke } from '@tauri-apps/api/core';
import { mkdir } from '@tauri-apps/plugin-fs';
import { usePresentationStore, openSqliteProject } from '../store/presentation';
import { pickDirectoryWithEigendecks } from './dirPicker';
import { writeReportAndAlert, showBatchError } from './report';
import type { RoundtripReport, RoundtripFileReport, RunMeta } from './types';

function basename(p: string): string {
  const m = p.match(/[^/\\]+$/);
  return m ? m[0] : p;
}

/** Stable JSON canonical form: recursively sort object keys. */
function canonicalize(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

/** Find up to N field-paths that differ between two JSON values. */
function findDiffs(a: unknown, b: unknown, path: string, out: string[], max: number): void {
  if (out.length >= max) return;
  if (canonicalize(a) === canonicalize(b)) return;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = (a as unknown[]) || [];
    const bb = (b as unknown[]) || [];
    if (aa.length !== bb.length) out.push(`${path}.length: ${aa.length} -> ${bb.length}`);
    const n = Math.min(aa.length, bb.length);
    for (let i = 0; i < n && out.length < max; i++) findDiffs(aa[i], bb[i], `${path}[${i}]`, out, max);
    return;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of [...keys].sort()) {
    if (out.length >= max) break;
    findDiffs(ao[k], bo[k], path ? `${path}.${k}` : k, out, max);
  }
}

async function roundtripOne(input: string, tempDir: string): Promise<RoundtripFileReport> {
  const start = performance.now();
  const tempPath = `${tempDir}/${basename(input)}`;
  try {
    await invoke('db_open', { path: input });
    const jsonBefore = await invoke<string>('db_export_json');
    const before = JSON.parse(jsonBefore);

    // Save-as a fresh copy on disk. db_save_to_file commits the current
    // SQLite handle's content to a new path.
    await invoke('db_save_to_file', { path: tempPath });

    // Reopen the copy and re-export.
    await invoke('db_open', { path: tempPath });
    const jsonAfter = await invoke<string>('db_export_json');
    const after = JSON.parse(jsonAfter);

    const slides = before.slides || [];
    const slidesWithConfig = slides.filter((s: Record<string, unknown>) =>
      s.theme || s.titleFont || s.bodyFont || s.hypeFont).length;
    const elementCount = slides.reduce(
      (n: number, s: { elements?: unknown[] }) => n + (s.elements?.length || 0), 0);

    const diffs: string[] = [];
    findDiffs(before, after, '', diffs, 20);

    return {
      input, ok: diffs.length === 0,
      error: diffs.length > 0 ? `${diffs.length} field(s) differ after round-trip` : undefined,
      slideCount: slides.length,
      slidesWithConfig,
      elementCount,
      diffs,
      elapsedMs: performance.now() - start,
    };
  } catch (e) {
    return {
      input, ok: false, error: e instanceof Error ? e.message : String(e),
      slideCount: 0, slidesWithConfig: 0, elementCount: 0, diffs: [],
      elapsedMs: performance.now() - start,
    };
  }
}

export async function runBatchRoundtrip(): Promise<void> {
  try {
    const picked = await pickDirectoryWithEigendecks('Pick a directory of .eigendeck files to round-trip');
    if (!picked) return;
    const { dir, files } = picked;
    if (files.length === 0) {
      await showBatchError('batch-roundtrip', 'No .eigendeck files in the chosen directory.');
      return;
    }
    const originalPath = usePresentationStore.getState().projectPath;
    const tempDir = `${dir}/_debug-roundtrip`;
    try { await mkdir(tempDir, { recursive: true }); } catch { /* exists */ }

    const startWall = performance.now();
    const reports: RoundtripFileReport[] = [];
    for (const f of files) reports.push(await roundtripOne(f, tempDir));
    const elapsedSeconds = (performance.now() - startWall) / 1000;

    const meta: RunMeta = {
      action: 'batch-roundtrip',
      startedAt: new Date().toISOString(),
      directory: dir,
      totalFiles: files.length,
      elapsedSeconds,
      passed: reports.filter((r) => r.ok).length,
      failed: reports.filter((r) => !r.ok).length,
    };
    const report: RoundtripReport = { meta, files: reports };
    await writeReportAndAlert(dir, meta, report);

    if (originalPath) {
      try { await openSqliteProject(originalPath); } catch { /* manual reopen */ }
    } else {
      try { await invoke('db_close'); } catch { /* nothing open */ }
    }
  } catch (e) {
    await showBatchError('batch-roundtrip', e);
  }
}
