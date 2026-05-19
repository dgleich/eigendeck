#!/usr/bin/env node
/**
 * Export a .eigendeck SQLite file to standalone, fully-offline HTML.
 * Usage: node tools/export-eigendeck.mjs <file.eigendeck> [output.html]
 *
 * Schema v2 aware:
 *   - reads slides.config (per-slide theme/font overrides), not the dropped
 *     slides.layout column;
 *   - per-preset math comes from the math_cache table the editor's iframe
 *     pool populated (look up by the shared mathCacheKey). Cache misses leave
 *     the $tex$ source visible (no MathJax in plain Node);
 *   - bundled fonts are embedded as base64 @font-face (no network).
 */
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildExportHtml } from '../src/lib/exportCore.mjs';
import {
  fontForPreset,
  fontFamilyForPreset,
  collectUsedFontIds,
  resolveFontPackage,
  fontFilesForPackage,
  bareFamilyName,
  bareNarrowFamilyName,
  mathCacheKey,
} from '../src/lib/fontRegistry.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dbPath = process.argv[2];
const outPath = process.argv[3];

if (!dbPath) {
  console.error('Usage: node tools/export-eigendeck.mjs <file.eigendeck> [output.html]');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

// --- presentation meta -----------------------------------------------------
const meta = {};
for (const row of db.prepare('SELECT key, value FROM presentation').all()) {
  meta[row.key] = row.value;
}
const config = meta.config ? JSON.parse(meta.config) : {};

// --- elements --------------------------------------------------------------
const elements = new Map();
for (const row of db.prepare('SELECT id, data, link_id FROM elements WHERE valid_to IS NULL').all()) {
  elements.set(row.id, { data: JSON.parse(row.data), linkId: row.link_id });
}

const seBySlide = new Map();
const elCount = new Map();
for (const row of db.prepare('SELECT slide_id, element_id, z_order FROM slide_elements WHERE valid_to IS NULL ORDER BY slide_id, z_order').all()) {
  if (!seBySlide.has(row.slide_id)) seBySlide.set(row.slide_id, []);
  seBySlide.get(row.slide_id).push({ elementId: row.element_id, zOrder: row.z_order });
  elCount.set(row.element_id, (elCount.get(row.element_id) || 0) + 1);
}

// --- slides (v2: config column, no layout) ---------------------------------
const slides = [];
for (const row of db.prepare('SELECT id, position, notes, group_id, config FROM slides WHERE valid_to IS NULL ORDER BY position').all()) {
  const slideElements = [];
  for (const se of seBySlide.get(row.id) || []) {
    const el = elements.get(se.elementId);
    if (!el) continue;
    const obj = { ...el.data };
    if (el.linkId) obj.linkId = el.linkId;
    if ((elCount.get(se.elementId) || 0) > 1) obj.syncId = se.elementId;
    slideElements.push(obj);
  }
  const slide = { id: row.id, elements: slideElements, notes: row.notes || '' };
  if (row.group_id) slide.groupId = row.group_id;
  // Per-slide overrides live in config JSON; spread onto the slide so the
  // font cascade (fontForPreset) sees titleFont/bodyFont/hypeFont/theme.
  if (row.config) {
    try { Object.assign(slide, JSON.parse(row.config)); } catch { /* ignore bad config */ }
  }
  slides.push(slide);
}

const presentation = {
  title: meta.title || 'Untitled',
  theme: meta.theme || 'white',
  slides,
  config,
};

// --- math cache: index every rendered SVG by its shared cache key ----------
const mathCache = new Map();
let cacheRows = 0;
try {
  for (const r of db.prepare('SELECT key, svg, valign FROM math_cache').all()) {
    mathCache.set(r.key, { svg: r.svg, valign: r.valign });
    cacheRows++;
  }
} catch { /* no math_cache table (pre-v2 file): all misses */ }

const preamble = config.mathPreamble || '';
let hits = 0;
let misses = 0;

/**
 * Cache-backed renderMath. Mirrors renderMathInHtml() in
 * src/lib/mathjaxRenderer.ts EXACTLY (tag skipping, $$..$$ display, $..$
 * inline with newline guard) so the tex strings — and therefore the
 * mathCacheKey — match what the editor stored.
 */
function renderMath(html, bundleId) {
  if (!/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/.test(html)) return html;
  const bundle = bundleId || 'ptsans';
  const parts = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end !== -1) { parts.push(html.slice(i, end + 1)); i = end + 1; continue; }
    }
    if (html[i] === '$' && html[i + 1] === '$') {
      const end = html.indexOf('$$', i + 2);
      if (end !== -1) {
        const tex = html.slice(i + 2, end);
        parts.push(lookup(tex, bundle, true) ?? `<div style="text-align:center;">$$${tex}$$</div>`);
        i = end + 2;
        continue;
      }
    }
    if (html[i] === '$') {
      const end = html.indexOf('$', i + 1);
      if (end !== -1 && !html.slice(i + 1, end).includes('\n')) {
        const tex = html.slice(i + 1, end);
        parts.push(lookup(tex, bundle, false) ?? `$${tex}$`);
        i = end + 1;
        continue;
      }
    }
    parts.push(html[i]);
    i++;
  }
  return parts.join('');
}

