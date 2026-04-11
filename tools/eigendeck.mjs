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
// export command — pure JS port of src/store/fileOps.ts exportPresentation
// ============================================================================

const TEXT_PRESET_STYLES = {
  title:      { fontSize: 72, fontFamily: "'PT Sans', sans-serif", fontWeight: '700', fontStyle: 'normal', color: '#222' },
  body:       { fontSize: 48, fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#222' },
  textbox:    { fontSize: 48, fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#222' },
  annotation: { fontSize: 32, fontFamily: "'PT Sans', sans-serif", fontWeight: 'normal', fontStyle: 'italic', color: '#2563eb' },
  footnote:   { fontSize: 24, fontFamily: "'PT Sans Narrow', sans-serif", fontWeight: 'normal', fontStyle: 'normal', color: '#888' },
};

function htmlEscapeForSrcdoc(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function injectDemoBootstrap(html, hash, channelKey) {
  const bootstrap = `<script>
(function(){
  var __ch = ${JSON.stringify(channelKey)};
  try { window.location.hash = ${JSON.stringify(hash)}; } catch(e) {}
  var _BC = window.BroadcastChannel;
  if (_BC) {
    window.BroadcastChannel = function(name) {
      return new _BC(__ch + ':' + name);
    };
    window.BroadcastChannel.prototype = _BC.prototype;
  }
})();
</script>`;
  if (html.includes('<head>')) {
    return html.replace('<head>', '<head>' + bootstrap);
  }
  return bootstrap + html;
}

function imageDataUrl(projectDir, src, cache) {
  if (src.startsWith('data:')) return src;
  if (cache.has(src)) return cache.get(src);
  try {
    const bytes = readFileSync(join(projectDir, src));
    const ext = src.split('.').pop()?.toLowerCase() || 'png';
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const base64 = bytes.toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;
    cache.set(src, dataUrl);
    return dataUrl;
  } catch (e) {
    console.error(c(RED, `  ! Failed to read image ${src}: ${e.message}`));
    return src;
  }
}

function cmdExport(projectDir, outPath) {
  const presentation = loadPresentation(projectDir);
  const slides = presentation.slides || [];
  const W = presentation.config?.width || 1920;
  const H = presentation.config?.height || 1080;
  const meta = [presentation.config?.author, presentation.config?.venue].filter(Boolean).join(' \u00B7 ');
  const imageCache = new Map();
  const slideHtml = [];

  if (!outPath) {
    outPath = join(projectDir, (presentation.title || 'presentation').replace(/[^a-zA-Z0-9]/g, '-') + '.html');
  }

  console.log(`Exporting ${slides.length} slides to ${outPath}...`);

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    let inner = '';
    const demoPieceSrcs = new Set();

    for (const el of slide.elements || []) {
      const p = el.position;
      switch (el.type) {
        case 'text': {
          const ps = TEXT_PRESET_STYLES[el.preset] || TEXT_PRESET_STYLES.body;
          // Note: math is NOT pre-rendered in CLI export — would need MathJax
          inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;font-family:${el.fontFamily || ps.fontFamily};font-weight:${ps.fontWeight};font-style:${ps.fontStyle};font-size:${el.fontSize || ps.fontSize}px;color:${el.color || ps.color};line-height:1.3;padding:8px 12px;overflow:hidden;">${el.html}</div>`;
          break;
        }
        case 'image': {
          const imgSrc = imageDataUrl(projectDir, el.src, imageCache);
          const imgStyles = [
            `position:absolute`, `left:${p.x}px`, `top:${p.y}px`,
            `width:${p.width}px`, `height:${p.height}px`, `object-fit:contain`,
          ];
          if (el.shadow) imgStyles.push(`filter:drop-shadow(4px 8px 16px rgba(0,0,0,0.3))`);
          if (el.borderRadius) imgStyles.push(`border-radius:${el.borderRadius}px`);
          if (el.opacity != null && el.opacity < 1) imgStyles.push(`opacity:${el.opacity}`);
          if (el.rotation) imgStyles.push(`transform:rotate(${el.rotation}deg)`);
          inner += `<img src="${imgSrc}" style="${imgStyles.join(';')};" />`;
          break;
        }
        case 'demo': {
          try {
            const demoHtml = readFileSync(join(projectDir, el.src), 'utf8');
            const escaped = htmlEscapeForSrcdoc(demoHtml);
            inner += `<iframe srcdoc="${escaped}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;border:none;" sandbox="allow-scripts allow-same-origin"></iframe>`;
          } catch (e) {
            console.error(c(RED, `  ! Demo export failed for ${el.src}: ${e.message}`));
          }
          break;
        }
        case 'demo-piece': {
          demoPieceSrcs.add(el.demoSrc);
          try {
            const demoHtml = readFileSync(join(projectDir, el.demoSrc), 'utf8');
            const channelKey = `slide${i}-${el.demoSrc.replace(/[^a-z0-9]/gi, '')}`;
            const pieceHtml = injectDemoBootstrap(demoHtml, `#piece=${el.piece}`, channelKey);
            const escaped = htmlEscapeForSrcdoc(pieceHtml);
            inner += `<iframe srcdoc="${escaped}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;border:none;" sandbox="allow-scripts allow-same-origin"></iframe>`;
          } catch (e) {
            console.error(c(RED, `  ! Demo piece export failed for ${el.demoSrc}: ${e.message}`));
          }
          break;
        }
        case 'cover':
          inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;background:${el.color || '#ffffff'};"></div>`;
          break;
        case 'arrow': {
          const { x1, y1, x2, y2, color = '#2563eb', strokeWidth = 4, headSize = 16 } = el;
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const ha = Math.PI / 6;
          inner += `<svg style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;">`;
          inner += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}"/>`;
          inner += `<polygon points="${x2},${y2} ${x2 - headSize * Math.cos(angle - ha)},${y2 - headSize * Math.sin(angle - ha)} ${x2 - headSize * Math.cos(angle + ha)},${y2 - headSize * Math.sin(angle + ha)}" fill="${color}"/>`;
          inner += `</svg>`;
          break;
        }
      }
    }

    // Hidden controller iframes for demo-pieces
    for (const demoSrc of demoPieceSrcs) {
      try {
        const demoHtml = readFileSync(join(projectDir, demoSrc), 'utf8');
        const channelKey = `slide${i}-${demoSrc.replace(/[^a-z0-9]/gi, '')}`;
        const ctrlHtml = injectDemoBootstrap(demoHtml, '#role=controller', channelKey);
        const escaped = htmlEscapeForSrcdoc(ctrlHtml);
        inner += `<iframe srcdoc="${escaped}" style="position:absolute;width:1px;height:1px;border:none;opacity:0;pointer-events:none;" sandbox="allow-scripts allow-same-origin"></iframe>`;
      } catch (e) {
        console.error(c(RED, `  ! Controller iframe failed for ${demoSrc}: ${e.message}`));
      }
    }

    inner += `<div class="slide-footer"><span class="slide-footer-meta">${meta}</span><span class="slide-footer-number">${i + 1}</span></div>`;
    slideHtml.push(`<div class="slide" data-index="${i}">${inner}</div>`);
  }

  // Note: math will be rendered at runtime via MathJax CDN
  // (Pre-rendering would require running MathJax in Node, which is heavy)
  const preamble = presentation.config?.mathPreamble || '';
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${presentation.title || 'Presentation'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400&family=PT+Sans+Narrow:wght@400;700&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #000; overflow: hidden; font-family: 'PT Sans', sans-serif; }
#viewport { width: 100vw; height: 100vh; display: flex; justify-content: center; align-items: flex-start; }
.slide {
  width: ${W}px; height: ${H}px; background: #fff; position: relative; overflow: hidden;
  transform-origin: top left; display: none;
}
.slide.active { display: block; }
ul, ol { padding-left: 0; margin: 0; list-style-type: none; }
ul li::before { content: '- '; }
ol { counter-reset: ol-counter; }
ol li::before { counter-increment: ol-counter; content: counter(ol-counter) '. '; }
li { margin-bottom: 0.15em; list-style-position: inside; }
.slide-footer {
  position: absolute; bottom: 20px; right: 40px;
  display: flex; align-items: baseline; gap: 16px;
  font-family: 'PT Sans', sans-serif; color: #999; font-size: 18px;
}
.slide-footer-number { font-size: 24px; }
</style>
${preamble || /\$/.test(slideHtml.join('')) ? `<script>
window.MathJax = {
  tex: { inlineMath: [['$', '$']], displayMath: [['$$', '$$']]${preamble ? `,
    macros: {} ` : ''} },
  svg: { fontCache: 'global' },
  startup: { typeset: true }
};
</script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js" async></script>` : ''}
</head>
<body>
<div id="viewport">
${slideHtml.join('\n')}
</div>
<!-- eigendeck-source: ${Buffer.from(JSON.stringify(presentation)).toString('base64')} -->
<script>
const slides = document.querySelectorAll('.slide');
let current = 0;
const W = ${W}, H = ${H};
function show(i) {
  slides.forEach((s, idx) => s.classList.toggle('active', idx === i));
  resize();
  current = i;
}
function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(vw / W, vh / H);
  const s = slides[current];
  if (!s) return;
  s.style.transform = 'scale(' + scale + ')';
  const wrapper = document.getElementById('viewport');
  wrapper.style.paddingTop = Math.max(0, (vh - H * scale) / 2) + 'px';
}
show(0);
window.addEventListener('resize', resize);
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') {
    e.preventDefault(); if (current < slides.length - 1) show(current + 1);
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault(); if (current > 0) show(current - 1);
  }
  if (e.key === 'Home') { e.preventDefault(); show(0); }
  if (e.key === 'End') { e.preventDefault(); show(slides.length - 1); }
});
</script>
</body>
</html>`;

  writeFileSync(outPath, html);
  const sz = statSync(outPath).size;
  console.log(c(GREEN, `✓ Exported ${slides.length} slides → ${outPath} (${(sz / 1024 / 1024).toFixed(2)} MB)`));
  console.log(`  Inlined ${imageCache.size} images`);
  if (/\$/.test(slideHtml.join(''))) {
    console.log(c(YELLOW, '  Note: Math is rendered at runtime via MathJax CDN.'));
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
  case 'export': cmdExport(projectDir, rest[0]); break;
  case 'lint': cmdLint(projectDir); break;
  default:
    console.error(c(RED, `Unknown command: ${cmd}`));
    usage();
    process.exit(1);
}
