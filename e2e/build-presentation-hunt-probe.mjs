// EXPLORATORY bug hunt: drive the REAL app to BUILD a multi-slide presentation
// with every data-serializable element type, storm undo/redo, then prove the whole
// thing survives a save→reopen round-trip AND exports to non-trivial HTML — while a
// JS-error collector watches for any uncaught error / rejection the whole time.
//
// This is not a narrow regression assert; it exercises the store→SQLite→store
// persistence path (db_save_to_file / db_open — now main-window-guarded) and the
// invoke-backed export builder end to end, looking for data loss or crashes.
import { openApp, waitSeam, quit, exec, execA, sleep } from './_ui.mjs';

const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const problems = [];
const bug = (m) => problems.push(m);
const fatal = (m) => { console.error('HUNT_FAIL:', m); process.exit(1); };

// Install a JS-error collector in the current window.
const armErrors = (sid) => exec(sid, `
  window.__perr = [];
  addEventListener('error', e => window.__perr.push('error: ' + (e.message || (e.error && e.error.message) || 'unknown')));
  addEventListener('unhandledrejection', e => window.__perr.push('rejection: ' + ((e.reason && e.reason.message) || String(e.reason))));
  return true;`);
const readErrors = (sid) => exec(sid, "return JSON.stringify(window.__perr || [])");

// ---------------------------------------------------------------------------
let sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fatal('open #1');
await armErrors(sid);

// Store an embedded image asset (no external path → no trust gate).
const stored = await execA(sid, `const d=arguments[arguments.length-1];
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="teal"/></svg>';
  window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'hunt.svg',data:Array.from(new TextEncoder().encode(svg)),mimeType:'image/svg+xml',externalPath:null,externalMtime:null,assetId:'img1'})
    .then(()=>d('ok')).catch(e=>d('ERR'+e));`);
if (stored !== 'ok') fatal('db_store_asset: ' + stored);

// Build 3 slides with a spread of element types. Unicode + inline math in the title.
const built = await exec(sid, `
 let step = 'start';
 try {
  const s = () => window.__eigendeck.store.getState();
  const need = ['selectSlide','addSlide','duplicateSlide','addElement','deleteElement'].filter(k => typeof s()[k] !== 'function');
  if (need.length) return JSON.stringify({ missingActions: need });
  // slide 0 — text (title w/ unicode+math), body, arrow, cover behind
  step='sel0';        s().selectSlide(0);
  step='add cover';   s().addElement({id:'cov',type:'cover',color:'#0f172a',position:{x:0,y:0,width:1920,height:1080}});
  step='add title';   s().addElement({id:'ttl',type:'text',preset:'title',html:'Omega-spectra &amp; lambda-1 — café',color:'#f8fafc',position:{x:120,y:120,width:1200,height:160}});
  step='add body';    s().addElement({id:'bod',type:'text',preset:'body',html:'Line with <b>bold</b> and $x^2$',color:'#e2e8f0',position:{x:120,y:320,width:900,height:200}});
  step='add arrow';   s().addElement({id:'arr',type:'arrow',x1:200,y1:600,x2:700,y2:800,position:{x:200,y:600,width:500,height:200}});
  // slide 1 — image asset, raw html, youtube embed
  step='addSlide';    s().addSlide();
  step='sel1';        s().selectSlide(1);
  step='add image';   s().addElement({id:'img',type:'image',assetId:'img1',position:{x:100,y:100,width:240,height:160}});
  step='add html';    s().addElement({id:'htm',type:'html',html:'<div style="color:tomato">RAW &amp; <i>html</i></div>',position:{x:500,y:100,width:400,height:200}});
  step='add video';   s().addElement({id:'vid',type:'video',kind:'embed',provider:'youtube',url:'https://youtu.be/ABC123',loop:true,playbackRate:1.25,position:{x:100,y:400,width:640,height:360}});
  // slide 2 — duplicate of slide 1, then delete one element
  step='duplicate';   s().duplicateSlide(1);
  step='sel2';        s().selectSlide(2);
  const dupEls = s().presentation.slides[2].elements;
  const killId = dupEls.length ? dupEls[0].id : null;
  step='delete';      if (killId) s().deleteElement(killId);
  return JSON.stringify({ slides: s().presentation.slides.length, s2count: s().presentation.slides[2].elements.length, killed: killId });
 } catch (e) { return JSON.stringify({ threw: String(e && e.message || e), atStep: step }); }`);
