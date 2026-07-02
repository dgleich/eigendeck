// Asset-security SPEC — demo-mount gate (docs/ASSETS-SECURITY.md, "demo-ingestion
// invariant"): a deck can never RENDER non-demo HTML as a demo. Even if unmarked HTML
// bytes get into a demo asset (CLI import, hand-edited DB, legacy), the mount refuses
// to build the iframe and shows a notice instead. A properly-marked demo still mounts.
//
//   add a demo element bound to UNMARKED html  → NO iframe; "isn't a valid Eigendeck demo"
//   add a demo element bound to MARKED html    → iframe mounts
//
// Needs an empty deck under HOME.
import { dirname } from 'path';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
void dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail = (m) => { console.error('DEMO_GATE_FAIL:', m); process.exit(1); };
const UNMARKED = '<!DOCTYPE html><html><body><div>PLAIN PAGE, NOT A DEMO</div></body></html>';
const MARKED   = '<!DOCTYPE html><!--eigendeck-demo-v1--><html><body><div>MARKED DEMO</div></body></html>';
const store = (sid, path, id, html) => exec(sid, `return window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'${path}',data:Array.from(new TextEncoder().encode(${JSON.stringify(html)})),mimeType:'text/html',externalPath:null,externalMtime:null,assetId:'${id}'});`);
const iframeCount = (sid) => exec(sid, "return document.querySelectorAll('.el-demo iframe').length");
const hasBlockedNotice = (sid) => exec(sid, "return (document.body.textContent||'').includes('a valid Eigendeck demo')");

const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');
if (await store(sid, 'demos/plain.html', 'da1', UNMARKED) === undefined) fail('store unmarked');
if (await store(sid, 'demos/real.html', 'da2', MARKED) === undefined) fail('store marked');
await exec(sid, "const g=window.__eigendeck.store.getState; g().selectSlide(0); g().updateSlide(0,{elements:[]}); g().addElement({id:'dm-bad',type:'demo',assetId:'da1',position:{x:0,y:0,width:800,height:450}}); g().addElement({id:'dm-good',type:'demo',assetId:'da2',position:{x:820,y:0,width:800,height:450}});");

// Let both demos resolve (the marker check + blob URL, or the block).
let iframes = 0, blocked = false;
for (let i = 0; i < 20; i++) {
  await sleep(700);
  iframes = await iframeCount(sid);
  blocked = await hasBlockedNotice(sid);
  if (iframes === 1 && blocked) break;
}
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});

if (iframes !== 1) fail(`expected exactly 1 demo iframe (only the marked demo mounts), got ${iframes}`);
if (!blocked) fail('expected the "isn’t a valid Eigendeck demo" notice for the unmarked demo');
console.log('  unmarked demo → blocked (notice shown, no iframe) ✓');
console.log('  marked demo   → mounts (iframe) ✓');
console.log('DEMO_GATE_PASS: the mount gate renders only marked eigendeck demos');
process.exit(0);
