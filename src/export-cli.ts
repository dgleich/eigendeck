/**
 * Headless HTML export — runs in a hidden Tauri webview.
 * Reads the .eigendeck file, builds export HTML, writes output, exits.
 *
 * Per-preset math: the CLI looks up rendered SVGs in the math_cache table
 * (populated by the editor's iframe pool when each expression was first
 * rendered). Cache misses fall back to the singleton MathJax renderer
 * loaded with the body font's bundle, which produces correct math but in
 * the body font only — so for full per-preset CLI math, open the file in
 * the editor at least once first to seed the cache.
 */

import { invoke } from '@tauri-apps/api/core';
// @ts-ignore — pure JS module
import { buildExportHtml } from './lib/exportCore.mjs';
import { renderMathInHtml, applyMathPreamble } from './lib/mathjax';
import { fontForPreset, fontFamilyForPreset } from './lib/fonts';
import { mathCacheKey } from './lib/mathjaxRenderer';

interface CachedMathRow {
  key: string; tex: string; bundle: string; display: boolean; preamble: string;
  svg: string; width: string | null; height: string | null; valign: string | null;
}

/**
 * #85 — notebook / video / PDF-image elements can't be rendered headlessly, so
 * the static export embeds their cached preview PNG (asset_cache). The app export
 * passes this callback (fileOps.getElementPreviewDataUrl); the CLI used to omit
 * it, so those elements showed "NB"/"PDF" placeholders. Read-only cache lookup
 * (a deck opened in the editor has previews cached): pick the LARGEST cached
 * render for the element's (source_id, variant) and return a data: URL. Returns
 * null on a miss → exportCore falls back to the placeholder, same as before.
 */
interface CacheVariant { variant: string; width: number; height: number; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getElementPreview(el: any): Promise<string | null> {
  try {
    let sourceId: string, variant: string;
    if (el.type === 'image' && el.kind === 'pdf') { sourceId = el.assetId; variant = el.snapshotVariant ?? '_'; }
    else if (el.type === 'notebook' || el.type === 'video') { sourceId = el.syncId ?? el.id; variant = 'preview'; }
    else return null;
    const variants = await invoke<CacheVariant[]>('db_list_asset_cache_variants', { sourceId });
    const matches = (variants || []).filter((v) => v.variant === variant);
    if (!matches.length) return null;
    matches.sort((a, b) => b.width * b.height - a.width * a.height);   // largest cached render
    const best = matches[0];
    const buf = await invoke<ArrayBuffer>('db_get_asset_cache_bytes', {
      sourceId, variant, width: best.width, height: best.height,
    });
    const bytes = new Uint8Array(buf);
    if (!bytes.length) return null;
    let binary = '';
    for (let k = 0; k < bytes.length; k += 8192) binary += String.fromCharCode(...bytes.slice(k, k + 8192));
    return `data:image/png;base64,${btoa(binary)}`;
  } catch (e) {
    console.warn('getElementPreview (cli) failed:', e);
    return null;
  }
}

/**
 * Build a renderMath function that consults the SQLite math_cache for each
 * expression. Falls back to the singleton renderer for cache misses.
 *
 * Signature matches what exportCore expects:
 *   renderMath(html, bundleId) → Promise<string>
 *
 * Walks $..$ and $$..$$ markers in the input html, replaces each with the
 * SVG from the cache (or singleton-rendered SVG), returns the patched html.
 */
function makeCachingRenderMath(preamble: string) {
  return async (html: string, bundleId?: string): Promise<string> => {
    if (!/\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$/.test(html)) return html;
    // Use bundleId 'ptsans' as default if not provided (singleton fallback).
    const bundle = bundleId || 'ptsans';

    // Walk the HTML similar to renderMathInHtml — skip tags, find $..$/$$..$$.
    const parts: string[] = [];
    let i = 0;
    while (i < html.length) {
      if (html[i] === '<') {
        const end = html.indexOf('>', i);
        if (end !== -1) { parts.push(html.slice(i, end + 1)); i = end + 1; continue; }
      }
      // Display $$..$$
      if (html[i] === '$' && html[i + 1] === '$') {
        const end = html.indexOf('$$', i + 2);
        if (end !== -1) {
          const tex = html.slice(i + 2, end);
          const svg = await renderOne(tex, bundle, true, preamble);
          parts.push(`<div style="text-align:center;">${svg}</div>`);
          i = end + 2;
          continue;
        }
      }
      // Inline $..$
      if (html[i] === '$') {
        const end = html.indexOf('$', i + 1);
        if (end !== -1 && !html.slice(i + 1, end).includes('\n')) {
          const tex = html.slice(i + 1, end);
          const svg = await renderOne(tex, bundle, false, preamble);
          parts.push(svg);
          i = end + 1;
          continue;
        }
      }
      parts.push(html[i]);
      i++;
    }
    return parts.join('');
  };
}

/**
 * Resolve one math expression: cache lookup, then singleton fallback.
 * Returns the SVG markup (with inline display/valign style for inline math).
 */
async function renderOne(tex: string, bundleId: string, display: boolean, preamble: string): Promise<string> {
  const key = mathCacheKey(tex, bundleId, display, preamble);
  try {
    const row = await invoke<CachedMathRow | null>('db_get_math_svg', { key });
    if (row) {
      // Match the inline-math vertical-align tweak the iframe-pool render adds.
      if (display) return row.svg;
      const valign = row.valign || '-0.025ex';
      return row.svg.replace(/^<svg/, `<svg overflow="visible" style="display:inline;vertical-align:${valign};overflow:visible"`);
    }
  } catch { /* fall through to singleton */ }
  // Cache miss: use the singleton renderer (will be in body font only).
  const wrapped = display ? `$$${tex}$$` : `$${tex}$`;
  try {
    const out = await renderMathInHtml(wrapped);
    return out;
  } catch {
    return wrapped; // give up — leave source visible
  }
}

async function main() {
  try {
    const args = await invoke<{ dbPath: string; outputPath: string }>('cli_export_args');
    await invoke('db_open', { path: args.dbPath });
    const json = await invoke<string>('db_export_json');
    const presentation = JSON.parse(json);

    console.log(`Exporting "${presentation.title}" (${presentation.slides.length} slides)...`);

    const preamble = presentation.config?.mathPreamble || '';
    if (preamble) {
      try { await applyMathPreamble(preamble); } catch (e) { console.warn('preamble apply failed:', e); }
    }
    const cachingRender = makeCachingRenderMath(preamble);

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
      renderMath: cachingRender,
      applyMathPreamble: applyMathPreamble,
      getElementPreview,   // #85: embed cached notebook/video/PDF previews (not placeholders)
      // Per-preset bundle resolver — same chain as the editor.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolveMathBundle: (preset: string, slide: any) => {
        return fontForPreset(preset, slide || {}, presentation.config).id;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolveFont: (preset: string, slide: any) => {
        const pkg = fontForPreset(preset, slide || {}, presentation.config);
        return fontFamilyForPreset(pkg, preset);
      },
    });

    await invoke('cli_write_and_exit', { path: args.outputPath, content: html });
  } catch (e) {
    console.error('Export failed:', e);
    await invoke('cli_write_and_exit', { path: '', content: '', error: String(e) });
  }
}

main();
