// Asset-security — REAL Security-window trust flow (the probe that would have caught the
// trust-persistence bug). Drives the ACTUAL second Tauri window via WebDriver window
// handles + clicks the REAL "Trust this deck" button — NOT the seam (see the seam-
// discipline note: seams must not perform app actions). Asserts trust reaches the MAIN
// deck (token minted + saved + ledger) and PERSISTS across a reopen, and that the main
// window observes it (via the read-only trustReport observer).
//
//   untrusted deck + a linked file → open Security window → click "Trust this deck"
//     → main deck becomes trusted + tokened, the window shows the trusted state,
//     → reopen the deck → still trusted (token was saved).
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const FIG = join(dirname(DECK), 'fig.svg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function get(p){const r=await fetch(BASE+p);const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
async function handles(sid){return (await get(`/session/${sid}/window/handles`))?.value||[];}
async function switchTo(sid, h){await post(`/session/${sid}/window`, { handle: h });}
const fail = (m) => { console.error('SEC_TRUST_FAIL:', m); process.exit(1); };
// trustReport is async → drive it through execute/async (the observer read seam, allowed).
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
const report = async (sid) => JSON.parse(await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.trustReport().then(r=>d(r)).catch(e=>d(JSON.stringify({error:String(e)})))"));

writeFileSync(FIG, '<svg></svg>');
const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');
const mainH = (await handles(sid))[0];

// A linked asset on an untrusted (no-token) deck.
if (await execA(sid, "const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'fig.svg',data:Array.from(new TextEncoder().encode('<svg></svg>')),mimeType:'image/svg+xml',externalPath:'fig.svg',externalMtime:null,assetId:'ia1'}).then(()=>d('ok')).catch(e=>d('ERR'+e));") !== 'ok') fail('store ia1');
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'i1',type:'image',assetId:'ia1',position:{x:60,y:60,width:200,height:200}});");
let rep = await report(sid);
if (rep.trusted) fail('deck should start untrusted');
console.log('  main: deck starts untrusted ✓');

// Open the REAL Security window via the inspector button.
await exec(sid, "const s=window.__eigendeck.store.getState();if(!s.showProperties)s.toggleProperties();s.setInspectorTab('presentation');");
await sleep(1200);
await exec(sid, "const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('Linked files'));if(b)b.click();");
let secH = null;
for (let i = 0; i < 12; i++) { await sleep(700); const hs = await handles(sid); secH = hs.find((h) => h !== mainH); if (secH) break; }
if (!secH) fail('Security window did not open (no second window handle)');
console.log('  opened the real Security window ✓');

// In the REAL window: confirm the Trust prompt, then click the REAL button.
await switchTo(sid, secH);
let secText = await exec(sid, "return document.body.textContent||''");
if (!secText.includes('Trust this deck')) fail(`Security window should show the Trust prompt; got: ${secText.slice(0, 120)}`);
const clicked = await exec(sid, "const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Trust this deck');if(b){b.click();return true;}return false;");
if (!clicked) fail('could not find/click the real "Trust this deck" button');
console.log('  clicked the real "Trust this deck" button ✓');

// The main window mints+saves+re-inits → the window remounts to the trusted state.
let windowTrusted = false;
for (let i = 0; i < 15; i++) { await sleep(700); const t = await exec(sid, "return document.body.textContent||''"); if (!t.includes('Trust this deck')) { windowTrusted = true; break; } }
if (!windowTrusted) fail('Security window still shows "Trust this deck" after clicking it (trust did not take)');
console.log('  Security window now shows the trusted state ✓');

// Back in the MAIN window: trust must have reached the deck (token) + ledger.
await switchTo(sid, mainH);
let ok = false;
for (let i = 0; i < 15; i++) { await sleep(600); rep = await report(sid); if (rep.trusted && rep.token) { ok = true; break; } }
if (!ok) fail(`main window not trusted after real-UI trust (token=${rep.token}, trusted=${rep.trusted}) — the exact bug`);
console.log('  main deck is now trusted + tokened ✓');

// Persistence: reopen the deck in a fresh session — trust must survive (token was saved).
await quit(sid);
const sid2 = await open(); if (!sid2 || !await waitSeam(sid2)) fail('reopen');
let rep2 = null;
for (let i = 0; i < 12; i++) { await sleep(700); rep2 = await report(sid2); if (rep2.trusted) break; }
await quit(sid2);
if (!rep2 || !rep2.trusted) fail(`trust did NOT persist across reopen (token not saved to the deck) — got ${JSON.stringify(rep2)}`);
console.log('  reopen → still trusted (token persisted) ✓');
console.log('SEC_TRUST_PASS: real Security-window trust reaches the deck, is saved, and persists');
process.exit(0);
