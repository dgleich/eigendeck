#!/usr/bin/env node
/**
 * Benchmark WAL vs DELETE journal mode.
 *
 * Tests the same operations under both modes to quantify the performance
 * cost of avoiding sidecar files.
 */

import { createRequire } from 'node:module';
import { existsSync, unlinkSync, statSync, readdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let tsCounter = 0;
function ts() {
  return new Date().toISOString() + '-' + String(tsCounter++).padStart(8, '0');
}

function runBenchmark(mode) {
  const dbPath = `/tmp/bench-${mode}.db`;
  for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (existsSync(f)) unlinkSync(f);
  }

  const db = new Database(dbPath);
  db.pragma(`journal_mode = ${mode}`);
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
    CREATE INDEX idx_el_current ON elements(valid_to) WHERE valid_to IS NULL;
    CREATE INDEX idx_el_id ON elements(id) WHERE valid_to IS NULL;
    CREATE INDEX idx_se_slide ON slide_elements(slide_id) WHERE valid_to IS NULL;
    CREATE INDEX idx_slides_current ON slides(valid_to) WHERE valid_to IS NULL;
  `);

  // Populate 250 slides
  const slideIds = [];
  const elementIds = [];
  const initT = ts();

  const populate = db.transaction(() => {
    db.prepare('INSERT INTO presentation VALUES (?,?)').run('title', 'Test');
    const insSlide = db.prepare('INSERT INTO slides VALUES (?,?,?,?,?,?,NULL)');
    const insEl = db.prepare('INSERT INTO elements VALUES (?,?,?,?,?,NULL)');
    const insSE = db.prepare('INSERT INTO slide_elements VALUES (?,?,?,?,NULL)');

    for (let i = 0; i < 250; i++) {
      const sid = crypto.randomUUID();
      slideIds.push(sid);
      insSlide.run(sid, i, 'default', `Notes ${i}`, null, initT);

      for (let j = 0; j < 4; j++) {
        const eid = crypto.randomUUID();
        elementIds.push(eid);
        insEl.run(eid, 'text', JSON.stringify({
          id: eid, type: 'text', html: `El ${j}`,
          position: { x: j * 200, y: 200, width: 400, height: 200 }
        }), null, initT);
        insSE.run(sid, eid, j, initT);
      }
    }
  });
  populate();

  // Prepare statements
  const S = {
    loadSlide: db.prepare(`
      SELECT e.id, e.type, e.data FROM slide_elements se
      JOIN elements e ON e.id = se.element_id AND e.valid_to IS NULL
      WHERE se.slide_id = ? AND se.valid_to IS NULL ORDER BY se.z_order
    `),
    allSlides: db.prepare('SELECT id, position FROM slides WHERE valid_to IS NULL ORDER BY position'),
    getElement: db.prepare('SELECT id, type, data FROM elements WHERE id = ? AND valid_to IS NULL'),
    closeElement: db.prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL'),
    insertElement: db.prepare('INSERT INTO elements VALUES (?,?,?,?,?,NULL)'),
    addToSlide: db.prepare('INSERT INTO slide_elements VALUES (?,?,?,?,NULL)'),
    removeFromSlide: db.prepare('UPDATE slide_elements SET valid_to = ? WHERE slide_id = ? AND element_id = ? AND valid_to IS NULL'),
  };

  const testSlide = slideIds[50];
  const testElement = elementIds[200];

  // Benchmark
  function bench(name, iterations, fn) {
    for (let i = 0; i < 5; i++) fn();
    const times = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      fn();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return {
      median: times[Math.floor(times.length / 2)],
      p95: times[Math.floor(times.length * 0.95)],
      p99: times[Math.floor(times.length * 0.99)],
    };
  }

  const results = {};

  results.read_slide = bench('read_slide', 5000, () => S.loadSlide.all(testSlide));
  results.read_element = bench('read_element', 10000, () => S.getElement.get(testElement));
  results.read_all_slides = bench('read_all_slides', 1000, () => S.allSlides.all());

  results.write_element = bench('write_element', 2000, () => {
    const t = ts();
    const row = S.getElement.get(testElement);
    const txn = db.transaction(() => {
      S.closeElement.run(t, testElement);
      S.insertElement.run(testElement, 'text', row.data, null, t);
    });
    txn();
  });

  results.write_add = bench('write_add', 2000, () => {
    const t = ts();
    const newId = crypto.randomUUID();
    const txn = db.transaction(() => {
      S.insertElement.run(newId, 'text', '{}', null, t);
      S.addToSlide.run(testSlide, newId, 99, t);
    });
    txn();
  });

  results.write_delete = bench('write_delete', 2000, () => {
    const t = ts();
    const last = db.prepare('SELECT element_id FROM slide_elements WHERE slide_id = ? AND valid_to IS NULL ORDER BY z_order DESC LIMIT 1').get(testSlide);
    if (last) S.removeFromSlide.run(t, testSlide, last.element_id);
  });

  // Burst: 10 rapid writes (simulates typing or rapid edits)
  results.burst_10_writes = bench('burst_10_writes', 200, () => {
    const txn = db.transaction(() => {
      for (let i = 0; i < 10; i++) {
        const t = ts();
        const row = S.getElement.get(testElement);
        S.closeElement.run(t, testElement);
        S.insertElement.run(testElement, 'text', row.data, null, t);
      }
    });
    txn();
  });

  // Burst: 10 writes NOT in a transaction (worst case)
  results.burst_10_no_txn = bench('burst_10_no_txn', 50, () => {
    for (let i = 0; i < 10; i++) {
      const t = ts();
      const row = S.getElement.get(testElement);
      S.closeElement.run(t, testElement);
      S.insertElement.run(testElement, 'text', row.data, null, t);
    }
  });

  // Check files on disk
  const dir = '/tmp/';
  const files = readdirSync(dir).filter(f => f.startsWith(`bench-${mode}`));

  db.close();

  const mainSize = existsSync(dbPath) ? statSync(dbPath).size : 0;

  return { results, files, mainSize };
}

// Run both
console.log('=== WAL vs DELETE Journal Mode ===');
console.log('  250 slides, 1000 elements');
console.log();

const wal = runBenchmark('WAL');
const del = runBenchmark('DELETE');

// Compare
console.log('                            WAL              DELETE           Ratio');
console.log('                            --------         --------         -----');

for (const key of Object.keys(wal.results)) {
  const w = wal.results[key];
  const d = del.results[key];
  const ratio = d.median / w.median;
  const label = key.padEnd(26);
  console.log(`  ${label}  ${w.median.toFixed(3)}ms (p99:${w.p99.toFixed(1)})  ${d.median.toFixed(3)}ms (p99:${d.p99.toFixed(1)})  ${ratio.toFixed(1)}x`);
}

console.log();
console.log('  Files on disk:');
console.log(`    WAL:    ${wal.files.join(', ')} (${(wal.mainSize/1024).toFixed(0)} KB main)`);
console.log(`    DELETE: ${del.files.join(', ')} (${(del.mainSize/1024).toFixed(0)} KB main)`);
