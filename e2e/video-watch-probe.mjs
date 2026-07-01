// Video file-watching: a local video bound to an external file reloads when the
// file changes on disk (byte-level — no codecs needed, works headlessly).
//
// Self-contained: writes clip.mp4 next to the deck, stores it as an asset with
// external_path + adds a kind:'file' video element, then mutates the file and
// asserts the stored asset bytes reload to match.
//
// Run via e2e runner with HOME=/tmp so the deck dir is in the fs:allow-watch
// scope (see notebook-watch-takecontrol-probe.mjs). E2E_DECK must be an empty
// deck under HOME, e.g. /tmp/vidwatch/deck.eigendeck.
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const CLIP = join(dirname(DECK), 'clip.mp4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail = (m) => { console.error('VW_FAIL:', m); process.exit(1); };
// Asset-security: a CLI-built fixture is untrusted, so the watcher performs ZERO
// disk reads (snapshot only). Trust it — the real "Trust this deck" action — after
// the linked asset exists, so its path is approved and live-reload turns on.
const trust = (sid) => execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.trustDeck().then(()=>d('ok')).catch(e=>d('ERR'+e));");
const len = (sid) => execA(sid, "const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_get_asset_by_id',{assetId:'va1'}).then(b=>d(new Uint8Array(b).length)).catch(()=>d(-1));");
// The asset-type gate validates content matches the extension, so the bytes must be
// a real-enough mp4: "ftyp" box signature at offset 4. (A blob of zeros is rejected
// as content-mismatch — the security feature working; see docs/ASSETS-SECURITY.md.)
const mp4 = (n, v) => { const a = Buffer.alloc(n, v); a[4]=0x66; a[5]=0x74; a[6]=0x79; a[7]=0x70; return a; };

writeFileSync(CLIP, mp4(1000, 1));   // v1
const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');
await execA(sid, `const d=arguments[arguments.length-1];const a=new Uint8Array(1000).fill(1);a[4]=102;a[5]=116;a[6]=121;a[7]=112;window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'clip.mp4',data:Array.from(a),mimeType:'video/mp4',externalPath:'clip.mp4',externalMtime:null,assetId:'va1'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'v1',type:'video',kind:'file',assetId:'va1',position:{x:200,y:150,width:800,height:450}});");
if (await trust(sid) !== 'ok') fail('trust deck');   // approve clip.mp4 for live-reload
await sleep(3000);                            // watcher subscribes + records baseline
const before = await len(sid);
if (before !== 1000) fail(`baseline bytes wrong: ${before}`);

writeFileSync(CLIP, mp4(5000, 2));   // v2 — mutate on disk
let after = before;
for (let i = 0; i < 20; i++) { await sleep(1000); after = await len(sid); if (after === 5000) break; }
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (after !== 5000) fail(`watcher did not reload (before=${before} after=${after})`);
console.log('VW_PASS: video reloaded on disk change (1000 → 5000 bytes)');
process.exit(0);
