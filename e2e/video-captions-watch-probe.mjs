// The captions (.vtt) sidecar of a video is file-watched too: edit it on disk
// and the asset reloads. Self-contained; byte-level (no codecs). Needs an empty
// deck under HOME=/tmp (fs:allow-watch scope).
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const VTT = join(dirname(DECK), 'caps.vtt');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail = (m) => { console.error('VTT_FAIL:', m); process.exit(1); };
// Trust the (untrusted) CLI fixture so the captions watcher may read from disk.
const trust = (sid) => execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.trustDeck().then(()=>d('ok')).catch(e=>d('ERR'+e));");
const len = (sid) => execA(sid, "const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_get_asset_by_id',{assetId:'cap1'}).then(b=>d(new Uint8Array(b).length)).catch(()=>d(-1));");

writeFileSync(VTT, 'WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n');
const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');
await execA(sid, "const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'caps.vtt',data:Array.from(new TextEncoder().encode('WEBVTT\\n\\n00:00.000 --> 00:01.000\\nhi\\n')),mimeType:'text/vtt',externalPath:'caps.vtt',externalMtime:null,assetId:'cap1'}).then(()=>d('ok')).catch(e=>d('ERR'+e));");
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'v1',type:'video',kind:'file',assetId:'va1',captionsAssetId:'cap1',captions:true,position:{x:200,y:150,width:800,height:450}});");
if (await trust(sid) !== 'ok') fail('trust deck');   // approve caps.vtt for live-reload
await sleep(3000);  // SidebarVideoTile mounts the captions watcher + baseline
const before = await len(sid);
writeFileSync(VTT, 'WEBVTT\n\n00:00.000 --> 00:02.000\nhello there, world — updated captions\n\n00:02.000 --> 00:03.000\nsecond cue\n');
let after = before;
for (let i = 0; i < 20; i++) { await sleep(1000); after = await len(sid); if (after !== before && after > 0) break; }
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (!(after > before)) fail(`.vtt did not reload (before=${before} after=${after})`);
console.log(`VTT_PASS: .vtt reloaded on disk change (${before} → ${after} bytes)`);
process.exit(0);
