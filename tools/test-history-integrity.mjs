#!/usr/bin/env node
/**
 * test-history-integrity.mjs
 *
 * Simulation test that verifies SQLite history integrity through
 * a sequence of UI-like operations via eigendeck-cli.
 *
 * Creates a temp .eigendeck file, runs operations, checks history
 * invariants after each step, then cleans up.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = '/work/src-tauri/target/debug/eigendeck-cli';
let tmpDir;
let dbPath;
let passed = 0;
let failed = 0;
const failures = [];

// ============================================================================
// Helpers
// ============================================================================

function cli(...args) {
  return execFileSync(CLI, [dbPath, ...args], {
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
}

function cliJson(...args) {
  const out = execFileSync(CLI, [dbPath, '--json', ...args], {
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
  return JSON.parse(out);
}

function getHistory() {
  return cliJson('history');
}

function getElements(slideNum) {
  return cliJson('list', 'elements', String(slideNum));
}

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.log(`  FAIL: ${msg}`);
  }
}

function assertEq(actual, expected, msg) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    const detail = `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    failures.push(detail);
    console.log(`  FAIL: ${detail}`);
  }
}

// ============================================================================
// Setup
// ============================================================================

tmpDir = mkdtempSync(join(tmpdir(), 'eigendeck-hist-'));
dbPath = join(tmpDir, 'test.eigendeck');

console.log(`Database: ${dbPath}`);
console.log('');

try {
  // ========================================================================
  // Step 1: Create presentation with 5 slides
  // ========================================================================
  console.log('Step 1: Create 5 slides');

  for (let i = 0; i < 5; i++) {
    cli('add', 'slide');
  }

  const slides = cliJson('list', 'slides');
  assertEq(slides.length, 5, 'Should have 5 slides');

  // ========================================================================
  // Step 2: Add text elements to slides
  // ========================================================================
  console.log('Step 2: Add text elements to each slide');

  const slideTexts = [
    'Introduction to Matrix Algorithms',
    'Graph Laplacians and Spectral Methods',
    'Krylov Subspace Iteration',
    'Randomized SVD Overview',
    'Conclusions and Future Work',
  ];

  for (let i = 0; i < 5; i++) {
    cli('add', 'text', String(i + 1), slideTexts[i]);
  }

  let prevHistLen = 0;
  let history = getHistory();
  assert(history.length > prevHistLen, 'History should grow after adding elements');
  prevHistLen = history.length;

  // Collect element IDs
  const elementIds = [];
  for (let i = 0; i < 5; i++) {
    const els = getElements(i + 1);
    assert(els.length >= 1, `Slide ${i + 1} should have at least 1 element`);
    elementIds.push(els[0].id);
  }

  // ========================================================================
  // Step 3: Edit text on various elements (10+ edits)
  // ========================================================================
  console.log('Step 3: Perform 12 text edits');

  const edits = [
    [0, 'Introduction to Matrix Algorithms — Revised'],
    [1, 'Graph Laplacians: Theory and Practice'],
    [2, 'Krylov Subspace Methods for Large Systems'],
    [0, 'Matrix Algorithms: A Comprehensive Introduction'],
    [3, 'Randomized SVD: Fast Low-Rank Approximation'],
    [4, 'Conclusions, Open Problems, and Future Directions'],
    [1, 'Spectral Graph Theory and Applications'],
    [2, 'Arnoldi and Lanczos Iterations'],
    [3, 'Randomized Numerical Linear Algebra'],
    [0, 'Matrix Computations in Modern HPC'],
    [4, 'Summary and Open Questions'],
    [2, 'Krylov Methods: Arnoldi, Lanczos, GMRES'],
  ];

  for (const [idx, text] of edits) {
    cli('set-text', elementIds[idx], text);
    const h = getHistory();
    assert(h.length > prevHistLen, `History should grow after editing element ${idx}`);
    prevHistLen = h.length;
  }

  // Verify each edit created a separate history entry
  history = getHistory();
  console.log(`  History has ${history.length} entries after 12 edits`);

  // Check that edit entries are for the correct element IDs
  const editEntries = history.filter(e => e.action === 'update' || e.action === 'closed');
  for (const entry of editEntries) {
    assert(
      elementIds.includes(entry.elementId),
      `History entry element ${entry.elementId} should be a known element`
    );
  }

  // ========================================================================
  // Step 4: Move elements to new positions
  // ========================================================================
  console.log('Step 4: Move elements');

  cli('move', 'element', elementIds[0], '100', '50');
  cli('move', 'element', elementIds[1], '200', '150');
  cli('move', 'element', elementIds[2], '300', '250');

  history = getHistory();
  assert(history.length > prevHistLen, 'History should grow after moves');
  prevHistLen = history.length;

  // ========================================================================
  // Step 5: Add a new slide with text
  // ========================================================================
  console.log('Step 5: Add slide 6 with text');

  cli('add', 'slide');
  cli('add', 'text', '6', 'Bonus: PageRank and Random Walks');

  const slidesAfter = cliJson('list', 'slides');
  assertEq(slidesAfter.length, 6, 'Should have 6 slides now');

  const newEls = getElements(6);
  assert(newEls.length >= 1, 'New slide should have an element');
  const newElId = newEls[0].id;
  elementIds.push(newElId);

  history = getHistory();
  assert(history.length > prevHistLen, 'History should grow after adding new slide + element');
  prevHistLen = history.length;

  // ========================================================================
  // Step 6: Delete an element
  // ========================================================================
  console.log('Step 6: Delete an element from slide 4');

  const elToDelete = elementIds[3]; // Slide 4's element
  cli('remove', 'element', elToDelete);

  const slide4Els = getElements(4);
  assert(
    !slide4Els.some(e => e.id === elToDelete),
    'Deleted element should no longer appear on slide 4'
  );

  // ========================================================================
  // Step 7: More text edits after deletion
  // ========================================================================
  console.log('Step 7: More edits after deletion');

  cli('set-text', elementIds[0], 'Final: Matrix Computations for Data Science');
  cli('set-text', elementIds[4], 'Final Summary');
  cli('set-text', newElId, 'Bonus: Markov Chains and PageRank');

  history = getHistory();
  assert(history.length > prevHistLen, 'History should grow after post-delete edits');

  // ========================================================================
  // Final verification
  // ========================================================================
  console.log('');
  console.log('=== Final Verification ===');

  const finalHistory = getHistory();

  // 1. History has many versions (not collapsed to 1)
  assert(
    finalHistory.length > 15,
    `History should have many entries, got ${finalHistory.length}`
  );
  console.log(`  Total history entries: ${finalHistory.length}`);

  // 2. Each distinct edit is a separate history entry with its own timestamp
  const timestamps = finalHistory.map(e => e.timestamp);
  const uniqueTimestamps = new Set(timestamps);
  assertEq(
    uniqueTimestamps.size,
    timestamps.length,
    'All history timestamps should be unique'
  );

  // 3. Timestamps are monotonically increasing (sorted)
  const sortedTs = [...timestamps].sort();
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] !== sortedTs[i]) {
      assert(false, `Timestamps should be in sorted order, mismatch at index ${i}`);
      break;
    }
    if (i === timestamps.length - 1) {
      assert(true, 'Timestamps are in sorted order');
    }
  }

  // 4. No "import" entries in history (incremental only)
  const importEntries = finalHistory.filter(e =>
    e.action === 'import' || e.action === 'full_resync'
  );
  assertEq(
    importEntries.length,
    0,
    'No full-resync/import entries should exist in normal flow'
  );

  // 5. Exactly one "current" entry per element ID
  const currentEntries = finalHistory.filter(e => e.current);
  const currentByElement = new Map();
  for (const e of currentEntries) {
    if (currentByElement.has(e.elementId)) {
      assert(false, `Element ${e.elementId} has multiple current entries`);
    }
    currentByElement.set(e.elementId, e);
  }
  assert(currentByElement.size > 0, 'Should have current entries');

  // 6. Verify current text matches last edits via outline
  const outline = cli('outline');
  assert(
    outline.includes('Matrix Computations for Data Science'),
    'Outline should reflect final edit on slide 1'
  );
  assert(
    outline.includes('Final Summary'),
    'Outline should reflect final edit on slide 5'
  );
  assert(
    outline.includes('Markov Chains and PageRank'),
    'Outline should reflect final edit on slide 6'
  );
  // Deleted element should NOT appear
  assert(
    !outline.includes('Randomized Numerical Linear Algebra'),
    'Deleted element text should not appear in outline'
  );

  // 7. Verify element count per current entries
  //    We created 6 elements, deleted 1 → 5 elements with current versions
  //    (the deleted one may still have history but no "current" version)
  const livingCurrentCount = currentEntries.filter(e =>
    !e.elementId || e.elementId !== elToDelete
  ).length;
  assert(
    livingCurrentCount >= 5,
    `Should have at least 5 current element versions, got ${livingCurrentCount}`
  );

  // ========================================================================
  // Report
  // ========================================================================
  console.log('');
  console.log('========================================');
  if (failed === 0) {
    console.log(`PASS — ${passed} assertions passed, 0 failed`);
  } else {
    console.log(`FAIL — ${passed} passed, ${failed} failed`);
    console.log('');
    console.log('Failures:');
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  }
  console.log('========================================');

  process.exit(failed > 0 ? 1 : 0);

} finally {
  // Cleanup
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}
