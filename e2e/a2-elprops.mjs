// A2: element-prop round-trip. For text/image/arrow/cover, set a battery of props via
// the REAL updateElement store action (on the current slide), save() to the open file,
// then inspect the SAVED FILE's element `data` JSON. Any prop missing/wrong = a bug.
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
const fail = (m) => { console.error('A2ELPROPS_FAIL:', m); process.exit(1); };

// Read a specific element's data JSON from the saved file, merged with promoted columns
// exactly as db_export_json would reassemble it.
const PY = '/tmp/a2-readel.py';
writeFileSync(PY, [
  'import sqlite3,json,sys',
  'c=sqlite3.connect(sys.argv[1])',
  'r=c.execute("select data,link_id,asset_id from elements where id=? and valid_to is null",(sys.argv[2],)).fetchone()',
  'c.close()',
  'if not r: print("__MISSING__")',
  'else:',
  ' d=json.loads(r[0])',
  ' if r[1] is not None: d["linkId"]=r[1]',
  ' if r[2] is not None: d["assetId"]=r[2]',
  ' print(json.dumps(d))',
].join('\n'));
const fileEl = (id) => {
  const out = execSync(`python3 ${PY} ${JSON.stringify(DECK)} ${JSON.stringify(id)}`).toString().trim();
  if (out === '__MISSING__') return null;
  return JSON.parse(out);
};

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

// Select slide 0 (updateElement acts on currentSlide).
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");

// The battery of changes per element. Values chosen to be non-default and to include
// falsy values (0, false) that naive serializers drop.
const updates = {
  'txt-1': {
    color: '#ff0000', backgroundColor: '#00ff00', backgroundOpacity: 0.5,
    boxTint: 'accent', boxShadow: true, borderRadius: 12, textEffect: 'glow',
    fontSize: 42, fontSizeName: 'small', verticalAlign: 'bottom', rotation: -7,
    padding: { top: 0, right: 5, bottom: 10, left: 15 },
  },
  'img-1': { borderRadius: 24, rotation: 15, opacity: 0.3 },
  'arr-1': { color: '#0000ff', strokeWidth: 8, headSize: 30, heads: 'both', opacity: 0.4 },
  'cover-1': { color: '#abcdef', boxTint: '#123456' },
};

for (const [id, changes] of Object.entries(updates)) {
  const js = `window.__eigendeck.store.getState().updateElement(${JSON.stringify(id)}, ${JSON.stringify(changes)});`;
  await exec(sid, js);
}

// Verify the live store took the changes (sanity — not the assertion).
const liveOk = await exec(sid, `
  const s = window.__eigendeck.store.getState();
  const els = s.presentation.slides[0].elements;
  const find = (id) => els.find(e => e.id === id);
  return JSON.stringify({
    txt: find('txt-1')?.backgroundOpacity, arrHeads: find('arr-1')?.heads,
    imgOp: find('img-1')?.opacity, coverTint: find('cover-1')?.boxTint,
  });
`);

const saved = await execA(sid, "const d=arguments[arguments.length-1];Promise.resolve(window.__eigendeck.save()).then(()=>d('ok')).catch(e=>d('ERR:'+e));");
if (saved !== 'ok') problems.push(`save() failed: ${saved}`);
await sleep(900);

// Assert every changed prop survived into the FILE.
for (const [id, changes] of Object.entries(updates)) {
  const el = fileEl(id);
  if (!el) { problems.push(`${id}: element missing from saved file`); continue; }
  for (const [k, want] of Object.entries(changes)) {
    const got = el[k];
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`${id}.${k}: FILE has ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
  }
}

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.error('live-store sample:', liveOk);
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('A2ELPROPS_PASS: all element props round-tripped to the file');
process.exit(0);
