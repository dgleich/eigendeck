// Bug: duplicate a slide (syncs its elements), then delete the duplicate. The
// remaining element must NO LONGER show the orange "synced" border, because it's
// no longer synced to anything. Drives the REAL store + render via the seam.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('SYNC_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');

// Reduce to a single slide that has at least one element; capture its id.
const elId = await exec(sid, `
  const g=window.__eigendeck.store.getState;
  while(g().presentation.slides.length>1){ g().deleteSlide(g().presentation.slides.length-1); }
  g().selectSlide(0);
  let s=g().presentation.slides[0];
  if(!s.elements.length){ g().addElement({id:'orph',type:'text',preset:'title',html:'Sync me',position:{x:60,y:60,width:600,height:160}}); }
  return g().presentation.slides[0].elements[0].id;`);
if(!elId) fail('no element');

// Duplicate slide 0 → both copies synced.
await exec(sid, `window.__eigendeck.store.getState().duplicateSlide(0);`);
await sleep(300);
const syncedAfterDup = await exec(sid, `return !!window.__eigendeck.store.getState().presentation.slides[0].elements[0].syncId;`);
if(!syncedAfterDup) fail('duplicate did not create a syncId');
console.log('  after duplicate: original element is synced ✓');

// Select the original element and confirm the orange border IS showing.
await exec(sid, `var g=window.__eigendeck.store.getState; g().selectSlide(0); g().selectObject({type:'element',id:'${elId}'});`);
await sleep(300);
const borderBefore = await exec(sid, `const n=document.querySelector('[data-element-id="${elId}"]'); return !!(n && n.classList.contains('is-synced'));`);
if(!borderBefore) fail('expected the synced border to show while a partner exists');
console.log('  synced border shows while the duplicate exists ✓');

// Delete the duplicate (slide index 1). Original becomes the sole member.
await exec(sid, `window.__eigendeck.store.getState().deleteSlide(1);`);
await sleep(300);
const syncIdAfter = await exec(sid, `return window.__eigendeck.store.getState().presentation.slides[0].elements[0].syncId || null;`);
if(syncIdAfter) fail(`syncId NOT cleaned up after deleting the partner slide: ${syncIdAfter}`);
console.log('  after deleting the duplicate: syncId is cleared in the data ✓');

// Re-select and confirm the border is GONE (the reported symptom).
await exec(sid, `var g=window.__eigendeck.store.getState; g().selectSlide(0); g().selectObject({type:'element',id:'${elId}'});`);
await sleep(300);
const borderAfter = await exec(sid, `const n=document.querySelector('[data-element-id="${elId}"]'); return !!(n && n.classList.contains('is-synced'));`);
if(borderAfter) fail('the synced border STILL shows after the partner was deleted (the bug)');
console.log('  synced border is gone after deleting the duplicate ✓');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('SYNC_PASS: orphaned sync cleared on partner-slide delete');
process.exit(0);
