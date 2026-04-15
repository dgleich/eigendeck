#!/usr/bin/env node
/**
 * Benchmark: SQLite vs ZIP vs JSON for presentation storage.
 *
 * Creates a ~50MB presentation (images, demos, many slides) and measures:
 * - Initial save (full write)
 * - Incremental save (one element changed)
 * - Read full presentation
 * - History query (SQLite only)
 *
 * Usage: node tools/bench-storage.mjs [examples/magnetic-powers]
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, unlinkSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);

const Database = require('better-sqlite3');
const archiver = require('archiver');
const { createWriteStream } = await import('node:fs');
const { pipeline } = await import('node:stream/promises');

const projectDir = resolve(process.argv[2] || '/work/example-demos/magnetic-powers');
const tmpDir = '/tmp/bench-storage';
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

// ============================================================================
// Load the source presentation and assets
// ============================================================================
console.log(`Loading presentation from ${projectDir}...`);
const presentation = JSON.parse(readFileSync(join(projectDir, 'presentation.json'), 'utf8'));

// Collect all assets (images + demos)
const assets = new Map(); // path -> { data: Buffer, size: number }
function collectAssets(dir, prefix = '') {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    const rel = prefix ? `${prefix}/${f}` : f;
    const st = statSync(full);
    if (st.isDirectory()) {
      collectAssets(full, rel);
    } else if (/\.(png|jpg|jpeg|gif|svg|webp|html|json|css|js)$/i.test(f)) {
      assets.set(rel, { data: readFileSync(full), size: st.size });
    }
  }
}
collectAssets(join(projectDir, 'images'), 'images');
collectAssets(join(projectDir, 'demos'), 'demos');

// Duplicate assets to make a ~50MB presentation
const targetMB = 50;
let dupIdx = 0;
let runningTotal = 0;
for (const [, v] of assets) runningTotal += v.size;
while (runningTotal < targetMB * 1024 * 1024) {
  for (const [origPath, { data, size }] of [...assets]) {
    if (runningTotal >= targetMB * 1024 * 1024) break;
    const newPath = origPath.replace(/(\.\w+)$/, `-dup${dupIdx}$1`);
    if (!assets.has(newPath)) {
      assets.set(newPath, { data, size });
      runningTotal += size;
    }
  }
  dupIdx++;
}

// Duplicate slides to make a bigger presentation (~100 slides)
const origSlides = presentation.slides;
while (presentation.slides.length < 100) {
  for (const s of origSlides) {
    if (presentation.slides.length >= 100) break;
    presentation.slides.push({
      ...JSON.parse(JSON.stringify(s)),
      id: crypto.randomUUID(),
      elements: s.elements.map(el => ({ ...JSON.parse(JSON.stringify(el)), id: crypto.randomUUID() })),
    });
  }
}

const jsonStr = JSON.stringify(presentation, null, 2);
let totalAssetBytes = 0;
for (const [, v] of assets) totalAssetBytes += v.size;

console.log(`  Slides: ${presentation.slides.length}`);
console.log(`  Elements: ${presentation.slides.reduce((n, s) => n + s.elements.length, 0)}`);
console.log(`  JSON size: ${(jsonStr.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`  Assets: ${assets.size} files, ${(totalAssetBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`  Total: ~${((jsonStr.length + totalAssetBytes) / 1024 / 1024).toFixed(1)} MB`);
console.log();

// ============================================================================
// Helpers
// ============================================================================
function time(label, fn) {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  console.log(`  ${label}: ${ms.toFixed(1)}ms`);
  return { result, ms };
}

async function timeAsync(label, fn) {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  console.log(`  ${label}: ${ms.toFixed(1)}ms`);
  return { result, ms };
}

// ============================================================================
// 1. JSON (current approach)
// ============================================================================
console.log('=== JSON (current) ===');
const jsonPath = join(tmpDir, 'test.json');

time('Full save (JSON only)', () => {
  writeFileSync(jsonPath, jsonStr);
});

time('Full save (JSON + copy assets)', () => {
  writeFileSync(jsonPath, jsonStr);
  // Simulate copying assets (just measure the write)
  for (const [path, { data }] of assets) {
    const dest = join(tmpDir, 'json-assets', path);
    const dir = dest.substring(0, dest.lastIndexOf('/'));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(dest, data);
  }
});

time('Incremental save (rewrite full JSON)', () => {
  // Change one element
  presentation.slides[0].elements[0].html = 'Updated at ' + Date.now();
  writeFileSync(jsonPath, JSON.stringify(presentation, null, 2));
});

time('Read full presentation', () => {
  JSON.parse(readFileSync(jsonPath, 'utf8'));
});

const jsonSize = statSync(jsonPath).size;
console.log(`  File size: ${(jsonSize / 1024 / 1024).toFixed(2)} MB (JSON only, assets separate)`);
console.log();

// ============================================================================
// 2. SQLite (temporal model)
// ============================================================================
console.log('=== SQLite (temporal) ===');
const dbPath = join(tmpDir, 'test.eigendeck');
if (existsSync(dbPath)) unlinkSync(dbPath);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Create schema
db.exec(`
  CREATE TABLE presentation (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE slides (
    id TEXT NOT NULL, position INTEGER, layout TEXT, notes TEXT, group_id TEXT,
    valid_from TEXT NOT NULL, valid_to TEXT,
    PRIMARY KEY (id, valid_from)
  );
  CREATE TABLE elements (
    id TEXT NOT NULL, slide_id TEXT NOT NULL, type TEXT NOT NULL,
    data TEXT NOT NULL,
    valid_from TEXT NOT NULL, valid_to TEXT,
    PRIMARY KEY (id, valid_from)
  );
  CREATE TABLE assets (
    path TEXT PRIMARY KEY, data BLOB NOT NULL, mime_type TEXT,
    size INTEGER, hash TEXT, created_at TEXT
  );
  CREATE INDEX idx_slides_current ON slides(valid_to) WHERE valid_to IS NULL;
  CREATE INDEX idx_elements_current ON elements(valid_to) WHERE valid_to IS NULL;
  CREATE INDEX idx_elements_slide ON elements(slide_id, valid_to) WHERE valid_to IS NULL;
`);

time('Full save (initial)', () => {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    // Save config
    db.prepare('INSERT INTO presentation VALUES (?, ?)').run('title', presentation.title);
    db.prepare('INSERT INTO presentation VALUES (?, ?)').run('config', JSON.stringify(presentation.config));

    // Save slides
    const insertSlide = db.prepare('INSERT INTO slides VALUES (?, ?, ?, ?, ?, ?, NULL)');
    const insertElement = db.prepare('INSERT INTO elements VALUES (?, ?, ?, ?, ?, NULL)');

    for (let i = 0; i < presentation.slides.length; i++) {
      const s = presentation.slides[i];
      insertSlide.run(s.id, i, s.layout || 'default', s.notes || '', s.groupId || null, now);
      for (const el of s.elements) {
        insertElement.run(el.id, s.id, el.type, JSON.stringify(el), now);
      }
    }

    // Save assets
    const insertAsset = db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?)');
    for (const [path, { data, size }] of assets) {
      const ext = path.split('.').pop().toLowerCase();
      const mime = ext === 'html' ? 'text/html' : ext === 'json' ? 'application/json' : `image/${ext}`;
      insertAsset.run(path, data, mime, size, null, now);
    }
  });
  tx();
});

// Incremental save: change one element
time('Incremental save (1 element)', () => {
  const now = new Date().toISOString();
  const el = presentation.slides[0].elements[0];
  el.html = 'Updated at ' + Date.now();
  const tx = db.transaction(() => {
    // Close old version
    db.prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(now, el.id);
    // Insert new version
    db.prepare('INSERT INTO elements VALUES (?, ?, ?, ?, ?, NULL)').run(
      el.id, presentation.slides[0].id, el.type, JSON.stringify(el), now
    );
  });
  tx();
});

// Incremental save: change 5 elements across different slides
time('Incremental save (5 elements)', () => {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (let i = 0; i < 5; i++) {
      const s = presentation.slides[i * 10];
      const el = s.elements[0];
      el.html = 'Batch update ' + Date.now();
      db.prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(now, el.id);
      db.prepare('INSERT INTO elements VALUES (?, ?, ?, ?, ?, NULL)').run(
        el.id, s.id, el.type, JSON.stringify(el), now
      );
    }
  });
  tx();
});

// Read full current state
time('Read full presentation', () => {
  const config = {};
  for (const row of db.prepare('SELECT key, value FROM presentation').all()) {
    config[row.key] = row.value;
  }
  const slides = db.prepare('SELECT * FROM slides WHERE valid_to IS NULL ORDER BY position').all();
  for (const s of slides) {
    s.elements = db.prepare('SELECT * FROM elements WHERE slide_id = ? AND valid_to IS NULL').all(s.id);
  }
});

// History query: get state at a point in time
time('History query (state 2 saves ago)', () => {
  const timestamps = db.prepare(
    'SELECT DISTINCT valid_from FROM elements ORDER BY valid_from DESC LIMIT 3'
  ).all();
  if (timestamps.length >= 3) {
    const t = timestamps[2].valid_from;
    const slides = db.prepare(
      'SELECT * FROM slides WHERE valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) ORDER BY position'
    ).all(t, t);
    for (const s of slides) {
      s.elements = db.prepare(
        'SELECT * FROM elements WHERE slide_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)'
      ).all(s.id, t, t);
    }
  }
});

// Count versions
const versionCount = db.prepare('SELECT COUNT(*) as n FROM elements').get().n;
const currentCount = db.prepare('SELECT COUNT(*) as n FROM elements WHERE valid_to IS NULL').get().n;
console.log(`  Versions stored: ${versionCount} (${currentCount} current)`);

db.pragma('wal_checkpoint(TRUNCATE)'); // flush WAL to main file
const dbSize = statSync(dbPath).size;
console.log(`  File size: ${(dbSize / 1024 / 1024).toFixed(1)} MB (everything included)`);
db.close();
console.log();

// ============================================================================
// 3. ZIP (store mode, no compression for speed)
// ============================================================================
console.log('=== ZIP (store mode) ===');
const zipPath = join(tmpDir, 'test.eigendeck.zip');

await timeAsync('Full save (create ZIP)', async () => {
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { store: true }); // no compression for speed
  archive.pipe(output);
  archive.append(jsonStr, { name: 'presentation.json' });
  for (const [path, { data }] of assets) {
    archive.append(data, { name: path });
  }
  archive.finalize();
  await new Promise((resolve) => output.on('close', resolve));
});

await timeAsync('Incremental save (rewrite ZIP)', async () => {
  presentation.slides[0].elements[0].html = 'Updated in ZIP ' + Date.now();
  const newJson = JSON.stringify(presentation, null, 2);
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { store: true });
  archive.pipe(output);
  archive.append(newJson, { name: 'presentation.json' });
  for (const [path, { data }] of assets) {
    archive.append(data, { name: path });
  }
  archive.finalize();
  await new Promise((resolve) => output.on('close', resolve));
});

await timeAsync('Read from ZIP (extract JSON)', async () => {
  const yauzl = require('yauzl');
  await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) { reject(err); return; }
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (entry.fileName === 'presentation.json') {
          zipfile.openReadStream(entry, (err, stream) => {
            if (err) { reject(err); return; }
            let data = '';
            stream.on('data', (chunk) => data += chunk);
            stream.on('end', () => {
              JSON.parse(data);
              resolve();
            });
          });
        } else {
          zipfile.readEntry();
        }
      });
    });
  });
});

const zipSize = statSync(zipPath).size;
console.log(`  File size: ${(zipSize / 1024 / 1024).toFixed(2)} MB`);
console.log();

// ============================================================================
// Summary
// ============================================================================
console.log('=== Summary ===');
console.log(`  JSON dir:  ${(jsonSize / 1024 / 1024).toFixed(2)} MB (+ ${(totalAssetBytes / 1024 / 1024).toFixed(2)} MB assets)`);
console.log(`  SQLite:    ${(dbSize / 1024 / 1024).toFixed(2)} MB (all-in-one, with history)`);
console.log(`  ZIP:       ${(zipSize / 1024 / 1024).toFixed(2)} MB (all-in-one, no history)`);
