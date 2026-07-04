// Spike probe (docs/DEMO-PLATFORM.md): open a deck, select a slide, let the
// opaque-origin demo(s) load, and SCREENSHOT the app. contentDocument is no
// longer reachable from the parent (opaque origin), so we verify visually +
// report what the parent CAN see: iframe src schemes, opaque-access errors,
// parent console errors.
// Env: E2E_DECK, E2E_APP, SLIDE (index), PROBE_OUT (png path).
import { writeFileSync } from 'node:fs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const SLIDE=parseInt(process.env.SLIDE||'0',10);
const OUT=process.env.PROBE_OUT||'/tmp/opaque-demo-shot.png';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function get(p){const r=await fetch(BASE+p);const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(s,x){return (await post(`/session/${s}/execute/sync`,{script:x,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(s){for(let i=0;i<25;i++){await sleep(800);if(await exec(s,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('SHOT_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
// hook parent console errors
await exec(sid,`window.__spikeErrs=[]; const _e=console.error; console.error=function(){window.__spikeErrs.push([...arguments].map(String).join(' ')); return _e.apply(console,arguments);};
  window.addEventListener('error',e=>window.__spikeErrs.push('window.error: '+e.message));`);
const nSlides=await exec(sid,`return window.__eigendeck.store.getState().presentation.slides.length`);
console.log(`  deck has ${nSlides} slides; selecting slide ${SLIDE}`);
await exec(sid,`window.__eigendeck.store.getState().selectSlide(${SLIDE});`);
await sleep(5000); // WebGL + fonts + relay settle

const info=await exec(sid,`
  const ifr=[...document.querySelectorAll('iframe.el-demo-frame')];
  const out=ifr.map(f=>{
    const src=(f.getAttribute('src')||'').slice(0,24);
    let opaque=false, err='';
    try { const d=f.contentDocument; opaque=(d===null); if(d) err='READABLE(not opaque!)'; }
    catch(e){ opaque=true; err='threw:'+e.message; }
    return {src, sandbox:f.getAttribute('sandbox'), opaque, err, w:f.clientWidth, h:f.clientHeight};
  });
  return {count:ifr.length, frames:out, errs:(window.__spikeErrs||[]).slice(0,20)};
`);
console.log('  demo iframes:', JSON.stringify(info,null,2));

const shot=await get(`/session/${sid}/screenshot`);
if(shot&&shot.value){ writeFileSync(OUT, Buffer.from(shot.value,'base64')); console.log('  screenshot ->',OUT); }
else console.log('  NO screenshot value');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('SHOT_DONE');
process.exit(0);
