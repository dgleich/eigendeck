// Demo framerate regression test (docs/DEMO-PLATFORM.md). Mounts the fps-probe
// deck and measures the demo's rAF fps — 'solo' (a plain visible demo) and/or
// 'controller' (a hidden multi-part controller), plus the viewport's received
// broadcasts/sec (relay throughput). Asserts the demo fps >= FPS_MIN so a
// framerate regression (e.g. the opaque-origin cross-origin rAF throttle that
// halves ~60→~30) fails loudly.
// Env: E2E_DECK, E2E_APP, SECONDS (default 6), FPS_MIN (default 45).
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const SECONDS=parseInt(process.env.SECONDS||'6',10);
const FPS_MIN=parseFloat(process.env.FPS_MIN||'45');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(s,x){return (await post(`/session/${s}/execute/sync`,{script:x,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(s){for(let i=0;i<25;i++){await sleep(800);if(await exec(s,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const med=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
const fail=m=>{console.error('FPS_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
await exec(sid,`window.__fps={solo:[],controller:[],viewport:[]};
  window.addEventListener('message',e=>{var d=e.data; if(d&&d.__eigendeck===1&&d.type==='fps'){
    if(d.who==='solo') window.__fps.solo.push(d.fps);
    else if(d.who==='controller') window.__fps.controller.push(d.fps);
    else if(d.who==='viewport') window.__fps.viewport.push(d.recvPerSec); }});`);
await exec(sid,`window.__eigendeck.store.getState().selectSlide(0);`);
await sleep(SECONDS*1000 + 1500);
const r=await exec(sid,`return window.__fps`);
const solo=med(r.solo||[]), cfps=med(r.controller||[]), vrate=med(r.viewport||[]);
if((r.solo||[]).length) console.log(`  solo       samples: [${r.solo.map(x=>x.toFixed(0)).join(', ')}]`);
if((r.controller||[]).length) console.log(`  controller samples: [${r.controller.map(x=>x.toFixed(0)).join(', ')}]`);
if((r.viewport||[]).length) console.log(`  viewport   samples: [${r.viewport.map(x=>x.toFixed(0)).join(', ')}]`);
console.log(`FPS_RESULT solo=${solo==null?'NA':solo.toFixed(1)} controller_fps=${cfps==null?'NA':cfps.toFixed(1)} viewport_recv_per_sec=${vrate==null?'NA':vrate.toFixed(1)}`);
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});

// the demo's rAF fps: solo if present, else the controller
const demoFps = solo != null ? solo : cfps;
if (demoFps == null) fail('no fps samples collected (demo did not run?)');
if (demoFps < FPS_MIN) {
  console.error(`FPS_REGRESSION: demo rAF fps ${demoFps.toFixed(1)} < ${FPS_MIN} (cross-origin rAF throttle?)`);
  process.exit(1);
}
console.log('FPS_PASS');
process.exit(0);
