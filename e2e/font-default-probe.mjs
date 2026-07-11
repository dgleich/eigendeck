// Font-resolution priority in the REAL app (deck stored font > global default).
// This session made Lato the GLOBAL default and pinned the example decks to store
// PT Sans explicitly. This probe proves the chain resolves in WebKit:
//   - a deck with config.defaultBodyFont='ptsans' → body text renders 'PT Sans'
//   - a deck that stores NO font → body text renders the global default 'Lato'
// Set E2E_EXPECT to the font family the opened deck should render (substring match
// on the computed font-family). Unit coverage: fonts.test.ts + the render snapshots.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const EXPECT = process.env.E2E_EXPECT || 'Lato';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('FONT_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");
for (let i = 0; i < 20; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.present-slide .el-text foreignObject')")) break; }
const fam = await exec(sid, `
  const inner = document.querySelector('.present-slide .el-text foreignObject > div > div');
  return inner ? getComputedStyle(inner).fontFamily : null;
`);
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});

if (!fam) fail('no text element found');
if (!fam.includes(EXPECT)) fail(`body font "${fam}" does not include expected "${EXPECT}"`);
console.log(`FONT_PASS: body text resolves to "${EXPECT}" (computed: ${fam})`);
process.exit(0);
