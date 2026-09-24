// #188 ("we can't cut-paste demos at all"): guard for the demo copy -> paste ->
// render LOGIC. Mirrors internal-paste-probe.mjs for a DEMO element: store a demo
// asset, add a demo to slide 0, fire a real 'copy' event, paste the resulting
// clipboard HTML onto slide 1, and assert a demo with the same assetId appears
// there and mounts its iframe.
//
// This passes, which is itself the #188 finding so far: the handlers, the clip
// encoding, normalizeUntrustedElement and pasteInternalClip all handle a demo.
// It does NOT cover how Cmd+C / Cmd+V / Cmd+X reach those handlers: it dispatches
// the ClipboardEvents directly on the parent document. The working theory for
// #188 lives there (no 'cut' listener exists, and a focused demo iframe takes the
// native copy/paste away from the parent), so a failure there will not show here.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
const fail = m => { console.error('FAIL:', m); process.exit(1); };

// A minimal well-formed multipart-capable demo (the marker is what matters).
const DEMO_HTML = `<!DOCTYPE html><!--eigendeck-demo-v1--><html><head><meta charset="utf-8"></head><body><h1>copypaste demo</h1><script>document.title='demo-ok';<\/script></body></html>`;

const sid = await open(); if (!sid) fail('open');
let ok = false;
for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) { ok = true; break; } }
if (!ok) fail('seam');
const nslides = await exec(sid, "return window.__eigendeck.store.getState().presentation.slides.length");
if (nslides < 2) fail(`need >=2 slides, deck has ${nslides}`);
const elsOn = async (i) => exec(sid, `return (window.__eigendeck.store.getState().presentation.slides[${i}].elements||[]).map(e=>({type:e.type,assetId:e.assetId||'',id:e.id}))`);

// --- store a demo asset + add a demo element on slide 0 ---
const assetId = await exec(sid, `return await window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'demos/copypaste.html',data:Array.from(new TextEncoder().encode(${JSON.stringify(DEMO_HTML)})),mimeType:'text/html',externalPath:null,externalMtime:null});`);
if (!assetId || typeof assetId !== 'string') fail('db_store_asset returned ' + JSON.stringify(assetId));
console.log('  stored demo asset ' + assetId.slice(0, 8));
await exec(sid, `var g=window.__eigendeck.store.getState;g().selectSlide(0);g().addElement({id:'demo-src',type:'demo',assetId:${JSON.stringify(assetId)},position:{x:100,y:100,width:800,height:450}});`);
let s0 = await elsOn(0);
if (!s0.some(e => e.type === 'demo')) fail('demo element not added to slide 0: ' + JSON.stringify(s0));
console.log('  slide 0 has a demo element');

// --- select the demo on slide 0 and fire a REAL copy event ---
await exec(sid, `const s=window.__eigendeck.store.getState().presentation.slides[0].elements.find(e=>e.type==='demo'); window.__eigendeck.store.getState().selectObject({type:'element',id:s.id});`);
const copiedHtml = await exec(sid, `
  const dt = new DataTransfer();
  document.body.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
  return dt.getData('text/html');
`);
if (!/data-eigendeck-json=/.test(copiedHtml || '')) fail(`COPY did not write the private flavor for a demo: ${String(copiedHtml).slice(0, 160)}`);
// Decode the clip the way clipboardModel.decodeClipHtml does (base64 JSON in the
// data-eigendeck-json attribute) and check it carries THIS demo.
const b64 = (copiedHtml.match(/data-eigendeck-json=["']([A-Za-z0-9+/=]+)["']/) || [])[1];
let clip = null;
try { clip = JSON.parse(Buffer.from(b64 || '', 'base64').toString('utf8')); } catch { /* asserted below */ }
const clipDemo = clip?.kind === 'elements' && (clip.elements || []).find(e => e.type === 'demo');
if (!clipDemo || clipDemo.assetId !== assetId) fail(`copied clip does not carry the demo with assetId ${assetId}: ${JSON.stringify(clip).slice(0, 200)}`);
console.log(`  copy wrote the private flavor, and the clip carries the demo (assetId ${assetId.slice(0, 8)})`);

// --- paste onto slide 1 → a demo element should appear there ---
await exec(sid, `window.__eigendeck.store.getState().selectSlide(1); window.__eigendeck.store.getState().selectObject({type:'slide'});`);
const base = (await elsOn(1)).length;
await sleep(500);   // let slide 1 settle before counting its demo iframes
const framesBefore = await exec(sid, `return document.querySelectorAll('iframe.el-demo-frame').length`);
await exec(sid, `
  const dt = new DataTransfer(); dt.setData('text/html', ${JSON.stringify(copiedHtml)});
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
`);
let els1;
for (let i = 0; i < 20; i++) { els1 = await elsOn(1); if (els1.length > base) break; await sleep(300); }
if (els1.length !== base + 1) fail(`DEMO PASTE FAILED: expected ${base + 1} els on slide 1, got ${els1.length} (${JSON.stringify(els1)})`);
const pasted = els1[els1.length - 1];
if (pasted.type !== 'demo') fail(`pasted element is not a demo: ${JSON.stringify(pasted)}`);
if (pasted.assetId !== assetId) fail(`pasted demo lost/changed its assetId: ${pasted.assetId} != ${assetId}`);
console.log(`  demo paste onto slide 1 → +1 demo element, assetId preserved (${pasted.assetId.slice(0,8)})`);

// --- does the pasted demo RENDER? still on slide 1: its demo iframe count must grow ---
let frames = 0;
for (let i = 0; i < 20; i++) {
  frames = await exec(sid, `return document.querySelectorAll('iframe.el-demo-frame').length`);
  if (frames > framesBefore) break;
  await sleep(300);
}
if (frames <= framesBefore) fail(`PASTED DEMO DID NOT RENDER: slide 1 demo iframes ${framesBefore} -> ${frames} after paste`);
console.log(`  pasted demo RENDERS on slide 1 (demo iframes ${framesBefore} -> ${frames})`);
console.log('DEMO-COPYPASTE PASS');
process.exit(0);
