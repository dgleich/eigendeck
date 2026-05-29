// Batch strip history: open each .eigendeck and call db_compact({keepAll:
// true}) which deletes every row where valid_to IS NOT NULL across
// elements/slides/slide_elements and runs VACUUM. Reports per-file
// before/after size.
//
// Write-in-place: source files are modified directly. Confirmation gate
// in DebugMenu before this runs.

import { invoke } from '@tauri-apps/api/core';
import { usePresentationStore, openSqliteProject } from '../store/presentation';
import { pickDirectoryWithEigendecks } from './dirPicker';
import { writeReportAndAlert, showBatchError, confirmWriteInPlace } from './report';
import type { StripHistoryReport, StripHistoryFileReport, RunMeta } from './types';

interface CompactResult { beforeBytes: number; afterBytes: number; savedBytes: number }

async function stripOne(input: string): Promise<StripHistoryFileReport> {
  const start = performance.now();
  try {
    await invoke('db_open', { path: input });
    // keepAll: true is misnamed in the Rust API — it means "delete ALL history"
    // (vs the default exponential thinning). That's what we want here.
    const json = await invoke<string>('db_compact', { keepAll: true });
    const r = JSON.parse(json) as CompactResult;
    // db_close runs PRAGMA wal_checkpoint(TRUNCATE) and drops the
    // connection — without this the .eigendeck-{wal,shm} sidecars
    // stay alongside the stripped file. (The next iteration's
    // db_open replaces the connection in DB.lock() and rusqlite's
    // Drop closes it, but Drop alone doesn't checkpoint.)
    await invoke('db_close');
    return {
      input, ok: true,
      sizeBeforeBytes: r.beforeBytes,
      sizeAfterBytes: r.afterBytes,
      savedBytes: r.savedBytes,
      elapsedMs: performance.now() - start,
    };
  } catch (e) {
    // Best-effort close so a half-failed strip still checkpoints if
    // db_open succeeded. Ignore close errors (the original one is
    // the useful signal).
    try { await invoke('db_close'); } catch { /* swallow */ }
    return {
      input, ok: false, error: e instanceof Error ? e.message : String(e),
      sizeBeforeBytes: 0, sizeAfterBytes: 0, savedBytes: 0,
      elapsedMs: performance.now() - start,
    };
  }
}

export async function runBatchStripHistory(): Promise<void> {
  try {
    const picked = await pickDirectoryWithEigendecks('Pick a directory of .eigendeck files to strip history from (rewrites in place)');
    if (!picked) return;
    const { dir, files } = picked;
    if (files.length === 0) {
      await showBatchError('batch-strip-history', 'No .eigendeck files in the chosen directory.');
      return;
    }
    if (!(await confirmWriteInPlace('Batch Strip History', dir, files.length))) return;

    const originalPath = usePresentationStore.getState().projectPath;
    const startWall = performance.now();
    const reports: StripHistoryFileReport[] = [];
    for (const f of files) reports.push(await stripOne(f));
    const elapsedSeconds = (performance.now() - startWall) / 1000;

    const totalSaved = reports.reduce((n, r) => n + r.savedBytes, 0);
    const meta: RunMeta = {
      action: 'batch-strip-history',
      startedAt: new Date().toISOString(),
      directory: dir,
      totalFiles: files.length,
      elapsedSeconds,
      passed: reports.filter((r) => r.ok).length,
      failed: reports.filter((r) => !r.ok).length,
    };
    // Add the aggregate savings into the report; not part of RunMeta so we
    // tuck it onto the report itself for visibility.
    const report = { meta, files: reports, totalSavedBytes: totalSaved } as StripHistoryReport & { totalSavedBytes: number };
    await writeReportAndAlert(dir, meta, report);

    if (originalPath) {
      try { await openSqliteProject(originalPath); } catch { /* manual reopen */ }
    } else {
      try { await invoke('db_close'); } catch { /* nothing open */ }
    }
  } catch (e) {
    await showBatchError('batch-strip-history', e);
  }
}
