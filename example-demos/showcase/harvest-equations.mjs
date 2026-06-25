// Regenerate the equation SVGs used by the showcase, by rendering LaTeX through
// the REAL in-app MathJax (the only renderer that works) and harvesting the
// resulting <svg>. Writes:
//   - demo-equations.json   (per-demo equations; recolored dark; with aspect)
//   - title-equations.json  (title-slide backdrop; currentColor kept; + layout)
//
// You only need this when CHANGING an equation — the two JSONs are committed, so
// build-showcase.mjs works without re-harvesting. Run via the eigendeck-e2e rig:
//   PROBE=harvest-equations.mjs E2E_DECK=<scratch deck> bash run-probe.sh
//
// Why harvest instead of rendering math at build/export time: the headless HTML
// export's math->SVG path (renderMathPerBundle / iframe pool) silently falls
// back to raw "$...$". In-app DISPLAY renders fine, so we scrape that.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
const GET = "var e=document.querySelector('[data-c]'); var s=e&&e.closest('svg'); return s? s.outerHTML : 'NONE';";

// title-slide backdrop equations + their scatter layout (left/top %, rotation, font vw)
const TITLE = [
  { tex: 'A = U\\Sigma V^{\\top}', left: 5, top: 14, rot: -6, fontvw: 3.2 },
  { tex: 'E = mc^2', left: 41, top: 4, rot: -3, fontvw: 3.0 },
  { tex: 'e^{i\\pi}+1=0', left: 70, top: 13, rot: 5, fontvw: 3.2 },
  { tex: '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx=\\sqrt{\\pi}', left: 6, top: 60, rot: 6, fontvw: 2.5 },
  { tex: 'F = ma', left: 80, top: 58, rot: -9, fontvw: 3.3 },
  { tex: 'a^2 + b^2 = c^2', left: 57, top: 66, rot: 8, fontvw: 2.7 },
];
// per-demo equations (keyed by demo file)
const DEMO = [
  { file: 'drum-eigenmodes.html', tex: '-\\Delta u = \\lambda u' },
  { file: 'gradient-descent.html', tex: 'x_{k+1} = x_k - \\alpha\\,\\nabla f(x_k)' },
  { file: 'graph-layout.html', tex: 'f_{\\mathrm{attr}}=\\frac{d^2}{k},\\quad f_{\\mathrm{rep}}=\\frac{k^2}{d}' },
  { file: 'wave-equation.html', tex: '\\frac{\\partial^2 u}{\\partial t^2}=c^2\\,\\frac{\\partial^2 u}{\\partial x^2}' },
  { file: 'fourier.html', tex: 'X_k=\\sum_{n=0}^{N-1} x_n\\,e^{-2\\pi i kn/N}' },
  { file: 'finite-element.html', tex: 'K\\mathbf{u}=\\mathbf{f}' },
  { file: 'protein-folding.html', tex: 'p(\\text{fold}) \\propto e^{-E/k_{B}T}' },
  { file: 'sequence-alignment.html', tex: 'F_{i,j}=\\max\\{\\,F_{i-1,j-1}+s,\\ F_{i-1,j}-g,\\ F_{i,j-1}-g\\,\\}' },
  { file: 'molecule-viewer.html', tex: 'V(r)=4\\varepsilon\\left[\\left(\\tfrac{\\sigma}{r}\\right)^{12}-\\left(\\tfrac{\\sigma}{r}\\right)^{6}\\right]' },
  { file: 'neural-network.html', tex: '\\mathbf{y}=\\mathcal{F}(\\mathbf{x})+\\mathbf{x}' },
  { file: 'tiled-svd.html', tex: 'A\\approx\\sum_{k=1}^{r}\\sigma_k\\,u_k v_k^{\\top}' },
];
const DEMO_COLOR = '#1f2430';   // demo-slide equations are dark/readable (title ones keep currentColor)

const sid = await open(); if (!sid) { console.error('open'); process.exit(1); }
for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) break; }
async function render(tex) {
  await exec(sid, `var g=window.__eigendeck.store.getState; g().selectSlide(0); g().updateSlide(0,{theme:undefined,elements:[]}); g().addElement({id:'m',type:'text',preset:'body',fontSize:80,html:${JSON.stringify('$' + tex + '$')},position:{x:120,y:200,width:1600,height:240}}); g().selectObject({type:'slide'});`);
  for (let i = 0; i < 16; i++) { await sleep(600); const s = await exec(sid, GET); if (s && s !== 'NONE') return s; }
  throw new Error('render failed: ' + tex);
}
function aspect(svg) { const m = svg.match(/viewBox="([\d.\- ]+)"/); if (!m) return 4; const p = m[1].trim().split(/\s+/).map(Number); return p.length === 4 && p[3] > 0 ? +(p[2] / p[3]).toFixed(3) : 4; }

const title = [];
for (const t of TITLE) { const svg = await render(t.tex); title.push({ ...t, svg }); console.log('title', t.tex.slice(0, 16), 'ok'); }
writeFileSync(join(HERE, 'title-equations.json'), JSON.stringify(title));

const demo = {};
for (const d of DEMO) { const svg = (await render(d.tex)).split('currentColor').join(DEMO_COLOR); demo[d.file] = { tex: d.tex, aspect: aspect(svg), svg }; console.log('demo', d.file, 'ok'); }
writeFileSync(join(HERE, 'demo-equations.json'), JSON.stringify(demo));

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.log('OK: wrote title-equations.json + demo-equations.json');
process.exit(0);
