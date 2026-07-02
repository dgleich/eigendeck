// Asset-security UX: the "this deck isn't trusted, files won't live-update" yellow
// nudge in the asset inspector must appear ONLY when watching is actually on. If the
// deck (or the global setting) has watching off, there's nothing to live-update, so the
// nudge is noise and must be hidden (PowerPoint model). See docs/ASSETS-SECURITY.md.
//
//   untrusted deck + linked image, select it, open the Asset inspector:
//     watching ON  (default)         → yellow nudge SHOWS
//     deck watching OFF (config)     → yellow nudge HIDDEN
//     deck watching ON again         → yellow nudge SHOWS
//
// Needs an empty deck under HOME. The nudge's distinctive text (not shared with the
// always-present "Review linked files…" link, nor the missing-source "last-loaded
// snapshot" alert) is "the embedded snapshot".
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const FIG = join(dirname(DECK), 'fig.svg');
const NUDGE = 'the embedded snapshot';   // text unique to the untrusted-watch nudge
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid, s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail = (m) => { console.error('WATCH_WARNING_FAIL:', m); process.exit(1); };
const bodyText = (sid) => exec(sid, "return document.body.textContent || ''");
const setWatch = (sid, v) => exec(sid, `window.__eigendeck.store.getState().updateConfig({autoReloadAssets:${v === null ? 'undefined' : `'${v}'`}});`);
// Wait for the nudge to be (present === want) for a stable read.
async function waitNudge(sid, want) {
  for (let i = 0; i < 15; i++) { await sleep(600); if ((await bodyText(sid)).includes(NUDGE) === want) return true; }
  return false;
}

writeFileSync(FIG, '<svg></svg>');
const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');
if (await execA(sid, "const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'fig.svg',data:Array.from(new TextEncoder().encode('<svg></svg>')),mimeType:'image/svg+xml',externalPath:'fig.svg',externalMtime:null,assetId:'ia1'}).then(()=>d('ok')).catch(e=>d('ERR'+e));") !== 'ok') fail('store ia1');
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'i1',type:'image',assetId:'ia1',position:{x:60,y:60,width:200,height:200}});");
// Select the image + open the Asset inspector so AssetSection renders.
await exec(sid, "const s=window.__eigendeck.store.getState();s.selectObject({type:'element',id:'i1'});if(!s.showProperties)s.toggleProperties();s.setInspectorTab('element');");

// ── watching ON (default global, no deck override) → nudge SHOWS ─────────────
if (!await waitNudge(sid, true)) fail('nudge did NOT show for an untrusted deck with watching ON');
console.log('  watching ON  → untrusted nudge shows ✓');

// ── deck watching OFF → nudge HIDDEN ────────────────────────────────────────
await setWatch(sid, 'off');
if (!await waitNudge(sid, false)) fail('nudge STILL shows with deck watching OFF (should be hidden)');
console.log('  watching OFF → nudge hidden ✓');

// ── deck watching ON again → nudge SHOWS ────────────────────────────────────
await setWatch(sid, 'on');
if (!await waitNudge(sid, true)) fail('nudge did not return after re-enabling watching');
console.log('  watching ON  → nudge shows again ✓');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.log('WATCH_WARNING_PASS: the untrusted nudge tracks the watch setting (hidden when watching is off)');
process.exit(0);
