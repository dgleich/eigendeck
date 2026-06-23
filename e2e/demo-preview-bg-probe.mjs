// Verify the demo PREVIEW PNG bakes in the slide background (not transparent/grey).
// Uses the transparent 'gimmicks' demo on a DARK slide; reads the cached preview
// via the seam, draws it to a canvas, and checks the top-left pixel is OPAQUE and
// ~ the dark theme bg (#1a1a2e) — before the fix it was transparent (alpha 0).
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

// Read the preview data URL, draw it, sample top-left pixel.
const px = await execA(sid, `
  const done = arguments[arguments.length-1];
  window.__eigendeck.previewDataUrl('${KEY}').then(url=>{
    if(!url){ done('NO_URL'); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width=img.width; c.height=img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img,0,0);
      const d = ctx.getImageData(2,2,1,1).data;
      done(d[0]+','+d[1]+','+d[2]+','+d[3]);
    };
    img.onerror = () => done('IMG_ERR');
    img.src = url;
  }).catch(e=>done('ERR:'+e));`);
console.log('  preview top-left pixel rgba =', px);
if(typeof px!=='string' || px.startsWith('NO_URL')||px.startsWith('ERR')||px.startsWith('IMG')) fail('could not sample preview: '+px);
const [r,gc,b,a]=px.split(',').map(Number);
if(a < 250) fail(`preview corner is transparent (alpha=${a}) — would read as the app's grey`);
// dark theme bg is #1a1a2e = (26,26,46). Allow a little tolerance.
if(Math.abs(r-26)>24 || Math.abs(gc-26)>24 || Math.abs(b-46)>28) fail(`preview bg ${px} != dark slide bg (26,26,46)`);
console.log('  preview bg matches the dark slide (opaque, ~#1a1a2e) ✓');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('PVBG_PASS: transparent demo preview bakes in the slide background');
process.exit(0);
