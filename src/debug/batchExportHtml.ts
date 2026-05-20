// Batch HTML export: for every .eigendeck in a chosen directory, run the
// SAME export pipeline as File → Export HTML (via makeTextElementRenderer),
// write the .html to <dir>/_debug-export/, capture metrics, write JSON report.
//
// Verifies end-to-end: schema-v2 load, font cascade, per-preset math cache
// hits, offline @font-face embedding, asset inlining. A "pass" requires
// exit ok AND zero CDN leaks.

import { invoke } from '@tauri-apps/api/core';
import { writeTextFile, mkdir } from '@tauri-apps/plugin-fs';
// @ts-ignore — pure JS module shared with the CLI tool
import { buildExportHtml } from '../lib/exportCore.mjs';
import { buildEmbeddedFontFacesCSS } from '../lib/fonts';
import { warmMathCacheFromSqlite, resetMathCacheWarmupFlag } from '../lib/mathjaxRenderer';
import { makeTextElementRenderer } from '../store/fileOps';
import { usePresentationStore, openSqliteProject } from '../store/presentation';
import { pickDirectoryWithEigendecks } from './dirPicker';
import { writeReportAndAlert, showBatchError } from './report';
import type { ExportReport, ExportFileReport, RunMeta } from './types';

function basename(p: string): string {
  const m = p.match(/[^/\\]+$/);
  return m ? m[0] : p;
}

async function exportOne(input: string, outputDir: string): Promise<ExportFileReport> {
  const start = performance.now();
  const output = `${outputDir}/${basename(input).replace(/\.eigendeck$/, '.html')}`;
  try {
    await invoke('db_open', { path: input });
    // Warm pool cache from this file's math_cache so renderTextElement hits.
    resetMathCacheWarmupFlag();
    await warmMathCacheFromSqlite();

    const json = await invoke<string>('db_export_json');
    const presentation = JSON.parse(json);

    const fontFacesCss = await buildEmbeddedFontFacesCSS(presentation);
    const html = await buildExportHtml({
      presentation,
      readFile: async (path: string) => {
        const data = await invoke<number[]>('db_get_asset', { path });
        return new Uint8Array(data);
      },
      readTextFile: async (path: string) => {
        const data = await invoke<number[]>('db_get_asset', { path });
        return new TextDecoder().decode(new Uint8Array(data));
      },
      renderTextElement: makeTextElementRenderer(presentation),
      fontFacesCss,
    });
    await writeTextFile(output, html);

    const mathSvgs = (html.match(/role="img"/g) || []).length;
    const fontFamilies = [...new Set([...html.matchAll(/font-family: '([^']+)'/g)].map((m) => m[1]))].sort();
    const cdnLeaks = (html.match(/fonts\.googleapis\.com/g) || []).length;
    // bundlesUsed: walk slides + presets to enumerate distinct bundle ids.
    const bundleSet = new Set<string>();
    try {
      const { fontForPreset } = await import('../lib/fonts');
      for (const slide of presentation.slides || []) {
        for (const el of slide.elements || []) {
          if (el.type === 'text') bundleSet.add(fontForPreset(el.preset, slide, presentation.config).id);
        }
      }
    } catch { /* best-effort metric */ }

    return {
      input, output, ok: cdnLeaks === 0,
      error: cdnLeaks > 0 ? `${cdnLeaks} CDN reference(s) leaked into output` : undefined,
      mathSvgs, fontFamilies, cdnLeaks,
      bundlesUsed: [...bundleSet].sort(),
      sizeBytes: html.length,
      elapsedMs: performance.now() - start,
    };
  } catch (e) {
    return {
      input, output, ok: false, error: e instanceof Error ? e.message : String(e),
      mathSvgs: 0, fontFamilies: [], cdnLeaks: 0, bundlesUsed: [],
      sizeBytes: 0, elapsedMs: performance.now() - start,
    };
  }
}

export async function runBatchExportHtml(): Promise<void> {
  try {
    const picked = await pickDirectoryWithEigendecks('Pick a directory of .eigendeck files to export');
    if (!picked) return;
    const { dir, files } = picked;
    if (files.length === 0) {
      await showBatchError('batch-html-export', 'No .eigendeck files in the chosen directory.');
      return;
    }

    // Snapshot current project so we can restore it after; batch swaps the
    // SQLite handle through every file.
    const originalPath = usePresentationStore.getState().projectPath;

    const outDir = `${dir}/_debug-export`;
    try { await mkdir(outDir, { recursive: true }); } catch { /* exists */ }

    const startWall = performance.now();
    const reports: ExportFileReport[] = [];
    for (const f of files) reports.push(await exportOne(f, outDir));
    const elapsedSeconds = (performance.now() - startWall) / 1000;

    const meta: RunMeta = {
      action: 'batch-html-export',
      startedAt: new Date().toISOString(),
      directory: dir,
      totalFiles: files.length,
      elapsedSeconds,
      passed: reports.filter((r) => r.ok).length,
      failed: reports.filter((r) => !r.ok).length,
    };
    const report: ExportReport = { meta, files: reports };
    await writeReportAndAlert(dir, meta, report);

    // Restore the user's original project (or close).
    if (originalPath) {
      try { await openSqliteProject(originalPath); } catch { /* user can reopen manually */ }
    } else {
      try { await invoke('db_close'); } catch { /* nothing open */ }
    }
  } catch (e) {
    await showBatchError('batch-html-export', e);
  }
}
