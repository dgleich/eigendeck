// A2: undo-then-save. Make a change via a real action, UNDO via temporal store, save().
// The FILE must reflect the UNDONE (reverted) state — not the pre-undo change. The diff
// subscriber compares prev->curr; undo replaces the presentation wholesale, so the flush
// must re-persist the reverted values (and un-add an added slide / re-add a deleted one).
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
const fail = (m) => { console.error('A2UNDO_FAIL:', m); process.exit(1); };

const PY = '/tmp/a2-readundo.py';
writeFileSync(PY, [
  'import sqlite3,json,sys',
  'c=sqlite3.connect(sys.argv[1])',
  'pres=dict(c.execute("select key,value from presentation").fetchall())',
  'slides=[r[0] for r in c.execute("select id from slides where valid_to is null order by position")]',
  'el=c.execute("select data from elements where id=? and valid_to is null",("txt-1",)).fetchone()',
  'c.close()',
  'print(json.dumps({"title":pres.get("title"),"nslides":len(slides),"slides":slides,"txt1":(json.loads(el[0]) if el else None)}))',
].join('\n'));
const readFile = () => JSON.parse(execSync(`python3 ${PY} ${JSON.stringify(DECK)}`).toString().trim());

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

// Baseline: 2 slides, title 'A2 Fixture', txt-1 no color override.
// Sequence of undoable actions (each is one temporal step thanks to coalescing):
//  1) setTitle
//  2) addSlide
//  3) updateElement(txt-1, color)
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");
await exec(sid, "window.__eigendeck.store.getState().setTitle('CHANGED TITLE');");
await sleep(100);
await exec(sid, "window.__eigendeck.store.getState().addSlide();");
await sleep(100);
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");
await exec(sid, "window.__eigendeck.store.getState().updateElement('txt-1', { color: '#ff00ff' });");
await sleep(150);

// Undo all three (temporal.undo) — should revert to baseline.
const steps = await exec(sid, "return window.__eigendeck.store.temporal.getState().pastStates.length;");
await exec(sid, "const t=window.__eigendeck.store.temporal.getState(); const n=t.pastStates.length; for(let i=0;i<n;i++){ window.__eigendeck.store.temporal.getState().undo(); }");
await sleep(200);

const live = await exec(sid, `
  const s = window.__eigendeck.store.getState();
  const t = s.presentation.slides[0].elements.find(e=>e.id==='txt-1');
  return JSON.stringify({ title: s.presentation.title, nslides: s.presentation.slides.length, color: t && t.color });
`);

const saved = await execA(sid, "const d=arguments[arguments.length-1];Promise.resolve(window.__eigendeck.save()).then(()=>d('ok')).catch(e=>d('ERR:'+e));");
if (saved !== 'ok') problems.push(`save() failed: ${saved}`);
await sleep(1000);

const f = readFile();
// After undoing everything, the FILE should look like the baseline fixture.
if (f.title !== 'A2 Fixture') problems.push(`title after undo: FILE '${f.title}', expected baseline 'A2 Fixture'`);
if (f.nslides !== 2) problems.push(`slide count after undo: FILE ${f.nslides}, expected baseline 2 (added slide should be gone)`);
if (f.txt1 && f.txt1.color !== undefined) problems.push(`txt-1.color after undo: FILE has '${f.txt1.color}', expected undefined (baseline had no color)`);

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.error('pastStates before undo:', steps);
console.error('live after undo:', live);
console.error('file after undo:', JSON.stringify(f));
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s) — undone changes leaked into the saved file`); }
console.log('A2UNDO_PASS: undo-then-save persists the reverted (baseline) state');
process.exit(0);
