// Switching the DECK theme must persist to the saved .eigendeck (it didn't: the
// flush wrote title+config but not the `theme` row, and the change-detector ignored
// deck-theme changes — so a setTheme() was lost on reopen). Drives setTheme('dark')
// + save() through the seam, then inspects the SAVED FILE's presentation.theme row
// (per the e2e skill: verify persistence in the file, not the live session).
import { execSync } from 'node:child_process';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('THEMESAVE_FAIL:', m); process.exit(1); };
// Read the theme row straight from the saved SQLite file (python3 stdlib sqlite3).
const fileTheme = () => execSync(
  `python3 -c "import sqlite3;c=sqlite3.connect('${DECK}');print((dict(c.execute('select key,value from presentation').fetchall()).get('theme')) or 'none');c.close()"`,
).toString().trim();

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

const before = fileTheme();
if (before !== 'white') problems.push(`fixture should start 'white', file says '${before}'`);

// Switch the deck theme, then save in place (flush + atomic write).
await exec(sid, "window.__eigendeck.store.getState().setTheme('dark');");
if (await exec(sid, "return window.__eigendeck.store.getState().presentation.theme") !== 'dark') problems.push('setTheme did not update the live store');
const saved = await execA(sid, "const d=arguments[arguments.length-1];Promise.resolve(window.__eigendeck.save()).then(()=>d('ok')).catch(e=>d('ERR:'+e));");
if (saved !== 'ok') problems.push(`save() failed: ${saved}`);
await sleep(800);

const after = fileTheme();
if (after !== 'dark') problems.push(`after save the FILE theme is '${after}', expected 'dark' — deck theme did NOT commit`);

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`THEMESAVE_PASS: setTheme('dark') + save() commits to the file (theme row: ${before} → ${after})`);
process.exit(0);
