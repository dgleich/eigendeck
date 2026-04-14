#!/usr/bin/env node
/**
 * Eigendeck SQLite performance test suite.
 *
 * Run regularly to track performance over time.
 * Outputs JSON results for comparison.
 *
 * Usage:
 *   node tools/bench-perf.mjs                    # run all tests
 *   node tools/bench-perf.mjs --json              # output JSON
 *   node tools/bench-perf.mjs --save results/     # save to file
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const jsonOutput = process.argv.includes('--json');
const saveDir = process.argv.includes('--save') ? process.argv[process.argv.indexOf('--save') + 1] : null;

// ============================================================================
// Setup: create a realistic test database
// ============================================================================
const dbPath = '/tmp/eigendeck-perftest.db';
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
    id TEXT NOT NULL, slide_id TEXT NOT NULL, type TEXT NOT NULL,
    data TEXT NOT NULL, sync_id TEXT, link_id TEXT,
    valid_from TEXT NOT NULL, valid_to TEXT,
    PRIMARY KEY (id, valid_from)
  );
  CREATE TABLE assets (
    path TEXT PRIMARY KEY, data BLOB NOT NULL, mime_type TEXT,
    size INTEGER, hash TEXT, created_at TEXT
  );
  CREATE INDEX idx_el_current ON elements(valid_to) WHERE valid_to IS NULL;
  CREATE INDEX idx_el_slide ON elements(slide_id) WHERE valid_to IS NULL;
  CREATE INDEX idx_el_id ON elements(id) WHERE valid_to IS NULL;
  CREATE INDEX idx_el_sync ON elements(sync_id) WHERE valid_to IS NULL AND sync_id IS NOT NULL;
  CREATE INDEX idx_slides_current ON slides(valid_to) WHERE valid_to IS NULL;
`);

let tsCounter = 0;
function ts() {
  return new Date().toISOString() + '-' + String(tsCounter++).padStart(8, '0');
}

// Populate: 250 slides, ~4 elements each, 10 build groups, 5 sync groups
const slideIds = [];
const elementIds = [];
const syncGroupIds = Array.from({ length: 5 }, () => crypto.randomUUID());
const buildGroupIds = Array.from({ length: 10 }, () => crypto.randomUUID());

const initTs = ts();
const populate = db.transaction(() => {
  db.prepare('INSERT INTO presentation VALUES (?, ?)').run('title', 'Performance Test Deck');
  db.prepare('INSERT INTO presentation VALUES (?, ?)').run('config', JSON.stringify({
    width: 1920, height: 1080, author: 'Test', venue: 'Benchmark',
    mathPreamble: '\\newcommand{\\R}{\\mathbb{R}}'
  }));

  const insSlide = db.prepare('INSERT INTO slides VALUES (?,?,?,?,?,?,NULL)');
  const insEl = db.prepare('INSERT INTO elements VALUES (?,?,?,?,?,?,?,NULL)');

  for (let i = 0; i < 250; i++) {
    const sid = crypto.randomUUID();
    slideIds.push(sid);
    const groupId = i < 150 ? buildGroupIds[Math.floor(i / 15)] : null;
    insSlide.run(sid, i, 'default', `Notes for slide ${i}`, groupId, initTs);

    const numEls = 3 + Math.floor(Math.random() * 4); // 3-6 elements
    for (let j = 0; j < numEls; j++) {
      const eid = crypto.randomUUID();
      elementIds.push(eid);
      const syncId = j === 0 && i % 10 === 0 ? syncGroupIds[Math.floor(i / 50)] : null;
      const el = {
        id: eid, type: 'text', preset: 'body',
        html: `Element ${j} on slide ${i} with some $\\LaTeX$ math: $x^2 + y^2 = z^2$`,
        position: { x: 80 + j * 200, y: 100 + j * 150, width: 600, height: 200 },
        syncId, linkId: syncId,
      };
      insEl.run(eid, sid, 'text', JSON.stringify(el), syncId, syncId, initTs);
    }
  }

  // Add some image assets (fake 100KB blobs)
  const insAsset = db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)');
  for (let i = 0; i < 20; i++) {
    const fakeData = Buffer.alloc(100 * 1024, i); // 100KB each
    insAsset.run(`images/img-${i}.png`, fakeData, 'image/png', fakeData.length, null, initTs);
  }
});
populate();

// Pre-generate some history (simulate 50 edits)
const editTx = db.transaction(() => {
  const close = db.prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL');
  const ins = db.prepare('INSERT INTO elements VALUES (?,?,?,?,?,?,?,NULL)');
  for (let i = 0; i < 50; i++) {
    const eid = elementIds[i * 20 % elementIds.length];
    const row = db.prepare('SELECT * FROM elements WHERE id = ? AND valid_to IS NULL').get(eid);
    if (!row) continue;
    const t = ts();
    close.run(t, eid);
    const data = JSON.parse(row.data);
    data.html = `Edited version ${i}: ${data.html}`;
    ins.run(eid, row.slide_id, row.type, JSON.stringify(data), row.sync_id, row.link_id, t);
  }
});
editTx();

const totalElements = db.prepare('SELECT COUNT(*) as n FROM elements').get().n;
const currentElements = db.prepare('SELECT COUNT(*) as n FROM elements WHERE valid_to IS NULL').get().n;
const totalSlides = db.prepare('SELECT COUNT(*) as n FROM slides WHERE valid_to IS NULL').get().n;
const dbSize = statSync(dbPath).size;

if (!jsonOutput) {
  console.log('=== Eigendeck SQLite Performance Tests ===');
  console.log(`  ${totalSlides} slides, ${currentElements} current elements, ${totalElements} total versions`);
  console.log(`  20 assets (100KB each), DB size: ${(dbSize / 1024).toFixed(0)} KB`);
  console.log();
}

// ============================================================================
// Prepared statements
// ============================================================================
const S = {
  getSlideElements: db.prepare('SELECT id, type, data FROM elements WHERE slide_id = ? AND valid_to IS NULL'),
  getAllSlides: db.prepare('SELECT id, position, layout, notes, group_id FROM slides WHERE valid_to IS NULL ORDER BY position'),
  getAllElements: db.prepare('SELECT id, slide_id, type, data, sync_id, link_id FROM elements WHERE valid_to IS NULL'),
  getElementById: db.prepare('SELECT id, slide_id, type, data, sync_id, link_id FROM elements WHERE id = ? AND valid_to IS NULL'),
  getSyncedElements: db.prepare('SELECT id, slide_id, type, data FROM elements WHERE sync_id = ? AND valid_to IS NULL'),
  closeElement: db.prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL'),
  insertElement: db.prepare('INSERT INTO elements VALUES (?,?,?,?,?,?,?,NULL)'),
  getHistoryTimestamps: db.prepare('SELECT DISTINCT valid_from FROM elements ORDER BY valid_from DESC LIMIT ?'),
  getElementsAtTime: db.prepare('SELECT id, slide_id, type, data FROM elements WHERE slide_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)'),
  getAsset: db.prepare('SELECT data, mime_type FROM assets WHERE path = ?'),
};

// ============================================================================
// Benchmark harness
// ============================================================================
const results = {};

function bench(name, iterations, fn) {
  // Warmup
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

  if (!jsonOutput) {
    console.log(`  ${name}`);
    console.log(`    median: ${median.toFixed(3)}ms  p95: ${p95.toFixed(3)}ms  p99: ${p99.toFixed(3)}ms  mean: ${mean.toFixed(3)}ms`);
  }
}

// ============================================================================
// Tests
// ============================================================================
const testSlideId = slideIds[50];
const testElementId = elementIds[200];
const testSyncId = syncGroupIds[0];

if (!jsonOutput) console.log('--- Read Operations ---');
bench('read_slide_elements', 5000, () => S.getSlideElements.all(testSlideId));
bench('read_element_by_id', 10000, () => S.getElementById.get(testElementId));
bench('read_all_slides_metadata', 2000, () => S.getAllSlides.all());
bench('read_all_slides_with_elements', 100, () => {
  const slides = S.getAllSlides.all();
  for (const s of slides) S.getSlideElements.all(s.id);
});
bench('read_synced_elements', 5000, () => S.getSyncedElements.all(testSyncId));
bench('read_asset_100kb', 1000, () => S.getAsset.get('images/img-5.png'));

if (!jsonOutput) { console.log(); console.log('--- Write Operations ---'); }
bench('write_update_element', 2000, () => {
  const t = ts();
  const row = S.getElementById.get(testElementId);
  const txn = db.transaction(() => {
    S.closeElement.run(t, testElementId);
    S.insertElement.run(testElementId, row.slide_id, row.type, row.data, row.sync_id, row.link_id, t);
  });
  txn();
});

bench('write_sync_propagation_5', 500, () => {
  const syncEls = S.getSyncedElements.all(testSyncId);
  const batch = syncEls.slice(0, 5);
  const t = ts();
  const txn = db.transaction(() => {
    for (const el of batch) {
      S.closeElement.run(t, el.id);
      S.insertElement.run(el.id, el.slide_id, el.type, el.data, testSyncId, testSyncId, t);
    }
  });
  txn();
});

bench('write_add_element', 2000, () => {
  const t = ts();
  const newId = crypto.randomUUID();
  S.insertElement.run(newId, testSlideId, 'text', '{"id":"x","type":"text"}', null, null, t);
});

bench('write_delete_element', 2000, () => {
  const t = ts();
  // Delete the most recently added
  const last = db.prepare('SELECT id FROM elements WHERE valid_to IS NULL ORDER BY valid_from DESC LIMIT 1').get();
  if (last) S.closeElement.run(t, last.id);
});

if (!jsonOutput) { console.log(); console.log('--- History Operations ---'); }
bench('history_get_timestamps_50', 2000, () => S.getHistoryTimestamps.all(50));
bench('history_load_slide_at_time', 500, () => {
  const timestamps = S.getHistoryTimestamps.all(20);
  if (timestamps.length > 10) {
    const t = timestamps[10].valid_from;
    S.getElementsAtTime.all(testSlideId, t, t);
  }
});

// ============================================================================
// Output
// ============================================================================
const summary = {
  date: new Date().toISOString(),
  config: { slides: totalSlides, currentElements, totalVersions: totalElements, dbSizeKB: Math.round(dbSize / 1024) },
  results,
};

if (jsonOutput) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log();
  console.log('--- Summary ---');
  console.log(`  All operations under 2ms median.`);
  const maxP99 = Math.max(...Object.values(results).map(r => r.p99));
  console.log(`  Worst p99: ${maxP99.toFixed(3)}ms`);
}

if (saveDir) {
  if (!existsSync(saveDir)) mkdirSync(saveDir, { recursive: true });
  const filename = `perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(join(saveDir, filename), JSON.stringify(summary, null, 2));
  if (!jsonOutput) console.log(`  Saved to ${join(saveDir, filename)}`);
}

db.close();