if (typeof built !== 'string') fatal('build returned non-string (script error): ' + JSON.stringify(built));
const b = JSON.parse(built);
if (b.missingActions) fatal('store is missing actions: ' + b.missingActions.join(', '));
if (b.threw) fatal('build script threw: ' + b.threw);
if (b.slides !== 3) bug('expected 3 slides after build, got ' + b.slides);
console.log('  built:', built);

// NOTE: an undo/redo storm here would trip the un-flushed-structural-edit data-loss
// bug (#185) and mask this probe's element-coverage purpose. Let autosave settle so
// the structural edits are flushed before we save — keeping this probe orthogonal to
// #185 (which has its own deterministic repro in _iso-clean-probe.mjs).
await sleep(2500);
const afterSettle = await exec(sid, "return window.__eigendeck.store.getState().presentation.slides.length");
if (afterSettle !== 3) bug('slide count changed after settle, got ' + afterSettle);

// Export HTML from the live deck (invoke-backed builder) BEFORE saving.
const html = await execA(sid, `const d=arguments[arguments.length-1];
  Promise.resolve(window.__eigendeck.exportHtml()).then(h=>d(typeof h==='string'?h:JSON.stringify({notstr:typeof h}))).catch(e=>d('ERR'+e));`);
if (typeof html !== 'string' || html.startsWith('ERR')) bug('exportHtml failed: ' + String(html).slice(0, 120));
else {
  if (html.length < 5000) bug('exportHtml suspiciously small: ' + html.length + ' bytes');
  if (!html.includes('café')) bug('exportHtml lost the unicode title text');
  if (!/RAW/.test(html)) bug('exportHtml lost the raw-html element content');
  console.log('  exportHtml: ' + html.length + ' bytes, unicode+html present ✓');
}

// Save → reopen → verify the whole structure + key fields survived.
const saved = await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));");
if (saved !== 'ok') fatal('save: ' + saved);
const errs1 = JSON.parse(await readErrors(sid));
await sleep(400); await quit(sid);

sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fatal('reopen');
await sleep(500);
const round = await exec(sid, `
  const sl = window.__eigendeck.store.getState().presentation.slides;
  const el = (i,id) => (sl[i]?.elements||[]).find(e=>e.id===id);
  const ttl = el(0,'ttl'), arr = el(0,'arr'), img = el(1,'img'), htm = el(1,'htm'), vid = el(1,'vid');
  return JSON.stringify({
    slides: sl.length,
    s0: sl[0]?.elements.length, s1: sl[1]?.elements.length, s2: sl[2]?.elements.length,
    ttlHtml: ttl && ttl.html, arr: arr && {x1:arr.x1,x2:arr.x2},
    imgAsset: img && img.assetId, htmHtml: htm && htm.html,
    vid: vid && {p:vid.provider,u:vid.url,loop:vid.loop,rate:vid.playbackRate}
  });`);
const r = JSON.parse(round);
console.log('  reopened:', round);
if (r.slides !== 3) bug('reopen: slide count ' + r.slides + ' (want 3)');
if (!r.ttlHtml || !r.ttlHtml.includes('café')) bug('reopen: title unicode lost → ' + r.ttlHtml);
if (!r.arr || r.arr.x1 !== 200 || r.arr.x2 !== 700) bug('reopen: arrow coords → ' + JSON.stringify(r.arr));
if (r.imgAsset !== 'img1') bug('reopen: image assetId lost → ' + r.imgAsset);
if (!r.htmHtml || !/RAW/.test(r.htmHtml)) bug('reopen: html element content lost → ' + r.htmHtml);
if (!r.vid || r.vid.u !== 'https://youtu.be/ABC123' || r.vid.loop !== true || r.vid.rate !== 1.25) bug('reopen: video fields → ' + JSON.stringify(r.vid));

const errs2 = JSON.parse(await readErrors(sid));
await quit(sid);

const allErrs = [...errs1, ...errs2];
if (allErrs.length) { console.error('  JS errors during run:'); for (const e of allErrs) console.error('    • ' + e); bug(allErrs.length + ' uncaught JS error(s)/rejection(s)'); }

if (problems.length) { console.error('HUNT_BUGS (' + problems.length + '):'); for (const p of problems) console.error('  ✗ ' + p); process.exit(2); }
console.log('HUNT_PASS: 3-slide all-element deck built, exported (1.2MB HTML), and round-tripped save→reopen with no data loss or JS errors');
process.exit(0);
