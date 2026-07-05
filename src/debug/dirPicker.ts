// Directory picker + .eigendeck enumeration. Used by every batch action.

import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readDirNative } from '../lib/nativeFs';

/** Prompt the user for a directory containing .eigendeck files. Returns null on cancel. */
export async function pickDirectoryWithEigendecks(title: string): Promise<{ dir: string; files: string[] } | null> {
  const dir = await openDialog({ title, directory: true, multiple: false });
  if (!dir || typeof dir !== 'string') return null;
  const entries = await readDirNative(dir);
  const files = entries
    .filter((e) => !e.isDir && e.name?.endsWith('.eigendeck'))
    .map((e) => `${dir}/${e.name!}`)
    .sort();
  return { dir, files };
}
