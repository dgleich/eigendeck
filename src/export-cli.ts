/**
 * Headless HTML export — runs in a hidden Tauri webview.
 * Reads the .eigendeck file, builds export HTML, writes output, exits.
 */

import { invoke } from '@tauri-apps/api/core';
// @ts-ignore — pure JS module
import { buildExportHtml } from './lib/exportCore.mjs';
import { renderMathInHtml, applyMathPreamble } from './lib/mathjax';

async function main() {
  try {
    // Get CLI args from Rust
    const args = await invoke<{ dbPath: string; outputPath: string }>('cli_export_args');

    // Open the database
    await invoke('db_open', { path: args.dbPath });

    // Load presentation
    const json = await invoke<string>('db_export_json');
    const presentation = JSON.parse(json);

    console.log(`Exporting "${presentation.title}" (${presentation.slides.length} slides)...`);

    // Build HTML using the shared export module
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
      renderMath: renderMathInHtml,
      applyMathPreamble: applyMathPreamble,
    });

    // Write output via Rust (we don't have fs access in the webview)
    await invoke('cli_write_and_exit', { path: args.outputPath, content: html });
  } catch (e) {
    console.error('Export failed:', e);
    await invoke('cli_write_and_exit', { path: '', content: '', error: String(e) });
  }
}

main();
