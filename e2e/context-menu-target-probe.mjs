// e2e: right-clicking a canvas element shows an element context menu and
// highlights THAT element (.context-target) WITHOUT changing the actual
// selection — the Mac "context menu targets without selecting" convention (#5).
// Closing the menu clears the highlight.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function dom(sid){return String(await exec(sid,"return document.body?document.body.textContent:''")||'');}
const fail = (m) => { console.error('CTXMENU_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');

// Two elements, MULTI-selected. Right-clicking one must (a) show the menu,
// (b) highlight the right-clicked one, (c) LEAVE the multi-selection intact —
// the Mac "target without changing selection" rule for a multi-selection.
await exec(sid, `const s=window.__eigendeck.store.getState();
  s.addElement({id:'m1',type:'text',preset:'body',content:'M1',position:{x:120,y:120,width:200,height:60}});
  s.addElement({id:'m2',type:'text',preset:'body',content:'M2',position:{x:500,y:300,width:200,height:60}});
  s.selectObject({type:'multi',ids:['m1','m2']});`);
let base = 0;
for (let i = 0; i < 12; i++) { await sleep(250); base = Number(await exec(sid, `const o=window.__eigendeck.store.getState().selectedObject; return o?.type==='multi'?o.ids.length:0;`)); if (base === 2) break; }
if (base !== 2) fail(`baseline multi-selection not [m1,m2] (got count ${base})`);

// Right-click m1 (native contextmenu bubbles to DraggableBox's handler).
const rc = await exec(sid, `const n=document.querySelector('[data-element-id="m1"]');
  if(!n) return 'no-node';
  const r=n.getBoundingClientRect();
  n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+5,clientY:r.top+5}));
  return 'ok';`);
if (rc !== 'ok') fail('could not right-click m1 (' + rc + ')');

// Capture menu-open + highlight + selection together while the menu is up.
let snap = { menu: false, targeted: false, selType: null, selCount: 0 };
for (let i = 0; i < 16; i++) {
  await sleep(250);
  snap = JSON.parse(await exec(sid, `const o=window.__eigendeck.store.getState().selectedObject; return JSON.stringify({
    menu: (document.body.textContent||'').includes('Bring to Front') && (document.body.textContent||'').includes('Send to Back'),
    targeted: !!document.querySelector('[data-element-id="m1"]')?.classList.contains('context-target'),
    selType: o?.type || null,
    selCount: o?.type==='multi'?o.ids.length:(o?.type==='element'?1:0),
  })`));
  if (snap.menu && snap.targeted) break;
}
if (!snap.menu) fail('element context menu did not appear (no "Bring to Front"/"Send to Back")');
if (!snap.targeted) fail(`m1 did not get the .context-target highlight (snap ${JSON.stringify(snap)})`);
if (snap.selType !== 'multi' || snap.selCount !== 2) fail(`right-click clobbered the multi-selection: ${JSON.stringify(snap)}`);

// Close the menu → highlight cleared. Escape fires ContextMenu's window keydown
// listener → onClose → context-menu-closed → setContextTarget(null).
await exec(sid, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
let cleared = false;
for (let i = 0; i < 12; i++) { await sleep(250); cleared = !(await exec(sid, `return !!document.querySelector('.context-target');`)); if (cleared) break; }
if (!cleared) {
  const diag = await exec(sid, `return JSON.stringify({ menuOpen: (document.body.textContent||'').includes('Bring to Front'), targeted: !!document.querySelector('.context-target') })`);
  console.error('DIAG ' + diag);
  fail('.context-target not cleared after menu close');
}

console.log('CTXMENU_PASS: element menu targets + highlights without changing selection; cleared on close');
process.exit(0);
