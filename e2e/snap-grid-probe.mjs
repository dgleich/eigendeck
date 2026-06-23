// snap-to-grid: the editor alignment grid must (a) render its dot overlay
// only when "Show Grid Points" is on, and (b) round an element's position to
// the grid spacing on drag — unless ⌘ is held (bypass). Drives a REAL
// synthesized pointer drag through DraggableBox (not the store), since the
// frontend↔drag-handler integration is what a unit test can't cover.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('GRID_FAIL:',m);process.exit(1);};

// Synthesized single-element drag by a FIXED client delta. Resets g1 to a
// known spot first so the start point (hence the raw landing spot) is
// identical every call. `meta` = hold ⌘ (bypass). Returns el.position.
function dragScript(meta){return `
  const st = window.__eigendeck.store.getState();
  st.updateElement('g1', { position: { x:100, y:100, width:400, height:160 } });
  st.selectObject({ type:'element', id:'g1' });
  const node = document.querySelector('[data-element-id="g1"]');
  if(!node) return 'NO_EL';
  const r = node.getBoundingClientRect();
  const sx = Math.round(r.left + 20), sy = Math.round(r.top + 20);
  const mx = sx + 150, my = sy + 170;
  node.dispatchEvent(new PointerEvent('pointerdown', { clientX:sx, clientY:sy, bubbles:true, cancelable:true }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX:mx, clientY:my, bubbles:true, metaKey:${meta} }));
  window.dispatchEvent(new PointerEvent('pointerup', { clientX:mx, clientY:my, bubbles:true }));
  const idx = window.__eigendeck.store.getState().currentSlideIndex;
  const el = window.__eigendeck.store.getState().presentation.slides[idx].elements.find(e=>e.id==='g1');
  return JSON.stringify(el.position);`;
}
const gridOverlayPresent=(sid)=>exec(sid,"return !!document.querySelector('[data-grid-overlay]');");

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');

// Grid spacing 80; snap + overlay both OFF to start.
await exec(sid, "localStorage.setItem('eigendeck:pref:gridSpacing','80'); window.dispatchEvent(new CustomEvent('eigendeck:pref-changed',{detail:{key:'gridSpacing'}})); const s=window.__eigendeck.store.getState(); if(s.snapToGrid) s.toggleSnapToGrid(); if(s.showGrid) s.toggleShowGrid();");
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'g1',type:'text',preset:'body',html:'Snap me',position:{x:100,y:100,width:400,height:160}});");
await sleep(500);

// --- overlay visibility -------------------------------------------------
if(await gridOverlayPresent(sid)) fail('grid overlay present while Show Grid Points is OFF');
await exec(sid, "window.__eigendeck.store.getState().toggleShowGrid();");
await sleep(300);
if(!await gridOverlayPresent(sid)) fail('grid overlay missing after Show Grid Points ON');
console.log('  overlay shows only when Show Grid Points is on ✓');

// #89: the WHOLE overlay is ONE inline <svg> covering the slide — a tiling
// <pattern> for the dots + coarse "+" crosses, PLUS the dead-center "+", all in
// one coordinate system / one raster so the center mark can't drift off the dot
// grid (the WKWebView/Retina bug from mixing a background tile + a separate
// element). Read the inline markup, not a CSS background.
const svg = await exec(sid, "const d=document.querySelector('[data-grid-overlay]'); return d ? d.innerHTML : '';");
if(!/^<svg/.test(svg)) fail(`grid overlay is not an inline <svg>: ${String(svg).slice(0,80)}`);
if(!/<pattern id=['"]?eigendeck-grid/.test(svg)) fail(`overlay has no tiling <pattern>: ${svg.slice(0,160)}`);
if(!/width=['"]?320['"]? height=['"]?320['"]?/.test(svg)) fail(`pattern tile not 4× spacing (expected 320): ${svg.slice(0,200)}`);
if(!/M160 \d+V/.test(svg)) fail(`coarse cross not centered on the grid point at 2g=160: ${svg.slice(0,200)}`);
// the dead-center "+" must sit at the true slide center (960,540), in the SAME svg
if(!/M960 \d+V\d+M\d+ 540H\d+/.test(svg)) fail(`dead-center "+" not at slide center 960,540: ${svg.slice(-200)}`);
console.log('  one inline svg: tiled dots/crosses + a dead-center "+" at 960,540 ✓ (#89)');

// NOTE: the native View-menu checkmark sync (CheckMenuItem ↔ store flag) is
// NOT covered here — tauri-driver can't drive native menus. It's pinned by
// building the items with .checked(false) so the initial state matches the
// store default; muda keeps them in sync per click after that.

// --- snap math (real drag) ---------------------------------------------
const off = JSON.parse(await exec(sid, dragScript(false)));
if(off.x===100 && off.y===100) fail('drag did not move the element');
const round80 = v => Math.round(v/80)*80;

await exec(sid, "const s=window.__eigendeck.store.getState(); if(!s.snapToGrid) s.toggleSnapToGrid();");
await sleep(200);
const on = JSON.parse(await exec(sid, dragScript(false)));
if(on.x%80!==0 || on.y%80!==0) fail(`snapped pos not grid-aligned: ${JSON.stringify(on)}`);
if(on.x!==round80(off.x) || on.y!==round80(off.y)) fail(`snapped pos != rounded raw: on=${JSON.stringify(on)} off=${JSON.stringify(off)}`);
console.log(`  drag with snap ON rounds (${off.x},${off.y}) -> (${on.x},${on.y}) ✓`);

// --- ⌘ bypass -----------------------------------------------------------
const bypass = JSON.parse(await exec(sid, dragScript(true)));
if(bypass.x!==off.x || bypass.y!==off.y) fail(`⌘-drag should bypass snap (raw=${JSON.stringify(off)} got=${JSON.stringify(bypass)})`);
console.log('  holding ⌘ bypasses snapping ✓');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('GRID_PASS: overlay gating + snap rounding + ⌘ bypass');
process.exit(0);
