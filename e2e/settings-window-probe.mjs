// e2e: the independent Settings window (#62) opens as a REAL second Tauri window
// and renders the settings panel. Verifies the new Vite entry (settings.html),
// the "*" window capability, and src/lib/settingsWindow.ts end-to-end — the parts
// unit tests can't cover. The cross-window pref-sync LOGIC is covered by
// src/lib/preferences.test.ts; runtime propagation is a Mac/manual check.
//
// Boilerplate mirrors security-window-trust-probe.mjs (multi-window handles).
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function get(p){const r=await fetch(BASE+p);const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function handles(sid){return (await get(`/session/${sid}/window/handles`))?.value||[];}
async function switchTo(sid, h){await post(`/session/${sid}/window`, { handle: h });}
async function domOf(sid){return String(await exec(sid,"return document.body?document.body.textContent:''")||'');}
const fail = (m) => { console.error('SETTINGS_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');
const mainH = (await handles(sid))[0];

// Open the Settings window via the seam hook.
await exec(sid, "window.__eigendeck.openSettings();");

// Wait for the second window handle.
let setH = null;
for (let i = 0; i < 12; i++) { await sleep(700); const hs = await handles(sid); setH = hs.find((h) => h !== mainH); if (setH) break; }
if (!setH) fail('Settings window did not open (no second window handle)');

// Switch into it and assert it rendered the panel. Settle after the switch (the
// freshly-loaded 2nd webview can read empty for a beat), then wait for the tabs.
// NOTE: "Settings" is the window TITLE (document.title), not body text — the tabs
// are General / Security / UI & Toolbar / Jupyter servers, so assert on those.
await switchTo(sid, setH);
await sleep(1200);
let txt = '', title = '';
for (let i = 0; i < 15; i++) { await sleep(500); txt = await domOf(sid); title = String(await exec(sid, "return document.title||''")); if (txt.includes('General') && txt.includes('Jupyter servers')) break; }
if (!title.includes('Settings')) fail(`Settings window title wrong; got: ${JSON.stringify(title)}`);
if (!txt.includes('General') || !txt.includes('Jupyter servers')) fail(`Settings tabs missing; got: ${txt.slice(0, 160)}`);

// Re-open (focus path): a second openSettings must NOT spawn a third window.
await switchTo(sid, mainH);
await exec(sid, "window.__eigendeck.openSettings();");
await sleep(1200);
const finalCount = (await handles(sid)).length;
if (finalCount !== 2) fail(`re-open should focus, not spawn: expected 2 windows, got ${finalCount}`);

console.log('SETTINGS_PASS: independent window opens + renders (General/Security/UI/Jupyter servers), re-open focuses');
process.exit(0);
