#!/usr/bin/env node
/**
 * Export a .eigendeck SQLite file to standalone HTML.
 * Usage: node tools/export-eigendeck.mjs <file.eigendeck> [output.html]
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { buildExportHtml } from '../src/lib/exportCore.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dbPath = process.argv[2];
const outPath = process.argv[3];

if (!dbPath) {
  console.error('Usage: node tools/export-eigendeck.mjs <file.eigendeck> [output.html]');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

// Load presentation JSON (same logic as db_export_json in Rust)
const meta = {};
for (const row of db.prepare('SELECT key, value FROM presentation').all()) {
  meta[row.key] = row.value;
}

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

const slides = [];
for (const row of db.prepare('SELECT id, position, layout, notes, group_id FROM slides WHERE valid_to IS NULL ORDER BY position').all()) {
  const slideElements = [];
  for (const se of seBySlide.get(row.id) || []) {
    const el = elements.get(se.elementId);
    if (!el) continue;
    const obj = { ...el.data };
    if (el.linkId) obj.linkId = el.linkId;
    if ((elCount.get(se.elementId) || 0) > 1) obj.syncId = se.elementId;
    slideElements.push(obj);
  }
  const slide = { id: row.id, layout: row.layout || 'default', elements: slideElements, notes: row.notes || '' };
  if (row.group_id) slide.groupId = row.group_id;
  slides.push(slide);
}

const presentation = {
  title: meta.title || 'Untitled',
  theme: meta.theme || 'white',
  slides,
  config: meta.config ? JSON.parse(meta.config) : {},
};

console.log(`Exporting "${presentation.title}" (${slides.length} slides)...`);

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
  renderMath: null,
  applyMathPreamble: null,
});

const output = outPath || dbPath.replace(/\.eigendeck$/, '.html');
writeFileSync(output, html);
console.log(`✓ Exported to ${output} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
console.log('  Note: math not pre-rendered (uses MathJax CDN fallback if needed)');

db.close();
