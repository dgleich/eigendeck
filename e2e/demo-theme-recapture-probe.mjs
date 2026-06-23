// #86: a themed demo's cached PNG preview must be RE-captured after a theme
// switch. The theme is injected as CSS vars in the iframe <head>, so the
// captured <body> HTML is byte-identical across themes — the preview hash is
// salted with the theme so the switch still busts it. Without the fix the
// preview stays stale (old colours).
//
// Self-contained + deterministic: builds ONE slide with the theme-probe demo
// (whose <body> background IS var(--eigendeck-bg)), so a white→dark switch MUST
// flip the captured PNG. Drives the REAL store + capture pipeline via the seam.
import { readFileSync } from 'node:fs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const DEMO_HTML=readFileSync('/work/e2e/fixtures/theme-probe-demo.html','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execAsync(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('RECAP_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');

// One slide, white theme, full-bleed theme-probe demo.
const assetId=await exec(sid,`return await window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'demos/theme-probe.html',data:Array.from(new TextEncoder().encode(${JSON.stringify(DEMO_HTML)})),mimeType:'text/html',externalPath:null,externalMtime:null});`);
if(!assetId||typeof assetId!=='string') fail('db_store_asset returned '+JSON.stringify(assetId));
const KEY='recap-demo';
// NB: leave the slide theme UNSET (undefined) so the DECK theme drives it —
// resolveTheme uses slideTheme||deckTheme, so a slide override would defeat setTheme.
await exec(sid,`var g=window.__eigendeck.store.getState; while(g().presentation.slides.length>1){ g().deleteSlide(g().presentation.slides.length-1); } g().selectSlide(0); g().setTheme('white'); g().updateSlide(0,{theme:undefined,elements:[]}); g().addElement({id:'${KEY}',type:'demo',assetId:${JSON.stringify(assetId)},position:{x:0,y:0,width:1920,height:1080}});`);
console.log('  built 1 slide w/ theme-probe demo, theme=white');

async function readPreview(sid){
  return await execAsync(sid, `const done=arguments[arguments.length-1];
    window.__eigendeck.previewDataUrl('${KEY}').then(u=>done(u||'')).catch(()=>done(''));`);
}
async function waitPreview(sid,label){ for(let i=0;i<20;i++){const u=await readPreview(sid); if(u&&u.length>64) return u; await sleep(700);} fail('no preview captured ('+label+')'); }

await sleep(1500);
const before=await waitPreview(sid,'white');
console.log(`  white preview captured (${before.length} b64 chars)`);

await exec(sid,`window.__eigendeck.store.getState().setTheme('dark');`);
console.log('  switched theme white -> dark; waiting for re-capture…');

let after=null;
for(let i=0;i<25;i++){ await sleep(700); const u=await readPreview(sid); if(u&&u.length>64&&u!==before){ after=u; break; } }
if(!after) fail('preview did NOT change after theme switch (stale — the bug)');
console.log(`  dark preview re-captured (${after.length} b64 chars, differs ✓)`);

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('RECAP_PASS: demo preview re-captured on theme change (#86)');
process.exit(0);
