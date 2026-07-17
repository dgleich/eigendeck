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
import { buildTextSlides } from './text-slides.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMODIR = join(HERE, 'demos');
const b64 = (buf) => Buffer.from(buf).toString('base64');

// ---- demo slides (order = slide order) -------------------------------------
const DEMOS = [
  { file: 'drum-eigenmodes.html',   title: 'Eigenmodes of a membrane',   cap: 'Paint a membrane; we solve −Δu = λu on it. Pick a mode: its nodal lines (left) and the vibrating eigenvector (right). Eigenvectors of the Laplacian, made visible.' },
  { file: 'gradient-descent.html',  title: 'Gradient descent',           cap: 'Click anywhere to drop a ball — it follows the gradient into a basin on a non-convex surface.' },
  { file: 'graph-layout.html',      title: 'Looking at paths in graphs', cap: 'The Fauci email reply network (Benson, Veldt & Gleich, ICWSM 2022), force-directed. Click two people to highlight every shortest reply-path between them — the count and length show below. Coloured by a spectral min-cut; hover for a name; drag to re-settle.' },
  { file: 'wave-equation.html',     title: 'The wave equation',          cap: 'Click or drag to pluck the string — the pulse splits into two waves and reflects off the ends.' },
  { file: 'fourier.html',           title: 'Fourier & the FFT',          cap: 'A signal and its frequency spectrum. Drag "keep" to rebuild it from only its largest Fourier coefficients — or draw your own. Real FFT, live.' },
  { file: 'polynomial-interpolation.html', title: 'Polynomial interpolation', cap: 'The Runge phenomenon: interpolating through uniform nodes blows up near the ends as the degree grows, while Chebyshev nodes (clustered at the ends) converge. Drag the degree.' },
  // NOTE: finite-element, sequence-alignment, protein-folding are intentionally
  // NOT in the deck for now (not up to snuff) — files kept in demos/ for later.
  { file: 'molecule-viewer.html',   title: 'Molecule viewer',            cap: 'Pick a molecule from the list and drag to rotate the 3-D ball-and-stick model — from water up to a C₆₀ buckyball. Computed geometry.' },
  { file: 'neural-network.html',    title: 'Neural network',             cap: 'A small ResNet classifying MNIST — draw a digit and watch it flow through the layers. Real trained weights, live inference.' },
  { file: 'tiled-svd.html',         title: 'Low-rank image compression', cap: 'Plain SVD vs the SVD of a matrix of tiles, at equal storage. Drag the budget — the tiled reorganization wins. (Gleich, arXiv:2402.18427.)' },
];
const EQ = JSON.parse(readFileSync(join(HERE, 'demo-equations.json'), 'utf8'));

// ---- assets (base64) -------------------------------------------------------
const assets = [];
const assetId = {};                 // file/key -> assetId
function addAsset(key, path, mime, bytes) {
  // A demo HTML asset MUST carry the <!--eigendeck-demo-vN--> marker or it won't
  // mount in the app (isEigendeckDemo rejects it → blank). Fail the build loudly
  // rather than ship a downloadable deck with dead demos — this was a real bug:
  // the committed artifact predated the sources getting markers.
  if (mime === 'text/html' && !/<!--eigendeck-demo-v[0-9]+-->/.test(bytes.toString('utf8', 0, 400))) {
    throw new Error(`addAsset("${path}"): demo HTML is missing the <!--eigendeck-demo-vN--> marker (put it right after <!DOCTYPE html>) — it would render blank in the app.`);
  }
  const id = 'asset-' + key.replace(/[^a-z0-9]+/gi, '-');
  assetId[key] = id;
  assets.push({ assetId: id, path, mime, size: bytes.length, data: b64(bytes) });
  return id;
}
// graph-layout & tiled-svd are NOT self-contained: each carries a vendored-lib
// placeholder and lives on disk as *.html.tmpl (a non-.html extension) so it
// can't be dragged into a deck as a finished demo — added raw, the library is
// missing and the demo silently renders nothing (the raw-open guard returns).
// The showcase build is the ONLY supported way to realize them: read the .tmpl,
// inline the vendored lib, embed under the .html name.
//   graph-layout → d3-force ;  tiled-svd → svd-js (Golub–Reinsch SVD).
const TEMPLATE_SRC = { 'graph-layout.html': 'graph-layout.html.tmpl', 'tiled-svd.html': 'tiled-svd.html.tmpl' };
const d3force = readFileSync(join(HERE, 'vendor', 'd3-force.min.js'), 'utf8');
const svdjs = readFileSync(join(HERE, 'vendor', 'svd-js.umd.js'), 'utf8');
for (const d of DEMOS) {
  let html = readFileSync(join(DEMODIR, TEMPLATE_SRC[d.file] || d.file), 'utf8');
  if (d.file === 'graph-layout.html') {
    html = html.replace('/* __D3FORCE__ */', () => d3force);   // function replacer → no $-escaping surprises
    if (html.includes('/* __D3FORCE__ */')) throw new Error('graph-layout.html: __D3FORCE__ slot not found');
  }
  if (d.file === 'tiled-svd.html') {
    html = html.replace('/* __SVDJS__ */', () => svdjs);
    if (html.includes('/* __SVDJS__ */')) throw new Error('tiled-svd.html: __SVDJS__ slot not found');
  }
  addAsset(d.file, `demos/${d.file}`, 'text/html', Buffer.from(html, 'utf8'));
}
// title decoration is now just the bouncing-ball physics — the equation backdrop
// moved onto the slide itself as editable, rotated, softly-coloured TEXT elements.
const titleDecor = readFileSync(join(DEMODIR, 'title-decor.html'), 'utf8').replace('__EQLAYER__', '');
addAsset('title-decor.html', 'demos/title-decor.html', 'text/html', Buffer.from(titleDecor, 'utf8'));
// OPENING title hero: the membrane demo in HERO layout — a big mode palette at the
// left + the vibrating membrane at the right + presets (still interactive), with
// the nodal-lines pane and all text/labels removed. HERO flag injected here.
let eigenHero = readFileSync(join(DEMODIR, 'drum-eigenmodes.html'), 'utf8');
if (!eigenHero.includes('/* __HERO__ */')) throw new Error('drum-eigenmodes.html: __HERO__ slot not found');
eigenHero = eigenHero.replace('/* __HERO__ */', 'HERO = true;');
addAsset('eigenmodes-hero', 'demos/eigenmodes-hero.html', 'text/html', Buffer.from(eigenHero, 'utf8'));
addAsset('logo', 'images/eigendeck-logo.svg', 'image/svg+xml', readFileSync(join(HERE, '..', '..', 'logo-icon-macos.svg')));
// (per-slide equations are TEXT elements with LaTeX too — see below.)

