#!/usr/bin/env node
/**
 * Benchmark SQLite ↔ JSON conversion.
 *
 * Tests:
 * - toJSON: read full state from SQLite → Presentation JSON object
 * - fromJSON: write a Presentation JSON object into SQLite
 * - Round-trip: SQLite → JSON → new SQLite → verify identical
 */

import { createRequire } from 'node:module';
import { existsSync, unlinkSync, statSync } from 'node:fs';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// ============================================================================
// The canonical conversion functions
// ============================================================================

/**
 * Read the full current state from SQLite → Presentation JSON object.
 * This is the object used by the HTML export, LLM editing, etc.
 */
function toJSON(db) {
  // Presentation metadata
  const meta = {};
  for (const row of db.prepare('SELECT key, value FROM presentation').all()) {
    meta[row.key] = row.value;
  }

  const config = meta.config ? JSON.parse(meta.config) : {};

  // Slides in order
  const slides = db.prepare(
    'SELECT id, position, layout, notes, group_id FROM slides WHERE valid_to IS NULL ORDER BY position'
  ).all();

  // Prefetch all current elements and slide_elements in bulk (faster than per-slide queries)
  const allElements = new Map();
  for (const row of db.prepare('SELECT id, type, data, link_id FROM elements WHERE valid_to IS NULL').all()) {
    allElements.set(row.id, { ...JSON.parse(row.data), linkId: row.link_id || undefined });
  }

  const slideElementRows = db.prepare(
    'SELECT slide_id, element_id, z_order FROM slide_elements WHERE valid_to IS NULL ORDER BY slide_id, z_order'
  ).all();

  // Group slide_elements by slide + count per element (for sync detection)
  const seBySlide = new Map();
  const elAppearanceCount = new Map(); // element_id → number of slides it appears on
  for (const row of slideElementRows) {
    if (!seBySlide.has(row.slide_id)) seBySlide.set(row.slide_id, []);
    seBySlide.get(row.slide_id).push(row);
    elAppearanceCount.set(row.element_id, (elAppearanceCount.get(row.element_id) || 0) + 1);
  }

  // Build the slides array
  const slideArray = slides.map(s => {
    const seRows = seBySlide.get(s.id) || [];
    const elements = [];

    for (const se of seRows) {
      const el = allElements.get(se.element_id);
      if (el) {
        const isSynced = (elAppearanceCount.get(se.element_id) || 0) > 1;
        elements.push({
          ...el,
          ...(isSynced ? { syncId: se.element_id } : {}),
        });
      }
    }

    return {
      id: s.id,
      layout: s.layout || 'default',
      elements,
      notes: s.notes || '',
      ...(s.group_id ? { groupId: s.group_id } : {}),
    };
  });

  return {
    title: meta.title || 'Untitled',
    theme: meta.theme || 'white',
    slides: slideArray,
    config,
  };
}

/**
 * Write a Presentation JSON object into a fresh SQLite database.
 * Handles synced elements: if multiple elements across slides share the
 * same syncId, they become one row in elements with multiple slide_elements.
 */
function fromJSON(db, presentation, timestamp) {
  const t = timestamp || new Date().toISOString();

  const tx = db.transaction(() => {
    // Presentation metadata
    const insP = db.prepare('INSERT OR REPLACE INTO presentation VALUES (?, ?)');
    insP.run('title', presentation.title || 'Untitled');
    insP.run('theme', presentation.theme || 'white');
    insP.run('config', JSON.stringify(presentation.config || {}));

    // Track synced elements: syncId → element_id in DB
    const syncMap = new Map(); // syncId → db element id
    const insertedElements = new Set();

    const insSlide = db.prepare('INSERT INTO slides VALUES (?,?,?,?,?,?,NULL)');
    const insEl = db.prepare('INSERT INTO elements VALUES (?,?,?,?,?,NULL)');
    const insSE = db.prepare('INSERT INTO slide_elements VALUES (?,?,?,?,NULL)');

    for (let i = 0; i < presentation.slides.length; i++) {
      const s = presentation.slides[i];
      insSlide.run(s.id, i, s.layout || 'default', s.notes || '', s.groupId || null, t);

      for (let z = 0; z < s.elements.length; z++) {
        const el = s.elements[z];
        let elementId = el.id;

        // If synced, check if we've already inserted this element
        if (el.syncId) {
          if (syncMap.has(el.syncId)) {
            // Already inserted — just add a slide_elements reference
            elementId = syncMap.get(el.syncId);
            insSE.run(s.id, elementId, z, t);
            continue;
          }
          // First time seeing this syncId — insert element, record mapping
          syncMap.set(el.syncId, elementId);
        }

        if (!insertedElements.has(elementId)) {
          // Build the data JSON (strip syncId — it's represented by the junction)
          const data = { ...el };
          delete data.syncId;
          delete data._syncId;
          delete data._linkId;
          const linkId = el.linkId || el._linkId || null;
          delete data.linkId;

          insEl.run(elementId, el.type, JSON.stringify(data), linkId, t);
          insertedElements.add(elementId);
        }

        insSE.run(s.id, elementId, z, t);
      }
    }
  });
  tx();
}