function lookup(tex, bundle, display) {
  const hit = mathCache.get(mathCacheKey(tex, bundle, display, preamble));
  if (!hit) { misses++; return null; }
  hits++;
  if (display) return hit.svg;
  // Match the inline-math styling the editor's renderer adds.
  const valign = hit.valign || '-0.025ex';
  return hit.svg.replace(
    /^<svg/,
    `<svg overflow="visible" style="display:inline;vertical-align:${valign};overflow:visible"`
  );
}

// --- embedded @font-face (base64, fully offline) ---------------------------
function buildFontFacesCss() {
  const lines = [];
  for (const id of collectUsedFontIds(presentation)) {
    const pkg = resolveFontPackage(id);
    const family = bareFamilyName(pkg);
    const narrowFamily = bareNarrowFamilyName(pkg);
    for (const { filename, cssAttrs } of fontFilesForPackage(pkg)) {
      try {
        const fileUrl = new URL(`../public/fonts/${pkg.id}/${filename}`, import.meta.url);
        const buf = readFileSync(fileURLToPath(fileUrl));
        const ext = filename.split('.').pop() || 'ttf';
        const mime = ext === 'otf' ? 'font/otf' : 'font/ttf';
        const fmt = ext === 'otf' ? "format('opentype')" : "format('truetype')";
        const fontFamily = cssAttrs.isNarrow && narrowFamily ? narrowFamily : family;
        lines.push(
          `@font-face { font-family: '${fontFamily}'; src: url('data:${mime};base64,${buf.toString('base64')}') ${fmt}; ` +
          `font-weight: ${cssAttrs.weight}; font-style: ${cssAttrs.style}; font-display: swap; }`
        );
      } catch (e) {
        console.warn(`  ! font ${pkg.id}/${filename} not embedded: ${e.message}`);
      }
    }
  }
  return lines.join('\n');
}

console.log(`Exporting "${presentation.title}" (${slides.length} slides, ${cacheRows} cached math rows)...`);

const html = await buildExportHtml({
  presentation,
  readFile: async (path) => {
    const row = db.prepare('SELECT data FROM assets WHERE path = ?').get(path);
    if (row) return new Uint8Array(row.data);
    throw new Error(`Asset not found: ${path}`);
  },
  readTextFile: async (path) => {
    const row = db.prepare('SELECT data FROM assets WHERE path = ?').get(path);
    if (row) return Buffer.from(row.data).toString('utf-8');
    throw new Error(`Asset not found: ${path}`);
  },
  renderMath,
  applyMathPreamble: null,
  resolveMathBundle: (preset, slide) => fontForPreset(preset, slide || {}, config).id,
  resolveFont: (preset, slide) => fontFamilyForPreset(fontForPreset(preset, slide || {}, config), preset),
  fontFacesCss: buildFontFacesCss(),
});

const output = outPath || dbPath.replace(/\.eigendeck$/, '.html');
writeFileSync(output, html);
db.close();

console.log(`✓ Exported to ${output} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`  math: ${hits} from cache, ${misses} miss${misses === 1 ? '' : 'es'}` +
  (misses ? ' (open the file in the editor and save to seed those)' : ' — fully pre-rendered'));
