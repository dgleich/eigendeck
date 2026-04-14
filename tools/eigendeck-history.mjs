#!/usr/bin/env node
/**
 * Eigendeck history viewer — show edit history from a .eigendeck SQLite file.
 *
 * Usage:
 *   node tools/eigendeck-history.mjs myproject.eigendeck
 *   node tools/eigendeck-history.mjs myproject.eigendeck --limit 50
 *   node tools/eigendeck-history.mjs myproject.eigendeck --json
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const dbPath = args.find(a => !a.startsWith('--'));
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '100');
const jsonOutput = args.includes('--json');

if (!dbPath) {
  console.log('Usage: eigendeck-history <file.eigendeck> [--limit=N] [--json]');
  process.exit(1);
}

const db = new Database(resolve(dbPath), { readonly: true });

// ============================================================================
// Collect all events from all temporal tables
// ============================================================================
const events = [];

// Element changes
const elStmt = db.prepare(`
  SELECT id, type, data, link_id, valid_from, valid_to
  FROM elements
  ORDER BY valid_from
`);
for (const row of elStmt.all()) {
  const data = JSON.parse(row.data || '{}');
  const isCreation = !db.prepare(
    'SELECT 1 FROM elements WHERE id = ? AND valid_from < ? LIMIT 1'
  ).get(row.id, row.valid_from);

  if (isCreation) {
    events.push({
      timestamp: row.valid_from,
      action: 'create_element',
      elementId: row.id,
      elementType: row.type,
      detail: summarizeElement(data, row.type),
    });
  } else if (row.valid_to === null) {
    // This is an update (there's a previous version)
    const prev = db.prepare(
      'SELECT data FROM elements WHERE id = ? AND valid_to = ? LIMIT 1'
    ).get(row.id, row.valid_from);
    const prevData = prev ? JSON.parse(prev.data || '{}') : {};
    const changes = diffData(prevData, data);
    if (changes) {
      events.push({
        timestamp: row.valid_from,
        action: 'update_element',
        elementId: row.id,
        elementType: row.type,
        detail: changes,
      });
    }
  }
}

// Slide changes
const slideStmt = db.prepare(`
  SELECT id, position, layout, notes, group_id, valid_from, valid_to
  FROM slides
  ORDER BY valid_from
`);
for (const row of slideStmt.all()) {
  const isCreation = !db.prepare(
    'SELECT 1 FROM slides WHERE id = ? AND valid_from < ? LIMIT 1'
  ).get(row.id, row.valid_from);

  if (isCreation) {
    events.push({
      timestamp: row.valid_from,
      action: 'create_slide',
      slideId: row.id,
      detail: `position ${row.position}${row.group_id ? ` (group ${row.group_id.slice(0, 8)})` : ''}`,
    });
  } else if (row.valid_to === null) {
    events.push({
      timestamp: row.valid_from,
      action: 'update_slide',
      slideId: row.id,
      detail: `position ${row.position}, layout: ${row.layout}`,
    });
  }

  if (row.valid_to !== null) {
    // Check if there's a successor — if not, this is a deletion
    const successor = db.prepare(
      'SELECT 1 FROM slides WHERE id = ? AND valid_from = ? LIMIT 1'
    ).get(row.id, row.valid_to);
    if (!successor) {
      events.push({
        timestamp: row.valid_to,
        action: 'delete_slide',
        slideId: row.id,
        detail: `was at position ${row.position}`,
      });
    }
  }
}

// Slide-element junction changes (add/remove from slide)
const seStmt = db.prepare(`
  SELECT slide_id, element_id, z_order, valid_from, valid_to
  FROM slide_elements
  ORDER BY valid_from
`);
for (const row of seStmt.all()) {
  const isCreation = !db.prepare(
    'SELECT 1 FROM slide_elements WHERE slide_id = ? AND element_id = ? AND valid_from < ? LIMIT 1'
  ).get(row.slide_id, row.element_id, row.valid_from);

  if (isCreation) {
    // Get element type for context
    const el = db.prepare('SELECT type, data FROM elements WHERE id = ? ORDER BY valid_from DESC LIMIT 1').get(row.element_id);
    const elData = el ? JSON.parse(el.data || '{}') : {};
    events.push({
      timestamp: row.valid_from,
      action: 'place_on_slide',
      slideId: row.slide_id,
      elementId: row.element_id,
      detail: `${el?.type || '?'} at z=${row.z_order}${elData.preset ? ` (${elData.preset})` : ''}`,
    });
  }

  if (row.valid_to !== null) {
    const successor = db.prepare(
      'SELECT 1 FROM slide_elements WHERE slide_id = ? AND element_id = ? AND valid_from = ? LIMIT 1'
    ).get(row.slide_id, row.element_id, row.valid_to);
    if (!successor) {
      events.push({
        timestamp: row.valid_to,
        action: 'remove_from_slide',
        slideId: row.slide_id,
        elementId: row.element_id,
        detail: '',
      });
    }
  }
}

// Sort by timestamp
events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

// ============================================================================
// Summarize and display
// ============================================================================

function summarizeElement(data, type) {
  if (type === 'text') {
    const html = data.html || '';
    const text = html.replace(/<[^>]*>/g, '').slice(0, 60);
    return `${data.preset || 'text'}: "${text}"`;
  }
  if (type === 'image') return `image: ${data.src || '?'}`;
  if (type === 'demo') return `demo: ${data.src || '?'}`;
  if (type === 'demo-piece') return `demo-piece: ${data.demoSrc || '?'} #${data.piece || '?'}`;
  if (type === 'arrow') return `arrow (${data.x1},${data.y1})→(${data.x2},${data.y2})`;
  if (type === 'cover') return `cover ${data.color || '#fff'}`;
  return type;
}

function diffData(prev, curr) {
  const changes = [];
  // Position change
  if (prev.position && curr.position) {
    if (prev.position.x !== curr.position.x || prev.position.y !== curr.position.y) {
      changes.push(`moved (${prev.position.x},${prev.position.y})→(${curr.position.x},${curr.position.y})`);
    }
    if (prev.position.width !== curr.position.width || prev.position.height !== curr.position.height) {
      changes.push(`resized ${prev.position.width}x${prev.position.height}→${curr.position.width}x${curr.position.height}`);
    }
  }
  // Text change
  if (prev.html !== curr.html) {
    const prevText = (prev.html || '').replace(/<[^>]*>/g, '').slice(0, 30);
    const currText = (curr.html || '').replace(/<[^>]*>/g, '').slice(0, 30);
    changes.push(`text: "${prevText}" → "${currText}"`);
  }
  // Style changes
  if (prev.fontSize !== curr.fontSize) changes.push(`fontSize: ${prev.fontSize}→${curr.fontSize}`);
  if (prev.color !== curr.color) changes.push(`color: ${prev.color}→${curr.color}`);
  // Arrow coords
  if (prev.x1 !== curr.x1 || prev.y1 !== curr.y1 || prev.x2 !== curr.x2 || prev.y2 !== curr.y2) {
    changes.push(`arrow moved`);
  }
  return changes.length > 0 ? changes.join(', ') : null;
}

// ============================================================================
// Output
// ============================================================================
const limited = events.slice(-limit);

if (jsonOutput) {
  console.log(JSON.stringify(limited, null, 2));
} else {
  const isTTY = process.stdout.isTTY;
  const DIM = isTTY ? '\x1b[2m' : '';
  const RESET = isTTY ? '\x1b[0m' : '';
  const GREEN = isTTY ? '\x1b[32m' : '';
  const RED = isTTY ? '\x1b[31m' : '';
  const YELLOW = isTTY ? '\x1b[33m' : '';
  const CYAN = isTTY ? '\x1b[36m' : '';
  const BOLD = isTTY ? '\x1b[1m' : '';

  const actionColors = {
    create_element: GREEN,
    create_slide: GREEN,
    place_on_slide: GREEN,
    update_element: YELLOW,
    update_slide: YELLOW,
    delete_slide: RED,
    remove_from_slide: RED,
  };

  // Stats
  const totalVersions = db.prepare('SELECT COUNT(*) as n FROM elements').get().n;
  const currentEls = db.prepare('SELECT COUNT(*) as n FROM elements WHERE valid_to IS NULL').get().n;
  const totalSlides = db.prepare('SELECT COUNT(*) as n FROM slides WHERE valid_to IS NULL').get().n;

  console.log(`${BOLD}Edit History${RESET} — ${resolve(dbPath)}`);
  console.log(`  ${totalSlides} slides, ${currentEls} current elements, ${totalVersions} total versions`);
  console.log(`  Showing ${limited.length} of ${events.length} events${limit < events.length ? ` (use --limit=${events.length} for all)` : ''}`);
  console.log();

  let lastTimestamp = '';
  for (const ev of limited) {
    // Group by timestamp (batch operations share timestamps)
    const ts = ev.timestamp.split('-')[0]; // strip counter suffix
    const tsDisplay = ts !== lastTimestamp ? ts : '                         ';
    lastTimestamp = ts;

    const color = actionColors[ev.action] || '';
    const action = ev.action.padEnd(20);
    const id = (ev.elementId || ev.slideId || '').slice(0, 8);

    console.log(`${DIM}${tsDisplay}${RESET}  ${color}${action}${RESET}  ${DIM}${id}${RESET}  ${ev.detail}`);
  }
}

db.close();
