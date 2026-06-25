// Assemble the Eigendeck showcase deck as a self-contained presentation.json
// (slides + elements + base64-embedded assets), ready for:
//
//   eigendeck-cli showcase.eigendeck import json showcase.json
//
// `import json` builds the deck in a fresh in-memory DB and atomically writes
// the file — deterministic, no GUI, and no reliance on the editor's incremental
// flush (which only persists tracked deltas and silently dropped programmatic
// adds when the deck was built head-less via the WebDriver seam).
//
// Run:  node build-showcase.mjs              (writes ./showcase.json)
// Then: see README.md for the import + HTML-export steps.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMODIR = join(HERE, 'demos');
const b64 = (buf) => Buffer.from(buf).toString('base64');

// ---- demo slides (order = slide order) -------------------------------------
const DEMOS = [
  { file: 'drum-eigenmodes.html',   title: 'Eigenmodes of a membrane',   cap: 'Paint a membrane; we solve −Δu = λu on it. Pick a mode: its nodal lines (left) and the vibrating eigenvector (right). Eigenvectors of the Laplacian, made visible.' },
  { file: 'gradient-descent.html',  title: 'Gradient descent',           cap: 'Click anywhere to drop a ball — it follows the gradient into a basin on a non-convex surface.' },
  { file: 'graph-layout.html',      title: 'Graph layout',               cap: 'The Fauci email network (Benson, Veldt & Gleich, ICWSM 2022), force-directed. Coloured by a spectral min-cut — comms staff vs scientists, 3 cut edges. Hover for a name; drag to re-settle.' },
  { file: 'wave-equation.html',     title: 'The wave equation',          cap: 'Click or drag to pluck the string — the pulse splits into two waves and reflects off the ends.' },
  { file: 'fourier.html',           title: 'Fourier & the FFT',          cap: 'A signal and its frequency spectrum. Drag "keep" to rebuild it from only its largest Fourier coefficients — or draw your own. Real FFT, live.' },
  { file: 'finite-element.html',    title: 'Finite elements',            cap: 'A triangulated sheet clamped at the left, sagging under gravity. Elements shaded by strain — tension above, compression below. Drag any node.' },
  { file: 'sequence-alignment.html',title: 'Sequence alignment',         cap: 'Needleman–Wunsch global alignment. Drag the gap penalty to re-solve; the traceback path and alignment update live.' },
  { file: 'protein-folding.html',   title: 'Protein folding',            cap: 'Hydrophobic collapse (the HP model). Residues fold so the hydrophobic ones (warm) bury into a core. Drag to tug; "new sequence" refolds.' },
  { file: 'molecule-viewer.html',   title: 'Molecule viewer',            cap: 'Pick a molecule from the list and drag to rotate the 3-D ball-and-stick model — from water up to a C₆₀ buckyball. Computed geometry.' },
  { file: 'neural-network.html',    title: 'Neural network',             cap: 'A small ResNet classifying MNIST — draw a digit and watch it flow through the layers. Real trained weights, live inference.' },
  { file: 'tiled-svd.html',         title: 'Low-rank image compression', cap: 'Plain SVD vs the SVD of a matrix of tiles, at equal storage. Drag the budget — the tiled reorganization wins. (Gleich, arXiv:2402.18427.)' },
];
const EQ = JSON.parse(readFileSync(join(HERE, 'demo-equations.json'), 'utf8'));

// ---- assets (base64) -------------------------------------------------------
const assets = [];
const assetId = {};                 // file/key -> assetId
function addAsset(key, path, mime, bytes) {
  const id = 'asset-' + key.replace(/[^a-z0-9]+/gi, '-');
  assetId[key] = id;
  assets.push({ assetId: id, path, mime, size: bytes.length, data: b64(bytes) });
  return id;
}
// demo HTMLs (graph-layout gets the d3-force bundle injected into its slot)
const d3force = readFileSync(join(HERE, 'vendor', 'd3-force.min.js'), 'utf8');
for (const d of DEMOS) {
  let html = readFileSync(join(DEMODIR, d.file), 'utf8');
  if (d.file === 'graph-layout.html') {
    html = html.replace('/* __D3FORCE__ */', () => d3force);   // function replacer → no $-escaping surprises
    if (html.includes('/* __D3FORCE__ */')) throw new Error('graph-layout.html: __D3FORCE__ slot not found');
  }
  addAsset(d.file, `demos/${d.file}`, 'text/html', Buffer.from(html, 'utf8'));
}
// title decoration is now just the bouncing-ball physics — the equation backdrop
// moved onto the slide itself as editable, rotated, softly-coloured TEXT elements.
const titleDecor = readFileSync(join(DEMODIR, 'title-decor.html'), 'utf8').replace('__EQLAYER__', '');
addAsset('title-decor.html', 'demos/title-decor.html', 'text/html', Buffer.from(titleDecor, 'utf8'));
addAsset('logo', 'images/eigendeck-logo.svg', 'image/svg+xml', readFileSync(join(HERE, '..', '..', 'logo-icon-macos.svg')));
// (per-slide equations are TEXT elements with LaTeX too — see below.)