// ---- slides ----------------------------------------------------------------
const ctr = (html) => `<div style="text-align:center">${html}</div>`;

// Famous equations strewn around a title slide as rotated, softly-bright TEXT
// elements (LaTeX you can click into). They hug the edges, leaving the centre clear.
const TITLE_EQ = [
  { tex: 'A = U\\Sigma V^{\\top}',                               x: 70,   y: 110, w: 600, rot: -8,  size: 60, color: '#3dc5b6' },
  { tex: 'E = mc^2',                                            x: 1440, y: 92,  w: 430, rot: 7,   size: 66, color: '#f47a6a' },
  { tex: 'F = ma',                                              x: 210,  y: 252, w: 320, rot: -12, size: 60, color: '#a98bf0' },
  { tex: 'a^2 + b^2 = c^2',                                     x: 1360, y: 280, w: 500, rot: 9,   size: 54, color: '#ef86bf' },
  { tex: '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx=\\sqrt{\\pi}', x: 36,  y: 398, w: 640, rot: 6,   size: 48, color: '#5b9bf0' },
  { tex: 'e^{i\\pi}+1=0',                                       x: 1380, y: 470, w: 480, rot: -6,  size: 58, color: '#f0b24a' },
  // Laplacian eigen-equation (the membrane hero) + a Navier–Stokes / Cauchy-momentum
  // equation, flanking the demo at the lower corners (see showcase-intro mockup).
  { tex: '-\\Delta u = \\lambda u',                             x: 20,   y: 770, w: 420, rot: -7, size: 50, color: '#2faa6b' },
  { tex: '\\frac{d\\mathbf{u}}{dt}=\\frac{1}{\\rho}\\,\\nabla\\!\\cdot\\boldsymbol{\\sigma}+\\mathbf{a}', x: 1470, y: 780, w: 440, rot: 8, size: 42, color: '#2a9db5' },
];

// Title slide: a hero demo (heroKey, position = heroPos or full-bleed) + logo +
// wordmark + rotated equations + subtitle. The deck OPENS serious (eigenmodes
// hero, confined to the lower third) and CLOSES whimsical (full-bleed balls).
function titleSlide(pfx, heroKey, subHtml, heroPos, subPos) {
  const els = [{ id: `${pfx}-decor`, type: 'demo', assetId: assetId[heroKey], position: heroPos || { x: 0, y: 0, width: 1920, height: 1080 } }];
  TITLE_EQ.forEach((e, i) => els.push({
    id: `${pfx}-eq${i}`, type: 'text', preset: 'textbox', color: e.color, fontSize: e.size, rotation: e.rot,
    html: ctr('$' + e.tex + '$'), position: { x: e.x, y: e.y, width: e.w, height: Math.round(e.size * 2.4) },
  }));
  els.push({ id: `${pfx}-logo`, type: 'image', assetId: assetId['logo'], kind: 'svg', position: { x: 835, y: 48, width: 250, height: 250 } });
  els.push({ id: `${pfx}-title`, type: 'text', preset: 'title', html: ctr('Eigendeck'), position: { x: 60, y: 340, width: 1800, height: 145 } });
  els.push({ id: `${pfx}-sub`, type: 'text', preset: 'body', html: subHtml, position: subPos || { x: 64, y: 496, width: 1792, height: 150 } });
  return { id: pfx, notes: 'Title slide.', elements: els };
}

