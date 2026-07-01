// Asset-security SPEC — ON-OPEN, untrusted (docs/ASSETS-SECURITY.md): opening an
// UNTRUSTED deck whose linked source changed on disk while closed does ZERO disk
// reads — the embedded snapshot stays. (Pairs with asset-open-trusted-probe.)
//
//   S1  untrusted deck: store fig.svg (a bytes) + image element, save, quit.
//   —   change fig.svg to LONGER bytes on disk (deck closed).
//   S2  reopen (still untrusted): on-open scan is skipped → bytes unchanged.
//
// Uses an IMAGE (svg) asset — no media-decode path, matching the trusted probe.
// Byte-level; needs an empty deck under HOME (fs:allow-watch scope).
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const FIG = join(dirname(DECK), 'fig.svg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const fail = (m) => { console.error('OPEN_UNTRUSTED_FAIL:', m); process.exit(1); };
const len = (sid) => execA(sid, "const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_get_asset_by_id',{assetId:'ia1'}).then(b=>d(new Uint8Array(b).length)).catch(()=>d(-1));");
const save = (sid) => execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));");
async function staysLen(sid, want){ for(let i=0;i<10;i++){ await sleep(800); if(await len(sid)!==want) return false; } return true; }
const svg = (n) => '<svg>' + 'x'.repeat(Math.max(0, n - 11)) + '</svg>';   // valid svg of length n

// ── S1: untrusted deck with a linked image, saved ───────────────────────────
const A = svg(200);
writeFileSync(FIG, A);
let sid = await open(); if (!sid || !await waitSeam(sid)) fail('S1 open');
if (await execA(sid, `const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'fig.svg',data:Array.from(new TextEncoder().encode(${JSON.stringify(A)})),mimeType:'image/svg+xml',externalPath:'fig.svg',externalMtime:null,assetId:'ia1'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`) !== 'ok') fail('store ia1');
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'i1',type:'image',assetId:'ia1',position:{x:60,y:60,width:300,height:300}});");
if (await save(sid) !== 'ok') fail('S1 save');
await sleep(800); await quit(sid);
console.log('  S1: untrusted deck with linked fig.svg (200B), saved');

// ── S2: change on disk while closed, reopen UNTRUSTED → no reload ────────────
writeFileSync(FIG, svg(900));
sid = await open(); if (!sid || !await waitSeam(sid)) fail('S2 open');
console.log('  S2 diag:', await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.trustReport().then(r=>d(r)).catch(e=>d('ERR'+e));"));
if (!await staysLen(sid, 200)) fail('UNTRUSTED reopen reloaded a changed source (on-open scan must do zero reads)');
await quit(sid);
console.log('  S2: untrusted reopen → fig.svg change NOT read (stays 200) ✓');
console.log('OPEN_UNTRUSTED_PASS: an untrusted deck reads nothing on open — snapshot stays');
process.exit(0);
