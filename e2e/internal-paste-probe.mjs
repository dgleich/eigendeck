// Copy/paste redesign e2e: an INTERNAL element copy round-trips through the OS
// clipboard's private flavor (encodeClipHtml → clipboardData → decodeClipHtml →
// pasteInternalClip), with NO clipboardRef buffer. Cross-platform — drives real
// synthetic copy/paste events on Linux WebKitGTK. Asserts:
//   - a copy event writes the private flavor (data-eigendeck-json) to text/html
//   - pasting that html onto ANOTHER slide adds the element there
//   - a STALE case: after copying TEXT to the clipboard, a canvas paste does NOT
//     resurrect the earlier element (the desync bug this redesign kills)
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
const nslides = await exec(sid, "return window.__eigendeck.store.getState().presentation.slides.length");
if (nslides < 2) fail(`need >=2 slides, deck has ${nslides}`);
const elsOn = async (i) => exec(sid, `return (window.__eigendeck.store.getState().presentation.slides[${i}].elements||[]).map(e=>({type:e.type,html:e.html||''}))`);

// --- select the text element on slide 0 and fire a real copy event ---
await exec(sid, `window.__eigendeck.store.getState().selectSlide(0);`);
const srcId = await exec(sid, `const s=window.__eigendeck.store.getState().presentation.slides[0].elements[0]; window.__eigendeck.store.getState().selectObject({type:'element',id:s.id}); return s.id;`);
if (!srcId) fail('no element on slide 0');
const copiedHtml = await exec(sid, `
  const dt = new DataTransfer();
  document.body.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
  return dt.getData('text/html');
`);
if (!/data-eigendeck-json=/.test(copiedHtml || '')) fail(`copy did not write the private flavor: ${String(copiedHtml).slice(0,120)}`);
console.log('  copy wrote the private Eigendeck flavor (data-eigendeck-json)');

// --- paste it onto slide 1 → the element should appear there ---
await exec(sid, `window.__eigendeck.store.getState().selectSlide(1); window.__eigendeck.store.getState().selectObject({type:'slide'});`);
let base = (await elsOn(1)).length;
await exec(sid, `
  const dt = new DataTransfer(); dt.setData('text/html', ${JSON.stringify(copiedHtml)});
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
`);
let els1;
for (let i = 0; i < 20; i++) { els1 = await elsOn(1); if (els1.length > base) break; await sleep(300); }
if (els1.length !== base + 1) fail(`internal paste: expected ${base + 1} els on slide 1, got ${els1.length}`);
console.log(`  internal element paste onto another slide → +1 element (${els1[els1.length-1].type})`);

// --- cross-slide paste must create an ANIMATION LINK (shared linkId src<->pasted) ---
const linkInfo = await exec(sid, `
  const s = window.__eigendeck.store.getState().presentation.slides;
  const src = s[0].elements.find(e=>e.id==='t0');
  const pasted = s[1].elements[s[1].elements.length-1];
  return { srcLink: (src&&src.linkId)||null, pastedLink: (pasted&&pasted.linkId)||null };
`);
if (!linkInfo.pastedLink || linkInfo.pastedLink !== linkInfo.srcLink) {
  fail('cross-slide paste did NOT create an animation link: ' + JSON.stringify(linkInfo));
}
console.log('  cross-slide paste created an animation link (shared linkId)');

// --- STALE guard: now put TEXT on the clipboard, canvas-paste → must NOT paste the element ---
base = (await elsOn(1)).length;
await exec(sid, `
  const dt = new DataTransfer(); dt.setData('text/plain', 'just plain foreign text');
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
`);
await sleep(1200);
els1 = await elsOn(1);
// a plain-text paste creates ONE text element, and must NOT resurrect the copied element
const added = els1.slice(base);
if (added.length !== 1 || added[0].type !== 'text') fail(`stale guard: expected exactly 1 new TEXT element, got ${JSON.stringify(added)}`);
console.log('  stale guard OK — a later text paste does not resurrect the copied element');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.log('E2E_PASS: internal-paste (copy/paste redesign Stage 1)');
process.exit(0);
