// Asset-security SPEC — the Security window's operations, end-to-end (real invoke +
// ledger + store). The window is a separate Tauri webview the WebDriver rig can't
// reliably switch to, but its behavior is window-agnostic, so we drive the exact
// functions its buttons call (window.__eigendeck.security.*) and assert the model:
//
//   0. untrusted deck            → all linked files ELIGIBLE
//   1. approve BEFORE trust      → NO-OP (can't approve without trust)
//   2. Trust this deck           → trusted, but files STILL eligible (trust ≠ approve)
//   3. Approve a whole folder    → every eligible file in that dir → APPROVED; others not
//   4. Approve one more file     → that file → APPROVED
//
// Needs an empty deck under HOME. Uses svg image assets (no media decode).
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const HOME = dirname(DECK);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail = (m) => { console.error('SECURITY_ACTIONS_FAIL:', m); process.exit(1); };
const storeSvg = (sid, path, id) => execA(sid, `const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'${path}',data:Array.from(new TextEncoder().encode('<svg></svg>')),mimeType:'image/svg+xml',externalPath:'${path}',externalMtime:null,assetId:'${id}'}).then(()=>d('ok')).catch(e=>d('ERR'+e));`);
const report = async (sid) => JSON.parse(await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.security.report().then(r=>d(JSON.stringify(r))).catch(e=>d('ERR'+e));"));
const trust = async (sid) => JSON.parse(await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.security.trust().then(r=>d(JSON.stringify(r))).catch(e=>d('ERR'+e));"));
const approve = async (sid, id, ref) => JSON.parse(await execA(sid, `const d=arguments[arguments.length-1];window.__eigendeck.security.approve('${id}',${JSON.stringify(ref)}).then(r=>d(JSON.stringify(r))).catch(e=>d('ERR'+e));`));
const approveDir = async (sid, dir) => JSON.parse(await execA(sid, `const d=arguments[arguments.length-1];window.__eigendeck.security.approveDir(${JSON.stringify(dir)}).then(r=>d(JSON.stringify(r))).catch(e=>d('ERR'+e));`));
const stateOf = (rep, id) => (rep.rows.find((r) => r.assetId === id) || {}).state;
const dirOf = (rep, id) => (rep.rows.find((r) => r.assetId === id) || {}).resolvedDir;

mkdirSync(join(HOME, 'figs'), { recursive: true });
mkdirSync(join(HOME, 'other'), { recursive: true });
writeFileSync(join(HOME, 'figs', 'a.svg'), '<svg></svg>');
writeFileSync(join(HOME, 'figs', 'b.svg'), '<svg></svg>');
writeFileSync(join(HOME, 'other', 'c.svg'), '<svg></svg>');

const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');
for (const [p, id] of [['figs/a.svg', 'ia'], ['figs/b.svg', 'ib'], ['other/c.svg', 'ic']]) {
  if (await storeSvg(sid, p, id) !== 'ok') fail('store ' + id);
  await exec(sid, `window.__eigendeck.store.getState().addElement({id:'el-${id}',type:'image',assetId:'${id}',position:{x:60,y:60,width:150,height:150}});`);
}

// 0. untrusted → all eligible
let rep = await report(sid);
if (rep.trusted) fail('deck should start untrusted');
if (!['ia', 'ib', 'ic'].every((id) => stateOf(rep, id) === 'eligible')) fail(`expected all eligible, got ${JSON.stringify(rep.rows.map((r) => [r.assetId, r.state]))}`);
console.log('  0) untrusted → all 3 files eligible ✓');

// 1. approve before trust → no-op (can't approve without trust)
rep = await approve(sid, 'ia', 'figs/a.svg');
if (stateOf(rep, 'ia') !== 'eligible' || rep.trusted) fail('approve BEFORE trust changed state — must be a no-op');
console.log('  1) approve before trust → no-op (still eligible, still untrusted) ✓');

// 2. trust the deck → trusted, but files STILL eligible (trust ≠ approve)
rep = await trust(sid);
if (!rep.trusted) fail('trust did not trust the deck');
if (!['ia', 'ib', 'ic'].every((id) => stateOf(rep, id) === 'eligible')) fail(`trust must approve NOTHING; got ${JSON.stringify(rep.rows.map((r) => [r.assetId, r.state]))}`);
console.log('  2) trust this deck → trusted, files still eligible (trust approves nothing) ✓');

// 3. approve the whole figs/ folder → ia+ib approved, ic (other/) still eligible
const figsDir = dirOf(rep, 'ia');
if (!figsDir) fail('no resolvedDir for ia');
rep = await approveDir(sid, figsDir);
if (stateOf(rep, 'ia') !== 'approved' || stateOf(rep, 'ib') !== 'approved') fail(`approveDir did not approve both figs files; got ${JSON.stringify(rep.rows.map((r) => [r.assetId, r.state]))}`);
if (stateOf(rep, 'ic') !== 'eligible') fail('approveDir leaked into another folder (ic should still be eligible)');
console.log('  3) approve folder figs/ → a.svg + b.svg approved; other/c.svg untouched ✓');

// 4. approve the remaining file individually
rep = await approve(sid, 'ic', 'other/c.svg');
if (stateOf(rep, 'ic') !== 'approved') fail('per-file approve did not approve ic');
console.log('  4) approve other/c.svg → approved ✓');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.log('SECURITY_ACTIONS_PASS: two-step model holds — trust unlocks (approves nothing), then per-file / per-folder approve');
process.exit(0);
