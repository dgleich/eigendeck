// #137 raw-HTML element — PERSISTENCE round-trip. Open the deck, edit the html
// element's `html` + `background` via the store (as the inspector would), call
// window.__eigendeck.save(), then:
//   (a) inspect the SAVED .eigendeck DB (current rows: valid_to IS NULL) and
//       confirm the NEW html string + background actually persisted, and
//   (b) reopen in a FRESH WebDriver session and confirm the element renders the
//       new markup (contentDocument) — proving it round-trips, not just lingers
//       in the in-memory store.
import { execFileSync } from 'node:child_process';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const NEW_HTML = '<div id="persistedEIGEN" style="color:#0f0;font-family:system-ui;padding:8px">PERSISTED-MARKER-42</div>';
const NEW_BG = '#123456';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('HTML_PERSIST_FAIL:', m); process.exit(1); };

const problems = [];
// ---- session 1: edit + save ----
const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
await sleep(800);
await exec(sid, `
  const s = window.__eigendeck.store.getState();
  s.updateElement('raw', { html: ${JSON.stringify(NEW_HTML)}, background: ${JSON.stringify(NEW_BG)} });
`);
await sleep(300);
const savedOk = await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR:'+e));");
if (savedOk !== 'ok') problems.push(`save failed: ${savedOk}`);
await sleep(500);
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
await sleep(500);

// ---- (a) inspect the SAVED DB ----
let dbRow = '';
try {
  dbRow = execFileSync('python3', ['-c', `
import sqlite3, json, sys
c = sqlite3.connect(sys.argv[1])
rows = list(c.execute("select data from elements where type='html' and valid_to is null"))
print(json.dumps({'n': len(rows), 'data': rows[0][0] if rows else None}))
`, DECK], { encoding: 'utf8' }).trim();
} catch (e) { problems.push(`db inspect failed: ${e}`); }
if (dbRow) {
  const parsed = JSON.parse(dbRow);
  if (parsed.n !== 1) problems.push(`expected 1 current html row in saved DB, got ${parsed.n}`);
  const data = parsed.data ? JSON.parse(parsed.data) : {};
  if (data.html !== NEW_HTML) problems.push(`saved html mismatch — got ${JSON.stringify((data.html||'').slice(0,80))}`);
  if (data.background !== NEW_BG) problems.push(`saved background mismatch — got ${JSON.stringify(data.background)}`);
}

// ---- (b) reopen in a fresh session, confirm the new markup renders ----
const sid2 = await open(); if (!sid2) fail('no session 2'); if (!await waitSeam(sid2)) fail('no seam 2');
await sleep(1000);
const rendered = JSON.parse(await exec(sid2, `
  const f = document.querySelector('.el-html iframe');
  if (!f) return JSON.stringify({ err: 'no iframe' });
  let body = null;
  try { body = f.contentDocument && f.contentDocument.body ? f.contentDocument.body.innerHTML : null; } catch (e) { body = 'THREW:' + e; }
  const srcdoc = f.getAttribute('srcdoc') || '';
  return JSON.stringify({ hasMarker: !!body && body.includes('PERSISTED-MARKER-42'), bgInSrcdoc: srcdoc.includes('background:${NEW_BG}') });
`));
if (rendered.err) problems.push(`reopen: ${rendered.err}`);
else {
  if (!rendered.hasMarker) problems.push('reopened deck did not render the persisted html marker');
  if (!rendered.bgInSrcdoc) problems.push('reopened deck srcdoc missing persisted background');
}
await fetch(`${BASE}/session/${sid2}`, { method: 'DELETE' }).catch(() => {});

if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('HTML_PERSIST_PASS: edited html+background saved to DB (valid_to IS NULL row) and re-rendered after reopen in a fresh session.');
process.exit(0);
