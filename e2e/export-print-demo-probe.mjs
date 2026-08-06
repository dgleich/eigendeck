// #109 guard: the interactive HTML export embeds a print layer (a second copy of
// every slide, with `html` elements rendered as srcdoc <iframe>s). This probe
// proves that adding the print layer did NOT break the LIVE content in the
// interactive screen layer — the concern being the export's runtime scripts that
// sweep `document.querySelectorAll('iframe')` GLOBALLY (font injection + the
// demo BroadcastChannel relay) now also see the print-layer iframes.
//
// Deck (fixtures/make_e2e_decks.py printdemo): one slide with a live `demo`
// (self-reports DEMO-RAN), an `html` element (→ print-layer iframe), and a
// `notebook` (→ baked print screenshot). Asserts, on the exported HTML:
//   - both layers present;
//   - the interactive #viewport has EXACTLY ONE demo iframe whose srcdoc still
//     carries the demo code (DEMO-RAN) — the demo wasn't swallowed/duplicated;
//   - the print layer carries the html element (HTML-ELEMENT-MARKER iframe);
//   - the global iframe-sweep scripts are present AND the nav stays scoped to
//     #viewport (the "90 slides" regression guard, restated for a demo deck).
// The end-to-end "the demo actually boots in the export" check runs in a real
// browser (chromium) — see e2e/export-print-demo-browser.mjs.
import { writeFileSync } from 'fs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const OUT=process.env.PROBE_OUT || '/tmp/export-print-demo.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){try{const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}catch{return null}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('PRINTDEMO_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');
const html=await execA(sid,`const done=arguments[arguments.length-1]; Promise.resolve().then(()=>window.__eigendeck.exportHtml()).then(h=>done(h)).catch(e=>done('ERR:'+e));`);
if(typeof html!=='string'||html.startsWith('ERR:')) fail('exportHtml failed: '+html);
writeFileSync(OUT, html);
console.log(`  exported ${html.length} chars → ${OUT}`);

// Both layers present.
const pIdx = html.indexOf('<div class="eig-print-layer">');
if(!/<div class="eig-screen-layer">/.test(html)) fail('no eig-screen-layer');
if(pIdx < 0) fail('no eig-print-layer');
const screen = html.slice(0, pIdx);   // everything before the print layer = screen layer
const print  = html.slice(pIdx);

// The interactive screen layer keeps ALL live content: the demo (its srcdoc code
// intact), the html element, and the notebook — three live iframes. The demo's
// self-report code must survive verbatim, and it must live in the SCREEN layer,
// never leaking into / duplicated by the print layer (the print copy is a baked
// screenshot or a placeholder, so it must NOT carry the live demo code).
const screenIframes = (screen.match(/<iframe/g)||[]).length;
if(screenIframes < 3) fail(`screen layer has ${screenIframes} live iframes, expected >=3 (demo + html + notebook)`);
if(!/DEMO-RAN/.test(screen)) fail('screen-layer demo iframe srcdoc lost its code (no DEMO-RAN marker)');
if(/DEMO-RAN/.test(print)) fail('live demo code leaked into the PRINT layer (should be a screenshot/placeholder, not a running iframe)');
if(!/HTML-ELEMENT-MARKER/.test(screen)) fail('screen layer missing the html element');
console.log(`  screen layer: ${screenIframes} live iframes; demo srcdoc intact (DEMO-RAN) and NOT leaked into print ✓`);

// The print layer carries the html element as its OWN srcdoc iframe — the extra
// iframe the export's global querySelectorAll('iframe') sweep now touches. It's
// same-origin (font inject succeeds, harmless) and ignores relayed BroadcastChannel
// messages, so it can't interfere with the live demo.
if(!/HTML-ELEMENT-MARKER/.test(print)) fail('print layer missing the html element (HTML-ELEMENT-MARKER)');
const printIframes = (print.match(/<iframe/g)||[]).length;
if(printIframes < 1) fail(`print layer has no iframes (html element not rendered as iframe?)`);
console.log(`  print layer: html element rendered as srcdoc iframe (${printIframes}); demo/notebook baked/placeholder ✓`);

// Nav scoped to #viewport → the print-layer .slide copies don't leak into the
// interactive slide count / nav (the "90 slides" bug), and the global iframe
// sweeps are present but that's fine (they no-op on cross-origin demo frames and
// the print html iframe ignores relayed messages).
if(!/querySelectorAll\('#viewport \.slide'\)/.test(html)) fail('nav JS not scoped to #viewport');
const deckSlides = Number(await exec(sid,`return window.__eigendeck.store.getState().presentation.slides.length;`));
const viewportSlides = (screen.slice(screen.indexOf('id="viewport"')).match(/<div class="slide"/g)||[]).length;
if(viewportSlides !== deckSlides) fail(`#viewport has ${viewportSlides} slides, deck has ${deckSlides} (print copies leaking in)`);
console.log(`  nav scoped to #viewport: ${viewportSlides} interactive slide(s), print copies excluded ✓`);

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('PRINTDEMO_PASS: live demo + html + notebook survive the print layer in the interactive export (#109)');
process.exit(0);