// ============================================================================
// Setup test DB with realistic data
// ============================================================================
function createSchema(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS presentation (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS slides (
      id TEXT NOT NULL, position INTEGER, layout TEXT, notes TEXT, group_id TEXT,
      valid_from TEXT NOT NULL, valid_to TEXT,
      PRIMARY KEY (id, valid_from)
    );
    CREATE TABLE IF NOT EXISTS elements (
      id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, link_id TEXT,
      valid_from TEXT NOT NULL, valid_to TEXT,
      PRIMARY KEY (id, valid_from)
    );
    CREATE TABLE IF NOT EXISTS slide_elements (
      slide_id TEXT NOT NULL, element_id TEXT NOT NULL, z_order INTEGER NOT NULL,
      valid_from TEXT NOT NULL, valid_to TEXT,
      PRIMARY KEY (slide_id, element_id, valid_from)
    );
    CREATE TABLE IF NOT EXISTS assets (
      path TEXT PRIMARY KEY, data BLOB NOT NULL, mime_type TEXT,
      size INTEGER, hash TEXT, created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_el_current ON elements(valid_to) WHERE valid_to IS NULL;
    CREATE INDEX IF NOT EXISTS idx_el_id ON elements(id) WHERE valid_to IS NULL;
    CREATE INDEX IF NOT EXISTS idx_se_slide ON slide_elements(slide_id) WHERE valid_to IS NULL;
    CREATE INDEX IF NOT EXISTS idx_se_element ON slide_elements(element_id) WHERE valid_to IS NULL;
    CREATE INDEX IF NOT EXISTS idx_slides_current ON slides(valid_to) WHERE valid_to IS NULL;
  `);
}

// Build a test presentation JSON
function buildTestPresentation(numSlides, syncGroupSize) {
  const slides = [];
  const syncGroups = [];

  // Create sync groups (shared elements)
  for (let g = 0; g < Math.floor(numSlides / syncGroupSize); g++) {
    syncGroups.push({
      id: crypto.randomUUID(),
      type: 'text',
      preset: 'title',
      html: `Synced title ${g}`,
      position: { x: 80, y: 20, width: 1760, height: 200 },
      syncId: `sync-${g}`,
    });
  }

  for (let i = 0; i < numSlides; i++) {
    const elements = [];

    // Add synced element
    const syncIdx = Math.floor(i / syncGroupSize);
    if (syncIdx < syncGroups.length) {
      elements.push({ ...syncGroups[syncIdx] });
    }

    // Add unique elements
    for (let j = 0; j < 3 + Math.floor(Math.random() * 3); j++) {
      elements.push({
        id: crypto.randomUUID(),
        type: 'text',
        preset: 'body',
        html: `Element ${j} on slide ${i}: $x^{${j}}$`,
        position: { x: 80 + j * 200, y: 240 + j * 150, width: 600, height: 200 },
      });
    }

    slides.push({
      id: crypto.randomUUID(),
      layout: 'default',
      elements,
      notes: `Notes for slide ${i}`,
      ...(i % 10 < 5 ? { groupId: `group-${Math.floor(i / 5)}` } : {}),
    });
  }

  return {
    title: 'Conversion Test',
    theme: 'white',
    slides,
    config: { width: 1920, height: 1080, author: 'Test', venue: 'Bench' },
  };
}

// ============================================================================
// Benchmarks
// ============================================================================
function bench(name, iterations, fn) {
  for (let i = 0; i < 5; i++) fn();
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(`  ${name}: ${median.toFixed(2)}ms median, ${p95.toFixed(2)}ms p95`);
  return median;
}

const presentation = buildTestPresentation(250, 5);
const totalElements = presentation.slides.reduce((n, s) => n + s.elements.length, 0);
const syncedCount = new Set(presentation.slides.flatMap(s => s.elements.filter(e => e.syncId).map(e => e.syncId))).size;

console.log('=== SQLite ↔ JSON Conversion Benchmark ===');
console.log(`  ${presentation.slides.length} slides, ${totalElements} element refs, ${syncedCount} synced groups`);
console.log();

// fromJSON: write presentation into SQLite
console.log('--- fromJSON (Presentation → SQLite) ---');
const db1Path = '/tmp/bench-convert-1.db';
if (existsSync(db1Path)) unlinkSync(db1Path);
const db1 = new Database(db1Path);
createSchema(db1);

bench('fromJSON (250 slides)', 50, () => {
  db1.exec('DELETE FROM presentation; DELETE FROM slides; DELETE FROM elements; DELETE FROM slide_elements;');
  fromJSON(db1, presentation, new Date().toISOString());
});

// Verify data
const dbElementCount = db1.prepare('SELECT COUNT(*) as n FROM elements WHERE valid_to IS NULL').get().n;
const dbSECount = db1.prepare('SELECT COUNT(*) as n FROM slide_elements WHERE valid_to IS NULL').get().n;
console.log(`  → ${dbElementCount} unique elements, ${dbSECount} placements`);
console.log(`  → Deduplication: ${totalElements} refs → ${dbElementCount} elements (${totalElements - dbElementCount} shared)`);
console.log();

// toJSON: read from SQLite back to JSON
console.log('--- toJSON (SQLite → Presentation) ---');

let result;
bench('toJSON (250 slides)', 100, () => {
  result = toJSON(db1);
});

console.log(`  → ${result.slides.length} slides, ${result.slides.reduce((n, s) => n + s.elements.length, 0)} elements`);
console.log();

// Round-trip verification
console.log('--- Round-trip Verification ---');
const db2Path = '/tmp/bench-convert-2.db';
if (existsSync(db2Path)) unlinkSync(db2Path);
const db2 = new Database(db2Path);
createSchema(db2);

const jsonFromDb = toJSON(db1);
fromJSON(db2, jsonFromDb, new Date().toISOString() + '-rt');
const jsonFromDb2 = toJSON(db2);

// Compare
let matches = true;
if (jsonFromDb.slides.length !== jsonFromDb2.slides.length) {
  console.log(`  ✗ Slide count mismatch: ${jsonFromDb.slides.length} vs ${jsonFromDb2.slides.length}`);
  matches = false;
}
for (let i = 0; i < Math.min(jsonFromDb.slides.length, jsonFromDb2.slides.length); i++) {
  const s1 = jsonFromDb.slides[i];
  const s2 = jsonFromDb2.slides[i];
  if (s1.elements.length !== s2.elements.length) {
    console.log(`  ✗ Slide ${i} element count: ${s1.elements.length} vs ${s2.elements.length}`);
    matches = false;
  }
}
if (jsonFromDb.title !== jsonFromDb2.title) {
  console.log(`  ✗ Title mismatch`);
  matches = false;
}
if (matches) {
  console.log('  ✓ Round-trip: SQLite → JSON → SQLite → JSON matches');
}

// Compare with original
const origJson = JSON.stringify(presentation.config);
const rtJson = JSON.stringify(jsonFromDb.config);
console.log(`  Config match: ${origJson === rtJson ? '✓' : '✗'}`);

db1.close();
db2.close();

// Full pipeline: JSON file → SQLite → toJSON → export-ready
console.log();
console.log('--- Full Pipeline ---');
const db3Path = '/tmp/bench-convert-3.db';
if (existsSync(db3Path)) unlinkSync(db3Path);
const db3 = new Database(db3Path);
createSchema(db3);

bench('Full: JSON → SQLite → toJSON', 50, () => {
  db3.exec('DELETE FROM presentation; DELETE FROM slides; DELETE FROM elements; DELETE FROM slide_elements;');
  fromJSON(db3, presentation, new Date().toISOString());
  toJSON(db3);
});

const finalSize = statSync(db3Path).size;
console.log(`  DB size: ${(finalSize / 1024).toFixed(0)} KB`);
db3.close();
