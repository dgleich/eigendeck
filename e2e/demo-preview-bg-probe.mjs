// Verify the demo PREVIEW PNG is captured TRANSPARENT (#111) — NOT baked opaque.
// Uses the transparent 'gimmicks' demo on a DARK slide and checks two things on
// the corner pixel of the cached preview:
//   1. RAW preview corner is TRANSPARENT (alpha ~0) — no baked backdrop, so the
//      slide + any elements beneath the demo show through in static renders;
//   2. composited OVER the dark slide bg it reads as the dark bg (~#1a1a2e) — it
//      still "matches the slide", now via the render context's backdrop not the
//      baked pixels.
// (Old behaviour baked an OPAQUE #1a1a2e corner; that opacity covered overlapping
//  lower elements — the bug #111 fixes by moving the bg from pixels to wrapper.)
import { readFileSync } from 'node:fs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const HTML=readFileSync('/work/example-demos/gimmicks/demos/gimmicks.html','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('PVBG_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');
const assetId=await exec(sid,`return await window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'demos/gimmicks.html',data:Array.from(new TextEncoder().encode(${JSON.stringify(HTML)})),mimeType:'text/html',externalPath:null,externalMtime:null});`);
const KEY='pvbg';
await exec(sid,`var g=window.__eigendeck.store.getState; while(g().presentation.slides.length>1){g().deleteSlide(g().presentation.slides.length-1);} g().selectSlide(0); g().setTheme('dark'); g().updateSlide(0,{theme:undefined,elements:[]}); g().addElement({id:'${KEY}',type:'demo',assetId:${JSON.stringify(assetId)},position:{x:0,y:0,width:1920,height:1080}});`);
await sleep(2500);

// Read the preview data URL; sample the corner RAW (transparent?) and COMPOSITED
// over the dark slide bg (reads as the slide?).
const out = await execA(sid, `
  const done = arguments[arguments.length-1];
  window.__eigendeck.previewDataUrl('${KEY}').then(url=>{
    if(!url){ done('NO_URL'); return; }
    const img = new Image();
    img.onload = () => {
      // RAW: draw on an empty (transparent) canvas
      const c = document.createElement('canvas'); c.width=img.width; c.height=img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img,0,0);
      const raw = ctx.getImageData(2,2,1,1).data;
      // COMPOSITED: fill the dark slide bg first, then the preview on top
      const c2 = document.createElement('canvas'); c2.width=img.width; c2.height=img.height;
      const x = c2.getContext('2d'); x.fillStyle='#1a1a2e'; x.fillRect(0,0,c2.width,c2.height); x.drawImage(img,0,0);
      const comp = x.getImageData(2,2,1,1).data;
      done([raw[0],raw[1],raw[2],raw[3],comp[0],comp[1],comp[2]].join(','));
    };
    img.onerror = () => done('IMG_ERR');
    img.src = url;
  }).catch(e=>done('ERR:'+e));`);
console.log('  raw+composited corner =', out);
if(typeof out!=='string' || out.startsWith('NO_URL')||out.startsWith('ERR')||out.startsWith('IMG')) fail('could not sample preview: '+out);
const [r,gc,b,a,cr,cg,cb]=out.split(',').map(Number);
// 1. raw corner must be transparent (no baked backdrop)
if(a > 32) fail(`preview corner is OPAQUE (alpha=${a}) — a slide bg was baked in; it should be transparent so lower elements show through`);
console.log(`  raw corner transparent (alpha=${a}) ✓`);
// 2. composited over the dark slide bg reads as the dark bg (26,26,46)
if(Math.abs(cr-26)>24 || Math.abs(cg-26)>24 || Math.abs(cb-46)>28) fail(`composited corner ${cr},${cg},${cb} != dark slide bg (26,26,46)`);
console.log('  composited over slide bg matches the dark slide ✓');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('PVBG_PASS: demo preview is transparent; the slide bg comes from the render context');
process.exit(0);
