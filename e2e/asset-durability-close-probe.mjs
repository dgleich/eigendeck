// #190 — David's EXACT scenario, end to end with a GRACEFUL close (not a mid-session
// file copy): add image v1, change to v2 (watcher reload), confirm v2 in the deck,
// wait out the debounce, save + close the app (flush + db_close, which runs
// wal_checkpoint(TRUNCATE) like the real close), WIPE the trust ledger, reopen, and
// verify what is actually displayed. Untrusted reopen does zero source reads, so the
// asset shown is purely what was persisted to the file — the real durability question.
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const FIG = join(dirname(DECK), 'fig.svg');
const SETTLE = 1800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function openDeck(path){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[path]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const fail = (m) => { console.error('ASSET_DURABILITY_CLOSE_FAIL:', m); process.exit(1); };
const len = (sid) => execA(sid, "const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_get_asset_by_id',{assetId:'ia1'}).then(b=>d(new Uint8Array(b).length)).catch(()=>d(-1));");
const store = (sid, bytes) => execA(sid, `const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'fig.svg',data:Array.from(new TextEncoder().encode(${JSON.stringify(bytes)})),mimeType:'image/svg+xml',externalPath:'fig.svg',externalMtime:null,assetId:'ia1'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
const svg = (n) => '<svg>' + 'x'.repeat(Math.max(0, n - 11)) + '</svg>';
const V1 = svg(200), V2 = svg(900);
const label = (l) => l === V1.length ? 'v1' : l === V2.length ? 'v2' : l < 0 ? 'ABSENT' : `${l}B`;

// ── Add image v1 ─────────────────────────────────────────────────────────────
writeFileSync(FIG, V1);
let sid = await openDeck(DECK); if (!sid || !await waitSeam(sid)) fail('open');
if (await store(sid, V1) !== 'ok') fail('store v1');
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'i1',type:'image',assetId:'ia1',position:{x:60,y:60,width:300,height:300}});");
await sleep(SETTLE);
console.log('  added image v1');

// ── Change to v2 (watcher reload = db_store_asset), confirm it's in the deck ──
writeFileSync(FIG, V2);
if (await store(sid, V2) !== 'ok') fail('store v2 (reload)');
if (await len(sid) !== V2.length) fail('v2 not live after reload');
console.log('  changed to v2, confirmed live in the deck (900B)');

// ── Wait a second for any debounce, then SAVE + graceful CLOSE ────────────────
await sleep(SETTLE);
if (await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));") !== 'ok') fail('save');
// Wipe the trust ledger (David's step) so the reopen can't re-derive v2 from source.
if (await execA(sid, "const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('write_trust_ledger',{json:'{}'}).then(()=>d('ok')).catch(e=>d('ERR'+e));") !== 'ok') fail('wipe ledger');
// Graceful close: flush pending edits + db_close (runs wal_checkpoint(TRUNCATE)),
// exactly what closeSqliteProject / the app's clean quit does.
await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.flush().then(()=>d('ok')).catch(()=>d('ok'));");
if (await execA(sid, "const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_close').then(()=>d('ok')).catch(e=>d('ERR'+e));") !== 'ok') fail('db_close');
console.log('  saved + graceful close (flush + db_close checkpoint) + trust wiped');
await sleep(400); await quit(sid); await sleep(800);

// ── Reopen (untrusted) and verify what is displayed ──────────────────────────
sid = await openDeck(DECK); if (!sid || !await waitSeam(sid)) fail('reopen');
const trust = await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.trustReport().then(r=>d(!!r.trusted)).catch(()=>d('ERR'));");
const shown = await len(sid);
await quit(sid);
console.log(`  reopened (trusted=${trust}); displayed asset = ${label(shown)} (${shown}B)`);

if (trust === true) console.log('  NOTE: deck came back TRUSTED despite the wipe — result may reflect a source re-read, not persistence.');
if (shown === V2.length) {
  console.log('ASSET_DURABILITY_CLOSE_OK: a graceful save+close PERSISTS v2 → reopen shows v2. The multi-machine loss must be a sync race (main file grabbed BEFORE the close-checkpoint), not the close path itself.');
  process.exit(0);
}
console.log(`ASSET_DURABILITY_CLOSE_REPRO: after save + graceful close + trust-wipe, reopen shows ${label(shown)} — v2 was LOST across the close/reopen. #190 confirmed in the close path.`);
process.exit(0);
