// Inserting a "Cover" over a selected element sizes the mask to that element — but a
// CARD (text with a box shadow) paints its shadow OUTSIDE its box, so the mask must
// GROW past the shadow to actually hide it (App.tsx runInsert 'cover' + boxShadowExtents).
// Drives the REAL insert HUD: select the card → click Cover → assert the new cover grew
// by the shadow extent {left14,top10,right14,bottom18}; then cover a SHADOWLESS box and
// assert the cover matches its bounds exactly (proves the growth is shadow-specific).
// Unit coverage of the extent math: src/lib/textStyle.test.mjs (boxShadowExtents).
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('COVER_FAIL:', m); process.exit(1); };

const covers = (sid) => exec(sid, "return JSON.stringify(window.__eigendeck.store.getState().presentation.slides[0].elements.filter(e=>e.type==='cover').map(e=>e.position));");
async function selectAndCover(sid, id) {
  await exec(sid, `window.__eigendeck.store.getState().selectObject({type:'element',id:'${id}'});`);
  await sleep(200);
  const clicked = await exec(sid, `const b=document.querySelector('button[title="Add cover-up rectangle (white)"]'); if(!b) return false; b.click(); return true;`);
  if (!clicked) fail('no Cover insert button in the HUD');
  await sleep(300);
}
const eq = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

// card {660,410,600,260} + shadow extents {left14,top10,right14,bottom18}
const CARD = { x: 660, y: 410, width: 600, height: 260 };
const wantCard = { x: CARD.x - 14, y: CARD.y - 10, width: CARD.width + 28, height: CARD.height + 28 };
const PLAIN = { x: 100, y: 100, width: 400, height: 200 };

await selectAndCover(sid, 'card');
let cs = JSON.parse(await covers(sid));
if (cs.length !== 1) problems.push(`after covering card: expected 1 cover, got ${cs.length}`);
else if (!eq(cs[0], wantCard)) problems.push(`card cover ${JSON.stringify(cs[0])} != grown ${JSON.stringify(wantCard)}`);

await selectAndCover(sid, 'plain');
cs = JSON.parse(await covers(sid));
if (cs.length !== 2) problems.push(`after covering plain: expected 2 covers, got ${cs.length}`);
else if (!eq(cs[1], PLAIN)) problems.push(`plain cover ${JSON.stringify(cs[1])} != exact ${JSON.stringify(PLAIN)} (should NOT grow — no shadow)`);

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`COVER_PASS: cover grows past a card's shadow (${JSON.stringify(wantCard)}) but matches a shadowless box exactly`);
process.exit(0);
