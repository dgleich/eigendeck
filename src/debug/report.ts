// Write a JSON report next to the directory the batch operated on, then show
// a native done dialog. Centralised so every batch action surfaces results
// the same way.

import { writeTextFileNative } from '../lib/nativeFs';
import { message, ask } from '@tauri-apps/plugin-dialog';
import type { RunMeta } from './types';

/**
 * Confirm a destructive write-in-place batch action. Returns true if user
 * accepts. The shared phrasing makes the intent explicit (this rewrites
 * source files; no backups; revert via git if needed).
 */
export async function confirmWriteInPlace(action: string, dir: string, fileCount: number): Promise<boolean> {
  return ask(
    `${action} will REWRITE all ${fileCount} .eigendeck file(s) in:\n${dir}\n\n` +
    `No backups are created — commit or back up first if needed.\n\nContinue?`,
    { title: `Debug: ${action}`, kind: 'warning', okLabel: 'Rewrite files', cancelLabel: 'Cancel' },
  );
}

/** ISO timestamp safe for filenames. */
function stampForFilename(): string {
  const d = new Date();
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Write a report file alongside the directory + show a native "done" alert
 * summarising pass/fail. Returns the report path.
 */
export async function writeReportAndAlert(
  dir: string,
  meta: RunMeta,
  report: object,
): Promise<string> {
  const path = `${dir}/debug-report-${meta.action}-${stampForFilename()}.json`;
  await writeTextFileNative(path, JSON.stringify(report, null, 2));
  await message(
    `${meta.passed}/${meta.totalFiles} passed (${meta.failed} failed) in ${meta.elapsedSeconds.toFixed(1)}s\n\nReport: ${path}`,
    { title: `Debug: ${meta.action}`, kind: meta.failed === 0 ? 'info' : 'warning' },
  );
  return path;
}

/** Show a native error alert for a fatal batch-level problem. */
export async function showBatchError(action: string, err: unknown): Promise<void> {
  await message(`${err instanceof Error ? err.message : String(err)}`, {
    title: `Debug: ${action} failed`,
    kind: 'error',
  });
}
