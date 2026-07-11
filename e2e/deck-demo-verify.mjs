// Verify every demo in a deck renders under the opaque-origin code. Walks each
// slide with demo/demo-piece elements, reports mounted-vs-blocked frames and any
// bridge-forwarded demo errors, and screenshots each demo slide to PROBE_OUT dir.
// Env: E2E_DECK, E2E_APP, PROBE_OUT (dir), TAG (label for shots).
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const OUTDIR=process.env.PROBE_OUT||'/tmp/deckshots'; const TAG=process.env.TAG||'deck';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function get(p){const r=await fetch(BASE+p);const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(s,x){return (await post(`/session/${s}/execute/sync`,{script:x,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(s){for(let i=0;i<25;i++){await sleep(800);if(await exec(s,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('VERIFY_FAIL:',m);process.exit(1);};
try{mkdirSync(OUTDIR,{recursive:true});}catch{}

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
await exec(sid,`window.__derr=[]; window.addEventListener('message',e=>{var d=e.data; if(d&&d.__eigendeck===1&&d.type==='demo-error') window.__derr.push(d.src+': '+String(d.message).slice(0,120));});`);
const demoSlides=await exec(sid,`return window.__eigendeck.store.getState().presentation.slides
  .map((s,i)=>({i, n:s.elements.filter(e=>e.type==='demo'||e.type==='demo-piece').length}))
  .filter(s=>s.n>0);`);
if(!demoSlides||!demoSlides.length){ console.log(`${TAG}: NO demo slides`); process.exit(0); }

let totEl=0, totMount=0, totBlocked=0;
for(const {i,n} of demoSlides){
  try{
    await exec(sid,`window.__eigendeck.store.getState().selectSlide(${i});`);
    await sleep(2200);
    const r=await exec(sid,`try{
      const frames=document.querySelectorAll('iframe.el-demo-frame').length;
      const blocked=(document.body.textContent.match(/isn.t a valid Eigendeck demo/g)||[]).length;
      return {frames, blocked};}catch(e){return {frames:-1,blocked:-1,err:String(e.message)}}`)
      || {frames:-2, blocked:-2};
    totEl+=n; totMount+=Math.max(0,r.frames); totBlocked+=Math.max(0,r.blocked);
    const flag = (r.blocked>0)?' BLOCKED':((r.frames<n)?' MISSING':'');
    console.log(`  slide ${i}: els=${n} frames=${r.frames} blocked=${r.blocked}${flag}${r.err?(' '+r.err):''}`);
    const shot=await get(`/session/${sid}/screenshot`); if(shot&&shot.value) writeFileSync(`${OUTDIR}/${TAG}-s${i}.png`, Buffer.from(shot.value,'base64'));
  }catch(e){ console.log(`  slide ${i}: EXEC-ERR ${String(e.message).slice(0,80)}`); }
}
const errs=await exec(sid,`return (window.__derr||[]).slice(0,20)`);
console.log(`${TAG}: SUMMARY els=${totEl} mounted=${totMount} blocked=${totBlocked} errors=${errs.length}`);
const uniqErrs=[...new Set(errs)]; for(const e of uniqErrs.slice(0,8)) console.log('    err: '+e);
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('VERIFY_DONE');
process.exit(0);
