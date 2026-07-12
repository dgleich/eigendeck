// A2: CLEARING a previously-set prop must persist as "gone", not the stale value.
// Fixture already has txt-1 with NO overrides; here we set several props, save, then
// CLEAR them (set to undefined) via updateElement, save again, and assert the FILE no
// longer carries them. Also clears a per-slide theme override. This is where a
// change-detector that only diffs *set* keys, or a merge that keeps stale keys, breaks.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('A2CLEAR_FAIL:', m); process.exit(1); };

const PY = '/tmp/a2-readclear.py';
writeFileSync(PY, [
  'import sqlite3,json,sys',
  'c=sqlite3.connect(sys.argv[1])',
  'el=c.execute("select data from elements where id=? and valid_to is null",("txt-1",)).fetchone()',
  's=c.execute("select config from slides where id=? and valid_to is null",("slide-1",)).fetchone()',
  'c.close()',
  'print(json.dumps({"txt1":(json.loads(el[0]) if el else None),"slide1cfg":(json.loads(s[0]) if s and s[0] else None)}))',
].join('\n'));
const readFile = () => JSON.parse(execSync(`python3 ${PY} ${JSON.stringify(DECK)}`).toString().trim());

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");

// Phase 1: SET props + a slide theme override, save.
await exec(sid, "window.__eigendeck.store.getState().updateElement('txt-1', { color: '#ff0000', backgroundColor: '#00ff00', backgroundOpacity: 0.5, boxShadow: true });");
await exec(sid, "window.__eigendeck.store.getState().updateSlide(0, { theme: 'dark', titleFont: 'lato' });");
let saved = await execA(sid, "const d=arguments[arguments.length-1];Promise.resolve(window.__eigendeck.save()).then(()=>d('ok')).catch(e=>d('ERR:'+e));");
if (saved !== 'ok') problems.push(`save#1 failed: ${saved}`);
await sleep(700);
const mid = readFile();
if (!mid.txt1 || mid.txt1.color !== '#ff0000') problems.push(`phase1: color not set in FILE (${JSON.stringify(mid.txt1)})`);
if (!mid.slide1cfg || mid.slide1cfg.theme !== 'dark') problems.push(`phase1: slide theme not set in FILE (${JSON.stringify(mid.slide1cfg)})`);

// Phase 2: CLEAR them (undefined), save.
await exec(sid, "window.__eigendeck.store.getState().updateElement('txt-1', { color: undefined, backgroundColor: undefined, backgroundOpacity: undefined, boxShadow: undefined });");
await exec(sid, "window.__eigendeck.store.getState().updateSlide(0, { theme: undefined, titleFont: undefined });");
saved = await execA(sid, "const d=arguments[arguments.length-1];Promise.resolve(window.__eigendeck.save()).then(()=>d('ok')).catch(e=>d('ERR:'+e));");
if (saved !== 'ok') problems.push(`save#2 failed: ${saved}`);
await sleep(700);

const live = await exec(sid, `
  const s = window.__eigendeck.store.getState();
  const t = s.presentation.slides[0].elements.find(e=>e.id==='txt-1');
  const sl = s.presentation.slides[0];
  return JSON.stringify({ color: t.color, bg: t.backgroundColor, bo: t.backgroundOpacity, bs: t.boxShadow, theme: sl.theme, tf: sl.titleFont });
`);

const after = readFile();
for (const k of ['color', 'backgroundColor', 'backgroundOpacity', 'boxShadow']) {
  if (after.txt1 && after.txt1[k] !== undefined) {
    problems.push(`cleared txt-1.${k} but FILE still has ${JSON.stringify(after.txt1[k])} (stale value persists)`);
  }
}
if (after.slide1cfg && after.slide1cfg.theme !== undefined) problems.push(`cleared slide theme but FILE config still has theme=${JSON.stringify(after.slide1cfg.theme)}`);
if (after.slide1cfg && after.slide1cfg.titleFont !== undefined) problems.push(`cleared slide titleFont but FILE config still has titleFont=${JSON.stringify(after.slide1cfg.titleFont)}`);

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.error('live after clear:', live);
console.error('file after clear:', JSON.stringify(after));
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('A2CLEAR_PASS: clearing element props + slide overrides removes them from the file');
process.exit(0);
