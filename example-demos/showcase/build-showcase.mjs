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
  { file: 'graph-layout.html',      title: 'Graph layout',               cap: 'Drag any node — the force-directed layout re-settles and reveals three communities.' },
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
// demo HTMLs
for (const d of DEMOS) addAsset(d.file, `demos/${d.file}`, 'text/html', readFileSync(join(DEMODIR, d.file)));
// title decoration: inject the famous-equation backdrop (harvested MathJax SVG)
// into the template's __EQLAYER__ slot, so it renders with no MathJax at runtime.
const titleEq = JSON.parse(readFileSync(join(HERE, 'title-equations.json'), 'utf8'));
const eqLayer = titleEq.map((e) =>
  `<span class="eq" style="left:${e.left}%;top:${e.top}%;font-size:${e.fontvw}vw;transform:rotate(${e.rot}deg)">${e.svg}</span>`
).join('');
const titleDecor = readFileSync(join(DEMODIR, 'title-decor.html'), 'utf8').replace('__EQLAYER__', eqLayer);
if (titleDecor.includes('__EQLAYER__')) throw new Error('title-decor.html: __EQLAYER__ slot not found');
addAsset('title-decor.html', 'demos/title-decor.html', 'text/html', Buffer.from(titleDecor, 'utf8'));
// (per-slide equations are TEXT elements with LaTeX — see below — so they're
//  editable in the app and still render in the export. No SVG assets needed.)

// ---- slides ----------------------------------------------------------------
const ctr = (html) => `<div style="text-align:center">${html}</div>`;
const slides = [];

// slide 0 — title: decoration (equations backdrop + bouncing balls) + wordmark
slides.push({
  id: 's0', notes: 'Title slide.',
  elements: [
    { id: 's0-decor', type: 'demo', assetId: assetId['title-decor.html'], position: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 's0-title', type: 'text', preset: 'title', html: ctr('Eigendeck'), position: { x: 60, y: 440, width: 1800, height: 170 } },
    { id: 's0-sub',   type: 'text', preset: 'body',  html: ctr('Interactive show-and-tell presentations — real demos, live on the slide.'), position: { x: 60, y: 598, width: 1800, height: 70 } },
  ],
});

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