// ---- slides ----------------------------------------------------------------
const ctr = (html) => `<div style="text-align:center">${html}</div>`;
const slides = [];

// slide 0 — title: bouncing-ball demo + logo + wordmark, with famous equations
// strewn around as rotated, softly-bright TEXT elements (LaTeX you can click into;
// colours echo the balls). Equations hug the edges, leaving the centre column clear.
const TITLE_EQ = [
  { tex: 'A = U\\Sigma V^{\\top}',                               x: 70,   y: 110, w: 600, rot: -8,  size: 60, color: '#3dc5b6' },
  { tex: 'E = mc^2',                                            x: 1440, y: 92,  w: 430, rot: 7,   size: 66, color: '#f47a6a' },
  { tex: 'F = ma',                                              x: 210,  y: 252, w: 320, rot: -12, size: 60, color: '#a98bf0' },
  { tex: 'a^2 + b^2 = c^2',                                     x: 1360, y: 280, w: 500, rot: 9,   size: 54, color: '#ef86bf' },
  { tex: '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx=\\sqrt{\\pi}', x: 36,  y: 398, w: 640, rot: 6,   size: 48, color: '#5b9bf0' },
  { tex: 'e^{i\\pi}+1=0',                                       x: 1380, y: 470, w: 480, rot: -6,  size: 58, color: '#f0b24a' },
];
const titleEls = [
  { id: 's0-decor', type: 'demo', assetId: assetId['title-decor.html'], position: { x: 0, y: 0, width: 1920, height: 1080 } },
];
TITLE_EQ.forEach((e, i) => titleEls.push({
  id: `s0-eq${i}`, type: 'text', preset: 'textbox', color: e.color, fontSize: e.size, rotation: e.rot,
  html: ctr('$' + e.tex + '$'), position: { x: e.x, y: e.y, width: e.w, height: Math.round(e.size * 2.4) },
}));
titleEls.push({ id: 's0-logo', type: 'image', assetId: assetId['logo'], kind: 'svg', position: { x: 835, y: 48, width: 250, height: 250 } });
titleEls.push({ id: 's0-title', type: 'text', preset: 'title', html: ctr('Eigendeck'), position: { x: 60, y: 340, width: 1800, height: 145 } });
titleEls.push({ id: 's0-sub', type: 'text', preset: 'body', html: ctr('LaTeX math &amp; interactive technical elements') + ctr('… click through to see the other slides …'), position: { x: 64, y: 496, width: 1792, height: 150 } });
slides.push({ id: 's0', notes: 'Title slide.', elements: titleEls });

// slides 1..N — title, equation (centered), demo, caption
DEMOS.forEach((d, k) => {
  const eq = EQ[d.file];
  const els = [
    { id: `s${k + 1}-title`, type: 'text', preset: 'title', html: d.title, position: { x: 60, y: 54, width: 1800, height: 96 } },
  ];
  if (eq) {
    // editable LaTeX text element (click in the app to see/edit the source);
    // MathJax renders it both in the app and in the export.
    els.push({ id: `s${k + 1}-eq`, type: 'text', preset: 'body', fontSize: 48, color: '#1f2933', html: ctr('$' + eq.tex + '$'), position: { x: 60, y: 150, width: 1800, height: 92 } });
  }
  els.push({ id: `s${k + 1}-demo`, type: 'demo', assetId: assetId[d.file], position: { x: 60, y: 240, width: 1800, height: 728 } });
  els.push({ id: `s${k + 1}-cap`, type: 'text', preset: 'footnote', html: d.cap, position: { x: 60, y: 984, width: 1800, height: 40 } });
  slides.push({ id: `s${k + 1}`, notes: '', elements: els });
});

const deck = {
  title: 'Eigendeck — Showcase',
  theme: 'white',
  config: { width: 1920, height: 1080, author: 'David F. Gleich', venue: 'Eigendeck Showcase', showSlideNumber: true },
  slides,
  assets,
};

const out = join(HERE, 'showcase.json');
writeFileSync(out, JSON.stringify(deck));
console.log(`wrote ${out}`);
console.log(`  ${slides.length} slides, ${assets.length} assets, ${(JSON.stringify(deck).length / 1048576).toFixed(1)} MB JSON`);
