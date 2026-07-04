// Collect demo-error messages the bridge forwards from opaque demos + do an
// in-parent WebGL sanity check. Env: E2E_DECK, E2E_APP, SLIDE, PROBE_OUT.
import { writeFileSync } from 'node:fs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const SLIDE=parseInt(process.env.SLIDE||'0',10); const OUT=process.env.PROBE_OUT;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function get(p){const r=await fetch(BASE+p);const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(s,x){return (await post(`/session/${s}/execute/sync`,{script:x,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(s){for(let i=0;i<25;i++){await sleep(800);if(await exec(s,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('ERRCOLLECT_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
await exec(sid,`window.__demoErrs=[]; window.addEventListener('message',function(e){ var d=e.data; if(d&&d.__eigendeck===1&&d.type==='demo-error') window.__demoErrs.push(d.src+': '+d.message); });`);
await exec(sid,`window.__eigendeck.store.getState().selectSlide(${SLIDE});`);
await sleep(6000);
const errs=await exec(sid,`return (window.__demoErrs||[]).slice(0,30);`);
console.log('  demo errors ('+errs.length+'):');
for(const e of errs) console.log('   - '+e);
if(OUT){ const shot=await get(`/session/${sid}/screenshot`); if(shot&&shot.value){ writeFileSync(OUT, Buffer.from(shot.value,'base64')); console.log('  shot ->',OUT); } }
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('ERRCOLLECT_DONE');
process.exit(0);
