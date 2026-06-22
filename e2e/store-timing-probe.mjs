// Time db_store_asset for a large Uint8Array, to confirm whether passing the
// typed array directly (the #174 fix) actually transfers as raw bytes (fast)
// or whether Tauri still does something O(n)-slow → a second bottleneck.
// Env: E2E_APP, E2E_DECK.
const BASE = 'http://127.0.0.1:4444';
const APP = process.env.E2E_APP || '/tmp/elrig/eigendeck';
const DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return{status:r.status,j}}
async function exec(sid,s){const{j}=await post(`/session/${sid}/execute/sync`,{script:s,args:[]});return j?.value}
if(!DECK){console.error('set E2E_DECK');process.exit(2)}
let sid;
for(let i=0;i<12;i++){try{const{j}=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId){sid=j.value.sessionId;break}}catch{}await sleep(1000)}
if(!sid){console.error('NO SESSION');process.exit(2)}
let ready=false;
for(let i=0;i<25;i++){await sleep(1000);const v=await exec(sid,`return (async()=>{try{return !!(await window.__TAURI_INTERNALS__.invoke('db_get_project_id'))}catch(e){return false}})()`).catch(()=>false);if(v===true){ready=true;break}}
if(!ready){console.error('DB not ready');await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});process.exit(1)}

await exec(sid, `
  window.__perf = null;
  (async () => {
    const inv = window.__TAURI_INTERNALS__.invoke;
    const out = {};
    for (const MB of [10, 50, 100]) {
      const u8 = new Uint8Array(MB*1024*1024);
      for (let i=0;i<u8.length;i+=4096) u8[i]=i & 255;   // touch pages so it's real
      const t0 = performance.now();
      await inv('db_store_asset', { path:'perf/u8_'+MB+'.bin', data: u8, mimeType:'application/octet-stream', externalPath:null, externalMtime:null });
      out['store_u8_'+MB+'MB_ms'] = Math.round(performance.now()-t0);
    }
    window.__perf = out;
  })().catch(e => { window.__perf = { err: String(e).slice(0,200) }; });
  return 'started';
`);
let res=null;
for(let i=0;i<60;i++){await sleep(1000);const v=await exec(sid,`return window.__perf`);if(v){res=v;break}}
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
if(!res){console.error('timing never completed (likely a very long stall — that itself is the signal)');process.exit(1)}
console.log('STORE_TIMING '+JSON.stringify(res,null,2));
