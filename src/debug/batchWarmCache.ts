// Batch warm math cache: open each .eigendeck and render every $..$/$$..$$
// expression through the editor's iframe pool so the write-through to
// math_cache populates it. db_open implicitly migrates v1 files to v2 as a
// side effect (the schema migration runs at open time), so this action
// doubles as the "fix the old examples directory" tool.
//
// Write-in-place: source files are modified directly. Confirmation gate
// in DebugMenu before this runs.

import { invoke } from '@tauri-apps/api/core';
import { fontForPreset } from '../lib/fonts';
import { renderMath } from '../lib/mathjaxRenderer';
import { usePresentationStore, openSqliteProject } from '../store/presentation';
import { pickDirectoryWithEigendecks } from './dirPicker';
import { writeReportAndAlert, showBatchError, confirmWriteInPlace } from './report';
import { extractMath } from './mathExtract';
import type { WarmCacheReport, WarmCacheFileReport, RunMeta } from './types';

async function readSchemaVersion(): Promise<number | null> {
  try {
    const v = await invoke<string>('db_export_json'); // just used to ensure handle open
    // db_export_json doesn't return the schema version directly; query via raw SQL.
    // The storage layer exposes _meta via db_export_json's presentation/config
    // path, but the schema version lives in the _meta table directly. There's
    // no dedicated command — fall back to assuming v2 after db_open since
    // open performs the migration. Return null if we can't determine.
    void v;
    return 2; // post-open we're always v2 (migration runs in db_open)
  } catch {
    return null;
  }
}

async function cacheRowCount(): Promise<number> {
  try {
    const rows = await invoke<unknown[]>('db_load_math_cache');
    return rows.length;
  } catch { return 0; }
}

async function warmOne(input: string): Promise<WarmCacheFileReport> {
  const start = performance.now();
  const errors: string[] = [];
  try {
    await invoke('db_open', { path: input });
    // db_open runs schema migration as a side effect — we can't easily
    // distinguish v1-before from v2-before without raw SQL access, but
    // we KNOW the file is v2 after the open call completes.
    const schemaAfter = await readSchemaVersion();
    const cacheRowsBefore = await cacheRowCount();

    const json = await invoke<string>('db_export_json');
    const presentation = JSON.parse(json);
    const preamble = presentation.config?.mathPreamble || '';

    let expressionsFound = 0;
    let rendered = 0;
    let renderFailures = 0;
    for (const slide of presentation.slides || []) {
      for (const el of slide.elements || []) {
        if (el.type !== 'text' || !el.html) continue;
        const bundle = fontForPreset(el.preset, slide, presentation.config).id;
        for (const [tex, display] of extractMath(el.html)) {
          expressionsFound++;
          try {
            // renderMath checks pool.cache first; on miss it renders via the
            // iframe pool and write-throughs to SQLite via persistToSqlite.
            await renderMath(tex, bundle, display, preamble);
            rendered++;
          } catch (e) {
            renderFailures++;
            if (errors.length < 5) errors.push(`${bundle} ${display ? 'disp' : 'inline'} ${JSON.stringify(tex.slice(0, 40))}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    }

    const cacheRowsAfter = await cacheRowCount();
    return {
      input, ok: renderFailures === 0,
      error: renderFailures > 0 ? `${renderFailures}/${expressionsFound} expression(s) failed to render` : undefined,
      schemaBefore: null, schemaAfter,
      expressionsFound, cacheRowsBefore, cacheRowsAfter,
      rendered, renderFailures, errors,
      elapsedMs: performance.now() - start,
    };
  } catch (e) {
    return {
      input, ok: false, error: e instanceof Error ? e.message : String(e),
      schemaBefore: null, schemaAfter: null,
      expressionsFound: 0, cacheRowsBefore: 0, cacheRowsAfter: 0,
      rendered: 0, renderFailures: 0, errors,
      elapsedMs: performance.now() - start,
    };
  }
}

export async function runBatchWarmCache(): Promise<void> {
  try {
    const picked = await pickDirectoryWithEigendecks('Pick a directory of .eigendeck files to warm (rewrites in place)');
    if (!picked) return;
    const { dir, files } = picked;
    if (files.length === 0) {
      await showBatchError('batch-warm-cache', 'No .eigendeck files in the chosen directory.');
      return;
    }
    if (!(await confirmWriteInPlace('Batch Warm Cache', dir, files.length))) return;

    const originalPath = usePresentationStore.getState().projectPath;
    const startWall = performance.now();
    const reports: WarmCacheFileReport[] = [];
    for (const f of files) reports.push(await warmOne(f));
    const elapsedSeconds = (performance.now() - startWall) / 1000;

    const meta: RunMeta = {
      action: 'batch-warm-cache',
      startedAt: new Date().toISOString(),
      directory: dir,
      totalFiles: files.length,
      elapsedSeconds,
      passed: reports.filter((r) => r.ok).length,
      failed: reports.filter((r) => !r.ok).length,
    };
    const report: WarmCacheReport = { meta, files: reports };
    await writeReportAndAlert(dir, meta, report);

    if (originalPath) {
      try { await openSqliteProject(originalPath); } catch { /* manual reopen */ }
    } else {
      try { await invoke('db_close'); } catch { /* nothing open */ }
    }
  } catch (e) {
    await showBatchError('batch-warm-cache', e);
  }
}
