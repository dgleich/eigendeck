#!/usr/bin/env node
/**
 * Benchmark the junction-table data model (elements + slide_elements).
 *
 * Key difference from the previous model:
 * - Elements own their position (in data JSON)
 * - slide_elements is a junction table (slide_id, element_id, z_order)
 * - Sync = one element on multiple slides (multiple slide_elements rows)
 * - Edit = one UPDATE to elements table, all slides see it
 * - No sync propagation needed
 */

import { createRequire } from 'node:module';
import { existsSync, unlinkSync, statSync } from 'node:fs';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dbPath = '/tmp/bench-junction.db';
if (existsSync(dbPath)) unlinkSync(dbPath);
if (existsSync(dbPath + '-wal')) unlinkSync(dbPath + '-wal');
if (existsSync(dbPath + '-shm')) unlinkSync(dbPath + '-shm');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE presentation (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE slides (
    id TEXT NOT NULL, position INTEGER, layout TEXT, notes TEXT, group_id TEXT,
    valid_from TEXT NOT NULL, valid_to TEXT,
    PRIMARY KEY (id, valid_from)
  );

  CREATE TABLE elements (
    id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, link_id TEXT,
    valid_from TEXT NOT NULL, valid_to TEXT,
    PRIMARY KEY (id, valid_from)
  );

  CREATE TABLE slide_elements (
    slide_id TEXT NOT NULL, element_id TEXT NOT NULL, z_order INTEGER NOT NULL,
    valid_from TEXT NOT NULL, valid_to TEXT,
    PRIMARY KEY (slide_id, element_id, valid_from)
  );

  CREATE TABLE assets (
    path TEXT PRIMARY KEY, data BLOB NOT NULL, mime_type TEXT,
    size INTEGER, hash TEXT, created_at TEXT
  );

  CREATE INDEX idx_el_current ON elements(valid_to) WHERE valid_to IS NULL;
  CREATE INDEX idx_el_id ON elements(id) WHERE valid_to IS NULL;
  CREATE INDEX idx_se_slide ON slide_elements(slide_id) WHERE valid_to IS NULL;
  CREATE INDEX idx_se_element ON slide_elements(element_id) WHERE valid_to IS NULL;
  CREATE INDEX idx_slides_current ON slides(valid_to) WHERE valid_to IS NULL;
  CREATE INDEX idx_el_link ON elements(link_id) WHERE valid_to IS NULL AND link_id IS NOT NULL;
`);

let tsCounter = 0;
function ts() {
  return new Date().toISOString() + '-' + String(tsCounter++).padStart(8, '0');
}

// ============================================================================
// Populate: 250 slides, ~4 elements each, some synced across slides
// ============================================================================
const slideIds = [];
const elementIds = [];
const syncedElementIds = []; // elements that appear on multiple slides

const initTs = ts();
const populate = db.transaction(() => {
  db.prepare('INSERT INTO presentation VALUES (?, ?)').run('title', 'Junction Model Test');
  db.prepare('INSERT INTO presentation VALUES (?, ?)').run('config', '{}');

  const insSlide = db.prepare('INSERT INTO slides VALUES (?,?,?,?,?,?,NULL)');
  const insEl = db.prepare('INSERT INTO elements VALUES (?,?,?,?,?,NULL)');
  const insSE = db.prepare('INSERT INTO slide_elements VALUES (?,?,?,?,NULL)');

  // Create 50 "synced" elements (appear on 5 slides each = 250 slide_elements rows)
  for (let i = 0; i < 50; i++) {
    const eid = crypto.randomUUID();
    syncedElementIds.push(eid);
    const el = {
      id: eid, type: 'text', preset: 'title',
      html: `Synced title element ${i}`,
      position: { x: 80, y: 20, width: 1760, height: 200 },
    };
    insEl.run(eid, 'text', JSON.stringify(el), null, initTs);
  }

  // Create 250 slides
  const buildGroupIds = Array.from({ length: 10 }, () => crypto.randomUUID());
  for (let i = 0; i < 250; i++) {
    const sid = crypto.randomUUID();
    slideIds.push(sid);
    const groupId = i < 150 ? buildGroupIds[Math.floor(i / 15)] : null;
    insSlide.run(sid, i, 'default', `Notes ${i}`, groupId, initTs);

    // Add the synced element for this slide's group
    const syncIdx = Math.floor(i / 5);
    if (syncIdx < syncedElementIds.length) {
      insSE.run(sid, syncedElementIds[syncIdx], 0, initTs);
    }

    // Add 3-5 unique elements per slide
    const numUnique = 3 + Math.floor(Math.random() * 3);
    for (let j = 0; j < numUnique; j++) {
      const eid = crypto.randomUUID();
      elementIds.push(eid);
      const el = {
        id: eid, type: 'text', preset: 'body',
        html: `Element ${j} on slide ${i}: $x^2 + y^2$`,
        position: { x: 80 + j * 200, y: 240 + j * 150, width: 600, height: 200 },
      };
      insEl.run(eid, 'text', JSON.stringify(el), null, initTs);
      insSE.run(sid, eid, j + 1, initTs);
    }
  }

  // Add some assets
  const insAsset = db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)');
  for (let i = 0; i < 20; i++) {
    insAsset.run(`images/img-${i}.png`, Buffer.alloc(100 * 1024, i), 'image/png', 100 * 1024, null, initTs);
  }
});
populate();

// Generate some history (50 edits)
const historyTx = db.transaction(() => {
  const close = db.prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL');
  const ins = db.prepare('INSERT INTO elements VALUES (?,?,?,?,?,NULL)');
  for (let i = 0; i < 50; i++) {
    const eid = elementIds[i * 15 % elementIds.length];
    const row = db.prepare('SELECT * FROM elements WHERE id = ? AND valid_to IS NULL').get(eid);
    if (!row) continue;
    const t = ts();
    close.run(t, eid);
    const data = JSON.parse(row.data);
    data.html = `Edited v${i}`;
    ins.run(eid, row.type, JSON.stringify(data), row.link_id, t);
  }
});
historyTx();

const stats = {
  slides: db.prepare('SELECT COUNT(*) as n FROM slides WHERE valid_to IS NULL').get().n,
  elements: db.prepare('SELECT COUNT(*) as n FROM elements WHERE valid_to IS NULL').get().n,
  slideElements: db.prepare('SELECT COUNT(*) as n FROM slide_elements WHERE valid_to IS NULL').get().n,
  totalVersions: db.prepare('SELECT COUNT(*) as n FROM elements').get().n,
  syncedCount: syncedElementIds.length,
};

console.log('=== Junction Model Benchmark ===');
console.log(`  ${stats.slides} slides, ${stats.elements} elements, ${stats.slideElements} placements`);
console.log(`  ${stats.syncedCount} synced elements (each on ~5 slides)`);
console.log(`  ${stats.totalVersions} total element versions`);
console.log(`  DB size: ${(statSync(dbPath).size / 1024).toFixed(0)} KB`);
console.log();

// ============================================================================
// Prepared statements
// ============================================================================
const S = {
  // Load slide: JOIN elements through slide_elements
  loadSlide: db.prepare(`
    SELECT e.id, e.type, e.data, e.link_id, se.z_order
    FROM slide_elements se
    JOIN elements e ON e.id = se.element_id AND e.valid_to IS NULL
    WHERE se.slide_id = ? AND se.valid_to IS NULL
    ORDER BY se.z_order
  `),

  // Load all slides metadata
  allSlides: db.prepare('SELECT id, position, layout, notes, group_id FROM slides WHERE valid_to IS NULL ORDER BY position'),

  // Load all slides with element count (for sidebar)
  allSlidesWithCount: db.prepare(`
    SELECT s.id, s.position, s.layout, s.group_id,
      (SELECT COUNT(*) FROM slide_elements se WHERE se.slide_id = s.id AND se.valid_to IS NULL) as el_count
    FROM slides s WHERE s.valid_to IS NULL ORDER BY s.position
  `),

  // Get element by ID
  getElement: db.prepare('SELECT id, type, data, link_id FROM elements WHERE id = ? AND valid_to IS NULL'),

  // Which slides is this element on?
  elementSlides: db.prepare('SELECT slide_id FROM slide_elements WHERE element_id = ? AND valid_to IS NULL'),

  // Update element (close + insert)
  closeElement: db.prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL'),
  insertElement: db.prepare('INSERT INTO elements VALUES (?,?,?,?,?,NULL)'),

  // Add element to slide
  addToSlide: db.prepare('INSERT INTO slide_elements VALUES (?,?,?,?,NULL)'),

  // Remove element from slide
  removeFromSlide: db.prepare('UPDATE slide_elements SET valid_to = ? WHERE slide_id = ? AND element_id = ? AND valid_to IS NULL'),

  // Duplicate slide (copy all slide_elements)
  dupSlideElements: db.prepare(`
    INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from)
    SELECT ?, element_id, z_order, ?
    FROM slide_elements WHERE slide_id = ? AND valid_to IS NULL
  `),

  // History
  getTimestamps: db.prepare('SELECT DISTINCT valid_from FROM elements ORDER BY valid_from DESC LIMIT ?'),
  loadSlideAtTime: db.prepare(`
    SELECT e.id, e.type, e.data, e.link_id, se.z_order
    FROM slide_elements se
    JOIN elements e ON e.id = se.element_id
      AND e.valid_from <= ? AND (e.valid_to IS NULL OR e.valid_to > ?)
    WHERE se.slide_id = ?
      AND se.valid_from <= ? AND (se.valid_to IS NULL OR se.valid_to > ?)
    ORDER BY se.z_order
  `),
};

// ============================================================================
// Benchmark harness
// ============================================================================
const results = {};
function bench(name, iterations, fn) {
  for (let i = 0; i < Math.min(10, iterations); i++) fn();
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  results[name] = { median, p95, p99, mean, iterations };
  console.log(`  ${name}`);
  console.log(`    median: ${median.toFixed(3)}ms  p95: ${p95.toFixed(3)}ms  p99: ${p99.toFixed(3)}ms`);
}

const testSlideId = slideIds[50];
const testElementId = elementIds[200];
const testSyncedId = syncedElementIds[10];

// ============================================================================
// Read operations
// ============================================================================
console.log('--- Read Operations ---');

bench('load_slide_elements (JOIN)', 5000, () => {
  S.loadSlide.all(testSlideId);
});

bench('get_element_by_id', 10000, () => {
  S.getElement.get(testElementId);
});

bench('get_element_slides (which slides?)', 5000, () => {
  S.elementSlides.all(testSyncedId);
});

bench('load_all_slides_metadata', 2000, () => {
  S.allSlides.all();
});

bench('load_all_slides_with_el_count', 1000, () => {
  S.allSlidesWithCount.all();
});

bench('load_all_slides_with_elements', 100, () => {
  const slides = S.allSlides.all();
  for (const s of slides) S.loadSlide.all(s.id);
});

// ============================================================================
// Write operations
// ============================================================================
console.log();
console.log('--- Write Operations ---');

bench('edit_element (one write, all slides see it)', 2000, () => {
  const t = ts();
  const row = S.getElement.get(testElementId);
  const txn = db.transaction(() => {
    S.closeElement.run(t, testElementId);
    S.insertElement.run(testElementId, row.type, row.data, row.link_id, t);
  });
  txn();
});

bench('edit_synced_element (one write, 5 slides see it)', 2000, () => {
  const t = ts();
  const row = S.getElement.get(testSyncedId);
  const txn = db.transaction(() => {
    S.closeElement.run(t, testSyncedId);
    S.insertElement.run(testSyncedId, row.type, row.data, row.link_id, t);
  });
  txn();
});

bench('add_element_to_slide', 2000, () => {
  const t = ts();
  const newId = crypto.randomUUID();
  const txn = db.transaction(() => {
    S.insertElement.run(newId, 'text', '{"id":"new"}', null, t);
    S.addToSlide.run(testSlideId, newId, 99, t);
  });
  txn();
});

bench('remove_element_from_slide', 2000, () => {
  const t = ts();
  // Remove the last added
  const last = db.prepare('SELECT element_id FROM slide_elements WHERE slide_id = ? AND valid_to IS NULL ORDER BY z_order DESC LIMIT 1').get(testSlideId);
  if (last) S.removeFromSlide.run(t, testSlideId, last.element_id);
});

bench('duplicate_slide (copy all refs)', 500, () => {
  const t = ts();
  const newSlideId = crypto.randomUUID();
  const txn = db.transaction(() => {
    db.prepare('INSERT INTO slides VALUES (?,?,?,?,?,?,NULL)').run(newSlideId, 999, 'default', '', null, t);
    S.dupSlideElements.run(newSlideId, t, testSlideId);
  });
  txn();
});

bench('free_synced_element (duplicate + repoint)', 500, () => {
  const t = ts();
  const row = S.getElement.get(testSyncedId);
  if (!row) return;
  const slides = S.elementSlides.all(testSyncedId);
  if (slides.length < 2) return;
  const targetSlide = slides[0].slide_id;
  const newId = crypto.randomUUID();
  const txn = db.transaction(() => {
    // Create copy of element
    S.insertElement.run(newId, row.type, row.data, testSyncedId, t); // link_id for animation
    // Remove old reference
    S.removeFromSlide.run(t, targetSlide, testSyncedId);
    // Add new reference
    S.addToSlide.run(targetSlide, newId, 0, t);
  });
  txn();
});

// ============================================================================
// History operations
// ============================================================================
console.log();
console.log('--- History Operations ---');

bench('get_history_timestamps', 2000, () => {
  S.getTimestamps.all(50);
});

bench('load_slide_at_past_time', 500, () => {
  const timestamps = S.getTimestamps.all(20);
  if (timestamps.length > 10) {
    const t = timestamps[10].valid_from;
    S.loadSlideAtTime.all(t, t, testSlideId, t, t);
  }
});

// ============================================================================
// Compare: synced edit - old model vs new model
// ============================================================================
console.log();
console.log('--- Sync Comparison ---');
console.log(`  Old model: edit synced element → close+insert for EACH of N copies`);
console.log(`  New model: edit synced element → close+insert ONCE (junction handles it)`);
const syncSlideCount = S.elementSlides.all(testSyncedId).length;
console.log(`  Synced element appears on ${syncSlideCount} slides`);

bench('NEW: edit synced (1 write)', 2000, () => {
  const t = ts();
  const row = S.getElement.get(testSyncedId);
  const txn = db.transaction(() => {
    S.closeElement.run(t, testSyncedId);
    S.insertElement.run(testSyncedId, row.type, row.data, row.link_id, t);
  });
  txn();
});

bench('OLD: edit synced (N writes, simulated)', 2000, () => {
  const t = ts();
  const row = S.getElement.get(testSyncedId);
  // Simulate old model: close+insert for each of N copies
  const txn = db.transaction(() => {
    for (let i = 0; i < syncSlideCount; i++) {
      const fakeId = `fake-${testSyncedId}-${i}`;
      // Just measure the write cost (using the same prepared stmts)
      db.prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(t, fakeId);
      db.prepare('INSERT OR IGNORE INTO elements VALUES (?,?,?,?,?,NULL)').run(fakeId, row.type, row.data, row.link_id, t);
    }
  });
  txn();
});

// ============================================================================
// Summary
// ============================================================================
console.log();
console.log('--- Summary ---');
db.pragma('wal_checkpoint(TRUNCATE)');
const finalSize = statSync(dbPath).size;
const finalVersions = db.prepare('SELECT COUNT(*) as n FROM elements').get().n;
const finalCurrent = db.prepare('SELECT COUNT(*) as n FROM elements WHERE valid_to IS NULL').get().n;
console.log(`  DB size: ${(finalSize / 1024).toFixed(0)} KB`);
console.log(`  Element versions: ${finalVersions} (${finalCurrent} current)`);
const maxP99 = Math.max(...Object.values(results).map(r => r.p99));
console.log(`  Worst p99: ${maxP99.toFixed(3)}ms`);

db.close();
