// A2: presentation config + slide-metadata round-trip. Change title via setTitle,
// config.* via updateConfig, per-slide theme/fonts/notes/groupId via updateSlide;
// save() to the open file; assert the FILE's presentation row + slide config/columns.
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
const fail = (m) => { console.error('A2CFG_FAIL:', m); process.exit(1); };

const PY = '/tmp/a2-readpres.py';
writeFileSync(PY, [
  'import sqlite3,json,sys',
  'c=sqlite3.connect(sys.argv[1])',
  'pres=dict(c.execute("select key,value from presentation").fetchall())',
  'slides=[]',
  'for sid,pos,notes,gid,cfg in c.execute("select id,position,notes,group_id,config from slides where valid_to is null order by position"):',
  '  slides.append({"id":sid,"position":pos,"notes":notes,"groupId":gid,"config":(json.loads(cfg) if cfg else None)})',
  'c.close()',
  'print(json.dumps({"presentation":pres,"slides":slides}))',
].join('\n'));
const readFile = () => JSON.parse(execSync(`python3 ${PY} ${JSON.stringify(DECK)}`).toString().trim());

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

// --- Title ---
await exec(sid, "window.__eigendeck.store.getState().setTitle('New Title 42');");

// --- Config.* battery (updateConfig merges a partial) ---
const cfg = {
  author: 'Ada Lovelace', venue: 'STOC 2026', transition: 'none',
  backgroundTransition: 'none', showSlideNumber: false,
  defaultTitleFont: 'lato', defaultBodyFont: 'noto', defaultHypeFont: 'shantell',
  defaultMonoFont: 'firacode', mathPreamble: '\\newcommand{\\R}{\\mathbb{R}}',
  width: 1280, height: 720, autoReloadAssets: 'on',
  customPalette: ['#111111', '#222222', '#333333'],
};
await exec(sid, `window.__eigendeck.store.getState().updateConfig(${JSON.stringify(cfg)});`);

// --- Per-slide metadata via updateSlide(index, changes) ---
// slide 0: theme + all 3 font slots + notes; slide 1: groupId
await exec(sid, `window.__eigendeck.store.getState().updateSlide(0, ${JSON.stringify({ theme: 'dark', titleFont: 'lato', bodyFont: 'noto', hypeFont: 'shantell', notes: 'speaker notes here' })});`);
await exec(sid, `window.__eigendeck.store.getState().updateSlide(1, ${JSON.stringify({ groupId: 'grp-A' })});`);

const saved = await execA(sid, "const d=arguments[arguments.length-1];Promise.resolve(window.__eigendeck.save()).then(()=>d('ok')).catch(e=>d('ERR:'+e));");
if (saved !== 'ok') problems.push(`save() failed: ${saved}`);
await sleep(900);

const f = readFile();

// Title row
if (f.presentation.title !== 'New Title 42') problems.push(`title: FILE '${f.presentation.title}' != 'New Title 42'`);

// Config JSON row
let fcfg = {};
try { fcfg = JSON.parse(f.presentation.config || '{}'); } catch { problems.push('config row not valid JSON'); }
for (const [k, want] of Object.entries(cfg)) {
  if (JSON.stringify(fcfg[k]) !== JSON.stringify(want)) {
    problems.push(`config.${k}: FILE ${JSON.stringify(fcfg[k])} != ${JSON.stringify(want)}`);
  }
}

// Slide 0 metadata
const s0 = f.slides.find((s) => s.id === 'slide-1');
if (!s0) problems.push('slide-1 missing');
else {
  if (s0.notes !== 'speaker notes here') problems.push(`slide0.notes: FILE ${JSON.stringify(s0.notes)}`);
  const c = s0.config || {};
  for (const [k, want] of Object.entries({ theme: 'dark', titleFont: 'lato', bodyFont: 'noto', hypeFont: 'shantell' })) {
    if (c[k] !== want) problems.push(`slide0.config.${k}: FILE ${JSON.stringify(c[k])} != ${JSON.stringify(want)}`);
  }
}
// Slide 1 groupId
const s1 = f.slides.find((s) => s.id === 'slide-2');
if (!s1) problems.push('slide-2 missing');
else if (s1.groupId !== 'grp-A') problems.push(`slide1.groupId: FILE ${JSON.stringify(s1.groupId)} != 'grp-A'`);

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.error('file.presentation.title:', f.presentation.title);
console.error('file.config keys:', Object.keys(fcfg).join(','));
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('A2CFG_PASS: title + config.* + slide metadata round-tripped');
process.exit(0);
