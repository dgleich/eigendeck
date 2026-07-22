// Copy/paste redesign e2e: copying an IMAGE element and pasting onto another
// slide must (a) paste the image and (b) create the cross-slide animation LINK —
// the case that regressed because arboard's image write clobbers the html
// private flavor, so the link metadata now rides in the Rust asset payload.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
const fail = m => { console.error('FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('open');
let ok = false;
for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) { ok = true; break; } }
if (!ok) fail('seam');
const elsOn = async (i) => exec(sid, `return (window.__eigendeck.store.getState().presentation.slides[${i}].elements||[]).map(e=>({type:e.type,id:e.id,assetId:e.assetId||null,linkId:e.linkId||null}))`);

// select the image on slide 0 and fire a real copy event
await exec(sid, `window.__eigendeck.store.getState().selectSlide(0);`);
await exec(sid, `window.__eigendeck.store.getState().selectObject({type:'element',id:'img0'});`);
await exec(sid, `document.body.dispatchEvent(new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));`);
// copyAssetElement is async (arboard + Rust internal clip) — wait for it to land
let clipReady = false;
for (let i = 0; i < 20; i++) { await sleep(300); if (await exec(sid, `return (await window.__TAURI__.core.invoke('clip_peek_internal'))?.has_bytes === true`)) { clipReady = true; break; } }
if (!clipReady) fail('asset never reached the internal clip after copy');
console.log('  image copy → asset bytes on the internal clip');

// paste onto slide 1 (empty clipboardData — the image is in the Rust clip)
await exec(sid, `window.__eigendeck.store.getState().selectSlide(1); window.__eigendeck.store.getState().selectObject({type:'slide'});`);
let base = (await elsOn(1)).length;
await exec(sid, `document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));`);
let els1;
for (let i = 0; i < 25; i++) { els1 = await elsOn(1); if (els1.length > base) break; await sleep(300); }
if (els1.length !== base + 1) fail(`image paste: expected ${base + 1} els on slide 1, got ${els1.length}`);
const pasted = els1[els1.length - 1];
if (pasted.type !== 'image') fail(`pasted element is ${pasted.type}, expected image`);
console.log('  image pasted onto slide 1');

// the cross-slide paste must have created a link (shared linkId with img0)
await sleep(300);
const link = await exec(sid, `
  const s = window.__eigendeck.store.getState().presentation.slides;
  const src = s[0].elements.find(e=>e.id==='img0');
  const p = s[1].elements[s[1].elements.length-1];
  return { srcLink: (src&&src.linkId)||null, pastedLink: (p&&p.linkId)||null };
`);
if (!link.pastedLink || link.pastedLink !== link.srcLink) fail('image cross-slide paste did NOT create an animation link: ' + JSON.stringify(link));
console.log('  image cross-slide paste created an animation link (shared linkId)');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.log('E2E_PASS: image-link (copy/paste redesign)');
process.exit(0);