// Demos whose per-slide equation is intentionally dropped.
const SKIP_EQ = new Set(['molecule-viewer.html', 'neural-network.html', 'polynomial-interpolation.html', 'graph-layout.html']);
// Gradient descent shows the loss f, its gradient, and the update rule (3 lines).
const GRAD_EQ =
  String.raw`$$f(\mathbf{x})=\tfrac12\beta\lVert\mathbf{x}\rVert^{2}-\sum_i a_i\,e^{-\lVert\mathbf{x}-\mathbf{c}_i\rVert^{2}/2s_i^{2}}$$` +
  String.raw`$$\nabla f(\mathbf{x})=\beta\,\mathbf{x}+\sum_i \tfrac{a_i}{s_i^{2}}(\mathbf{x}-\mathbf{c}_i)\,e^{-\lVert\mathbf{x}-\mathbf{c}_i\rVert^{2}/2s_i^{2}}$$` +
  String.raw`$$x_{k+1}=x_k-\alpha\,\nabla f(x_k)$$`;

// Per-slide styling (theme + fonts) so the deck shows off the font/theme range.
// Equation + footnote colours derive from the theme (a hard-coded dark grey is
// invisible on a dark slide). Fonts round-trip through `import json`.
const STYLE = {
  'drum-eigenmodes.html':          { theme: 'dark',  titleFont: 'lm-sans',         bodyFont: 'lm-sans' },          // Computer Modern Sans
  'gradient-descent.html':         { theme: 'light', titleFont: 'source-code',     bodyFont: 'concrete-euler' },   // Source Code · Concrete
  'tiled-svd.html':                { theme: 'dark' },
  'graph-layout.html':             { titleFont: 'lato', bodyFont: 'shantell', centerTitle: true, footnoteSize: 30, footnoteH: 120 },
  'polynomial-interpolation.html': { theme: 'light', titleFont: 'libertinus-sans', bodyFont: 'libertinus-sans' },
  // a little extra variety on the rest, to show the range:
  'wave-equation.html':            { theme: 'light', titleFont: 'libertinus',      bodyFont: 'libertinus' },
  'fourier.html':                  { titleFont: 'source-sans', bodyFont: 'source-sans' },
  'molecule-viewer.html':          { theme: 'dark',  titleFont: 'noto-sans',       bodyFont: 'noto-sans' },
  'neural-network.html':           { theme: 'dark',  titleFont: 'source-sans',     bodyFont: 'source-sans' },
};
const DARK_THEME = new Set(['dark', 'black']);
const eqColor = (theme) => (DARK_THEME.has(theme) ? '#e8e8e8' : '#1f2933');

function demoSlide(d) {
  const key = d.file.replace(/\.html$/, '');
  const st = STYLE[d.file] || {};
  const eqc = eqColor(st.theme);
  const titleHtml = st.centerTitle ? ctr(d.title) : d.title;
  const els = [{ id: `${key}-title`, type: 'text', preset: 'title', html: titleHtml, position: { x: 60, y: 54, width: 1800, height: 96 } }];
  if (d.file === 'gradient-descent.html') {
    els.push({ id: `${key}-eq`, type: 'text', preset: 'body', fontSize: 30, color: eqc, html: GRAD_EQ, position: { x: 60, y: 140, width: 1800, height: 184 } });
    els.push({ id: `${key}-demo`, type: 'demo', assetId: assetId[d.file], position: { x: 60, y: 338, width: 1800, height: 630 } });
  } else {
    const eqTex = SKIP_EQ.has(d.file) ? null : (EQ[d.file] && EQ[d.file].tex);
    if (eqTex) els.push({ id: `${key}-eq`, type: 'text', preset: 'body', fontSize: 48, color: eqc, html: ctr('$' + eqTex + '$'), position: { x: 60, y: 150, width: 1800, height: 92 } });
    // no-equation slides reclaim the freed strip — the demo starts higher + taller
    els.push({ id: `${key}-demo`, type: 'demo', assetId: assetId[d.file], position: { x: 60, y: eqTex ? 240 : 168, width: 1800, height: eqTex ? 728 : 800 } });
  }
  // footnote is bottom-aligned, so a taller box grows UPWARD — long captions
  // (e.g. the graph slide) get 2–3 lines instead of being clipped, same baseline.
  const capH = st.footnoteH || 84;
  const cap = { id: `${key}-cap`, type: 'text', preset: 'footnote', html: d.cap, position: { x: 60, y: 1024 - capH, width: 1800, height: capH } };
  if (st.footnoteSize) cap.fontSize = st.footnoteSize;
  els.push(cap);
  const slide = { id: key, notes: '', elements: els };
  if (st.theme) slide.theme = st.theme;
  if (st.titleFont) slide.titleFont = st.titleFont;
  if (st.bodyFont) slide.bodyFont = st.bodyFont;
  return slide;
}

