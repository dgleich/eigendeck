// Asset-security SPEC — ledger hygiene (docs/ASSETS-SECURITY.md): relocating an asset
// REPLACES its approval in place, so the OLD resolved path is dropped from the ledger
// (not left as an orphan that would grow the token-transplant surface). Asserts the raw
// ledger approvals via the trustReport seam.
//
//   store fig1.svg + image element, trust  → ledger approves .../fig1.svg
//   re-point the SAME asset to fig2.svg + trust (what relocate does under the hood)
//                                          → ledger approves .../fig2.svg, fig1.svg GONE
//
// Uses an svg image asset. Needs an empty deck under HOME (fs:allow-watch scope).
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const HOME = dirname(DECK);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail = (m) => { console.error('CLEANUP_FAIL:', m); process.exit(1); };
const trust = (sid) => execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.trustDeck().then(()=>d('ok')).catch(e=>d('ERR'+e));");
const approvals = async (sid) => { const r = JSON.parse(await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.trustReport().then(x=>d(x)).catch(e=>d('ERR'+e));")); return r.ledgerApprovals || []; };
const storeSvg = (sid, path, id) => execA(sid, `const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'${path}',data:Array.from(new TextEncoder().encode('<svg></svg>')),mimeType:'image/svg+xml',externalPath:'${path}',externalMtime:null,assetId:'${id}'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
const has = (list, name) => list.some((p) => p.endsWith('/' + name));

writeFileSync(join(HOME, 'fig1.svg'), '<svg></svg>');
const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');
if (await storeSvg(sid, 'fig1.svg', 'ia1') !== 'ok') fail('store fig1');
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'i1',type:'image',assetId:'ia1',position:{x:60,y:60,width:200,height:200}});");
if (await trust(sid) !== 'ok') fail('trust');

let a = await approvals(sid);
if (!(has(a, 'fig1.svg') && !has(a, 'fig2.svg') && a.length === 1)) fail(`after trust, expected [fig1.svg] only, got ${JSON.stringify(a)}`);
console.log('  trust → ledger approves fig1.svg (1 entry) ✓');

// Re-point the SAME asset to fig2.svg — what relocate does (same assetId, new path).
writeFileSync(join(HOME, 'fig2.svg'), '<svg></svg>');
if (await storeSvg(sid, 'fig2.svg', 'ia1') !== 'ok') fail('re-store fig2');
if (await trust(sid) !== 'ok') fail('re-trust');

a = await approvals(sid);
if (!has(a, 'fig2.svg')) fail(`after relocate, fig2.svg should be approved, got ${JSON.stringify(a)}`);
if (has(a, 'fig1.svg')) fail(`OLD path fig1.svg was NOT removed — orphaned approval, got ${JSON.stringify(a)}`);
if (a.length !== 1) fail(`expected exactly 1 approval after in-place relocate, got ${JSON.stringify(a)}`);
console.log('  relocate → ledger now approves fig2.svg, fig1.svg dropped in place (still 1 entry) ✓');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.log('CLEANUP_PASS: relocate replaces the asset\'s approval; the old path leaves no orphan');
process.exit(0);
