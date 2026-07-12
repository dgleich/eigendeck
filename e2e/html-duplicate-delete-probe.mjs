// #137 raw-HTML element — DUPLICATE slide carries the html element, and DELETE
// removes it. (a) duplicateSlide(0) → the new slide has an html element with the
// same markup + background (fresh id/slide). (b) deleteElement removes it from
// the source slide, leaving zero html elements there.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('HTML_DUP_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];
await sleep(900);

// (a) Duplicate slide 0 — the copy must carry the html element.
await exec(sid, "window.__eigendeck.store.getState().duplicateSlide(0);");
await sleep(400);
const dup = JSON.parse(await exec(sid, `
  const slides = window.__eigendeck.store.getState().presentation.slides;
  const src = slides[0].elements.find(e=>e.type==='html');
  const copySlide = slides[1];
  const copy = copySlide ? copySlide.elements.find(e=>e.type==='html') : null;
  return JSON.stringify({
    nSlides: slides.length,
    hasCopy: !!copy,
    sameHtml: !!(src && copy && src.html === copy.html),
    sameBg: !!(src && copy && src.background === copy.background),
    freshSlide: !!(copySlide && copySlide.id !== slides[0].id),
  });
`));
if (dup.nSlides < 2) problems.push(`duplicateSlide did not add a slide (nSlides=${dup.nSlides})`);
if (!dup.hasCopy) problems.push('duplicated slide has no html element');
if (!dup.sameHtml) problems.push('duplicated html element lost its markup');
if (!dup.sameBg) problems.push('duplicated html element lost its background');
if (!dup.freshSlide) problems.push('duplicated slide reused the source slide id');

// (b) Delete the html element from slide 0 — it should vanish there.
await exec(sid, `
  const s = window.__eigendeck.store.getState();
  s.selectSlide(0);
  s.deleteElement('raw');
`);
await sleep(400);
const del = JSON.parse(await exec(sid, `
  const slides = window.__eigendeck.store.getState().presentation.slides;
  return JSON.stringify({
    slide0Html: slides[0].elements.filter(e=>e.type==='html').length,
    slide1Html: slides[1] ? slides[1].elements.filter(e=>e.type==='html').length : -1,
    slide0HasRaw: slides[0].elements.some(e=>e.id==='raw'),
  });
`));
if (del.slide0Html !== 0) problems.push(`delete left ${del.slide0Html} html elements on slide 0`);
if (del.slide0HasRaw) problems.push('deleted element id=raw still present on slide 0');
if (del.slide1Html !== 1) problems.push(`delete on slide 0 wrongly affected slide 1 (has ${del.slide1Html} html)`);

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('HTML_DUP_PASS: duplicateSlide carried the html element (markup+background, fresh slide); deleteElement removed it from the source slide only.');
process.exit(0);
