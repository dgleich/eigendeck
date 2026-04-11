#!/usr/bin/env node
/**
 * Eigendeck command-line tool.
 *
 * Usage:
 *   eigendeck info <project-dir>           Show presentation stats
 *   eigendeck validate <project-dir>       Check for missing files & broken refs
 *   eigendeck export <project-dir> [out.html]   Export to standalone HTML
 *   eigendeck lint <project-dir>           Lint demo HTML files
 *
 * Pure Node.js — no dependencies beyond the standard library.
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExportHtml } from '../src/lib/exportCore.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Color helpers
// ============================================================================
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', RESET = '\x1b[0m', BOLD = '\x1b[1m';
const isTTY = process.stdout.isTTY;
const c = (color, text) => isTTY ? `${color}${text}${RESET}` : text;

// ============================================================================
// Presentation loading
// ============================================================================
function loadPresentation(projectDir) {
  const jsonPath = join(projectDir, 'presentation.json');
  if (!existsSync(jsonPath)) {
    console.error(c(RED, `Error: presentation.json not found in ${projectDir}`));
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    console.error(c(RED, `Error: failed to parse presentation.json: ${e.message}`));
    process.exit(1);
  }
}

// ============================================================================
// info command
// ============================================================================
function cmdInfo(projectDir) {
  const presentation = loadPresentation(projectDir);
  const slides = presentation.slides || [];

  console.log(c(BOLD, presentation.title || 'Untitled'));
  console.log('  Author:', presentation.config?.author || c(YELLOW, '(none)'));
  console.log('  Venue:', presentation.config?.venue || c(YELLOW, '(none)'));
  console.log('  Slides:', slides.length);
  console.log('  Canvas:', `${presentation.config?.width}x${presentation.config?.height}`);

  // Element type counts
  const types = {};
  let mathCount = 0;
  for (const s of slides) {
    for (const el of s.elements || []) {
      types[el.type] = (types[el.type] || 0) + 1;
      if (el.type === 'text' && /\$[^$]+\$|\$\$[\s\S]+\$\$/.test(el.html || '')) {
        mathCount++;
      }
    }
  }
  console.log();
  console.log(c(BOLD, 'Elements:'));
  for (const [t, n] of Object.entries(types).sort()) {
    console.log(`  ${t}: ${n}`);
  }
  console.log(`  text with math: ${mathCount}`);

  // Linked element groups
  const linkIds = new Set(), syncIds = new Set();
  for (const s of slides) {
    for (const el of s.elements || []) {
      if (el.linkId) linkIds.add(el.linkId);
      if (el.syncId) syncIds.add(el.syncId);
    }
  }
  console.log();
  console.log(c(BOLD, 'Links:'));
  console.log('  unique linkIds:', linkIds.size);
  console.log('  unique syncIds:', syncIds.size);

  // Slide groups
  const groups = new Map();
  slides.forEach((s, i) => {
    if (s.groupId) {
      if (!groups.has(s.groupId)) groups.set(s.groupId, []);
      groups.get(s.groupId).push(i);
    }
  });
  console.log();
  console.log(c(BOLD, 'Build groups:'), groups.size);

  // Demo & image references
  const demoSrcs = new Set(), imageSrcs = new Set();
  for (const s of slides) {
    for (const el of s.elements || []) {
      if (el.type === 'demo') demoSrcs.add(el.src);
      if (el.type === 'demo-piece') demoSrcs.add(el.demoSrc);
      if (el.type === 'image' && !el.src.startsWith('data:')) imageSrcs.add(el.src);
    }
  }
  console.log();
  console.log(c(BOLD, 'Referenced files:'));
  console.log(`  demos: ${demoSrcs.size}`);
  for (const s of [...demoSrcs].sort()) console.log(`    - ${s}`);
  console.log(`  images: ${imageSrcs.size}`);
  for (const s of [...imageSrcs].sort()) console.log(`    - ${s}`);

  // Math preamble
  if (presentation.config?.mathPreamble) {
    console.log();
    console.log(c(BOLD, 'Math preamble:'));
    console.log('  ' + presentation.config.mathPreamble.split('\n').join('\n  '));
  }
}

// ============================================================================
// validate command
// ============================================================================
function cmdValidate(projectDir) {
  const presentation = loadPresentation(projectDir);
  const slides = presentation.slides || [];
  let errors = 0, warnings = 0;

  // Check referenced files exist
  const checked = new Set();
  for (const s of slides) {
    for (const el of s.elements || []) {
      let src = null;
      if (el.type === 'image' && !el.src.startsWith('data:')) src = el.src;
      if (el.type === 'demo') src = el.src;
      if (el.type === 'demo-piece') src = el.demoSrc;
      if (src && !checked.has(src)) {
        checked.add(src);
        if (!existsSync(join(projectDir, src))) {
          console.log(c(RED, `  ✗ Missing file: ${src}`));
          errors++;
        }
      }
    }
  }

  // Check linked elements: each linkId/syncId should be on multiple slides
  const linkIdSlides = new Map(); // linkId -> slide indices
  const syncIdSlides = new Map();
  slides.forEach((s, i) => {
    for (const el of s.elements || []) {
      if (el.linkId) {
        if (!linkIdSlides.has(el.linkId)) linkIdSlides.set(el.linkId, []);
        linkIdSlides.get(el.linkId).push(i);
      }
      if (el.syncId) {
        if (!syncIdSlides.has(el.syncId)) syncIdSlides.set(el.syncId, []);
        syncIdSlides.get(el.syncId).push(i);
      }
    }
  });

  // Orphaned link IDs (only on one slide — pointless)
  for (const [id, sl] of linkIdSlides) {
    if (sl.length === 1) {
      console.log(c(YELLOW, `  ⚠ Orphan linkId ${id.slice(0, 8)} on only slide ${sl[0]}`));
      warnings++;
    }
  }
  for (const [id, sl] of syncIdSlides) {
    if (sl.length === 1) {
      console.log(c(YELLOW, `  ⚠ Orphan syncId ${id.slice(0, 8)} on only slide ${sl[0]}`));
      warnings++;
    }
  }

  // Duplicate element IDs
  const seenIds = new Set();
  for (const s of slides) {
    for (const el of s.elements || []) {
      if (seenIds.has(el.id)) {
        console.log(c(RED, `  ✗ Duplicate element ID: ${el.id.slice(0, 8)}`));
        errors++;
      }
      seenIds.add(el.id);
    }
  }

  // Sync consistency: elements with same syncId should have matching properties
  for (const [id, sl] of syncIdSlides) {
    if (sl.length < 2) continue;
    const elements = [];
    for (const i of sl) {
      const el = slides[i].elements.find((e) => e.syncId === id);
      if (el) elements.push({ slide: i, el });
    }
    // Check positions match (within tolerance)
    if (elements.length >= 2) {
      const ref = elements[0].el;
      for (let j = 1; j < elements.length; j++) {
        const cur = elements[j].el;
        if (cur.position && ref.position) {
          const dx = Math.abs(cur.position.x - ref.position.x);
          const dy = Math.abs(cur.position.y - ref.position.y);
          if (dx > 1 || dy > 1) {
            console.log(c(YELLOW, `  ⚠ Synced elements with syncId ${id.slice(0, 8)} have different positions: slide ${elements[0].slide} vs slide ${elements[j].slide}`));
            warnings++;
            break;
          }
        }
      }
    }
  }

  console.log();
  if (errors === 0 && warnings === 0) {
    console.log(c(GREEN, '✓ Validation passed'));
  } else {
    console.log(`${errors} error(s), ${warnings} warning(s)`);
  }
  process.exit(errors > 0 ? 1 : 0);
}

// ============================================================================
// export command — uses shared logic from src/lib/exportCore.mjs
// ============================================================================
async function cmdExport(projectDir, outPath) {
  const presentation = loadPresentation(projectDir);
  const slides = presentation.slides || [];

  if (!outPath) {
    outPath = join(projectDir, (presentation.title || 'presentation').replace(/[^a-zA-Z0-9]/g, '-') + '.html');
  }

  console.log(`Exporting ${slides.length} slides to ${outPath}...`);

  // Build the HTML using the shared export module.
  // Node provides filesystem; math is left as raw $...$ (MathJax CDN renders at runtime).
  const html = await buildExportHtml({
    presentation,
    readFile: async (path) => new Uint8Array(readFileSync(join(projectDir, path))),
    readTextFile: async (path) => readFileSync(join(projectDir, path), 'utf8'),
    renderMath: null,        // CLI: no in-process MathJax (would need heavy deps)
    applyMathPreamble: null,
  });

  writeFileSync(outPath, html);
  const sz = statSync(outPath).size;
  console.log(c(GREEN, `✓ Exported ${slides.length} slides → ${outPath} (${(sz / 1024 / 1024).toFixed(2)} MB)`));
  if (/\$/.test(html)) {
    console.log(c(YELLOW, '  Note: Math will be rendered at runtime via MathJax CDN (needs internet).'));
    console.log(c(YELLOW, '  For offline math, use the GUI export which pre-renders to SVG.'));
  }
}

// ============================================================================
// lint command — run lint-demo.py on all demo files
// ============================================================================
function cmdLint(projectDir) {
  const demosDir = join(projectDir, 'demos');
  if (!existsSync(demosDir)) {
    console.log(c(YELLOW, 'No demos/ directory'));
    return;
  }
  const files = readdirSync(demosDir).filter((f) => /\.html?$/i.test(f));
  if (files.length === 0) {
    console.log('No demo HTML files found');
    return;
  }
  // Inline a simplified version of the linter from tools/lint-demo.py
  let totalErrors = 0;
  for (const f of files) {
    const path = join(demosDir, f);
    const content = readFileSync(path, 'utf8');
    const errors = [], warnings = [];

    if (!/<!DOCTYPE html>/i.test(content)) warnings.push('Missing <!DOCTYPE html>');
    if (!/html\s*,?\s*body\s*\{[^}]*height\s*:\s*100%/i.test(content) &&
        !/html\s*\{[^}]*height\s*:\s*100%/i.test(content)) {
      errors.push("Missing 'html, body { height: 100% }' — iframe collapses to 0px");
    }
    if (!/location\.hash/.test(content)) errors.push('No location.hash parsing');
    if (!/'controller'|"controller"/.test(content)) errors.push('No controller role handler');
    const pieces = [...content.matchAll(/piece\s*===?\s*['"](\w+)['"]/g)].map((m) => m[1]);
    if (pieces.length === 0) errors.push('No piece viewport handlers');
    if (!/BroadcastChannel/.test(content)) errors.push('No BroadcastChannel');
    if (/DOMContentLoaded/.test(content) && !/readyState/.test(content)) {
      errors.push('Uses DOMContentLoaded without readyState check');
    }

    const status = errors.length === 0 ? c(GREEN, 'PASS') : c(RED, 'FAIL');
    console.log(`${status} ${f}`);
    for (const e of errors) console.log(c(RED, `  ✗ ${e}`));
    for (const w of warnings) console.log(c(YELLOW, `  ⚠ ${w}`));
    if (pieces.length) console.log(c(CYAN, `  i pieces: ${[...new Set(pieces)].join(', ')}`));
    totalErrors += errors.length;
  }
  process.exit(totalErrors > 0 ? 1 : 0);
}

// ============================================================================
// Main
// ============================================================================
function usage() {
  console.log(`Eigendeck CLI

Usage:
  eigendeck info <project>              Show presentation stats
  eigendeck validate <project>          Check for missing files & broken refs
  eigendeck export <project> [out.html] Export to standalone HTML
  eigendeck lint <project>              Lint demo HTML files

Examples:
  eigendeck info examples/magnetic-powers
  eigendeck validate examples/magnetic-powers
  eigendeck export examples/magnetic-powers out.html
`);
}

const [, , cmd, project, ...rest] = process.argv;

if (!cmd || !project) {
  usage();
  process.exit(cmd ? 1 : 0);
}

const projectDir = resolve(project);
if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
  console.error(c(RED, `Error: ${project} is not a directory`));
  process.exit(1);
}

switch (cmd) {
  case 'info': cmdInfo(projectDir); break;
  case 'validate': cmdValidate(projectDir); break;
  case 'export': await cmdExport(projectDir, rest[0]); break;
  case 'lint': cmdLint(projectDir); break;
  default:
    console.error(c(RED, `Unknown command: ${cmd}`));
    usage();
    process.exit(1);
}
