// LIVE theme-relative color token (#132 follow-up) in the REAL app. A foreground
// `color:'accent'` (text + arrow) and a cover `boxTint:'accent'` must render as the
// slide theme's accent/wash — AND re-adapt when the theme changes at runtime. That
// live re-adaptation is the whole point of a token (vs a baked hex) and can only be
// proven in the running store + WebKit; the unit guard (colorTokenRenderPaths) pins
// the static resolution. Asserts, on the white theme THEN after switching the slide
// to dark: text color, arrow stroke, cover fill all follow the theme accent; and the
// real exportHtml() carries the (now-dark) accent. Screenshots each theme.
import { writeFileSync, mkdirSync } from 'node:fs';
import { textBackgroundResolved } from '../src/lib/textStyle.mjs';
import { themeColorsByName } from '../src/lib/themeColors.mjs';

const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/color-token-e2e';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('TOKEN_FAIL:', m); process.exit(1); };
function hexToRgb(hex) { const h = hex.replace('#', ''); return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; }
function savePng(dataUrl, file) { if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) return; mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${file}`, Buffer.from(dataUrl.split(',')[1], 'base64')); }

// Expected values per theme (from the app's own resolvers).
function expected(themeName) {
  const th = themeColorsByName(themeName);
  return { accent: th.accent, accentRgb: hexToRgb(th.accent), wash: textBackgroundResolved({ boxTint: 'accent' }, th), washRgb: hexToRgb(textBackgroundResolved({ boxTint: 'accent' }, th)) };
}

// Read the three accent-driven values from the live present-mode DOM.
async function readPresent(sid, washRgb) {
  return exec(sid, `
    const inner = document.querySelector('.present-slide .el-text foreignObject > div > div');
    const line = document.querySelector('.present-slide line');
    const cover = [...document.querySelectorAll('.present-slide div')].find(d => getComputedStyle(d).backgroundColor === ${JSON.stringify(washRgb)});
    return {
      textColor: inner ? getComputedStyle(inner).color : null,
      arrowStroke: line ? line.getAttribute('stroke') : null,
      coverMatched: !!cover,
    };
  `);
}

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");
for (let i = 0; i < 20; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.present-slide .el-text foreignObject')")) break; }

// --- WHITE theme (the deck default) ---
const w = expected('white');
await sleep(300);
const rw = await readPresent(sid, w.washRgb);
if (rw?.textColor !== w.accentRgb) problems.push(`[white] text color ${rw?.textColor} != accent ${w.accentRgb}`);
if (rw?.arrowStroke !== w.accent) problems.push(`[white] arrow stroke ${rw?.arrowStroke} != accent ${w.accent}`);
if (!rw?.coverMatched) problems.push(`[white] no cover div fills the resolved wash ${w.washRgb}`);
savePng(await execA(sid, `const d=arguments[arguments.length-1];window.__eigendeck.captureElement('.present-slide').then(u=>d(u)).catch(()=>d(null));`), 'present-white.png');

// --- switch the slide to DARK at runtime → everything must RE-ADAPT ---
const dk = expected('dark');
await exec(sid, "window.__eigendeck.store.getState().updateSlide(0, { theme: 'dark' });");
await sleep(600);
const rd = await readPresent(sid, dk.washRgb);
if (rd?.textColor !== dk.accentRgb) problems.push(`[dark] text color ${rd?.textColor} != accent ${dk.accentRgb} (did NOT re-adapt)`);
if (rd?.arrowStroke !== dk.accent) problems.push(`[dark] arrow stroke ${rd?.arrowStroke} != accent ${dk.accent} (did NOT re-adapt)`);
if (!rd?.coverMatched) problems.push(`[dark] no cover div fills the resolved wash ${dk.washRgb} (did NOT re-adapt)`);
if (rw?.textColor === rd?.textColor) problems.push(`text color did not change between themes (${rw?.textColor}) — token is not live`);
savePng(await execA(sid, `const d=arguments[arguments.length-1];window.__eigendeck.captureElement('.present-slide').then(u=>d(u)).catch(()=>d(null));`), 'present-dark.png');

await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");

// --- real HTML export (now on the dark theme) carries the resolved accent + wash ---
const html = await execA(sid, `const d=arguments[arguments.length-1];Promise.resolve(window.__eigendeck.exportHtml()).then(h=>d(h)).catch(e=>d('ERR:'+e));`);
if (typeof html !== 'string' || html.startsWith('ERR:')) problems.push(`export: ${html}`);
else {
  if (!html.includes(`color:${dk.accent}`)) problems.push(`export missing text color:${dk.accent}`);
  if (!html.includes(dk.accent)) problems.push(`export missing arrow accent ${dk.accent}`);
  if (!html.includes(dk.wash)) problems.push(`export missing cover wash ${dk.wash}`);
}

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`TOKEN_PASS: 'accent' text/arrow + cover boxTint resolve AND re-adapt white(${w.accent})→dark(${dk.accent}); export carries them; PNGs → ${OUT}/`);
process.exit(0);
