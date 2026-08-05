// #109: the interactive HTML export embeds a print layer, so File→Print yields the
// print view. Exports a real deck via the seam (fileOps.buildPresentationExportHtml
// — the GUI path), then asserts the output has BOTH the interactive screen layer
// AND the print layer (inch-based .slide divs + @page CSS), and that on PRINT the
// screen layer is hidden and the print layer shown (checked via the emitted CSS).
import { writeFileSync } from 'fs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){try{const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}catch{return null}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('PRINTLAYER_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');
const html=await execA(sid,`const done=arguments[arguments.length-1]; Promise.resolve().then(()=>window.__eigendeck.exportHtml()).then(h=>done(h)).catch(e=>done('ERR:'+e));`);
if(typeof html!=='string'||html.startsWith('ERR:')) fail('exportHtml failed: '+html);
writeFileSync('/tmp/export-print-layer.html', html);
console.log(`  exported ${html.length} chars → /tmp/export-print-layer.html`);

// Structure: both layers + print CSS.
if(!/<div class="eig-screen-layer">/.test(html)) fail('no eig-screen-layer (interactive layer)');
if(!/<div class="eig-print-layer">/.test(html)) fail('no eig-print-layer (print layer)');
if(!/id="viewport"/.test(html)) fail('screen layer missing the interactive viewport');
// Print layer must contain inch-based print slides + @page rules.
const printLayer = html.slice(html.indexOf('<div class="eig-print-layer">'));
const nSlides = (printLayer.match(/<div class="slide"/g)||[]).length;
if(nSlides < 1) fail(`print layer has no .slide divs (got ${nSlides})`);
if(!/\din/.test(printLayer)) fail('print slides are not inch-positioned');
if(!/@page\s*\{\s*size:\s*letter landscape/.test(html)) fail('no @page letter-landscape rule');
// The @media print swap: hide screen layer, show print layer.
if(!/@media print[\s\S]*\.eig-screen-layer\s*\{\s*display:\s*none/.test(html)) fail('@media print does not hide the screen layer');
console.log(`  print layer: ${nSlides} inch-based slide(s) + @page letter-landscape + @media print swap ✓`);

// Sanity: slide count in the print layer matches the deck.
const deckSlides = Number(await exec(sid,`return window.__eigendeck.store.getState().presentation.slides.length;`));
if(nSlides !== deckSlides) fail(`print layer has ${nSlides} slides, deck has ${deckSlides}`);
console.log(`  print layer slide count matches the deck (${deckSlides})`);

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('PRINTLAYER_PASS: interactive export embeds a printable inch-based print layer (#109)');
process.exit(0);