const demoByFile = {};
DEMOS.forEach((d) => { demoByFile[d.file] = demoSlide(d); });
const tx = {};
buildTextSlides().forEach((s) => { tx[s.id] = s; });

// Explicit deck order (per the requested arrangement).
const slides = [
  titleSlide('s0', 'eigenmodes-hero', ctr('LaTeX math &amp; interactive technical elements') + ctr('… click through to see the other slides …'), { x: 458, y: 626, width: 1000, height: 380 }),
  demoByFile['drum-eigenmodes.html'],
  tx['tx-cauchy'],
  demoByFile['gradient-descent.html'],
  tx['tx-eckart'],            // the best low-rank approximation (theorem)
  demoByFile['tiled-svd.html'], // low-rank image (the demo)
  demoByFile['graph-layout.html'],
  demoByFile['wave-equation.html'],
  tx['tx-maxwell'],
  demoByFile['fourier.html'],
  demoByFile['polynomial-interpolation.html'],
  tx['tx-quote'],             // Hamming quote, right before the molecule viewer
  demoByFile['molecule-viewer.html'],
  demoByFile['neural-network.html'],
  tx['tx-master'],
  titleSlide('s-end', 'title-decor.html', ctr('We can&rsquo;t wait to see what you use this to do!') + ctr('eigendeck.dev')),  // whimsy (balls) to close
];

// Intro pointers on the first two slides — "click here" annotations + arrows that
// invite the viewer to interact. Ported from the hand-authored showcase-open deck.
//
// #163: a text callout's transparent bounding box swallows clicks on the demo
// buttons underneath it, so any callout whose box overlaps the demo's controls
// is unshift()ed to the BOTTOM of the z-order (behind the demo) — its glyphs sit
// clear of the controls, so it stays visible. Callouts that don't overlap any
// button (and the thin arrows, which never cover one) stay push()ed on top.
const ARROW = { type: 'arrow', position: { x: 0, y: 0, width: 0, height: 0 }, color: '#2563eb', strokeWidth: 4, headSize: 16 };
// "Click here" blankets the mode palette on the left → behind the demo.
slides[0].elements.unshift(
  { id: 's0-anno-1',  type: 'text', preset: 'annotation', html: 'Click here&nbsp;', position: { x: 302,  y: 887, width: 600, height: 150 } },
);
// "And here!" sits over the empty right of the palette (no buttons) + the arrows
// are thin → stay on top, fully visible.
slides[0].elements.push(
  { id: 's0-anno-2',  type: 'text', preset: 'annotation', html: 'And here!&nbsp;',  position: { x: 1334, y: 870, width: 600, height: 150 } },
  { id: 's0-arrow-1', ...ARROW, x1: 464,  y1: 914, x2: 535,  y2: 869 },
  { id: 's0-arrow-2', ...ARROW, x1: 1322, y1: 905, x2: 1257, y2: 947 },
);
// Drum: the "Try drawing here!" box is one line high (height 58), so it clears
// the paint controls and no longer blocks them — it stays on top and visible,
// alongside its arrow.
slides[1].elements.push(
  { id: 'drum-anno-1',  type: 'text', preset: 'annotation', html: 'Try drawing here!&nbsp;', color: '#2663eb', position: { x: 257, y: 803, width: 595, height: 58 } },
  { id: 'drum-arrow-1', ...ARROW, x1: 529, y1: 839, x2: 529, y2: 807 },
);

const deck = {
  title: 'Eigendeck — Showcase',
  theme: 'white',
  // Store the deck's fonts explicitly (don't rely on the app default, which changed
  // from PT Sans → Lato): the showcase is designed around PT Sans. `import json`
  // writes config verbatim, so this is what pins the deck's look.
  config: { width: 1920, height: 1080, author: 'David F. Gleich', venue: 'Eigendeck Showcase', showSlideNumber: true, defaultTitleFont: 'ptsans', defaultBodyFont: 'ptsans', defaultMonoFont: 'source-code' },
  slides,
  assets,
};

const out = join(HERE, 'showcase.json');
writeFileSync(out, JSON.stringify(deck));
console.log(`wrote ${out}`);
console.log(`  ${slides.length} slides, ${assets.length} assets, ${(JSON.stringify(deck).length / 1048576).toFixed(1)} MB JSON`);
