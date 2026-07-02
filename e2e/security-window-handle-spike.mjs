// SPIKE (not a gating probe) — answer #114's open question: can the WebDriver rig drive
// the Security window's DOM? It's a SECOND Tauri WebviewWindow; WebDriver addresses
// windows by "window handle" (GET /window/handles, POST /window switch). This opens the
// window via the real inspector button, then reports how many handles WebKitWebDriver
// exposes and whether we can switch to + read the second one.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function get(p){const r=await fetch(BASE+p);const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}

const sid = await open(); if (!sid || !await waitSeam(sid)) { console.log('SPIKE: open failed'); process.exit(1); }
const before = ((await get(`/session/${sid}/window/handles`))?.value) || [];
console.log('  handles before opening security window:', JSON.stringify(before));
// Open the Security window via the real inspector button.
await exec(sid, "const s=window.__eigendeck.store.getState();if(!s.showProperties)s.toggleProperties();s.setInspectorTab('presentation');");
await sleep(1200);
const clicked = await exec(sid, "const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('Linked files'));if(b){b.click();return true;}return false;");
console.log('  clicked "Linked files & security…" button:', clicked);
await sleep(3500); // let the WebviewWindow spin up

const handles = await get(`/session/${sid}/window/handles`);
console.log('  handles after:', JSON.stringify(handles));
const list = handles?.value || [];
console.log(`  → WebDriver exposes ${list.length} window handle(s)`);
const fresh = list.filter((h) => !before.includes(h));   // the NEW (security) window
if (fresh.length) {
  const sw = await post(`/session/${sid}/window`, { handle: fresh[0] });
  console.log('  switch to the NEW handle:', JSON.stringify(sw));
  const title = await exec(sid, "return document.title + ' :: ' + (document.body.textContent||'').slice(0,80)");
  console.log('  new window title/text:', JSON.stringify(title));
  const ok = typeof title === 'string' && /security|Linked files/i.test(title);
  console.log(ok
    ? 'SPIKE RESULT: the Security window IS WebDriver-addressable — we switched to it and read its DOM. A future probe can click its real Trust/Approve buttons.'
    : 'SPIKE RESULT: 2 handles exist but the new one did not read as the Security window — needs more digging.');
} else {
  console.log('SPIKE RESULT: no new handle — the second WebviewWindow is NOT exposed to WebDriver (seam-driven logic is the coverage)');
}
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
process.exit(0);
