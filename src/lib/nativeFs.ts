// Native filesystem access via Rust commands — the replacement for the JS
// `@tauri-apps/plugin-fs` plugin, so the webview can drop the `fs` capability
// entirely (no ambient disk access for any injected script). Signatures mirror
// the plugin's so call sites are near-drop-in.
//
// Reads go through the gated `resolve_and_read` (realpath + regular-file +
// 512 MB cap): a picked/deck-relative source is canonicalized and size-capped,
// same gate the watcher uses. Writes/stat/mkdir/readDir are the plain fscmds
// commands (paths come from dialogs / deck resolution, i.e. user-chosen).

import { invoke } from '@tauri-apps/api/core';

interface ResolvedRead { canonicalPath: string; bytes: number[]; size: number }

/** Read a file's bytes (optionally a bounded prefix). Follows symlinks and rejects
 *  non-regular / oversized (>512 MB) files, via resolve_and_read. */
export async function readFileNative(path: string, maxBytes?: number): Promise<Uint8Array> {
  const r = await invoke<ResolvedRead>('resolve_and_read', { path, maxBytes: maxBytes ?? null });
  return new Uint8Array(r.bytes);
}

/** Read a file as UTF-8 text. */
export async function readTextFileNative(path: string): Promise<string> {
  return new TextDecoder().decode(await readFileNative(path));
}

export async function writeFileNative(path: string, data: Uint8Array): Promise<void> {
  await invoke('write_file', { path, data: Array.from(data) });
}

export async function writeTextFileNative(path: string, text: string, opts?: { append?: boolean }): Promise<void> {
  await invoke('write_text_file', { path, text, append: opts?.append ?? false });
}

export interface NativeStat { mtime: Date | null; size: number; isFile: boolean; isDir: boolean }

/** stat a path. REJECTS if the path is missing (callers rely on that). `mtime` is
 *  a Date (from epoch-ms), matching the plugin's FileInfo.mtime. */
export async function statNative(path: string): Promise<NativeStat> {
  const r = await invoke<{ mtimeMs: number | null; size: number; isFile: boolean; isDir: boolean }>(
    'path_stat', { path },
  );
  return { mtime: r.mtimeMs != null ? new Date(r.mtimeMs) : null, size: r.size, isFile: r.isFile, isDir: r.isDir };
}

export async function existsNative(path: string): Promise<boolean> {
  return invoke<boolean>('path_exists', { path });
}

/** Create a directory (recursively — mirrors mkdir({ recursive: true })). */
export async function mkdirNative(path: string): Promise<void> {
  await invoke('make_dir', { path });
}

export interface NativeDirEntry { name: string; path: string; isDir: boolean }

export async function readDirNative(path: string): Promise<NativeDirEntry[]> {
  return invoke<NativeDirEntry[]>('read_dir', { path });
}
