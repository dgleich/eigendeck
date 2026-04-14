#!/usr/bin/env node
/**
 * Benchmark the SQLite temporal data model for UI-critical operations.
 *
 * Tests the operations the editor does constantly:
 * 1. Load one slide's elements (slide switch)
 * 2. Update one element's position (drag at 60fps)
 * 3. Sync propagation (move synced element → update all copies)
 * 4. Text edit commit
 * 5. Add/delete element
 * 6. Undo: restore to a specific timestamp
 * 7. Load all slides for sidebar thumbnails
 * 8. Query element by ID (selection)
 */

import { createRequire } from 'node:module';
import { readFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const projectDir = resolve(process.argv[2] || '/work/examples/magnetic-powers');
const presentation = JSON.parse(readFileSync(join(projectDir, 'presentation.json'), 'utf8'));

// Build a 250-slide presentation with build groups (up to 25 slides each)
const origSlides = [...presentation.slides];
while (presentation.slides.length < 250) {
  for (const s of origSlides) {
    if (presentation.slides.length >= 250) break;
    presentation.slides.push({
      ...JSON.parse(JSON.stringify(s)),
      id: crypto.randomUUID(),
      elements: s.elements.map(el => ({
        ...JSON.parse(JSON.stringify(el)),
        id: crypto.randomUUID(),
        syncId: el.syncId,
        linkId: el.linkId,
      })),
    });
  }
}

// Create 10 build groups of varying length (5-25 slides each)
const groupSizes = [5, 8, 10, 12, 15, 18, 20, 22, 25, 10];
let slideIdx = 0;
for (const size of groupSizes) {
  const groupId = crypto.randomUUID();
  for (let g = 0; g < size && slideIdx < presentation.slides.length; g++, slideIdx++) {
    presentation.slides[slideIdx].groupId = groupId;
  }
  slideIdx += 5; // gap between groups
}

// Add some synced elements (same syncId across 20 slides)
const syncTestId = 'sync-test-' + crypto.randomUUID().slice(0, 8);
for (let i = 0; i < 20; i++) {
  const slide = presentation.slides[i * 5];
  slide.elements.push({
    id: crypto.randomUUID(),
    type: 'text',
    preset: 'body',
    html: 'Synced element',
    position: { x: 100, y: 100, width: 400, height: 200 },
    syncId: syncTestId,
    linkId: syncTestId,
  });
}

console.log(`Presentation: ${presentation.slides.length} slides, ${presentation.slides.reduce((n, s) => n + s.elements.length, 0)} elements`);
console.log(`Synced elements with syncId ${syncTestId.slice(0, 12)}: 20 across 20 slides`);
console.log();

// ============================================================================
// Setup SQLite
// ============================================================================
const dbPath = '/tmp/bench-datamodel.db';
if (existsSync(dbPath)) unlinkSync(dbPath);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE presentation (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE slides (
    id TEXT NOT NULL,
    position INTEGER,
    layout TEXT,
    notes TEXT,
    group_id TEXT,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    PRIMARY KEY (id, valid_from)
  );

  CREATE TABLE elements (
    id TEXT NOT NULL,
    slide_id TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    sync_id TEXT,
    link_id TEXT,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    PRIMARY KEY (id, valid_from)
  );

  -- Indexes for common access patterns
  CREATE INDEX idx_el_current ON elements(valid_to) WHERE valid_to IS NULL;
  CREATE INDEX idx_el_slide ON elements(slide_id) WHERE valid_to IS NULL;
  CREATE INDEX idx_el_sync ON elements(sync_id) WHERE valid_to IS NULL AND sync_id IS NOT NULL;
  CREATE INDEX idx_el_id_current ON elements(id) WHERE valid_to IS NULL;
  CREATE INDEX idx_slides_current ON slides(valid_to) WHERE valid_to IS NULL;
`);

// High-resolution timestamp generator (avoids collisions in tight loops)
let tsCounter = 0;
function ts() {
  return new Date().toISOString() + '-' + String(tsCounter++).padStart(8, '0');
}

// Populate
const initTs = ts();
const tx = db.transaction(() => {
  db.prepare('INSERT INTO presentation VALUES (?, ?)').run('title', presentation.title);
  db.prepare('INSERT INTO presentation VALUES (?, ?)').run('config', JSON.stringify(presentation.config));

  const insSlide = db.prepare('INSERT INTO slides VALUES (?,?,?,?,?,?,NULL)');
  const insEl = db.prepare('INSERT INTO elements VALUES (?,?,?,?,?,?,?,NULL)');

  for (let i = 0; i < presentation.slides.length; i++) {
    const s = presentation.slides[i];
    insSlide.run(s.id, i, s.layout || 'default', s.notes || '', s.groupId || null, initTs);
    for (const el of s.elements) {
      insEl.run(el.id, s.id, el.type, JSON.stringify(el), el.syncId || null, el.linkId || null, initTs);
    }
  }
});
tx();

const totalElements = db.prepare('SELECT COUNT(*) as n FROM elements WHERE valid_to IS NULL').get().n;
console.log(`DB populated: ${totalElements} current elements`);
console.log(`DB size: ${(statSync(dbPath).size / 1024).toFixed(0)} KB`);
console.log();

// ============================================================================
// Prepare statements (done once, reused — this is how the app would work)
// ============================================================================
const stmts = {
  getSlideElements: db.prepare('SELECT id, type, data FROM elements WHERE slide_id = ? AND valid_to IS NULL'),
  getAllSlides: db.prepare('SELECT id, position, layout, notes, group_id FROM slides WHERE valid_to IS NULL ORDER BY position'),
  getElementById: db.prepare('SELECT id, slide_id, type, data, sync_id, link_id FROM elements WHERE id = ? AND valid_to IS NULL'),
  getSyncedElements: db.prepare('SELECT id, slide_id, type, data FROM elements WHERE sync_id = ? AND valid_to IS NULL'),
  closeElement: db.prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL'),
  insertElement: db.prepare('INSERT INTO elements VALUES (?,?,?,?,?,?,?,NULL)'),
  deleteElement: db.prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL'),
  getHistoryTimestamps: db.prepare('SELECT DISTINCT valid_from FROM elements ORDER BY valid_from DESC LIMIT ?'),
  getElementsAtTime: db.prepare('SELECT id, slide_id, type, data FROM elements WHERE slide_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)'),
};

// ============================================================================
// Benchmarks
// ============================================================================
function bench(label, iterations, fn) {
  // Warmup
  for (let i = 0; i < 3; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const total = performance.now() - start;
  const per = total / iterations;
  const fps = 1000 / per;
  console.log(`  ${label}: ${per.toFixed(3)}ms per op (${iterations} iterations, ${fps > 120 ? '>' : ''}${Math.min(fps, 9999).toFixed(0)} ops/sec)`);
  return per;
}

const testSlideId = presentation.slides[10].id;
const testElement = presentation.slides[10].elements[0];

console.log('=== 1. Load one slide elements (slide switch) ===');
bench('Load slide (3-4 elements)', 1000, () => {
  stmts.getSlideElements.all(testSlideId);
});

const heavySlideId = presentation.slides.find(s => s.elements.length > 5)?.id || testSlideId;
bench('Load heavy slide (5+ elements)', 1000, () => {
  stmts.getSlideElements.all(heavySlideId);
});

console.log();
console.log('=== 2. Update element position (drag at 60fps) ===');
bench('Update position (close+insert)', 1000, () => {
  const now = ts();
  const el = testElement;
  const data = JSON.stringify({ ...el, position: { x: Math.random() * 1920, y: Math.random() * 1080, width: 400, height: 200 } });
  const txn = db.transaction(() => {
    stmts.closeElement.run(now, el.id);
    stmts.insertElement.run(el.id, testSlideId, el.type, data, el.syncId || null, el.linkId || null, now);
  });
  txn();
});

console.log();
console.log('=== 3. Sync propagation (update 20 synced elements) ===');
bench('Find synced elements', 1000, () => {
  stmts.getSyncedElements.all(syncTestId);
});

bench('Update all 20 synced elements', 100, () => {
  const now = ts();
  const syncEls = stmts.getSyncedElements.all(syncTestId);
  const txn = db.transaction(() => {
    for (const sel of syncEls) {
      const updated = JSON.parse(sel.data);
      updated.position = { x: 150, y: 150, width: 400, height: 200 };
      stmts.closeElement.run(now, sel.id);
      stmts.insertElement.run(sel.id, sel.slide_id, sel.type, JSON.stringify(updated), syncTestId, syncTestId, now);
    }
  });
  txn();
});

console.log();
console.log('=== 4. Text edit commit ===');
bench('Update HTML content', 1000, () => {
  const now = ts();
  const el = testElement;
  const data = JSON.stringify({ ...el, html: 'Edited at ' + now });
  const txn = db.transaction(() => {
    stmts.closeElement.run(now, el.id);
    stmts.insertElement.run(el.id, testSlideId, el.type, data, el.syncId || null, el.linkId || null, now);
  });
  txn();
});

console.log();
console.log('=== 5. Add/delete element ===');
let addedId = null;
bench('Add element', 500, () => {
  const now = ts();
  addedId = crypto.randomUUID();
  stmts.insertElement.run(addedId, testSlideId, 'text', JSON.stringify({ id: addedId, type: 'text', preset: 'body', html: 'New', position: { x: 0, y: 0, width: 100, height: 100 } }), null, null, now);
});

bench('Delete element', 500, () => {
  if (!addedId) return;
  const now = ts();
  stmts.deleteElement.run(now, addedId);
});

console.log();
console.log('=== 6. Undo: get state at timestamp ===');
bench('Get history timestamps (last 50)', 1000, () => {
  stmts.getHistoryTimestamps.all(50);
});

bench('Load slide at past timestamp', 100, () => {
  const timestamps = stmts.getHistoryTimestamps.all(10);
  if (timestamps.length > 5) {
    const t = timestamps[5].valid_from;
    stmts.getElementsAtTime.all(testSlideId, t, t);
  }
});

console.log();
console.log('=== 7. Load all slides (sidebar thumbnails) ===');
bench('Load all 100 slides (metadata)', 500, () => {
  stmts.getAllSlides.all();
});

bench('Load all slides + elements', 50, () => {
  const slides = stmts.getAllSlides.all();
  for (const s of slides) {
    stmts.getSlideElements.all(s.id);
  }
});

console.log();
console.log('=== 8. Get element by ID (selection) ===');
bench('Get element by ID', 10000, () => {
  stmts.getElementById.get(testElement.id);
});

// Final stats
console.log();
const versions = db.prepare('SELECT COUNT(*) as n FROM elements').get().n;
const current = db.prepare('SELECT COUNT(*) as n FROM elements WHERE valid_to IS NULL').get().n;
console.log(`=== DB Stats ===`);
console.log(`  Total element versions: ${versions}`);
console.log(`  Current elements: ${current}`);
console.log(`  History depth: ${versions - current} old versions`);
console.log(`  DB size: ${(statSync(dbPath).size / 1024).toFixed(0)} KB`);

// Compare: what if we stored elements in a denormalized way?
console.log();
console.log('=== Compare: In-memory JSON (Zustand baseline) ===');
const allSlides = presentation.slides;
bench('Read slide elements (array index)', 10000, () => {
  const slide = allSlides[10];
  const els = slide.elements;
  void els.length;
});

bench('Find element by ID (linear scan)', 10000, () => {
  const slide = allSlides[10];
  slide.elements.find(el => el.id === testElement.id);
});

bench('Find synced elements (full scan all slides)', 100, () => {
  const results = [];
  for (const s of allSlides) {
    for (const el of s.elements) {
      if (el.syncId === syncTestId) results.push(el);
    }
  }
});

db.close();
