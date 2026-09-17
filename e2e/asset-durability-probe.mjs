// #190 GUARD — an explicit Save must be durable: it checkpoints the WAL into the
// MAIN .eigendeck file (the bytes a cloud sync propagates), so a save()d deck can't
// leave recent work WAL-stranded. Copies ONLY the main file (never the -wal — what a
// sync grabs) at three points:
//   CP1: after v1 + addElement, waited      -> v1 (the 1s debounce checkpoints edits)
//   CP2: after a direct db_store_asset(v2), BEFORE save -> still v1 (a bare asset
//        write self-checkpoints only via the watcher path; a direct write does not)
//   CP3: after save()                        -> v2  (fix: saveProject now checkpoints)
// Pre-fix, CP3 was v1 (save() was flush + markClean, no checkpoint) — this guards that.
import { writeFileSync, copyFileSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const DIR = dirname(DECK);
const FIG = join(DIR, 'fig.svg');
const SYNCDIR = join(DIR, 'synced'); try { rmSync(SYNCDIR, { recursive: true, force: true }); } catch { /* fresh */ }
mkdirSync(SYNCDIR, { recursive: true });
const CP1 = join(SYNCDIR, 'cp1.eigendeck'), CP2 = join(SYNCDIR, 'cp2.eigendeck'), CP3 = join(SYNCDIR, 'cp3.eigendeck');
const SETTLE = 1800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function openDeck(path){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[path]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const fail = (m) => { console.error('ASSET_DURABILITY_FAIL:', m); process.exit(1); };
const len = (sid) => execA(sid, "const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_get_asset_by_id',{assetId:'ia1'}).then(b=>d(new Uint8Array(b).length)).catch(()=>d(-1));");
const store = (sid, bytes) => execA(sid, `const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'fig.svg',data:Array.from(new TextEncoder().encode(${JSON.stringify(bytes)})),mimeType:'image/svg+xml',externalPath:'fig.svg',externalMtime:null,assetId:'ia1'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
const save = (sid) => execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));");
const svg = (n) => '<svg>' + 'x'.repeat(Math.max(0, n - 11)) + '</svg>';
const V1 = svg(200), V2 = svg(900);
const label = (l) => l === V1.length ? 'v1' : l === V2.length ? 'v2' : l < 0 ? 'ABSENT' : `${l}B`;

// ── Machine 1 ────────────────────────────────────────────────────────────────
writeFileSync(FIG, V1);
let sid = await openDeck(DECK); if (!sid || !await waitSeam(sid)) fail('M1 open');
if (await store(sid, V1) !== 'ok') fail('store v1');
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'i1',type:'image',assetId:'ia1',position:{x:60,y:60,width:300,height:300}});");
await sleep(SETTLE); copyFileSync(DECK, CP1);

writeFileSync(FIG, V2);
if (await store(sid, V2) !== 'ok') fail('store v2 (reload)');
if (await len(sid) !== V2.length) fail('v2 not live');
await sleep(SETTLE); copyFileSync(DECK, CP2);          // reload landed, but no save yet

if (await save(sid) !== 'ok') fail('save');
await sleep(400); copyFileSync(DECK, CP3);             // fix: save() checkpoints
await quit(sid); await sleep(600);

// ── Read each main-file copy (untrusted; no source beside it) ────────────────
async function readCopy(path, tag) { const s = await openDeck(path); if (!s || !await waitSeam(s)) fail(`open ${tag}`); const l = await len(s); await quit(s); await sleep(400); return l; }
const l1 = await readCopy(CP1, 'CP1'), l2 = await readCopy(CP2, 'CP2'), l3 = await readCopy(CP3, 'CP3');
console.log(`  CP1 (after v1, waited)     = ${label(l1)}`);
console.log(`  CP2 (after reload, no save)= ${label(l2)}`);
console.log(`  CP3 (after save())         = ${label(l3)}   <-- fix: must be v2`);

if (l1 !== V1.length) fail(`CP1 should be v1 (debounce checkpoint), got ${label(l1)}`);
if (l3 !== V2.length) fail(`REGRESSION: save() did NOT make the reload durable — CP3=${label(l3)}, want v2. saveProject must checkpoint (#190).`);
console.log('ASSET_DURABILITY_PASS: an explicit Save checkpoints the reload into the main .eigendeck (CP3=v2), so it is sync-safe. #190 (save path) guarded.');
process.exit(0);
